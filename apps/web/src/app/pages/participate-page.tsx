import type { Address } from "@pledge.cash/sdk";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AddressLink } from "../../components/shell";
import { Badge } from "../../components/ui/badge";
import {
  participationAmmKey,
  participationDistributionKey,
  participationPathFromContentKey,
  type ParticipationContentKey,
  type ParticipationRoutePath,
} from "../../features/participation/types";
import { shortAddress } from "../../lib/forms";
import {
  currentUnixTimestamp,
  deriveExecutableDistributionRoute,
  routeLiveness,
  routeLivenessForAmm,
  type ExecutableDistributionRoute,
  type RouteLiveness,
} from "../../lib/market-data";
import { projectPoolAddresses } from "../../lib/project-pools";
import type { ProductBoardroomDashboardState } from "../../lib/product-boardroom";
import type { SwapPoolSummary } from "../../lib/swap";
import { formatTokenAmount } from "../../lib/token-amounts";
import type { BoardroomDistributionSnapshot } from "../../lib/types";
import { cn } from "../../lib/utils";
import { KeyValueList, PageNotice, RuledSection, SectionHeading } from "./page-primitives";

export type ParticipationPath = ParticipationRoutePath;
export type ParticipationRouteGroup = "live" | "checking" | "unavailable" | "closed" | "unknown";

export type ParticipationPoolMarketState = {
  error?: string | undefined;
  loaded: boolean;
  loading: boolean;
  pools: readonly SwapPoolSummary[];
};

export type ParticipationOption = {
  address?: Address;
  available: boolean;
  buyAvailable?: boolean | undefined;
  claimAvailable?: boolean | undefined;
  description: string;
  group: ParticipationRouteGroup;
  id: ParticipationContentKey;
  label: string;
  liveness: RouteLiveness;
  path: ParticipationPath;
  reason?: string | undefined;
  remaining?: bigint;
  sellAvailable?: boolean | undefined;
  status: string;
  tokenSymbol?: string;
};

export type ParticipatePageProps = {
  content?: Partial<Record<ParticipationContentKey, ReactNode>>;
  dashboard?: ProductBoardroomDashboardState | undefined;
  error?: string | undefined;
  loading: boolean;
  onSelectPath?: ((path: ParticipationPath) => void) | undefined;
  onSelectRoute?: ((route: ParticipationContentKey) => void) | undefined;
  poolMarket?: ParticipationPoolMarketState | undefined;
  selectedPath?: ParticipationPath | undefined;
  selectedRoute?: ParticipationContentKey | undefined;
};

const routeGroups: readonly { id: ParticipationRouteGroup; label: string; description: string }[] = [
  { id: "live", label: "Live now", description: "Current contract state supports an action now." },
  { id: "checking", label: "Checking", description: "Current route state is still being verified." },
  { id: "unavailable", label: "Unavailable", description: "A current read, token pair, or liquidity condition blocks this route." },
  { id: "closed", label: "Closed / history-only", description: "The contract remains available for inspection but no longer accepts actions." },
  { id: "unknown", label: "Unknown", description: "There is not enough verified current state to classify this route." },
];

export const MAX_PARTICIPATION_REFRESH_DELAY_MS = 2_147_000_000;

type ParticipationSelectionInput = {
  automaticSelection?: ParticipationContentKey | undefined;
  localSelection?: ParticipationContentKey | undefined;
  selectedPath?: ParticipationPath | undefined;
  selectedRoute?: ParticipationContentKey | undefined;
};

export type ParticipationSelectionResolution = {
  automatic: boolean;
  route?: ParticipationContentKey | undefined;
};

export function resolveParticipationSelection(
  options: readonly ParticipationOption[],
  input: ParticipationSelectionInput,
): ParticipationSelectionResolution {
  const requestedSelection = input.selectedRoute ?? input.selectedPath;
  const controlledSelection = validSelection(requestedSelection, options);
  const controlledSelectionIsExact = controlledSelection === requestedSelection;
  const controlledSelectionIsAutomatic = Boolean(
    controlledSelection
      && input.automaticSelection
      && controlledSelection === input.automaticSelection,
  );
  const userSelection = controlledSelection && controlledSelectionIsExact && !controlledSelectionIsAutomatic
    ? controlledSelection
    : validSelection(input.localSelection, options);
  const route = userSelection ?? firstAvailableRoute(options) ?? options[0]?.id;
  return { automatic: Boolean(route && !userSelection), ...(route ? { route } : {}) };
}

