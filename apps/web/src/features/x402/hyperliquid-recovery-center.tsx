import type { Address } from "@pledge.cash/sdk";
import { useEffect, useState } from "react";
import { StatusNotice } from "../../components/shell";
import { errorMessage } from "../../lib/forms";
import {
  assertHyperliquidMarketplaceOrderMatchesQuote,
  clearHyperliquidPendingPayment,
  getHyperliquidMarketplaceOrder,
  loadHyperliquidPendingPayment,
  shouldRetainHyperliquidPendingPayment,
  withHyperliquidPaymentStorageLock,
  type HyperliquidMarketplaceOrder,
  type HyperliquidMarketplaceQuoteRequest,
  type HyperliquidPaymentLockManager,
  type HyperliquidPendingPayment,
  type X402RouterConfig,
} from "../../lib/x402-router";

const RECOVERY_POLL_INTERVAL_MS = 3_000;
const RECOVERY_POLL_TIMEOUT_MS = 10_000;
const RECOVERY_KINDS = [
  "amm_swap",
  "fixed_price_sale",
] as const satisfies readonly HyperliquidMarketplaceQuoteRequest["kind"][];

type RecoveryEntry = {
  kind: HyperliquidMarketplaceQuoteRequest["kind"];
  error?: string;
  order?: HyperliquidMarketplaceOrder;
  pending?: HyperliquidPendingPayment;
};

export function HyperliquidRecoveryCenter({
  config,
  payer,
}: {
  config: X402RouterConfig | undefined;
  payer: Address | undefined;
}): React.JSX.Element | null {
  const [entries, setEntries] = useState<readonly RecoveryEntry[]>([]);

  useEffect(() => {
    if (!config || !payer) {
      setEntries([]);
      return;
    }

    let active = true;
    let request: AbortController | undefined;
    let requestTimeout: number | undefined;
    let nextPoll: number | undefined;
    const resolved = new Map<RecoveryEntry["kind"], RecoveryEntry>();

    const scan = async (): Promise<void> => {
      const controller = new AbortController();
      request = controller;
      requestTimeout = window.setTimeout(
        () => controller.abort(),
        RECOVERY_POLL_TIMEOUT_MS,
      );
      const next: RecoveryEntry[] = [];

      for (const kind of RECOVERY_KINDS) {
        let pending: HyperliquidPendingPayment | undefined;
        try {
          pending = loadHyperliquidPendingPayment(
            window.localStorage,
            config,
            payer,
            kind,
          );
        } catch (caught) {
          next.push({
            kind,
            error: `${errorMessage(caught)} No new Hyperliquid payment can be created until this recovery record is reconciled.`,
          });
          continue;
        }

        if (!pending) {
          const completed = resolved.get(kind);
          if (completed) next.push(completed);
          continue;
        }

        try {
          const order = assertHyperliquidMarketplaceOrderMatchesQuote(
            await getHyperliquidMarketplaceOrder(
              config,
              pending.quote.orderId,
              { signal: controller.signal },
            ),
            pending.quote,
          );
          const entry = { kind, order, pending } satisfies RecoveryEntry;
          next.push(entry);
          if (!shouldRetainHyperliquidPendingPayment(order.status)) {
            resolved.set(kind, entry);
            const locks = browserPaymentLockManager();
            if (locks) {
              try {
                await withHyperliquidPaymentStorageLock(
                  locks,
                  payer,
                  async () => {
                    clearHyperliquidPendingPayment(
                      window.localStorage,
                      config,
                      payer,
                      kind,
                      order.orderId,
                    );
                  },
                );
              } catch {
                next[next.length - 1] = {
                  ...entry,
                  error:
                    "The order is resolved, but its local recovery lock could not be cleared safely.",
                };
              }
            }
          } else {
            resolved.delete(kind);
          }
        } catch (caught) {
          if (!active) break;
          next.push({
            kind,
            pending,
            error:
              controller.signal.aborted
                ? "Order status timed out. Recovery will retry without creating another payment."
                : `${errorMessage(caught)} Recovery will retry without creating another payment.`,
          });
        }
      }

      if (active) setEntries(next);
      if (requestTimeout !== undefined) {
        window.clearTimeout(requestTimeout);
        requestTimeout = undefined;
      }
      request = undefined;
      if (active) {
        nextPoll = window.setTimeout(
          () => void scan(),
          RECOVERY_POLL_INTERVAL_MS,
        );
      }
    };

    void scan();
    return () => {
      active = false;
      request?.abort();
      if (requestTimeout !== undefined) window.clearTimeout(requestTimeout);
      if (nextPoll !== undefined) window.clearTimeout(nextPoll);
    };
  }, [config, config?.baseUrl, config?.gateway, payer]);

  if (entries.length === 0) return null;

  return (
    <section
      aria-label="Hyperliquid payment recovery"
      className="border-b border-[var(--pc-border)] bg-[color:var(--pc-canvas-translucent)] px-4 py-3 sm:px-6"
    >
      <div className="mx-auto grid w-full max-w-[1240px] gap-2">
        {entries.map(entry => (
          <StatusNotice
            key={entry.kind}
            title={recoveryTitle(entry)}
            tone={recoveryTone(entry)}
          >
            {recoveryDetail(entry)}
          </StatusNotice>
        ))}
      </div>
    </section>
  );
}

function browserPaymentLockManager(): HyperliquidPaymentLockManager | undefined {
  if (
    typeof navigator === "undefined"
    || navigator.locks === undefined
    || typeof navigator.locks.request !== "function"
  ) {
    return undefined;
  }
  return navigator.locks as HyperliquidPaymentLockManager;
}

function recoveryTitle(entry: RecoveryEntry): string {
  if (!entry.order) {
    return entry.pending
      ? "Hyperliquid order recovery is retrying"
      : "Hyperliquid recovery data needs attention";
  }
  if (entry.order.status === "executed") return "Hyperliquid order executed";
  if (entry.order.status === "refunded") return "Hyperliquid payment refunded";
  if (entry.order.status === "payment_failed") {
    return "Hyperliquid payment was not submitted";
  }
  if (entry.order.status === "manual_intervention") {
    return "Hyperliquid order needs intervention";
  }
  if (entry.order.status === "refund_pending") {
    return "Hyperliquid refund in progress";
  }
  return "Hyperliquid order recovery in progress";
}

function recoveryTone(
  entry: RecoveryEntry,
): "danger" | "info" | "success" | "warning" {
  if (entry.error && !entry.pending) return "danger";
  if (entry.order?.status === "executed") return "success";
  if (
    entry.order?.status === "refunded"
    || entry.order?.status === "payment_failed"
  ) {
    return "warning";
  }
  if (entry.order?.status === "manual_intervention") return "danger";
  return "info";
}

function recoveryDetail(entry: RecoveryEntry): string {
  if (entry.error) return entry.error;
  if (!entry.order || !entry.pending) {
    return "The retained order will be checked again automatically.";
  }
  const orderId = entry.pending.quote.orderId;
  return entry.order.message
    ?? `Order ${orderId} is ${entry.order.status.replaceAll("_", " ")}. Do not submit another payment while it remains unresolved.`;
}
