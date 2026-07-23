import type { Address } from "@pledge.cash/sdk";
import type { NotificationDeliveryDto } from "@pledge.cash/sentinel/dto";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Loader2,
  RefreshCw,
  RotateCw,
  TriangleAlert,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { appRouteHref } from "../../app/routing";
import { AddressLink, Panel } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import { Button, ButtonLink } from "../../components/ui/button";
import type { SentinelClient } from "../../lib/sentinel";
import { errorMessage, formatSentinelDate } from "./hooks";

type DeliveryActivityProps = {
  client: SentinelClient;
};

type DeliveryActivityRowsProps = {
  deliveries: readonly NotificationDeliveryDto[];
};

const pageSize = 10;

export function DeliveryActivity({ client }: DeliveryActivityProps): React.JSX.Element {
  const [deliveries, setDeliveries] = useState<NotificationDeliveryDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(
    async (options: { append?: boolean; cursor?: string; signal?: AbortSignal } = {}): Promise<void> => {
      const append = options.append === true;
      append ? setLoadingMore(true) : setLoading(true);
      setError(undefined);
      try {
        const response = await client.listNotificationDeliveries(
          { ...(options.cursor === undefined ? {} : { cursor: options.cursor }), limit: pageSize },
          options.signal,
        );
        setDeliveries((current) => append ? [...current, ...response.items] : response.items);
        setNextCursor(response.page.nextCursor);
      } catch (error) {
        if (options.signal?.aborted) return;
        setError(errorMessage(error));
      } finally {
        if (!options.signal?.aborted) {
          append ? setLoadingMore(false) : setLoading(false);
        }
      }
    },
    [client],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load({ signal: controller.signal });
    return () => controller.abort();
  }, [load]);

  return (
    <Panel
      title="Recent deliveries"
      description="Account-scoped receipts for alerts Sentinel prepared for your delivery channels."
      action={
        <Button disabled={loading || loadingMore} type="button" variant="secondary" onClick={() => void load()}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </Button>
      }
    >
      {error ? (
        <div className="flex flex-col gap-3 border-t border-red-950 bg-red-950/35 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="m-0 text-sm text-red-200" role="alert">{error}</p>
          <Button size="sm" type="button" variant="ghost" onClick={() => void load()}>Retry</Button>
        </div>
      ) : null}
      <p aria-live="polite" className="sr-only" role="status">
        {loading ? "Loading delivery receipts." : loadingMore ? "Loading earlier delivery receipts." : `${deliveries.length.toString()} delivery receipts shown.`}
      </p>
      <div aria-busy={loading || loadingMore}>
        {loading && deliveries.length === 0 ? (
          <p className="m-0 border-t border-zinc-800 p-4 text-sm text-zinc-500">Loading delivery receipts</p>
        ) : deliveries.length === 0 ? (
          <div className="border-t border-zinc-800 p-4">
            <p className="m-0 text-sm font-medium text-zinc-300">No delivery receipts yet</p>
            <p className="m-0 mt-1 text-sm leading-5 text-zinc-500">
              Receipts appear after a matching governance event is prepared for an enabled channel.
            </p>
          </div>
        ) : (
          <DeliveryActivityRows deliveries={deliveries} />
        )}
      </div>
      {nextCursor !== null ? (
        <div className="flex justify-center border-t border-zinc-800 p-3">
          <Button
            disabled={loading || loadingMore}
            size="sm"
            type="button"
            variant="ghost"
            onClick={() => void load({ append: true, cursor: nextCursor })}
          >
            {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Load earlier receipts
          </Button>
        </div>
      ) : null}
    </Panel>
  );
}

export function DeliveryActivityRows({ deliveries }: DeliveryActivityRowsProps): React.JSX.Element {
  return (
    <ol className="m-0 grid list-none gap-px border-t border-zinc-800 bg-zinc-800 p-0">
      {deliveries.map((delivery) => (
        <DeliveryReceiptRow delivery={delivery} key={delivery.id} />
      ))}
    </ol>
  );
}

function DeliveryReceiptRow({ delivery }: { delivery: NotificationDeliveryDto }): React.JSX.Element {
  const status = deliveryStatus(delivery);
  return (
    <li className="grid min-w-0 gap-3 bg-zinc-950 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.34fr)] lg:items-start">
      <div className="min-w-0">
        <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
          <Badge variant={status.tone}>{status.icon}{status.label}</Badge>
          <Badge variant="muted">{channelLabel(delivery.channelType)}</Badge>
          <span className="text-xs font-semibold uppercase tracking-[0.06em] text-zinc-500">
            {eventLabel(delivery.event)}
          </span>
        </div>
        <p className="m-0 text-sm leading-6 text-zinc-300">
          {delivery.summary ?? "Sentinel recorded a governance update."}
        </p>
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
          <span>Boardroom</span>
          <AddressLink address={delivery.action.boardroom as Address} chainId={delivery.action.chainId} />
          {delivery.severity ? <span className="capitalize">{delivery.severity} severity</span> : null}
        </div>
      </div>
      <div className="grid gap-2 text-sm text-zinc-400 lg:justify-items-end lg:text-right">
        <div>{status.detail}</div>
        {delivery.attempts > 0 ? (
          <div className="text-xs text-zinc-500">
            {delivery.attempts.toString()} delivery {delivery.attempts === 1 ? "attempt" : "attempts"}
          </div>
        ) : null}
        <ButtonLink href={notificationDeliveryHref(delivery)} size="sm" variant="ghost">
          Review operation
          <ArrowRight className="h-3.5 w-3.5" />
        </ButtonLink>
      </div>
    </li>
  );
}

export function notificationDeliveryHref(
  delivery: Pick<NotificationDeliveryDto, "action">,
  baseUrl = import.meta.env.BASE_URL || "/",
): string {
  const query = new URLSearchParams({
    operation: delivery.action.operationId,
    boardroom: delivery.action.boardroom,
    chain: delivery.action.chainId.toString(),
  });
  return `${appRouteHref({ kind: "alerts" }, baseUrl)}?${query.toString()}`;
}

function deliveryStatus(delivery: NotificationDeliveryDto): {
  detail: string;
  icon: React.ReactNode;
  label: string;
  tone: "default" | "muted" | "warning" | "danger";
} {
  switch (delivery.status) {
    case "sent":
      return {
        detail: `Delivered ${formatSentinelDate(delivery.sentAt ?? delivery.updatedAt)}`,
        icon: <CheckCircle2 className="h-3.5 w-3.5" />,
        label: "Delivered",
        tone: "default",
      };
    case "failed":
      return {
        detail: `Retry scheduled ${formatSentinelDate(delivery.nextAttemptAt)}`,
        icon: <RotateCw className="h-3.5 w-3.5" />,
        label: "Retry scheduled",
        tone: "warning",
      };
    case "dead":
      return {
        detail: "Review or replace the delivery channel.",
        icon: <TriangleAlert className="h-3.5 w-3.5" />,
        label: "Delivery stopped",
        tone: "danger",
      };
    case "pending":
      return {
        detail: `Queued ${formatSentinelDate(delivery.createdAt)}`,
        icon: <Clock3 className="h-3.5 w-3.5" />,
        label: "Queued",
        tone: "muted",
      };
  }
}

function channelLabel(channel: NotificationDeliveryDto["channelType"]): string {
  return channel === "telegram" ? "Telegram" : "X";
}

function eventLabel(event: NotificationDeliveryDto["event"]): string {
  switch (event) {
    case "policy-admin":
      return "Policy update";
    case "reminder":
      return "Execution reminder";
    default:
      return event;
  }
}
