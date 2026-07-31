import { describe, expect, test } from "bun:test";
import type { Address, Hex, PledgeCashReadClient } from "@pledge.cash/sdk";
import {
  distributionCirculatingShares,
  readFactoryBoardroomPage,
  readProductBoardroomCatalogEntry,
  readProductBoardroomCatalogPage,
  readProductBoardroomDashboard,
  readProductBoardroomHistories,
  resolveProductBoardroomAddress,
} from "../src/lib/product-boardroom";
import type { BoardroomDistributionSnapshot, BoardroomSnapshot } from "../src/lib/types";
import {
  PRODUCT_CATALOG_CHILD_READ_LIMIT,
  PRODUCT_DETAIL_CHILD_READ_LIMIT,
  readBoardroomCatalogSnapshot,
  readBoardroomSnapshot,
} from "../src/lib/boardroom-snapshot";

describe("product boardroom runtime discovery", () => {
  test("uses claimed airdrop shares after unclaimed inventory is returned", () => {
    const distribution = {
      address: "0x6000000000000000000000000000000000000000",
      kind: "merkle-airdrop",
      state: {
        airdropSupply: 1_000n,
        claimedShares: 125n,
        remainingShares: 0n,
      },
    } as BoardroomDistributionSnapshot;

    expect(distributionCirculatingShares(distribution)).toBe(125n);
  });

  test("uses recorded Dutch-auction sales after unsold inventory is returned", () => {
    const distribution = {
      address: "0x6100000000000000000000000000000000000000",
      kind: "dutch-auction",
      state: {
        saleSupply: 1_000n,
        remainingShares: 0n,
        soldShares: 125n,
        startPrice: 5n,
      },
    } as BoardroomDistributionSnapshot;

    expect(distributionCirculatingShares(distribution)).toBe(125n);
  });

  test("pages through factory Boardrooms newest first with an explicit cursor", async () => {
    const factory = "0x0100000000000000000000000000000000000000" as Address;
    const addresses = Array.from({ length: 65 }, (_, index) =>
      `0x${(index + 1).toString(16).padStart(40, "0")}` as Address);
    const client = {
      async getBalance() { return 0n; },
      async readContract(parameters: { functionName: string; args?: readonly [bigint] }) {
        if (parameters.functionName === "allBoardroomsLength") return BigInt(addresses.length);
        return addresses[Number(parameters.args?.[0] ?? 0n)];
      },
    };

    const first = await readFactoryBoardroomPage(client as never, factory, { limit: 64 });
    const second = await readFactoryBoardroomPage(client as never, factory, { cursor: first.nextCursor, limit: 64 });

    expect(first).toMatchObject({ totalCount: 65, nextCursor: 49 });
    expect(first.addresses).toHaveLength(16);
    expect(first.addresses[0]).toBe(addresses[64]);
    expect(first.addresses[15]).toBe(addresses[49]);
    expect(second.addresses).toHaveLength(16);
    expect(second.addresses[0]).toBe(addresses[48]);
    expect(second.nextCursor).toBe(33);
  });

  test("keeps cursor pagination on the factory high-water snapshot when new Boardrooms append", async () => {
    const factory = "0x0100000000000000000000000000000000000000" as Address;
    const addresses = Array.from({ length: 7 }, (_, index) =>
      `0x${(index + 1).toString(16).padStart(40, "0")}` as Address);
    let count = 5;
    const client = {
      async readContract(parameters: { functionName: string; args?: readonly [bigint] }) {
        if (parameters.functionName === "allBoardroomsLength") return BigInt(count);
        return addresses[Number(parameters.args?.[0] ?? 0n)];
      },
    };

    const first = await readFactoryBoardroomPage(client as never, factory, { limit: 2 });
    count = 7;
    const second = await readFactoryBoardroomPage(client as never, factory, {
      cursor: first.nextCursor,
      limit: 2,
      snapshotCount: first.snapshotCount,
    });

    expect(first).toMatchObject({ addresses: [addresses[4], addresses[3]], nextCursor: 3, snapshotCount: 5, totalCount: 5 });
    expect(second).toMatchObject({ addresses: [addresses[2], addresses[1]], nextCursor: 1, snapshotCount: 5, totalCount: 5 });
  });

  test("bounds one factory page even with 10,000 entries", async () => {
    const factory = "0x0100000000000000000000000000000000000000" as Address;
    let readCount = 0;
    const client = {
      async readContract(parameters: { functionName: string; args?: readonly [bigint] }) {
        readCount += 1;
        if (parameters.functionName === "allBoardroomsLength") return 10_000n;
        const index = parameters.args?.[0] ?? 0n;
        return `0x${(index + 1n).toString(16).padStart(40, "0")}` as Address;
      },
    };

    const discovered = (await readFactoryBoardroomPage(client as never, factory)).addresses;

    expect(discovered).toHaveLength(4);
    expect(discovered[0]).toBe("0x0000000000000000000000000000000000002710");
    expect(readCount).toBe(5);
  });

  test("bounds per-project catalog reads with canonical factory pagination", async () => {
    const boardroom = "0x1000000000000000000000000000000000000000" as Address;
    const shareToken = "0x2000000000000000000000000000000000000000" as Address;
    const paymentToken = "0x3000000000000000000000000000000000000000" as Address;
    const distributionFactory = "0x4000000000000000000000000000000000000000" as Address;
    const distributionCount = 50;
    const pageRequests: Array<{ cursor: bigint; size: bigint }> = [];
    const client = {
      async readContract(parameters: { address: Address; functionName: string; args?: readonly bigint[] }) {
        const { functionName } = parameters;
        if (parameters.address === boardroom && functionName === "shareToken") return shareToken;
        if (parameters.address === distributionFactory && functionName === "distributionCountForBoardroom") return BigInt(distributionCount);
        if (parameters.address === distributionFactory && functionName === "distributionPageForBoardroom") {
          const cursor = parameters.args?.[1] ?? 0n;
          const size = parameters.args?.[2] ?? 0n;
          pageRequests.push({ cursor, size });
          return [Array.from({ length: Number(size) }, (_, index) =>
            `0x${(Number(cursor) + index + 1).toString(16).padStart(40, "0")}` as Address), cursor + size] as const;
        }
        if (functionName === "factory") return distributionFactory;
        if (functionName === "boardroom") return boardroom;
        if (functionName === "shareToken") return shareToken;
        if (functionName === "paymentToken") return paymentToken;
        if (["saleSupply", "remainingShares", "price", "maxPerBuyer", "startTime", "endTime"].includes(functionName)) return 0n;
        if (functionName === "saleStatus") return 0;
        if (functionName === "isClosed") return false;
        if (functionName === "symbol") return parameters.address === shareToken ? "SHARE" : "CASH";
        if (functionName === "decimals") return 18;
        throw new Error(`Unexpected read: ${functionName}`);
      },
    };

    const snapshot = await readBoardroomCatalogSnapshot(client as never, boardroom, {
      chainId: 31337,
      distributionFactory,
    });

    expect(snapshot.distributionCount).toBe(distributionCount);
    expect(snapshot.distributionSummaries).toHaveLength(PRODUCT_CATALOG_CHILD_READ_LIMIT);
    expect(pageRequests).toEqual([{ cursor: 38n, size: BigInt(PRODUCT_CATALOG_CHILD_READ_LIMIT) }]);
  });

  test("bounds full project factory hydration and reports omitted provenance records", async () => {
    const context = productBoardroomFixture();
    const recordedDistributions = Array.from({ length: 100 }, (_, index) =>
      `0x${(2_000 + index).toString(16).padStart(40, "0")}` as Address);
    const distributionFactoryReads: Address[] = [];
    const client = fakeProductBoardroomClient({
      ...context,
      distributionFactoryReads,
      recordedDistributions,
      tokenReads: new Set<string>(),
    });
    const snapshot = await readBoardroomSnapshot(client, context.boardroom, fixtureDeployment(context));

    expect(snapshot.grantSummaries).toHaveLength(0);
    expect(snapshot.distributionSummaries).toHaveLength(PRODUCT_DETAIL_CHILD_READ_LIMIT);
    expect(snapshot.lockedLiquiditySummaries).toHaveLength(0);
    expect(snapshot.summaryWarnings?.join(" ")).toContain("newest 64 of 100 distribution records");
    expect(new Set(distributionFactoryReads.map((address) => address.toLowerCase())).size).toBe(64);
  });

  test("loads dashboard treasury assets from Boardroom state without seed artifacts", async () => {
    const context = productBoardroomFixture();
    const tokenReads = new Set<string>();
    const client = fakeProductBoardroomClient({ ...context, tokenReads });
    const seedOnlyEquity = "0x6000000000000000000000000000000000000000" as Address;

    const dashboard = await readProductBoardroomDashboard(client, { address: context.boardroom, deployment: fixtureDeployment(context) });

    expect(dashboard.catalog).toHaveLength(1);
    expect(dashboard.catalog[0]).toMatchObject({
      address: context.boardroom,
      distribution: context.sale,
      name: "Atlas Payroll Common",
      symbol: "ATLS",
    });
    expect(dashboard.treasuryAssets.map((asset) => asset.label)).toEqual([
      "Treasury shares",
      "Wrapped native",
      "Cash / quote",
      "Redeemable asset",
    ]);
    expect(dashboard.treasuryAssets.some((asset) => asset.address === seedOnlyEquity)).toBe(false);
    expect(tokenReads.has(seedOnlyEquity.toLowerCase())).toBe(false);
  });

  test("counts only successfully hydrated current child records as covered", async () => {
    const context = productBoardroomFixture();
    const base = fakeProductBoardroomClient({ ...context, tokenReads: new Set<string>() });
    const client = {
      ...base,
      async readContract(parameters: Parameters<typeof base.readContract>[0]) {
        if (
          parameters.address.toLowerCase() === context.sale.toLowerCase()
          && parameters.functionName === "factory"
        ) {
          throw new Error("distribution child unavailable");
        }
        return await base.readContract(parameters);
      },
    };

    const dashboard = await readProductBoardroomDashboard(client, { address: context.boardroom, deployment: fixtureDeployment(context) });

    expect(dashboard.snapshot.distributionSummaries[0]?.error).toContain("distribution child unavailable");
    expect(dashboard.currentStateCoverage.distributions).toEqual({ complete: false, shown: 0, total: 1 });
    expect(dashboard.currentStateCoverage.grants).toEqual({ complete: false, shown: 0, total: 1 });
  });

  test("synthesizes exact catalog identity for a deep-linked project outside the newest page", async () => {
    const context = productBoardroomFixture();
    const newest = {
      address: "0xf000000000000000000000000000000000000000" as Address,
      distribution: "0xf100000000000000000000000000000000000000" as Address,
      name: "Newer project",
    };
    const client = fakeProductBoardroomClient({ ...context, tokenReads: new Set<string>() });

    const dashboard = await readProductBoardroomDashboard(client, {
      address: context.boardroom,
      catalog: [newest],
      deployment: fixtureDeployment(context),
    });
    const exactEntry = dashboard.catalog.find((entry) => entry.address === context.boardroom);

    expect(dashboard.catalog).toHaveLength(2);
    expect(exactEntry).toMatchObject({
      address: context.boardroom,
      distribution: context.sale,
      name: "Atlas Payroll Common",
      symbol: "ATLS",
    });
    expect(dashboard.history?.distribution).toBe(context.sale);
  });

  test("discovers Boardroom catalog entries from the factory and purchase logs", async () => {
    const context = productBoardroomFixture();
    const share = 10n ** 18n;
    const cash = 10n ** 6n;
    const client = fakeProductBoardroomClient({ ...context, tokenReads: new Set<string>() });

    const page = await readProductBoardroomCatalogPage(client, fixtureDeployment(context));
    const catalog = page.entries;

    expect(page).toMatchObject({ totalCount: 1 });
    expect(page.nextCursor).toBeUndefined();
    expect(resolveProductBoardroomAddress(catalog)).toBe(context.boardroom);
    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({
      address: context.boardroom,
      buyerCount: 2,
      cashRaised: 1_950n * cash,
      cashToken: context.cashToken,
      cashTokenDecimals: 6,
      cashTokenSymbol: "CASH",
      distribution: context.sale,
      distributionKind: "fixed-price-sale",
      name: "Atlas Payroll Common",
      path: "Fixed price sale",
      shareToken: context.shareToken,
      shareTokenDecimals: 18,
      soldShares: 650n * share,
      status: "Active sale",
      symbol: "ATLS",
      treasuryCash: 2_100n * cash,
    });
  });

  test("derives catalog Uniswap v4 metrics from direct protocol liquidity without a distribution", async () => {
    const boardroom = "0x1200000000000000000000000000000000000000" as Address;
    const shareToken = "0x2200000000000000000000000000000000000000" as Address;
    const quoteToken = "0x3200000000000000000000000000000000000000" as Address;
    const locker = "0x4200000000000000000000000000000000000000" as Address;
    const factory = "0x6200000000000000000000000000000000000000" as Address;
    const stateView = "0x7200000000000000000000000000000000000000" as Address;
    const poolManager = "0x7300000000000000000000000000000000000000" as Address;
    const hook = "0x7400000000000000000000000000000000000000" as Address;
    const poolId = `0x${"12".repeat(32)}` as Hex;
    const client = {
      async getBlockNumber() { return 100n; },
      async getLogs() { return []; },
      async readContract(parameters: { address: Address; functionName: string }) {
        const { address, functionName } = parameters;
        if (address === factory && functionName === "positionOfBoardroom") {
          return [locker, poolId, quoteToken, 1] as const;
        }
        if (address === boardroom) {
          if (functionName === "shareToken") return shareToken;
          if (functionName === "status") return 0;
        }
        if (address === locker) {
          if (functionName === "factory") return factory;
          if (functionName === "boardroom") return boardroom;
          if (functionName === "poolManager") return poolManager;
          if (functionName === "protocolFeeRecipient") return factory;
          if (functionName === "tokenA") return shareToken;
          if (functionName === "tokenB") return quoteToken;
          if (functionName === "currency0") return shareToken;
          if (functionName === "currency1") return quoteToken;
          if (functionName === "hook") return hook;
          if (functionName === "poolId") return poolId;
          if (functionName === "positionSalt") return `0x${"13".repeat(32)}`;
          if (functionName === "tickLower") return -887_220;
          if (functionName === "tickUpper") return 887_220;
          if (functionName === "poolFee") return 3_000;
          if (functionName === "tickSpacing") return 60;
          if (functionName === "liquidityState") return 1;
          if (functionName === "positionLiquidity") return 7n;
          if (functionName === "totalSupply") return 7n;
        }
        if (address === stateView) {
          if (functionName === "getSlot0") return [1n << 96n, 0, 0, 3_000] as const;
          if (functionName === "getLiquidity") return 11n;
        }
        if (functionName === "name") return "Direct liquidity project";
        if (functionName === "symbol") return address === shareToken ? "SHARE" : address === quoteToken ? "QUOTE" : "LP";
        if (functionName === "decimals") return address === quoteToken ? 6 : 18;
        if (functionName === "totalSupply") return 1_000_000n * 10n ** 18n;
        if (functionName === "balanceOf") return 0n;
        throw new Error(`Unexpected read: ${functionName} on ${address}`);
      },
    };

    const entry = await readProductBoardroomCatalogEntry(client as never, boardroom, {}, {
      chainId: 31337,
      pledgeV4LiquidityFactory: factory,
      uniswapV4StateView: stateView,
    });

    expect(entry).toMatchObject({
      address: boardroom,
      locker,
      pool: locker,
      poolLiquidity: 11n,
      poolPositionLiquidity: 7n,
      poolSqrtPriceX96: 1n << 96n,
      poolToken0: shareToken,
      poolToken1: quoteToken,
    });
  });

  test("prefers exact current pool identity when migration history names a different pool", async () => {
    const boardroom = "0x1100000000000000000000000000000000000000" as Address;
    const shareToken = "0x2200000000000000000000000000000000000000" as Address;
    const quoteToken = "0x3300000000000000000000000000000000000000" as Address;
    const curve = "0x4400000000000000000000000000000000000000" as Address;
    const pool = "0x5500000000000000000000000000000000000000" as Address;
    const historicalPool = "0x5600000000000000000000000000000000000000" as Address;
    const distributionFactory = "0x7700000000000000000000000000000000000000" as Address;
    const liquidityFactory = "0x8800000000000000000000000000000000000000" as Address;
    const stateView = "0x8900000000000000000000000000000000000000" as Address;
    const poolManager = "0x8a00000000000000000000000000000000000000" as Address;
    const hook = "0x8b00000000000000000000000000000000000000" as Address;
    const currentPoolId = `0x${"21".repeat(32)}` as Hex;
    const historicalPoolId = `0x${"22".repeat(32)}` as Hex;
    const client = {
      async getBlockNumber() { return 100n; },
      async getLogs(parameters: { address: Address; event?: { name?: string } }) {
        switch (parameters.event?.name) {
          case "BoardroomDistributionRecorded":
            return [{ args: { distribution: curve }, blockNumber: 1n }];
          case "CurveMigrated":
            return [{
              args: {
                liquidity: 777n,
                poolId: historicalPoolId,
                quoteToBoardroom: 888n,
                quoteToLiquidity: 999n,
                sharesToLiquidity: 1_111n,
                terminalPrice: 1_000_000n,
                vault: historicalPool,
              },
              blockNumber: 2n,
            }];
          default:
            return [];
        }
      },
      async readContract(parameters: { address: Address; functionName: string; args?: readonly unknown[] }) {
        const { address, functionName } = parameters;
        if (address === distributionFactory) {
          if (functionName === "distributionCountForBoardroom") return 1n;
          if (functionName === "distributionPageForBoardroom") return [[curve], 1n] as const;
        }
        if (address === boardroom) {
          if (functionName === "shareToken") return shareToken;
          if (functionName === "status") return 0;
        }
        if (address === curve) {
          if (functionName === "factory") return distributionFactory;
          if (functionName === "boardroom") return boardroom;
          if (functionName === "shareToken") return shareToken;
          if (functionName === "paymentToken") throw new Error("not a fixed-price sale");
          if (functionName === "liquidityFactory") return liquidityFactory;
          if (functionName === "quoteToken") return quoteToken;
          if (functionName === "liquidityVault") return pool;
          if (functionName === "liquidityPoolId") return currentPoolId;
          if (functionName === "saleSupply") return 10_000n;
          if (functionName === "migrationSupply") return 2_000n;
          if (functionName === "remainingSaleShares") return 0n;
          if (functionName === "outstandingCurveShareLiability") return 0n;
          if (functionName === "basePrice") return 1_000_000n;
          if (functionName === "slope") return 0n;
          if (functionName === "graduationQuoteTarget") return 5_000_000n;
          if (functionName === "quoteToLpBps") return 8_000;
          if (functionName === "startTime" || functionName === "endTime") return 0n;
          if (
            functionName === "phaseEndsAt" || functionName === "quarantineStartedAt"
              || functionName === "forfeitureEligibleAt" || functionName === "forfeitureWindowEndsAt"
          ) return 0n;
          if (functionName === "migrationSalt") return `0x${"00".repeat(32)}`;
          if (functionName === "curveStatus") return 3;
          if (functionName === "settlementReason" || functionName === "postQuarantinePhase") return 0;
          if (functionName === "soldShares") return 10_000n;
          if (functionName === "quoteReserve") return 0n;
          if (functionName === "migrationAmounts") return [1_111n, 999n] as const;
          if (functionName === "terminalCurvePrice") return 1_000_000n;
          if (functionName === "graduationLatched") return true;
          if (functionName === "migrationReservationHeld" || functionName === "quoteQuarantined"
            || functionName === "forfeitureFinalized") return false;
          if (functionName === "unrecoveredQuote" || functionName === "forfeitedQuote") return 0n;
          if (functionName === "canMigrate") return false;
          if (functionName === "isClosed") return true;
        }
        if (address === pool) {
          if (functionName === "factory") return liquidityFactory;
          if (functionName === "boardroom") return boardroom;
          if (functionName === "poolManager") return poolManager;
          if (functionName === "protocolFeeRecipient") return liquidityFactory;
          if (functionName === "tokenA") return shareToken;
          if (functionName === "tokenB") return quoteToken;
          if (functionName === "currency0") return shareToken;
          if (functionName === "currency1") return quoteToken;
          if (functionName === "hook") return hook;
          if (functionName === "poolId") return currentPoolId;
          if (functionName === "positionSalt") return `0x${"23".repeat(32)}`;
          if (functionName === "tickLower") return -887_220;
          if (functionName === "tickUpper") return 887_220;
          if (functionName === "poolFee") return 3_000;
          if (functionName === "tickSpacing") return 60;
          if (functionName === "liquidityState") return 1;
          if (functionName === "positionLiquidity") return 777n;
          if (functionName === "totalSupply") return 777n;
        }
        if (address === stateView) {
          if (functionName === "getSlot0") return [1n << 96n, 0, 0, 3_000] as const;
          if (functionName === "getLiquidity") return 1_111n;
        }
        if (functionName === "symbol") return address === shareToken ? "SHARE" : "QUOTE";
        if (functionName === "decimals") return address === quoteToken ? 6 : 18;
        if (functionName === "name") return "Current reserve project";
        if (functionName === "totalSupply") return 1_000_000n * 10n ** 18n;
        if (functionName === "balanceOf") return 0n;
        throw new Error(`Unexpected read: ${functionName} on ${address}`);
      },
    };

    const entry = await readProductBoardroomCatalogEntry(client as never, boardroom, {}, {
      chainId: 31337,
      distributionFactory,
      uniswapV4StateView: stateView,
    });

    expect(entry).toMatchObject({
      pool,
      poolToken0: shareToken,
      poolToken1: quoteToken,
      poolLiquidity: 1_111n,
      poolPositionLiquidity: 777n,
      poolSqrtPriceX96: 1n << 96n,
      quoteToLiquidity: 999n,
      shareTokenTotalSupply: 1_000_000n * 10n ** 18n,
    });
    expect(entry.poolPositionLiquidity).not.toBe(entry.quoteToLiquidity);
    expect(entry.historyError).toContain("Current vault identity takes precedence");
    expect(entry.historyError).toContain(historicalPool);
    expect(entry.historyError).toContain(pool);
  });

  test("adapts event scans to RPC range limits without dropping history", async () => {
    const context = productBoardroomFixture();
    const successfulRanges: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
    const client = fakeProductBoardroomClient({
      ...context,
      latestBlock: 250_000n,
      maxLogRange: 50_000n,
      successfulRanges,
      tokenReads: new Set<string>(),
    });

    const catalog = await readFirstCatalogPageEntries(client, fixtureDeployment(context));

    expect(catalog[0]?.buyerCount).toBe(2);
    expect(successfulRanges.length).toBeGreaterThan(2);
    expect(successfulRanges.every(({ fromBlock, toBlock }) => toBlock - fromBlock + 1n <= 50_000n)).toBe(true);
  });

  test("supports providers that cap eth_getLogs at exactly 100 blocks", async () => {
    const context = productBoardroomFixture();
    const successfulRanges: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
    const client = fakeProductBoardroomClient({
      ...context,
      latestBlock: 399n,
      maxLogRange: 100n,
      successfulRanges,
      tokenReads: new Set<string>(),
    });

    const catalog = await readFirstCatalogPageEntries(client, fixtureDeployment(context));

    expect(catalog[0]?.buyerCount).toBe(2);
    expect(successfulRanges.length).toBeGreaterThan(2);
    expect(successfulRanges.every(({ fromBlock, toBlock }) => toBlock - fromBlock + 1n <= 100n)).toBe(true);
  });

  test("enforces one aggregate request budget across an adaptive history scan", async () => {
    let requests = 0;
    const client = {
      async getBlockNumber() { return 99_999n; },
      async getLogs(input: { fromBlock: bigint; toBlock: bigint }) {
        requests += 1;
        if (input.toBlock > input.fromBlock) throw new Error("RPC block range limit exceeded");
        return [];
      },
    };

    const histories = await readProductBoardroomHistories(client as never, {
      distributionSummaries: [fixedPriceHistoryFixture()],
    } as BoardroomSnapshot);

    expect(histories[0]?.completeness).toBe("partial");
    expect(histories[0]?.scanError).toContain("aggregate 512-request safety bound");
    expect(requests).toBe(512);
  });

  test("does not recursively amplify generic event provider failures", async () => {
    let calls = 0;
    const distribution = {
      address: "0x5000000000000000000000000000000000000000",
      kind: "fixed-price-sale",
      state: {
        paymentToken: "0x4000000000000000000000000000000000000000",
      },
    } as BoardroomDistributionSnapshot;
    const client = {
      async getBlockNumber() { return 249_999n; },
      async getLogs() {
        calls += 1;
        throw new Error("provider unavailable");
      },
    };

    const histories = await readProductBoardroomHistories(client as never, {
      distributionSummaries: [distribution],
    } as BoardroomSnapshot);

    expect(calls).toBe(2);
    expect(histories[0]?.scanError).toContain("provider unavailable");
  });

  test("does not split block ranges when the provider is rate limiting", async () => {
    let calls = 0;
    const client = {
      async getBlockNumber() { return 99_999n; },
      async getLogs() {
        calls += 1;
        throw new Error("rate limit exceeded while querying this block range");
      },
    };

    const histories = await readProductBoardroomHistories(client as never, {
      distributionSummaries: [fixedPriceHistoryFixture()],
    } as BoardroomSnapshot);

    expect(calls).toBe(1);
    expect(histories[0]?.scanError).toContain("rate limit exceeded");
  });

  test("increments cached event history with only a small reorg overlap", async () => {
    const attemptedRanges: Array<{ event: string | undefined; fromBlock: bigint; toBlock: bigint }> = [];
    const runtime = {
      ...productBoardroomFixture(),
      attemptedRanges,
      latestBlock: 100n,
      tokenReads: new Set<string>(),
    };
    const client = fakeProductBoardroomClient(runtime);
    const deployment = fixtureDeployment(runtime);

    await readFirstCatalogPageEntries(client, deployment);
    attemptedRanges.length = 0;
    runtime.latestBlock = 105n;
    const catalog = await readFirstCatalogPageEntries(client, deployment);

    expect(attemptedRanges.length).toBeGreaterThan(0);
    expect(attemptedRanges.every(({ fromBlock, toBlock }) => fromBlock === 89n && toBlock === 105n)).toBe(true);
    expect(catalog[0]).toMatchObject({
      buyerCount: 2,
      cashRaised: 1_950n * 10n ** 6n,
      soldShares: 650n * 10n ** 18n,
    });
  });

  test("rescans the overlap at the same head so shallow reorgs do not replay stale logs", async () => {
    const distribution = fixedPriceHistoryFixture();
    let canonicalLogs = [fixedPricePurchaseLog(95n)];
    let calls = 0;
    const client = {
      async getBlockNumber() { return 100n; },
      async getLogs() {
        calls += 1;
        return canonicalLogs;
      },
    };

    const first = await readProductBoardroomHistories(client as never, {
      distributionSummaries: [distribution],
    } as BoardroomSnapshot);
    canonicalLogs = [];
    const second = await readProductBoardroomHistories(client as never, {
      distributionSummaries: [distribution],
    } as BoardroomSnapshot);

    expect(first[0]?.fixedPriceSale?.purchaseCount).toBe(1);
    expect(second[0]?.fixedPriceSale?.purchaseCount).toBe(0);
    expect(calls).toBe(2);
  });

  test("invalidates old logs when the canonical checkpoint hash changes", async () => {
    const distribution = fixedPriceHistoryFixture();
    let canonicalLogs = [fixedPricePurchaseLog(10n)];
    let checkpointHash = `0x${"11".repeat(32)}`;
    const client = {
      async getBlock() { return { hash: checkpointHash }; },
      async getBlockNumber() { return 100n; },
      async getLogs() { return canonicalLogs; },
    };

    const first = await readProductBoardroomHistories(client as never, {
      distributionSummaries: [distribution],
    } as BoardroomSnapshot);
    canonicalLogs = [];
    checkpointHash = `0x${"22".repeat(32)}`;
    const second = await readProductBoardroomHistories(client as never, {
      distributionSummaries: [distribution],
    } as BoardroomSnapshot);

    expect(first[0]?.fixedPriceSale?.purchaseCount).toBe(1);
    expect(second[0]?.fixedPriceSale?.purchaseCount).toBe(0);
  });

  test("discards orphaned logs when the checkpoint changes during a scan", async () => {
    const distribution = fixedPriceHistoryFixture();
    const oldHash = `0x${"11".repeat(32)}`;
    const canonicalHash = `0x${"22".repeat(32)}`;
    let hashReads = 0;
    let logReads = 0;
    const client = {
      async getBlock() {
        hashReads += 1;
        return { hash: hashReads === 1 ? oldHash : canonicalHash };
      },
      async getBlockNumber() { return 100n; },
      async getLogs() {
        logReads += 1;
        return [fixedPricePurchaseLog(10n, logReads === 1 ? 10n : 30n)];
      },
    };

    const histories = await readProductBoardroomHistories(client as never, {
      distributionSummaries: [distribution],
    } as BoardroomSnapshot);

    expect(logReads).toBe(2);
    expect(hashReads).toBe(4);
    expect(histories[0]?.scanError).toBeUndefined();
    expect(histories[0]?.fixedPriceSale).toMatchObject({ purchaseCount: 1, soldShares: 30n });
  });

  test("invalidates cached logs when the chain head rewinds", async () => {
    const distribution = fixedPriceHistoryFixture();
    let head = 100n;
    let canonicalLogs = [fixedPricePurchaseLog(10n)];
    let calls = 0;
    const client = {
      async getBlockNumber() { return head; },
      async getLogs() {
        calls += 1;
        return canonicalLogs;
      },
    };

    const first = await readProductBoardroomHistories(client as never, {
      distributionSummaries: [distribution],
    } as BoardroomSnapshot);
    head = 20n;
    canonicalLogs = [];
    const second = await readProductBoardroomHistories(client as never, {
      distributionSummaries: [distribution],
    } as BoardroomSnapshot);

    expect(first[0]?.fixedPriceSale?.purchaseCount).toBe(1);
    expect(second[0]?.fixedPriceSale?.purchaseCount).toBe(0);
    expect(calls).toBe(2);
  });

  test("bounds retained event history and recovers after an oversized stream", async () => {
    const distribution = fixedPriceHistoryFixture();
    let canonicalLogs = Array(5_001).fill(fixedPricePurchaseLog(10n));
    const client = {
      async getBlockNumber() { return 100n; },
      async getLogs() { return canonicalLogs; },
    };

    const oversized = await readProductBoardroomHistories(client as never, {
      distributionSummaries: [distribution],
    } as BoardroomSnapshot);
    canonicalLogs = [];
    const recovered = await readProductBoardroomHistories(client as never, {
      distributionSummaries: [distribution],
    } as BoardroomSnapshot);

    expect(oversized[0]?.scanError).toContain("5,000-event safety bound");
    expect(recovered[0]?.scanError).toBeUndefined();
    expect(recovered[0]?.fixedPriceSale?.purchaseCount).toBe(0);
  });

  test("enforces the event cap before buffering chunked or recursively split pages", async () => {
    for (const mode of ["chunks", "recursive"] as const) {
      let iteratedOversizedPage = false;
      const client = {
        async getBlockNumber() { return mode === "chunks" ? 199_999n : 99_999n; },
        async getLogs(parameters: { fromBlock?: bigint; toBlock?: bigint }) {
          const fromBlock = parameters.fromBlock ?? 0n;
          const toBlock = parameters.toBlock ?? 0n;
          const size = toBlock - fromBlock + 1n;
          if (mode === "recursive" && size > 50_000n) throw new Error("RPC block range limit exceeded");
          const count = mode === "chunks" ? 3_000 : fromBlock === 0n ? 4_000 : 2_000;
          return guardedLogPage(count, () => { iteratedOversizedPage = true; });
        },
      };

      const histories = await readProductBoardroomHistories(client as never, {
        distributionSummaries: [fixedPriceHistoryFixture()],
      } as BoardroomSnapshot);

      expect(histories[0]?.scanError).toContain("5,000-event safety bound");
      expect(iteratedOversizedPage).toBe(false);
    }
  });

  test("preserves successful curve and AMM substreams while aggregating sibling failures", async () => {
    const pool = "0x7000000000000000000000000000000000000000" as Address;
    const distribution = curveHistoryFixture(pool);
    const partialCurve = await readProductBoardroomHistories(
      curveHistoryClient(pool, new Set(["CurveSell", "CurveMigrated"])),
      { distributionSummaries: [distribution] } as BoardroomSnapshot,
    );

    expect(partialCurve[0]?.curve).toMatchObject({ buyerCount: 1, buyCount: 1, quotePaid: 20n });
    expect(partialCurve[0]?.curve?.sellCount).toBeUndefined();
    expect(partialCurve[0]?.amm).toMatchObject({ swapCount: 1, traderCount: 1 });
    expect(partialCurve[0]?.scanError).toContain("CurveSell history failed");
    expect(partialCurve[0]?.scanError).toContain("CurveMigrated history failed");

    const partialAmm = await readProductBoardroomHistories(
      curveHistoryClient(pool, new Set(["Swap"])),
      { distributionSummaries: [distribution] } as BoardroomSnapshot,
    );

    expect(partialAmm[0]?.curve).toMatchObject({ buyCount: 1, sellCount: 1, soldShares: 6n });
    expect(partialAmm[0]?.curve?.migration?.pool).toBe(pool);
    expect(partialAmm[0]?.amm).toBeUndefined();
    expect(partialAmm[0]?.scanError).toContain("Swap history failed");
  });

  test("uses canonical factory provenance without querying removed Boardroom history events", async () => {
    const context = productBoardroomFixture();
    const attemptedRanges: Array<{ event: string | undefined; fromBlock: bigint; toBlock: bigint }> = [];
    const client = fakeProductBoardroomClient({
      ...context,
      attemptedRanges,
      tokenReads: new Set<string>(),
    });
    const deployment = fixtureDeployment(context);

    const catalog = await readFirstCatalogPageEntries(client, deployment);
    const dashboard = await readProductBoardroomDashboard(client, { address: context.boardroom, catalog, deployment: fixtureDeployment(context) });

    expect(catalog[0]?.distribution).toBe(context.sale);
    expect(dashboard.snapshot.distributionSummaries.map((entry) => entry.address)).toContain(context.sale);
    expect(attemptedRanges.some((range) => range.event === "BoardroomDistributionRecorded")).toBe(false);
  });

  test("rebuilds exact project identity instead of trusting a stale catalog row", async () => {
    const context = productBoardroomFixture();
    const staleDistribution = "0x6000000000000000000000000000000000000000" as Address;
    const client = fakeProductBoardroomClient({ ...context, tokenReads: new Set<string>() });
    const dashboard = await readProductBoardroomDashboard(client, {
      address: context.boardroom,
      catalog: [{
        address: context.boardroom,
        cashToken: context.redeemableAsset,
        distribution: staleDistribution,
        name: "Cached project name",
      }],
      deployment: fixtureDeployment(context),
    });

    expect(dashboard.history?.distribution).toBe(context.sale);
    expect(dashboard.catalog).toHaveLength(1);
    expect(dashboard.catalog[0]).toMatchObject({
      address: context.boardroom,
      cashToken: context.cashToken,
      distribution: context.sale,
      name: "Cached project name",
    });
  });

  test("reports a historical distribution that cannot be reconstructed", async () => {
    const context = productBoardroomFixture();
    const recordedDistribution = "0x6000000000000000000000000000000000000000" as Address;
    const client = fakeProductBoardroomClient({
      ...context,
      recordedDistribution,
      tokenReads: new Set<string>(),
    });
    const deployment = fixtureDeployment(context);

    const catalog = await readFirstCatalogPageEntries(client, deployment);
    const dashboard = await readProductBoardroomDashboard(client, { address: context.boardroom, catalog, deployment: fixtureDeployment(context) });

    expect(catalog[0]?.distribution).toBe(recordedDistribution);
    expect(dashboard.snapshot.distributionSummaries.find((entry) => entry.address === recordedDistribution)?.error).toBeTruthy();
  });

  test("caps lifetime historical distribution reconstruction on direct project routes", async () => {
    const context = productBoardroomFixture();
    const recordedDistributions = Array.from({ length: 100 }, (_, index) =>
      `0x${(10_000 + index).toString(16).padStart(40, "0")}` as Address);
    const distributionFactoryReads: Address[] = [];
    const client = fakeProductBoardroomClient({
      ...context,
      distributionFactoryReads,
      pruned: true,
      recordedDistributions,
      tokenReads: new Set<string>(),
    });

    const dashboard = await readProductBoardroomDashboard(client, { address: context.boardroom, deployment: fixtureDeployment(context) });
    const reconstructed = new Set(distributionFactoryReads.map((address) => address.toLowerCase()));

    expect(dashboard.snapshot.distributionSummaries).toHaveLength(PRODUCT_DETAIL_CHILD_READ_LIMIT);
    expect(reconstructed.size).toBe(PRODUCT_DETAIL_CHILD_READ_LIMIT);
    expect(dashboard.historyErrors?.join(" ")).toContain("newest 64 of 100 distribution records");
  });

  test("marks the bounded Explore lifetime summary as partial with an exact count", async () => {
    const context = productBoardroomFixture();
    const recordedDistributions = Array.from({ length: 100 }, (_, index) =>
      `0x${(20_000 + index).toString(16).padStart(40, "0")}` as Address);
    const distributionFactoryReads: Address[] = [];
    const client = fakeProductBoardroomClient({
      ...context,
      distributionFactoryReads,
      pruned: true,
      recordedDistributions,
      tokenReads: new Set<string>(),
    });

    const entries = await readFirstCatalogPageEntries(client, fixtureDeployment(context));

    expect(entries[0]?.distributionAddresses).toHaveLength(PRODUCT_CATALOG_CHILD_READ_LIMIT);
    expect(entries[0]?.distributionCount).toBe(100);
    expect(entries[0]?.historyError).toContain("newest 12 of 100 canonical factory distribution records");
    expect(new Set(distributionFactoryReads.map((address) => address.toLowerCase())).size)
      .toBe(PRODUCT_CATALOG_CHILD_READ_LIMIT);
  });

  test("returns partial history promptly when one event stream misses the aggregate deadline", async () => {
    const pool = "0x7000000000000000000000000000000000000000" as Address;
    const startedAt = Date.now();

    const histories = await readProductBoardroomHistories(
      curveHistoryClient(pool, new Set(), new Set(["CurveSell"])),
      { distributionSummaries: [curveHistoryFixture(pool)] } as BoardroomSnapshot,
      { timeoutMs: 25 },
    );

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(histories[0]?.completeness).toBe("partial");
    expect(histories[0]?.curve?.buyCount).toBe(1);
    expect(histories[0]?.curve?.sellCount).toBeUndefined();
    expect(histories[0]?.scanError).toContain("deadline");
  });

  test("propagates caller cancellation instead of returning a stale partial result", async () => {
    const controller = new AbortController();
    const reason = new Error("project route changed");
    const client = {
      async getBlockNumber() { return 100n; },
      async getLogs() {
        controller.abort(reason);
        return await new Promise<never>(() => undefined);
      },
    };

    await expect(readProductBoardroomHistories(
      client as never,
      { distributionSummaries: [fixedPriceHistoryFixture()] } as BoardroomSnapshot,
      { signal: controller.signal, timeoutMs: 1_000 },
    )).rejects.toBe(reason);
  });

  test("does not let the first caller's abort contaminate a live shared cache reader", async () => {
    const firstController = new AbortController();
    const reason = new DOMException("first project route changed", "AbortError");
    let getLogsCalls = 0;
    let firstLogReadStarted: (() => void) | undefined;
    let secondHeadReadStarted: (() => void) | undefined;
    const firstLogRead = new Promise<void>((resolve) => {
      firstLogReadStarted = resolve;
    });
    const secondHeadRead = new Promise<void>((resolve) => {
      secondHeadReadStarted = resolve;
    });
    let headReads = 0;
    const client = {
      async getBlockNumber() {
        headReads += 1;
        if (headReads === 2) secondHeadReadStarted?.();
        return 100n;
      },
      async getLogs() {
        getLogsCalls += 1;
        if (getLogsCalls === 1) {
          firstLogReadStarted?.();
          return await new Promise<never>(() => undefined);
        }
        return [];
      },
    };
    const snapshot = { distributionSummaries: [fixedPriceHistoryFixture()] } as BoardroomSnapshot;
    const first = readProductBoardroomHistories(client as never, snapshot, {
      signal: firstController.signal,
      timeoutMs: 1_000,
    });
    const firstOutcome = first.catch((error: unknown) => error);
    await firstLogRead;

    const second = readProductBoardroomHistories(client as never, snapshot, { timeoutMs: 1_000 });
    await secondHeadRead;
    await Promise.resolve();
    await Promise.resolve();
    firstController.abort(reason);

    expect(await firstOutcome).toBe(reason);
    expect(await second).toEqual([expect.objectContaining({ completeness: "complete" })]);
    expect(getLogsCalls).toBe(2);
  });

  test("does not let the first caller's deadline contaminate a live shared cache reader", async () => {
    let getLogsCalls = 0;
    let firstLogReadStarted: (() => void) | undefined;
    const firstLogRead = new Promise<void>((resolve) => {
      firstLogReadStarted = resolve;
    });
    const client = {
      async getBlockNumber() { return 100n; },
      async getLogs() {
        getLogsCalls += 1;
        if (getLogsCalls === 1) {
          firstLogReadStarted?.();
          return await new Promise<never>(() => undefined);
        }
        return [];
      },
    };
    const snapshot = { distributionSummaries: [fixedPriceHistoryFixture()] } as BoardroomSnapshot;
    const first = readProductBoardroomHistories(client as never, snapshot, { timeoutMs: 25 });
    await firstLogRead;

    const second = readProductBoardroomHistories(client as never, snapshot, { timeoutMs: 1_000 });
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toEqual([expect.objectContaining({ completeness: "partial" })]);
    expect(firstResult[0]?.scanError).toContain("deadline");
    expect(secondResult).toEqual([expect.objectContaining({ completeness: "complete" })]);
    expect(getLogsCalls).toBe(2);
  });

  test("retries a hung contract start lookup after the first scan deadline", async () => {
    let providerHealthy = false;
    let getCodeCalls = 0;
    let firstLookupStarted: (() => void) | undefined;
    const firstLookup = new Promise<void>((resolve) => {
      firstLookupStarted = resolve;
    });
    const client = {
      async getBlockNumber() { return 100n; },
      async getCode(parameters: { blockNumber: bigint }) {
        getCodeCalls += 1;
        if (!providerHealthy) {
          firstLookupStarted?.();
          return await new Promise<never>(() => undefined);
        }
        return parameters.blockNumber >= 50n ? "0x01" : "0x";
      },
      async getLogs() { return []; },
    };
    const snapshot = { distributionSummaries: [fixedPriceHistoryFixture()] } as BoardroomSnapshot;
    const first = readProductBoardroomHistories(client as never, snapshot, { timeoutMs: 25 });
    await firstLookup;

    const firstResult = await first;
    expect(firstResult).toEqual([expect.objectContaining({ completeness: "partial" })]);
    expect(firstResult[0]?.scanError).toContain("deadline");
    expect(getCodeCalls).toBe(1);

    providerHealthy = true;
    const secondResult = await readProductBoardroomHistories(client as never, snapshot, { timeoutMs: 1_000 });

    expect(secondResult).toEqual([expect.objectContaining({ completeness: "complete" })]);
    expect(secondResult[0]?.scanError).toBeUndefined();
    expect(getCodeCalls).toBeGreaterThan(1);
  });

  test("does not retain a transient genesis fallback after getCode recovers", async () => {
    const sharedAddress = fixedPriceHistoryFixture().address;
    const noPool = "0x0000000000000000000000000000000000000000" as Address;
    const curve = { ...curveHistoryFixture(noPool), address: sharedAddress } as BoardroomDistributionSnapshot;
    let providerHealthy = false;
    let getCodeCalls = 0;
    const client = {
      async getBlockNumber() { return 100n; },
      async getCode(parameters: { blockNumber: bigint }) {
        getCodeCalls += 1;
        if (!providerHealthy) throw new Error("temporary historical state failure");
        return parameters.blockNumber >= 50n ? "0x01" : "0x";
      },
      async getLogs() { return []; },
    };

    const firstResult = await readProductBoardroomHistories(client as never, {
      distributionSummaries: [fixedPriceHistoryFixture()],
    } as BoardroomSnapshot);
    expect(firstResult).toEqual([expect.objectContaining({ completeness: "complete" })]);
    expect(getCodeCalls).toBe(1);

    providerHealthy = true;
    const secondResult = await readProductBoardroomHistories(client as never, {
      distributionSummaries: [curve],
    } as BoardroomSnapshot);

    expect(secondResult).toEqual([expect.objectContaining({ completeness: "complete" })]);
    expect(getCodeCalls).toBeGreaterThan(1);
  });

  test("keeps concurrent contract start waiters alive when another caller aborts", async () => {
    const sharedAddress = fixedPriceHistoryFixture().address;
    const noPool = "0x0000000000000000000000000000000000000000" as Address;
    const curve = { ...curveHistoryFixture(noPool), address: sharedAddress } as BoardroomDistributionSnapshot;
    const firstController = new AbortController();
    const reason = new DOMException("first project route changed", "AbortError");
    let releaseFirstLookup: ((code: string) => void) | undefined;
    let firstLookupStarted: (() => void) | undefined;
    let allHeadReadsStarted: (() => void) | undefined;
    const firstLookup = new Promise<string>((resolve) => {
      releaseFirstLookup = resolve;
    });
    const lookupStarted = new Promise<void>((resolve) => {
      firstLookupStarted = resolve;
    });
    const allHeadReads = new Promise<void>((resolve) => {
      allHeadReadsStarted = resolve;
    });
    let getCodeCalls = 0;
    let headReads = 0;
    const client = {
      async getBlockNumber() {
        headReads += 1;
        if (headReads === 4) allHeadReadsStarted?.();
        return 100n;
      },
      async getCode(parameters: { blockNumber: bigint }) {
        getCodeCalls += 1;
        if (getCodeCalls === 1) {
          firstLookupStarted?.();
          return await firstLookup;
        }
        return parameters.blockNumber >= 50n ? "0x01" : "0x";
      },
      async getLogs() { return []; },
    };
    const first = readProductBoardroomHistories(client as never, {
      distributionSummaries: [fixedPriceHistoryFixture()],
    } as BoardroomSnapshot, {
      signal: firstController.signal,
      timeoutMs: 1_000,
    });
    const firstOutcome = first.catch((error: unknown) => error);
    await lookupStarted;

    const second = readProductBoardroomHistories(client as never, {
      distributionSummaries: [curve],
    } as BoardroomSnapshot, { timeoutMs: 1_000 });
    await allHeadReads;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(getCodeCalls).toBe(1);

    firstController.abort(reason);
    expect(await firstOutcome).toBe(reason);
    releaseFirstLookup?.("0x01");

    expect(await second).toEqual([expect.objectContaining({ completeness: "complete" })]);
    expect(getCodeCalls).toBe(7);
  });

  test("keeps state-derived catalog metrics and marks partial history failures", async () => {
    const context = productBoardroomFixture();
    const client = fakeProductBoardroomClient({
      ...context,
      failEvents: new Set(["FixedPricePurchase"]),
      tokenReads: new Set<string>(),
    });

    const catalog = await readFirstCatalogPageEntries(client, fixtureDeployment(context));

    expect(catalog[0]).toMatchObject({
      cashRaised: 2_100n * 10n ** 6n,
      historyError: "generic FixedPricePurchase failure",
      soldShares: 700n * 10n ** 18n,
      status: "Active sale",
    });
  });

  test("propagates factory discovery failures", async () => {
    const client = {
      async readContract() { throw new Error("factory unavailable"); },
    };

    await expect(readFirstCatalogPageEntries(client as never, {
      chainId: 31337,
      boardroomFactory: "0x0100000000000000000000000000000000000000",
    })).rejects.toThrow("factory unavailable");
  });

  test("returns a true empty catalog when factory discovery succeeds with zero entries", async () => {
    const client = {
      async readContract(parameters: { functionName: string }) {
        if (parameters.functionName === "allBoardroomsLength") return 0n;
        throw new Error("unexpected Boardroom read");
      },
    };

    const page = await readProductBoardroomCatalogPage(client as never, {
      chainId: 31337,
      boardroomFactory: "0x0100000000000000000000000000000000000000",
    });

    expect(page).toEqual({ entries: [], snapshotCount: 0, totalCount: 0 });
  });

  test("shares a safe genesis fallback when concurrent history reads cannot query old code", async () => {
    const curve = {
      address: "0x6000000000000000000000000000000000000000",
      kind: "migrating-bonding-curve",
      state: {
        pool: "0x0000000000000000000000000000000000000000",
        quoteToken: "0x4000000000000000000000000000000000000000",
      },
    } as BoardroomDistributionSnapshot;
    const client = {
      async getBalance() { return 0n; },
      async getBlockNumber() { return 200_000n; },
      async getCode() { throw new Error("historical state unavailable"); },
      async getLogs() { return []; },
      async readContract() { throw new Error("unexpected read"); },
    };

    const histories = await readProductBoardroomHistories(client as never, {
      distributionSummaries: [curve],
    } as BoardroomSnapshot);

    expect(histories).toHaveLength(1);
    expect(histories[0]?.scanError).toBeUndefined();
    expect(histories[0]?.curve).toMatchObject({ buyCount: 0, sellCount: 0 });
  });

  test("keeps pruned distribution history visible after a sale or curve closes", async () => {
    const context = productBoardroomFixture();
    const client = fakeProductBoardroomClient({ ...context, pruned: true, tokenReads: new Set<string>() });

    const catalog = await readFirstCatalogPageEntries(client, fixtureDeployment(context));
    const dashboard = await readProductBoardroomDashboard(client, {
      address: context.boardroom,
      catalog,
      deployment: fixtureDeployment(context),
    });

    expect(catalog[0]).toMatchObject({
      distribution: context.sale,
      cashRaised: 1_950n * 10n ** 6n,
      soldShares: 650n * 10n ** 18n,
    });
    expect(dashboard.history?.fixedPriceSale?.purchaseCount).toBe(2);
    expect(dashboard.histories).toHaveLength(1);
    expect(dashboard.snapshot.distributionSummaries.map((distribution) => distribution.address)).toContain(context.sale);
  });
});

