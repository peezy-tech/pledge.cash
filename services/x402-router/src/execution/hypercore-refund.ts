import { SendAssetTypes } from "@nktkas/hyperliquid/api/exchange";
import { signUserSignedAction } from "@nktkas/hyperliquid/signing";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import {
  getAddress,
  keccak256,
  stringToBytes,
  toHex,
  type Address,
  type Hex,
  type PrivateKeyAccount,
} from "viem";
import { arbitrum } from "viem/chains";
import { ExactHyperliquidPayloadSchema } from "x402-hl";
import { stableJson } from "x402-hl/intents";
import type {
  IntentExecutionRecord,
  IntentRefundContext,
  IntentRefundResult,
} from "x402-hl/intents/server";
import type {
  AdapterOperationRecord,
  PostgresAdapterOperationStore,
} from "../db";
import type { QuoteRepository } from "../domain";
import {
  HYPERCORE_TESTNET,
  HYPERCORE_USDC_DECIMALS,
} from "../domain";
import type { X402Facilitator } from "../x402";
import { canonicalizeX402TransactionIdentifier } from "../x402";
import { classifyHyperCoreSettlement } from "./hypercore-settlement";

type StoredRefund = {
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
  quoteId: string;
  signerNonce: string;
};

export type HyperCoreRefundReconciliationResult =
  | {
      status: "confirmed_success";
      transaction: string;
      network: string;
    }
  | { status: "confirmed_failure" }
  | { status: "pending" }
  | { status: "manual_intervention" };

export class DurableHyperCoreRefundAdapter {
  private readonly signerAddress: Address;

  constructor(
    private readonly signer: PrivateKeyAccount,
    signerAddress: Address,
    private readonly facilitator: X402Facilitator,
    private readonly operations: PostgresAdapterOperationStore,
    private readonly quotes: QuoteRepository,
    private readonly leaseMs: number,
    private readonly nowMilliseconds: () => number = () => Date.now(),
  ) {
    this.signerAddress = getAddress(signerAddress);
    if (getAddress(signer.address) !== this.signerAddress) {
      throw new Error("HyperCore refund signer does not match its configured address");
    }
  }

  readonly refund = async (
    context: IntentRefundContext,
  ): Promise<IntentRefundResult> => this.driveRefund(context);

  /**
   * Reclaims only the durable operation for the intent's current refund
   * attempt. It never increments refundAttempts or creates a replacement
   * action, so every retry replays the exact sealed sendAsset payload.
   */
  async reconcileSubmitted(
    record: IntentExecutionRecord,
  ): Promise<HyperCoreRefundReconciliationResult> {
    if (record.status !== "refund_submitted") {
      return { status: "manual_intervention" };
    }
    const result = await this.driveRefund({
      intent: record.intent,
      record,
      idempotencyKey: refundIdempotencyKey(record),
    });
    if (result.success) {
      return {
        status: "confirmed_success",
        transaction: result.transaction,
        network: result.network,
      };
    }

    const operation = await this.operations.get(
      "refund",
      refundAttemptKey({
        intent: record.intent,
        record,
        idempotencyKey: refundIdempotencyKey(record),
      }),
    );
    if (operation?.status === "confirmed_failure") {
      return { status: "confirmed_failure" };
    }
    if (operation?.status === "manual_intervention") {
      return { status: "manual_intervention" };
    }
    return { status: "pending" };
  }

