import { useEffect, useState } from "react";
import type { ProductBoardroomCatalogEntry, ProductBoardroomDashboardState } from "../../lib/product-boardroom";
import { currentUnixTimestamp } from "../../lib/market-data";
import { Metric, MetricGrid } from "../../app/pages/page-primitives";
import {
  catalogMarketViewModel,
  projectMarketViewModel,
  summarizeNetworkMarkets,
  type MarketMetricView,
} from "./market-view-model";

export function MarketMetricTiles({
  className,
  label,
  metrics,
}: {
  className?: string | undefined;
  label: string;
  metrics: readonly MarketMetricView[];
}): React.JSX.Element {
  return (
    <MetricGrid columns={3} label={label} {...(className ? { className } : {})}>
      {metrics.map((metric) => (
        <Metric detail={metric.detail} key={metric.label} label={metric.label} value={metric.value} />
      ))}
    </MetricGrid>
  );
}

export function ExploreMarketMetrics({ project }: { project: ProductBoardroomCatalogEntry }): React.JSX.Element {
  const now = useMarketBoundaryClock({ projects: [project] });
  const view = catalogMarketViewModel(project, now);
  return <MarketMetricTiles label={`${project.name ?? project.symbol ?? "Project"} market metrics`} metrics={view.metrics} />;
}

export function ExploreNetworkSummary({
  projects,
  totalProjects,
}: {
  projects: readonly ProductBoardroomCatalogEntry[];
  totalProjects?: number | undefined;
}): React.JSX.Element {
  const now = useMarketBoundaryClock({ projects });
  const summary = summarizeNetworkMarkets(projects, totalProjects, now);
  return (
    <MetricGrid className="mt-5" columns={4} label="Network project coverage">
      <Metric
        detail={totalProjects !== undefined && totalProjects > projects.length ? `${projects.length.toLocaleString()} loaded in this directory page.` : "Discovered from the selected network factory."}
        label="Discovered projects"
        value={summary.discoveredProjects.toLocaleString()}
      />
      <Metric
        detail="AMM, fixed-sale, or bonding-curve paths discovered in the loaded directory."
        label="Tradeable markets"
        value={summary.tradeableMarkets.toLocaleString()}
      />
      <Metric
        detail="Routes whose current catalog status is live. Open a project to verify exact limits."
        label="Active participation routes"
        value={summary.activeParticipationRoutes.toLocaleString()}
      />
      <Metric
        detail="Loaded projects with current-state, pool, or historical coverage warnings."
        label="Coverage warnings"
        value={summary.coverageWarnings.toLocaleString()}
      />
    </MetricGrid>
  );
}

export function ProjectMarketOverview({
  dashboard,
  loading = false,
}: {
  dashboard?: ProductBoardroomDashboardState | undefined;
  loading?: boolean | undefined;
}): React.JSX.Element {
  const now = useMarketBoundaryClock({ dashboard });
  if (!dashboard) {
    const detail = loading
      ? "Reading current route state, token supply, and reserve depth from the selected network."
      : "Load the canonical project contract to inspect its current market and participation truth.";
    return (
      <section aria-label="Project market overview" className="border-b border-[var(--pc-border)] py-5">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-base font-semibold text-[var(--pc-text)]">Market and participation</h2>
          <p className="m-0 text-sm leading-6 text-[var(--pc-text-muted)]">{detail}</p>
        </div>
      </section>
    );
  }

  const view = projectMarketViewModel(dashboard, now);
  const activityReason = view.activity24h.priceChange.status === "known"
    ? undefined
    : view.activity24h.priceChange.reason;

  return (
    <section aria-label="Project market overview" className="border-b border-[var(--pc-border)] py-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div>
          <h2 className="m-0 text-base font-semibold text-[var(--pc-text)]">Market and participation</h2>
          <p className="m-0 mt-1 max-w-3xl text-sm leading-6 text-[var(--pc-text-muted)]">
            Current route price, valuation, reserve depth, and liveness from exact contract and catalog reads. Every amount names its quote token.
          </p>
        </div>
        <p className="m-0 text-xs font-semibold text-[var(--pc-text-subtle)]">Source: {view.routeSource}</p>
      </div>
      <MarketMetricTiles className="mt-4" label="Current project market metrics" metrics={view.metrics} />
      <div className="mt-3 grid gap-2 text-xs leading-5 text-[var(--pc-text-subtle)] lg:grid-cols-2">
        <p className="m-0">
          <span className="font-semibold text-[var(--pc-text-muted)]">24-hour activity: Not indexed.</span>{" "}
          {activityReason}
        </p>
        <p className="m-0">
          Technical provenance: current values come from the canonical project contract, exact supply and treasury-balance reads, and the named route pool shown above; lifetime activity is reconstructed from their onchain event history. Unknown values retain their read or coverage reason instead of becoming zero.
        </p>
      </div>
    </section>
  );
}

export const MAX_MARKET_BOUNDARY_DELAY_MS = 2_147_000_000;

type MarketBoundaryClockInput = {
  dashboard?: ProductBoardroomDashboardState | undefined;
  projects?: readonly ProductBoardroomCatalogEntry[] | undefined;
};

type MarketBoundaryTimer = number | ReturnType<typeof setTimeout>;

type MarketBoundaryScheduler = {
  clearTimeoutFn?: ((timer: MarketBoundaryTimer) => void) | undefined;
  nowMilliseconds?: (() => number) | undefined;
  setTimeoutFn?: ((callback: () => void, delayMs: number) => MarketBoundaryTimer) | undefined;
};

