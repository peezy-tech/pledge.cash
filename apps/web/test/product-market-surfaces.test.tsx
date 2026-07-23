import { describe, expect, test } from "bun:test";
import type { Address } from "@pledge.cash/sdk";
import { createRequire } from "node:module";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import {
  ExplorePage,
  PortfolioPage,
  ProjectLayout,
  ProjectOverviewPage,
  exploreSearchHref,
  exploreSearchState,
  replaceExploreSearchState,
  type PortfolioTask,
} from "../src/app/pages";
import { ProjectSectionNav } from "../src/app/product-navigation";
import {
  ExploreMarketMetrics,
  ExploreNetworkSummary,
  MAX_MARKET_BOUNDARY_DELAY_MS,
  formatRational,
  ProjectMarketOverview,
  catalogMarketViewModel,
  projectMarketViewModel,
  scheduleMarketBoundaryRefresh,
} from "../src/features/market";
import { exactRational } from "../src/lib/market-data";
import type { ProductBoardroomCatalogEntry, ProductBoardroomDashboardState } from "../src/lib/product-boardroom";
import type { SavedProject } from "../src/lib/saved-projects";
import type { BoardroomDistributionSnapshot } from "../src/lib/types";

const boardroom = "0x1000000000000000000000000000000000000000" as Address;
const owner = "0x2000000000000000000000000000000000000000" as Address;
const shareToken = "0x3000000000000000000000000000000000000000" as Address;
const quoteToken = "0x4000000000000000000000000000000000000000" as Address;
const sale = "0x5000000000000000000000000000000000000000" as Address;
const pool = "0x6000000000000000000000000000000000000000" as Address;
const curve = "0x6100000000000000000000000000000000000000" as Address;
const locker = "0x6200000000000000000000000000000000000000" as Address;
const unrelatedPool = "0x6300000000000000000000000000000000000000" as Address;
const { JSDOM } = createRequire(import.meta.url)("../../../node_modules/.bun/node_modules/jsdom") as {
  JSDOM: new (html: string) => { window: Window & typeof globalThis & { close(): void } };
};

const saleEntry: ProductBoardroomCatalogEntry = {
  address: boardroom,
  boardroomStatus: 0,
  buyerCount: 4,
  cashRaised: 6_000_000n,
  cashToken: quoteToken,
  cashTokenDecimals: 6,
  cashTokenSymbol: "USDC",
  distribution: sale,
  distributionAddresses: [sale],
  distributionCount: 1,
  distributionKind: "fixed-price-sale",
  name: "Atlas Cooperative",
  path: "Fixed price sale",
  routeBuyInventory: 8n * 10n ** 18n,
  routeClosed: false,
  routeEndTime: 9_999_999_999n,
  routeStartTime: 1n,
  routeStatus: 0,
  shareToken,
  shareTokenDecimals: 18,
  shareTokenTotalSupply: 100n * 10n ** 18n,
  shareTokenTreasuryBalance: 98n * 10n ** 18n,
  soldShares: 2n * 10n ** 18n,
  status: "Active sale",
  symbol: "ATLAS",
};

const ammEntry: ProductBoardroomCatalogEntry = {
  ...saleEntry,
  distribution: curve,
  distributionAddresses: [curve],
  distributionKind: "migrating-bonding-curve",
  locker,
  path: "Migrated curve + AMM",
  pool,
  poolReserve0: 500_000_000n,
  poolReserve1: 1_000n * 10n ** 18n,
  poolToken0: quoteToken,
  poolToken1: shareToken,
  routeBuyInventory: 0n,
  routeClosed: true,
  routeEndTime: 9_999_999_999n,
  routeGraduationLatched: true,
  routeQuoteReserve: 0n,
  routeSellInventory: 2n * 10n ** 18n,
  routeStartTime: 1n,
  routeStatus: 1,
  status: "Live AMM",
};

const dashboard = dashboardFixture(ammEntry);

