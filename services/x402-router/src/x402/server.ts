import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse
} from "@x402/core/types";
import {
  PAYMENT_IDENTIFIER,
  extractAndValidatePaymentIdentifier,
  isPaymentIdentifierRequired,
  validatePaymentIdentifierRequirement
} from "@x402/extensions/payment-identifier";
import { SendAssetTypes } from "@nktkas/hyperliquid/api/exchange";
import {
  encodePacked,
  getAddress,
  hashTypedData,
  keccak256,
  recoverTypedDataAddress,
  stringToBytes,
  zeroAddress
} from "viem";
import type { Address, Hex } from "viem";
import {
  ExecutionIntentDomainSchema,
  hashIntentText,
  hashPaymentRequirements,
  stableJson
} from "x402-hl/intents";
import { ExactHyperliquidPayloadSchema } from "x402-hl";
import type { IntentExecutionRecord } from "x402-hl/intents/server";

import {
  X402_HYPERLIQUID_TESTNET,
  X402_PROTOCOL_VERSION
} from "./constants";
import {
  assertPersistedX402Quote,
  createPersistedX402Quote
} from "./quote";
import {
  assertFundedX402SettlementEnabled,
  assessX402HlRelease,
  detectInstalledX402HlVersion
} from "./release-gate";
import { X402SettlementIdentityConflictError } from "./types";
import type {
  PersistedX402Quote,
  SettlePersistedX402QuoteInput,
  SettledX402Execution,
  X402ServerLayer,
  X402ServerLayerConfig,
  X402SettlementJournalRecord
} from "./types";

export type X402PaymentErrorCode =
  | "invalid_payment_payload"
  | "intent_preflight_failed"
  | "facilitator_verification_failed"
  | "settlement_journal_failed"
  | "settlement_failed"
  | "settlement_uncertain"
  | "settlement_binding_mismatch"
  | "execution_registration_failed"
  | "execution_record_mismatch";

export type X402PaymentErrorPhase =
  | "pre_settlement"
  | "settlement"
  | "post_settlement";

export class X402PaymentError extends Error {
  readonly code: X402PaymentErrorCode;
  readonly phase: X402PaymentErrorPhase;
  readonly paymentMoved: false | true | "unknown";
  readonly settlement: SettleResponse | undefined;
  readonly originalCause: unknown;

  constructor(input: {
    readonly code: X402PaymentErrorCode;
    readonly phase: X402PaymentErrorPhase;
    readonly message: string;
    readonly paymentMoved: false | true | "unknown";
    readonly settlement?: SettleResponse;
    readonly cause?: unknown;
  }) {
    super(input.message);
    this.name = "X402PaymentError";
    this.code = input.code;
    this.phase = input.phase;
    this.paymentMoved = input.paymentMoved;
    this.settlement = input.settlement;
    this.originalCause = input.cause;
  }
}

const HYPERCORE_PAYMENT_IDENTITY_DOMAIN = keccak256(
  stringToBytes("pledge.cash/x402-hl/sendAsset-identity/v1")
);

