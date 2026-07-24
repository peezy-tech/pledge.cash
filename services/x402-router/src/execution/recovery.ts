import type { PaymentPayload } from "@x402/core/types";
import type { IntentExecutionRecord } from "x402-hl/intents/server";

import type {
  PostgresIntentExecutionStore,
  PostgresQuoteRepository,
  PostgresSupportRepository,
} from "../db";
import type { MarketplaceQuote } from "../domain";
import type { X402SettlementJournal } from "../x402";

const REQUEST_RECOVERY_GRACE_MS = 30_000;

export type RecoverableIntentExecutor = {
  recover(intentHash: string): Promise<IntentExecutionRecord>;
  retryRefund(intentHash: string): Promise<IntentExecutionRecord>;
  recoverPayment(
    paymentNetwork: string,
    paymentTransaction: string,
  ): Promise<IntentExecutionRecord>;
  retryPaymentRefund(
    paymentNetwork: string,
    paymentTransaction: string,
  ): Promise<IntentExecutionRecord>;
};

export type RecoveryPaymentDriver = {
  settleAndExecute(input: {
    quote: MarketplaceQuote;
    paymentPayload: PaymentPayload;
  }): Promise<unknown>;
};

export type RecoveryExecutionReconciler = {
  reconcileSubmitted(input: {
    idempotencyKey: string;
    quoteId: string;
  }): Promise<
    | {
        status: "confirmed_success";
        transaction: string;
        network: string;
      }
    | { status: "confirmed_failure" }
    | { status: "pending" }
    | { status: "manual_intervention" }
  >;
};

export type RecoveryRefundReconciler = {
  reconcileSubmitted(
    record: IntentExecutionRecord,
  ): Promise<
    | {
        status: "confirmed_success";
        transaction: string;
        network: string;
      }
    | { status: "confirmed_failure" }
    | { status: "pending" }
    | { status: "manual_intervention" }
  >;
};

export type RouterRecoveryResult = {
  prunedChallenges: number;
  scannedBindings: number;
  scannedIntents: number;
  recovered: number;
  failed: number;
  skipped: number;
};

type RouterRecoveryWorkerOptions = {
  readonly quotes: Pick<
    PostgresQuoteRepository,
    "get" | "listPaymentBindingsWithoutOrder" | "finalizeSettlementFailure"
  >;
  readonly intents: Pick<
    PostgresIntentExecutionStore,
    "listRecoverable" | "transition"
  >;
  readonly support?: Pick<
    PostgresSupportRepository,
    "pruneExpiredChallenges"
  >;
  readonly journal: Pick<
    X402SettlementJournal,
    "lookupByQuoteId"
  >;
  readonly payments: RecoveryPaymentDriver;
  readonly executor: RecoverableIntentExecutor;
  readonly execution: RecoveryExecutionReconciler;
  readonly refund: RecoveryRefundReconciler;
  readonly staleAfterMs: number;
  readonly batchSize?: number;
  readonly now?: () => Date;
  readonly onError?: (input: {
    phase: "payment" | "intent" | "support_challenges";
    id: string;
    error: unknown;
  }) => void;
};

/**
 * Bounded recovery coordinator. Payment-journal leases serialize uncertain
 * HyperCore settlement replay. Intent compare-and-swap transitions serialize
 * executor recovery. The stale cutoff prevents a background pass from racing
 * a live HTTP request that is still inside its operation lease.
 */
export class RouterRecoveryWorker {
  private readonly batchSize: number;
  private readonly now: () => Date;
  private running = false;

  constructor(private readonly options: RouterRecoveryWorkerOptions) {
    if (
      !Number.isSafeInteger(options.staleAfterMs) ||
      options.staleAfterMs <= 0
    ) {
      throw new Error("Recovery stale cutoff must be a positive safe integer");
    }
    this.batchSize = options.batchSize ?? 25;
    if (
      !Number.isSafeInteger(this.batchSize) ||
      this.batchSize <= 0 ||
      this.batchSize > 100
    ) {
      throw new Error("Recovery batch size must be between 1 and 100");
    }
    this.now = options.now ?? (() => new Date());
  }

