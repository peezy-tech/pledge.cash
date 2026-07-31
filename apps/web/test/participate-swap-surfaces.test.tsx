import { describe, expect, test } from "bun:test";
import type { Address, PledgeCashDeployment } from "@pledge.cash/sdk";
import { renderToString } from "react-dom/server";
import {
  ParticipatePage,
  nextParticipationSelectionNotification,
  participationOptions,
  resolveParticipationSelection,
  scheduleParticipationRefresh,
} from "../src/app/pages/participate-page";
import { Web3Provider } from "../src/components/web3-provider";
import { SwapPanel, liquidityActionState, positionActionState, swapActionState, swapDecisionFormKey } from "../src/features/swap/swap-panel";
import type { Capability } from "../src/features/capabilities/project-capabilities";
import { exactRational, knownMetric } from "../src/lib/market-data";
import type { ProductBoardroomDashboardState } from "../src/lib/product-boardroom";
import type { BoardroomDistributionSnapshot } from "../src/lib/types";
import {
  defaultLiquidityForm,
  defaultRemoveLiquidityForm,
  defaultSwapForm,
  swapQuoteRequestIdentity,
  type AmmPositionState,
  type LiquidityForm,
  type LiquidityQuoteState,
  type RemoveLiquidityQuoteState,
  type SwapForm,
  type SwapQuoteState,
} from "../src/lib/swap";

const boardroom = "0x1000000000000000000000000000000000000000" as Address;
const owner = "0x2000000000000000000000000000000000000000" as Address;
const shareToken = "0x3000000000000000000000000000000000000000" as Address;
const quoteToken = "0x4000000000000000000000000000000000000000" as Address;
const pool = "0x5000000000000000000000000000000000000000" as Address;
const emptyPool = "0x6000000000000000000000000000000000000000" as Address;
const distribution = "0x7000000000000000000000000000000000000000" as Address;
const emptyDistribution = "0x7100000000000000000000000000000000000000" as Address;
const locker = "0x7200000000000000000000000000000000000000" as Address;
const wrappedNative = "0x7300000000000000000000000000000000000000" as Address;
const router = "0x7400000000000000000000000000000000000000" as Address;
const factory = "0x7500000000000000000000000000000000000000" as Address;
const poolId = `0x${"11".repeat(32)}` as const;
const sqrtPriceX96 = 1n << 96n;
const deployment: PledgeCashDeployment = {
  chainId: 31337,
  permit2: owner,
  pledgeV4Hook: factory,
  pledgeV4LiquidityFactory: factory,
  uniswapUniversalRouter: router,
  uniswapV4Quoter: owner,
  uniswapV4StateView: owner,
  wrappedNative,
};

function v4PoolSummary(address: Address, liquidity: bigint) {
  return {
    address,
    token0: shareToken,
    token1: quoteToken,
    poolId,
    fee: 3_000,
    tickSpacing: 60,
    hooks: factory,
    liquidity,
    sqrtPriceX96,
  };
}

function fixedSaleSummary(startTime: bigint, endTime: bigint): BoardroomDistributionSnapshot {
  return {
    address: distribution,
    kind: "fixed-price-sale",
    state: {
      address: distribution,
      factory: owner,
      boardroom,
      shareToken,
      paymentToken: quoteToken,
      saleSupply: 10n,
      remainingShares: 10n,
      price: 1n,
      maxPerBuyer: 0n,
      startTime,
      endTime,
      saleStatus: 0,
      closed: false,
    },
    shareTokenMetadata: { address: shareToken, decimals: 18, symbol: "PLEDGE" },
    paymentTokenMetadata: { address: quoteToken, decimals: 6, symbol: "USDC" },
  };
}

function dutchAuctionSummary(startTime: bigint, endTime: bigint): BoardroomDistributionSnapshot {
  return {
    address: distribution,
    kind: "dutch-auction",
    state: {
      address: distribution,
      factory: owner,
      boardroom,
      shareToken,
      paymentToken: quoteToken,
      saleSupply: 10n,
      remainingShares: 10n,
      startPrice: 2n,
      floorPrice: 1n,
      currentPrice: 2n,
      maxPerBuyer: 0n,
      totalPayment: 0n,
      soldShares: 0n,
      lastPurchasePrice: 0n,
      settlementPrice: 0n,
      startTime,
      endTime,
      saleStatus: 0,
      closed: false,
    },
    shareTokenMetadata: { address: shareToken, decimals: 18, symbol: "PLEDGE" },
    paymentTokenMetadata: { address: quoteToken, decimals: 6, symbol: "USDC" },
  };
}

function migratedCurveSummary(address: Address, poolAddress: Address): BoardroomDistributionSnapshot {
  return {
    address,
    kind: "migrating-bonding-curve",
    state: {
      address,
      factory: owner,
      boardroom,
      liquidityFactory: owner,
      shareToken,
      quoteToken,
      liquidityVault: locker,
      liquidityPoolId: poolId,
      saleSupply: 10n,
      migrationSupply: 10n,
      remainingSaleShares: 0n,
      basePrice: 1n,
      slope: 0n,
      graduationQuoteTarget: 1n,
      quoteToLpBps: 8_000,
      startTime: 0n,
      endTime: 0n,
      migrationSalt: `0x${"11".repeat(32)}` as `0x${string}`,
      curveStatus: 1,
      soldShares: 10n,
      quoteReserve: 0n,
      graduationLatched: true,
      canMigrate: false,
      closed: true,
    },
    shareTokenMetadata: { address: shareToken, decimals: 18, symbol: "PLEDGE" },
    quoteTokenMetadata: { address: quoteToken, decimals: 6, symbol: "USDC" },
  };
}