export function createX402ServerLayer(
  config: X402ServerLayerConfig
): X402ServerLayer {
  const domain = ExecutionIntentDomainSchema.parse(config.domain);
  const paymentPayTo = getAddress(config.paymentPayTo);
  const now = config.now ?? (() => Math.floor(Date.now() / 1_000));
  const installedVersion =
    config.installedX402HlVersion ?? detectInstalledX402HlVersion();
  const releaseSafety = assessX402HlRelease(installedVersion);

  return {
    releaseSafety,

    createQuote(input) {
      return createPersistedX402Quote(
        {
          domain,
          paymentPayTo,
          now: assertNow(now())
        },
        input
      );
    },

    paymentRequired(quote) {
      assertPersistedX402Quote(quote, { domain, paymentPayTo });
      return structuredClone(quote.paymentRequired);
    },

    async paymentAttempt(input) {
      return input.paymentPayloadHash === undefined
        ? config.settlementJournal.lookupByQuoteId(input.quoteId)
        : config.settlementJournal.lookup({
            quoteId: input.quoteId,
            paymentPayloadHash: input.paymentPayloadHash
          });
    },

    async settleAndExecute(
      input: SettlePersistedX402QuoteInput
    ): Promise<SettledX402Execution> {
      // This is deliberately the first paid-request operation. v0.2.1 may be
      // used to construct quotes and run offline tests, but no signed payment
      // reaches a facilitator until the installed package is safe.
      assertFundedX402SettlementEnabled(releaseSafety);

      const paymentNow = assertNow(input.now ?? now());
      const quote = input.quote;
      assertPersistedX402Quote(quote, { domain, paymentPayTo });
      assertSelectedPaymentOption(input.paymentPayload, quote);
      assertPaymentIdentifierBinding(input.paymentPayload, quote);
      let paymentHashes: HyperCorePaymentHashes;
      try {
        paymentHashes = await hashHyperCorePaymentAction(input.paymentPayload);
      } catch (cause) {
        throw new X402PaymentError({
          code: "invalid_payment_payload",
          phase: "pre_settlement",
          message: "Payment does not contain one canonical HyperCore action",
          paymentMoved: false,
          cause
        });
      }
      const { paymentIdentityHash, paymentPayloadHash } = paymentHashes;
      const journaledReplay = await lookupSettlementJournal(
        config,
        quote,
        paymentIdentityHash,
        paymentPayloadHash
      );
      const expectedParty = getAddress(quote.intent.user);
      if (journaledReplay === undefined) {
        const preflight = await verifyBeforeSettlement(
          config,
          quote,
          input.paymentPayload,
          paymentNow
        );
        if (
          getAddress(preflight.signer) !== expectedParty ||
          getAddress(quote.intent.recipient) !== expectedParty ||
          getAddress(quote.intent.refundAddress) !== expectedParty
        ) {
          throw new X402PaymentError({
            code: "intent_preflight_failed",
            phase: "pre_settlement",
            message:
              "Execution-intent signer, recipient, and refund address must be identical",
            paymentMoved: false
          });
        }

        const facilitatorVerification = await verifyWithFacilitator(
          config,
          input.paymentPayload,
          quote.paymentRequirements
        );
        if (!facilitatorVerification.payer) {
          throw new X402PaymentError({
            code: "facilitator_verification_failed",
            phase: "pre_settlement",
            message: "Facilitator verification did not recover a payer",
            paymentMoved: false
          });
        }
        if (getAddress(facilitatorVerification.payer) !== expectedParty) {
          throw new X402PaymentError({
            code: "facilitator_verification_failed",
            phase: "pre_settlement",
            message:
              "Signed Hyperliquid payer does not match the intent recipient and refund address",
            paymentMoved: false
          });
        }
      }

      const prepared = await prepareSettlementJournal(
        config,
        quote,
        input.paymentPayload,
        paymentIdentityHash,
        paymentPayloadHash,
        journaledReplay !== undefined
      );
      if (prepared.status === "failed") {
        throw new X402PaymentError({
          code: "settlement_failed",
          phase: "settlement",
          message: "This exact payment attempt previously failed definitively",
          paymentMoved: false,
          ...(prepared.settlement === undefined
            ? {}
            : { settlement: prepared.settlement })
        });
      }

      const settlement =
        prepared.status === "settled"
          ? readJournaledSettlement(prepared, quote, expectedParty)
          : await settleAndJournal(
              config,
              prepared,
              quote,
              input.paymentPayload,
              paymentIdentityHash,
              paymentPayloadHash,
              expectedParty,
              paymentNow
            );

      let execution: IntentExecutionRecord;
      try {
        execution = await config.executor.execute({
          paymentPayload: input.paymentPayload,
          paymentRequirements: quote.paymentRequirements,
          settleResponse: settlement,
          expectedQuoteId: quote.id,
          expectedIntentTemplateHash: quote.intentTemplateHash,
          now: paymentNow
        });
      } catch (cause) {
        throw new X402PaymentError({
          code: "execution_registration_failed",
          phase: "post_settlement",
          message:
            "Payment settled and was journaled, but durable intent execution registration failed",
          paymentMoved: true,
          settlement,
          cause
        });
      }

      assertExecutionRecord(execution, quote, settlement, expectedParty);
      return {
        quoteId: quote.id,
        paymentId: quote.paymentId,
        settlement,
        execution
      };
    }
  };
}