  private async driveRefund(
    context: IntentRefundContext,
  ): Promise<IntentRefundResult> {
    const requirements = refundRequirements(context);
    const operationKey = refundAttemptKey(context);
    const requestHash = refundRequestHash(context, requirements);
    const claim = await this.operations.claim({
      kind: "refund",
      idempotencyKey: operationKey,
      requestHash,
      network: HYPERCORE_TESTNET,
      signer: this.signerAddress,
      leaseMs: this.leaseMs,
    });
    if (claim.kind === "conflict") {
      return { success: false, retryable: false, mayHaveSucceeded: true };
    }

    let operation = claim.operation;
    const terminal = await this.terminalResult(operation, context);
    if (terminal) return terminal;
    if (claim.kind === "existing") {
      // A nonterminal existing result still has a live lease. Do not race its
      // facilitator call even though replaying the payload is idempotent.
      return { success: false, retryable: false, mayHaveSucceeded: true };
    }

    let stored: StoredRefund;
    if (operation.status === "claimed") {
      const now = this.nowMilliseconds();
      if (!Number.isSafeInteger(now) || now <= 0) {
        await this.operations.recordUnsubmittedRefundFailure({
          idempotencyKey: operationKey,
          expectedRevision: operation.revision,
          leaseToken: operation.leaseToken,
          failureCode: "refund_nonce_clock_invalid",
        });
        return { success: false, retryable: false, mayHaveSucceeded: false };
      }
      const signed = await this.operations.recordSignedWithSignerNonce({
        kind: "refund",
        idempotencyKey: operationKey,
        expectedRevision: operation.revision,
        leaseToken: operation.leaseToken,
        minimumNonce: BigInt(now),
        signingFailureCode: "refund_signing_failed",
        createSignedPayload: async signerNonce => {
          const paymentPayload = await this.createPaymentPayload(
            requirements,
            signerNonce,
          );
          const candidate: StoredRefund = {
            paymentPayload,
            paymentRequirements: requirements,
            quoteId: context.record.quoteId,
            signerNonce: signerNonce.toString(),
          };
          return { payload: JSON.stringify(candidate) };
        },
      });
      if (signed.kind !== "updated") {
        return {
          success: false,
          retryable: signed.kind === "signing_failed",
          mayHaveSucceeded: false,
        };
      }
      operation = signed.operation;
    }

    const encoded = await this.operations.loadPayload("refund", operationKey);
    if (!encoded) {
      await this.markManual(
        operation,
        operationKey,
        "refund_payload_missing",
      );
      return { success: false, retryable: false, mayHaveSucceeded: true };
    }
    try {
      stored = JSON.parse(encoded) as StoredRefund;
    } catch {
      await this.markManual(
        operation,
        operationKey,
        "refund_payload_malformed",
      );
      return { success: false, retryable: false, mayHaveSucceeded: true };
    }

    if (
      !refundPayloadMatches(
        stored,
        requirements,
        context.record.quoteId,
        operation,
        this.signerAddress,
      )
    ) {
      await this.markManual(operation, operationKey, "refund_payload_mismatch");
      return { success: false, retryable: false, mayHaveSucceeded: true };
    }

    if (operation.status === "signed") {
      const submitted = await this.operations.recordSubmitted({
        kind: "refund",
        idempotencyKey: operationKey,
        expectedRevision: operation.revision,
        leaseToken: operation.leaseToken,
      });
      if (submitted.kind !== "updated") {
        return { success: false, retryable: false, mayHaveSucceeded: true };
      }
      operation = submitted.operation;
    }

    try {
      const verification = await this.facilitator.verify(
        stored.paymentPayload,
        stored.paymentRequirements,
      );
      if (
        !verification.isValid ||
        !verification.payer ||
        getAddress(verification.payer) !== this.signerAddress
      ) {
        const failed = await this.operations.recordOutcome({
          kind: "refund",
          idempotencyKey: operationKey,
          expectedRevision: operation.revision,
          leaseToken: operation.leaseToken,
          outcome: "confirmed_failure",
          failureCode:
            verification.invalidReason || "refund_preflight_failed",
          receipt: jsonObject(verification),
        });
        return failed.kind === "updated"
          ? { success: false, retryable: true, mayHaveSucceeded: false }
          : { success: false, retryable: false, mayHaveSucceeded: true };
      }

      const settlement = await this.facilitator.settle(
        stored.paymentPayload,
        stored.paymentRequirements,
      );
      const disposition = classifyHyperCoreSettlement(settlement);
      if (disposition === "uncertain") {
        const uncertain = await this.operations.recordUncertainResult({
          kind: "refund",
          idempotencyKey: operationKey,
          expectedRevision: operation.revision,
          leaseToken: operation.leaseToken,
          failureCode:
            settlement.errorReason || "unclassified_refund_failure",
          receipt: jsonObject(settlement),
        });
        return uncertain.kind === "updated"
          ? { success: false, retryable: false, mayHaveSucceeded: true }
          : { success: false, retryable: false, mayHaveSucceeded: true };
      }
      if (disposition === "definitive_failure") {
        const failed = await this.operations.recordOutcome({
          kind: "refund",
          idempotencyKey: operationKey,
          expectedRevision: operation.revision,
          leaseToken: operation.leaseToken,
          outcome: "confirmed_failure",
          failureCode: settlement.errorReason || "refund_failed",
          receipt: jsonObject(settlement),
        });
        return failed.kind === "updated"
          ? { success: false, retryable: true, mayHaveSucceeded: false }
          : { success: false, retryable: false, mayHaveSucceeded: true };
      }

      return await this.recordConfirmedRefund(
        context,
        operation,
        operationKey,
        settlement,
      );
    } catch {
      const uncertain = await this.operations.recordUncertainResult({
        kind: "refund",
        idempotencyKey: operationKey,
        expectedRevision: operation.revision,
        leaseToken: operation.leaseToken,
        failureCode: "refund_settlement_uncertain",
        receipt: {
          success: false,
          errorReason: "refund_settlement_uncertain",
          network: HYPERCORE_TESTNET,
        },
      });
      return uncertain.kind === "updated"
        ? { success: false, retryable: false, mayHaveSucceeded: true }
        : { success: false, retryable: false, mayHaveSucceeded: true };
    }
  }

