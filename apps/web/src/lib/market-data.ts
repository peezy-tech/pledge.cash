import type { Address } from "@pledge.cash/sdk";

const WAD = 1_000_000_000_000_000_000n;

export type ExactRational = {
  numerator: bigint;
  denominator: bigint;
};

export type MetricState<T> =
  | { status: "known"; value: T }
  | { status: "unknown"; reason: string; reasons: readonly string[] }
  | { status: "unavailable"; reason: string; reasons: readonly string[] }
  | { status: "not-applicable"; reason: string; reasons: readonly string[] }
  | { status: "not-indexed"; reason: string; reasons: readonly string[] };

export type ExactTokenAmount = {
  token: Address;
  raw: bigint;
  decimals: number;
  units: ExactRational;
};

export type NormalizedPrice = {
  baseToken: Address;
  baseDecimals: number;
  quoteToken: Address;
  quoteDecimals: number;
  quotePerBase: ExactRational;
};

export type VerifiedAmmSpotPrice = NormalizedPrice & {
  source: "amm-spot";
  pool: Address;
  projectDepth: ExactTokenAmount;
  quoteDepth: ExactTokenAmount;
};

export type FixedSaleRoutePrice = NormalizedPrice & {
  source: "fixed-sale";
  sale: Address;
};

export type DutchAuctionRoutePrice = NormalizedPrice & {
  source: "dutch-auction";
  auction: Address;
};

export type BondMarketRoutePrice = NormalizedPrice & {
  source: "bond-market";
  market: Address;
};

export type CurveQuoteRoutePrice = NormalizedPrice & {
  source: "curve-quote";
  curve: Address;
  side: "buy" | "sell";
  projectAmount: ExactTokenAmount;
  quoteAmount: ExactTokenAmount;
};

export type RoutePrice = VerifiedAmmSpotPrice | FixedSaleRoutePrice | DutchAuctionRoutePrice | BondMarketRoutePrice | CurveQuoteRoutePrice;
export type RoutePriceState = MetricState<RoutePrice>;

export type RouteLiveness =
  | { status: "checking" }
  | { status: "live" }
  | { status: "no-liquidity"; reason: string }
  | { status: "unavailable"; reason: string }
  | { status: "deployment-pending"; reason: string }
  | { status: "unknown"; reason: string };

export type RouteActionAvailability =
  | { available: true }
  | { available: false; reason: string };

export type ExecutableRouteMode = "buy-only" | "buy-and-sell" | "sell-only" | "claim-only" | "history-only";
export type ExecutableRoutePhase = "live" | "future" | "expired" | "closed" | "blocked" | "unknown";

export type ExecutableDistributionRoute = {
  buy: RouteActionAvailability;
  claim: RouteActionAvailability;
  liveness: RouteLiveness;
  mode: ExecutableRouteMode;
  phase: ExecutableRoutePhase;
  sell: RouteActionAvailability;
};

type ExecutableRouteCommonInput = {
  boardroomStatus?: number | undefined;
  closed: boolean;
  endTime: bigint;
  now: bigint;
  routeStatus: number;
  startTime: bigint;
};

export type ExecutableDistributionRouteInput =
  | (ExecutableRouteCommonInput & {
      kind: "dutch-auction";
      remainingShares: bigint;
    })
  | (ExecutableRouteCommonInput & {
      kind: "fixed-price-sale";
      remainingShares: bigint;
    })
  | (ExecutableRouteCommonInput & {
      graduationLatched: boolean;
      kind: "migrating-bonding-curve";
      quoteReserve: bigint;
      remainingSaleShares: bigint;
      soldShares: bigint;
    })
  | (ExecutableRouteCommonInput & {
      kind: "merkle-airdrop";
      remainingShares: bigint;
    });

export type MarketActivity24h = {
  priceChange: MetricState<ExactRational>;
  volume: MetricState<ExactTokenAmount>;
};

export type DistributionSupplyRecord =
  | {
      address: Address;
      kind: "dutch-auction";
      saleSupply: bigint;
      soldShares: bigint;
    }
  | {
      address: Address;
      kind: "fixed-price-sale";
      saleSupply: bigint;
      remainingShares: bigint;
    }
  | {
      address: Address;
      kind: "migrating-bonding-curve";
      saleSupply: bigint;
      soldShares: bigint;
    }
  | {
      address: Address;
      kind: "merkle-airdrop";
      airdropSupply: bigint;
      claimedShares: bigint;
    };