export function nextParticipationSelectionNotification(
  previousKey: string | undefined,
  scope: string,
  selection: ParticipationSelectionResolution,
): { key: string | undefined; notify: boolean } {
  if (!selection.automatic || !selection.route) return { key: previousKey, notify: false };
  const key = `${scope}:${selection.route}`;
  return { key, notify: key !== previousKey };
}

type ParticipationRefreshTimer = number | ReturnType<typeof setTimeout>;

type ParticipationRefreshScheduler = {
  clearTimeoutFn?: ((timer: ParticipationRefreshTimer) => void) | undefined;
  nowMilliseconds?: (() => number) | undefined;
  setTimeoutFn?: ((callback: () => void, delayMs: number) => ParticipationRefreshTimer) | undefined;
};

export function participationRefreshDelayMs(
  dashboard: ProductBoardroomDashboardState | undefined,
  nowMilliseconds = Date.now(),
): number | undefined {
  if (!dashboard || dashboard.snapshot.status !== 0) return undefined;
  const now = BigInt(Math.floor(nowMilliseconds));
  const boundaries: bigint[] = [];
  for (const distribution of dashboard.snapshot.distributionSummaries) {
    const state = distribution.state;
    if (!state || state.closed) continue;
    if (distribution.kind === "bond-market" && "live" in state) {
      if (state.status !== 0) continue;
      boundaries.push(BigInt(state.startTime) * 1_000n);
      boundaries.push(BigInt(state.conclusion) * 1_000n);
      continue;
    }
    if (!("startTime" in state) || !("endTime" in state)) continue;
    const routeStatus = "saleStatus" in state
      ? state.saleStatus
      : "curveStatus" in state
        ? state.curveStatus
        : state.airdropStatus;
    if (routeStatus !== 0) continue;
    boundaries.push(state.startTime * 1_000n);
    if (state.endTime !== 0n) {
      boundaries.push((state.endTime + (distribution.kind === "dutch-auction" ? 0n : 1n)) * 1_000n);
    }
  }
  const nextBoundary = boundaries
    .filter((boundary) => boundary > now)
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0)[0];
  if (nextBoundary === undefined) return undefined;
  const delay = nextBoundary - now;
  return Number(delay > BigInt(MAX_PARTICIPATION_REFRESH_DELAY_MS)
    ? BigInt(MAX_PARTICIPATION_REFRESH_DELAY_MS)
    : delay);
}

export function scheduleParticipationRefresh(
  dashboard: ProductBoardroomDashboardState | undefined,
  onRefresh: (now: bigint) => void,
  scheduler: ParticipationRefreshScheduler = {},
): () => void {
  const nowMilliseconds = scheduler.nowMilliseconds ?? Date.now;
  const setTimeoutFn = scheduler.setTimeoutFn
    ?? ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs) as ParticipationRefreshTimer);
  const clearTimeoutFn = scheduler.clearTimeoutFn
    ?? ((activeTimer: ParticipationRefreshTimer) => clearTimeout(activeTimer as ReturnType<typeof setTimeout>));
  let cancelled = false;
  let timer: ParticipationRefreshTimer | undefined;

  const scheduleNext = (): void => {
    if (cancelled) return;
    const delay = participationRefreshDelayMs(dashboard, nowMilliseconds());
    if (delay === undefined) return;
    timer = setTimeoutFn(() => {
      if (cancelled) return;
      onRefresh(currentUnixTimestamp(nowMilliseconds()));
      scheduleNext();
    }, delay);
  };

  scheduleNext();
  return () => {
    cancelled = true;
    if (timer !== undefined) clearTimeoutFn(timer);
  };
}

function participationTimingIdentity(dashboard: ProductBoardroomDashboardState | undefined): string {
  if (!dashboard) return "no-project";
  return [
    dashboard.address.toLowerCase(),
    dashboard.snapshot.status.toString(),
    ...dashboard.snapshot.distributionSummaries.map((distribution) => {
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
      if (!("startTime" in state) || !("endTime" in state)) return `${distribution.address.toLowerCase()}:unread`;
      const routeStatus = "saleStatus" in state
        ? state.saleStatus
        : "curveStatus" in state
          ? state.curveStatus
          : state.airdropStatus;
      return [distribution.address.toLowerCase(), routeStatus, state.closed ? 1 : 0, state.startTime, state.endTime].join(":");
    }),
  ].join("|");
}

