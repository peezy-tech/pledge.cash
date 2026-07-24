import { isZeroAddress, type Address, type DutchAuctionState } from "@pledge.cash/sdk";
import {
  currentUnixTimestamp,
  bondMarketUnitPrice,
  curveBuyQuoteAmountRaw,
  curveBuyQuoteRaw,
  curveQuoteUnitPrice,
  deriveExecutableDistributionRoute,
  deriveMarketValuation,
  dutchAuctionUnitPrice,
  exactTokenAmount,
  fixedSaleUnitPrice,
  knownMetric,
  notApplicableMetric,
  notIndexedMarketActivity24h,
  routeLiveness,
  routeLivenessForAmm,
  unavailableMetric,
  unknownMetric,
  verifiedAmmSpotPrice,
  verifiedSupplyOutsideTreasury,
  verifiedTotalSupply,
  type ExactQuoteValue,
  type ExactRational,
  type ExecutableDistributionRoute,
  type ExactTokenAmount,
  type MarketActivity24h,
  type MetricState,
  type RouteLiveness,
  type RoutePriceState,
} from "../../lib/market-data";
import type {
  ProductBoardroomCatalogEntry,
  ProductBoardroomDashboardState,
} from "../../lib/product-boardroom";
import { shortAddress } from "../../lib/forms";
import { formatDecimalString, formatTokenAmount, type TokenMetadata } from "../../lib/token-amounts";
import type { BoardroomDistributionSnapshot } from "../../lib/types";

export type MarketMetricView = {
  detail?: string | undefined;
  label: string;
  value: string;
};

export type ProjectMarketViewModel = {
  activity24h: MarketActivity24h;
  activeParticipationRoute: boolean;
  coverageWarning: boolean;
  liquidity: MetricState<ExactTokenAmount>;
  liveness: RouteLiveness;
  marketCap: MetricState<ExactQuoteValue>;
  metrics: readonly MarketMetricView[];
  price: RoutePriceState;
  routeLabel: string;
  routeSource: string;
  tradeable: boolean;
  fullyDilutedValue: MetricState<ExactQuoteValue>;
};

export type NetworkMarketSummary = {
  activeParticipationRoutes: number;
  coverageWarnings: number;
  discoveredProjects: number;
  tradeableMarkets: number;
};

type MarketAssetContext = {
  projectMetadata?: TokenMetadata | undefined;
  quoteMetadata?: TokenMetadata | undefined;
};

const NOT_INDEXED_REASON = "24-hour price change and volume are not indexed for this route. Current contract state remains available.";

export function catalogMarketViewModel(
  project: ProductBoardroomCatalogEntry,
  now = currentUnixTimestamp(),
): ProjectMarketViewModel {
  const assets = catalogAssets(project);
  const price = catalogRoutePrice(project);
  const liveness = catalogRouteLiveness(project, price, now);
  const currentSupplyOutsideTreasury = catalogSupplyOutsideTreasury(project);
  const totalSupply = project.shareToken
    ? verifiedTotalSupply(
        project.shareToken,
        project.shareTokenTotalSupply,
        project.shareTokenDecimals,
        "Verified project-token total supply is unavailable in this directory row.",
      )
    : unknownMetric<ExactTokenAmount>("The canonical project token is unavailable in this directory row.");
  const valuation = deriveMarketValuation({ spotPrice: price, currentSupplyOutsideTreasury, totalSupply });
  const liquidity = quoteLiquidity(price);
  const routeLabel = catalogRouteLabel(project, now);
  const routeSource = routePriceSource(price, routeLabel);
  const raised = catalogRaisedMetric(project, assets.quoteMetadata);
  const activity24h = notIndexedMarketActivity24h(NOT_INDEXED_REASON);

  return {
    activity24h,
    activeParticipationRoute: liveness.status === "live",
    coverageWarning: Boolean(project.error || project.historyError || project.poolError),
    liquidity,
    liveness,
    marketCap: valuation.marketCap,
    metrics: marketMetrics({
      assets,
      fullyDilutedValue: valuation.fullyDilutedValue,
      liveness,
      liquidity,
      marketCap: valuation.marketCap,
      price,
      raised,
      routeLabel,
      routeSource,
    }),
    price,
    routeLabel,
    routeSource,
    tradeable: price.status === "known" || Boolean(project.pool) || isTradeRoute(project.distributionKind),
    fullyDilutedValue: valuation.fullyDilutedValue,
  };
}