function dashboardFixture(entry: ProductBoardroomCatalogEntry): ProductBoardroomDashboardState {
  const distributionSummary: BoardroomDistributionSnapshot = entry.distributionKind === "migrating-bonding-curve"
    ? {
        address: curve,
        kind: "migrating-bonding-curve",
        state: {
          address: curve,
          factory: "0xa000000000000000000000000000000000000000" as Address,
          boardroom,
          lockedLiquidityFactory: "0xa100000000000000000000000000000000000000" as Address,
          shareToken,
          quoteToken,
          locker,
          pool,
          saleSupply: 10n * 10n ** 18n,
          migrationSupply: 90n * 10n ** 18n,
          remainingSaleShares: 0n,
          basePrice: 1_000_000n,
          slope: 0n,
          graduationQuoteTarget: 2_000_000n,
          quoteToLpBps: 8_000,
          startTime: 1n,
          endTime: 9_999_999_999n,
          migrationSalt: `0x${"11".repeat(32)}` as `0x${string}`,
          curveStatus: 1,
          soldShares: 10n * 10n ** 18n,
          quoteReserve: 0n,
          graduationLatched: true,
          canMigrate: false,
          closed: true,
        },
        shareTokenMetadata: { address: shareToken, decimals: 18, symbol: "ATLAS" },
        quoteTokenMetadata: { address: quoteToken, decimals: 6, symbol: "USDC" },
      }
    : {
        address: sale,
        kind: "fixed-price-sale",
        state: {
          address: sale,
          factory: "0xa000000000000000000000000000000000000000" as Address,
          boardroom,
          shareToken,
          paymentToken: quoteToken,
          saleSupply: 10n * 10n ** 18n,
          remainingShares: 8n * 10n ** 18n,
          price: 3_000_000n,
          maxPerBuyer: 2n * 10n ** 18n,
          startTime: 1n,
          endTime: 9_999_999_999n,
          saleStatus: 0,
          closed: false,
        },
        shareTokenMetadata: { address: shareToken, decimals: 18, symbol: "ATLAS" },
        paymentTokenMetadata: { address: quoteToken, decimals: 6, symbol: "USDC" },
      };
  return {
    address: boardroom,
    catalog: [entry],
    ...(entry.pool ? { histories: [{ distribution: distributionSummary.address, pool: entry.pool }] } : {}),
    currentStateCoverage: {
      distributions: { complete: true, shown: 1, total: 1 },
      grants: { complete: true, shown: 0, total: 0 },
      lockedLiquidity: { complete: true, shown: 0, total: 0 },
      redeemableAssets: { complete: true, shown: 1, total: 1 },
    },
    nativeBalance: 0n,
    snapshot: {
      address: boardroom,
      owner,
      policyRegistry: "0x7000000000000000000000000000000000000000" as Address,
      wrappedNative: "0x8000000000000000000000000000000000000000" as Address,
      shareToken,
      status: 0,
      launched: true,
      controller: "0x9000000000000000000000000000000000000000" as Address,
      proposer: owner,
      controllerDelay: 86_400n,
      controllerGracePeriod: 604_800n,
      controllerGeneration: 1n,
      controllerConfigurationEpoch: 1n,
      windDownDelay: 86_400n,
      governanceEpoch: 1n,
      governanceEligibleSupply: 2n * 10n ** 18n,
      redeemableAssets: [quoteToken],
      issuedGrants: [],
      issuedDistributions: [distributionSummary.address],
      lockedLiquidityPositions: [],
      shareTokenMetadata: { address: shareToken, decimals: 18, symbol: "ATLAS" },
      grantSummaries: [],
      distributionSummaries: [distributionSummary],
      lockedLiquiditySummaries: [],
    },
    treasuryAssets: [
      { address: shareToken, balance: 98n * 10n ** 18n, decimals: 18, label: "Project tokens", symbol: "ATLAS", totalSupply: 100n * 10n ** 18n },
      { address: quoteToken, balance: 6_000_000n, decimals: 6, label: "Quote treasury", symbol: "USDC" },
    ],
  };
}