async function lookupSettlementJournal(
  config: X402ServerLayerConfig,
  quote: PersistedX402Quote,
  paymentIdentityHash: Hex,
  paymentPayloadHash: Hex
): Promise<X402SettlementJournalRecord | undefined> {
  let record;
  try {
    record = await config.settlementJournal.lookup({
      quoteId: quote.id,
      paymentPayloadHash
    });
  } catch (cause) {
    throw new X402PaymentError({
      code: "settlement_journal_failed",
      phase: "pre_settlement",
      message: "Existing payment recovery state could not be read",
      paymentMoved: "unknown",
      cause
    });
  }
  if (record !== undefined) {
    await assertJournalBinding(
      record,
      quote,
      paymentIdentityHash,
      paymentPayloadHash
    );
  }
  return record;
}

export function canonicalizeX402TransactionIdentifier(value: string): string {
  const canonical = value.trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(canonical)) {
    throw new X402PaymentError({
      code: "settlement_binding_mismatch",
      phase: "settlement",
      message: "Settlement transaction must be a canonical 32-byte hash",
      paymentMoved: "unknown"
    });
  }
  return canonical;
}

async function verifyBeforeSettlement(
  config: X402ServerLayerConfig,
  quote: PersistedX402Quote,
  paymentPayload: PaymentPayload,
  now: number
) {
  let preflight;
  try {
    preflight = await config.executor.verifyBeforeSettlement({
      paymentPayload,
      paymentRequirements: quote.paymentRequirements,
      expectedQuoteId: quote.id,
      expectedIntentTemplateHash: quote.intentTemplateHash,
      now
    });
  } catch (cause) {
    throw new X402PaymentError({
      code: "intent_preflight_failed",
      phase: "pre_settlement",
      message: "Execution-intent pre-settlement verification threw",
      paymentMoved: false,
      cause
    });
  }
  if (!preflight.ok) {
    throw new X402PaymentError({
      code: "intent_preflight_failed",
      phase: "pre_settlement",
      message: `${preflight.reason}: ${preflight.message}`,
      paymentMoved: false
    });
  }
  return preflight;
}

async function verifyWithFacilitator(
  config: X402ServerLayerConfig,
  paymentPayload: PaymentPayload,
  paymentRequirements: PaymentRequirements
) {
  let result;
  try {
    result = await config.facilitator.verify(
      paymentPayload,
      paymentRequirements
    );
  } catch (cause) {
    throw new X402PaymentError({
      code: "facilitator_verification_failed",
      phase: "pre_settlement",
      message: "Hyperliquid facilitator verification threw",
      paymentMoved: false,
      cause
    });
  }
  if (!result.isValid) {
    throw new X402PaymentError({
      code: "facilitator_verification_failed",
      phase: "pre_settlement",
      message: `Hyperliquid payment is invalid: ${result.invalidReason}`,
      paymentMoved: false
    });
  }
  return result;
}

async function prepareSettlementJournal(
  config: X402ServerLayerConfig,
  quote: PersistedX402Quote,
  paymentPayload: PaymentPayload,
  paymentIdentityHash: Hex,
  paymentPayloadHash: Hex,
  previouslyJournaled: boolean
): Promise<X402SettlementJournalRecord> {
  let prepared;
  try {
    prepared = await config.settlementJournal.prepare({
      quoteId: quote.id,
      paymentId: quote.paymentId,
      paymentIdentityHash,
      paymentPayloadHash,
      paymentRequirementsHash: quote.paymentRequirementsHash,
      paymentPayload: structuredClone(paymentPayload),
      paymentRequirements: structuredClone(quote.paymentRequirements)
    });
  } catch (cause) {
    const uncertain =
      previouslyJournaled ||
      cause instanceof X402SettlementIdentityConflictError;
    throw new X402PaymentError({
      code: uncertain
        ? "settlement_uncertain"
        : "settlement_journal_failed",
      phase: uncertain ? "settlement" : "pre_settlement",
      message: uncertain
        ? "The signed HyperCore action already has durable recovery state"
        : "Payment settlement intent could not be durably journaled",
      paymentMoved: uncertain ? "unknown" : false,
      cause
    });
  }
  await assertJournalBinding(
    prepared,
    quote,
    paymentIdentityHash,
    paymentPayloadHash
  );
  return prepared;
}