export function projectMarketViewModel(
  dashboard: ProductBoardroomDashboardState,
  now = currentUnixTimestamp(),
): ProjectMarketViewModel {
  const catalog = selectedCatalogEntry(dashboard);
  const assets = dashboardAssets(dashboard, catalog, now);
  const route = dashboardRoute(dashboard, catalog, now);
  const currentSupplyOutsideTreasury = dashboardSupplyOutsideTreasury(dashboard, catalog);
  const totalSupply = verifiedTotalSupply(
    dashboard.snapshot.shareToken,
    catalog?.shareTokenTotalSupply
      ?? dashboard.treasuryAssets.find((asset) => sameAddress(asset.address, dashboard.snapshot.shareToken))?.totalSupply,
    dashboard.snapshot.shareTokenMetadata?.decimals ?? catalog?.shareTokenDecimals,
    "Verified ERC-20 project-token total supply could not be read.",
  );
  const valuation = deriveMarketValuation({
    spotPrice: route.price,
    currentSupplyOutsideTreasury,
    totalSupply,
  });
  const liquidity = quoteLiquidity(route.price);
  const raised = catalogRaisedMetric(catalog, assets.quoteMetadata);
  const activity24h = notIndexedMarketActivity24h(NOT_INDEXED_REASON);
  const coverageWarning = dashboard.historyErrors?.length
    ? true
    : dashboard.currentStateCoverage?.distributions.complete === false
      || dashboardHasPoolHistoryMismatch(dashboard, catalog)
      || Boolean(catalog?.error || catalog?.historyError || catalog?.poolError);

  return {
    activity24h,
    activeParticipationRoute: route.liveness.status === "live",
    coverageWarning,
    liquidity,
    liveness: route.liveness,
    marketCap: valuation.marketCap,
    metrics: marketMetrics({
      assets,
      fullyDilutedValue: valuation.fullyDilutedValue,
      liveness: route.liveness,
      liquidity,
      marketCap: valuation.marketCap,
      price: route.price,
      raised,
      routeLabel: route.routeLabel,
      routeSource: route.routeSource,
    }),
    price: route.price,
    routeLabel: route.routeLabel,
    routeSource: route.routeSource,
    tradeable: route.tradeable,
    fullyDilutedValue: valuation.fullyDilutedValue,
  };
}

export function summarizeNetworkMarkets(
  projects: readonly ProductBoardroomCatalogEntry[],
  totalProjects?: number,
  now = currentUnixTimestamp(),
): NetworkMarketSummary {
  const views = projects.map((project) => catalogMarketViewModel(project, now));
  return {
    activeParticipationRoutes: views.filter((view) => view.activeParticipationRoute).length,
    coverageWarnings: views.filter((view) => view.coverageWarning).length,
    discoveredProjects: totalProjects ?? projects.length,
    tradeableMarkets: views.filter((view) => view.tradeable).length,
  };
}

export function metricStateView<T>(
  state: MetricState<T>,
  formatKnown: (value: T) => string,
): Pick<MarketMetricView, "detail" | "value"> {
  if (state.status === "known") return { value: formatKnown(state.value) };
  return {
    detail: state.reasons.join(" "),
    value: stateLabel(state.status),
  };
}

export function formatRational(value: ExactRational, maximumFractionDigits = 4): string {
  const negative = value.numerator < 0n;
  const numerator = negative ? -value.numerator : value.numerator;
  if (numerator === 0n) return "0";
  const scale = 10n ** BigInt(maximumFractionDigits);
  const scaled = (numerator * scale) / value.denominator;
  if (scaled === 0n) {
    const threshold = `0.${"0".repeat(Math.max(0, maximumFractionDigits - 1))}1`;
    return negative ? `>-${threshold}` : `<${threshold}`;
  }
  const whole = scaled / scale;
  const fraction = (scaled % scale).toString().padStart(maximumFractionDigits, "0").replace(/0+$/, "");
  const decimal = fraction ? `${whole.toString()}.${fraction}` : whole.toString();
  const formatted = formatDecimalString(decimal, { compact: true, maximumFractionDigits });
  return negative ? `-${formatted}` : formatted;
}

function marketMetrics(input: {
  assets: MarketAssetContext;
  fullyDilutedValue: MetricState<ExactQuoteValue>;
  liveness: RouteLiveness;
  liquidity: MetricState<ExactTokenAmount>;
  marketCap: MetricState<ExactQuoteValue>;
  price: RoutePriceState;
  raised: MetricState<ExactTokenAmount>;
  routeLabel: string;
  routeSource: string;
}): MarketMetricView[] {
  const price = metricStateView(input.price, (value) => (
    `${formatRational(value.quotePerBase)} ${tokenLabel(input.assets.quoteMetadata, value.quoteToken)} / ${tokenLabel(input.assets.projectMetadata, value.baseToken)}`
  ));
  const marketCap = metricStateView(input.marketCap, (value) => formatQuoteValue(value, input.assets.quoteMetadata));
  const fdv = metricStateView(input.fullyDilutedValue, (value) => formatQuoteValue(value, input.assets.quoteMetadata));
  const liquidity = metricStateView(input.liquidity, (value) => (
    `${formatTokenAmount(value.raw, metadataForAmount(value, input.assets.quoteMetadata))} quote-side`
  ));
  const raised = metricStateView(input.raised, (value) => formatTokenAmount(value.raw, metadataForAmount(value, input.assets.quoteMetadata)));

  return [
    {
      label: "Route status",
      value: livenessLabel(input.liveness),
      detail: input.liveness.status === "live" ? input.routeLabel : livenessReason(input.liveness),
    },
    {
      label: `Price · ${input.routeSource}`,
      value: price.value,
      detail: price.detail ?? priceDetail(input.price),
    },
    {
      label: "Market cap · supply outside treasury",
      value: marketCap.value,
      detail: marketCap.detail ?? "Verified AMM spot × exact current project-token supply outside the Boardroom treasury, including holder, settled-grant, and migrated-liquidity balances.",
    },
    {
      label: "Fully diluted value",
      value: fdv.value,
      detail: fdv.detail ?? "Verified AMM spot × verified ERC-20 total supply.",
    },
    {
      label: "Liquidity depth",
      value: liquidity.value,
      detail: liquidity.detail ?? liquidityDetail(input.price, input.assets.projectMetadata),
    },
    {
      label: "Raised",
      value: raised.value,
      detail: raised.detail ?? "Quote tokens received by the indexed participation route.",
    },
  ];
}