describe("product market surfaces", () => {
  test("renders quote-denominated AMM spot, exact outside-treasury market cap, FDV, and named-pool depth", () => {
    const view = projectMarketViewModel(dashboard);
    const html = renderToString(
      <ProjectLayout
        activeSection="overview"
        chainName="Local Anvil"
        dashboard={dashboard}
        loading={false}
        onNavigateSection={() => undefined}
      >
        <div>Section content marker</div>
      </ProjectLayout>,
    );

    expect(view.price.status).toBe("known");
    expect(view.marketCap.status).toBe("known");
    expect(view.fullyDilutedValue.status).toBe("known");
    expect(html).toContain("0.5 USDC / ATLAS");
    expect(html).toContain("1 USDC");
    expect(html).toContain("50 USDC");
    expect(html).toContain("500 USDC quote-side");
    expect(html).not.toContain("$");
    expect(html.indexOf("Market and participation")).toBeLessThan(html.indexOf('aria-label="Project"'));
    expect(html.indexOf('aria-label="Project"')).toBeLessThan(html.indexOf("Section content marker"));
    expect(html).toContain("24-hour activity: Not indexed");
  });

  test("keeps tiny positive prices and quote valuations distinct from true zero", () => {
    expect(formatRational(exactRational(1n, 100_000n))).toBe("<0.0001");
    expect(formatRational(exactRational(0n))).toBe("0");

    const tinyEntry = {
      ...ammEntry,
      poolReserve0: 10n,
      poolReserve1: 1n * 10n ** 18n,
    } satisfies ProductBoardroomCatalogEntry;
    const tinyDashboard = dashboardFixture(tinyEntry);
    const tiny = projectMarketViewModel(tinyDashboard);
    const zeroSupply = projectMarketViewModel({
      ...tinyDashboard,
      treasuryAssets: tinyDashboard.treasuryAssets.map((asset) => sameAddress(asset.address, shareToken)
        ? { ...asset, balance: asset.totalSupply }
        : asset),
    });

    expect(tiny.metrics.find((metric) => metric.label.startsWith("Price"))?.value).toBe("<0.0001 USDC / ATLAS");
    expect(tiny.metrics.find((metric) => metric.label.startsWith("Market cap"))?.value).toBe("<0.0001 USDC");
    expect(zeroSupply.metrics.find((metric) => metric.label.startsWith("Market cap"))?.value).toBe("0 USDC");
  });

  test("uses exact catalog route identity when the snapshot issued-address array is empty", () => {
    const catalogBackedDashboard = {
      ...dashboard,
      snapshot: { ...dashboard.snapshot, issuedDistributions: [] },
    } satisfies ProductBoardroomDashboardState;
    const view = projectMarketViewModel(catalogBackedDashboard);

    expect(view.marketCap.status).toBe("known");
    if (view.marketCap.status !== "known") throw new Error("Expected catalog-backed distributed supply");
    expect(view.marketCap.value.units).toEqual({ numerator: 1n, denominator: 1n });
  });

  test("keeps fixed-sale valuations unavailable while exact supply valuation remains independent of partial route history", () => {
    const fixedDashboard = dashboardFixture(saleEntry);
    const partialDashboard = {
      ...dashboard,
      historyErrors: ["RPC history scan stopped before the deployment block."],
    } satisfies ProductBoardroomDashboardState;
    const fixed = projectMarketViewModel(fixedDashboard);
    const partial = projectMarketViewModel(partialDashboard);
    const html = renderToString(
      <ProjectLayout
        activeSection="overview"
        chainName="Local Anvil"
        dashboard={fixedDashboard}
        loading={false}
        onNavigateSection={() => undefined}
      >
        Fixed route content
      </ProjectLayout>,
    );

    expect(fixed.price.status).toBe("known");
    expect(fixed.marketCap.status).toBe("unavailable");
    expect(html).toContain("3 USDC / ATLAS");
    expect(html).toContain("sale and curve route prices are not market spot");
    expect(partial.marketCap.status).toBe("known");
    expect(partial.coverageWarning).toBe(true);
  });

  test("keeps project detail and catalog liveness aligned when an active-enum sale is winding down", () => {
    const windingCatalog = { ...saleEntry, boardroomStatus: 1 } satisfies ProductBoardroomCatalogEntry;
    const windingDashboard = {
      ...dashboardFixture(windingCatalog),
      snapshot: { ...dashboardFixture(windingCatalog).snapshot, status: 1 },
    } satisfies ProductBoardroomDashboardState;

    expect(catalogMarketViewModel(windingCatalog, 100n).liveness).toMatchObject({ status: "unavailable" });
    expect(projectMarketViewModel(windingDashboard, 100n).liveness).toMatchObject({ status: "unavailable" });
  });

  test("values exact supply outside treasury so direct mints, settled grants, and migrated LP balances are included", () => {
    const supplied = {
      ...dashboard,
      snapshot: { ...dashboard.snapshot, governanceEligibleSupply: 60n * 10n ** 18n },
      treasuryAssets: dashboard.treasuryAssets.map((asset) => sameAddress(asset.address, shareToken)
        ? { ...asset, balance: 10n * 10n ** 18n, totalSupply: 150n * 10n ** 18n }
        : asset),
    } satisfies ProductBoardroomDashboardState;
    const view = projectMarketViewModel(supplied);

    expect(view.marketCap.status).toBe("known");
    if (view.marketCap.status !== "known") throw new Error(view.marketCap.reason);
    expect(view.marketCap.value.units).toEqual({ numerator: 70n, denominator: 1n });
  });

  test("does not let an unrelated locked-liquidity pool override an active sale route", () => {
    const unrelatedCatalog = {
      ...saleEntry,
      pool: unrelatedPool,
      poolReserve0: 500_000_000n,
      poolReserve1: 1_000n * 10n ** 18n,
      poolToken0: quoteToken,
      poolToken1: shareToken,
    } satisfies ProductBoardroomCatalogEntry;
    const saleDashboard = dashboardFixture(unrelatedCatalog);
    const view = projectMarketViewModel({
      ...saleDashboard,
      histories: [],
      snapshot: {
        ...saleDashboard.snapshot,
        lockedLiquiditySummaries: [{
          address: locker,
          state: {
            address: locker,
            factory: owner,
            boardroom,
            router: owner,
            tokenA: shareToken,
            tokenB: quoteToken,
            pool: unrelatedPool,
            seeded: true,
            lockedLiquidity: 1n,
          },
        }],
      },
    });

    expect(view.routeLabel).toBe("Fixed-price sale");
    expect(view.price.status).toBe("known");
    if (view.price.status !== "known") throw new Error(view.price.reason);
    expect(view.price.value.source).toBe("fixed-sale");
  });

  test("quotes only fractional remaining curve inventory and labels the actual executable amount", () => {
    const curveDashboard = dashboardFixture(ammEntry);
    const curveSummary = curveDashboard.snapshot.distributionSummaries[0];
    if (!curveSummary?.state || !("quoteToken" in curveSummary.state)) throw new Error("Expected curve fixture");
    const remaining = 250_000_000_000_000_000n;
    const activeCurve = {
      ...curveDashboard,
      catalog: [{
        ...ammEntry,
        locker: undefined,
        path: "Bonding curve",
        pool: undefined,
        poolReserve0: undefined,
        poolReserve1: undefined,
        poolToken0: undefined,
        poolToken1: undefined,
        routeBuyInventory: remaining,
        routeClosed: false,
        routeGraduationLatched: false,
        routeQuoteReserve: 1_000_000n,
        routeSellInventory: 1n * 10n ** 18n,
        routeStatus: 0,
        status: "Open curve",
      }],
      histories: [],
      snapshot: {
        ...curveDashboard.snapshot,
        distributionSummaries: [{
          ...curveSummary,
          state: {
            ...curveSummary.state,
            closed: false,
            curveStatus: 0,
            graduationLatched: false,
            pool: "0x0000000000000000000000000000000000000000" as Address,
            remainingSaleShares: remaining,
            soldShares: 1n * 10n ** 18n,
            quoteReserve: 1_000_000n,
          },
        }],
      },
    } satisfies ProductBoardroomDashboardState;
    const view = projectMarketViewModel(activeCurve, 100n);

    expect(view.price.status).toBe("known");
    if (view.price.status !== "known" || view.price.value.source !== "curve-quote") throw new Error("Expected curve quote");
    expect(view.price.value.projectAmount.raw).toBe(remaining);
    expect(view.routeSource).toContain("0.25");
    expect(view.metrics.find((metric) => metric.label.startsWith("Price"))?.detail).toContain("0.25");
  });

  test("binds AMM metrics and current reserves to the selected pool identity", () => {
    const view = projectMarketViewModel(dashboard);
    expect(view.routeLabel).toContain("0x6000...0000");
    expect(view.routeSource).toContain("0x6000...0000");
    expect(view.metrics.find((metric) => metric.label === "Liquidity depth")?.detail).toContain("0x6000...0000");
    if (view.price.status !== "known" || view.price.value.source !== "amm-spot") throw new Error("Expected AMM spot");
    expect(view.price.value.pool).toBe(pool);
    expect(view.price.value.quoteDepth.raw).toBe(500_000_000n);
  });

  test("keeps current snapshot pool pricing when migration history names a different pool", () => {
    const conflict = {
      ...dashboard,
      histories: [{
        completeness: "partial" as const,
        distribution: curve,
        pool: unrelatedPool,
        curve: {
          migration: {
            liquidity: 1n,
            locker,
            pool: unrelatedPool,
            quoteToBoardroom: 1n,
            quoteToLiquidity: 1n,
            sharesToLiquidity: 1n,
          },
        },
      }],
    } satisfies ProductBoardroomDashboardState;
    const view = projectMarketViewModel(conflict);

    expect(view.price.status).toBe("known");
    if (view.price.status !== "known" || view.price.value.source !== "amm-spot") throw new Error("Expected current AMM spot");
    expect(view.price.value.pool).toBe(pool);
    expect(view.routeLabel).toContain("0x6000...0000");
    expect(view.coverageWarning).toBe(true);
  });

  test("summarizes wallet-free Explore coverage and keeps stacked rows clear of the save control", () => {
    const html = renderToString(
      <ExplorePage
        chainId={31337}
        chainName="Local Anvil"
        loading={false}
        projects={[ammEntry]}
        totalProjects={12}
        projectHref={(project) => `/projects/31337/${project.address}/overview`}
        savedProjectAddresses={new Set([boardroom.toLowerCase()])}
        savedProjectCount={1}
        onOpenProject={() => undefined}
        onToggleSaved={() => undefined}
      />,
    );

    expect(html).toContain("Browse Local Anvil without a wallet");
    expect(html).toContain("Discovered projects");
    expect(html).toContain("Tradeable markets");
    expect(html).toContain("Active participation routes");
    expect(html).toContain("Coverage warnings");
    expect(html).toContain('data-mobile-layout="stacked-market-row"');
    expect(html).toContain("pr-14");
    expect(html).toContain("right-0 top-2");
    expect(html).toContain('href="/projects/31337/0x1000000000000000000000000000000000000000/overview"');
    expect(html).toContain("Remove Atlas Cooperative from saved projects");
    expect(html).toContain("Market cap · supply outside treasury");
  });

  test("caps long market timers without rerendering before the boundary", () => {
    const project = {
      ...saleEntry,
      routeStartTime: 3_000_000n,
      routeEndTime: 0n,
      status: "Scheduled",
    } satisfies ProductBoardroomCatalogEntry;
    const timers = new MarketFakeTimers(0);
    const refreshed: bigint[] = [];
    const stop = scheduleMarketBoundaryRefresh(
      { projects: [project] },
      (now) => refreshed.push(now),
      {
        clearTimeoutFn: timers.clearTimeout,
        nowMilliseconds: () => timers.now,
        setTimeoutFn: timers.setTimeout,
      },
    );

    expect(timers.lastScheduledDelay).toBe(MAX_MARKET_BOUNDARY_DELAY_MS);
    timers.advanceBy(MAX_MARKET_BOUNDARY_DELAY_MS);
    expect(refreshed).toEqual([]);
    expect(timers.pendingCount).toBe(1);
    expect(timers.lastScheduledDelay).toBeLessThan(MAX_MARKET_BOUNDARY_DELAY_MS);
    stop();
    expect(timers.pendingCount).toBe(0);
  });

  test("refreshes Explore row and network metrics at exact route boundaries", () => {
    const project = {
      ...saleEntry,
      routeStartTime: 101n,
      routeEndTime: 102n,
      status: "Scheduled",
    } satisfies ProductBoardroomCatalogEntry;
    const mounted = mountMarketMetrics(
      <>
        <ExploreNetworkSummary projects={[project]} totalProjects={1} />
        <ExploreMarketMetrics project={project} />
      </>,
      100_000,
    );

    try {
      expect(metricValue(mounted.container, "Network project coverage", "Active participation routes")).toBe("0");
      expect(metricValue(mounted.container, "Atlas Cooperative market metrics", "Route status")).toBe("Unavailable");
      expect(metricDetail(mounted.container, "Atlas Cooperative market metrics", "Route status")).toContain("start time");
      act(() => mounted.timers.advanceBy(1_000));
      expect(metricValue(mounted.container, "Network project coverage", "Active participation routes")).toBe("1");
      expect(metricValue(mounted.container, "Atlas Cooperative market metrics", "Route status")).toBe("Live");
      act(() => mounted.timers.advanceBy(2_000));
      expect(metricValue(mounted.container, "Network project coverage", "Active participation routes")).toBe("0");
      expect(metricValue(mounted.container, "Atlas Cooperative market metrics", "Route status")).toBe("Unavailable");
      expect(metricDetail(mounted.container, "Atlas Cooperative market metrics", "Route status")).toContain("end time");
    } finally {
      mounted.cleanup();
    }
  });

  test("refreshes project overview metrics at exact route boundaries and cleans up its timer", () => {
    const mounted = mountMarketMetrics(<ProjectMarketOverview dashboard={timedSaleDashboard(101n, 102n)} />, 100_000);

    try {
      expect(metricValue(mounted.container, "Current project market metrics", "Route status")).toBe("Unavailable");
      expect(metricDetail(mounted.container, "Current project market metrics", "Route status")).toContain("start time");
      act(() => mounted.timers.advanceBy(1_000));
      expect(metricValue(mounted.container, "Current project market metrics", "Route status")).toBe("Live");
      act(() => mounted.timers.advanceBy(2_000));
      expect(metricValue(mounted.container, "Current project market metrics", "Route status")).toBe("Unavailable");
      expect(metricDetail(mounted.container, "Current project market metrics", "Route status")).toContain("end time");

      act(() => mounted.root.render(<ProjectMarketOverview dashboard={timedSaleDashboard(200n, 201n)} />));
      expect(mounted.timers.pendingCount).toBe(1);
      act(() => mounted.root.render(<ProjectMarketOverview />));
      expect(mounted.timers.pendingCount).toBe(0);
      act(() => mounted.root.render(<ProjectMarketOverview dashboard={timedSaleDashboard(200n, 201n)} />));
      expect(mounted.timers.pendingCount).toBe(1);
    } finally {
      mounted.cleanup();
    }
    expect(mounted.timers.pendingCount).toBe(0);
  });

  test("preserves Explore query/filter URL semantics and unrelated parameters", () => {
    const calls: string[] = [];
    const href = replaceExploreSearchState(
      { filter: "amm", query: "Atlas treasury" },
      {
        history: {
          state: { route: "explore" },
          replaceState(_state, _title, nextHref) { calls.push(String(nextHref)); },
        },
        location: { hash: "#directory", pathname: "/explore", search: "?chain=31337&view=compact" },
      },
    );

    expect(href).toBe("/explore?chain=31337&view=compact&q=Atlas+treasury&type=amm#directory");
    expect(calls).toEqual([href]);
    expect(exploreSearchState("?chain=31337&q=Atlas+treasury&type=amm")).toEqual({ filter: "amm", query: "Atlas treasury" });
    expect(exploreSearchHref("/explore", "?chain=31337&view=compact", { filter: "all", query: "" }))
      .toBe("/explore?chain=31337&view=compact");
  });

  test("uses precise project navigation labels in a two-column 320px treatment", () => {
    const layout = renderToString(
      <ProjectLayout
        activeSection="participate"
        chainName="Local Anvil"
        loading={false}
        onNavigateSection={() => undefined}
        savedProjectsWarning="Browser storage is blocked."
      >
        Content
      </ProjectLayout>,
    );
    const navigation = renderToString(<ProjectSectionNav active="governance" boardroom={boardroom} chainId={31337} />);

    for (const html of [layout, navigation]) {
      expect(html).toContain("grid-cols-2");
      expect(html).toContain("sm:grid-cols-4");
      expect(html).toContain("Participate");
      expect(html).toContain("Governance");
      expect(html).toContain("Transparency");
      expect(html).not.toContain(">Join<");
      expect(html).not.toContain(">Govern<");
      expect(html).not.toContain(">Details<");
    }
    expect(layout).toContain("Saved-project storage warning:");
    expect(layout).toContain("Browser storage is blocked.");
  });

  test("exposes a disabled pending refresh affordance while remaining compatible with positionLoading", () => {
    const html = renderToString(
      <ProjectOverviewPage
        account={owner}
        dashboard={dashboard}
        loading={false}
        onRefresh={() => undefined}
        positionLoading
      />,
    );

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('disabled=""');
    expect(html).toContain("animate-spin");
    expect(html).toContain("Refreshing project position");
    expect(html.indexOf("Project state")).toBeLessThan(html.indexOf("Your position"));
  });

  test("groups Portfolio tasks as attention, ready, then records while keeping saved projects read-only", () => {
    const tasks: PortfolioTask[] = [
      { id: "record", title: "Reference record", description: "For history", status: "informational" },
      { id: "ready", title: "Ready action", description: "Can proceed", status: "ready" },
      { id: "attention", title: "Urgent decision", description: "Review now", status: "attention" },
      { id: "complete", title: "Completed action", description: "Receipt available", status: "complete" },
    ];
    const connected = renderToString(<PortfolioPage account={owner} loading={false} tasks={tasks} />);
    const saved: SavedProject = { boardroom, chainId: 31337, name: "Atlas Cooperative", savedAt: 1 };
    const disconnected = renderToString(
      <PortfolioPage
        loading={false}
        tasks={[]}
        savedProjects={[saved]}
        savedProjectHref={(project) => `/projects/${project.chainId}/${project.boardroom}/overview`}
      />,
    );

    expect(connected.indexOf("Urgent decision")).toBeLessThan(connected.indexOf("Ready action"));
    expect(connected.indexOf("Ready action")).toBeLessThan(connected.indexOf("Reference record"));
    expect(connected.indexOf("Reference record")).toBeLessThan(connected.indexOf("Completed action"));
    expect(connected).toContain("Records and completed");
    expect(disconnected).toContain("Saved projects remain available as read-only browser shortcuts");
    expect(disconnected).toContain('href="/projects/31337/0x1000000000000000000000000000000000000000/overview"');
  });

  test("catalog rows retain explicit unknown reasons for non-spot valuation", () => {
    const view = catalogMarketViewModel({
      ...saleEntry,
      distributionAddresses: [sale, "0xb000000000000000000000000000000000000000" as Address],
      distributionCount: 2,
      historyError: "Older route logs were unavailable.",
    });

    expect(view.price.status).toBe("unknown");
    expect(view.marketCap.status).toBe("unknown");
    const renderedReasons = view.metrics.map((metric) => metric.detail).filter(Boolean).join(" ");
    expect(renderedReasons).toContain("directory does not expose the current fixed-sale unit price");
    expect(renderedReasons).toContain("Older route logs were unavailable");
  });
});