  private async terminalResult(
    operation: AdapterOperationRecord,
    context: IntentRefundContext,
  ): Promise<IntentRefundResult | undefined> {
    if (operation.status === "confirmed_success" && operation.transactionHash) {
      if (!context.record.duplicatePayment) {
        await this.quotes.finalizeRefund(context.record.quoteId);
      }
      return {
        success: true,
        confirmed: true,
        transaction: operation.transactionHash,
        network: HYPERCORE_TESTNET,
      };
    }
    if (operation.status === "confirmed_failure") {
      return { success: false, retryable: true, mayHaveSucceeded: false };
    }
    if (operation.status === "manual_intervention") {
      return { success: false, retryable: false, mayHaveSucceeded: true };
    }
    return undefined;
  }

  private async createPaymentPayload(
    requirements: PaymentRequirements,
    signerNonce: bigint,
  ): Promise<PaymentPayload> {
    if (signerNonce < 0n || signerNonce > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("HyperCore refund nonce is outside the safe integer range");
    }
    const nonce = Number(signerNonce);
    const action = {
      type: "sendAsset" as const,
      signatureChainId: toHex(arbitrum.id),
      hyperliquidChain: "Testnet" as const,
      destination: getAddress(requirements.payTo),
      sourceDex: "spot" as const,
      destinationDex: "spot" as const,
      token: requirements.asset,
      amount: formatDecimalAmount(
        requirements.amount,
        HYPERCORE_USDC_DECIMALS,
      ),
      fromSubAccount: "" as const,
      nonce,
    };
    const signature = await signUserSignedAction({
      wallet: this.signer,
      action,
      types: SendAssetTypes,
    });
    const payload = ExactHyperliquidPayloadSchema.parse({
      action,
      signature,
      nonce,
      user: this.signerAddress,
    });
    return {
      x402Version: 2,
      payload,
      accepted: requirements,
    };
  }

  private async recordConfirmedRefund(
    context: IntentRefundContext,
    operation: AdapterOperationRecord,
    operationKey: string,
    settlement: Awaited<ReturnType<X402Facilitator["settle"]>>,
  ): Promise<IntentRefundResult> {
    let transaction: string;
    try {
      transaction = canonicalizeX402TransactionIdentifier(
        settlement.transaction,
      );
      if (
        settlement.network !== HYPERCORE_TESTNET ||
        settlement.amount !== context.record.paymentAmount ||
        !settlement.payer ||
        getAddress(settlement.payer) !== this.signerAddress
      ) {
        throw new Error("refund settlement mismatch");
      }
    } catch {
      await this.markManual(
        operation,
        operationKey,
        "refund_receipt_mismatch",
        jsonObject(settlement),
      );
      return { success: false, retryable: false, mayHaveSucceeded: true };
    }

    const confirmed = await this.operations.recordOutcome({
      kind: "refund",
      idempotencyKey: operationKey,
      expectedRevision: operation.revision,
      leaseToken: operation.leaseToken,
      outcome: "confirmed_success",
      transactionHash: transaction,
      receipt: jsonObject(settlement),
    });
    if (confirmed.kind !== "updated") {
      return { success: false, retryable: false, mayHaveSucceeded: true };
    }
    if (!context.record.duplicatePayment) {
      await this.quotes.finalizeRefund(context.record.quoteId);
    }
    return {
      success: true,
      confirmed: true,
      transaction,
      network: HYPERCORE_TESTNET,
    };
  }