const dashboard: ProductBoardroomDashboardState = {
  address: boardroom,
  catalog: [],
  histories: [
    { distribution, pool },
    { distribution: emptyDistribution, pool: emptyPool },
  ],
  nativeBalance: 0n,
  snapshot: {
    address: boardroom,
    owner,
    policyRegistry: owner,
    wrappedNative: owner,
    shareToken,
    status: 0,
    launched: true,
    controller: owner,
    proposer: owner,
    controllerDelay: 86_400n,
    controllerGracePeriod: 604_800n,
    controllerGeneration: 1n,
    controllerConfigurationEpoch: 1n,
    windDownDelay: 86_400n,
    governanceEpoch: 1n,
    governanceEligibleSupply: 1_000n,
    redeemableAssets: [],
    issuedGrants: [],
    issuedDistributions: [distribution, emptyDistribution],
    lockedLiquidityPositions: [],
    shareTokenMetadata: { address: shareToken, decimals: 18, symbol: "PLEDGE" },
    grantSummaries: [],
    distributionSummaries: [migratedCurveSummary(distribution, pool), migratedCurveSummary(emptyDistribution, emptyPool)],
    lockedLiquiditySummaries: [],
  },
  treasuryAssets: [],
};

const poolMarket = {
  error: undefined,
  loaded: true,
  loading: false,
  pools: [
    v4PoolSummary(pool, 1_000_000_000_000_000_000n),
    v4PoolSummary(emptyPool, 0n),
  ],
};

const swapForm: SwapForm = {
  ...defaultSwapForm(),
  tokenIn: shareToken,
  tokenOut: quoteToken,
  amountIn: "1",
  deadline: String(Math.floor(Date.now() / 1000) + 1_200),
};

const readyQuote: SwapQuoteState = {
  requestIdentity: swapQuoteRequestIdentity(swapForm),
  tokenIn: { address: shareToken, symbol: "PLEDGE", decimals: 18, balance: 5_000_000_000_000_000_000n, allowance: 2_000_000_000_000_000_000n },
  tokenOut: { address: quoteToken, symbol: "USDC", decimals: 6 },
  pool: {
    ...v4PoolSummary(pool, 100_000_000_000_000_000_000n),
  },
  amountIn: 1_000_000_000_000_000_000n,
  amountOut: 1_810_000n,
  amountOutMin: 1_800_950n,
  slippageBps: 50,
  feeBps: 3_000n,
  feeDenominator: 1_000_000n,
  effectiveExecutionPrice: knownMetric({
    baseToken: shareToken,
    baseDecimals: 18,
    quoteToken,
    quoteDecimals: 6,
    quotePerBase: exactRational(181n, 100n),
  }),
  feeInclusivePriceImpact: knownMetric(exactRational(19n, 200n)),
};

const liquidityForm: LiquidityForm = {
  ...defaultLiquidityForm(),
  tokenA: shareToken,
  tokenB: quoteToken,
  amountA: "2",
  amountB: "3",
  deadline: String(Math.floor(Date.now() / 1000) + 1_200),
};

const readyLiquidityQuote: LiquidityQuoteState = {
  tokenA: { address: shareToken, symbol: "PLEDGE", decimals: 18, balance: 5_000_000_000_000_000_000n, allowance: 2_000_000_000_000_000_000n },
  tokenB: { address: quoteToken, symbol: "USDC", decimals: 6, balance: 5_000_000n, allowance: 3_000_000n },
  pool: {
    address: pool,
    exists: true,
    poolId,
    token0: shareToken,
    token1: quoteToken,
    totalSupply: 100_000_000_000_000_000_000n,
    positionLiquidity: 100_000_000_000_000_000_000n,
    sqrtPriceX96,
    liquidityState: 1,
    fee: 3_000,
    tickSpacing: 60,
    hooks: factory,
    tickLower: -887_220,
    tickUpper: 887_220,
  },
  amountADesired: 2_000_000_000_000_000_000n,
  amountBDesired: 3_000_000n,
  amountA: 2_000_000_000_000_000_000n,
  amountB: 3_000_000n,
  amountAMin: 1_990_000_000_000_000_000n,
  amountBMin: 2_985_000n,
  liquidityOut: 1_000_000_000_000_000_000n,
  slippageBps: 50,
};

const readyPosition: AmmPositionState = {
  tokenA: readyLiquidityQuote.tokenA!,
  tokenB: readyLiquidityQuote.tokenB!,
  pool: readyLiquidityQuote.pool ? { ...readyLiquidityQuote.pool, liquidityState: 2 } : undefined,
  lpToken: { address: pool, symbol: "P4LP", decimals: 18, balance: 5_000_000_000_000_000_000n },
  lpBalance: 5_000_000_000_000_000_000n,
};

const readyRemoveLiquidityQuote: RemoveLiquidityQuoteState = {
  position: readyPosition,
  liquidity: 1_000_000_000_000_000_000n,
  amountA: 1_000_000_000_000_000_000n,
  amountB: 2_000_000n,
  amountAMin: 990_000_000_000_000_000n,
  amountBMin: 1_980_000n,
  slippageBps: 100,
};

const noop = async (): Promise<void> => undefined;
const enabledCapability: Capability = { status: "enabled" };
const wrongChainCapability: Capability = {
  status: "switch",
  reason: "Switch your wallet to chain 31337 to continue.",
};

function renderedButton(html: string, label: string): string {
  return (html.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? []).find((button) => button.includes(label)) ?? "";
}

