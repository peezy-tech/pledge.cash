import { describe, expect, test } from "bun:test";
import type { Address, PledgeCashReadClient } from "@pledge.cash/sdk";
import {
  distributionCirculatingShares,
  readFactoryBoardrooms,
  readProductBoardroomCatalog,
  readProductBoardroomDashboard,
  readProductBoardroomHistories,
  resolveProductBoardroomAddress,
} from "../src/lib/product-boardroom";
import type { BoardroomDistributionSnapshot, BoardroomSnapshot } from "../src/lib/types";

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

  test("pages through every factory Boardroom newest first", async () => {
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

    const discovered = await readFactoryBoardrooms(client as never, factory);

    expect(discovered).toHaveLength(65);
    expect(discovered[0]).toBe(addresses[64]);
    expect(discovered[64]).toBe(addresses[0]);
  });

  test("loads dashboard treasury assets from Boardroom state without seed artifacts", async () => {
    const context = productBoardroomFixture();
    const tokenReads = new Set<string>();
    const client = fakeProductBoardroomClient({ ...context, tokenReads });
    const seedOnlyEquity = "0x6000000000000000000000000000000000000000" as Address;

    const dashboard = await readProductBoardroomDashboard(client, { address: context.boardroom });

    expect(dashboard.catalog).toEqual([]);
    expect(dashboard.treasuryAssets.map((asset) => asset.label)).toEqual([
      "Treasury shares",
      "Wrapped native",
      "Cash / quote",
      "Redeemable asset",
    ]);
    expect(dashboard.treasuryAssets.some((asset) => asset.address === seedOnlyEquity)).toBe(false);
    expect(tokenReads.has(seedOnlyEquity.toLowerCase())).toBe(false);
  });

  test("discovers Boardroom catalog entries from the factory and purchase logs", async () => {
    const context = productBoardroomFixture();
    const share = 10n ** 18n;
    const cash = 10n ** 6n;
    const client = fakeProductBoardroomClient({ ...context, tokenReads: new Set<string>() });

    const catalog = await readProductBoardroomCatalog(client, {
      chainId: 31337,
      boardroomFactory: context.boardroomFactory,
    });

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

    const catalog = await readProductBoardroomCatalog(client, {
      chainId: 31337,
      boardroomFactory: context.boardroomFactory,
    });

    expect(catalog[0]?.buyerCount).toBe(2);
    expect(successfulRanges.length).toBeGreaterThan(2);
    expect(successfulRanges.every(({ fromBlock, toBlock }) => toBlock - fromBlock + 1n <= 50_000n)).toBe(true);
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

    const catalog = await readProductBoardroomCatalog(client, {
      chainId: 31337,
      boardroomFactory: context.boardroomFactory,
    });
    const dashboard = await readProductBoardroomDashboard(client, {
      address: context.boardroom,
      catalog,
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

type ProductBoardroomFixture = ReturnType<typeof productBoardroomFixture>;

function productBoardroomFixture() {
  return {
    boardroomFactory: "0x0100000000000000000000000000000000000000" as Address,
    boardroom: "0x1000000000000000000000000000000000000000" as Address,
    shareToken: "0x2000000000000000000000000000000000000000" as Address,
    wrappedNative: "0x3000000000000000000000000000000000000000" as Address,
    cashToken: "0x4000000000000000000000000000000000000000" as Address,
    sale: "0x5000000000000000000000000000000000000000" as Address,
    redeemableAsset: "0x7000000000000000000000000000000000000000" as Address,
  };
}

function fakeProductBoardroomClient(
  context: ProductBoardroomFixture & {
    latestBlock?: bigint;
    maxLogRange?: bigint;
    pruned?: boolean;
    successfulRanges?: Array<{ fromBlock: bigint; toBlock: bigint }>;
    tokenReads: Set<string>;
  },
): PledgeCashReadClient & {
  getBalance: () => Promise<bigint>;
  getBlockNumber: () => Promise<bigint>;
  getLogs: (parameters: { address: Address; event?: { name?: string }; fromBlock?: bigint; toBlock?: bigint }) => Promise<{ args: Record<string, unknown> }[]>;
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
      if (context.maxLogRange && toBlock - fromBlock + 1n > context.maxLogRange) {
        throw new Error("RPC range limit");
      }
      context.successfulRanges?.push({ fromBlock, toBlock });
      const containsFixtureEvents = fromBlock <= 10n && toBlock >= 10n;
      if (!containsFixtureEvents) return [];
      if (parameters.address.toLowerCase() === context.boardroom.toLowerCase() && parameters.event?.name === "BoardroomDistributionRecorded") {
        return [{ args: { distribution: context.sale } }];
      }
      if (parameters.address.toLowerCase() !== context.sale.toLowerCase()) return [];
      if (parameters.event?.name !== "FixedPricePurchase") return [];
      return [
        {
          args: {
            buyer: "0xa000000000000000000000000000000000000000",
            recipient: "0xa000000000000000000000000000000000000000",
            shares: 250n * share,
            payment: 750n * cash,
          },
        },
        {
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

      if (address.toLowerCase() === context.boardroom.toLowerCase()) {
        if (functionName === "owner") return "0x8000000000000000000000000000000000000000";
        if (functionName === "policyRegistry") return "0x9000000000000000000000000000000000000000";
        if (functionName === "wrappedNative") return context.wrappedNative;
        if (functionName === "shareToken") return context.shareToken;
        if (functionName === "status") return 0;
        if (functionName === "launched") return false;
        if (functionName === "executor") return "0x8000000000000000000000000000000000000000";
        if (functionName === "governanceDelay") return 0n;
        if (functionName === "governanceConfig") return [86_400n, 604_800n, 100n, 1_000n] as const;
        if (functionName === "governanceState") return [0n, 0n, 0n, 0n, 0] as const;
        if (functionName === "getRedeemableAssets") return [context.redeemableAsset];
        if (functionName === "getIssuedGrants") return [];
        if (functionName === "getIssuedDistributions") return context.pruned ? [] : [context.sale];
        if (functionName === "getLockedLiquidityPositions") return [];
      }

      if (address.toLowerCase() === context.sale.toLowerCase()) {
        if (functionName === "factory") return "0xc000000000000000000000000000000000000000";
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