  async runOnce(): Promise<RouterRecoveryResult> {
    if (this.running) {
      return {
        prunedChallenges: 0,
        scannedBindings: 0,
        scannedIntents: 0,
        recovered: 0,
        failed: 0,
        skipped: 0,
      };
    }
    this.running = true;
    try {
      const now = this.now();
      const before = new Date(
        now.getTime() - this.options.staleAfterMs,
      );
      let prunedChallenges = 0;
      let failed = 0;
      if (this.options.support) {
        try {
          prunedChallenges =
            await this.options.support.pruneExpiredChallenges({
              before: now,
              limit: this.batchSize,
            });
        } catch (error) {
          failed += 1;
          this.options.onError?.({
            phase: "support_challenges",
            id: before.toISOString(),
            error,
          });
        }
      }
      const bindings = await this.options.quotes.listPaymentBindingsWithoutOrder({
        before,
        limit: this.batchSize,
      });
      let recovered = 0;
      let skipped = 0;

      for (const binding of bindings) {
        try {
          const outcome = await this.replayPayment(binding.quoteId);
          if (outcome === "recovered") recovered += 1;
          else skipped += 1;
        } catch (error) {
          failed += 1;
          this.options.onError?.({
            phase: "payment",
            id: binding.quoteId,
            error,
          });
        }
      }

      const intents = await this.options.intents.listRecoverable(
        this.batchSize,
        before,
      );
      for (const record of intents) {
        try {
          const outcome = await this.recoverIntent(record);
          if (outcome === "recovered") recovered += 1;
          else skipped += 1;
        } catch (error) {
          failed += 1;
          this.options.onError?.({
            phase: "intent",
            id: record.duplicatePayment
              ? `${record.paymentNetwork}:${record.paymentTransaction}`
              : record.intentHash,
            error,
          });
        }
      }

      return {
        prunedChallenges,
        scannedBindings: bindings.length,
        scannedIntents: intents.length,
        recovered,
        failed,
        skipped,
      };
    } finally {
      this.running = false;
    }
  }

  private async replayPayment(
    quoteId: string,
  ): Promise<"recovered" | "skipped"> {
    const [quote, attempt] = await Promise.all([
      this.options.quotes.get(quoteId),
      this.options.journal.lookupByQuoteId(quoteId),
    ]);
    if (!quote || !attempt) return "skipped";
    if (attempt.status === "failed") {
      await this.options.quotes.finalizeSettlementFailure(quoteId);
      return "recovered";
    }
    await this.options.payments.settleAndExecute({
      quote,
      paymentPayload: attempt.paymentPayload,
    });
    return "recovered";
  }

  private async recoverIntent(
    record: IntentExecutionRecord,
  ): Promise<"recovered" | "skipped"> {
    if (record.status === "paid") {
      return this.replayPayment(record.quoteId);
    }
    if (record.status === "refund_submitted") {
      return this.reconcileRefund(record);
    }
    if (record.duplicatePayment) {
      if (
        record.status === "refund_pending" ||
        record.status === "refund_failed"
      ) {
        await this.options.executor.retryPaymentRefund(
          record.paymentNetwork,
          record.paymentTransaction,
        );
      } else {
        await this.options.executor.recoverPayment(
          record.paymentNetwork,
          record.paymentTransaction,
        );
      }
      return "recovered";
    }
    if (record.status === "execution_submitted") {
      const reconciliation = await this.options.execution.reconcileSubmitted({
        idempotencyKey: record.intentHash,
        quoteId: record.quoteId,
      });
      if (reconciliation.status === "pending") return "skipped";
      if (reconciliation.status === "manual_intervention") {
        await this.options.executor.recover(record.intentHash);
        return "recovered";
      }
      if (reconciliation.status === "confirmed_success") {
        await this.options.intents.transition({
          intentHash: record.intentHash,
          expectedRevision: record.revision,
          from: "execution_submitted",
          to: "executed",
          ...(record.claimToken === undefined
            ? {}
            : { claimToken: record.claimToken }),
          patch: {
            claimToken: undefined,
            executionNetwork: reconciliation.network,
            executionTransaction: reconciliation.transaction,
            failure: undefined,
          },
        });
        return "recovered";
      }
      const failed = await this.options.intents.transition({
        intentHash: record.intentHash,
        expectedRevision: record.revision,
        from: "execution_submitted",
        to: "execution_failed",
        ...(record.claimToken === undefined
          ? {}
          : { claimToken: record.claimToken }),
        patch: {
          claimToken: undefined,
          failure: {
            reason: "execution_failed",
            message:
              "The persisted destination transaction reverted or was never submitted",
            retryable: false,
          },
        },
      });
      if (failed.kind === "updated") {
        await this.options.executor.recover(record.intentHash);
      }
      return "recovered";
    }
    if (
      record.status === "refund_pending" ||
      record.status === "refund_failed"
    ) {
      await this.options.executor.retryRefund(record.intentHash);
    } else {
      await this.options.executor.recover(record.intentHash);
    }
    return "recovered";
  }

