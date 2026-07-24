import { Landmark } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Address } from "@pledge.cash/sdk";
import { ActionButton, StatusNotice } from "../../components/shell";
import { errorMessage } from "../../lib/forms";
import {
  HyperliquidPaymentClientError,
  assertHyperliquidMarketplaceOrderMatchesQuote,
  clearHyperliquidPendingPayment,
  createHyperliquidMarketplaceQuote,
  executeHyperliquidMarketplaceQuote,
  getHyperliquidMarketplaceOrder,
  hyperliquidPendingPaymentStorageKey,
  isTerminalHyperliquidOrder,
  loadHyperliquidPendingPayment,
  saveHyperliquidPendingPayment,
  shouldRetainHyperliquidPendingPayment,
  withExclusiveHyperliquidPayment,
  type HyperliquidCheckoutContext,
  type HyperliquidMarketplaceOrder,
  type HyperliquidMarketplaceQuote,
  type HyperliquidMarketplaceQuoteRequest,
  type HyperliquidPaymentLockManager,
  type HyperliquidPendingPayment,
  type HyperliquidRouteExpectations,
} from "../../lib/x402-router";
import type { RunParticipationAction } from "../participation/types";
import {
  HyperliquidPaymentReview,
  type HyperliquidOutputMetadata,
} from "./hyperliquid-payment-review";

const ORDER_POLL_INTERVAL_MS = 3_000;
const ORDER_POLL_TIMEOUT_MS = 10_000;