export function ParticipatePage({
  content = {},
  dashboard,
  error,
  loading,
  onSelectPath,
  onSelectRoute,
  poolMarket,
  selectedPath,
  selectedRoute,
}: ParticipatePageProps): React.JSX.Element {
  const [routeNow, setRouteNow] = useState(() => currentUnixTimestamp());
  const timingIdentity = participationTimingIdentity(dashboard);
  useEffect(() => {
    setRouteNow(currentUnixTimestamp());
    return scheduleParticipationRefresh(dashboard, setRouteNow);
  }, [dashboard, timingIdentity]);

  const options = useMemo(
    () => participationOptions(dashboard, content, poolMarket, routeNow),
    [content, dashboard, poolMarket, routeNow],
  );
  const selectionScope = dashboard?.address.toLowerCase() ?? "unscoped";
  const [localSelection, setLocalSelection] = useState<{ route: ParticipationContentKey; scope: string }>();
  const automaticSelectionRef = useRef<ParticipationContentKey | undefined>(undefined);
  const notificationKeyRef = useRef<string | undefined>(undefined);
  const scopedLocalSelection = localSelection?.scope === selectionScope ? localSelection.route : undefined;
  const selection = resolveParticipationSelection(options, {
    automaticSelection: automaticSelectionRef.current,
    localSelection: scopedLocalSelection,
    selectedPath,
    selectedRoute,
  });
  const activeRoute = selection.route;
  const activeOption = options.find((option) => option.id === activeRoute);
  const activeContent = activeOption ? content[activeOption.id] ?? content[activeOption.path] : undefined;
  const actionableContent =
    activeOption?.available || activeOption?.path === "support"
      ? activeContent
      : undefined;

  useEffect(() => {
    const notification = nextParticipationSelectionNotification(notificationKeyRef.current, selectionScope, selection);
    notificationKeyRef.current = notification.key;
    if (!notification.notify || !selection.route) return;
    automaticSelectionRef.current = selection.route;
    onSelectRoute?.(selection.route);
    const option = options.find((candidate) => candidate.id === selection.route);
    if (option) onSelectPath?.(option.path);
  }, [onSelectPath, onSelectRoute, options, selection, selectionScope]);

  const selectRoute = (option: ParticipationOption): void => {
    automaticSelectionRef.current = undefined;
    notificationKeyRef.current = undefined;
    setLocalSelection({ route: option.id, scope: selectionScope });
    onSelectRoute?.(option.id);
    onSelectPath?.(option.path);
  };

  if (loading && !dashboard) {
    return <ParticipationLoading />;
  }

  return (
    <>
      <RuledSection>
        <SectionHeading
          title="Choose how to participate"
          description="Live routes are listed first. Checking, unavailable, closed, and unknown routes remain visible with the exact state that prevents an action."
        />
        {error ? (
          <div className="mt-4"><PageNotice title="Participation data is incomplete" tone="danger">{error}</PageNotice></div>
        ) : null}
        {options.length === 0 ? (
          <div className="mt-5">
            <PageNotice title="No participation route is available">
              This project has no readable bond, sale, curve, airdrop, or AMM market. Its transparency record remains available.
            </PageNotice>
          </div>
        ) : options.length === 1 && activeOption ? (
          <div className="mt-5">
            <section aria-label={`${activeOption.label} participation workflow`}>
              {actionableContent ?? (
                <PageNotice title={activeOption.available ? "Action controls are not loaded" : activeOption.status}>
                  {activeOption.available
                    ? "The project data is readable, but the transaction workflow has not been attached to this page."
                    : unavailableRouteGuidance(activeOption, options)}
                </PageNotice>
              )}
            </section>
            <SingleParticipationDetails dashboard={dashboard} option={activeOption} />
          </div>
        ) : (
          <div className="mt-5 grid border-y border-zinc-800 lg:grid-cols-[minmax(280px,0.72fr)_minmax(0,1.28fr)]">
            <div aria-label="Participation routes" className="border-b border-zinc-800 lg:border-b-0 lg:border-r" role="group">
              {routeGroups.map((group) => {
                const groupedOptions = options.filter((option) => option.group === group.id);
                if (groupedOptions.length === 0) return null;
                return (
                  <section aria-labelledby={`participation-group-${group.id}`} className="border-b border-zinc-800 last:border-b-0" key={group.id}>
                    <div className="bg-zinc-950/70 px-4 py-3">
                      <h2 className="m-0 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-300" id={`participation-group-${group.id}`}>{group.label}</h2>
                      <p className="m-0 mt-1 text-xs leading-5 text-zinc-600">{group.description}</p>
                    </div>
                    {groupedOptions.map((option) => (
                      <button
                        aria-controls={`participation-panel-${routeDomId(option.id)}`}
                        aria-pressed={activeRoute === option.id}
                        className={cn(
                          "group grid w-full gap-2 border-t border-zinc-800 px-4 py-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-lime-300/70",
                          activeRoute === option.id ? "bg-zinc-900/70" : "hover:bg-zinc-900/35",
                        )}
                        id={`participation-route-${routeDomId(option.id)}`}
                        key={option.id}
                        type="button"
                        onClick={() => selectRoute(option)}
                      >
                        <span className="flex items-center justify-between gap-3">
                          <span className="font-semibold text-zinc-100">{option.label}</span>
                          <Badge variant={option.available ? "default" : option.group === "unavailable" ? "warning" : "muted"}>{option.status}</Badge>
                        </span>
                        <span className="text-xs leading-5 text-zinc-500">
                          {option.address ? `${shortAddress(option.address)} · ` : ""}{option.description}
                        </span>
                        {option.reason ? <span className="text-xs leading-5 text-zinc-400">{option.reason}</span> : null}
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-500 group-hover:text-lime-200">
                          Review route <ArrowRight className="h-3.5 w-3.5" />
                        </span>
                      </button>
                    ))}
                  </section>
                );
              })}
            </div>
            <div
              aria-labelledby={activeRoute ? `participation-route-${routeDomId(activeRoute)}` : undefined}
              className="min-w-0 px-4 py-5 sm:px-6"
              id={activeRoute ? `participation-panel-${routeDomId(activeRoute)}` : undefined}
              role="region"
            >
              {activeOption ? <ParticipationSummary dashboard={dashboard} option={activeOption} /> : null}
              {actionableContent ? <div className="mt-5 border-t border-zinc-800 pt-5">{actionableContent}</div> : (
                <div className="mt-5 border-t border-zinc-800 pt-5">
                  <PageNotice title={activeOption?.available ? "Action controls are not loaded" : activeOption?.status ?? "Route unavailable"}>
                    {activeOption?.available
                      ? "The project data is readable, but the transaction workflow has not been attached to this page."
                      : activeOption ? unavailableRouteGuidance(activeOption, options) : "This route is not currently accepting participation."}
                  </PageNotice>
                </div>
              )}
            </div>
          </div>
        )}
      </RuledSection>

      <RuledSection>
        <SectionHeading title="Before anything reaches your wallet" />
        <ol className="m-0 mt-4 grid list-none gap-0 border-t border-zinc-800 p-0 sm:grid-cols-3">
          {[
            ["1", "Review the quote", "Confirm the amount received, payment token, maximum spend, and deadline."],
            ["2", "Confirm the contract", "The review screen names the action and the exact contract receiving the call."],
            ["3", "Track the receipt", "The action stays visible while it is in the wallet, pending onchain, or confirmed."],
          ].map(([step, title, detail]) => (
            <li className="border-b border-zinc-800 py-4 sm:border-r sm:px-4 sm:first:pl-0 sm:last:border-r-0" key={step}>
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-zinc-700 text-xs font-semibold text-zinc-300">{step}</span>
              <h3 className="m-0 mt-3 text-sm font-semibold text-zinc-100">{title}</h3>
              <p className="m-0 mt-1 text-xs leading-5 text-zinc-500">{detail}</p>
            </li>
          ))}
        </ol>
      </RuledSection>
    </>
  );
}