function catalogRoutePrice(project: ProductBoardroomCatalogEntry): RoutePriceState {
  if (project.pool) {
    if (!project.shareToken) return unknownMetric("The AMM project token is unavailable in this directory row.");
    if (!project.cashToken) return unknownMetric("The AMM quote token is unavailable in this directory row.");
    if (project.shareTokenDecimals === undefined || project.cashTokenDecimals === undefined) {
      return unknownMetric("Token decimals are required to normalize the AMM spot price.");
    }
    if (!project.poolToken0 || !project.poolToken1 || project.poolReserve0 === undefined || project.poolReserve1 === undefined) {
      return unknownMetric(project.poolError ?? "Current AMM tokens and reserves have not been verified for this directory row.");
    }
    return verifiedAmmSpotPrice({
      pool: project.pool,
      token0: project.poolToken0,
      token1: project.poolToken1,
      reserve0: project.poolReserve0,
      reserve1: project.poolReserve1,
      projectToken: project.shareToken,
      projectDecimals: project.shareTokenDecimals,
      quoteToken: project.cashToken,
      quoteDecimals: project.cashTokenDecimals,
    });
  }
  if (project.distributionKind === "fixed-price-sale") {
    return unknownMetric("The directory does not expose the current fixed-sale unit price. Open the project for exact sale terms.");
  }
  if (project.distributionKind === "dutch-auction") {
    return unknownMetric("The directory does not expose the current Dutch-auction price. Open the project for exact terms.");
  }
  if (project.distributionKind === "bond-market") {
    return unknownMetric("The directory does not expose the bond market's current sequential-auction price. Open the project for exact terms.");
  }
  if (project.distributionKind === "migrating-bonding-curve") {
    return unknownMetric("A curve price requires an exact project-token amount and current curve quote. Open the project to quote it.");
  }
  if (project.distributionKind === "merkle-airdrop") {
    return notApplicableMetric("Airdrop claims do not have a purchase price.");
  }
  return unknownMetric("No tradeable route price was discovered for this project.");
}