async function readFirstCatalogPageEntries(
  client: Parameters<typeof readProductBoardroomCatalogPage>[0],
  deployment: Parameters<typeof readProductBoardroomCatalogPage>[1],
) {
  return (await readProductBoardroomCatalogPage(client, deployment)).entries;
}

type ProductBoardroomFixture = ReturnType<typeof productBoardroomFixture>;

function fixedPriceHistoryFixture(): BoardroomDistributionSnapshot {
  return {
    address: "0x5000000000000000000000000000000000000000",
    kind: "fixed-price-sale",
    state: {
      paymentToken: "0x4000000000000000000000000000000000000000",
    },
  } as BoardroomDistributionSnapshot;
}

function fixedPricePurchaseLog(blockNumber: bigint, shares = 10n) {
  return {
    blockNumber,
    args: {
      buyer: "0xa000000000000000000000000000000000000000",
      payment: 20n,
      recipient: "0xa000000000000000000000000000000000000000",
      shares,
    },
  };
}

function guardedLogPage(count: number, onIterate: () => void) {
  const logs = Array(count).fill(fixedPricePurchaseLog(10n)) as ReturnType<typeof fixedPricePurchaseLog>[];
  Object.defineProperty(logs, Symbol.iterator, {
    configurable: true,
    value: function iterator() {
      onIterate();
      return Array.prototype[Symbol.iterator].call(this) as ArrayIterator<ReturnType<typeof fixedPricePurchaseLog>>;
    },
  });
  return logs;
}