  private async reconcileRefund(
    record: IntentExecutionRecord,
  ): Promise<"recovered" | "skipped"> {
    const reconciliation = await this.options.refund.reconcileSubmitted(record);
    if (reconciliation.status === "pending") return "skipped";
    if (reconciliation.status === "manual_intervention") {
      if (record.duplicatePayment) {
        await this.options.executor.recoverPayment(
          record.paymentNetwork,
          record.paymentTransaction,
        );
      } else {
        await this.options.executor.recover(record.intentHash);
      }
      return "recovered";
    }

    const locator = record.duplicatePayment
      ? {
          paymentNetwork: record.paymentNetwork,
          paymentTransaction: record.paymentTransaction,
        }
      : {};
    if (reconciliation.status === "confirmed_success") {
      const refunded = await this.options.intents.transition({
        ...locator,
        intentHash: record.intentHash,
        expectedRevision: record.revision,
        from: "refund_submitted",
        to: "refunded",
        ...(record.claimToken === undefined
          ? {}
          : { claimToken: record.claimToken }),
        patch: {
          claimToken: undefined,
          refundNetwork: reconciliation.network,
          refundTransaction: reconciliation.transaction,
          failure: undefined,
        },
      });
      return refunded.kind === "updated" ? "recovered" : "skipped";
    }

    const failed = await this.options.intents.transition({
      ...locator,
      intentHash: record.intentHash,
      expectedRevision: record.revision,
      from: "refund_submitted",
      to: "refund_failed",
      ...(record.claimToken === undefined
        ? {}
        : { claimToken: record.claimToken }),
      patch: {
        claimToken: undefined,
        failure: {
          reason: "refund_failed",
          message:
            "The persisted refund action definitively failed before moving funds",
          retryable: true,
        },
      },
    });
    return failed.kind === "updated" ? "recovered" : "skipped";
  }
}

export function startRouterRecoveryLoop(input: {
  readonly worker: RouterRecoveryWorker;
  readonly intervalMs: number;
  readonly onResult?: (result: RouterRecoveryResult) => void;
}): { stop(): void } {
  if (
    !Number.isSafeInteger(input.intervalMs) ||
    input.intervalMs <= 0 ||
    input.intervalMs > 3_600_000
  ) {
    throw new Error("Recovery interval must be between 1 and 3600000 ms");
  }
  let stopped = false;
  const tick = (): void => {
    if (stopped) return;
    void input.worker
      .runOnce()
      .then((result) => input.onResult?.(result))
      .catch(() => undefined);
  };
  tick();
  const timer = setInterval(tick, input.intervalMs);
  timer.unref();
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

export function safeRecoveryStaleAfterMs(input: {
  operationLeaseMs: number;
  receiptTimeoutMs: number;
}): number {
  for (const [label, value] of Object.entries(input)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${label} must be a positive safe integer`);
    }
  }
  const receiptBoundary =
    input.receiptTimeoutMs + REQUEST_RECOVERY_GRACE_MS;
  if (!Number.isSafeInteger(receiptBoundary)) {
    throw new Error("Recovery stale cutoff exceeds the safe integer range");
  }
  return Math.max(input.operationLeaseMs, receiptBoundary);
}