export function useMarketBoundaryClock(input: MarketBoundaryClockInput): bigint {
  const [now, setNow] = useState(() => currentUnixTimestamp());
  const timingIdentity = marketTimingIdentity(input);
  useEffect(() => {
    setNow(currentUnixTimestamp());
    return scheduleMarketBoundaryRefresh(input, setNow);
  }, [timingIdentity]);
  return now;
}

export function nextMarketBoundaryMilliseconds(
  input: MarketBoundaryClockInput,
  nowMilliseconds = Date.now(),
): bigint | undefined {
  const now = BigInt(Math.floor(nowMilliseconds));
  const boundaries = marketBoundaries(input)
    .filter((boundary) => boundary > now)
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  return boundaries[0];
}

export function scheduleMarketBoundaryRefresh(
  input: MarketBoundaryClockInput,
  onRefresh: (now: bigint) => void,
  scheduler: MarketBoundaryScheduler = {},
): () => void {
  const nowMilliseconds = scheduler.nowMilliseconds ?? Date.now;
  const setTimeoutFn = scheduler.setTimeoutFn
    ?? ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs) as MarketBoundaryTimer);
  const clearTimeoutFn = scheduler.clearTimeoutFn
    ?? ((timer: MarketBoundaryTimer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  let cancelled = false;
  let timer: MarketBoundaryTimer | undefined;

  const scheduleNext = (): void => {
    if (cancelled) return;
    const currentMilliseconds = nowMilliseconds();
    const boundary = nextMarketBoundaryMilliseconds(input, currentMilliseconds);
    if (boundary === undefined) return;
    const remaining = boundary - BigInt(Math.floor(currentMilliseconds));
    const delay = Number(remaining > BigInt(MAX_MARKET_BOUNDARY_DELAY_MS)
      ? BigInt(MAX_MARKET_BOUNDARY_DELAY_MS)
      : remaining);
    timer = setTimeoutFn(() => {
      if (cancelled) return;
      if (BigInt(Math.floor(nowMilliseconds())) >= boundary) {
        onRefresh(currentUnixTimestamp(nowMilliseconds()));
      }
      scheduleNext();
    }, delay);
  };

  scheduleNext();
  return () => {
    cancelled = true;
    if (timer !== undefined) clearTimeoutFn(timer);
  };
}

function marketBoundaries(input: MarketBoundaryClockInput): bigint[] {
  const boundaries: bigint[] = [];
  if (input.dashboard?.snapshot.status === 0) {
    for (const distribution of input.dashboard.snapshot.distributionSummaries) {
      const state = distribution.state;
      if (!state || state.closed) continue;
      if (distribution.kind === "bond-market" && "live" in state) {
        if (state.status === 0) {
          boundaries.push(BigInt(state.startTime) * 1_000n);
          boundaries.push(BigInt(state.conclusion) * 1_000n);
        }
        continue;
      }
      if (!("endTime" in state)) continue;
      const routeStatus = "saleStatus" in state
        ? state.saleStatus
        : "curveStatus" in state
          ? state.curveStatus
          : state.airdropStatus;
      addMarketBoundaries(boundaries, routeStatus, state.startTime, state.endTime);
    }
  }
  for (const project of input.projects ?? []) {
    if (
      project.boardroomStatus !== 0
      || project.routeStatus === undefined
      || project.routeClosed !== false
      || project.routeStartTime === undefined
      || project.routeEndTime === undefined
    ) continue;
    addMarketBoundaries(boundaries, project.routeStatus, project.routeStartTime, project.routeEndTime);
  }
  return boundaries;
}

function addMarketBoundaries(
  boundaries: bigint[],
  routeStatus: number,
  startTime: bigint,
  endTime: bigint,
): void {
  if (routeStatus !== 0) return;
  boundaries.push(startTime * 1_000n);
  if (endTime !== 0n) boundaries.push((endTime + 1n) * 1_000n);
}

function marketTimingIdentity(input: MarketBoundaryClockInput): string {
  const dashboardIdentity = input.dashboard
    ? [
        input.dashboard.address.toLowerCase(),
        input.dashboard.snapshot.status,
        ...input.dashboard.snapshot.distributionSummaries.map((distribution) => {
          const state = distribution.state;
          if (!state) return `${distribution.address.toLowerCase()}:unread`;
          if (distribution.kind === "bond-market" && "live" in state) {
            return [
              distribution.address.toLowerCase(),
              state.status,
              state.closed ? 1 : 0,
              state.startTime,
              state.conclusion,
              state.capacity,
              state.live ? 1 : 0,
            ].join(":");
          }
          if (!("endTime" in state)) return `${distribution.address.toLowerCase()}:unread`;
          const routeStatus = "saleStatus" in state
            ? state.saleStatus
            : "curveStatus" in state
              ? state.curveStatus
              : state.airdropStatus;
          return [distribution.address.toLowerCase(), routeStatus, state.closed ? 1 : 0, state.startTime, state.endTime].join(":");
        }),
      ].join("|")
    : "no-dashboard";
  const projectIdentity = (input.projects ?? []).map((project) => [
    project.address.toLowerCase(),
    project.boardroomStatus ?? "unknown",
    project.routeStatus ?? "unknown",
    project.routeClosed === undefined ? "unknown" : project.routeClosed ? 1 : 0,
    project.routeStartTime ?? "unknown",
    project.routeEndTime ?? "unknown",
  ].join(":")).join("|");
  return `${dashboardIdentity}::${projectIdentity}`;
}