function dashboardRoute(
  dashboard: ProductBoardroomDashboardState,
  catalog: ProductBoardroomCatalogEntry | undefined,
  now: bigint,
): { liveness: RouteLiveness; price: RoutePriceState; routeLabel: string; routeSource: string; tradeable: boolean } {
  if (catalog?.pool && dashboardPoolBelongsToSelectedRoute(dashboard, catalog)) {
    const price = catalogRoutePrice(catalog);
    const tokenPairVerified = Boolean(
      catalog.shareToken
      && catalog.cashToken
      && catalog.poolToken0
      && catalog.poolToken1
      && pairMatches(catalog.shareToken, catalog.cashToken, catalog.poolToken0, catalog.poolToken1),
    );
    const liveness = catalog.poolError
      ? routeLiveness("unknown", catalog.poolError)
      : routeLivenessForAmm({
          tokenPairVerified,
          reserve0: catalog.poolReserve0,
          reserve1: catalog.poolReserve1,
        });
    const poolLabel = `AMM market · ${shortAddress(catalog.pool)}`;
    return { liveness, price, routeLabel: poolLabel, routeSource: routePriceSource(price, poolLabel), tradeable: true };
  }

  const distribution = selectedDistribution(dashboard, catalog?.distribution, now);
  if (!distribution?.state) {
    const reason = distribution?.error ?? "No current participation route state could be verified.";
    return {
      liveness: routeLiveness("unknown", reason),
      price: unknownMetric(reason),
      routeLabel: distributionKindLabel(distribution?.kind),
      routeSource: distributionKindLabel(distribution?.kind),
      tradeable: isTradeRoute(distribution?.kind),
    };
  }

  if (distribution.kind === "bond-market" && "live" in distribution.state) {
    const metadata = distribution.shareTokenMetadata ?? dashboard.snapshot.shareTokenMetadata;
    const quote = distribution.quoteTokenMetadata;
    const price = metadata?.decimals === undefined || quote?.decimals === undefined
      ? unknownMetric<never>("Token decimals are required to normalize the bond market's current price.")
      : bondMarketUnitPrice({
          market: distribution.address,
          projectToken: distribution.state.shareToken,
          projectDecimals: metadata.decimals,
          quoteToken: distribution.state.quoteToken,
          quoteDecimals: quote.decimals,
          priceWad: distribution.state.currentPrice,
        });
    const live = distribution.state.live && distribution.state.capacity > 0n;
    const reason = distribution.state.status !== 0
      ? distribution.state.outstandingPayout > 0n
        ? "Bond purchases are closed while funded positions remain claimable at maturity."
        : "This bond market has settled."
      : distribution.state.capacity === 0n
        ? "The bond market has no remaining project-token capacity."
        : now < BigInt(distribution.state.startTime)
          ? `Bond purchases open at Unix time ${distribution.state.startTime}.`
          : now >= BigInt(distribution.state.conclusion)
            ? "The bond purchase window has ended."
            : dashboard.snapshot.status !== 0
              ? "The project lifecycle does not currently permit bond purchases."
              : "The bond market is not currently accepting purchases.";
    return {
      liveness: live ? routeLiveness("live") : routeLiveness("unavailable", reason),
      price,
      routeLabel: distribution.state.kind === 1 ? "Liquidity bond" : "Reserve bond",
      routeSource: routePriceSource(price, "Bond market state"),
      tradeable: true,
    };
  }

  if (distribution.kind === "dutch-auction" && "paymentToken" in distribution.state && "startPrice" in distribution.state) {
    const metadata = distribution.shareTokenMetadata ?? dashboard.snapshot.shareTokenMetadata;
    const quote = distribution.paymentTokenMetadata;
    const executable = deriveExecutableDistributionRoute({
      boardroomStatus: dashboard.snapshot.status,
      closed: distribution.state.closed,
      endTime: distribution.state.endTime,
      kind: "dutch-auction",
      now,
      remainingShares: distribution.state.remainingShares,
      routeStatus: distribution.state.saleStatus,
      startTime: distribution.state.startTime,
    });
    const price = executable.liveness.status !== "live"
      ? unavailableMetric<never>(
          `No executable Dutch-auction price is available: ${executable.buy.available ? "the auction is not live." : executable.buy.reason}`,
        )
      : metadata?.decimals === undefined || quote?.decimals === undefined
        ? unknownMetric<never>("Token decimals are required to normalize the Dutch auction's current price.")
        : dutchAuctionUnitPrice({
            auction: distribution.address,
            projectToken: distribution.state.shareToken,
            projectDecimals: metadata.decimals,
            quoteToken: distribution.state.paymentToken,
            quoteDecimals: quote.decimals,
            priceWad: dutchAuctionPriceAt(distribution.state, now),
          });
    return {
      liveness: executable.liveness,
      price,
      routeLabel: "Dutch auction",
      routeSource: executable.liveness.status === "live" ? "Live Dutch auction" : "No live Dutch auction price",
      tradeable: true,
    };
  }

  if (distribution.kind === "fixed-price-sale" && "paymentToken" in distribution.state && "price" in distribution.state) {
    const metadata = distribution.shareTokenMetadata ?? dashboard.snapshot.shareTokenMetadata;
    const quote = distribution.paymentTokenMetadata;
    const price = metadata?.decimals === undefined || quote?.decimals === undefined
      ? unknownMetric<never>("Token decimals are required to normalize the fixed-sale unit price.")
      : fixedSaleUnitPrice({
          sale: distribution.address,
          projectToken: distribution.state.shareToken,
          projectDecimals: metadata.decimals,
          quoteToken: distribution.state.paymentToken,
          quoteDecimals: quote.decimals,
          priceWad: distribution.state.price,
        });
    const executable = deriveExecutableDistributionRoute({
      boardroomStatus: dashboard.snapshot.status,
      closed: distribution.state.closed,
      endTime: distribution.state.endTime,
      kind: "fixed-price-sale",
      now,
      remainingShares: distribution.state.remainingShares,
      routeStatus: distribution.state.saleStatus,
      startTime: distribution.state.startTime,
    });
    return {
      liveness: executable.liveness,
      price,
      routeLabel: "Fixed-price sale",
      routeSource: "Fixed sale",
      tradeable: true,
    };
  }

  if (distribution.kind === "migrating-bonding-curve" && "curveStatus" in distribution.state) {
    const projectDecimals = distribution.shareTokenMetadata?.decimals ?? dashboard.snapshot.shareTokenMetadata?.decimals;
    const quoteDecimals = distribution.quoteTokenMetadata?.decimals;
    const executable = deriveExecutableDistributionRoute({
      boardroomStatus: dashboard.snapshot.status,
      closed: distribution.state.closed,
      endTime: distribution.state.endTime,
      graduationLatched: distribution.state.graduationLatched,
      kind: "migrating-bonding-curve",
      now,
      quoteReserve: distribution.state.quoteReserve,
      remainingSaleShares: distribution.state.remainingSaleShares,
      routeStatus: distribution.state.curveStatus,
      soldShares: distribution.state.soldShares,
      startTime: distribution.state.startTime,
    });
    let price: RoutePriceState;
    if (!executable.buy.available) {
      price = unknownMetric(`No executable curve buy quote is available: ${executable.buy.reason}`);
    } else if (projectDecimals === undefined || quoteDecimals === undefined) {
      price = unknownMetric("Token decimals are required to calculate an exact curve buy quote.");
    } else {
      const projectAmountRaw = curveBuyQuoteAmountRaw(distribution.state.remainingSaleShares, projectDecimals);
      const quoteAmountRaw = curveBuyQuoteRaw({
        basePrice: distribution.state.basePrice,
        slope: distribution.state.slope,
        soldShares: distribution.state.soldShares,
        projectAmountRaw,
      });
      price = curveQuoteUnitPrice({
        curve: distribution.address,
        side: "buy",
        projectToken: distribution.state.shareToken,
        projectDecimals,
        projectAmountRaw,
        quoteToken: distribution.state.quoteToken,
        quoteDecimals,
        quoteAmountRaw,
      });
    }
    return {
      liveness: executable.liveness,
      price,
      routeLabel: executable.mode === "sell-only" ? "Bonding curve · sell only" : "Bonding curve",
      routeSource: routePriceSource(price, executable.mode === "sell-only" ? "No executable buy quote" : "Curve buy quote"),
      tradeable: true,
    };
  }

  if (distribution.kind !== "merkle-airdrop" || !("airdropStatus" in distribution.state)) {
    const reason = "The selected participation route does not expose a supported current-state market view.";
    return {
      liveness: routeLiveness("unknown", reason),
      price: unknownMetric(reason),
      routeLabel: distributionKindLabel(distribution.kind),
      routeSource: distributionKindLabel(distribution.kind),
      tradeable: isTradeRoute(distribution.kind),
    };
  }
  const executable = deriveExecutableDistributionRoute({
    boardroomStatus: dashboard.snapshot.status,
    closed: distribution.state.closed,
    endTime: distribution.state.endTime,
    kind: "merkle-airdrop",
    now,
    remainingShares: distribution.state.remainingShares,
    routeStatus: distribution.state.airdropStatus,
    startTime: distribution.state.startTime,
  });
  return {
    liveness: executable.liveness,
    price: notApplicableMetric("Airdrop claims do not have a purchase price."),
    routeLabel: "Airdrop claim",
    routeSource: "No purchase price",
    tradeable: false,
  };
}