async function settleAndJournal(
  config: X402ServerLayerConfig,
  prepared: X402SettlementJournalRecord,
  quote: PersistedX402Quote,
  paymentPayload: PaymentPayload,
  paymentIdentityHash: Hex,
  paymentPayloadHash: Hex,
  expectedParty: Address,
  now: number
): Promise<SettledX402Execution["settlement"]> {
  let rawSettlement: SettleResponse;
  try {
    rawSettlement = await config.facilitator.settle(
      paymentPayload,
      quote.paymentRequirements
    );
  } catch (cause) {
    // The prepared row intentionally remains recoverable. Replaying the exact
    // signed payload through the hardened facilitator reconciles before submit.
    throw new X402PaymentError({
      code: "settlement_uncertain",
      phase: "settlement",
      message:
        "Facilitator settlement threw after the payment attempt was journaled; recover by replaying the exact journaled payload",
      paymentMoved: "unknown",
      cause
    });
  }

  // Persist the facilitator's complete result before trusting any of its
  // binding fields. Even a malformed success response is material evidence
  // that operators need for reconciliation.
  const settlement = canonicalizeSettlementEvidence(rawSettlement);

  let journaled: X402SettlementJournalRecord;
  try {
    journaled = await config.settlementJournal.recordResult({
      attemptId: prepared.attemptId,
      paymentPayloadHash,
      settlement,
      recordedAt: new Date(now * 1_000).toISOString()
    });
  } catch (cause) {
    throw new X402PaymentError({
      code: "settlement_journal_failed",
      phase: "settlement",
      message:
        "Facilitator returned a settlement result that could not be durably recorded; recover from the prepared journal entry",
      paymentMoved: rawSettlement.success ? true : "unknown",
      settlement,
      cause
    });
  }
  await assertJournalBinding(
    journaled,
    quote,
    paymentIdentityHash,
    paymentPayloadHash
  );
  if (
    !journaled.settlement ||
    stableJson(journaled.settlement) !== stableJson(settlement)
  ) {
    throw new X402PaymentError({
      code: "settlement_journal_failed",
      phase: "settlement",
      message: "Settlement journal did not retain the exact facilitator result",
      paymentMoved: settlement.success ? true : "unknown",
      settlement
    });
  }

  if (!settlement.success) {
    if (journaled.status !== "failed") {
      throw new X402PaymentError({
        code: "settlement_uncertain",
        phase: "settlement",
        message:
          "Hyperliquid did not provide definitive no-transfer evidence; exact-payload recovery is required",
        paymentMoved: "unknown",
        settlement
      });
    }
    throw new X402PaymentError({
      code: "settlement_failed",
      phase: "settlement",
      message: `Hyperliquid settlement failed: ${settlement.errorReason}`,
      paymentMoved: false,
      settlement
    });
  }
  const successfulSettlement = normalizeSuccessfulSettlement(
    settlement,
    quote,
    expectedParty
  );
  if (journaled.status !== "settled") {
    throw new X402PaymentError({
      code: "settlement_journal_failed",
      phase: "settlement",
      message: "Successful settlement was not marked settled in the journal",
      paymentMoved: true,
      settlement: successfulSettlement
    });
  }
  return successfulSettlement;
}

function readJournaledSettlement(
  journal: X402SettlementJournalRecord,
  quote: PersistedX402Quote,
  expectedParty: Address
): SettledX402Execution["settlement"] {
  if (!journal.settlement?.success) {
    throw new X402PaymentError({
      code: "settlement_journal_failed",
      phase: "settlement",
      message: "Journaled settled attempt does not contain a successful receipt",
      paymentMoved: "unknown",
      ...(journal.settlement === undefined
        ? {}
        : { settlement: journal.settlement })
    });
  }
  return normalizeSuccessfulSettlement(
    journal.settlement,
    quote,
    expectedParty
  );
}