function renderSwap(input: {
  account?: Address | undefined;
  actionCapability?: Capability | undefined;
  form?: SwapForm | undefined;
  pendingAction?: string | undefined;
  quote?: SwapQuoteState | undefined;
}): string {
  return renderToString(
    <Web3Provider>
      <SwapPanel
        account={input.account}
        actionCapability={input.actionCapability ?? { status: input.account ? "enabled" : "connect" }}
        boardroom={undefined}
        deployment={undefined}
        form={input.form ?? swapForm}
        liquidityForm={defaultLiquidityForm()}
        liquidityQuote={undefined}
        position={undefined}
        pendingAction={input.pendingAction}
        quote={input.quote}
        removeLiquidityForm={defaultRemoveLiquidityForm()}
        removeLiquidityQuote={undefined}
        setLiquidityForm={() => undefined}
        setRemoveLiquidityForm={() => undefined}
        setForm={() => undefined}
        tokenList={{ loaded: true, pools: [], tokens: [] }}
        tokenListLoading={false}
        wrappedNativeSymbol="WETH"
        mode="swap"
        projectShareToken={undefined}
        addLiquidity={noop}
        approveLiquidityTokenA={noop}
        approveLiquidityTokenB={noop}
        approveInput={noop}
        executeSwap={noop}
        refreshLiquidityQuote={noop}
        refreshPosition={noop}
        refreshQuote={noop}
        refreshRemoveLiquidityQuote={noop}
        refreshTokens={noop}
        removeLiquidity={noop}
        runAction={async (_label, action) => action()}
        switchWalletNetwork={noop}
      />
    </Web3Provider>,
  );
}

function renderLiquidity(input: {
  actionCapability?: Capability | undefined;
  liquidityForm?: LiquidityForm | undefined;
  liquidityQuote?: LiquidityQuoteState | undefined;
  nativeBalance?: bigint | undefined;
  pendingAction?: string | undefined;
  position?: AmmPositionState | undefined;
  removeLiquidityQuote?: RemoveLiquidityQuoteState | undefined;
} = {}): string {
  return renderToString(
    <Web3Provider>
      <SwapPanel
        account={owner}
        actionCapability={input.actionCapability ?? { status: "enabled" }}
        deployment={deployment}
        form={swapForm}
        liquidityForm={input.liquidityForm ?? liquidityForm}
        liquidityQuote={input.liquidityQuote ?? readyLiquidityQuote}
        nativeBalance={input.nativeBalance}
        position={input.position ?? readyPosition}
        pendingAction={input.pendingAction}
        quote={undefined}
        removeLiquidityForm={{ ...defaultRemoveLiquidityForm(), liquidity: "1", deadline: String(Math.floor(Date.now() / 1000) + 1_200) }}
        removeLiquidityQuote={input.removeLiquidityQuote ?? readyRemoveLiquidityQuote}
        setLiquidityForm={() => undefined}
        setRemoveLiquidityForm={() => undefined}
        setForm={() => undefined}
        tokenList={{ loaded: true, pools: [], tokens: [] }}
        tokenListLoading={false}
        wrappedNativeSymbol="WETH"
        mode="liquidity"
        addLiquidity={noop}
        approveLiquidityTokenA={noop}
        approveLiquidityTokenB={noop}
        approveInput={noop}
        executeSwap={noop}
        refreshLiquidityQuote={noop}
        refreshPosition={noop}
        refreshQuote={noop}
        refreshRemoveLiquidityQuote={noop}
        refreshTokens={noop}
        removeLiquidity={noop}
        runAction={async (_label, action) => action()}
        switchWalletNetwork={noop}
      />
    </Web3Provider>,
  );
}

class ParticipationFakeTimers {
  now: number;
  private nextId = 1;
  private readonly timers = new Map<number, { callback: () => void; runAt: number }>();

  constructor(now: number) {
    this.now = now;
  }

  readonly setTimeout = (callback: () => void, delayMs: number): ReturnType<typeof setTimeout> => {
    const id = this.nextId++;
    this.timers.set(id, { callback, runAt: this.now + delayMs });
    return id as unknown as ReturnType<typeof setTimeout>;
  };

  readonly clearTimeout = (timer: number | ReturnType<typeof setTimeout>): void => {
    this.timers.delete(timer as number);
  };

  advanceBy(delayMs: number): void {
    const target = this.now + delayMs;
    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.runAt <= target)
        .sort((left, right) => left[1].runAt - right[1].runAt || left[0] - right[0])[0];
      if (!next) break;
      const [id, timer] = next;
      this.timers.delete(id);
      this.now = timer.runAt;
      timer.callback();
    }
    this.now = target;
  }
}