function dutchAuctionPriceAt(
  state: Pick<DutchAuctionState, "endTime" | "floorPrice" | "startPrice" | "startTime">,
  now: bigint,
): bigint {
  if (now <= state.startTime) return state.startPrice;
  if (now >= state.endTime) return state.floorPrice;
  const elapsed = now - state.startTime;
  const duration = state.endTime - state.startTime;
  const decrease = ((state.startPrice - state.floorPrice) * elapsed) / duration;
  return state.startPrice - decrease;
}

function dashboardSupplyOutsideTreasury(
  dashboard: ProductBoardroomDashboardState,
  catalog: ProductBoardroomCatalogEntry | undefined,
): MetricState<ExactTokenAmount> {
  const shareAsset = dashboard.treasuryAssets.find((asset) => sameAddress(asset.address, dashboard.snapshot.shareToken));
  return verifiedSupplyOutsideTreasury({
    projectToken: dashboard.snapshot.shareToken,
    projectDecimals: dashboard.snapshot.shareTokenMetadata?.decimals ?? catalog?.shareTokenDecimals,
    totalSupply: shareAsset?.totalSupply ?? catalog?.shareTokenTotalSupply,
    treasuryBalance: shareAsset?.balance ?? catalog?.shareTokenTreasuryBalance,
    unavailableReason: "Exact current project-token total supply and Boardroom treasury balance could not both be read; market cap is unknown rather than understated.",
  });
}

function catalogSupplyOutsideTreasury(project: ProductBoardroomCatalogEntry): MetricState<ExactTokenAmount> {
  if (!project.shareToken) return unknownMetric("The canonical project token is unavailable in this directory row.");
  return verifiedSupplyOutsideTreasury({
    projectToken: project.shareToken,
    projectDecimals: project.shareTokenDecimals,
    totalSupply: project.shareTokenTotalSupply,
    treasuryBalance: project.shareTokenTreasuryBalance,
    unavailableReason: "This directory row does not include both exact total supply and the current Boardroom treasury balance; market cap is unknown rather than understated.",
  });
}

function quoteLiquidity(price: RoutePriceState): MetricState<ExactTokenAmount> {
  if (price.status !== "known") return copyIssue(price);
  if (price.value.source !== "amm-spot") {
    return notApplicableMetric("Liquidity depth is shown only for a verified AMM reserve pair.");
  }
  return knownMetric(price.value.quoteDepth);
}