function unavailableRouteGuidance(
  option: ParticipationOption,
  options: readonly ParticipationOption[],
): string {
  if (option.reason) return option.reason;
  if (option.path === "migrating-bonding-curve" && options.some((candidate) => candidate.path === "amm" && candidate.available)) {
    return "This curve has migrated. Choose the live AMM route to keep trading, or inspect its historical contract in the route details.";
  }
  if (option.path === "dutch-auction") {
    return "This auction is scheduled, ended, sold out, or cancelled. Its final settlement price and historical terms remain visible in the route details.";
  }
  if (option.path === "fixed-price-sale") {
    return "This sale is closed or sold out. Its historical terms and contract remain visible in the route details.";
  }
  if (option.path === "bond-market") {
    return "This bond market is scheduled, closed, or out of capacity. Existing positions remain claimable from its contract when they mature.";
  }
  if (option.path === "merkle-airdrop") {
    return "This claim route is closed or fully claimed. Its allocation contract remains visible in the route details.";
  }
  if (option.path === "support") {
    return "Monthly support pauses when the project Boardroom is not Active.";
  }
  return "You can inspect this route’s history and contract, but it is not currently accepting participation.";
}

export function participationOptions(
  dashboard: ProductBoardroomDashboardState | undefined,
  content: Partial<Record<ParticipationContentKey, ReactNode>> = {},
  poolMarket?: ParticipationPoolMarketState | undefined,
  now = currentUnixTimestamp(),
): ParticipationOption[] {
  if (!dashboard) return Object.keys(content).map((key) => fallbackOption(key as ParticipationContentKey));
  const options: ParticipationOption[] = dashboard.snapshot.distributionSummaries.flatMap((distribution) => {
    const option = distributionOption(distribution, dashboard.snapshot.status, now);
    return option ? [option] : [];
  });

  const pools = projectPoolAddresses(dashboard);
  for (const pool of pools) {
    const summary = poolMarket?.pools.find((candidate) => sameAddress(candidate.address, pool));
    const liveness = ammLiveness(dashboard.snapshot.shareToken, summary, poolMarket);
    const presentation = livenessPresentation(liveness);
    options.push({
      address: pool,
      available: liveness.status === "live",
      description: pools.length > 1
        ? `Swap against project pool ${shortAddress(pool)}.`
        : "Swap against the project’s migrated liquidity pool.",
      group: presentation.group,
      id: participationAmmKey(pool),
      label: pools.length > 1 ? `AMM · ${shortAddress(pool)}` : "AMM market",
      liveness,
      path: "amm",
      ...(presentation.reason ? { reason: presentation.reason } : {}),
      status: presentation.status,
    });
  }
  if (pools.length === 0 && content.amm) {
    const reason = "No AMM pool address is recorded for this project.";
    const liveness = routeLiveness("unavailable", reason);
    options.push({
      available: false,
      description: "Swap against the project’s migrated liquidity pool.",
      group: "unavailable",
      id: "amm",
      label: "AMM market",
      liveness,
      path: "amm",
      reason,
      status: "Unavailable",
    });
  }

  if (content.support) {
    const available = dashboard.snapshot.status === 0;
    const reason = available
      ? undefined
      : "The project Boardroom is not Active, so recurring-support invoices are paused.";
    options.push({
      address: dashboard.address,
      available,
      description:
        "Schedule a voluntary monthly USDC contribution; authorize every period separately.",
      group: available ? "live" : "unavailable",
      id: "support",
      label: "Monthly support",
      liveness: available
        ? routeLiveness("live")
        : routeLiveness("unavailable", reason!),
      path: "support",
      ...(reason ? { reason } : {}),
      status: available ? "Live" : "Paused",
    });
  }

  for (const key of Object.keys(content) as ParticipationContentKey[]) {
    const path = participationPathFromContentKey(key);
    const legacyPathAlreadyRepresented = key === path && options.some((option) => option.path === path);
    if (!legacyPathAlreadyRepresented && !options.some((option) => option.id === key)) {
      options.push(fallbackOption(key));
    }
  }

  const rank = new Map(routeGroups.map((group, index) => [group.id, index]));
  return options
    .map((option, index) => ({ index, option }))
    .sort((left, right) => (rank.get(left.option.group) ?? routeGroups.length) - (rank.get(right.option.group) ?? routeGroups.length) || left.index - right.index)
    .map(({ option }) => option);
}