describe("participation route liveness", () => {
  test("does not call an address-only Uniswap v4 route live", () => {
    const option = participationOptions(dashboard).find((candidate) => candidate.address === pool);
    expect(option).toMatchObject({ available: false, group: "unknown", status: "Unknown" });
    expect(option?.reason).toContain("PoolKey, slot0, and active liquidity have not been loaded");
  });

  test("derives live and zero-liquidity states from the exact pool snapshot", () => {
    const options = participationOptions(dashboard, {}, poolMarket);
    expect(options.find((candidate) => candidate.address === pool)).toMatchObject({ available: true, group: "live", status: "Live" });
    expect(options.find((candidate) => candidate.address === emptyPool)).toMatchObject({
      available: false,
      group: "unavailable",
      status: "No liquidity",
      reason: "The Uniswap v4 pool has no active liquidity at the current tick.",
    });
  });

  test("groups route choices and explains a zero-liquidity v4 pool", () => {
    const html = renderToString(<ParticipatePage dashboard={dashboard} loading={false} poolMarket={poolMarket} />);
    expect(html).toContain("Live now");
    expect(html).toContain("Unavailable");
    expect(html).toContain("No liquidity");
    expect(html).toContain("The Uniswap v4 pool has no active liquidity at the current tick.");
  });

  test("distinguishes checking and failed pool reads", () => {
    expect(participationOptions(dashboard, {}, { loaded: false, loading: true, pools: [] })[0]).toMatchObject({ group: "checking", status: "Checking" });
    expect(participationOptions(dashboard, {}, { error: "RPC timeout", loaded: true, loading: false, pools: [] })[0]).toMatchObject({
      group: "unavailable",
      status: "Unavailable",
      reason: "Current Uniswap v4 pool state could not be read: RPC timeout",
    });
  });

  test("does not enable an active-enum sale when the Boardroom is winding down or its window is closed", () => {
    const saleDashboard = {
      ...dashboard,
      histories: [],
      snapshot: {
        ...dashboard.snapshot,
        issuedDistributions: [distribution],
        distributionSummaries: [fixedSaleSummary(50n, 150n)],
        status: 1,
      },
    } satisfies ProductBoardroomDashboardState;
    expect(participationOptions(saleDashboard, {}, undefined, 100n)[0]).toMatchObject({
      available: false,
      group: "unavailable",
      status: "Unavailable",
    });

    const activeBoardroom = { ...saleDashboard, snapshot: { ...saleDashboard.snapshot, status: 0 } };
    expect(participationOptions(activeBoardroom, {}, undefined, 49n)[0]).toMatchObject({ status: "Scheduled" });
    expect(participationOptions(activeBoardroom, {}, undefined, 151n)[0]).toMatchObject({ group: "closed", status: "Window ended" });
  });

  test("keeps a zero-buy-inventory curve actionable as sell-only and labels each side", () => {
    const summary = migratedCurveSummary(distribution, "0x0000000000000000000000000000000000000000" as Address);
    if (!summary.state || !("quoteToken" in summary.state)) throw new Error("Expected curve fixture");
    const sellOnlyDashboard = {
      ...dashboard,
      histories: [],
      snapshot: {
        ...dashboard.snapshot,
        issuedDistributions: [distribution],
        distributionSummaries: [{
          ...summary,
          state: {
            ...summary.state,
            closed: false,
            curveStatus: 0,
            graduationLatched: false,
            quoteReserve: 1_000_000n,
            soldShares: 10n,
          },
        }],
      },
    } satisfies ProductBoardroomDashboardState;
    const option = participationOptions(sellOnlyDashboard, {}, undefined, 100n)[0];
    const html = renderToString(<ParticipatePage dashboard={sellOnlyDashboard} loading={false} />);

    expect(option).toMatchObject({ available: true, buyAvailable: false, sellAvailable: true, status: "Sell only" });
    expect(option?.reason).toContain("Buy unavailable");
    expect(html).toContain("Buy availability");
    expect(html).toContain("Sell availability");
    expect(html).toContain("Sell only");
  });

  test("blocks both curve sides when graduation is latched", () => {
    const summary = migratedCurveSummary(distribution, "0x0000000000000000000000000000000000000000" as Address);
    if (!summary.state || !("quoteToken" in summary.state)) throw new Error("Expected curve fixture");
    const latchedDashboard = {
      ...dashboard,
      histories: [],
      snapshot: {
        ...dashboard.snapshot,
        issuedDistributions: [distribution],
        distributionSummaries: [{
          ...summary,
          state: {
            ...summary.state,
            closed: false,
            curveStatus: 0,
            graduationLatched: true,
            quoteReserve: 1_000_000n,
            remainingSaleShares: 1n,
            soldShares: 9n,
          },
        }],
      },
    } satisfies ProductBoardroomDashboardState;

    expect(participationOptions(latchedDashboard, {}, undefined, 100n)[0]).toMatchObject({
      available: false,
      buyAvailable: false,
      sellAvailable: false,
      status: "Migration pending",
    });
  });

  test("synchronizes the first live AMM route once and preserves an explicit valid selection", () => {
    const ammDashboard = {
      ...dashboard,
      snapshot: {
        ...dashboard.snapshot,
        issuedDistributions: [],
        distributionSummaries: [],
      },
    } satisfies ProductBoardroomDashboardState;
    const initialOptions = participationOptions(ammDashboard);
    const initialSelection = resolveParticipationSelection(initialOptions, {});
    expect(initialSelection).toEqual({ automatic: true, route: `amm:${pool}` });

    const liveOptions = participationOptions(ammDashboard, {}, {
      loaded: true,
      loading: false,
      pools: [
        v4PoolSummary(pool, 0n),
        v4PoolSummary(emptyPool, 1_000_000_000_000_000_000n),
      ],
    });
    expect(liveOptions.map((option) => option.address)).toEqual([emptyPool, pool]);

    const synchronized = resolveParticipationSelection(liveOptions, {
      automaticSelection: initialSelection.route,
      selectedRoute: initialSelection.route,
    });
    expect(synchronized).toEqual({ automatic: true, route: `amm:${emptyPool}` });
    expect(resolveParticipationSelection(liveOptions, { selectedRoute: `amm:${pool}` })).toEqual({
      automatic: false,
      route: `amm:${pool}`,
    });

    const firstNotification = nextParticipationSelectionNotification(undefined, boardroom, synchronized);
    expect(firstNotification.notify).toBe(true);
    expect(nextParticipationSelectionNotification(firstNotification.key, boardroom, synchronized).notify).toBe(false);
  });

  test("falls back from a missing scoped identity while preserving the legacy AMM route alias", () => {
    const ammDashboard = {
      ...dashboard,
      snapshot: { ...dashboard.snapshot, issuedDistributions: [], distributionSummaries: [] },
    } satisfies ProductBoardroomDashboardState;
    const options = participationOptions(ammDashboard, {}, {
      loaded: true,
      loading: false,
      pools: [
        v4PoolSummary(pool, 0n),
        v4PoolSummary(emptyPool, 1n),
      ],
    });
    const missingPool = "0x8000000000000000000000000000000000000000" as Address;

    expect(resolveParticipationSelection(options, { selectedRoute: `amm:${missingPool}` })).toEqual({
      automatic: true,
      route: `amm:${emptyPool}`,
    });
    expect(resolveParticipationSelection(options, { selectedRoute: "amm" })).toEqual({
      automatic: true,
      route: `amm:${emptyPool}`,
    });
  });

  test("advances scheduled and expired route liveness at exact boundaries with fake timers", () => {
    const saleDashboard = {
      ...dashboard,
      histories: [],
      snapshot: {
        ...dashboard.snapshot,
        issuedDistributions: [distribution],
        distributionSummaries: [fixedSaleSummary(101n, 102n)],
      },
    } satisfies ProductBoardroomDashboardState;
    const timers = new ParticipationFakeTimers(100_000);
    const statuses: string[] = [];
    const stop = scheduleParticipationRefresh(
      saleDashboard,
      (now) => statuses.push(participationOptions(saleDashboard, {}, undefined, now)[0]?.status ?? "missing"),
      {
        clearTimeoutFn: timers.clearTimeout,
        nowMilliseconds: () => timers.now,
        setTimeoutFn: timers.setTimeout,
      },
    );

    expect(participationOptions(saleDashboard, {}, undefined, 100n)[0]?.status).toBe("Scheduled");
    timers.advanceBy(999);
    expect(statuses).toEqual([]);
    timers.advanceBy(1);
    expect(statuses).toEqual(["Live"]);
    timers.advanceBy(1_999);
    expect(statuses).toEqual(["Live"]);
    timers.advanceBy(1);
    expect(statuses).toEqual(["Live", "Window ended"]);
    stop();
  });

  test("expires a Dutch auction at its exclusive end boundary", () => {
    const auctionDashboard = {
      ...dashboard,
      histories: [],
      snapshot: {
        ...dashboard.snapshot,
        issuedDistributions: [distribution],
        distributionSummaries: [dutchAuctionSummary(101n, 102n)],
      },
    } satisfies ProductBoardroomDashboardState;
    const timers = new ParticipationFakeTimers(101_000);
    const statuses: string[] = [];
    const stop = scheduleParticipationRefresh(
      auctionDashboard,
      (now) => statuses.push(participationOptions(auctionDashboard, {}, undefined, now)[0]?.status ?? "missing"),
      {
        clearTimeoutFn: timers.clearTimeout,
        nowMilliseconds: () => timers.now,
        setTimeoutFn: timers.setTimeout,
      },
    );

    expect(participationOptions(auctionDashboard, {}, undefined, 101n)[0]?.status).toBe("Live");
    timers.advanceBy(999);
    expect(statuses).toEqual([]);
    timers.advanceBy(1);
    expect(statuses).toEqual(["Window ended"]);
    stop();
  });

  test("cancels a scheduled route refresh when the project route changes", () => {
    const saleDashboard = {
      ...dashboard,
      histories: [],
      snapshot: {
        ...dashboard.snapshot,
        issuedDistributions: [distribution],
        distributionSummaries: [fixedSaleSummary(101n, 102n)],
      },
    } satisfies ProductBoardroomDashboardState;
    const timers = new ParticipationFakeTimers(100_000);
    const statuses: bigint[] = [];
    const stop = scheduleParticipationRefresh(saleDashboard, (now) => statuses.push(now), {
      clearTimeoutFn: timers.clearTimeout,
      nowMilliseconds: () => timers.now,
      setTimeoutFn: timers.setTimeout,
    });

    stop();
    timers.advanceBy(3_000);
    expect(statuses).toEqual([]);
  });
});

