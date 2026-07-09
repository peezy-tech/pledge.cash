import type { Address } from "@pledge.cash/sdk";
import type { ActionStatusDto, PublicActionDto, SeverityDto } from "@pledge.cash/sentinel/dto";
import { CheckCircle2, Clock3, Loader2, RefreshCw, XCircle } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Hex } from "viem";
import { AddressLink, Panel, TransactionLink } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { shortAddress } from "../../lib/forms";
import { createSentinelClient, getSentinelBaseUrl } from "../../lib/sentinel";
import { errorMessage, formatSentinelDate } from "./hooks";

type GovernanceActivityProps = {
  boardroom: Address | undefined;
  chainId: number;
  highlightActionHash?: string | undefined;
};

export function GovernanceActivity({ boardroom, chainId, highlightActionHash }: GovernanceActivityProps): React.JSX.Element | null {
  const baseUrl = getSentinelBaseUrl();
  const client = useMemo(() => (baseUrl ? createSentinelClient({ baseUrl }) : undefined), [baseUrl]);
  const [actions, setActions] = useState<PublicActionDto[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    if (!client) return;

    setLoading(true);
    setError(undefined);
    try {
      const response = boardroom
        ? await client.listBoardroomActions({ address: boardroom, chainId, query: { limit: 6 } })
        : await client.listPublicActions({ chainId, limit: 6 });
      setActions(response.items);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [boardroom, chainId, client]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!client) return null;

  return (
    <Panel
      title="Governance Activity"
      description="Queued, cancelled, and executed Boardroom actions from the public Sentinel feed."
      action={
        <Button disabled={loading} variant="secondary" onClick={() => void load()}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </Button>
      }
    >
      {error ? <p className="m-0 border-t border-red-950 bg-red-950/35 p-4 text-sm text-red-200">{error}</p> : null}
      <ol className="m-0 grid list-none gap-px border-t border-zinc-800 bg-zinc-800 p-0">
        {actions.length === 0 ? (
          <li className="bg-zinc-950 p-4 text-sm text-zinc-500">
            {loading ? "Loading governance activity" : "No governance activity"}
          </li>
        ) : (
          actions.map((action) => (
            <GovernanceActionRow
              action={action}
              highlighted={sameActionHash(action.actionHash, highlightActionHash)}
              key={action.id}
            />
          ))
        )}
      </ol>
    </Panel>
  );
}

function GovernanceActionRow({ action, highlighted }: { action: PublicActionDto; highlighted: boolean }): React.JSX.Element {
  const severity = action.risk?.severity;
  const explanation =
    action.analysis?.summary
    ?? action.analysis?.severityRationale
    ?? action.risk?.findings[0]?.detail
    ?? "No analysis is available yet.";
  const event = action.event ?? action.status;
  const callLabel = action.calls.length === 0
    ? "No decoded calls"
    : action.calls.map((call) => call.decodedFunction ?? call.selector).join(", ");

  const itemClassName = [
    "grid min-w-0 gap-3 bg-zinc-950 p-4 xl:grid-cols-[minmax(0,1fr)_minmax(180px,0.28fr)] xl:items-start",
    highlighted ? "ring-1 ring-inset ring-cyan-500/70" : "",
  ].filter(Boolean).join(" ");

  return (
    <li className={itemClassName}>
      <div className="min-w-0">
        <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
          <Badge variant={statusTone(event)}>{statusIcon(event)}{event}</Badge>
          <Badge variant={severityTone(severity)}>{severity ?? "unrated"}</Badge>
          <span className="truncate text-sm font-semibold text-zinc-100">
            {action.boardroom.name ?? shortAddress(action.boardroom.address)}
          </span>
        </div>
        <p className="m-0 text-sm leading-6 text-zinc-300">{explanation}</p>
        <div className="mt-2 truncate text-xs text-zinc-500" title={callLabel}>
          {callLabel}
        </div>
      </div>
      <div className="grid gap-2 text-sm text-zinc-400 xl:justify-items-end">
        <div>ETA {formatSentinelDate(action.eta)}</div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 xl:justify-end">
          <span className="text-zinc-500">Boardroom</span>
          <AddressLink address={action.boardroom.address as Address} />
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 xl:justify-end">
          <span className="text-zinc-500">Queued</span>
          <TransactionLink chainId={action.chainId} hash={action.queueTxHash as Hex} />
        </div>
      </div>
    </li>
  );
}

function statusIcon(status: ActionStatusDto): React.ReactNode {
  if (status === "queued") return <Clock3 className="h-3.5 w-3.5" />;
  if (status === "executed") return <CheckCircle2 className="h-3.5 w-3.5" />;
  return <XCircle className="h-3.5 w-3.5" />;
}

function statusTone(status: ActionStatusDto): "default" | "muted" | "warning" | "danger" {
  if (status === "queued") return "warning";
  if (status === "executed") return "default";
  return "muted";
}

function severityTone(severity: SeverityDto | undefined): "default" | "muted" | "warning" | "danger" {
  if (severity === "high") return "danger";
  if (severity === "medium") return "warning";
  if (severity === "low") return "default";
  return "muted";
}

function sameActionHash(left: string | undefined, right: string | undefined): boolean {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}
