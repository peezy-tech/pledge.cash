import { describe, expect, test } from "bun:test";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse
} from "@x402/core/types";
import {
  PAYMENT_IDENTIFIER,
  appendPaymentIdentifierToExtensions,
  isPaymentIdentifierRequired
} from "@x402/extensions/payment-identifier";
import { getAddress } from "viem";
import {
  hashExecutionIntent,
  hashIntentText,
  type ExecutionIntentDomain
} from "x402-hl/intents";
import { ExactHyperliquidScheme as ExactHyperliquidClient } from "x402-hl/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import type {
  IntentExecutionRecord,
  PreSettlementIntentVerificationResult
} from "x402-hl/intents/server";

import {
  UnsafeX402RuntimeError,
  X402_HYPERCORE_TESTNET_USDC_ASSET,
  X402_HYPERCORE_USDC_DECIMALS,
  X402_HYPEREVM_TESTNET_CHAIN_ID,
  X402_HYPERLIQUID_TESTNET,
  X402PaymentQuoteBuilder,
  X402PaymentError,
  assessX402HlRelease,
  createX402ServerLayer,
  hashHyperCorePaymentAction,
  type PersistedX402Quote,
  type X402SettlementJournal,
  type X402SettlementJournalRecord
} from "../src/x402";
import { classifyHyperCoreSettlement } from "../src/execution/hypercore-settlement";

const PAYER_ACCOUNT = privateKeyToAccount(
  `0x${"11".repeat(32)}` as const
);
const PAYER = PAYER_ACCOUNT.address;
const OTHER = getAddress("0x2222222222222222222222222222222222222222");
const PAY_TO = getAddress("0x3333333333333333333333333333333333333333");
const TARGET = getAddress("0x4444444444444444444444444444444444444444");
const GATEWAY = getAddress("0x5555555555555555555555555555555555555555");
const PAYMENT_TX = `0x${"aB".repeat(32)}`;
const INTENT_HASH = `0x${"12".repeat(32)}` as const;
const NOW = 1_800_000_000;

const DOMAIN = {
  application: "x402-router.pledge.cash/v1",
  gateway: GATEWAY
} satisfies ExecutionIntentDomain;

describe("x402 release gate", () => {
  test("fails closed below the hardened release", () => {
    expect(assessX402HlRelease("0.2.1").fundedSettlementEnabled).toBe(false);
    expect(assessX402HlRelease("0.2.2").fundedSettlementEnabled).toBe(true);
    expect(assessX402HlRelease("0.2.2-rc.1").fundedSettlementEnabled).toBe(
      false
    );
  });

  test("constructs quotes on 0.2.1 but never reaches a paid dependency", async () => {
    const events: string[] = [];
    const harness = createHarness(events, "0.2.1");
    const quote = harness.createQuote();

    expect(quote.paymentRequired.accepts).toHaveLength(1);
    expect(quote.paymentRequirements.asset).toBe(
      X402_HYPERCORE_TESTNET_USDC_ASSET
    );

    await expect(
      harness.layer.settleAndExecute({
        quote,
        paymentPayload: await paymentPayload(quote)
      })
    ).rejects.toBeInstanceOf(UnsafeX402RuntimeError);
    expect(events).toEqual([]);
  });
});

describe("HyperCore settlement disposition", () => {
  test("defaults post-submit and unknown dependency failures to uncertain", () => {
    for (const errorReason of [
      "hl_exchange_error",
      "hl_transfer_not_confirmed",
      "hl_tx_unconfirmed",
      "future_dependency_failure",
      "",
    ]) {
      expect(
        classifyHyperCoreSettlement({
          success: false,
          errorReason,
          transaction: "",
          network: X402_HYPERLIQUID_TESTNET,
        }),
      ).toBe("uncertain");
    }
  });

  test("recognizes only explicit pre-submit no-transfer failures", () => {
    for (const errorReason of [
      "invalid_exact_hl_payload_signature",
      "invalid_exact_hl_payload_amount_mismatch",
      "payment_expired",
    ]) {
      expect(
        classifyHyperCoreSettlement({
          success: false,
          errorReason,
          transaction: "",
          network: X402_HYPERLIQUID_TESTNET,
        }),
      ).toBe("definitive_failure");
    }
  });
});