function catalogRaisedMetric(
  project: ProductBoardroomCatalogEntry | undefined,
  quoteMetadata: TokenMetadata | undefined,
): MetricState<ExactTokenAmount> {
  if (!project?.cashToken || project.cashRaised === undefined) {
    return unknownMetric("Indexed quote-token receipts are unavailable for this route.");
  }
  const decimals = project.cashTokenDecimals ?? quoteMetadata?.decimals;
  if (decimals === undefined) return unknownMetric("Quote-token decimals are unavailable, so raised amount cannot be normalized.");
  if (project.historyError) return unknownMetric(`Raised amount is partial because route history is incomplete: ${project.historyError}`);
  return knownMetric(exactTokenAmount(project.cashToken, project.cashRaised, decimals));
}

function catalogRouteLiveness(
  project: ProductBoardroomCatalogEntry,
  price: RoutePriceState,
  now: bigint,
): RouteLiveness {
  if (project.pool) {
    if (project.poolError) return routeLiveness("unknown", project.poolError);
    if (price.status === "known") return routeLiveness("live");
    if (price.status === "unavailable" && price.reason.includes("no two-sided liquidity")) {
      return routeLiveness("no-liquidity", price.reason);
    }
    return routeLiveness("unknown", price.reason);
  }
  const executable = catalogExecutableRoute(project, now);
  return executable?.liveness
    ?? routeLiveness("unknown", project.error ?? "The exact current route guards have not been verified in this directory row.");
}

function catalogExecutableRoute(
  project: ProductBoardroomCatalogEntry,
  now: bigint,
): ExecutableDistributionRoute | undefined {
  if (
    project.boardroomStatus === undefined
    || project.routeStatus === undefined
    || project.routeClosed === undefined
    || project.routeStartTime === undefined
    || project.routeEndTime === undefined
  ) return undefined;
  const common = {
    boardroomStatus: project.boardroomStatus,
    closed: project.routeClosed,
    endTime: project.routeEndTime,
    now,
    routeStatus: project.routeStatus,
    startTime: project.routeStartTime,
  };
  if (project.distributionKind === "fixed-price-sale" && project.routeBuyInventory !== undefined) {
    return deriveExecutableDistributionRoute({ ...common, kind: "fixed-price-sale", remainingShares: project.routeBuyInventory });
  }
  if (project.distributionKind === "dutch-auction" && project.routeBuyInventory !== undefined) {
    return deriveExecutableDistributionRoute({ ...common, kind: "dutch-auction", remainingShares: project.routeBuyInventory });
  }
  if (project.distributionKind === "merkle-airdrop" && project.routeClaimInventory !== undefined) {
    return deriveExecutableDistributionRoute({ ...common, kind: "merkle-airdrop", remainingShares: project.routeClaimInventory });
  }
  if (
    project.distributionKind === "migrating-bonding-curve"
    && project.routeBuyInventory !== undefined
    && project.routeSellInventory !== undefined
    && project.routeQuoteReserve !== undefined
    && project.routeGraduationLatched !== undefined
  ) {
    return deriveExecutableDistributionRoute({
      ...common,
      graduationLatched: project.routeGraduationLatched,
      kind: "migrating-bonding-curve",
      quoteReserve: project.routeQuoteReserve,
      remainingSaleShares: project.routeBuyInventory,
      soldShares: project.routeSellInventory,
    });
  }
  return undefined;
}

function catalogAssets(project: ProductBoardroomCatalogEntry): MarketAssetContext {
  return {
    projectMetadata: project.shareToken ? {
      address: project.shareToken,
      ...(project.shareTokenDecimals === undefined ? {} : { decimals: project.shareTokenDecimals }),
      ...(project.symbol ? { symbol: project.symbol } : {}),
    } : undefined,
    quoteMetadata: project.cashToken ? {
      address: project.cashToken,
      ...(project.cashTokenDecimals === undefined ? {} : { decimals: project.cashTokenDecimals }),
      ...(project.cashTokenSymbol ? { symbol: project.cashTokenSymbol } : {}),
    } : undefined,
  };
}

function dashboardAssets(
  dashboard: ProductBoardroomDashboardState,
  catalog: ProductBoardroomCatalogEntry | undefined,
  now: bigint,
): MarketAssetContext {
  const distribution = selectedDistribution(dashboard, catalog?.distribution, now);
  const quoteMetadata = distribution?.state && "paymentToken" in distribution.state
    ? distribution.paymentTokenMetadata
    : distribution?.state && "quoteToken" in distribution.state
      ? distribution.quoteTokenMetadata
      : catalogAssets(catalog ?? { address: dashboard.address }).quoteMetadata;
  return {
    projectMetadata: dashboard.snapshot.shareTokenMetadata ?? catalogAssets(catalog ?? { address: dashboard.address }).projectMetadata,
    quoteMetadata: quoteMetadata ?? catalogAssets(catalog ?? { address: dashboard.address }).quoteMetadata,
  };
}

function selectedCatalogEntry(dashboard: ProductBoardroomDashboardState): ProductBoardroomCatalogEntry | undefined {
  return dashboard.catalog.find((entry) => sameAddress(entry.address, dashboard.address));
}