function curveHistoryFixture(pool: Address): BoardroomDistributionSnapshot {
  return {
    address: "0x6000000000000000000000000000000000000000",
    kind: "migrating-bonding-curve",
    state: {
      liquidityPoolId: HISTORY_POOL_ID,
      liquidityVault: pool,
      quoteToken: "0x4000000000000000000000000000000000000000",
    },
  } as BoardroomDistributionSnapshot;
}

const HISTORY_POOL_ID = `0x${"31".repeat(32)}` as Hex;

function curveHistoryClient(pool: Address, failEvents: Set<string>, hangEvents = new Set<string>()) {
  return {
    async getBlockNumber() { return 100n; },
    async getLogs(parameters: { event?: { name?: string } }) {
      const name = parameters.event?.name;
      if (name && failEvents.has(name)) throw new Error(`generic ${name} failure`);
      if (name && hangEvents.has(name)) return await new Promise<never>(() => undefined);
      switch (name) {
        case "CurveBuy":
          return [{
            args: {
              buyer: "0xa000000000000000000000000000000000000000",
              quotePaid: 20n,
              shares: 10n,
            },
            blockNumber: 10n,
          }];
        case "CurveSell":
          return [{ args: { quoteReturned: 5n, shares: 4n }, blockNumber: 11n }];
        case "CurveMigrated":
          return [{
            args: {
              liquidity: 100n,
              poolId: HISTORY_POOL_ID,
              quoteToBoardroom: 7n,
              quoteToLiquidity: 8n,
              sharesToLiquidity: 9n,
              terminalPrice: 2n,
              vault: pool,
            },
            blockNumber: 12n,
          }];
        case "Swap":
          return [{
            args: {
              amount0: 1n,
              amount1: -2n,
              id: HISTORY_POOL_ID,
              sender: "0xb000000000000000000000000000000000000000",
            },
            blockNumber: 13n,
          }];
        default:
          return [];
      }
    },
    async readContract(parameters: { functionName: string }) {
      switch (parameters.functionName) {
        case "factory": return "0x8100000000000000000000000000000000000000";
        case "boardroom": return "0x8200000000000000000000000000000000000000";
        case "poolManager": return "0x8300000000000000000000000000000000000000";
        case "protocolFeeRecipient": return "0x8400000000000000000000000000000000000000";
        case "tokenA":
        case "currency0": return "0x4000000000000000000000000000000000000000";
        case "tokenB":
        case "currency1": return "0x5000000000000000000000000000000000000000";
        case "hook": return "0x8500000000000000000000000000000000000000";
        case "poolId": return HISTORY_POOL_ID;
        case "positionSalt": return `0x${"32".repeat(32)}`;
        case "tickLower": return -887_220;
        case "tickUpper": return 887_220;
        case "poolFee": return 3_000;
        case "tickSpacing": return 60;
        case "liquidityState": return 1;
        case "positionLiquidity":
        case "totalSupply": return 100n;
        default: throw new Error(`Unexpected vault read: ${parameters.functionName}`);
      }
    },
  } as never;
}