function normalizeSuccessfulSettlement(
  settlement: SettleResponse,
  quote: PersistedX402Quote,
  expectedParty: Address
): SettledX402Execution["settlement"] {
  if (settlement.success !== true) {
    throw new X402PaymentError({
      code: "settlement_binding_mismatch",
      phase: "settlement",
      message: "Expected a successful settlement receipt",
      paymentMoved: "unknown",
      settlement
    });
  }
  const transaction = canonicalizeX402TransactionIdentifier(
    settlement.transaction
  );
  if (
    settlement.network !== X402_HYPERLIQUID_TESTNET ||
    settlement.amount !== quote.paymentRequirements.amount ||
    !settlement.payer ||
    getAddress(settlement.payer) !== expectedParty
  ) {
    throw new X402PaymentError({
      code: "settlement_binding_mismatch",
      phase: "settlement",
      message:
        "Successful settlement does not match the persisted network, amount, and payer",
      paymentMoved: true,
      settlement
    });
  }

  return {
    ...settlement,
    success: true,
    transaction,
    network: X402_HYPERLIQUID_TESTNET,
    payer: expectedParty,
    amount: quote.paymentRequirements.amount
  };
}

function canonicalizeSettlementEvidence(
  settlement: SettleResponse
): SettleResponse {
  return {
    ...settlement,
    transaction: settlement.transaction.trim().toLowerCase()
  };
}

function assertSelectedPaymentOption(
  paymentPayload: PaymentPayload,
  quote: PersistedX402Quote
): void {
  if (paymentPayload.x402Version !== X402_PROTOCOL_VERSION) {
    throw new X402PaymentError({
      code: "invalid_payment_payload",
      phase: "pre_settlement",
      message: "Only x402 v2 payment payloads are accepted",
      paymentMoved: false
    });
  }

  let selectedHash: Hex;
  try {
    selectedHash = hashPaymentRequirements(paymentPayload.accepted);
  } catch (cause) {
    throw new X402PaymentError({
      code: "invalid_payment_payload",
      phase: "pre_settlement",
      message: "Selected payment requirements are not canonical",
      paymentMoved: false,
      cause
    });
  }
  if (
    selectedHash.toLowerCase() !==
    quote.paymentRequirementsHash.toLowerCase()
  ) {
    throw new X402PaymentError({
      code: "invalid_payment_payload",
      phase: "pre_settlement",
      message: "Payment selected requirements other than the persisted option",
      paymentMoved: false
    });
  }
}

function assertPaymentIdentifierBinding(
  paymentPayload: PaymentPayload,
  quote: PersistedX402Quote
): void {
  const declaredExtension =
    quote.paymentRequired.extensions?.[PAYMENT_IDENTIFIER];
  const serverRequired = isPaymentIdentifierRequired(declaredExtension);
  const clientRequired = isPaymentIdentifierRequired(
    paymentPayload.extensions?.[PAYMENT_IDENTIFIER]
  );
  const requirementValidation = validatePaymentIdentifierRequirement(
    paymentPayload,
    serverRequired
  );
  const { id: paymentId, validation } =
    extractAndValidatePaymentIdentifier(paymentPayload);
  const persistedHash =
    quote.paymentRequirements.extra?.paymentIdentifierHash;

  if (
    !serverRequired ||
    !clientRequired ||
    !requirementValidation.valid ||
    !validation.valid ||
    paymentId === null ||
    paymentId !== quote.paymentId ||
    typeof persistedHash !== "string" ||
    hashIntentText(paymentId).toLowerCase() !== persistedHash.toLowerCase()
  ) {
    const errors = [
      ...(requirementValidation.errors ?? []),
      ...(validation.errors ?? [])
    ];
    throw new X402PaymentError({
      code: "invalid_payment_payload",
      phase: "pre_settlement",
      message:
        errors.length > 0
          ? `Payment identifier is invalid: ${errors.join("; ")}`
          : "Payment identifier does not match the persisted quote",
      paymentMoved: false
    });
  }
}