  private async markManual(
    operation: AdapterOperationRecord,
    idempotencyKey: string,
    failureCode: string,
    receipt?: Record<string, string | number | boolean | null>,
  ): Promise<void> {
    if (
      operation.status !== "claimed" &&
      operation.status !== "signed" &&
      operation.status !== "submitted"
    ) {
      return;
    }
    await this.operations.markManualIntervention({
      kind: "refund",
      idempotencyKey,
      expectedRevision: operation.revision,
      leaseToken: operation.leaseToken,
      from: operation.status,
      failureCode,
      ...(receipt === undefined ? {} : { receipt }),
    });
  }
}

function refundRequirements(
  context: IntentRefundContext,
): PaymentRequirements {
  return {
    scheme: "exact",
    network: HYPERCORE_TESTNET,
    amount: context.record.paymentAmount,
    asset: context.record.paymentAsset,
    payTo: getAddress(context.intent.refundAddress),
    maxTimeoutSeconds: 300,
    extra: {
      decimals: HYPERCORE_USDC_DECIMALS,
      tokenSymbol: "USDC",
    },
  };
}

function refundRequestHash(
  context: IntentRefundContext,
  requirements: PaymentRequirements,
): Hex {
  return keccak256(
    stringToBytes(
      stableJson({
        idempotencyKey: context.idempotencyKey,
        attempt: context.record.refundAttempts,
        quoteId: context.record.quoteId,
        requirements,
        refundAddress: context.intent.refundAddress,
      }),
    ),
  );
}

function refundAttemptKey(context: IntentRefundContext): string {
  if (
    !Number.isSafeInteger(context.record.refundAttempts) ||
    context.record.refundAttempts <= 0
  ) {
    throw new Error("Refund attempts must be a positive safe integer");
  }
  return `${context.idempotencyKey}:attempt:${context.record.refundAttempts}`;
}

function refundIdempotencyKey(record: IntentExecutionRecord): string {
  return record.duplicatePayment
    ? `${record.intentHash}:refund:${record.paymentNetwork}:${canonicalizeX402TransactionIdentifier(record.paymentTransaction)}`
    : `${record.intentHash}:refund`;
}

function refundPayloadMatches(
  stored: StoredRefund,
  requirements: PaymentRequirements,
  quoteId: string,
  operation: AdapterOperationRecord,
  signerAddress: Address,
): boolean {
  const parsed = ExactHyperliquidPayloadSchema.safeParse(
    stored.paymentPayload?.payload,
  );
  if (!parsed.success || operation.signerNonce === undefined) return false;
  const exact = parsed.data;
  const nonce = operation.signerNonce;
  return (
    stored.quoteId === quoteId &&
    stored.signerNonce === nonce.toString() &&
    BigInt(exact.nonce) === nonce &&
    BigInt(exact.action.nonce) === nonce &&
    getAddress(exact.user) === signerAddress &&
    exact.action.hyperliquidChain === "Testnet" &&
    BigInt(exact.action.signatureChainId) === BigInt(arbitrum.id) &&
    getAddress(exact.action.destination) === getAddress(requirements.payTo) &&
    exact.action.sourceDex === "spot" &&
    exact.action.destinationDex === "spot" &&
    exact.action.token === requirements.asset &&
    exact.action.amount ===
      formatDecimalAmount(requirements.amount, HYPERCORE_USDC_DECIMALS) &&
    exact.action.fromSubAccount === "" &&
    stableJson(stored.paymentRequirements) === stableJson(requirements) &&
    stableJson(stored.paymentPayload.accepted) === stableJson(requirements)
  );
}

function formatDecimalAmount(amount: string, decimals: number): string {
  const atomic = BigInt(amount);
  const divisor = 10n ** BigInt(decimals);
  const whole = atomic / divisor;
  const remainder = atomic % divisor;
  if (remainder === 0n) return whole.toString();
  return `${whole}.${remainder
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "")}`;
}

function jsonObject(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Record<
    string,
    string | number | boolean | null
  >;
}
