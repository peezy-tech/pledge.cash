import type { PaymentPayload, SettleResponse } from "@x402/core/types";
import { ExactHyperliquidPayloadSchema } from "x402-hl";
import { stableJson } from "x402-hl/intents";
import {
  X402SettlementIdentityConflictError,
  type X402SettlementJournal,
  type X402SettlementJournalRecord,
} from "../x402";
import type {
  AdapterOperationRecord,
  PostgresAdapterOperationStore,
} from "../db";
import type { QuotePaymentBinding, QuoteRepository } from "../domain";
import { classifyHyperCoreSettlement } from "./hypercore-settlement";

type StoredSettlementPayload = {
  quoteId: string;
  paymentId: string;
  paymentIdentityHash: `0x${string}`;
  paymentPayloadHash: `0x${string}`;
  paymentRequirementsHash: `0x${string}`;
  paymentPayload: PaymentPayload;
  paymentRequirements: X402SettlementJournalRecord["paymentRequirements"];
};

export class DurableX402SettlementJournal implements X402SettlementJournal {
  constructor(
    private readonly operations: PostgresAdapterOperationStore,
    private readonly quotes: QuoteRepository,
    private readonly leaseMs: number,
  ) {}

  async lookup(
    input: Parameters<X402SettlementJournal["lookup"]>[0],
  ): Promise<X402SettlementJournalRecord | undefined> {
    const binding = await this.quotes.getPaymentBinding(input.quoteId);
    if (
      !binding ||
      binding.paymentPayloadHash.toLowerCase() !==
        input.paymentPayloadHash.toLowerCase()
    ) {
      return undefined;
    }
    const operation = await this.operations.get(
      "payment_settlement",
      binding.attemptId,
    );
    if (!operation) return undefined;
    const record = await this.toJournalRecord(operation);
    this.assertBindingRecord(record, binding);
    return record;
  }

  async lookupByQuoteId(
    quoteId: string,
  ): Promise<X402SettlementJournalRecord | undefined> {
    const binding = await this.quotes.getPaymentBinding(quoteId);
    if (!binding) return undefined;
    const operation = await this.operations.get(
      "payment_settlement",
      binding.attemptId,
    );
    if (!operation) return undefined;
    const record = await this.toJournalRecord(operation);
    this.assertBindingRecord(record, binding);
    return record;
  }

  async prepare(
    input: Parameters<X402SettlementJournal["prepare"]>[0],
  ): Promise<X402SettlementJournalRecord> {
    const exact = ExactHyperliquidPayloadSchema.parse(input.paymentPayload.payload);
    const idempotencyKey = input.paymentIdentityHash.toLowerCase();
    const claim = await this.operations.claim({
      kind: "payment_settlement",
      idempotencyKey,
      requestHash: input.paymentPayloadHash,
      network: input.paymentRequirements.network,
      signer: exact.user,
      leaseMs: this.leaseMs,
    });
    if (claim.kind === "conflict") {
      throw new X402SettlementIdentityConflictError(
        "Payment settlement journal identity is bound to another envelope.",
      );
    }

    let operation = claim.operation;
    if (
      claim.kind === "existing" &&
      operation.status !== "confirmed_success" &&
      operation.status !== "confirmed_failure" &&
      operation.status !== "manual_intervention"
    ) {
      throw new Error("Payment settlement journal attempt is still leased.");
    }
    if (operation.status === "claimed") {
      if (claim.kind !== "claimed") {
        throw new Error("Payment settlement journal is currently being prepared.");
      }
      const stored: StoredSettlementPayload = {
        quoteId: input.quoteId,
        paymentId: input.paymentId,
        paymentIdentityHash: input.paymentIdentityHash,
        paymentPayloadHash: input.paymentPayloadHash,
        paymentRequirementsHash: input.paymentRequirementsHash,
        paymentPayload: input.paymentPayload,
        paymentRequirements: input.paymentRequirements,
      };
      const signed = await this.operations.recordSigned({
        kind: "payment_settlement",
        idempotencyKey,
        expectedRevision: operation.revision,
        leaseToken: operation.leaseToken,
        payload: JSON.stringify(stored),
      });
      if (signed.kind !== "updated") {
        throw new Error("Payment settlement journal prepare lost its claim.");
      }
      operation = signed.operation;
    }

    const record = await this.toJournalRecord(operation);
    if (
      record.quoteId !== input.quoteId ||
      record.paymentId !== input.paymentId ||
      record.attemptId.toLowerCase() !==
        input.paymentIdentityHash.toLowerCase() ||
      record.paymentIdentityHash.toLowerCase() !==
        input.paymentIdentityHash.toLowerCase() ||
      record.paymentPayloadHash.toLowerCase() !==
        input.paymentPayloadHash.toLowerCase() ||
      record.paymentRequirementsHash.toLowerCase() !==
        input.paymentRequirementsHash.toLowerCase() ||
      stableJson(record.paymentPayload) !== stableJson(input.paymentPayload) ||
      stableJson(record.paymentRequirements) !==
        stableJson(input.paymentRequirements)
    ) {
      throw new X402SettlementIdentityConflictError(
        "Payment settlement journal identity is bound to different signed terms.",
      );
    }
    if (operation.status === "manual_intervention") {
      throw new Error("Payment settlement journal requires manual intervention.");
    }
    try {
      await this.quotes.bindPaymentPayload({
        quoteId: record.quoteId,
        attemptId: record.attemptId as `0x${string}`,
        paymentPayloadHash: record.paymentPayloadHash,
        paymentRequirementsHash: record.paymentRequirementsHash,
      });
    } catch (error) {
      if (
        claim.kind === "claimed" &&
        (operation.status === "signed" || operation.status === "submitted")
      ) {
        await this.operations.markManualIntervention({
          kind: "payment_settlement",
          idempotencyKey,
          expectedRevision: operation.revision,
          leaseToken: operation.leaseToken,
          from: operation.status,
          failureCode: "quote_payment_binding_failed",
          ...(operation.transactionHash
            ? { transactionHash: operation.transactionHash }
            : {}),
        });
      }
      throw error;
    }
    return record;
  }