function dashboardPoolBelongsToSelectedRoute(
  dashboard: ProductBoardroomDashboardState,
  catalog: ProductBoardroomCatalogEntry,
): boolean {
  if (!catalog.pool || catalog.distributionKind !== "migrating-bonding-curve") return false;
  const distribution = catalog.distribution
    ? dashboard.snapshot.distributionSummaries.find((candidate) => sameAddress(candidate.address, catalog.distribution))
    : undefined;
  if (
    distribution?.state
    && "quoteToken" in distribution.state
    && "pool" in distribution.state
    && !isZeroAddress(distribution.state.pool)
  ) return sameAddress(distribution.state.pool, catalog.pool);
  return Boolean((dashboard.histories ?? []).some((history) =>
    history.distribution
    && (!catalog.distribution || sameAddress(history.distribution, catalog.distribution))
    && history.pool
    && sameAddress(history.pool, catalog.pool)));
}

function dashboardHasPoolHistoryMismatch(
  dashboard: ProductBoardroomDashboardState,
  catalog: ProductBoardroomCatalogEntry | undefined,
): boolean {
  if (!catalog?.distribution) return false;
  const distribution = dashboard.snapshot.distributionSummaries.find((candidate) =>
    sameAddress(candidate.address, catalog.distribution));
  if (!distribution?.state || !("quoteToken" in distribution.state) || !("pool" in distribution.state) || isZeroAddress(distribution.state.pool)) {
    return false;
  }
  const history = (dashboard.histories ?? []).find((candidate) =>
    sameAddress(candidate.distribution, distribution.address));
  const historicalPool = history?.curve?.migration?.pool ?? history?.pool;
  return historicalPool !== undefined && !sameAddress(distribution.state.pool, historicalPool);
}

function selectedDistribution(
  dashboard: ProductBoardroomDashboardState,
  preferred: Address | undefined,
  now = currentUnixTimestamp(),
): BoardroomDistributionSnapshot | undefined {
  const preferredDistribution = preferred
    ? dashboard.snapshot.distributionSummaries.find((distribution) => sameAddress(distribution.address, preferred))
    : undefined;
  if (
    preferredDistribution
    && (
      dashboardExecutableRoute(dashboard, preferredDistribution, now)?.liveness.status === "live"
      || Boolean(preferredDistribution.state && "quoteToken" in preferredDistribution.state && "pool" in preferredDistribution.state && preferredDistribution.state.pool)
      || Boolean(preferredDistribution.kind === "bond-market" && preferredDistribution.state && "live" in preferredDistribution.state && preferredDistribution.state.live)
    )
  ) return preferredDistribution;
  return dashboard.snapshot.distributionSummaries.find((distribution) => {
    if (distribution.kind === "bond-market" && distribution.state && "live" in distribution.state) {
      return distribution.state.live && distribution.state.capacity > 0n;
    }
    const executable = dashboardExecutableRoute(dashboard, distribution, now);
    return executable?.liveness.status === "live";
  })
    ?? dashboard.snapshot.distributionSummaries.find((distribution) => Boolean(distribution.state && "quoteToken" in distribution.state && "pool" in distribution.state && distribution.state.pool))
    ?? preferredDistribution
    ?? dashboard.snapshot.distributionSummaries[0];
}

function dashboardExecutableRoute(
  dashboard: ProductBoardroomDashboardState,
  distribution: BoardroomDistributionSnapshot,
  now: bigint,
): ExecutableDistributionRoute | undefined {
  const state = distribution.state;
  if (!state) return undefined;
  if (distribution.kind === "bond-market") return undefined;
  if (distribution.kind === "fixed-price-sale" && "paymentToken" in state) {
    return deriveExecutableDistributionRoute({
      boardroomStatus: dashboard.snapshot.status,
      closed: state.closed,
      endTime: state.endTime,
      kind: "fixed-price-sale",
      now,
      remainingShares: state.remainingShares,
      routeStatus: state.saleStatus,
      startTime: state.startTime,
    });
  }
  if (distribution.kind === "dutch-auction" && "paymentToken" in state) {
    return deriveExecutableDistributionRoute({
      boardroomStatus: dashboard.snapshot.status,
      closed: state.closed,
      endTime: state.endTime,
      kind: "dutch-auction",
      now,
      remainingShares: state.remainingShares,
      routeStatus: state.saleStatus,
      startTime: state.startTime,
    });
  }
  if (distribution.kind === "migrating-bonding-curve" && "curveStatus" in state) {
    return deriveExecutableDistributionRoute({
      boardroomStatus: dashboard.snapshot.status,
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
    });
  }
  if (distribution.kind !== "merkle-airdrop" || !("airdropStatus" in state)) return undefined;
  return deriveExecutableDistributionRoute({
    boardroomStatus: dashboard.snapshot.status,
    closed: state.closed,
    endTime: state.endTime,
    kind: "merkle-airdrop",
    now,
    remainingShares: state.remainingShares,
    routeStatus: state.airdropStatus,
    startTime: state.startTime,
  });
}