describe("swap decision UX", () => {
  test("prioritizes execution metrics and keeps slippage separate", () => {
    const html = renderSwap({ account: owner, quote: readyQuote });
    expect(html).toContain('aria-label="Swap tokens"');
    expect(html.indexOf("Expected output")).toBeLessThan(html.indexOf("P4LP vault"));
    expect(html).toContain("Effective execution price");
    expect(html).toContain("1 PLEDGE = 1.81 USDC");
    expect(html).toContain("Price impact (including fee)");
    expect(html).toContain("9.5%");
    expect(html).toContain("Minimum received");
    expect(html).toContain("Uniswap v4 fee");
    expect(html).toContain("0.3%");
    expect(html).toContain("Quote expiry");
    expect(html).toContain("Slippage tolerance");
  });

  test("invalidates decision metrics when pair, amount, or execution preferences change", () => {
    const currentKey = swapDecisionFormKey(swapForm);
    expect(swapDecisionFormKey({ ...swapForm, tokenOut: pool })).not.toBe(currentKey);
    expect(swapDecisionFormKey({ ...swapForm, amountIn: "2" })).not.toBe(currentKey);
    expect(swapDecisionFormKey({ ...swapForm, slippageBps: "100" })).not.toBe(currentKey);
    expect(swapDecisionFormKey({ ...swapForm, deadline: String(Number(swapForm.deadline) + 60) })).not.toBe(currentKey);
    expect(swapDecisionFormKey({ ...swapForm, useNative: true })).not.toBe(currentKey);
    expect(swapDecisionFormKey({ ...swapForm, recipient: owner })).toBe(currentKey);
  });

  test("keeps a quote intrinsically stale when the panel remounts with changed inputs", () => {
    const staleQuote = {
      ...readyQuote,
      requestIdentity: swapQuoteRequestIdentity({ ...swapForm, amountIn: "2" }),
    };

    const html = renderSwap({ account: owner, form: swapForm, quote: staleQuote });

    expect(html).toContain("Quote stale");
    expect(html).toContain("previous decision metrics are stale");
    expect(html).toContain("quote is stale");
    expect(html).not.toContain("1 PLEDGE = 1.81 USDC");
  });

  test("does not treat unknown allowance or balance as zero", () => {
    const unknown = {
      ...readyQuote,
      tokenIn: { ...readyQuote.tokenIn, allowance: undefined, balance: undefined },
    };
    const state = swapActionState(enabledCapability, unknown, false, true);
    expect(state.approve).toEqual({
      enabled: false,
      reason: "Input-token allowance is unknown. Refresh the quote; unknown allowance is not treated as zero.",
    });
    expect(state.swap.reason).toContain("unknown balance is not treated as zero");
    expect(swapActionState(enabledCapability, readyQuote, true, true).swap.reason).toContain("Native wallet balance is unknown");
    expect(swapActionState(enabledCapability, readyQuote, true, true, "current", undefined, readyQuote.amountIn).swap.enabled).toBe(true);

    const html = renderSwap({ account: owner, quote: unknown });
    expect(html).toContain("unknown allowance is not treated as zero");
    expect(html).toContain("unknown balance is not treated as zero");
    expect(html).toContain('aria-describedby="approve-swap-input-reason"');
    expect(html).toContain('aria-describedby="execute-swap-reason"');
  });

  test("explains disconnected, stale, no-liquidity, read-failure, approval, balance, and deadline blocks", () => {
    expect(swapActionState({ status: "connect" }, undefined, false, true).swap.reason).toContain("Connect a wallet");
    expect(swapActionState(enabledCapability, readyQuote, false, true, "stale").swap.reason).toContain("quote is stale");
    expect(swapActionState(enabledCapability, { requestIdentity: readyQuote.requestIdentity, slippageBps: 50, error: "The AMM pool has no two-sided liquidity." }, false, true).swap.reason).toContain("No liquidity");
    expect(swapActionState(enabledCapability, { requestIdentity: readyQuote.requestIdentity, slippageBps: 50, error: "From token decimals could not be read." }, false, true).swap.reason).toContain("Read failure");
    expect(swapActionState(enabledCapability, { ...readyQuote, tokenIn: { ...readyQuote.tokenIn, allowance: 0n } }, false, true).swap.reason).toContain("Approval needed");
    expect(swapActionState(enabledCapability, { ...readyQuote, tokenIn: { ...readyQuote.tokenIn, balance: 1n } }, false, true).swap.reason).toContain("Insufficient input-token balance");
    expect(swapActionState(enabledCapability, readyQuote, false, false).swap.reason).toContain("quote expiry is invalid");
  });

  test("blocks swap approval and execution on the wrong wallet chain while leaving quotes readable", () => {
    const state = swapActionState(wrongChainCapability, readyQuote, false, true);
    const html = renderSwap({ account: owner, actionCapability: wrongChainCapability, quote: readyQuote });

    expect(state.approve).toEqual({ enabled: false, reason: wrongChainCapability.reason });
    expect(state.swap).toEqual({ enabled: false, reason: wrongChainCapability.reason });
    expect(renderedButton(html, "Approve")).toContain('disabled=""');
    expect(renderedButton(html, "Swap")).toContain('disabled=""');
    expect(renderedButton(html, "Quote")).not.toContain('disabled=""');
    expect(html).toContain("Switch your wallet to chain 31337 to continue.");
    expect(renderedButton(html, "Switch wallet network")).not.toContain('disabled=""');
  });

  test("shows explicit pending labels on approve and swap actions", () => {
    expect(renderSwap({ account: owner, quote: { ...readyQuote, tokenIn: { ...readyQuote.tokenIn, allowance: 0n } }, pendingAction: "approve-swap-input" })).toContain("Approving…");
    expect(renderSwap({ account: owner, quote: readyQuote, pendingAction: "execute-swap" })).toContain("Swapping…");
  });

  test("uses the Radix dialog foundation and accessible token-list mechanics", async () => {
    const source = await Bun.file(new URL("../src/features/swap/swap-panel.tsx", import.meta.url)).text();
    expect(source).toContain("<Dialog open onOpenChange=");
    expect(source).toContain("<DialogContent");
    expect(source).toContain("onOpenAutoFocus");
    expect(source).toContain('id="swap-token-search"');
    expect(source).toContain('aria-label="Available tokens"');
    expect(source).toContain("overflow-y-auto overscroll-contain");
    expect(source).toContain("min-h-11 w-full");
    expect(source).not.toContain('role="dialog"');
    expect(source).not.toContain('window.addEventListener("keydown"');
  });
});

