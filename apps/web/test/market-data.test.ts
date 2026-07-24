import { describe, expect, test } from "bun:test";
import type { Address } from "@pledge.cash/sdk";
import {
  curveBuyQuoteAmountRaw,
  curveBuyQuoteRaw,
  curveQuoteUnitPrice,
  curveSellQuoteRaw,
  deriveDistributedProjectSupply,
  deriveExecutableDistributionRoute,
  deriveMarketValuation,
  dutchAuctionUnitPrice,
  exactRational,
  exactTokenAmount,
  fixedSaleUnitPrice,
  knownMetric,
  notIndexedMarketActivity24h,
  routeLiveness,
  routeLivenessForAmm,
  swapExecutionMetrics,
  unknownMetric,
  verifiedAmmSpotPrice,
  verifiedSupplyOutsideTreasury,
  verifiedTotalSupply,
  type MetricState,
} from "../src/lib/market-data";

const pool = "0x1000000000000000000000000000000000000000" as Address;
const project = "0x2000000000000000000000000000000000000000" as Address;
const quote = "0x3000000000000000000000000000000000000000" as Address;
const foreign = "0x4000000000000000000000000000000000000000" as Address;
const sale = "0x5000000000000000000000000000000000000000" as Address;
const curve = "0x6000000000000000000000000000000000000000" as Address;
const distributionA = "0x7000000000000000000000000000000000000000" as Address;
const distributionB = "0x8000000000000000000000000000000000000000" as Address;
const distributionC = "0x9000000000000000000000000000000000000000" as Address;
const completeCoverage = {
  currentState: { complete: true },
  distributionSet: { complete: true },
  history: { complete: true },
} as const;