function formatQuoteValue(value: ExactQuoteValue, metadata: TokenMetadata | undefined): string {
  return `${formatRational(value.units)} ${tokenLabel(metadata, value.quoteToken)}`;
}

function metadataForAmount(amount: ExactTokenAmount, metadata: TokenMetadata | undefined): TokenMetadata {
  return {
    address: amount.token,
    decimals: amount.decimals,
    ...(metadata?.symbol ? { symbol: metadata.symbol } : {}),
  };
}

function tokenLabel(metadata: TokenMetadata | undefined, fallback: Address): string {
  return metadata?.symbol ?? shortAddress(metadata?.address ?? fallback);
}

function liquidityDetail(price: RoutePriceState, projectMetadata: TokenMetadata | undefined): string | undefined {
  if (price.status !== "known" || price.value.source !== "amm-spot") return undefined;
  return `${formatTokenAmount(price.value.projectDepth.raw, metadataForAmount(price.value.projectDepth, projectMetadata))} project-side reserve in pool ${shortAddress(price.value.pool)}.`;
}

function priceDetail(price: RoutePriceState): string | undefined {
  if (price.status !== "known") return undefined;
  if (price.value.source === "amm-spot") {
    return `Current reserve ratio from pool ${shortAddress(price.value.pool)}; not a 24-hour average or external price feed.`;
  }
  if (price.value.source === "fixed-sale") return "Current contract sale price, denominated in the route quote token.";
  if (price.value.source === "dutch-auction") return "Current onchain Dutch-auction price; it continues descending until the purchase executes.";
  if (price.value.source === "bond-market") return `Current sequential-auction bond price from market ${shortAddress(price.value.market)}.`;
  const quotedAmount = formatTokenAmount(price.value.projectAmount.raw, {
    address: price.value.projectAmount.token,
    decimals: price.value.projectAmount.decimals,
  });
  return `Exact buy quote for ${quotedAmount} from current curve state and available inventory; larger amounts can execute at a different average price.`;
}

function livenessLabel(liveness: RouteLiveness): string {
  switch (liveness.status) {
    case "checking": return "Checking";
    case "live": return "Live";
    case "no-liquidity": return "No liquidity";
    case "deployment-pending": return "Deployment pending";
    case "unavailable": return "Unavailable";
    case "unknown": return "Unknown";
  }
}

function livenessReason(liveness: RouteLiveness): string | undefined {
  return "reason" in liveness ? liveness.reason : undefined;
}

function routePriceSource(price: RoutePriceState, fallback: string): string {
  if (price.status !== "known") return fallback;
  if (price.value.source === "amm-spot") return `AMM spot · ${shortAddress(price.value.pool)}`;
  if (price.value.source === "fixed-sale") return "Fixed sale";
  if (price.value.source === "dutch-auction") return "Dutch auction";
  if (price.value.source === "bond-market") return `Bond market · ${shortAddress(price.value.market)}`;
  return `Curve buy quote · ${formatTokenAmount(price.value.projectAmount.raw, {
    address: price.value.projectAmount.token,
    decimals: price.value.projectAmount.decimals,
  })}`;
}

function catalogRouteLabel(project: ProductBoardroomCatalogEntry, now: bigint): string {
  if (project.pool) return `AMM market · ${shortAddress(project.pool)}`;
  if (catalogExecutableRoute(project, now)?.mode === "sell-only") return "Bonding curve · sell only";
  return distributionKindLabel(project.distributionKind);
}

function distributionKindLabel(kind: string | undefined): string {
  if (kind === "bond-market") return "Bond market";
  if (kind === "dutch-auction") return "Dutch auction";
  if (kind === "fixed-price-sale") return "Fixed-price sale";
  if (kind === "migrating-bonding-curve") return "Bonding curve";
  if (kind === "merkle-airdrop") return "Airdrop claim";
  return "No active route";
}

function isTradeRoute(kind: string | undefined): boolean {
  return kind === "bond-market" || kind === "dutch-auction" || kind === "fixed-price-sale" || kind === "migrating-bonding-curve";
}

function pairMatches(project: Address, quote: Address, token0: Address, token1: Address): boolean {
  return (sameAddress(project, token0) && sameAddress(quote, token1))
    || (sameAddress(project, token1) && sameAddress(quote, token0));
}

function stateLabel(status: Exclude<MetricState<unknown>["status"], "known">): string {
  if (status === "not-applicable") return "Not applicable";
  if (status === "not-indexed") return "Not indexed";
  if (status === "unavailable") return "Unavailable";
  return "Unknown";
}

function copyIssue<T>(state: Exclude<MetricState<unknown>, { status: "known" }>): MetricState<T> {
  return { status: state.status, reason: state.reason, reasons: state.reasons };
}

function sameAddress(first: Address | undefined, second: Address | undefined): boolean {
  return first !== undefined && second !== undefined && first.toLowerCase() === second.toLowerCase();
}