export function HyperliquidPaymentAction({
  checkout,
  disabledReason,
  expectations,
  kind,
  output,
  payer,
  pendingAction,
  request,
  runAction,
}: {
  checkout: HyperliquidCheckoutContext;
  disabledReason?: string | undefined;
  expectations: HyperliquidRouteExpectations | undefined;
  kind: HyperliquidMarketplaceQuoteRequest["kind"];
  output: HyperliquidOutputMetadata;
  payer: Address | undefined;
  pendingAction: string | undefined;
  request: HyperliquidMarketplaceQuoteRequest | undefined;
  runAction: RunParticipationAction;
}): React.JSX.Element {
  const [quote, setQuote] = useState<HyperliquidMarketplaceQuote>();
  const [order, setOrder] = useState<HyperliquidMarketplaceOrder>();
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState(false);
  const [paymentAttempted, setPaymentAttempted] = useState(false);
  const [pendingPayment, setPendingPayment] =
    useState<HyperliquidPendingPayment>();
  const [hydratedStorageKey, setHydratedStorageKey] =
    useState<string | null>(null);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const pendingPaymentRef =
    useRef<HyperliquidPendingPayment | undefined>(undefined);
  const storageAvailableRef = useRef(true);
  const paymentInFlightRef = useRef(false);
  const requestIdentity = useMemo(
    () => JSON.stringify({ expectations, request }),
    [expectations, request],
  );
  const storageKey = useMemo(
    () => payer
      ? hyperliquidPendingPaymentStorageKey(checkout.config, payer, kind)
      : undefined,
    [checkout.config.gateway, kind, payer],
  );
  const storageReady =
    storageKey !== undefined
    && hydratedStorageKey === storageKey
    && storageAvailable;
  const quoteActionId = `quote-hyperliquid-${kind}`;
  const payActionId = `pay-hyperliquid-${kind}`;
  const quotePending = pendingAction === quoteActionId;
  const payPending = pendingAction === payActionId;
  const orderResolved = order?.status === "executed"
    || order?.status === "refunded"
    || order?.status === "payment_failed";
  const canReviewExisting = Boolean(quote && !orderResolved);

  useEffect(() => {
    paymentInFlightRef.current = false;
    pendingPaymentRef.current = undefined;
    setPendingPayment(undefined);
    if (!payer || !storageKey) {
      setQuote(undefined);
      setOrder(undefined);
      setError(undefined);
      setOpen(false);
      setPaymentAttempted(false);
      storageAvailableRef.current = true;
      setStorageAvailable(true);
      setHydratedStorageKey(null);
      return;
    }

    try {
      const restored = loadHyperliquidPendingPayment(
        browserPaymentStorage(),
        checkout.config,
        payer,
        kind,
      );
      pendingPaymentRef.current = restored;
      setPendingPayment(restored);
      setQuote(restored?.quote);
      setOrder(undefined);
      setError(undefined);
      setOpen(false);
      setPaymentAttempted(Boolean(restored));
      storageAvailableRef.current = true;
      setStorageAvailable(true);
      try {
        browserPaymentLockManager();
      } catch (caught) {
        storageAvailableRef.current = false;
        setStorageAvailable(false);
        if (restored) {
          setError(
            `${errorMessage(caught)} This retained order will still be recovered, but no new Hyperliquid payment can be created.`,
          );
        } else {
          throw caught;
        }
      }
    } catch (caught) {
      setQuote(undefined);
      setOrder(undefined);
      setOpen(false);
      setPaymentAttempted(false);
      storageAvailableRef.current = false;
      setStorageAvailable(false);
      setError(
        `${errorMessage(caught)} Hyperliquid payments are disabled until local recovery and cross-tab coordination are available.`,
      );
    }
    setHydratedStorageKey(storageKey);
  }, [
    checkout.config.gateway,
    kind,
    payer,
    storageKey,
  ]);

  useEffect(() => {
    if (pendingPaymentRef.current || !storageAvailableRef.current) return;
    setQuote(undefined);
    setOrder(undefined);
    setError(undefined);
    setOpen(false);
    setPaymentAttempted(false);
  }, [requestIdentity]);

  const releasePendingPayment = useCallback((orderId: string): void => {
    const current = pendingPaymentRef.current;
    if (!current || current.quote.orderId !== orderId || !payer) return;
    const released = clearHyperliquidPendingPayment(
      browserPaymentStorage(),
      checkout.config,
      payer,
      kind,
      orderId,
    );
    if (!released) return;
    pendingPaymentRef.current = undefined;
    setPendingPayment(undefined);
    setPaymentAttempted(false);
  }, [
    checkout.config.gateway,
    kind,
    payer,
  ]);

  const applyOrder = useCallback((next: HyperliquidMarketplaceOrder): void => {
    setOrder(next);
    if (!shouldRetainHyperliquidPendingPayment(next.status)) {
      try {
        releasePendingPayment(next.orderId);
      } catch (caught) {
        setError(
          `${errorMessage(caught)} The order is resolved, but its local recovery record could not be cleared.`,
        );
      }
    }
  }, [releasePendingPayment]);

  useEffect(() => {
    if (!paymentAttempted || !quote || (order && isTerminalHyperliquidOrder(order))) {
      return;
    }
    let active = true;
    let request: AbortController | undefined;
    let requestTimeout: number | undefined;
    let nextPoll: number | undefined;
    const load = async (): Promise<void> => {
      request = new AbortController();
      requestTimeout = window.setTimeout(
        () => request?.abort(),
        ORDER_POLL_TIMEOUT_MS,
      );
      try {
        const next = await getHyperliquidMarketplaceOrder(
          checkout.config,
          quote.orderId,
          { signal: request.signal },
        );
        if (active) {
          applyOrder(
            assertHyperliquidMarketplaceOrderMatchesQuote(next, quote),
          );
        }
      } catch {
        // A paid request can race persistence or a brief network outage. Keep
        // polling the stable order identifier without initiating another payment.
      } finally {
        if (requestTimeout !== undefined) {
          window.clearTimeout(requestTimeout);
          requestTimeout = undefined;
        }
        request = undefined;
        if (active) {
          nextPoll = window.setTimeout(
            () => void load(),
            ORDER_POLL_INTERVAL_MS,
          );
        }
      }
    };
    void load();
    return () => {
      active = false;
      request?.abort();
      if (requestTimeout !== undefined) window.clearTimeout(requestTimeout);
      if (nextPoll !== undefined) window.clearTimeout(nextPoll);
    };
  }, [
    applyOrder,
    checkout.config,
    order?.status,
    paymentAttempted,
    quote,
  ]);

  const reviewOrQuote = (): void => {
    if (
      quote
      && !orderResolved
      && (paymentAttempted || Date.parse(quote.expiresAt) > Date.now())
    ) {
      setOpen(true);
      return;
    }
    if (!request || !expectations) return;
    setError(undefined);
    void runAction(quoteActionId, async () => {
      try {
        const next = await createHyperliquidMarketplaceQuote(
          checkout,
          request,
          expectations,
        );
        setQuote(next);
        setOrder(undefined);
        setPaymentAttempted(false);
        setOpen(true);
      } catch (caught) {
        setError(errorMessage(caught));
        throw caught;
      }
    });
  };

  const pay = (): void => {
    if (
      !quote
      || !request
      || !expectations
      || paymentAttempted
      || paymentInFlightRef.current
      || !payer
    ) {
      return;
    }
    paymentInFlightRef.current = true;
    setError(undefined);
    void runAction(payActionId, async () => {
      try {
        await withExclusiveHyperliquidPayment(
          browserPaymentLockManager(),
          browserPaymentStorage(),
          checkout.config,
          payer,
          async () => {
            const next = await executeHyperliquidMarketplaceQuote(
              checkout,
              quote,
              request,
              expectations,
              {
                onAfterPaymentCreation() {
                  const persisted = saveHyperliquidPendingPayment(
                    browserPaymentStorage(),
                    checkout.config,
                    payer,
                    kind,
                    quote,
                    output,
                  );
                  pendingPaymentRef.current = persisted;
                  setPendingPayment(persisted);
                  setPaymentAttempted(true);
                },
              },
            );
            applyOrder(next);
            return next;
          },
        );
      } catch (caught) {
        if (
          caught instanceof HyperliquidPaymentClientError
          && caught.retry === "fresh_quote"
        ) {
          try {
            releasePendingPayment(quote.orderId);
          } catch {
            // paymentMoved:false is authoritative; an old recovery record may
            // remain fail-closed on reload but must not preserve this quote.
          }
          setQuote(undefined);
          setOrder(undefined);
          setOpen(false);
          setPaymentAttempted(false);
          setError(caught.message);
        } else if (
          caught instanceof HyperliquidPaymentClientError
          && caught.retry === "same_quote"
        ) {
          setPaymentAttempted(false);
          setError(caught.message);
        } else if (
          caught instanceof HyperliquidPaymentClientError
          && caught.retry === "locked"
          && !caught.paymentCreated
        ) {
          storageAvailableRef.current = false;
          setStorageAvailable(false);
          setPaymentAttempted(false);
          setError(caught.message);
        } else {
          setPaymentAttempted(true);
          setError(
            caught instanceof HyperliquidPaymentClientError
              ? caught.message
              : `${errorMessage(caught)} Do not submit another payment until order ${quote.orderId} is resolved.`,
          );
        }
        throw caught;
      } finally {
        paymentInFlightRef.current = false;
      }
    });
  };

  const statusNotice = error
    ? {
        detail: error,
        title: paymentAttempted
          ? "Hyperliquid order needs attention"
          : "Hyperliquid quote unavailable",
        tone: "danger" as const,
      }
    : quote
      ? orderNotice(order, quote.orderId)
      : undefined;

  return (
    <>
      <div className="border-t border-zinc-800 px-4 py-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="m-0 text-sm font-semibold text-zinc-200">Pay from Hyperliquid</p>
            <p className="m-0 mt-0.5 text-xs leading-5 text-zinc-500">
              Settle USDC on HyperCore, then execute this exact marketplace action on HyperEVM.
            </p>
          </div>
          <ActionButton
            actionId={quoteActionId}
            disabled={Boolean(
              !canReviewExisting
              && (
                disabledReason
                || !request
                || !expectations
                || !storageReady
              ),
            )}
            pendingAction={pendingAction}
            pendingLabel="Requesting Hyperliquid quote"
            title={canReviewExisting ? undefined : disabledReason}
            type="button"
            variant="secondary"
            onClick={reviewOrQuote}
          >
            <Landmark className="h-4 w-4" />
            {quotePending
              ? "Quoting…"
              : surfaceActionLabel(quote, order, paymentAttempted)}
          </ActionButton>
        </div>
        {disabledReason && !paymentAttempted ? (
          <p className="m-0 mt-2 text-xs leading-5 text-zinc-500">{disabledReason}</p>
        ) : null}
        {statusNotice ? (
          <StatusNotice
            className="mt-3"
            title={statusNotice.title}
            tone={statusNotice.tone}
          >
            {statusNotice.detail}
          </StatusNotice>
        ) : null}
      </div>

      {quote ? (
        <HyperliquidPaymentReview
          error={error}
          open={open}
          order={order}
          output={pendingPayment?.output ?? output}
          paymentAttempted={paymentAttempted}
          pending={payPending}
          quote={quote}
          onOpenChange={setOpen}
          onPay={pay}
        />
      ) : null}
    </>
  );
}