export type SupplyCoverage = {
  complete: boolean;
  reason?: string | undefined;
};

export type DistributedSupplyInput = {
  projectToken: Address;
  projectDecimals: number;
  distributions: readonly DistributionSupplyRecord[];
  expectedDistributionCount: number;
  coverage: {
    currentState: SupplyCoverage;
    distributionSet: SupplyCoverage;
    history: SupplyCoverage;
  };
};

export type ExactQuoteValue = {
  quoteToken: Address;
  quoteDecimals: number;
  raw: ExactRational;
  units: ExactRational;
};

export type MarketValuation = {
  marketCap: MetricState<ExactQuoteValue>;
  fullyDilutedValue: MetricState<ExactQuoteValue>;
};

export type SwapExecutionMetrics = {
  effectiveExecutionPrice: MetricState<NormalizedPrice>;
  feeInclusivePriceImpact: MetricState<ExactRational>;
};

export function exactRational(numerator: bigint, denominator: bigint = 1n): ExactRational {
  if (denominator === 0n) throw new Error("An exact rational denominator cannot be zero.");
  if (numerator === 0n) return { numerator: 0n, denominator: 1n };
  const sign = denominator < 0n ? -1n : 1n;
  const normalizedNumerator = numerator * sign;
  const normalizedDenominator = denominator * sign;
  const divisor = greatestCommonDivisor(absoluteBigInt(normalizedNumerator), normalizedDenominator);
  return {
    numerator: normalizedNumerator / divisor,
    denominator: normalizedDenominator / divisor,
  };
}

export function multiplyRationals(first: ExactRational, second: ExactRational): ExactRational {
  return exactRational(first.numerator * second.numerator, first.denominator * second.denominator);
}

export function divideRationals(first: ExactRational, second: ExactRational): ExactRational {
  if (second.numerator === 0n) throw new Error("Cannot divide by an exact zero value.");
  return exactRational(first.numerator * second.denominator, first.denominator * second.numerator);
}

export function subtractRationals(first: ExactRational, second: ExactRational): ExactRational {
  return exactRational(
    first.numerator * second.denominator - second.numerator * first.denominator,
    first.denominator * second.denominator,
  );
}