describe("truthful market data", () => {
  test("normalizes 6/18 decimal AMM spot and exposes oriented token-unit depth", () => {
    const token1Project = requireKnown(verifiedAmmSpotPrice({
      pool,
      token0: quote,
      token1: project,
      reserve0: 2_500_000n,
      reserve1: 5n * 10n ** 18n,
      projectToken: project,
      projectDecimals: 18,
      quoteToken: quote,
      quoteDecimals: 6,
    }));

    expect(token1Project.quotePerBase).toEqual(exactRational(1n, 2n));
    expect(token1Project.projectDepth.units).toEqual(exactRational(5n));
    expect(token1Project.quoteDepth.units).toEqual(exactRational(5n, 2n));

    const token0Project = requireKnown(verifiedAmmSpotPrice({
      pool,
      token0: project,
      token1: quote,
      reserve0: 5n * 10n ** 18n,
      reserve1: 2_500_000n,
      projectToken: project,
      projectDecimals: 18,
      quoteToken: quote,
      quoteDecimals: 6,
    }));
    expect(token0Project.quotePerBase).toEqual(token1Project.quotePerBase);
    expect(token0Project.projectDepth.raw).toBe(5n * 10n ** 18n);
    expect(token0Project.quoteDepth.raw).toBe(2_500_000n);
  });

  test("does not invent a spot price for zero reserves or mismatched pool tokens", () => {
    const empty = verifiedAmmSpotPrice({
      pool,
      token0: quote,
      token1: project,
      reserve0: 0n,
      reserve1: 10n ** 18n,
      projectToken: project,
      projectDecimals: 18,
      quoteToken: quote,
      quoteDecimals: 6,
    });
    expect(empty.status).toBe("unavailable");
    expect(requireIssue(empty).reason).toContain("no two-sided liquidity");

    const mismatch = verifiedAmmSpotPrice({
      pool,
      token0: quote,
      token1: foreign,
      reserve0: 1_000_000n,
      reserve1: 10n ** 18n,
      projectToken: project,
      projectDecimals: 18,
      quoteToken: quote,
      quoteDecimals: 6,
    });
    expect(mismatch.status).toBe("unavailable");
    expect(requireIssue(mismatch).reason).toContain("does not match");
  });

  test("keeps fixed-sale, Dutch-auction, and exact curve quotes as route prices, not AMM spot", () => {
    const fixed = requireKnown(fixedSaleUnitPrice({
      sale,
      projectToken: project,
      projectDecimals: 18,
      quoteToken: quote,
      quoteDecimals: 6,
      priceWad: 3_000_000n,
    }));
    expect(fixed.source).toBe("fixed-sale");
    expect(fixed.quotePerBase).toEqual(exactRational(3n));
    const auction = requireKnown(dutchAuctionUnitPrice({
      auction: sale,
      projectToken: project,
      projectDecimals: 18,
      quoteToken: quote,
      quoteDecimals: 6,
      priceWad: 2_500_000n,
    }));
    expect(auction.source).toBe("dutch-auction");
    expect(auction.quotePerBase).toEqual(exactRational(5n, 2n));

    const projectAmountRaw = 10n ** 18n;
    const buyQuote = curveBuyQuoteRaw({
      basePrice: 1_000_000n,
      slope: 2_000_000n,
      soldShares: 2n * 10n ** 18n,
      projectAmountRaw,
    });
    const sellQuote = curveSellQuoteRaw({
      basePrice: 1_000_000n,
      slope: 2_000_000n,
      soldShares: 3n * 10n ** 18n,
      projectAmountRaw,
    });
    expect(buyQuote).toBe(6_000_000n);
    expect(sellQuote).toBe(6_000_000n);

    const exactCurvePrice = requireKnown(curveQuoteUnitPrice({
      curve,
      side: "buy",
      projectToken: project,
      projectDecimals: 18,
      projectAmountRaw,
      quoteToken: quote,
      quoteDecimals: 6,
      quoteAmountRaw: buyQuote,
    }));
    expect(exactCurvePrice.source).toBe("curve-quote");
    expect(exactCurvePrice.quotePerBase).toEqual(exactRational(6n));
  });

  test("derives executable route liveness from every contract guard instead of the active enum alone", () => {
    const fixed = {
      boardroomStatus: 0,
      closed: false,
      endTime: 200n,
      kind: "fixed-price-sale" as const,
      now: 100n,
      remainingShares: 10n,
      routeStatus: 0,
      startTime: 50n,
    };
    expect(deriveExecutableDistributionRoute({ ...fixed, boardroomStatus: 1 })).toMatchObject({
      liveness: { status: "unavailable" },
      phase: "blocked",
    });
    expect(deriveExecutableDistributionRoute({ ...fixed, now: 49n })).toMatchObject({
      buy: { available: false },
      phase: "future",
    });
    expect(deriveExecutableDistributionRoute({ ...fixed, now: 201n })).toMatchObject({
      buy: { available: false },
      phase: "expired",
    });
    expect(deriveExecutableDistributionRoute({ ...fixed, kind: "dutch-auction" })).toMatchObject({
      buy: { available: true },
      liveness: { status: "live" },
    });
    expect(deriveExecutableDistributionRoute({ ...fixed, now: 200n })).toMatchObject({
      buy: { available: true },
      phase: "live",
    });
    expect(deriveExecutableDistributionRoute({ ...fixed, kind: "dutch-auction", now: 200n })).toMatchObject({
      buy: { available: false },
      phase: "expired",
    });

    const latched = deriveExecutableDistributionRoute({
      boardroomStatus: 0,
      closed: false,
      endTime: 0n,
      graduationLatched: true,
      kind: "migrating-bonding-curve",
      now: 100n,
      quoteReserve: 5n,
      remainingSaleShares: 10n,
      routeStatus: 0,
      soldShares: 5n,
      startTime: 0n,
    });
    expect(latched).toMatchObject({
      buy: { available: false },
      liveness: { status: "deployment-pending" },
      sell: { available: false },
    });
  });

  test("keeps an unlatched zero-buy-inventory curve live for sells", () => {
    const route = deriveExecutableDistributionRoute({
      boardroomStatus: 0,
      closed: false,
      endTime: 50n,
      graduationLatched: false,
      kind: "migrating-bonding-curve",
      now: 100n,
      quoteReserve: 20n,
      remainingSaleShares: 0n,
      routeStatus: 0,
      soldShares: 10n,
      startTime: 0n,
    });

    expect(route).toMatchObject({
      buy: { available: false },
      liveness: { status: "live" },
      mode: "sell-only",
      sell: { available: true },
    });
  });

  test("caps the representative curve quote at fractional remaining buy inventory", () => {
    expect(curveBuyQuoteAmountRaw(250_000_000_000_000_000n, 18)).toBe(250_000_000_000_000_000n);
    expect(curveBuyQuoteAmountRaw(2n * 10n ** 18n, 18)).toBe(10n ** 18n);
    expect(curveBuyQuoteAmountRaw(0n, 18)).toBe(0n);
  });

  test("derives current supply outside treasury from exact balances, including direct, settled, and LP supply", () => {
    const directMint = 20n;
    const settledGrant = 30n;
    const migratedLiquidity = 40n;
    const treasuryBalance = 10n;
    const supply = requireKnown(verifiedSupplyOutsideTreasury({
      projectToken: project,
      projectDecimals: 18,
      totalSupply: treasuryBalance + directMint + settledGrant + migratedLiquidity,
      treasuryBalance,
    }));

    expect(supply.raw).toBe(90n);
    expect(verifiedSupplyOutsideTreasury({
      projectToken: project,
      projectDecimals: 18,
      totalSupply: 100n,
      treasuryBalance: undefined,
    }).status).toBe("unknown");
  });

  test("requires complete current, lifetime, and history coverage for distributed supply", () => {
    const partial = deriveDistributedProjectSupply({
      projectToken: project,
      projectDecimals: 18,
      expectedDistributionCount: 1,
      distributions: [{
        address: distributionA,
        kind: "fixed-price-sale",
        saleSupply: 100n * 10n ** 18n,
        remainingShares: 40n * 10n ** 18n,
      }],
      coverage: {
        ...completeCoverage,
        history: { complete: false, reason: "event scan was truncated" },
      },
    });

    expect(partial.status).toBe("unknown");
    expect(requireIssue(partial).reasons).toEqual(["Distribution history is incomplete: event scan was truncated"]);
    expect("value" in partial).toBe(false);
  });

  test("rejects multi-distribution ambiguity and sums only a fully verified set", () => {
    const ambiguous = deriveDistributedProjectSupply({
      projectToken: project,
      projectDecimals: 18,
      expectedDistributionCount: 2,
      distributions: [{
        address: distributionA,
        kind: "fixed-price-sale",
        saleSupply: 100n,
        remainingShares: 40n,
      }],
      coverage: completeCoverage,
    });
    expect(ambiguous.status).toBe("unknown");
    expect(requireIssue(ambiguous).reason).toContain("Expected 2 distributions");

    const complete = requireKnown(deriveDistributedProjectSupply({
      projectToken: project,
      projectDecimals: 18,
      expectedDistributionCount: 3,
      distributions: [
        { address: distributionA, kind: "fixed-price-sale", saleSupply: 100n, remainingShares: 40n },
        { address: distributionB, kind: "merkle-airdrop", airdropSupply: 50n, claimedShares: 25n },
        { address: distributionC, kind: "migrating-bonding-curve", saleSupply: 200n, soldShares: 75n },
      ],
      coverage: completeCoverage,
    }));
    expect(complete.raw).toBe(160n);
  });

  test("uses recorded Dutch-auction sales after returned inventory clears remaining shares", () => {
    const distributed = requireKnown(deriveDistributedProjectSupply({
      projectToken: project,
      projectDecimals: 18,
      expectedDistributionCount: 1,
      distributions: [{
        address: distributionA,
        kind: "dutch-auction",
        saleSupply: 100n,
        soldShares: 25n,
      }],
      coverage: completeCoverage,
    }));

    expect(distributed.raw).toBe(25n);
  });

  test("keeps market cap and FDV independent and uses AMM spot only", () => {
    const spot = verifiedAmmSpotPrice({
      pool,
      token0: quote,
      token1: project,
      reserve0: 500_000_000n,
      reserve1: 1_000n * 10n ** 18n,
      projectToken: project,
      projectDecimals: 18,
      quoteToken: quote,
      quoteDecimals: 6,
    });
    const distributedUnknown = unknownMetric<ReturnType<typeof exactTokenAmount>>("Distribution history is partial.");
    const totalSupply = verifiedTotalSupply(project, 1_000n * 10n ** 18n, 18);
    const independent = deriveMarketValuation({ spotPrice: spot, currentSupplyOutsideTreasury: distributedUnknown, totalSupply });

    expect(independent.marketCap.status).toBe("unknown");
    expect(requireIssue(independent.marketCap).reason).toBe("Distribution history is partial.");
    const fdv = requireKnown(independent.fullyDilutedValue);
    expect(fdv.units).toEqual(exactRational(500n));
    expect(fdv.raw).toEqual(exactRational(500_000_000n));

    const distributed = knownMetric(exactTokenAmount(project, 100n * 10n ** 18n, 18));
    const complete = deriveMarketValuation({ spotPrice: spot, currentSupplyOutsideTreasury: distributed, totalSupply });
    expect(requireKnown(complete.marketCap).units).toEqual(exactRational(50n));
    expect(requireKnown(complete.fullyDilutedValue).units).toEqual(exactRational(500n));

    const salePrice = fixedSaleUnitPrice({
      sale,
      projectToken: project,
      projectDecimals: 18,
      quoteToken: quote,
      quoteDecimals: 6,
      priceWad: 3_000_000n,
    });
    const saleValuation = deriveMarketValuation({ spotPrice: salePrice, currentSupplyOutsideTreasury: distributed, totalSupply });
    expect(saleValuation.marketCap.status).toBe("unavailable");
    expect(requireIssue(saleValuation.marketCap).reason).toContain("sale and curve route prices are not market spot");
  });

  test("computes exact fee-inclusive buy and sell execution impact separately from slippage", () => {
    const buy = swapExecutionMetrics({
      tokenIn: quote,
      tokenInDecimals: 6,
      tokenOut: project,
      tokenOutDecimals: 18,
      amountIn: 100_000_000n,
      amountOut: 181n * 10n ** 18n,
      reserveIn: 1_000_000_000n,
      reserveOut: 2_000n * 10n ** 18n,
    });
    expect(requireKnown(buy.effectiveExecutionPrice).quotePerBase).toEqual(exactRational(181n, 100n));
    expect(requireKnown(buy.feeInclusivePriceImpact)).toEqual(exactRational(19n, 200n));

    const sell = swapExecutionMetrics({
      tokenIn: project,
      tokenInDecimals: 18,
      tokenOut: quote,
      tokenOutDecimals: 6,
      amountIn: 100n * 10n ** 18n,
      amountOut: 45_000_000n,
      reserveIn: 2_000n * 10n ** 18n,
      reserveOut: 1_000_000_000n,
    });
    expect(requireKnown(sell.effectiveExecutionPrice).quotePerBase).toEqual(exactRational(9n, 20n));
    expect(requireKnown(sell.feeInclusivePriceImpact)).toEqual(exactRational(1n, 10n));
  });

  test("represents route liveness and unavailable 24h indexing explicitly", () => {
    expect(routeLiveness("checking")).toEqual({ status: "checking" });
    expect(routeLiveness("deployment-pending", "waiting for migration")).toEqual({
      status: "deployment-pending",
      reason: "waiting for migration",
    });
    expect(routeLivenessForAmm({ tokenPairVerified: true, reserve0: 0n, reserve1: 1n }).status).toBe("no-liquidity");
    expect(routeLivenessForAmm({ tokenPairVerified: true }).status).toBe("unknown");
    expect(routeLivenessForAmm({ tokenPairVerified: false, reserve0: 1n, reserve1: 1n }).status).toBe("unavailable");

    const activity = notIndexedMarketActivity24h();
    expect(activity.priceChange.status).toBe("not-indexed");
    expect(activity.volume.status).toBe("not-indexed");
    expect("value" in activity.priceChange).toBe(false);
    expect("value" in activity.volume).toBe(false);
  });
});

function requireKnown<T>(state: MetricState<T>): T {
  if (state.status !== "known") throw new Error(state.reason);
  return state.value;
}

function requireIssue<T>(state: MetricState<T>): Exclude<MetricState<T>, { status: "known" }> {
  if (state.status === "known") throw new Error("Expected an unavailable metric.");
  return state;
}