function productBoardroomFixture() {
  return {
    boardroomFactory: "0x0100000000000000000000000000000000000000" as Address,
    distributionFactory: "0xc000000000000000000000000000000000000000" as Address,
    bondMarketFactory: "0xd000000000000000000000000000000000000000" as Address,
    pledgeV4LiquidityFactory: "0xe000000000000000000000000000000000000000" as Address,
    tokenGrantFactory: "0xf000000000000000000000000000000000000000" as Address,
    boardroom: "0x1000000000000000000000000000000000000000" as Address,
    shareToken: "0x2000000000000000000000000000000000000000" as Address,
    wrappedNative: "0x3000000000000000000000000000000000000000" as Address,
    cashToken: "0x4000000000000000000000000000000000000000" as Address,
    sale: "0x5000000000000000000000000000000000000000" as Address,
    redeemableAsset: "0x7000000000000000000000000000000000000000" as Address,
    facetSetHash: `0x${"a".repeat(64)}` as Hex,
    storageLayoutHash: `0x${"b".repeat(64)}` as Hex,
  };
}

function fakeProductBoardroomClient(
  context: ProductBoardroomFixture & {
    attemptedRanges?: Array<{ event: string | undefined; fromBlock: bigint; toBlock: bigint }>;
    failEvents?: Set<string>;
    latestBlock?: bigint;
    maxLogRange?: bigint;
    pruned?: boolean;
    recordedDistribution?: Address;
    recordedDistributions?: Address[];
    distributionFactoryReads?: Address[];
    successfulRanges?: Array<{ fromBlock: bigint; toBlock: bigint }>;
    tokenReads: Set<string>;
  },
): PledgeCashReadClient & {
  getBalance: () => Promise<bigint>;
  getBlockNumber: () => Promise<bigint>;
  getLogs: (parameters: { address: Address; event?: { name?: string }; fromBlock?: bigint; toBlock?: bigint }) => Promise<{ args: Record<string, unknown>; blockNumber: bigint }[]>;
} {
  const share = 10n ** 18n;
  const cash = 10n ** 6n;
  const saleSupply = 1_000n * share;
  const remainingShares = 300n * share;
  const price = 3n * cash;
  const tokenSymbols = new Map<string, string>([
    [context.shareToken.toLowerCase(), "ATLS"],
    [context.wrappedNative.toLowerCase(), "WHYPE"],
    [context.cashToken.toLowerCase(), "CASH"],
    [context.redeemableAsset.toLowerCase(), "REV"],
  ]);

  return {
    async getBalance() {
      return 0n;
    },
    async getBlockNumber() {
      return context.latestBlock ?? 100n;
    },
    async getLogs(parameters) {
      const fromBlock = parameters.fromBlock ?? 0n;
      const toBlock = parameters.toBlock ?? context.latestBlock ?? 100n;
      context.attemptedRanges?.push({ event: parameters.event?.name, fromBlock, toBlock });
      if (parameters.event?.name && context.failEvents?.has(parameters.event.name)) {
        throw new Error(`generic ${parameters.event.name} failure`);
      }
      if (context.maxLogRange && toBlock - fromBlock + 1n > context.maxLogRange) {
        throw new Error("RPC range limit");
      }
      context.successfulRanges?.push({ fromBlock, toBlock });
      const containsFixtureEvents = fromBlock <= 10n && toBlock >= 10n;
      if (!containsFixtureEvents) return [];
      if (parameters.address.toLowerCase() === context.boardroom.toLowerCase() && parameters.event?.name === "BoardroomDistributionRecorded") {
        return (context.recordedDistributions ?? [context.recordedDistribution ?? context.sale])
          .map((distribution) => ({ args: { distribution }, blockNumber: 10n }));
      }
      if (parameters.address.toLowerCase() !== context.sale.toLowerCase()) return [];
      if (parameters.event?.name !== "FixedPricePurchase") return [];
      return [
        {
          blockNumber: 10n,
          args: {
            buyer: "0xa000000000000000000000000000000000000000",
            recipient: "0xa000000000000000000000000000000000000000",
            shares: 250n * share,
            payment: 750n * cash,
          },
        },
        {
          blockNumber: 10n,
          args: {
            buyer: "0xb000000000000000000000000000000000000000",
            recipient: "0xb000000000000000000000000000000000000000",
            shares: 400n * share,
            payment: 1_200n * cash,
          },
        },
      ];
    },
    async readContract(parameters) {
      const address = parameters.address as Address;
      const functionName = parameters.functionName as string;

      if (address.toLowerCase() === context.boardroomFactory.toLowerCase()) {
        if (functionName === "allBoardroomsLength") return 1n;
        if (functionName === "allBoardrooms") return context.boardroom;
      }

      if (address.toLowerCase() === context.distributionFactory.toLowerCase()) {
        const distributions = context.recordedDistributions ?? [context.recordedDistribution ?? context.sale];
        if (functionName === "distributionCountForBoardroom") return BigInt(distributions.length);
        if (functionName === "distributionPageForBoardroom") {
          const cursor = Number(parameters.args?.[1] ?? 0n);
          const size = Number(parameters.args?.[2] ?? 0n);
          const page = distributions.slice(cursor, cursor + size);
          return [page, BigInt(cursor + page.length)] as const;
        }
      }
      if (address.toLowerCase() === context.bondMarketFactory.toLowerCase()) {
        if (functionName === "bondMarketCountForBoardroom") return 0n;
        if (functionName === "bondMarketPageForBoardroom") return [[], 0n] as const;
      }
      if (address.toLowerCase() === context.pledgeV4LiquidityFactory.toLowerCase() && functionName === "positionOfBoardroom") {
        return [
          "0x0000000000000000000000000000000000000000",
          `0x${"00".repeat(32)}`,
          "0x0000000000000000000000000000000000000000",
          0,
        ] as const;
      }

      if (address.toLowerCase() === context.boardroom.toLowerCase()) {
        if (functionName === "facetSetHash") return context.facetSetHash;
        if (functionName === "appliedStorageVersion") return 1n;
        if (functionName === "appliedStorageLayoutHash") return context.storageLayoutHash;
        if (functionName === "migrationRequired") return false;
        if (functionName === "owner") return "0x8000000000000000000000000000000000000000";
        if (functionName === "policyRegistry") return "0x9000000000000000000000000000000000000000";
        if (functionName === "wrappedNative") return context.wrappedNative;
        if (functionName === "shareToken") return context.shareToken;
        if (functionName === "rewardPool") return "0x0000000000000000000000000000000000000000";
        if (functionName === "redemptionExcessRecipient") return "0x8000000000000000000000000000000000000000";
        if (functionName === "status") return 0;
        if (functionName === "launched") return false;
        if (functionName === "controller") return "0x0000000000000000000000000000000000000000";
        if (functionName === "controllerGeneration" || functionName === "governanceEpoch") return 0n;
        if (functionName === "windDownDelay") return 86_400n;
        if (functionName === "windDownStartedAt") return 0n;
        if (functionName === "protectionStaker") return "0x0000000000000000000000000000000000000000";
        if (functionName === "redeemableAssetCount") return 1n;
        if (functionName === "assetSnapshotProgress") return [0n, 0n, false] as const;
        if (functionName === "redemptionSupplyState") return [0n, false] as const;
        if (functionName === "activeObligationCount" || functionName === "activeObligationCountByKind") return 1n;
        if (functionName === "primaryMarketMode") return 2;
        if (functionName === "bondingCurve") return "0x0000000000000000000000000000000000000000";
        if (functionName === "primaryMarketQuoteAsset") return context.cashToken;
        if (functionName === "liquidityStatus") return 0;
        if (functionName === "liquidityVault") return "0x0000000000000000000000000000000000000000";
        if (functionName === "liquidityPoolId") return `0x${"00".repeat(32)}`;
        if (functionName === "liquidityQuoteAsset") return context.cashToken;
        if (functionName === "redeemableAssetPage") return [[context.redeemableAsset], 1n] as const;
      }

      if (address.toLowerCase() === context.sale.toLowerCase()) {
        if (functionName === "factory") return context.distributionFactory;
        if (functionName === "boardroom") return context.boardroom;
        if (functionName === "shareToken") return context.shareToken;
        if (functionName === "paymentToken") return context.cashToken;
        if (functionName === "saleSupply") return saleSupply;
        if (functionName === "remainingShares") return remainingShares;
        if (functionName === "price") return price;
        if (functionName === "maxPerBuyer") return 0n;
        if (functionName === "startTime") return 0n;
        if (functionName === "endTime") return 0n;
        if (functionName === "saleStatus") return 0;
        if (functionName === "isClosed") return false;
      }

      if (functionName === "factory") context.distributionFactoryReads?.push(address);

      context.tokenReads.add(address.toLowerCase());
      if (address.toLowerCase() === context.shareToken.toLowerCase() && functionName === "governanceEligibleSupply") return 0n;
      if (functionName === "name") return address.toLowerCase() === context.shareToken.toLowerCase() ? "Atlas Payroll Common" : "Token";
      if (functionName === "balanceOf") return address.toLowerCase() === context.cashToken.toLowerCase() ? 2_100n * cash : 0n;
      if (functionName === "symbol") return tokenSymbols.get(address.toLowerCase()) ?? "TOK";
      if (functionName === "decimals") return address.toLowerCase() === context.cashToken.toLowerCase() ? 6 : 18;
      if (functionName === "totalSupply") return address.toLowerCase() === context.shareToken.toLowerCase() ? 1_000_000n * share : 1_000_000n * cash;
      throw new Error(`Unexpected read: ${functionName}`);
    },
  };
}

function fixtureDeployment(context: ProductBoardroomFixture) {
  return {
    chainId: 31337,
    boardroomFactory: context.boardroomFactory,
    distributionFactory: context.distributionFactory,
    bondMarketFactory: context.bondMarketFactory,
    pledgeV4LiquidityFactory: context.pledgeV4LiquidityFactory,
    tokenGrantFactory: context.tokenGrantFactory,
  };
}