describe("HyperCore payment identity", () => {
  test("deduplicates one signed action across mutable x402 envelopes", async () => {
    const quote = createHarness([], "0.2.2").createQuote();
    const left = await paymentPayload(quote);
    const right = structuredClone(left);
    right.extensions = {
      ...(right.extensions ?? {}),
      "untrusted-wrapper-field": { value: "changed" },
    };
    right.accepted = {
      ...right.accepted,
      extra: {
        ...(right.accepted.extra ?? {}),
        "untrusted-wrapper-field": "changed",
      },
    };

    const [leftHashes, rightHashes] = await Promise.all([
      hashHyperCorePaymentAction(left),
      hashHyperCorePaymentAction(right),
    ]);
    expect(leftHashes.paymentPayloadHash).not.toBe(
      rightHashes.paymentPayloadHash
    );
    expect(leftHashes.paymentIdentityHash).toBe(
      rightHashes.paymentIdentityHash
    );
  });

  test("canonicalizes signer and chain encoding without trusting signature text", async () => {
    const quote = createHarness([], "0.2.2").createQuote();
    const original = await paymentPayload(quote);
    const variant = structuredClone(original);
    const exact = variant.payload as {
      action: { signatureChainId: string };
      signature: { r: string; s: string };
      user: string;
    };
    exact.action.signatureChainId = "0x0A4B1";
    exact.signature.r =
      `0x${exact.signature.r.slice(2).toUpperCase()}`;
    exact.signature.s =
      `0x${exact.signature.s.slice(2).toUpperCase()}`;
    exact.user = exact.user.toLowerCase();

    const [originalHashes, variantHashes] = await Promise.all([
      hashHyperCorePaymentAction(original),
      hashHyperCorePaymentAction(variant),
    ]);
    expect(originalHashes.paymentPayloadHash).not.toBe(
      variantHashes.paymentPayloadHash
    );
    expect(originalHashes.paymentIdentityHash).toBe(
      variantHashes.paymentIdentityHash
    );
  });

  test("rejects a declared user or duplicate nonce outside the signed action", async () => {
    const quote = createHarness([], "0.2.2").createQuote();
    const userSpoof = await paymentPayload(quote);
    (userSpoof.payload as { user: string }).user = OTHER;
    await expect(hashHyperCorePaymentAction(userSpoof)).rejects.toThrow(
      "declared user"
    );

    const nonceSpoof = await paymentPayload(quote);
    (nonceSpoof.payload as { nonce: number }).nonce += 1;
    await expect(hashHyperCorePaymentAction(nonceSpoof)).rejects.toThrow(
      "nonces differ"
    );
  });
});

describe("x402 quote construction", () => {
  test("persists one exact testnet option and binds payer=recipient=refund", () => {
    const harness = createHarness([], "0.2.2");
    const quote = harness.createQuote();

    expect(quote.intent.chainId).toBe(X402_HYPEREVM_TESTNET_CHAIN_ID);
    expect(quote.intent.user).toBe(PAYER);
    expect(quote.intent.recipient).toBe(PAYER);
    expect(quote.intent.refundAddress).toBe(PAYER);
    expect(quote.paymentRequired.accepts).toEqual([
      quote.paymentRequirements
    ]);
    expect(
      isPaymentIdentifierRequired(
        quote.paymentRequired.extensions?.[PAYMENT_IDENTIFIER]
      )
    ).toBe(true);
    expect(quote.paymentRequirements.extra?.paymentIdentifierHash).toBe(
      hashIntentText(quote.paymentId)
    );
    expect(quote.intent.metadata?.paymentIdentifierHash).toBe(
      hashIntentText(quote.paymentId)
    );
    expect(quote.paymentRequirements.extra?.paymentIdHash).toBeUndefined();
    expect(quote.intent.metadata?.paymentIdHash).toBeUndefined();
    expect(quote.paymentRequirements).toMatchObject({
      scheme: "exact",
      network: X402_HYPERLIQUID_TESTNET,
      asset: X402_HYPERCORE_TESTNET_USDC_ASSET,
      amount: "125000000",
      payTo: PAY_TO,
      extra: {
        decimals: X402_HYPERCORE_USDC_DECIMALS,
        tokenSymbol: "USDC"
      }
    });
  });

  test("rejects a persisted raw payment id that no longer matches its hash commitments", () => {
    const harness = createHarness([], "0.2.2");
    const quote: PersistedX402Quote = {
      ...structuredClone(harness.createQuote()),
      paymentId: "payment-00000002"
    };

    expect(() => harness.layer.paymentRequired(quote)).toThrow(
      "invalid Hyperliquid metadata"
    );
  });

  test("implements the MarketplaceQuoteService payment builder contract", async () => {
    const builder = new X402PaymentQuoteBuilder({
      domain: DOMAIN,
      paymentPayTo: PAY_TO,
      executeResourceUrl: quoteId =>
        `https://router.example/v1/quotes/${quoteId}/execute`,
      now: () => NOW
    });

    const prepared = await builder.build({
      quoteId: "quote-builder-1",
      paymentId: "payment-builder-1",
      payer: PAYER,
      recipient: PAYER,
      refundAddress: PAYER,
      sourceAmount: 125_000_000n,
      target: TARGET,
      callData: "0x12345678",
      chainId: 998,
      maxGasCost: 2_500_000_000_000_000n,
      maxSlippageBps: 50,
      deadline: NOW + 120,
      kind: "amm_swap",
      metadata: { boardroom: TARGET }
    });

    expect(prepared.intentQuote.intent.recipient).toBe(PAYER);
    expect(prepared.paymentRequired.accepts).toEqual([
      prepared.paymentRequirements
    ]);
    expect(prepared.intentTemplateHash).toBe(
      prepared.intentQuote.intentTemplateHash
    );
  });
});