async function assertJournalBinding(
  journal: X402SettlementJournalRecord,
  quote: PersistedX402Quote,
  paymentIdentityHash: Hex,
  paymentPayloadHash: Hex
): Promise<void> {
  let journalHashes: HyperCorePaymentHashes | undefined;
  try {
    journalHashes = await hashHyperCorePaymentAction(journal.paymentPayload);
  } catch {
    // The comparisons below fail closed when a sealed payload is malformed.
  }
  if (
    journal.quoteId !== quote.id ||
    journal.paymentId !== quote.paymentId ||
    journal.paymentIdentityHash.toLowerCase() !==
      paymentIdentityHash.toLowerCase() ||
    journal.attemptId.toLowerCase() !== paymentIdentityHash.toLowerCase() ||
    journal.paymentPayloadHash.toLowerCase() !== paymentPayloadHash.toLowerCase() ||
    journal.paymentRequirementsHash.toLowerCase() !==
      quote.paymentRequirementsHash.toLowerCase() ||
    journalHashes?.paymentIdentityHash.toLowerCase() !==
      paymentIdentityHash.toLowerCase() ||
    journalHashes?.paymentPayloadHash.toLowerCase() !==
      paymentPayloadHash.toLowerCase() ||
    hashPaymentRequirements(journal.paymentRequirements).toLowerCase() !==
      quote.paymentRequirementsHash.toLowerCase()
  ) {
    throw new X402PaymentError({
      code: "settlement_journal_failed",
      phase: "pre_settlement",
      message: "Settlement journal returned a record with different signed terms",
      paymentMoved: "unknown"
    });
  }
}

function assertExecutionRecord(
  record: IntentExecutionRecord,
  quote: PersistedX402Quote,
  settlement: SettledX402Execution["settlement"],
  expectedParty: Address
): void {
  if (
    record.quoteId !== quote.id ||
    record.intentHash.toLowerCase() === "" ||
    record.intentTemplateHash.toLowerCase() !==
      quote.intentTemplateHash.toLowerCase() ||
    record.paymentRequirementsHash.toLowerCase() !==
      quote.paymentRequirementsHash.toLowerCase() ||
    record.paymentNetwork !== X402_HYPERLIQUID_TESTNET ||
    record.paymentTransaction !== settlement.transaction ||
    record.paymentAmount !== quote.paymentRequirements.amount ||
    getAddress(record.payer) !== expectedParty ||
    getAddress(record.intent.recipient) !== expectedParty ||
    getAddress(record.intent.refundAddress) !== expectedParty
  ) {
    throw new X402PaymentError({
      code: "execution_record_mismatch",
      phase: "post_settlement",
      message: "Executor returned a record outside the settled quote binding",
      paymentMoved: true,
      settlement
    });
  }
}

type HyperCorePaymentHashes = {
  readonly paymentIdentityHash: Hex;
  readonly paymentPayloadHash: Hex;
};

export async function hashHyperCorePaymentAction(
  paymentPayload: PaymentPayload
): Promise<HyperCorePaymentHashes> {
  const exact = ExactHyperliquidPayloadSchema.parse(paymentPayload.payload);
  if (exact.nonce !== exact.action.nonce) {
    throw new Error("HyperCore payload and action nonces differ");
  }
  const typedData = {
    domain: {
      name: "HyperliquidSignTransaction",
      version: "1",
      chainId: BigInt(exact.action.signatureChainId),
      verifyingContract: zeroAddress
    },
    types: SendAssetTypes,
    primaryType: "HyperliquidTransaction:SendAsset" as const,
    message: exact.action
  };
  const recoveredPayer = getAddress(
    await recoverTypedDataAddress({
      ...typedData,
      signature: {
        r: exact.signature.r as Hex,
        s: exact.signature.s as Hex,
        yParity: exact.signature.v - 27
      }
    })
  );
  if (recoveredPayer !== getAddress(exact.user)) {
    throw new Error("HyperCore action signer does not match its declared user");
  }
  const actionHash = hashTypedData(typedData);
  return {
    paymentIdentityHash: keccak256(
      encodePacked(
        ["bytes32", "address", "bytes32"],
        [
          HYPERCORE_PAYMENT_IDENTITY_DOMAIN,
          recoveredPayer,
          actionHash
        ]
      )
    ),
    paymentPayloadHash: keccak256(
      stringToBytes(stableJson(paymentPayload))
    )
  };
}

function assertNow(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new X402PaymentError({
      code: "invalid_payment_payload",
      phase: "pre_settlement",
      message: "Current time must be a positive Unix timestamp",
      paymentMoved: false
    });
  }
  return value;
}