describe("liquidity action safety and form semantics", () => {
  test("checks the full desired deposit before the vault refunds unused currency", () => {
    const amountADesired = readyLiquidityQuote.amountA! + 1n;
    const state = liquidityActionState(enabledCapability, {
      ...readyLiquidityQuote,
      amountADesired,
      tokenA: { ...readyLiquidityQuote.tokenA!, allowance: amountADesired - 1n, balance: amountADesired - 1n },
    }, false, false, true);

    expect(state.needsTokenAApproval).toBe(true);
    expect(state.canApproveTokenA).toBe(true);
    expect(state.addLiquidity.enabled).toBe(false);
    expect(state.addLiquidity.reason).toContain("Insufficient token A balance");
    expect(state.addLiquidity.reason).toContain("Approval needed for token A");
  });

  test("blocks insufficient and unknown ERC-20 balances on token A and token B", () => {
    const insufficientA = liquidityActionState(enabledCapability, {
      ...readyLiquidityQuote,
      tokenA: { ...readyLiquidityQuote.tokenA!, balance: readyLiquidityQuote.amountA! - 1n },
    }, false, false, true);
    const unknownA = liquidityActionState(enabledCapability, {
      ...readyLiquidityQuote,
      tokenA: { ...readyLiquidityQuote.tokenA!, balance: undefined },
    }, false, false, true);
    const insufficientB = liquidityActionState(enabledCapability, {
      ...readyLiquidityQuote,
      tokenB: { ...readyLiquidityQuote.tokenB!, balance: readyLiquidityQuote.amountB! - 1n },
    }, false, false, true);
    const unknownB = liquidityActionState(enabledCapability, {
      ...readyLiquidityQuote,
      tokenB: { ...readyLiquidityQuote.tokenB!, balance: undefined },
    }, false, false, true);

    expect(insufficientA.addLiquidity.enabled).toBe(false);
    expect(insufficientA.addLiquidity.reason).toContain("Insufficient token A balance");
    expect(unknownA.addLiquidity.enabled).toBe(false);
    expect(unknownA.addLiquidity.reason).toContain("Token A balance is unknown");
    expect(insufficientB.addLiquidity.enabled).toBe(false);
    expect(insufficientB.addLiquidity.reason).toContain("Insufficient token B balance");
    expect(unknownB.addLiquidity.enabled).toBe(false);
    expect(unknownB.addLiquidity.reason).toContain("Token B balance is unknown");
  });

  test("uses the real native wallet balance for native token A and token B", () => {
    const nativeAQuote: LiquidityQuoteState = {
      ...readyLiquidityQuote,
      tokenA: { ...readyLiquidityQuote.tokenA!, address: wrappedNative, balance: 99_000_000_000_000_000_000n, allowance: undefined },
    };
    const nativeBQuote: LiquidityQuoteState = {
      ...readyLiquidityQuote,
      tokenB: { ...readyLiquidityQuote.tokenB!, address: wrappedNative, balance: 99_000_000n, allowance: undefined },
    };

    const insufficientA = liquidityActionState(enabledCapability, nativeAQuote, true, false, true, readyLiquidityQuote.amountA! - 1n);
    const unknownA = liquidityActionState(enabledCapability, nativeAQuote, true, false, true, undefined);
    const insufficientB = liquidityActionState(enabledCapability, nativeBQuote, false, true, true, readyLiquidityQuote.amountB! - 1n);
    const unknownB = liquidityActionState(enabledCapability, nativeBQuote, false, true, true, undefined);

    expect(insufficientA.addLiquidity.enabled).toBe(false);
    expect(insufficientA.addLiquidity.reason).toContain("Insufficient native wallet balance for token A");
    expect(unknownA.addLiquidity.enabled).toBe(false);
    expect(unknownA.addLiquidity.reason).toContain("Native wallet balance for token A is unknown");
    expect(insufficientB.addLiquidity.enabled).toBe(false);
    expect(insufficientB.addLiquidity.reason).toContain("Insufficient native wallet balance for token B");
    expect(unknownB.addLiquidity.enabled).toBe(false);
    expect(unknownB.addLiquidity.reason).toContain("Native wallet balance for token B is unknown");
  });

  test("distinguishes known zero from unknown balance and keeps approvals independent", () => {
    const tokenZero = liquidityActionState(enabledCapability, {
      ...readyLiquidityQuote,
      tokenA: { ...readyLiquidityQuote.tokenA!, balance: 0n, allowance: 0n },
    }, false, false, true);
    const nativeZero = liquidityActionState(enabledCapability, {
      ...readyLiquidityQuote,
      tokenA: { ...readyLiquidityQuote.tokenA!, address: wrappedNative, balance: undefined, allowance: undefined },
    }, true, false, true, 0n);

    expect(tokenZero.addLiquidity.enabled).toBe(false);
    expect(tokenZero.addLiquidity.reason).toContain("Insufficient token A balance");
    expect(tokenZero.addLiquidity.reason).toContain("verified balance is 0 PLEDGE");
    expect(tokenZero.addLiquidity.reason).not.toContain("Token A balance is unknown");
    expect(tokenZero.canApproveTokenA).toBe(true);
    expect(nativeZero.addLiquidity.enabled).toBe(false);
    expect(nativeZero.addLiquidity.reason).toContain("Insufficient native wallet balance for token A");
    expect(nativeZero.addLiquidity.reason).toContain("verified native balance is 0 Native");
    expect(nativeZero.addLiquidity.reason).not.toContain("Native wallet balance for token A is unknown");
    expect(nativeZero.canApproveTokenA).toBe(false);
  });

  test("enables add liquidity only when exact token or native balances and allowances are sufficient", () => {
    const erc20 = liquidityActionState(enabledCapability, readyLiquidityQuote, false, false, true);
    const nativeA = liquidityActionState(enabledCapability, {
      ...readyLiquidityQuote,
      tokenA: { ...readyLiquidityQuote.tokenA!, address: wrappedNative, allowance: undefined },
    }, true, false, true, readyLiquidityQuote.amountA);
    const nativeB = liquidityActionState(enabledCapability, {
      ...readyLiquidityQuote,
      tokenB: { ...readyLiquidityQuote.tokenB!, address: wrappedNative, allowance: undefined },
    }, false, true, true, readyLiquidityQuote.amountB);

    expect(erc20.addLiquidity).toEqual({ enabled: true, reason: undefined });
    expect(nativeA.addLiquidity).toEqual({ enabled: true, reason: undefined });
    expect(nativeB.addLiquidity).toEqual({ enabled: true, reason: undefined });
  });

  test("renders adjacent balance reasons on the disabled add-liquidity action", () => {
    const html = renderLiquidity({
      liquidityQuote: {
        ...readyLiquidityQuote,
        tokenA: { ...readyLiquidityQuote.tokenA!, balance: undefined },
      },
    });
    const addButton = (html.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? []).find((button) => button.includes("Add Liquidity"));

    expect(addButton).toContain('disabled=""');
    expect(addButton).toContain('aria-describedby="add-liquidity-reason"');
    expect(html).toContain('id="add-liquidity-reason"');
    expect(html).toContain("Token A balance is unknown");
  });

  test("blocks approve, add, remove, and claim writes on the wrong wallet chain while keeping reads available", () => {
    const approvalQuote: LiquidityQuoteState = {
      ...readyLiquidityQuote,
      tokenA: { ...readyLiquidityQuote.tokenA!, allowance: 0n },
      tokenB: { ...readyLiquidityQuote.tokenB!, allowance: 0n },
    };
    const approvalPosition: AmmPositionState = {
      ...readyPosition,
      lpAllowance: 0n,
      lpToken: { ...readyPosition.lpToken, allowance: 0n },
    };
    const approvalRemoveQuote: RemoveLiquidityQuoteState = {
      ...readyRemoveLiquidityQuote,
      position: approvalPosition,
    };
    const liquidityState = liquidityActionState(wrongChainCapability, approvalQuote, false, false, true);
    const positionState = positionActionState(wrongChainCapability, approvalPosition, approvalRemoveQuote, true);
    const html = renderLiquidity({
      actionCapability: wrongChainCapability,
      liquidityQuote: approvalQuote,
      position: approvalPosition,
      removeLiquidityQuote: approvalRemoveQuote,
    });

    expect(liquidityState.canApproveTokenA).toBe(false);
    expect(liquidityState.canApproveTokenB).toBe(false);
    expect(liquidityState.addLiquidity).toEqual({ enabled: false, reason: wrongChainCapability.reason });
    expect(positionState.canRemoveLiquidity).toBe(false);
    for (const label of ["Approve A", "Approve B", "Add Liquidity", "Redeem P4LP"]) {
      expect(renderedButton(html, label)).toContain('disabled=""');
    }
    for (const label of ["Quote", "Refresh", "Quote Redemption", "Switch wallet network"]) {
      expect(renderedButton(html, label)).not.toContain('disabled=""');
    }
    expect(html).toContain("Switch your wallet to chain 31337 to continue.");
  });

  test("redeems P4LP claims without an allowance step", () => {
    const covered = positionActionState(enabledCapability, readyPosition, readyRemoveLiquidityQuote, true);
    const shortPosition: AmmPositionState = {
      ...readyPosition,
      lpAllowance: readyRemoveLiquidityQuote.liquidity - 1n,
      lpToken: { ...readyPosition.lpToken, allowance: readyRemoveLiquidityQuote.liquidity - 1n },
    };
    const short = positionActionState(enabledCapability, shortPosition, {
      ...readyRemoveLiquidityQuote,
      position: shortPosition,
    }, true);
    const html = renderLiquidity();

    expect(covered.canRemoveLiquidity).toBe(true);
    expect(short.canRemoveLiquidity).toBe(true);
    expect(html).not.toContain("Approve LP");
    expect(renderedButton(html, "Redeem P4LP")).not.toContain('disabled=""');
  });

  test("routes Enter to only the ready add or remove primary submit and guards unready submission", async () => {
    const readyHtml = renderLiquidity();
    const forms = readyHtml.match(/<form[\s\S]*?<\/form>/g) ?? [];
    const addForm = forms.find((form) => form.includes('aria-label="Add liquidity"'));
    const removeForm = forms.find((form) => form.includes('aria-label="Remove liquidity"'));
    const blockedHtml = renderLiquidity({
      liquidityQuote: {
        ...readyLiquidityQuote,
        tokenA: { ...readyLiquidityQuote.tokenA!, balance: undefined },
      },
      removeLiquidityQuote: { slippageBps: 100 },
    });
    const blockedForms = blockedHtml.match(/<form[\s\S]*?<\/form>/g) ?? [];
    const blockedAddForm = blockedForms.find((form) => form.includes('aria-label="Add liquidity"'));
    const blockedRemoveForm = blockedForms.find((form) => form.includes('aria-label="Remove liquidity"'));
    const source = await Bun.file(new URL("../src/features/swap/swap-panel.tsx", import.meta.url)).text();

    expect(forms).toHaveLength(2);
    expect(addForm?.match(/type="submit"/g)).toHaveLength(1);
    expect(addForm).toContain("Add Liquidity");
    expect(addForm).not.toContain("Redeem P4LP");
    expect(removeForm?.match(/type="submit"/g)).toHaveLength(1);
    expect(removeForm).toContain("Redeem P4LP");
    expect(removeForm).not.toContain("Add Liquidity");
    expect(blockedAddForm).toMatch(/disabled=""[^>]*type="submit"|type="submit"[^>]*disabled=""/);
    expect(blockedRemoveForm).toMatch(/disabled=""[^>]*type="submit"|type="submit"[^>]*disabled=""/);
    expect(source).toContain('if (liquidityActions.addLiquidity.enabled) void runAction("add-liquidity", addLiquidity);');
    expect(source).toContain('if (positionActions.canRemoveLiquidity) void runAction("remove-liquidity", removeLiquidity);');
  });

  test("keeps every liquidity secondary control out of implicit form submission", () => {
    const html = renderLiquidity();
    const forms = html.match(/<form[\s\S]*?<\/form>/g) ?? [];
    const addForm = forms.find((form) => form.includes('aria-label="Add liquidity"')) ?? "";
    const removeForm = forms.find((form) => form.includes('aria-label="Remove liquidity"')) ?? "";
    const addButtons = addForm.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? [];
    const removeButtons = removeForm.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? [];
    const headerButtons = html.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? [];

    for (const button of addButtons) {
      expect(button).toContain(button.includes("Add Liquidity") ? 'type="submit"' : 'type="button"');
    }
    for (const button of removeButtons) {
      expect(button).toContain(button.includes("Redeem P4LP") ? 'type="submit"' : 'type="button"');
    }
    for (const label of ["Quote", "Refresh", "Approve A", "Approve B", "Quote Redemption"]) {
      expect(headerButtons.find((button) => button.includes(label))).toContain('type="button"');
    }
  });
});