describe("x402 safe settlement orchestration", () => {
  test("journals exact signed terms before settlement and result before execution", async () => {
    const events: string[] = [];
    const harness = createHarness(events, "0.2.2");
    const quote = harness.createQuote();
    harness.setQuote(quote);
    const payload = await paymentPayload(quote);

    const result = await harness.layer.settleAndExecute({
      quote,
      paymentPayload: payload
    });

    expect(events).toEqual([
      "intent:verify",
      "facilitator:verify",
      "journal:prepare",
      "facilitator:settle",
      "journal:record",
      "executor:execute"
    ]);
    expect(result.settlement.transaction).toBe(PAYMENT_TX.toLowerCase());
    expect(result.execution.paymentTransaction).toBe(
      PAYMENT_TX.toLowerCase()
    );
    expect(harness.prepared?.paymentPayload).toEqual(payload);
    expect(harness.prepared?.paymentRequirements).toEqual(
      quote.paymentRequirements
    );
  });

  test("replays a journaled successful settlement without moving funds twice", async () => {
    const events: string[] = [];
    const harness = createHarness(events, "0.2.2");
    const quote = harness.createQuote();
    harness.setQuote(quote);
    harness.seedSettled(quote);

    const result = await harness.layer.settleAndExecute({
      quote,
      paymentPayload: await paymentPayload(quote)
    });

    expect(result.execution.status).toBe("executed");
    expect(events).toEqual([
      "intent:verify",
      "facilitator:verify",
      "journal:prepare",
      "executor:execute"
    ]);
  });

  test("rejects a changed selected requirement before verification or journaling", async () => {
    const events: string[] = [];
    const harness = createHarness(events, "0.2.2");
    const quote = harness.createQuote();
    harness.setQuote(quote);
    const payload = await paymentPayload(quote);
    payload.accepted.amount = "125000001";

    await expect(
      harness.layer.settleAndExecute({ quote, paymentPayload: payload })
    ).rejects.toMatchObject({
      code: "invalid_payment_payload",
      paymentMoved: false
    } satisfies Partial<X402PaymentError>);
    expect(events).toEqual([]);
  });

  test("rejects a missing payment identifier before intent or facilitator verification", async () => {
    const events: string[] = [];
    const harness = createHarness(events, "0.2.2");
    const quote = harness.createQuote();
    harness.setQuote(quote);
    const payload = await paymentPayload(quote);
    delete payload.extensions?.[PAYMENT_IDENTIFIER];

    await expect(
      harness.layer.settleAndExecute({ quote, paymentPayload: payload })
    ).rejects.toMatchObject({
      code: "invalid_payment_payload",
      phase: "pre_settlement",
      paymentMoved: false
    } satisfies Partial<X402PaymentError>);
    expect(events).toEqual([]);
  });

  test("rejects a different raw payment identifier before intent or facilitator verification", async () => {
    const events: string[] = [];
    const harness = createHarness(events, "0.2.2");
    const quote = harness.createQuote();
    harness.setQuote(quote);
    const payload = await paymentPayload(quote);
    appendPaymentIdentifierToExtensions(
      payload.extensions!,
      "payment-00000002"
    );

    await expect(
      harness.layer.settleAndExecute({ quote, paymentPayload: payload })
    ).rejects.toMatchObject({
      code: "invalid_payment_payload",
      phase: "pre_settlement",
      paymentMoved: false
    } satisfies Partial<X402PaymentError>);
    expect(events).toEqual([]);
  });

  test("rejects a malformed payment identifier before intent or facilitator verification", async () => {
    const events: string[] = [];
    const harness = createHarness(events, "0.2.2");
    const quote = harness.createQuote();
    harness.setQuote(quote);
    const payload = await paymentPayload(quote);
    const extension = payload.extensions?.[PAYMENT_IDENTIFIER] as {
      info: { id?: string };
    };
    extension.info.id = "too-short";

    await expect(
      harness.layer.settleAndExecute({ quote, paymentPayload: payload })
    ).rejects.toMatchObject({
      code: "invalid_payment_payload",
      phase: "pre_settlement",
      paymentMoved: false
    } satisfies Partial<X402PaymentError>);
    expect(events).toEqual([]);
  });

  test("rejects a facilitator payer mismatch before the durable settlement boundary", async () => {
    const events: string[] = [];
    const harness = createHarness(events, "0.2.2", OTHER);
    const quote = harness.createQuote();
    harness.setQuote(quote);

    await expect(
      harness.layer.settleAndExecute({
        quote,
        paymentPayload: await paymentPayload(quote)
      })
    ).rejects.toMatchObject({
      code: "facilitator_verification_failed",
      paymentMoved: false
    } satisfies Partial<X402PaymentError>);
    expect(events).toEqual(["intent:verify", "facilitator:verify"]);
  });

  test("keeps ambiguous facilitator failures nonterminal with their complete receipt", async () => {
    for (const errorReason of [
      "hl_exchange_error",
      "hl_transfer_not_confirmed",
      "future_dependency_failure",
    ]) {
      const events: string[] = [];
      const settlement: SettleResponse = {
        success: false,
        errorReason,
        transaction: "",
        network: X402_HYPERLIQUID_TESTNET,
        payer: PAYER,
      };
      const harness = createHarness(events, "0.2.2", PAYER, settlement);
      const quote = harness.createQuote();
      await expect(
        harness.layer.settleAndExecute({
          quote,
          paymentPayload: await paymentPayload(quote),
        })
      ).rejects.toMatchObject({
        code: "settlement_uncertain",
        paymentMoved: "unknown",
        settlement,
      } satisfies Partial<X402PaymentError>);
      expect(harness.prepared).toMatchObject({
        status: "prepared",
        settlement,
      });
    }
  });
});