function distributionOption(
  distribution: BoardroomDistributionSnapshot,
  boardroomStatus: number,
  now: bigint,
): ParticipationOption | undefined {
  if (distribution.kind === "bond-market") {
    const base = distributionBase(
      distribution,
      "bond-market",
      "Bond market",
      "Commit reserve or first-party LP assets for non-transferable vested project tokens.",
    );
    if (!distribution.state || !("live" in distribution.state)) return unreadDistribution(base, distribution, "bond-market");
    const state = distribution.state;
    const available = state.live && state.capacity > 0n;
    const startTime = BigInt(state.startTime);
    const conclusion = BigInt(state.conclusion);
    const group: ParticipationRouteGroup = available
      ? "live"
      : state.status !== 0 || state.capacity === 0n || now >= conclusion
        ? "closed"
        : "unavailable";
    const status = available
      ? "Live"
      : state.status !== 0
        ? state.outstandingPayout > 0n ? "Claims pending" : "Settled"
        : state.capacity === 0n
          ? "Sold out"
          : now < startTime
            ? "Scheduled"
            : now >= conclusion
              ? "Window ended"
              : "Unavailable";
    const reason = available
      ? undefined
      : state.status !== 0
        ? state.outstandingPayout > 0n
          ? "Purchases are closed while funded positions remain claimable at maturity."
          : "This bond market has settled."
        : state.capacity === 0n
          ? "The bond market has no remaining project-token capacity."
          : now < startTime
            ? `Purchases open at Unix time ${state.startTime}.`
            : now >= conclusion
              ? "The bond purchase window has ended."
              : boardroomStatus !== 0
                ? "The project lifecycle does not currently permit bond purchases."
                : "The bond market is not currently accepting purchases.";
    return {
      ...base,
      available,
      group,
      label: state.kind === 1 ? "Liquidity bond" : "Reserve bond",
      liveness: available ? routeLiveness("live") : routeLiveness("unavailable", reason ?? "Bond purchases are unavailable."),
      ...(reason ? { reason } : {}),
      remaining: state.capacity,
      status,
      ...(distribution.shareTokenMetadata?.symbol ? { tokenSymbol: distribution.shareTokenMetadata.symbol } : {}),
    };
  }

  if (distribution.kind === "dutch-auction") {
    const base = distributionBase(
      distribution,
      "dutch-auction",
      "Dutch auction",
      "Buy project tokens at a price that descends linearly until the auction closes.",
    );
    if (!distribution.state || !("saleStatus" in distribution.state)) return unreadDistribution(base, distribution, "auction");
    const state = distribution.state;
    return executableDistributionOption(
      base,
      deriveExecutableDistributionRoute({
        boardroomStatus,
        closed: state.closed,
        endTime: state.endTime,
        kind: "dutch-auction",
        now,
        remainingShares: state.remainingShares,
        routeStatus: state.saleStatus,
        startTime: state.startTime,
      }),
      state.remainingShares,
      distribution.shareTokenMetadata?.symbol,
    );
  }

  if (distribution.kind === "fixed-price-sale") {
    const base = distributionBase(distribution, "fixed-price-sale", "Fixed-price sale", "Buy a known number of project tokens at a fixed unit price.");
    if (!distribution.state || !("saleStatus" in distribution.state)) return unreadDistribution(base, distribution, "sale");
    const state = distribution.state;
    return executableDistributionOption(
      base,
      deriveExecutableDistributionRoute({
        boardroomStatus,
        closed: state.closed,
        endTime: state.endTime,
        kind: "fixed-price-sale",
        now,
        remainingShares: state.remainingShares,
        routeStatus: state.saleStatus,
        startTime: state.startTime,
      }),
      state.remainingShares,
      distribution.shareTokenMetadata?.symbol,
    );
  }

  if (distribution.kind === "migrating-bonding-curve") {
    const base = distributionBase(distribution, "migrating-bonding-curve", "Bonding curve", "Buy or sell against an onchain price curve before liquidity migration.");
    if (!distribution.state || !("curveStatus" in distribution.state)) return unreadDistribution(base, distribution, "bonding-curve");
    const state = distribution.state;
    return executableDistributionOption(
      base,
      deriveExecutableDistributionRoute({
        boardroomStatus,
        closed: state.closed,
        endTime: state.endTime,
        graduationLatched: state.graduationLatched,
        kind: "migrating-bonding-curve",
        now,
        quoteReserve: state.quoteReserve,
        remainingSaleShares: state.remainingSaleShares,
        routeStatus: state.curveStatus,
        soldShares: state.soldShares,
        startTime: state.startTime,
      }),
      state.remainingSaleShares,
      distribution.shareTokenMetadata?.symbol,
    );
  }

  if (distribution.kind === "merkle-airdrop") {
    const base = distributionBase(distribution, "merkle-airdrop", "Airdrop", "Claim a published allocation with a proof supplied by the project.");
    if (!distribution.state || !("airdropStatus" in distribution.state)) return unreadDistribution(base, distribution, "airdrop");
    const state = distribution.state;
    return executableDistributionOption(
      base,
      deriveExecutableDistributionRoute({
        boardroomStatus,
        closed: state.closed,
        endTime: state.endTime,
        kind: "merkle-airdrop",
        now,
        remainingShares: state.remainingShares,
        routeStatus: state.airdropStatus,
        startTime: state.startTime,
      }),
      state.remainingShares,
      distribution.shareTokenMetadata?.symbol,
    );
  }

  return undefined;
}

