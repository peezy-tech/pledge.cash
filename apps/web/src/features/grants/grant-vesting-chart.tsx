import { Badge } from "../../components/ui/badge";
import { dateString } from "../../lib/forms";
import { formatTokenAmount, type TokenMetadata } from "../../lib/token-amounts";

type GrantVestingState = {
  grantSize: bigint;
  claimable: bigint;
  settledAmount: bigint;
  settleable: bigint;
  vestingCliff: bigint;
  vestingEnd: bigint;
  expiry: bigint;
  halted: boolean;
  closed: boolean;
};

type VestingSegment = {
  label: string;
  amount: bigint;
  className: string;
  formattedAmount: string;
  width: string;
};

type VestingMetrics = {
  futureClaimable: bigint;
  removed: bigint;
  settled: bigint;
  settleable: bigint;
  timePercent: number;
  total: bigint;
};

type VestingStatus = {
  label: string;
  tone: "default" | "muted" | "warning" | "danger";
};

type VestingViewModel = {
  metrics: VestingMetrics;
  segments: VestingSegment[];
  status: VestingStatus;
};

export function GrantVestingChart({
  state,
  title = "Vesting schedule",
  tokenMetadata,
}: {
  state: GrantVestingState | undefined;
  title?: string;
  tokenMetadata: TokenMetadata | undefined;
}): React.JSX.Element | null {
  if (!state) return null;

  const view = vestingViewModel(state, tokenMetadata, unixTimestamp());

  return (
    <section className="border-t border-zinc-800 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-sm font-semibold text-zinc-100">{title}</h3>
        <Badge variant={view.status.tone}>{view.status.label}</Badge>
      </div>
      <div className="relative h-3 overflow-hidden rounded-sm bg-zinc-900" aria-label={title}>
        <div className="flex h-full w-full">
          {view.segments.map((segment) => (
            <div
              className={segment.className}
              key={segment.label}
              style={{ width: segment.width }}
              title={`${segment.label}: ${segment.formattedAmount}`}
            />
          ))}
        </div>
        <div
          className="absolute inset-y-0 w-px bg-zinc-50/80 shadow-[0_0_0_1px_rgba(9,9,11,0.9)]"
          style={{ left: cssPercent(view.metrics.timePercent) }}
          title="Now"
        />
      </div>
      <div className="mt-3 grid gap-2 text-xs text-zinc-500 sm:grid-cols-4">
        {view.segments.map((segment) => (
          <div className="min-w-0" key={segment.label}>
            <div className="mb-1 flex items-center gap-1.5">
              <span className={`h-2 w-2 shrink-0 rounded-sm ${segment.className}`} />
              <span className="font-medium text-zinc-400">{segment.label}</span>
            </div>
            <div className="truncate" title={segment.formattedAmount}>
              {segment.formattedAmount}
            </div>
          </div>
        ))}
      </div>
      <dl className="mt-3 grid gap-2 border-t border-zinc-800 pt-3 text-xs sm:grid-cols-3">
        <VestingDate label="Cliff" timestamp={state.vestingCliff} />
        <VestingDate label="End" timestamp={state.vestingEnd} />
        <VestingDate label="Expiry" timestamp={state.expiry} />
      </dl>
    </section>
  );
}

function vestingViewModel(
  state: GrantVestingState,
  tokenMetadata: TokenMetadata | undefined,
  now: bigint,
): VestingViewModel {
  const metrics = vestingMetrics(state, now);
  const status = vestingStatus(state, now);
  const segments = vestingSegments(metrics, tokenMetadata);

  return { metrics, segments, status };
}

function vestingSegments(metrics: VestingMetrics, tokenMetadata: TokenMetadata | undefined): VestingSegment[] {
  return [
    segmentView("Settled", metrics.settled, "bg-lime-300", metrics.total, tokenMetadata),
    segmentView("Settleable", metrics.settleable, "bg-amber-300", metrics.total, tokenMetadata),
    segmentView("Future", metrics.futureClaimable, "bg-sky-400/70", metrics.total, tokenMetadata),
    segmentView("Removed", metrics.removed, "bg-zinc-700", metrics.total, tokenMetadata),
  ];
}

function segmentView(
  label: string,
  amount: bigint,
  className: string,
  total: bigint,
  tokenMetadata: TokenMetadata | undefined,
): VestingSegment {
  return {
    amount,
    className,
    formattedAmount: formatTokenAmount(amount, tokenMetadata),
    label,
    width: cssPercent(percentOf(amount, total)),
  };
}

function VestingDate({ label, timestamp }: { label: string; timestamp: bigint }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="font-medium text-zinc-500">{label}</dt>
      <dd className="m-0 mt-1 truncate text-zinc-300" title={dateString(timestamp)}>
        {dateString(timestamp)}
      </dd>
    </div>
  );
}

function vestingMetrics(state: GrantVestingState, now: bigint): VestingMetrics {
  const total = state.grantSize > 0n ? state.grantSize : state.claimable;
  const claimable = clampAmount(state.claimable, 0n, total);
  const settled = clampAmount(state.settledAmount, 0n, claimable);
  const settleable = clampAmount(state.settleable, 0n, claimable - settled);
  const futureClaimable = claimable - settled - settleable;
  const removed = total - claimable;

  return {
    futureClaimable,
    removed,
    settled,
    settleable,
    timePercent: schedulePercent(state, now),
    total,
  };
}

function schedulePercent(state: GrantVestingState, now: bigint): number {
  if (state.vestingEnd <= state.vestingCliff) return now >= state.vestingEnd ? 100 : 0;
  if (now <= state.vestingCliff) return 0;
  if (now >= state.vestingEnd) return 100;
  return percentOf(now - state.vestingCliff, state.vestingEnd - state.vestingCliff);
}

function vestingStatus(state: GrantVestingState, now: bigint): VestingStatus {
  if (state.closed) return { label: "Closed", tone: "muted" };
  if (state.halted) return { label: "Halted", tone: "warning" };
  if (now < state.vestingCliff) return { label: "Cliff pending", tone: "muted" };
  if (state.settleable > 0n) return { label: "Settleable", tone: "default" };
  if (now >= state.vestingEnd) return { label: "Fully vested", tone: "default" };
  return { label: "Vesting", tone: "default" };
}

function percentOf(amount: bigint, total: bigint): number {
  if (amount <= 0n || total <= 0n) return 0;
  const basisPoints = (amount * 10_000n) / total;
  return Number(basisPoints) / 100;
}

function cssPercent(value: number): string {
  return `${Math.max(0, Math.min(100, value)).toFixed(2)}%`;
}

function clampAmount(value: bigint, min: bigint, max: bigint): bigint {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function unixTimestamp(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}