function surfaceActionLabel(
  quote: HyperliquidMarketplaceQuote | undefined,
  order: HyperliquidMarketplaceOrder | undefined,
  paymentAttempted: boolean,
): string {
  if (!quote) return "Pay from Hyperliquid";
  if (order?.status === "payment_failed") {
    return "Request fresh Hyperliquid quote";
  }
  if (order?.status === "executed" || order?.status === "refunded") {
    return "Pay from Hyperliquid again";
  }
  if (!paymentAttempted && Date.parse(quote.expiresAt) <= Date.now()) {
    return "Refresh Hyperliquid quote";
  }
  return "Review Hyperliquid order";
}

function orderNotice(
  order: HyperliquidMarketplaceOrder | undefined,
  orderId: string,
): {
  detail: string;
  title: string;
  tone: "danger" | "info" | "success" | "warning";
} {
  if (!order) {
    return {
      detail: `Order ${orderId} is ready for payment review.`,
      title: "Hyperliquid quote ready",
      tone: "info",
    };
  }
  if (order.status === "executed") {
    return {
      detail: order.message ?? "The marketplace transaction completed on HyperEVM.",
      title: "Hyperliquid order executed",
      tone: "success",
    };
  }
  if (order.status === "refunded") {
    return {
      detail: order.message ?? "The source payment was returned on HyperCore.",
      title: "Hyperliquid order refunded",
      tone: "warning",
    };
  }
  if (order.status === "payment_failed") {
    return {
      detail: order.message ?? "The router confirmed that no payment moved. Request a fresh quote.",
      title: "Hyperliquid payment not completed",
      tone: "warning",
    };
  }
  if (order.status === "manual_intervention") {
    return {
      detail: order.message ?? `Keep order ${orderId} and contact the router operator.`,
      title: "Hyperliquid order needs intervention",
      tone: "danger",
    };
  }
  return {
    detail: order.message ?? `Order ${orderId} is ${order.status.replaceAll("_", " ")}.`,
    title: order.status === "recovery_pending"
      ? "Hyperliquid payment recovery in progress"
      : "Hyperliquid order in progress",
    tone: "info",
  };
}

function browserPaymentStorage(): Storage {
  if (typeof window === "undefined") {
    throw new Error("Browser recovery storage is unavailable.");
  }
  return window.localStorage;
}

function browserPaymentLockManager(): HyperliquidPaymentLockManager {
  if (
    typeof navigator === "undefined"
    || navigator.locks === undefined
    || typeof navigator.locks.request !== "function"
  ) {
    throw new Error("This browser cannot safely coordinate Hyperliquid payments across tabs.");
  }
  return navigator.locks as HyperliquidPaymentLockManager;
}