export function compareRationals(first: ExactRational, second: ExactRational): -1 | 0 | 1 {
  const difference = first.numerator * second.denominator - second.numerator * first.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

export function knownMetric<T>(value: T): MetricState<T> {
  return { status: "known", value };
}

export function unknownMetric<T>(reason: string | readonly string[]): MetricState<T> {
  return issueMetric("unknown", reason);
}

export function unavailableMetric<T>(reason: string | readonly string[]): MetricState<T> {
  return issueMetric("unavailable", reason);
}

export function notApplicableMetric<T>(reason: string | readonly string[]): MetricState<T> {
  return issueMetric("not-applicable", reason);
}

export function notIndexedMetric<T>(reason: string | readonly string[]): MetricState<T> {
  return issueMetric("not-indexed", reason);
}

export function exactTokenAmount(token: Address, raw: bigint, decimals: number): ExactTokenAmount {
  requireNonNegative(raw, "Token amount");
  return { token, raw, decimals: checkedDecimals(decimals), units: exactRational(raw, powerOfTen(decimals)) };
}

export function normalizedPriceFromAmounts(
  baseAmount: ExactTokenAmount,
  quoteAmount: ExactTokenAmount,
): NormalizedPrice {
  if (baseAmount.raw === 0n) throw new Error("A normalized price requires a positive base-token amount.");
  return {
    baseToken: baseAmount.token,
    baseDecimals: baseAmount.decimals,
    quoteToken: quoteAmount.token,
    quoteDecimals: quoteAmount.decimals,
    quotePerBase: divideRationals(quoteAmount.units, baseAmount.units),
  };
}

export function verifiedAmmSpotPrice(input: {
  pool: Address;
  token0: Address;
  token1: Address;
  reserve0: bigint;
  reserve1: bigint;
  projectToken: Address;
  projectDecimals: number;
  quoteToken: Address;
  quoteDecimals: number;
}): MetricState<VerifiedAmmSpotPrice> {
  if (sameAddress(input.projectToken, input.quoteToken)) {
    return unavailableMetric("Project and quote tokens must be different.");
  }
  const projectIsToken0 = sameAddress(input.projectToken, input.token0);
  const projectIsToken1 = sameAddress(input.projectToken, input.token1);
  const quoteIsToken0 = sameAddress(input.quoteToken, input.token0);
  const quoteIsToken1 = sameAddress(input.quoteToken, input.token1);
  if (!(projectIsToken0 && quoteIsToken1) && !(projectIsToken1 && quoteIsToken0)) {
    return unavailableMetric("The AMM pool token pair does not match the project and quote tokens.");
  }
  if (input.reserve0 < 0n || input.reserve1 < 0n) {
    return unavailableMetric("AMM reserves cannot be negative.");
  }
  const projectReserve = projectIsToken0 ? input.reserve0 : input.reserve1;
  const quoteReserve = quoteIsToken0 ? input.reserve0 : input.reserve1;
  if (projectReserve === 0n || quoteReserve === 0n) {
    return unavailableMetric("The AMM pool has no two-sided liquidity.");
  }
  const projectDepth = exactTokenAmount(input.projectToken, projectReserve, input.projectDecimals);
  const quoteDepth = exactTokenAmount(input.quoteToken, quoteReserve, input.quoteDecimals);
  return knownMetric({
    ...normalizedPriceFromAmounts(projectDepth, quoteDepth),
    source: "amm-spot",
    pool: input.pool,
    projectDepth,
    quoteDepth,
  });
}

export function fixedSaleUnitPrice(input: {
  sale: Address;
  projectToken: Address;
  projectDecimals: number;
  quoteToken: Address;
  quoteDecimals: number;
  priceWad: bigint;
}): MetricState<FixedSaleRoutePrice> {
  if (input.priceWad <= 0n) return unavailableMetric("The fixed sale does not expose a positive unit price.");
  const projectDecimals = checkedDecimals(input.projectDecimals);
  const quoteDecimals = checkedDecimals(input.quoteDecimals);
  return knownMetric({
    source: "fixed-sale",
    sale: input.sale,
    baseToken: input.projectToken,
    baseDecimals: projectDecimals,
    quoteToken: input.quoteToken,
    quoteDecimals,
    quotePerBase: exactRational(
      input.priceWad * powerOfTen(projectDecimals),
      WAD * powerOfTen(quoteDecimals),
    ),
  });
}

export function dutchAuctionUnitPrice(input: {
  auction: Address;
  projectToken: Address;
  projectDecimals: number;
  quoteToken: Address;
  quoteDecimals: number;
  priceWad: bigint;
}): MetricState<DutchAuctionRoutePrice> {
  if (input.priceWad <= 0n) return unavailableMetric("The Dutch auction does not expose a positive current price.");
  const projectDecimals = checkedDecimals(input.projectDecimals);
  const quoteDecimals = checkedDecimals(input.quoteDecimals);
  return knownMetric({
    source: "dutch-auction",
    auction: input.auction,
    baseToken: input.projectToken,
    baseDecimals: projectDecimals,
    quoteToken: input.quoteToken,
    quoteDecimals,
    quotePerBase: exactRational(
      input.priceWad * powerOfTen(projectDecimals),
      WAD * powerOfTen(quoteDecimals),
    ),
  });
}

export function bondMarketUnitPrice(input: {
  market: Address;
  projectToken: Address;
  projectDecimals: number;
  quoteToken: Address;
  quoteDecimals: number;
  priceWad: bigint;
}): MetricState<BondMarketRoutePrice> {
  if (input.priceWad <= 0n) return unavailableMetric("The bond market does not expose a positive current price.");
  const projectDecimals = checkedDecimals(input.projectDecimals);
  const quoteDecimals = checkedDecimals(input.quoteDecimals);
  return knownMetric({
    source: "bond-market",
    market: input.market,
    baseToken: input.projectToken,
    baseDecimals: projectDecimals,
    quoteToken: input.quoteToken,
    quoteDecimals,
    quotePerBase: exactRational(
      input.priceWad * powerOfTen(projectDecimals),
      WAD * powerOfTen(quoteDecimals),
    ),
  });
}

export function curveQuoteUnitPrice(input: {
  curve: Address;
  side: "buy" | "sell";
  projectToken: Address;
  projectDecimals: number;
  projectAmountRaw: bigint;
  quoteToken: Address;
  quoteDecimals: number;
  quoteAmountRaw: bigint;
}): MetricState<CurveQuoteRoutePrice> {
  if (input.projectAmountRaw <= 0n) return unavailableMetric("A curve price requires a positive project-token quote amount.");
  if (input.quoteAmountRaw <= 0n) return unavailableMetric("The exact curve quote returned no quote-token value.");
  const projectAmount = exactTokenAmount(input.projectToken, input.projectAmountRaw, input.projectDecimals);
  const quoteAmount = exactTokenAmount(input.quoteToken, input.quoteAmountRaw, input.quoteDecimals);
  return knownMetric({
    ...normalizedPriceFromAmounts(projectAmount, quoteAmount),
    source: "curve-quote",
    curve: input.curve,
    side: input.side,
    projectAmount,
    quoteAmount,
  });
}

export function curveBuyQuoteRaw(input: {
  basePrice: bigint;
  slope: bigint;
  soldShares: bigint;
  projectAmountRaw: bigint;
}): bigint {
  validateCurveQuoteInput(input);
  const linearQuote = multiplyDivideUp(input.basePrice, input.projectAmountRaw, WAD);
  const slopeNumerator = input.projectAmountRaw * (input.soldShares * 2n + input.projectAmountRaw);
  return linearQuote + multiplyDivideUp(input.slope, slopeNumerator, 2n * WAD * WAD);
}

export function curveSellQuoteRaw(input: {
  basePrice: bigint;
  slope: bigint;
  soldShares: bigint;
  projectAmountRaw: bigint;
}): bigint {
  validateCurveQuoteInput(input);
  if (input.projectAmountRaw > input.soldShares) throw new Error("A curve sell quote cannot exceed sold project shares.");
  const soldBefore = input.soldShares - input.projectAmountRaw;
  const linearQuote = (input.basePrice * input.projectAmountRaw) / WAD;
  const slopeNumerator = input.projectAmountRaw * (soldBefore * 2n + input.projectAmountRaw);
  return linearQuote + (input.slope * slopeNumerator) / (2n * WAD * WAD);
}

export function routeLiveness(status: RouteLiveness["status"], reason?: string): RouteLiveness {
  if (status === "checking" || status === "live") return { status };
  return { status, reason: reason ?? defaultLivenessReason(status) };
}

export function currentUnixTimestamp(nowMilliseconds = Date.now()): bigint {
  if (!Number.isFinite(nowMilliseconds)) throw new Error("Current time must be a finite millisecond timestamp.");
  return BigInt(Math.floor(nowMilliseconds / 1_000));
}

export function deriveExecutableDistributionRoute(
  input: ExecutableDistributionRouteInput,
): ExecutableDistributionRoute {
  const unavailable = (reason: string): RouteActionAvailability => ({ available: false, reason });
  const inactive = inactiveRouteReason(input);
  if (inactive) {
    const action = unavailable(inactive.reason);
    return {
      buy: action,
      claim: action,
      liveness: inactive.liveness,
      mode: "history-only",
      phase: inactive.phase,
      sell: action,
    };
  }

  if (input.kind === "fixed-price-sale" || input.kind === "dutch-auction") {
    const window = routeWindowState(input);
    const buy = window.available
      ? input.remainingShares > 0n
        ? { available: true } as const
        : unavailable(`No project-token inventory remains in this ${input.kind === "dutch-auction" ? "Dutch auction" : "fixed-price sale"}.`)
      : unavailable(window.reason);
    return executableRouteFromActions({ buy, claim: unavailable("This route does not support claims."), sell: unavailable("This route does not support sells.") }, window.phase);
  }

  if (input.kind === "merkle-airdrop") {
    const window = routeWindowState(input);
    const claim = window.available
      ? input.remainingShares > 0n
        ? { available: true } as const
        : unavailable("The published airdrop allocation has been fully claimed.")
      : unavailable(window.reason);
    return executableRouteFromActions({ buy: unavailable("This route does not support buys."), claim, sell: unavailable("This route does not support sells.") }, window.phase);
  }

  if (input.graduationLatched) {
    const reason = "Curve graduation is latched. Buys and sells are disabled while migration is pending.";
    const action = unavailable(reason);
    return {
      buy: action,
      claim: unavailable("This route does not support claims."),
      liveness: routeLiveness("deployment-pending", reason),
      mode: "history-only",
      phase: "blocked",
      sell: action,
    };
  }

  const window = routeWindowState(input);
  const buy = !window.available
    ? unavailable(window.reason)
    : input.remainingSaleShares > 0n
      ? { available: true } as const
      : unavailable("No buy inventory remains on this curve.");
  const sell = input.soldShares <= 0n
    ? unavailable("No project tokens have been sold through this curve, so no curve inventory can be sold back.")
    : input.quoteReserve <= 0n
      ? unavailable("The curve has no verified quote reserve available for sells.")
      : { available: true } as const;
  return executableRouteFromActions(
    { buy, claim: unavailable("This route does not support claims."), sell },
    window.phase,
  );
}

export function curveBuyQuoteAmountRaw(availableBuyInventory: bigint, projectDecimals: number): bigint {
  requireNonNegative(availableBuyInventory, "Curve buy inventory");
  const oneToken = powerOfTen(projectDecimals);
  return availableBuyInventory < oneToken ? availableBuyInventory : oneToken;
}

export function routeLivenessForAmm(input: {
  tokenPairVerified: boolean;
  reserve0?: bigint | undefined;
  reserve1?: bigint | undefined;
}): RouteLiveness {
  if (!input.tokenPairVerified) return routeLiveness("unavailable", "The pool token pair does not match this route.");
  if (input.reserve0 === undefined || input.reserve1 === undefined) {
    return routeLiveness("unknown", "Current AMM reserves have not been verified.");
  }
  if (input.reserve0 === 0n || input.reserve1 === 0n) {
    return routeLiveness("no-liquidity", "The AMM pool has no two-sided liquidity.");
  }
  return routeLiveness("live");
}

export function notIndexedMarketActivity24h(
  reason = "24-hour market activity is not indexed for this route.",
): MarketActivity24h {
  return {
    priceChange: notIndexedMetric(reason),
    volume: notIndexedMetric(reason),
  };
}

export function deriveDistributedProjectSupply(input: DistributedSupplyInput): MetricState<ExactTokenAmount> {
  const reasons = [
    coverageReason("Current distribution state", input.coverage.currentState),
    coverageReason("Lifetime distribution discovery", input.coverage.distributionSet),
    coverageReason("Distribution history", input.coverage.history),
  ].filter((reason): reason is string => reason !== undefined);

  if (!Number.isSafeInteger(input.expectedDistributionCount) || input.expectedDistributionCount < 0) {
    reasons.push("The expected distribution count is not a non-negative safe integer.");
  } else if (input.distributions.length !== input.expectedDistributionCount) {
    reasons.push(
      `Expected ${input.expectedDistributionCount.toString()} distributions but verified ${input.distributions.length.toString()}.`,
    );
  }

  const uniqueAddresses = new Set(input.distributions.map((distribution) => distribution.address.toLowerCase()));
  if (uniqueAddresses.size !== input.distributions.length) {
    reasons.push("Distribution supply is ambiguous because an address appears more than once.");
  }
  if (reasons.length > 0) return unknownMetric(reasons);

  let raw = 0n;
  for (const distribution of input.distributions) {
    const amount = distributedAmount(distribution);
    if (amount.status !== "known") return amount;
    raw += amount.value;
  }
  return knownMetric(exactTokenAmount(input.projectToken, raw, input.projectDecimals));
}

export function verifiedTotalSupply(
  projectToken: Address,
  raw: bigint | undefined,
  decimals: number | undefined,
  unavailableReason = "Verified ERC-20 total supply is unavailable.",
): MetricState<ExactTokenAmount> {
  if (raw === undefined || decimals === undefined) return unknownMetric(unavailableReason);
  if (raw < 0n) return unavailableMetric("Verified ERC-20 total supply cannot be negative.");
  return knownMetric(exactTokenAmount(projectToken, raw, decimals));
}

export function verifiedSupplyOutsideTreasury(input: {
  projectToken: Address;
  projectDecimals: number | undefined;
  totalSupply: bigint | undefined;
  treasuryBalance: bigint | undefined;
  unavailableReason?: string | undefined;
}): MetricState<ExactTokenAmount> {
  if (input.totalSupply === undefined || input.treasuryBalance === undefined || input.projectDecimals === undefined) {
    return unknownMetric(input.unavailableReason ?? "Verified project-token total supply and Boardroom treasury balance are required.");
  }
  if (input.totalSupply < 0n || input.treasuryBalance < 0n || input.treasuryBalance > input.totalSupply) {
    return unavailableMetric("Verified project-token supply outside treasury cannot be derived from the reported balances.");
  }
  return knownMetric(exactTokenAmount(
    input.projectToken,
    input.totalSupply - input.treasuryBalance,
    input.projectDecimals,
  ));
}

export function deriveMarketValuation(input: {
  spotPrice: RoutePriceState;
  currentSupplyOutsideTreasury: MetricState<ExactTokenAmount>;
  totalSupply: MetricState<ExactTokenAmount>;
}): MarketValuation {
  if (input.spotPrice.status !== "known") {
    return {
      marketCap: copyMetricIssue(input.spotPrice),
      fullyDilutedValue: copyMetricIssue(input.spotPrice),
    };
  }
  if (input.spotPrice.value.source !== "amm-spot") {
    const reason = "Market cap and FDV require a verified liquid AMM spot price; sale and curve route prices are not market spot.";
    return { marketCap: unavailableMetric(reason), fullyDilutedValue: unavailableMetric(reason) };
  }
  return {
    marketCap: valueSupplyAtSpot(input.spotPrice.value, input.currentSupplyOutsideTreasury),
    fullyDilutedValue: valueSupplyAtSpot(input.spotPrice.value, input.totalSupply),
  };
}

export function swapExecutionMetrics(input: {
  tokenIn: Address;
  tokenInDecimals: number;
  tokenOut: Address;
  tokenOutDecimals: number;
  amountIn: bigint;
  amountOut: bigint;
  reserveIn: bigint;
  reserveOut: bigint;
}): SwapExecutionMetrics {
  if (input.amountIn <= 0n || input.amountOut <= 0n) {
    const reason = "Execution metrics require positive input and output amounts.";
    return { effectiveExecutionPrice: unavailableMetric(reason), feeInclusivePriceImpact: unavailableMetric(reason) };
  }
  if (input.reserveIn <= 0n || input.reserveOut <= 0n) {
    const reason = "Execution metrics require verified two-sided AMM reserves.";
    return { effectiveExecutionPrice: unavailableMetric(reason), feeInclusivePriceImpact: unavailableMetric(reason) };
  }

  const inputAmount = exactTokenAmount(input.tokenIn, input.amountIn, input.tokenInDecimals);
  const outputAmount = exactTokenAmount(input.tokenOut, input.amountOut, input.tokenOutDecimals);
  const inputDepth = exactTokenAmount(input.tokenIn, input.reserveIn, input.tokenInDecimals);
  const outputDepth = exactTokenAmount(input.tokenOut, input.reserveOut, input.tokenOutDecimals);
  const effectiveExecutionPrice = normalizedPriceFromAmounts(inputAmount, outputAmount);
  const spotPrice = normalizedPriceFromAmounts(inputDepth, outputDepth);
  const feeInclusivePriceImpact = divideRationals(
    subtractRationals(spotPrice.quotePerBase, effectiveExecutionPrice.quotePerBase),
    spotPrice.quotePerBase,
  );

  return {
    effectiveExecutionPrice: knownMetric(effectiveExecutionPrice),
    feeInclusivePriceImpact: knownMetric(feeInclusivePriceImpact),
  };
}

function inactiveRouteReason(input: ExecutableDistributionRouteInput): {
  liveness: RouteLiveness;
  phase: Exclude<ExecutableRoutePhase, "live" | "future" | "expired">;
  reason: string;
} | undefined {
  if (input.boardroomStatus === undefined) {
    const reason = "The parent Boardroom status has not been verified.";
    return { liveness: routeLiveness("unknown", reason), phase: "unknown", reason };
  }
  if (input.boardroomStatus !== 0) {
    const reason = input.boardroomStatus === 1
      ? "The parent Boardroom is winding down, so this participation contract rejects actions."
      : input.boardroomStatus === 2
        ? "The parent Boardroom has opened redemptions, so this participation contract rejects actions."
        : `Parent Boardroom status ${input.boardroomStatus.toString()} is not recognized.`;
    return {
      liveness: routeLiveness(input.boardroomStatus === 1 || input.boardroomStatus === 2 ? "unavailable" : "unknown", reason),
      phase: input.boardroomStatus === 1 || input.boardroomStatus === 2 ? "blocked" : "unknown",
      reason,
    };
  }
  if (input.routeStatus !== 0 || input.closed) {
    const route = input.kind === "fixed-price-sale"
      ? "fixed-price sale"
      : input.kind === "dutch-auction"
        ? "Dutch auction"
      : input.kind === "migrating-bonding-curve"
        ? "bonding curve"
        : "airdrop";
    const reason = input.routeStatus === 1
      ? input.kind === "migrating-bonding-curve"
        ? "This bonding curve has migrated and accepts no further curve trades."
        : `This ${route} is closed.`
      : input.routeStatus === 2
        ? `This ${route} was cancelled.`
        : input.routeStatus === 0
          ? `This ${route} reports a closed contract state.`
          : `${routeStatusLabel(route)} ${input.routeStatus.toString()} is not recognized.`;
    const unknown = input.routeStatus !== 0 && input.routeStatus !== 1 && input.routeStatus !== 2;
    return {
      liveness: routeLiveness(unknown ? "unknown" : "unavailable", reason),
      phase: unknown ? "unknown" : "closed",
      reason,
    };
  }
  return undefined;
}

function routeWindowState(input: Pick<ExecutableDistributionRouteInput, "endTime" | "kind" | "now" | "startTime">):
  | { available: true; phase: "live" }
  | { available: false; phase: "future" | "expired"; reason: string } {
  if (input.now < input.startTime) {
    return { available: false, phase: "future", reason: "This route has not reached its configured start time." };
  }
  const ended = input.endTime !== 0n
    && (input.kind === "dutch-auction" ? input.now >= input.endTime : input.now > input.endTime);
  if (ended) {
    return { available: false, phase: "expired", reason: "This route is past its configured end time." };
  }
  return { available: true, phase: "live" };
}

function executableRouteFromActions(
  actions: Pick<ExecutableDistributionRoute, "buy" | "claim" | "sell">,
  inactiveWindowPhase: "live" | "future" | "expired",
): ExecutableDistributionRoute {
  const buy = actions.buy.available;
  const sell = actions.sell.available;
  const claim = actions.claim.available;
  const live = buy || sell || claim;
  const mode: ExecutableRouteMode = buy && sell
    ? "buy-and-sell"
    : buy
      ? "buy-only"
      : sell
        ? "sell-only"
        : claim
          ? "claim-only"
          : "history-only";
  const buyReason = routeActionReason(actions.buy);
  const claimReason = routeActionReason(actions.claim);
  const reason = live
    ? undefined
    : buyReason && buyReason !== "This route does not support buys."
      ? buyReason
      : claimReason && claimReason !== "This route does not support claims."
        ? claimReason
        : routeActionReason(actions.sell);
  return {
    ...actions,
    liveness: live ? routeLiveness("live") : routeLiveness("unavailable", reason),
    mode,
    phase: live ? "live" : inactiveWindowPhase === "live" ? "blocked" : inactiveWindowPhase,
  };
}

function routeActionReason(action: RouteActionAvailability): string | undefined {
  return action.available ? undefined : action.reason;
}

function routeStatusLabel(route: string): string {
  return route.charAt(0).toUpperCase() + route.slice(1) + " status";
}

function valueSupplyAtSpot(
  spotPrice: VerifiedAmmSpotPrice,
  supply: MetricState<ExactTokenAmount>,
): MetricState<ExactQuoteValue> {
  if (supply.status !== "known") return copyMetricIssue(supply);
  if (!sameAddress(spotPrice.baseToken, supply.value.token)) {
    return unavailableMetric("The verified supply token does not match the AMM project token.");
  }
  const units = multiplyRationals(spotPrice.quotePerBase, supply.value.units);
  return knownMetric({
    quoteToken: spotPrice.quoteToken,
    quoteDecimals: spotPrice.quoteDecimals,
    raw: multiplyRationals(units, exactRational(powerOfTen(spotPrice.quoteDecimals))),
    units,
  });
}

function distributedAmount(record: DistributionSupplyRecord): MetricState<bigint> {
  if (record.kind === "dutch-auction") {
    if (record.saleSupply < 0n || record.soldShares < 0n || record.soldShares > record.saleSupply) {
      return unknownMetric(`Dutch-auction supply state is invalid for ${record.address}.`);
    }
    return knownMetric(record.soldShares);
  }
  if (record.kind === "fixed-price-sale") {
    if (record.saleSupply < 0n || record.remainingShares < 0n || record.remainingShares > record.saleSupply) {
      return unknownMetric(`Fixed-sale supply state is invalid for ${record.address}.`);
    }
    return knownMetric(record.saleSupply - record.remainingShares);
  }
  if (record.kind === "migrating-bonding-curve") {
    if (record.saleSupply < 0n || record.soldShares < 0n || record.soldShares > record.saleSupply) {
      return unknownMetric(`Bonding-curve supply state is invalid for ${record.address}.`);
    }
    return knownMetric(record.soldShares);
  }
  if (record.airdropSupply < 0n || record.claimedShares < 0n || record.claimedShares > record.airdropSupply) {
    return unknownMetric(`Airdrop supply state is invalid for ${record.address}.`);
  }
  return knownMetric(record.claimedShares);
}

function validateCurveQuoteInput(input: {
  basePrice: bigint;
  slope: bigint;
  soldShares: bigint;
  projectAmountRaw: bigint;
}): void {
  requireNonNegative(input.basePrice, "Curve base price");
  requireNonNegative(input.slope, "Curve slope");
  requireNonNegative(input.soldShares, "Curve sold shares");
  requireNonNegative(input.projectAmountRaw, "Curve project amount");
}

function multiplyDivideUp(first: bigint, second: bigint, denominator: bigint): bigint {
  const product = first * second;
  if (product === 0n) return 0n;
  return (product + denominator - 1n) / denominator;
}

function coverageReason(label: string, coverage: SupplyCoverage): string | undefined {
  if (coverage.complete) return undefined;
  return coverage.reason ? `${label} is incomplete: ${coverage.reason}` : `${label} is incomplete.`;
}

function copyMetricIssue<T>(state: Exclude<MetricState<unknown>, { status: "known" }>): MetricState<T>;
function copyMetricIssue<T>(state: MetricState<unknown>): MetricState<T> {
  if (state.status === "known") throw new Error("A known metric cannot be copied as an issue.");
  return { status: state.status, reason: state.reason, reasons: state.reasons };
}

function issueMetric<T>(
  status: Exclude<MetricState<T>["status"], "known">,
  reason: string | readonly string[],
): MetricState<T> {
  const reasons = uniqueReasons(typeof reason === "string" ? [reason] : reason);
  const primary = reasons[0] ?? "No reason was provided.";
  return { status, reason: primary, reasons } as MetricState<T>;
}

function uniqueReasons(reasons: readonly string[]): string[] {
  return Array.from(new Set(reasons.map((reason) => reason.trim()).filter(Boolean)));
}

function checkedDecimals(decimals: number): number {
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error("Token decimals must be a whole number between 0 and 255.");
  }
  return decimals;
}

function powerOfTen(decimals: number): bigint {
  return 10n ** BigInt(checkedDecimals(decimals));
}

function requireNonNegative(value: bigint, label: string): void {
  if (value < 0n) throw new Error(`${label} cannot be negative.`);
}

function greatestCommonDivisor(first: bigint, second: bigint): bigint {
  let left = first;
  let right = second;
  while (right !== 0n) {
    const remainder = left % right;
    left = right;
    right = remainder;
  }
  return left;
}

function absoluteBigInt(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function sameAddress(first: Address, second: Address): boolean {
  return first.toLowerCase() === second.toLowerCase();
}

function defaultLivenessReason(status: Exclude<RouteLiveness["status"], "checking" | "live">): string {
  switch (status) {
    case "no-liquidity":
      return "The route has no two-sided liquidity.";
    case "deployment-pending":
      return "The route deployment is pending.";
    case "unavailable":
      return "The route is unavailable.";
    case "unknown":
      return "The route state is unknown.";
  }
}