  async recordResult(
    input: Parameters<X402SettlementJournal["recordResult"]>[0],
  ): Promise<X402SettlementJournalRecord> {
    const idempotencyKey = input.attemptId;
    let operation = await this.operations.get(
      "payment_settlement",
      idempotencyKey,
    );
    if (!operation) {
      throw new Error("Payment settlement journal entry was not found.");
    }
    if (
      operation.requestHash.toLowerCase() !==
      input.paymentPayloadHash.toLowerCase()
    ) {
      throw new Error("Payment settlement journal payload hash conflicted.");
    }

    if (operation.status === "signed") {
      const submitted = await this.operations.recordSubmitted({
        kind: "payment_settlement",
        idempotencyKey,
        expectedRevision: operation.revision,
        leaseToken: operation.leaseToken,
        ...(input.settlement.transaction
          ? { transactionHash: input.settlement.transaction }
          : {}),
      });
      if (submitted.kind !== "updated") {
        operation = submitted.kind === "not_found"
          ? operation
          : submitted.operation;
      } else {
        operation = submitted.operation;
      }
    }

    if (operation.status === "submitted") {
      const disposition = classifyHyperCoreSettlement(input.settlement);
      const outcome =
        disposition === "uncertain"
          ? await this.operations.recordUncertainResult({
              kind: "payment_settlement",
              idempotencyKey,
              expectedRevision: operation.revision,
              leaseToken: operation.leaseToken,
              receipt: settlementReceipt(input.settlement),
              failureCode:
                input.settlement.errorReason ||
                "unclassified_settlement_failure",
            })
          : await this.operations.recordOutcome({
              kind: "payment_settlement",
              idempotencyKey,
              expectedRevision: operation.revision,
              leaseToken: operation.leaseToken,
              outcome:
                disposition === "confirmed_success"
                  ? "confirmed_success"
                  : "confirmed_failure",
              ...(input.settlement.transaction
                ? { transactionHash: input.settlement.transaction }
                : {}),
              receipt: settlementReceipt(input.settlement),
              ...(!input.settlement.success && input.settlement.errorReason
                ? { failureCode: input.settlement.errorReason }
                : {}),
            });
      if (outcome.kind !== "updated") {
        throw new Error("Payment settlement journal outcome conflicted.");
      }
      operation = outcome.operation;
    }

    const record = await this.toJournalRecord(operation);
    if (record.status === "failed") {
      await this.quotes.finalizeSettlementFailure(record.quoteId);
    }
    return record;
  }

  private assertBindingRecord(
    record: X402SettlementJournalRecord,
    binding: QuotePaymentBinding,
  ): void {
    if (
      record.quoteId !== binding.quoteId ||
      record.attemptId.toLowerCase() !== binding.attemptId.toLowerCase() ||
      record.paymentIdentityHash.toLowerCase() !==
        binding.attemptId.toLowerCase() ||
      record.paymentPayloadHash.toLowerCase() !==
        binding.paymentPayloadHash.toLowerCase() ||
      record.paymentRequirementsHash.toLowerCase() !==
        binding.paymentRequirementsHash.toLowerCase()
    ) {
      throw new Error("Payment settlement binding does not match its journal.");
    }
  }

  private async toJournalRecord(
    operation: AdapterOperationRecord,
  ): Promise<X402SettlementJournalRecord> {
    const encoded = await this.operations.loadPayload(
      "payment_settlement",
      operation.idempotencyKey,
    );
    if (!encoded) {
      throw new Error("Payment settlement journal is missing its sealed payload.");
    }
    const stored = JSON.parse(encoded) as StoredSettlementPayload;
    const settlement = operation.receipt
      ? settlementFromReceipt(operation.receipt)
      : undefined;
    return {
      attemptId: operation.idempotencyKey,
      quoteId: stored.quoteId,
      paymentId: stored.paymentId,
      paymentIdentityHash: stored.paymentIdentityHash,
      paymentPayloadHash: stored.paymentPayloadHash,
      paymentRequirementsHash: stored.paymentRequirementsHash,
      paymentPayload: stored.paymentPayload,
      paymentRequirements: stored.paymentRequirements,
      status:
        operation.status === "confirmed_success"
          ? "settled"
          : operation.status === "confirmed_failure"
            ? "failed"
            : "prepared",
      ...(settlement === undefined ? {} : { settlement }),
    };
  }
}

function settlementReceipt(settlement: SettleResponse) {
  return JSON.parse(JSON.stringify(settlement)) as Record<
    string,
    string | number | boolean | null
  >;
}

function settlementFromReceipt(
  receipt: Record<string, unknown>,
): SettleResponse {
  if (
    typeof receipt.success !== "boolean" ||
    typeof receipt.transaction !== "string" ||
    typeof receipt.network !== "string"
  ) {
    throw new Error("Stored payment settlement receipt is malformed.");
  }
  return receipt as SettleResponse;
}