function timedSaleDashboard(startTime: bigint, endTime: bigint): ProductBoardroomDashboardState {
  const entry = {
    ...saleEntry,
    routeStartTime: startTime,
    routeEndTime: endTime,
    status: "Scheduled",
  } satisfies ProductBoardroomCatalogEntry;
  const base = dashboardFixture(entry);
  const distribution = base.snapshot.distributionSummaries[0];
  if (!distribution?.state || !("paymentToken" in distribution.state)) throw new Error("Expected fixed-sale fixture");
  return {
    ...base,
    snapshot: {
      ...base.snapshot,
      distributionSummaries: [{
        ...distribution,
        state: { ...distribution.state, startTime, endTime },
      }],
    },
  };
}

function metricValue(container: HTMLElement, groupLabel: string, metricLabel: string): string | undefined {
  const group = container.querySelector(`[aria-label="${groupLabel}"]`);
  const term = Array.from(group?.querySelectorAll("dt") ?? []).find((candidate) => candidate.textContent === metricLabel);
  return term?.parentElement?.querySelector("dd")?.textContent ?? undefined;
}

function metricDetail(container: HTMLElement, groupLabel: string, metricLabel: string): string | undefined {
  const group = container.querySelector(`[aria-label="${groupLabel}"]`);
  const term = Array.from(group?.querySelectorAll("dt") ?? []).find((candidate) => candidate.textContent === metricLabel);
  return term?.parentElement?.querySelectorAll("dd")[1]?.textContent ?? undefined;
}