function createHarness(
  events: string[],
  installedVersion: string,
  facilitatorPayer = PAYER,
  settlementResult?: SettleResponse
) {
  let currentQuote: PersistedX402Quote | undefined;
  let prepared: X402SettlementJournalRecord | undefined;
  let seededSettlement: SettleResponse | undefined;

  const journal: X402SettlementJournal = {
    async lookup(input) {
      if (
        prepared?.quoteId === input.quoteId &&
        prepared.paymentPayloadHash === input.paymentPayloadHash
      ) {
        return prepared;
      }
      return undefined;
    },
    async lookupByQuoteId(quoteId) {
      return prepared?.quoteId === quoteId ? prepared : undefined;
    },
    async prepare(input) {
      events.push("journal:prepare");
      if (prepared) return prepared;
      prepared = {
        attemptId: input.paymentIdentityHash,
        quoteId: input.quoteId,
        paymentId: input.paymentId,
        paymentIdentityHash: input.paymentIdentityHash,
        paymentPayloadHash: input.paymentPayloadHash,
        paymentRequirementsHash: input.paymentRequirementsHash,
        paymentPayload: structuredClone(input.paymentPayload),
        paymentRequirements: structuredClone(input.paymentRequirements),
        status: seededSettlement ? "settled" : "prepared",
        ...(seededSettlement ? { settlement: seededSettlement } : {})
      };
      return prepared;
    },
    async recordResult(input) {
      events.push("journal:record");
      if (!prepared) throw new Error("prepare must happen first");
      const disposition = classifyHyperCoreSettlement(input.settlement);
      prepared = {
        ...prepared,
        status:
          disposition === "confirmed_success"
            ? "settled"
            : disposition === "definitive_failure"
              ? "failed"
              : "prepared",
        settlement: structuredClone(input.settlement)
      };
      return prepared;
    }
  };

  const layer = createX402ServerLayer({
    domain: DOMAIN,
    paymentPayTo: PAY_TO,
    installedX402HlVersion: installedVersion,
    now: () => NOW,
    settlementJournal: journal,
    facilitator: {
      async verify() {
        events.push("facilitator:verify");
        return { isValid: true, payer: facilitatorPayer };
      },
      async settle(_payload, requirements) {
        events.push("facilitator:settle");
        return settlementResult ?? successfulSettlement(requirements);
      }
    },
    executor: {
      async verifyBeforeSettlement(): Promise<PreSettlementIntentVerificationResult> {
        events.push("intent:verify");
        if (!currentQuote) throw new Error("quote not installed in harness");
        return {
          ok: true,
          intent: currentQuote.intent,
          intentHash: INTENT_HASH,
          intentTemplateHash: currentQuote.intentTemplateHash,
          paymentRequirementsHash: currentQuote.paymentRequirementsHash,
          signer: PAYER,
          paymentPayer: PAYER
        };
      },
      async execute(input) {
        events.push("executor:execute");
        if (!currentQuote) throw new Error("quote not installed in harness");
        return executionRecord(currentQuote, input.settleResponse);
      }
    }
  });

  return {
    layer,
    get prepared() {
      return prepared;
    },
    setQuote(quote: PersistedX402Quote) {
      currentQuote = quote;
    },
    seedSettled(quote: PersistedX402Quote) {
      seededSettlement = successfulSettlement(quote.paymentRequirements);
      prepared = undefined;
    },
    createQuote() {
      const quote = layer.createQuote({
        id: "quote-1",
        paymentId: "payment-00000001",
        resourceUrl: "https://router.example/v1/quotes/quote-1/execute",
        payer: PAYER,
        target: TARGET,
        callData: "0x12345678",
        paymentAmountAtomic: "125000000",
        maxGasCost: "2500000000000000",
        maxSlippageBps: 50,
        deadline: NOW + 300,
        nonce: "quote-1:intent",
        metadata: { operation: "amm_swap" }
      });
      currentQuote = quote;
      return quote;
    }
  };
}

