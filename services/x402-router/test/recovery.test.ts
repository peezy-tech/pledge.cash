import { describe, expect, test } from "bun:test";
import type { PaymentPayload } from "@x402/core/types";
import type { IntentExecutionRecord } from "x402-hl/intents/server";

import type {
  MarketplaceQuote,
  QuotePaymentBinding,
} from "../src/domain";
import {
  RouterRecoveryWorker,
  safeRecoveryStaleAfterMs,
} from "../src/execution/recovery";

const HASH = `0x${"11".repeat(32)}` as const;

describe("router recovery worker", () => {
  test("never reclaims a live request before its receipt deadline and grace", () => {
    expect(
      safeRecoveryStaleAfterMs({
        operationLeaseMs: 60_000,
        receiptTimeoutMs: 120_000,
      }),
    ).toBe(150_000);
    expect(
      safeRecoveryStaleAfterMs({
        operationLeaseMs: 300_000,
        receiptTimeoutMs: 120_000,
      }),
    ).toBe(300_000);
  });

  test("replays one sealed payment after a crash without moving funds twice", async () => {
    let orderCreated = false;
    let settled = false;
    let fundMovements = 0;
    let calls = 0;
    const binding: QuotePaymentBinding = {
      quoteId: "quote-restart",
      attemptId: HASH,
      paymentPayloadHash: HASH,
      paymentRequirementsHash: HASH,
      boundAt: new Date("2030-01-01T00:00:00.000Z"),
    };
    const quote = { id: binding.quoteId } as MarketplaceQuote;
    const paymentPayload = {
      x402Version: 2,
      accepted: {},
      payload: {},
    } as PaymentPayload;
    const errors: unknown[] = [];

    const options = {
      quotes: {
        async get(id: string) {
          return id === quote.id ? quote : undefined;
        },
        async listPaymentBindingsWithoutOrder() {
          return orderCreated ? [] : [binding];
        },
        async finalizeSettlementFailure() {},
      },
      intents: {
        async listRecoverable() {
          return [];
        },
        async transition() {
          throw new Error("not used");
        },
      },
      journal: {
        async lookupByQuoteId(id: string) {
          return id === quote.id
            ? {
                attemptId: HASH,
                quoteId: quote.id,
                paymentId: "payment-restart",
                paymentIdentityHash: HASH,
                paymentPayloadHash: HASH,
                paymentRequirementsHash: HASH,
                paymentPayload,
                paymentRequirements: {} as never,
                status: settled ? ("settled" as const) : ("prepared" as const),
              }
            : undefined;
        },
      },
      payments: {
        async settleAndExecute() {
          calls += 1;
          if (!settled) {
            settled = true;
            fundMovements += 1;
            throw new Error("simulated crash after durable settlement");
          }
          orderCreated = true;
        },
      },
      executor: unusedExecutor(),
      execution: {
        async reconcileSubmitted() {
          return { status: "pending" as const };
        },
      },
      refund: unusedRefund(),
      staleAfterMs: 1_000,
      now: () => new Date("2030-01-01T00:01:00.000Z"),
      onError({ error }: { error: unknown }) {
        errors.push(error);
      },
    };

    const firstProcess = new RouterRecoveryWorker(options);
    expect(await firstProcess.runOnce()).toMatchObject({
      failed: 1,
      recovered: 0,
    });

    const restartedProcess = new RouterRecoveryWorker(options);
    expect(await restartedProcess.runOnce()).toMatchObject({
      failed: 0,
      recovered: 1,
    });
    expect({ calls, fundMovements, orderCreated, errors: errors.length }).toEqual({
      calls: 2,
      fundMovements: 1,
      orderCreated: true,
      errors: 1,
    });
  });

  test("reconciles a confirmed destination revert before invoking refund recovery", async () => {
    const record = {
      intentHash: HASH,
      quoteId: "quote-revert",
      status: "execution_submitted",
      revision: 3,
      claimToken: "execution-claim",
      duplicatePayment: false,
      paymentNetwork: "hyperliquid:testnet",
      paymentTransaction: `0x${"22".repeat(32)}`,
    } as unknown as IntentExecutionRecord;
    const transitions: Array<{ from: string; to: string }> = [];
    const recovered: string[] = [];
    const worker = new RouterRecoveryWorker({
      quotes: {
        async get() {
          return undefined;
        },
        async listPaymentBindingsWithoutOrder() {
          return [];
        },
        async finalizeSettlementFailure() {},
      },
      intents: {
        async listRecoverable() {
          return [record];
        },
        async transition(input) {
          transitions.push({ from: input.from, to: input.to });
          return {
            kind: "updated",
            record: {
              ...record,
              status: input.to,
              revision: record.revision + 1,
            },
          } as never;
        },
      },
      journal: {
        async lookupByQuoteId() {
          return undefined;
        },
      },
      payments: {
        async settleAndExecute() {
          throw new Error("not used");
        },
      },
      executor: {
        ...unusedExecutor(),
        async recover(intentHash) {
          recovered.push(intentHash);
          return record;
        },
      },
      execution: {
        async reconcileSubmitted() {
          return { status: "confirmed_failure" as const };
        },
      },
      refund: unusedRefund(),
      staleAfterMs: 1_000,
      now: () => new Date("2030-01-01T00:01:00.000Z"),
    });

    expect(await worker.runOnce()).toMatchObject({ recovered: 1, failed: 0 });
    expect(transitions).toEqual([
      { from: "execution_submitted", to: "execution_failed" },
    ]);
    expect(recovered).toEqual([HASH]);
  });

  test("finalizes a confirmed refund operation and compare-and-swaps the parked intent", async () => {
    const record = {
      intentHash: HASH,
      quoteId: "quote-refund-confirmed",
      status: "refund_submitted",
      revision: 7,
      claimToken: "refund-claim",
      duplicatePayment: false,
      paymentNetwork: "hyperliquid:testnet",
      paymentTransaction: `0x${"22".repeat(32)}`,
    } as unknown as IntentExecutionRecord;
    const transitions: Array<Record<string, unknown>> = [];
    const transaction = `0x${"33".repeat(32)}`;
    const worker = new RouterRecoveryWorker({
      quotes: unusedQuotes(),
      intents: {
        async listRecoverable() {
          return [record];
        },
        async transition(input) {
          transitions.push(input as unknown as Record<string, unknown>);
          return {
            kind: "updated",
            record: {
              ...record,
              status: input.to,
              revision: record.revision + 1,
            },
          } as never;
        },
      },
      journal: unusedJournal(),
      payments: unusedPayments(),
      executor: unusedExecutor(),
      execution: unusedExecution(),
      refund: {
        async reconcileSubmitted() {
          return {
            status: "confirmed_success" as const,
            transaction,
            network: "hyperliquid:testnet",
          };
        },
      },
      staleAfterMs: 1_000,
      now: () => new Date("2030-01-01T00:01:00.000Z"),
    });

    expect(await worker.runOnce()).toMatchObject({ recovered: 1, failed: 0 });
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({
      from: "refund_submitted",
      to: "refunded",
      claimToken: "refund-claim",
      patch: {
        refundNetwork: "hyperliquid:testnet",
        refundTransaction: transaction,
      },
    });
  });

  test("releases committed holds for a durably confirmed payment failure", async () => {
    const binding: QuotePaymentBinding = {
      quoteId: "quote-payment-failed",
      attemptId: HASH,
      paymentPayloadHash: HASH,
      paymentRequirementsHash: HASH,
      boundAt: new Date("2030-01-01T00:00:00.000Z"),
    };
    let finalized = 0;
    let settlementCalls = 0;
    const worker = new RouterRecoveryWorker({
      quotes: {
        async get() {
          return { id: binding.quoteId } as MarketplaceQuote;
        },
        async listPaymentBindingsWithoutOrder() {
          return [binding];
        },
        async finalizeSettlementFailure() {
          finalized += 1;
        },
      },
      intents: {
        async listRecoverable() {
          return [];
        },
        async transition() {
          throw new Error("not used");
        },
      },
      journal: {
        async lookupByQuoteId() {
          return {
            attemptId: HASH,
            quoteId: binding.quoteId,
            paymentId: "payment-failed",
            paymentIdentityHash: HASH,
            paymentPayloadHash: HASH,
            paymentRequirementsHash: HASH,
            paymentPayload: {} as PaymentPayload,
            paymentRequirements: {} as never,
            status: "failed" as const,
          };
        },
      },
      payments: {
        async settleAndExecute() {
          settlementCalls += 1;
        },
      },
      executor: unusedExecutor(),
      execution: unusedExecution(),
      refund: unusedRefund(),
      staleAfterMs: 1_000,
      now: () => new Date("2030-01-01T00:01:00.000Z"),
    });

    expect(await worker.runOnce()).toMatchObject({ recovered: 1, failed: 0 });
    expect({ finalized, settlementCalls }).toEqual({
      finalized: 1,
      settlementCalls: 0,
    });
  });
});

function unusedQuotes() {
  return {
    async get() {
      return undefined;
    },
    async listPaymentBindingsWithoutOrder() {
      return [];
    },
    async finalizeSettlementFailure() {},
  };
}

function unusedJournal() {
  return {
    async lookupByQuoteId() {
      return undefined;
    },
  };
}

function unusedPayments() {
  return {
    async settleAndExecute() {
      throw new Error("not used");
    },
  };
}

function unusedExecution() {
  return {
    async reconcileSubmitted() {
      return { status: "pending" as const };
    },
  };
}

function unusedRefund() {
  return {
    async reconcileSubmitted() {
      return { status: "pending" as const };
    },
  };
}

function unusedExecutor() {
  const unchanged = async () => ({}) as IntentExecutionRecord;
  return {
    recover: unchanged,
    retryRefund: unchanged,
    recoverPayment: async () => ({}) as IntentExecutionRecord,
    retryPaymentRefund: async () => ({}) as IntentExecutionRecord,
  };
}