function distributionBase(
  distribution: BoardroomDistributionSnapshot,
  path: ParticipationPath,
  label: string,
  description: string,
): Pick<ParticipationOption, "address" | "description" | "id" | "label" | "path"> {
  return {
    address: distribution.address,
    description,
    id: participationDistributionKey(path as "bond-market" | "dutch-auction" | "fixed-price-sale" | "migrating-bonding-curve" | "merkle-airdrop", distribution.address),
    label,
    path,
  };
}

function executableDistributionOption(
  base: Pick<ParticipationOption, "address" | "description" | "id" | "label" | "path">,
  executable: ExecutableDistributionRoute,
  remaining: bigint,
  tokenSymbol?: string | undefined,
): ParticipationOption {
  const available = executable.liveness.status === "live";
  const group: ParticipationRouteGroup = available
    ? "live"
    : executable.phase === "closed" || executable.phase === "expired"
      ? "closed"
      : executable.phase === "unknown"
        ? "unknown"
        : "unavailable";
  const status = executable.mode === "sell-only"
    ? "Sell only"
    : available
      ? "Live"
      : executable.phase === "future"
        ? "Scheduled"
        : executable.phase === "expired"
          ? "Window ended"
          : executable.liveness.status === "deployment-pending"
            ? "Migration pending"
            : executable.phase === "closed"
              ? "Closed"
              : executable.phase === "unknown"
                ? "Unknown"
                : "Unavailable";
  const livenessReason = "reason" in executable.liveness ? executable.liveness.reason : undefined;
  const reason = executable.mode === "sell-only" && !executable.buy.available
    ? `Buy unavailable: ${executable.buy.reason} Sells remain available against the current curve reserve.`
    : (base.path === "fixed-price-sale" || base.path === "dutch-auction") && !available && executable.phase !== "future"
      ? `This sale is closed or sold out. ${livenessReason ?? "The contract does not currently accept purchases."}`
      : livenessReason;
  return {
    ...base,
    available,
    buyAvailable: executable.buy.available,
    claimAvailable: executable.claim.available,
    group,
    liveness: executable.liveness,
    ...(reason ? { reason } : {}),
    remaining,
    sellAvailable: executable.sell.available,
    status,
    ...(tokenSymbol ? { tokenSymbol } : {}),
  };
}