async function paymentPayload(
  quote: PersistedX402Quote
): Promise<PaymentPayload> {
  const extensions = structuredClone(quote.paymentRequired.extensions ?? {});
  appendPaymentIdentifierToExtensions(extensions, quote.paymentId);
  const created = await new ExactHyperliquidClient(
    PAYER_ACCOUNT
  ).createPaymentPayload(2, quote.paymentRequirements);
  return {
    ...created,
    accepted: structuredClone(quote.paymentRequirements),
    extensions
  };
}

function successfulSettlement(
  requirements: PaymentRequirements
): SettleResponse & { success: true } {
  return {
    success: true,
    transaction: ` ${PAYMENT_TX} `,
    network: X402_HYPERLIQUID_TESTNET,
    payer: PAYER,
    amount: requirements.amount
  };
}

function executionRecord(
  quote: PersistedX402Quote,
  settlement: SettleResponse
): IntentExecutionRecord {
  const now = new Date(NOW * 1_000).toISOString();
  return {
    version: 2,
    revision: 3,
    status: "executed",
    intentHash: hashExecutionIntent(quote.intent, {
      paymentRequirementsHash: quote.paymentRequirementsHash
    }),
    intentTemplateHash: quote.intentTemplateHash,
    paymentRequirementsHash: quote.paymentRequirementsHash,
    quoteId: quote.id,
    application: quote.intent.application,
    gateway: quote.intent.gateway,
    payer: PAYER,
    paymentScheme: "exact",
    paymentNetwork: X402_HYPERLIQUID_TESTNET,
    paymentAsset: X402_HYPERCORE_TESTNET_USDC_ASSET,
    paymentAmount: quote.paymentRequirements.amount,
    paymentPayTo: PAY_TO,
    paymentTransaction: settlement.transaction.trim().toLowerCase(),
    executionNetwork: "eip155:998",
    executionTransaction: `0x${"cd".repeat(32)}`,
    executionAttempts: 1,
    refundAttempts: 0,
    createdAt: now,
    updatedAt: now,
    intent: quote.intent
  };
}