function mountMarketMetrics(element: ReactNode, nowMilliseconds: number): {
  cleanup: () => void;
  container: HTMLElement;
  root: Root;
  timers: MarketFakeTimers;
} {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>");
  const descriptors = new Map<PropertyKey, PropertyDescriptor | undefined>();
  const setGlobal = (key: PropertyKey, value: unknown): void => {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  setGlobal("window", dom.window);
  setGlobal("document", dom.window.document);
  setGlobal("navigator", dom.window.navigator);
  setGlobal("HTMLElement", dom.window.HTMLElement);
  setGlobal("Node", dom.window.Node);
  setGlobal("IS_REACT_ACT_ENVIRONMENT", true);

  const timers = new MarketFakeTimers(nowMilliseconds);
  const originalDateNow = Date.now;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  Date.now = () => timers.now;
  globalThis.setTimeout = timers.setTimeout as typeof setTimeout;
  globalThis.clearTimeout = timers.clearTimeout as typeof clearTimeout;

  const container = dom.window.document.getElementById("root") as HTMLElement;
  const root = createRoot(container);
  act(() => root.render(element));
  let cleaned = false;
  return {
    container,
    root,
    timers,
    cleanup() {
      if (cleaned) return;
      cleaned = true;
      act(() => root.unmount());
      Date.now = originalDateNow;
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
      dom.window.close();
    },
  };
}

class MarketFakeTimers {
  lastScheduledDelay: number | undefined;
  now: number;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  constructor(now: number) {
    this.now = now;
  }

  get pendingCount(): number {
    return this.timers.size;
  }

  setTimeout = (callback: () => void, delay = 0): number => {
    this.lastScheduledDelay = delay;
    const id = this.nextId;
    this.nextId += 1;
    this.timers.set(id, { at: this.now + Math.max(0, delay), callback });
    return id;
  };

  clearTimeout = (id: number): void => {
    this.timers.delete(id);
  };

  advanceBy(milliseconds: number): void {
    const target = this.now + milliseconds;
    while (true) {
      const next = Array.from(this.timers.entries())
        .filter(([, timer]) => timer.at <= target)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
      if (!next) break;
      const [id, timer] = next;
      this.timers.delete(id);
      this.now = timer.at;
      timer.callback();
    }
    this.now = target;
  }
}

function sameAddress(first: Address, second: Address): boolean {
  return first.toLowerCase() === second.toLowerCase();
}