function unreadDistribution(
  base: Pick<ParticipationOption, "address" | "description" | "id" | "label" | "path">,
  distribution: BoardroomDistributionSnapshot,
  routeLabel: string,
): ParticipationOption {
  const reason = distribution.error
    ? `Current ${routeLabel} state could not be read: ${distribution.error}`
    : `Current ${routeLabel} state has not been verified.`;
  const failed = Boolean(distribution.error);
  return {
    ...base,
    available: false,
    group: failed ? "unavailable" : "unknown",
    liveness: routeLiveness(failed ? "unavailable" : "unknown", reason),
    reason,
    status: failed ? "Read failed" : "Unknown",
  };
}

function ammLiveness(
  projectToken: Address,
  pool: SwapPoolSummary | undefined,
  market: ParticipationPoolMarketState | undefined,
): RouteLiveness {
  if (pool) {
    return routeLivenessForAmm({
      tokenPairVerified: sameAddress(pool.token0, projectToken) || sameAddress(pool.token1, projectToken),
      reserve0: pool.reserve0,
      reserve1: pool.reserve1,
    });
  }
  if (market?.loading) return routeLiveness("checking");
  if (market?.error) return routeLiveness("unavailable", `Current AMM pool state could not be read: ${market.error}`);
  if (market?.loaded) return routeLiveness("unavailable", "No current reserve snapshot was returned for this recorded pool address.");
  return routeLiveness("unknown", "Current AMM tokens and reserves have not been loaded for this recorded pool address.");
}

function livenessPresentation(liveness: RouteLiveness): { group: ParticipationRouteGroup; reason?: string; status: string } {
  if (liveness.status === "live") return { group: "live", status: "Live" };
  if (liveness.status === "checking") return { group: "checking", status: "Checking" };
  if (liveness.status === "no-liquidity") return { group: "unavailable", reason: liveness.reason, status: "No liquidity" };
  if (liveness.status === "unavailable" || liveness.status === "deployment-pending") {
    return { group: "unavailable", reason: liveness.reason, status: "Unavailable" };
  }
  return { group: "unknown", reason: liveness.reason, status: "Unknown" };
}

