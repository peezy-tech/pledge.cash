import type { Address } from "@pledge.cash/sdk";
import {
  CalendarClock,
  CheckCircle2,
  Plus,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { formatUnits, parseUnits } from "viem";
import { ActionButton, StatusNotice } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { HyperliquidPaymentAction } from "../x402";
import { errorMessage } from "../../lib/forms";
import {
  assertRecurringSupportStorageAvailable,
  cancelRecurringSupportSubscription,
  createRecurringSupportInvoiceQuote,
  createRecurringSupportSubscription,
  getRecurringSupportPlans,
  getRecurringSupportSubscription,
  loadRecurringSupportSubscriptionId,
  publishRecurringSupportPlan,
  recurringSupportExpectations,
  recurringSupportQuoteRequest,
  retireRecurringSupportPlan,
  saveRecurringSupportSubscription,
  saveRecurringSupportSubscriptionId,
  type RecurringSupportPlan,
  type RecurringSupportInvoice,
  type RecurringSupportSubscriptionView,
} from "../../lib/recurring-support";
import type {
  HyperliquidCheckoutContext,
  HyperliquidMarketplaceOrder,
} from "../../lib/x402-router";
import type { RunParticipationAction } from "../participation/types";

const DESTINATION_USDC_DECIMALS = 6;

export function RecurringSupportPanel({
  account,
  boardroomActive,
  boardroom,
  canPublish,
  checkout,
  pendingAction,
  runAction,
}: {
  account: Address | undefined;
  boardroomActive: boolean;
  boardroom: Address;
  canPublish: boolean;
  checkout: HyperliquidCheckoutContext;
  pendingAction: string | undefined;
  runAction: RunParticipationAction;
}): React.JSX.Element {
  const [plans, setPlans] = useState<readonly RecurringSupportPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>();
  const [subscription, setSubscription] =
    useState<RecurringSupportSubscriptionView>();
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [loadingSubscription, setLoadingSubscription] = useState(false);
  const [error, setError] = useState<string>();
  const [publisherOpen, setPublisherOpen] = useState(false);
  const [title, setTitle] = useState("Monthly project support");
  const [description, setDescription] = useState(
    "A voluntary monthly contribution to the project treasury.",
  );
  const [amount, setAmount] = useState("10");
  const [confirmRetire, setConfirmRetire] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryId, setRecoveryId] = useState("");

  const boardroomIdentity = boardroom.toLowerCase();
  const boardroomIdentityRef = useRef(boardroomIdentity);
  boardroomIdentityRef.current = boardroomIdentity;
  const visiblePlans = useMemo(
    () => plans.filter(
      plan => plan.boardroom.toLowerCase() === boardroomIdentity,
    ),
    [boardroomIdentity, plans],
  );
  const selectedPlan = useMemo(
    () => visiblePlans.find(plan => plan.id === selectedPlanId),
    [selectedPlanId, visiblePlans],
  );
  const subscriptionIdentity =
    account && selectedPlan
      ? `${account.toLowerCase()}:${selectedPlan.id}`
      : undefined;
  const subscriptionIdentityRef = useRef(subscriptionIdentity);
  subscriptionIdentityRef.current = subscriptionIdentity;
  const activeSubscription = useMemo(
    () =>
      subscription
      && account
      && selectedPlan
      && subscription.plan.id === selectedPlan.id
      && subscription.subscription.payer.toLowerCase() === account.toLowerCase()
        ? subscription
        : undefined,
    [account, selectedPlan, subscription],
  );

  const loadPlans = useCallback(async (signal?: AbortSignal): Promise<void> => {
    const requestIdentity = boardroom.toLowerCase();
    if (boardroomIdentityRef.current !== requestIdentity) return;
    setLoadingPlans(true);
    try {
      const next = await getRecurringSupportPlans(
        checkout.config,
        boardroom,
        { signal },
      );
      if (
        signal?.aborted
        || boardroomIdentityRef.current !== requestIdentity
      ) return;
      setPlans(next);
      setSelectedPlanId(current =>
        current && next.some(plan => plan.id === current)
          ? current
          : next[0]?.id,
      );
      setError(undefined);
    } catch (caught) {
      if (
        signal?.aborted
        || boardroomIdentityRef.current !== requestIdentity
      ) return;
      setError(errorMessage(caught));
    } finally {
      if (
        !signal?.aborted
        && boardroomIdentityRef.current === requestIdentity
      ) {
        setLoadingPlans(false);
      }
    }
  }, [boardroom, checkout.config]);

  useEffect(() => {
    const request = new AbortController();
    void loadPlans(request.signal);
    return () => request.abort();
  }, [loadPlans]);

  const loadSubscription = useCallback(async (
    signal?: AbortSignal,
  ): Promise<void> => {
    const requestIdentity = subscriptionIdentity;
    if (!account || !selectedPlan || !requestIdentity) {
      setSubscription(undefined);
      setLoadingSubscription(false);
      return;
    }
    if (subscriptionIdentityRef.current !== requestIdentity) return;
    setLoadingSubscription(true);
    try {
      const id = loadRecurringSupportSubscriptionId(
        window.localStorage,
        checkout.config,
        boardroom,
        account,
        selectedPlan.id,
      );
      if (!id) {
        if (
          signal?.aborted
          || subscriptionIdentityRef.current !== requestIdentity
        ) return;
        setSubscription(undefined);
        setError(undefined);
        return;
      }
      const next = await getRecurringSupportSubscription(
        checkout.config,
        id,
        { signal },
      );
      if (
        signal?.aborted
        || subscriptionIdentityRef.current !== requestIdentity
      ) return;
      if (
        next.plan.id !== selectedPlan.id
        || next.subscription.payer.toLowerCase() !== account.toLowerCase()
      ) {
        throw new Error(
          "Stored support subscription does not match this wallet and plan.",
        );
      }
      setSubscription(next);
      setError(undefined);
    } catch (caught) {
      if (
        signal?.aborted
        || subscriptionIdentityRef.current !== requestIdentity
      ) return;
      setSubscription(undefined);
      setError(errorMessage(caught));
    } finally {
      if (
        !signal?.aborted
        && subscriptionIdentityRef.current === requestIdentity
      ) {
        setLoadingSubscription(false);
      }
    }
  }, [
    account,
    boardroom,
    checkout.config,
    selectedPlan,
    subscriptionIdentity,
  ]);

  useEffect(() => {
    const request = new AbortController();
    void loadSubscription(request.signal);
    return () => request.abort();
  }, [loadSubscription]);

  const publishPlan = (): void => {
    if (!account || !canPublish) return;
    void runAction("publish-recurring-support-plan", async () => {
      try {
        const atomicAmount = parseUnits(amount.trim(), DESTINATION_USDC_DECIMALS);
        if (atomicAmount <= 0n) {
          throw new Error("Monthly support amount must be greater than zero.");
        }
        const plan = await publishRecurringSupportPlan(checkout, {
          amount: atomicAmount.toString(),
          boardroom,
          cadence: "monthly",
          chainId: 998,
          description: description.trim(),
          title: title.trim(),
        });
        setPlans(current => [plan, ...current]);
        setSelectedPlanId(plan.id);
        setPublisherOpen(false);
        setError(undefined);
      } catch (caught) {
        setError(errorMessage(caught));
        throw caught;
      }
    });
  };

  const subscribe = (): void => {
    if (
      !account
      || !boardroomActive
      || !selectedPlan
      || selectedPlan.status !== "active"
    ) return;
    void runAction(`subscribe-support-${selectedPlan.id}`, async () => {
      try {
        assertRecurringSupportStorageAvailable(window.localStorage);
        const next = await createRecurringSupportSubscription(
          checkout,
          selectedPlan,
          account,
          {
            onSubscriptionSigned(subscriptionId) {
              saveRecurringSupportSubscriptionId(
                window.localStorage,
                checkout.config,
                selectedPlan.boardroom,
                account,
                selectedPlan.id,
                subscriptionId,
              );
            },
          },
        );
        setSubscription(next);
        setError(undefined);
      } catch (caught) {
        setError(errorMessage(caught));
        throw caught;
      }
    });
  };

  const cancel = (): void => {
    if (!activeSubscription) return;
    void runAction(
      `cancel-support-${activeSubscription.subscription.id}`,
      async () => {
        try {
          const next = await cancelRecurringSupportSubscription(
            checkout,
            activeSubscription,
          );
          setSubscription(next);
          try {
            saveRecurringSupportSubscription(
              window.localStorage,
              checkout.config,
              next,
            );
          } catch {
            setError(
              `The schedule was cancelled, but this browser could not update its local record. Keep subscription ID ${next.subscription.id}.`,
            );
            setConfirmCancel(false);
            return;
          }
          setConfirmCancel(false);
          setError(undefined);
        } catch (caught) {
          setError(errorMessage(caught));
          throw caught;
        }
      },
    );
  };

  const recoverSubscription = (): void => {
    if (!account || !recoveryId.trim()) return;
    void runAction("recover-support-schedule", async () => {
      try {
        const next = await getRecurringSupportSubscription(
          checkout.config,
          recoveryId.trim(),
        );
        if (
          next.plan.boardroom.toLowerCase() !== boardroom.toLowerCase()
          || next.subscription.payer.toLowerCase() !== account.toLowerCase()
        ) {
          throw new Error(
            "That schedule ID belongs to a different wallet or project.",
          );
        }
        setPlans(current =>
          current.some(plan => plan.id === next.plan.id)
            ? current.map(plan => plan.id === next.plan.id ? next.plan : plan)
            : [...current, next.plan],
        );
        setSelectedPlanId(next.plan.id);
        setSubscription(next);
        setRecoveryOpen(false);
        setRecoveryId("");
        try {
          saveRecurringSupportSubscription(
            window.localStorage,
            checkout.config,
            next,
          );
          setError(undefined);
        } catch {
          setError(
            `The schedule was recovered for this session, but browser storage is unavailable. Keep subscription ID ${next.subscription.id}.`,
          );
        }
      } catch (caught) {
        setError(errorMessage(caught));
        throw caught;
      }
    });
  };

  const retire = (): void => {
    if (
      !selectedPlan
      || selectedPlan.status !== "active"
      || !canPublish
    ) return;
    void runAction(`retire-support-${selectedPlan.id}`, async () => {
      try {
        await retireRecurringSupportPlan(checkout, selectedPlan);
        setConfirmRetire(false);
        await loadPlans();
        setError(undefined);
      } catch (caught) {
        setError(errorMessage(caught));
        throw caught;
      }
    });
  };

  const request = activeSubscription
    ? recurringSupportQuoteRequest(activeSubscription)
    : undefined;
  const expectations = activeSubscription
    ? recurringSupportExpectations(activeSubscription)
    : undefined;
  const onOrderChange = useCallback(
    (order: HyperliquidMarketplaceOrder): void => {
      if (
        order.status === "executed"
        || order.status === "refunded"
        || order.status === "payment_failed"
        || order.status === "manual_intervention"
      ) {
        window.setTimeout(() => void loadSubscription(), 300);
      }
    },
    [loadSubscription],
  );

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="default">Explicit renewal</Badge>
            <Badge variant="muted">Monthly</Badge>
          </div>
          <h3 className="m-0 mt-3 text-lg font-semibold text-zinc-50">
            Support the project on a schedule
          </h3>
          <p className="m-0 mt-1 max-w-2xl text-sm leading-6 text-zinc-400">
            Remember a monthly contribution without granting debit authority.
            Each period remains unpaid until this wallet reviews and signs a
            fresh x402 payment.
          </p>
        </div>
        <Button
          disabled={loadingPlans}
          size="sm"
          variant="ghost"
          onClick={() => void loadPlans()}
        >
          <RefreshCw className={loadingPlans ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          Refresh
        </Button>
      </div>

      {error ? (
        <StatusNotice className="mt-4" title="Recurring support needs attention" tone="danger">
          {error}
        </StatusNotice>
      ) : null}

      {loadingPlans && visiblePlans.length === 0 ? (
        <div className="mt-5 grid animate-pulse gap-2" aria-label="Loading support plans">
          <span className="h-16 bg-zinc-900" />
          <span className="h-16 bg-zinc-900" />
        </div>
      ) : visiblePlans.length === 0 ? (
        <StatusNotice className="mt-5" title="No monthly support plan is published">
          The project authority can publish immutable USDC terms here. Publishing
          a plan never grants the router access to the treasury.
        </StatusNotice>
      ) : (
        <div className="mt-5 border-y border-zinc-800">
          {visiblePlans.map(plan => (
            <button
              aria-pressed={selectedPlanId === plan.id}
              className={
                selectedPlanId === plan.id
                  ? "grid w-full gap-2 border-b border-zinc-800 bg-zinc-900/70 px-4 py-4 text-left last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                  : "grid w-full gap-2 border-b border-zinc-800 px-4 py-4 text-left transition-colors last:border-b-0 hover:bg-zinc-900/35 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              }
              key={plan.id}
              type="button"
              onClick={() => {
                setSelectedPlanId(plan.id);
                setConfirmRetire(false);
                setConfirmCancel(false);
              }}
            >
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-zinc-100">
                  {plan.title}
                  {plan.status === "retired" ? (
                    <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-zinc-500">
                      Retired
                    </span>
                  ) : null}
                </span>
                <span className="mt-1 block text-xs leading-5 text-zinc-500">
                  {plan.description}
                </span>
              </span>
              <span className="font-mono text-sm font-semibold text-lime-200">
                {formatSupportAmount(plan.amount)} / month
              </span>
            </button>
          ))}
        </div>
      )}

      {account ? (
        <div className="mt-3">
          {!recoveryOpen ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setRecoveryOpen(true)}
            >
              Recover by schedule ID
            </Button>
          ) : (
            <form
              className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
              onSubmit={event => {
                event.preventDefault();
                recoverSubscription();
              }}
            >
              <Input
                aria-label="Support schedule ID"
                placeholder="00000000-0000-4000-8000-000000000000"
                value={recoveryId}
                onChange={event => setRecoveryId(event.target.value)}
              />
              <ActionButton
                actionId="recover-support-schedule"
                disabled={!recoveryId.trim()}
                pendingAction={pendingAction}
                pendingLabel="Recovering"
                size="sm"
                type="submit"
              >
                Recover
              </ActionButton>
              <Button
                size="sm"
                type="button"
                variant="ghost"
                onClick={() => setRecoveryOpen(false)}
              >
                Close
              </Button>
            </form>
          )}
        </div>
      ) : null}

      {selectedPlan ? (
        <div className="mt-5">
          <dl className="grid gap-px overflow-hidden border border-zinc-800 bg-zinc-800 sm:grid-cols-3">
            <PlanFact label="Monthly amount" value={formatSupportAmount(selectedPlan.amount)} />
            <PlanFact label="Treasury asset" value="HyperEVM USDC" />
            <PlanFact label="Terms" value={`Immutable · ${shortHash(selectedPlan.termsHash)}`} />
          </dl>

          {!account ? (
            <StatusNotice className="mt-4" title="Connect a wallet to start">
              Public plan terms are visible now. A wallet signature records the
              schedule; it does not approve this or any future payment.
            </StatusNotice>
          ) : loadingSubscription ? (
            <p className="m-0 mt-4 text-sm text-zinc-500">Checking this wallet’s schedule…</p>
          ) : (
            !activeSubscription
            || activeSubscription.subscription.status === "cancelled"
          ) && selectedPlan.status === "retired" ? (
            <StatusNotice className="mt-4" title="These terms are retired">
              No new schedules or invoices can start from this plan. Recover a
              prior schedule by ID to follow any retained payment or refund.
            </StatusNotice>
          ) : !activeSubscription
            || activeSubscription.subscription.status === "cancelled" ? (
            <div className="mt-4 border-l-2 border-lime-300 bg-zinc-900/45 px-4 py-4">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div>
                  <p className="m-0 text-sm font-semibold text-zinc-100">
                    {activeSubscription ? "This schedule is cancelled" : "No schedule for this wallet"}
                  </p>
                  <p className="m-0 mt-1 text-xs leading-5 text-zinc-500">
                    Signing creates one invoice for the current period. Payment is
                    still a separate review and signature.
                  </p>
                </div>
                <ActionButton
                  actionId={`subscribe-support-${selectedPlan.id}`}
                  disabled={!boardroomActive}
                  pendingAction={pendingAction}
                  pendingLabel="Signing schedule"
                  title={
                    boardroomActive
                      ? undefined
                      : "New support schedules are paused while the Boardroom is not Active."
                  }
                  onClick={subscribe}
                >
                  <CalendarClock className="h-4 w-4" />
                  {activeSubscription ? "Start a new schedule" : "Start monthly support"}
                </ActionButton>
              </div>
            </div>
          ) : (
            <div className="mt-4 border border-zinc-800">
              <div className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-lime-300" />
                    <p className="m-0 text-sm font-semibold text-zinc-100">
                      Monthly schedule active
                    </p>
                    <Badge variant={invoiceTone(activeSubscription.invoice?.status)}>
                      {invoiceStatusLabel(activeSubscription.invoice?.status)}
                    </Badge>
                  </div>
                  <p className="m-0 mt-2 text-xs leading-5 text-zinc-500">
                    {activeSubscription.invoice
                      ? `${formatDate(activeSubscription.invoice.periodStart)} – ${formatDate(activeSubscription.invoice.periodEnd)} · invoice ${activeSubscription.invoice.periodIndex + 1}`
                      : "The current period invoice is being prepared."}
                  </p>
                  {activeSubscription.invoice?.latestQuoteId ? (
                    <p className="m-0 mt-1 break-all font-mono text-[11px] text-zinc-600">
                      Order {activeSubscription.invoice.latestQuoteId}
                    </p>
                  ) : null}
                  <p className="m-0 mt-1 break-all font-mono text-[11px] text-zinc-600">
                    Schedule {activeSubscription.subscription.id}
                  </p>
                </div>
                {!confirmCancel ? (
                  <Button size="sm" variant="ghost" onClick={() => setConfirmCancel(true)}>
                    Cancel schedule
                  </Button>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setConfirmCancel(false)}>
                      Keep it
                    </Button>
                    <ActionButton
                      actionId={`cancel-support-${activeSubscription.subscription.id}`}
                      pendingAction={pendingAction}
                      pendingLabel="Cancelling"
                      size="sm"
                      variant="secondary"
                      onClick={cancel}
                    >
                      Confirm cancel
                    </ActionButton>
                  </div>
                )}
              </div>

              {activeSubscription.invoice?.status === "paid" ? (
                <StatusNotice className="mx-4 mb-4" title="This period is paid" tone="success">
                  {activeSubscription.plan.status === "active"
                    ? "The Boardroom contribution executed on HyperEVM. The next calendar period will produce a new unpaid invoice."
                    : "The Boardroom contribution executed on HyperEVM. These terms are retired, so no future invoice will be created."}
                </StatusNotice>
              ) : activeSubscription.invoice?.status === "manual_intervention" ? (
                <StatusNotice className="mx-4 mb-4" title="Reconciliation required" tone="danger">
                  Do not submit another payment. Keep the order ID while the
                  router reconciles execution or refund.
                </StatusNotice>
              ) : (
                <HyperliquidPaymentAction
                  checkout={checkout}
                  disabledReason={
                    !boardroomActive
                      ? "Support payments are paused while the Boardroom is not Active. You can still cancel this schedule."
                      : activeSubscription.invoice?.status === "payment_pending"
                      ? "A payment is already being reconciled for this invoice."
                      : activeSubscription.plan.status === "retired"
                        || activeSubscription.invoice?.status === "cancelled"
                        ? "This plan is retired. Only a retained payment or refund can be reviewed."
                      : undefined
                  }
                  expectations={expectations}
                  key={`${activeSubscription.subscription.id}:${activeSubscription.invoice?.id ?? "pending"}`}
                  kind="recurring_support"
                  onOrderChange={onOrderChange}
                  output={{ decimals: DESTINATION_USDC_DECIMALS, symbol: "USDC" }}
                  payer={account}
                  pendingAction={pendingAction}
                  quoteFactory={
                    request && expectations
                      ? () => createRecurringSupportInvoiceQuote(
                          checkout,
                          request,
                          expectations,
                        )
                      : undefined
                  }
                  request={request}
                  runAction={runAction}
                />
              )}
            </div>
          )}
        </div>
      ) : null}

      {canPublish && boardroomActive ? (
        <div className="mt-6 border-t border-zinc-800 pt-5">
          {!publisherOpen ? (
            <Button variant="secondary" onClick={() => setPublisherOpen(true)}>
              <Plus className="h-4 w-4" />
              Publish a support plan
            </Button>
          ) : (
            <div>
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 text-lime-300" />
                <div>
                  <h3 className="m-0 text-sm font-semibold text-zinc-100">
                    Publish immutable monthly terms
                  </h3>
                  <p className="m-0 mt-1 text-xs leading-5 text-zinc-500">
                    The Boardroom authority signs these terms. Changing the
                    amount or description requires a new plan.
                  </p>
                </div>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Label>
                  Plan title
                  <Input
                    maxLength={80}
                    value={title}
                    onChange={event => setTitle(event.target.value)}
                  />
                </Label>
                <Label>
                  Monthly USDC
                  <Input
                    inputMode="decimal"
                    value={amount}
                    onChange={event => setAmount(event.target.value)}
                  />
                </Label>
                <Label className="sm:col-span-2">
                  Description
                  <textarea
                    className="min-h-24 w-full resize-y rounded-[var(--pc-control-radius)] border border-[var(--pc-control-border)] bg-[var(--pc-control-surface)] px-3 py-2 text-sm font-normal text-[var(--pc-text)] outline-none transition-colors placeholder:text-[var(--pc-text-subtle)] hover:border-[var(--pc-control-border-hover)] focus:border-[var(--pc-focus)] focus:ring-2 focus:ring-[color:var(--pc-focus)]/20"
                    maxLength={280}
                    value={description}
                    onChange={event => setDescription(event.target.value)}
                  />
                </Label>
              </div>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <Button variant="ghost" onClick={() => setPublisherOpen(false)}>
                  Close
                </Button>
                <ActionButton
                  actionId="publish-recurring-support-plan"
                  disabled={!title.trim() || !description.trim() || !amount.trim()}
                  pendingAction={pendingAction}
                  pendingLabel="Publishing plan"
                  onClick={publishPlan}
                >
                  Publish terms
                </ActionButton>
              </div>
            </div>
          )}

          {selectedPlan?.status === "active" ? (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 pt-4">
              <p className="m-0 text-xs leading-5 text-zinc-500">
                Retiring stops new subscriptions and unpaid invoices. Settled
                contributions remain final.
              </p>
              {!confirmRetire ? (
                <Button size="sm" variant="ghost" onClick={() => setConfirmRetire(true)}>
                  Retire selected plan
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setConfirmRetire(false)}>
                    Keep plan
                  </Button>
                  <ActionButton
                    actionId={`retire-support-${selectedPlan.id}`}
                    pendingAction={pendingAction}
                    pendingLabel="Retiring"
                    size="sm"
                    variant="secondary"
                    onClick={retire}
                  >
                    Confirm retirement
                  </ActionButton>
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PlanFact({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <div className="bg-zinc-950 px-3 py-3">
      <dt className="text-[11px] font-medium uppercase tracking-[0.06em] text-zinc-600">
        {label}
      </dt>
      <dd className="m-0 mt-1 truncate text-sm font-semibold text-zinc-200">
        {value}
      </dd>
    </div>
  );
}

function formatSupportAmount(value: string): string {
  const formatted = formatUnits(BigInt(value), DESTINATION_USDC_DECIMALS);
  const [whole, fraction] = formatted.split(".");
  const compactFraction = fraction?.replace(/0+$/, "");
  return `${whole}${compactFraction ? `.${compactFraction}` : ""} USDC`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(new Date(value));
}

function shortHash(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function invoiceStatusLabel(
  status: RecurringSupportInvoice["status"] | undefined,
): string {
  if (status === "paid") return "Paid";
  if (status === "payment_pending") return "Payment pending";
  if (status === "cancelled") return "Cancelled";
  if (status === "manual_intervention") return "Needs review";
  return "Due";
}

function invoiceTone(
  status: RecurringSupportInvoice["status"] | undefined,
): "default" | "muted" | "warning" | "danger" {
  if (status === "paid") return "default";
  if (status === "payment_pending") return "warning";
  if (status === "manual_intervention") return "danger";
  return "muted";
}