function ParticipationSummary({
  dashboard,
  option,
}: {
  dashboard: ProductBoardroomDashboardState | undefined;
  option: ParticipationOption;
}): React.JSX.Element {
  const remaining = option.remaining === undefined
    ? "Not applicable"
    : formatTokenAmount(option.remaining, dashboard?.snapshot.shareTokenMetadata, { symbol: option.tokenSymbol });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="m-0 text-xl font-semibold text-zinc-50">{option.label}</h2>
        {option.available ? <CheckCircle2 className="h-4 w-4 text-lime-300" aria-label="Available" /> : null}
      </div>
      <p className="m-0 mt-2 max-w-2xl text-sm leading-6 text-zinc-400">{option.description}</p>
      {option.reason ? <p className="m-0 mt-2 max-w-2xl text-sm leading-6 text-zinc-300">{option.reason}</p> : null}
      <KeyValueList
        columns={3}
        items={[
          { label: "Status", value: option.status },
          ...(option.path === "migrating-bonding-curve" ? [
            { label: "Buy availability", value: option.buyAvailable ? "Available" : "Unavailable" },
            { label: "Sell availability", value: option.sellAvailable ? "Available" : "Unavailable" },
          ] : []),
          { label: option.path === "migrating-bonding-curve" ? "Buy inventory" : "Remaining", value: remaining },
          { label: "Contract", value: option.address ? <AddressLink address={option.address} /> : "Not loaded" },
        ]}
      />
    </div>
  );
}

function SingleParticipationDetails({
  dashboard,
  option,
}: {
  dashboard: ProductBoardroomDashboardState | undefined;
  option: ParticipationOption;
}): React.JSX.Element {
  const remaining = option.remaining === undefined
    ? "Not applicable"
    : formatTokenAmount(option.remaining, dashboard?.snapshot.shareTokenMetadata, { symbol: option.tokenSymbol });

  return (
    <div className="mt-5 border-t border-zinc-800 pt-5">
      <p className="m-0 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">Route details</p>
      <KeyValueList
        columns={3}
        items={[
          { label: "Status", value: option.status },
          ...(option.path === "migrating-bonding-curve" ? [
            { label: "Buy availability", value: option.buyAvailable ? "Available" : "Unavailable" },
            { label: "Sell availability", value: option.sellAvailable ? "Available" : "Unavailable" },
          ] : []),
          { label: option.path === "migrating-bonding-curve" ? "Buy inventory" : "Remaining", value: remaining },
          { label: "Contract", value: option.address ? <AddressLink address={option.address} /> : "Not loaded" },
        ]}
      />
    </div>
  );
}

function ParticipationLoading(): React.JSX.Element {
  return (
    <div aria-label="Loading participation routes" aria-live="polite" className="grid animate-pulse gap-5 py-6" role="status">
      <span className="h-8 max-w-sm rounded bg-zinc-800" />
      <span className="h-72 rounded bg-zinc-900" />
    </div>
  );
}

function firstAvailableRoute(options: readonly ParticipationOption[]): ParticipationContentKey | undefined {
  return options.find((option) => option.available)?.id ?? options[0]?.id;
}

function validSelection(
  selection: ParticipationContentKey | undefined,
  options: readonly ParticipationOption[],
): ParticipationContentKey | undefined {
  if (!selection) return undefined;
  if (options.some((option) => option.id === selection)) return selection;
  if (selection.includes(":")) return undefined;
  const path = participationPathFromContentKey(selection);
  return options.find((option) => option.path === path)?.id;
}

function fallbackOption(id: ParticipationContentKey): ParticipationOption {
  const path = participationPathFromContentKey(id);
  const address = distributionAddressFromContentKey(id);
  const reason = "Current contract state has not been loaded for this route.";
  const common = {
    ...(address ? { address } : {}),
    available: false,
    group: "unknown" as const,
    id,
    liveness: routeLiveness("unknown", reason),
    path,
    reason,
    status: "Unknown",
  };
  if (path === "bond-market") return { ...common, description: "Commit reserve or LP assets for a vested project-token position.", label: "Bond market" };
  if (path === "dutch-auction") return { ...common, description: "Buy while the published unit price descends.", label: "Dutch auction" };
  if (path === "fixed-price-sale") return { ...common, description: "Buy at a published unit price.", label: "Fixed-price sale" };
  if (path === "migrating-bonding-curve") return { ...common, description: "Buy or sell against a price curve.", label: "Bonding curve" };
  if (path === "merkle-airdrop") return { ...common, description: "Claim a published allocation.", label: "Airdrop" };
  if (path === "support") return { ...common, description: "Schedule a voluntary monthly USDC contribution with explicit renewals.", label: "Monthly support" };
  return { ...common, description: "Swap through the project liquidity pool.", label: "AMM market" };
}

function distributionAddressFromContentKey(key: ParticipationContentKey): Address | undefined {
  const separator = key.indexOf(":");
  return separator === -1 ? undefined : key.slice(separator + 1) as Address;
}

function routeDomId(route: ParticipationContentKey): string {
  return route.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function sameAddress(first: string, second: string): boolean {
  return first.toLowerCase() === second.toLowerCase();
}
