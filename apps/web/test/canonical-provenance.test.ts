import { describe, expect, test } from "bun:test";
import type {
  Address,
  BondMarketState,
  BoardroomState,
  DutchAuctionState,
  FixedPriceSaleState,
  GrantState,
  ProtocolLiquidityVaultState,
  MerkleAirdropState,
  MigratingBondingCurveState,
  PledgeCashDeployment,
  PledgeCashReadClient,
} from "@pledge.cash/sdk";
import {
  assertCanonicalBondMarket,
  assertCanonicalBoardroom,
  assertCanonicalDutchAuction,
  assertCanonicalFixedPriceSale,
  assertCanonicalGrant,
  assertCanonicalLockedLiquidity,
  assertCanonicalMerkleAirdrop,
  assertCanonicalMigratingBondingCurve,
  CanonicalProvenanceError,
} from "../src/lib/canonical-provenance";

const boardroomFactory = "0x1000000000000000000000000000000000000000" as Address;
const tokenGrantFactory = "0x2000000000000000000000000000000000000000" as Address;
const boardroom = "0x3000000000000000000000000000000000000000" as Address;
const grant = "0x4000000000000000000000000000000000000000" as Address;
const spoof = "0x5000000000000000000000000000000000000000" as Address;
const distributionFactory = "0x6000000000000000000000000000000000000000" as Address;
const pledgeV4LiquidityFactory = "0x7000000000000000000000000000000000000000" as Address;
const bondMarketFactory = "0x7100000000000000000000000000000000000000" as Address;
const poolManager = "0x8000000000000000000000000000000000000000" as Address;
const hook = "0x8100000000000000000000000000000000000000" as Address;
const protocolFeeRecipient = "0x8200000000000000000000000000000000000000" as Address;
const shareToken = "0x9000000000000000000000000000000000000000" as Address;
const paymentToken = "0xa000000000000000000000000000000000000000" as Address;
const sale = "0xb000000000000000000000000000000000000000" as Address;
const airdrop = "0xc000000000000000000000000000000000000000" as Address;
const curve = "0xd000000000000000000000000000000000000000" as Address;
const locker = "0xe000000000000000000000000000000000000000" as Address;
const bondMarket = "0xf000000000000000000000000000000000000000" as Address;
const poolId = `0x${"11".repeat(32)}` as const;
const deployment = {
  boardroomFactory,
  bondMarketFactory,
  chainId: 31337,
  distributionFactory,
  pledgeV4Hook: hook,
  pledgeV4LiquidityFactory,
  pledgeV4ProtocolFeeRecipient: protocolFeeRecipient,
  tokenGrantFactory,
  uniswapV4PoolManager: poolManager,
} as PledgeCashDeployment;
const boardroomState = {
  address: boardroom,
  issuedDistributions: [sale, airdrop, curve],
  liquidityPoolId: poolId,
  liquidityVault: locker,
  shareToken,
} as BoardroomState;
const saleState = {
  address: sale,
  boardroom,
  factory: distributionFactory,
  shareToken,
} as FixedPriceSaleState;
const auctionState = {
  address: sale,
  boardroom,
  factory: distributionFactory,
  shareToken,
} as DutchAuctionState;
const airdropState = {
  address: airdrop,
  boardroom,
  factory: distributionFactory,
  shareToken,
  tokenGrantFactory,
} as MerkleAirdropState;
const curveState = {
  address: curve,
  boardroom,
  factory: distributionFactory,
  liquidityFactory: pledgeV4LiquidityFactory,
  shareToken,
} as MigratingBondingCurveState;
const lockerState = {
  address: locker,
  boardroom,
  currency0: shareToken,
  currency1: paymentToken,
  factory: pledgeV4LiquidityFactory,
  hook,
  liquidityState: 1,
  poolFee: 3_000,
  poolId,
  poolManager,
  positionLiquidity: 1n,
  positionSalt: `0x${"22".repeat(32)}`,
  protocolFeeRecipient,
  tickLower: -887_220,
  tickSpacing: 60,
  tickUpper: 887_220,
  tokenA: shareToken,
  tokenB: paymentToken,
  totalSupply: 1n,
} as ProtocolLiquidityVaultState;
const bondMarketState = {
  address: bondMarket,
  boardroom,
  factory: bondMarketFactory,
  shareToken,
} as BondMarketState;

describe("canonical product provenance", () => {
  test("rejects a spoof Boardroom that is absent from the configured factory", async () => {
    const client = readClient(async (functionName) => functionName === "isBoardroom" ? false : undefined);

    await expect(assertCanonicalBoardroom(client, deployment, spoof)).rejects.toThrow("not a Boardroom");
    await expect(assertCanonicalBoardroom(client, deployment, spoof)).rejects.toBeInstanceOf(CanonicalProvenanceError);
    await expect(assertCanonicalBoardroom(readClient(async () => true), deployment, boardroom)).resolves.toBeUndefined();
  });

  test("rejects grants with a spoof factory or mismatched token-ID registration", async () => {
    const state = { factory: tokenGrantFactory, tokenId: 42n } as GrantState;
    const wrongFactory = { ...state, factory: spoof } as GrantState;
    const mappingClient = readClient(async (functionName) => functionName === "grantForTokenId" ? spoof : undefined);

    await expect(assertCanonicalGrant(mappingClient, deployment, grant, wrongFactory)).rejects.toThrow("not created by");
    await expect(assertCanonicalGrant(mappingClient, deployment, grant, state)).rejects.toThrow("token record");
    await expect(assertCanonicalGrant(readClient(async () => grant), deployment, grant, state)).resolves.toBeUndefined();
  });

  test("accepts only factory-issued distributions that use the Boardroom share token", async () => {
    const client = registryClient({ distributionKind: 0 });
    await expect(assertCanonicalFixedPriceSale(client, deployment, boardroomState, saleState)).resolves.toBeUndefined();
    await expect(assertCanonicalFixedPriceSale(
      client,
      deployment,
      boardroomState,
      { ...saleState, factory: spoof },
    )).rejects.toThrow("configured DistributionFactory");
    await expect(assertCanonicalFixedPriceSale(
      registryClient({ distributionRegistered: false, distributionKind: 0 }),
      deployment,
      boardroomState,
      saleState,
    )).rejects.toThrow("not registered");
    await expect(assertCanonicalFixedPriceSale(
      registryClient({ distributionBoardroom: spoof, distributionKind: 0 }),
      deployment,
      boardroomState,
      saleState,
    )).rejects.toThrow("Boardroom record");
    await expect(assertCanonicalFixedPriceSale(
      client,
      deployment,
      boardroomState,
      { ...saleState, boardroom: spoof },
    )).rejects.toThrow("verified Boardroom");
    await expect(assertCanonicalFixedPriceSale(
      registryClient({ distributionKind: 1 }),
      deployment,
      boardroomState,
      saleState,
    )).rejects.toThrow("type record");
    await expect(assertCanonicalFixedPriceSale(
      client,
      deployment,
      boardroomState,
      { ...saleState, shareToken: spoof },
    )).rejects.toThrow("Boardroom share token");

    // Factory registration persists after a closed child is pruned from the Boardroom's active list.
    await expect(assertCanonicalFixedPriceSale(
      client,
      deployment,
      { ...boardroomState, issuedDistributions: [] },
      saleState,
    )).resolves.toBeUndefined();
  });

  test("binds Dutch auctions to the appended factory kind without changing legacy kinds", async () => {
    await expect(assertCanonicalDutchAuction(
      registryClient({ distributionKind: 3 }),
      deployment,
      boardroomState,
      auctionState,
    )).resolves.toBeUndefined();
    await expect(assertCanonicalDutchAuction(
      registryClient({ distributionKind: 0 }),
      deployment,
      boardroomState,
      auctionState,
    )).rejects.toThrow("type record");
  });

  test("verifies airdrop and curve deployment dependencies", async () => {
    await expect(assertCanonicalMerkleAirdrop(
      registryClient({ distributionKind: 2 }),
      deployment,
      boardroomState,
      airdropState,
    )).resolves.toBeUndefined();
    await expect(assertCanonicalMerkleAirdrop(
      registryClient({ distributionKind: 2 }),
      deployment,
      boardroomState,
      { ...airdropState, tokenGrantFactory: spoof },
    )).rejects.toThrow("configured TokenGrantFactory");
    await expect(assertCanonicalMerkleAirdrop(
      registryClient({ distributionKind: 2 }),
      deployment,
      boardroomState,
      { ...airdropState, shareToken: spoof },
    )).rejects.toThrow("Boardroom share token");

    await expect(assertCanonicalMigratingBondingCurve(
      registryClient({ distributionKind: 1 }),
      deployment,
      boardroomState,
      curveState,
    )).resolves.toBeUndefined();
    await expect(assertCanonicalMigratingBondingCurve(
      registryClient({ distributionKind: 1 }),
      deployment,
      boardroomState,
      { ...curveState, liquidityFactory: spoof },
    )).rejects.toThrow("configured PledgeV4LiquidityFactory");
    await expect(assertCanonicalMigratingBondingCurve(
      registryClient({ distributionKind: 1 }),
      deployment,
      boardroomState,
      { ...curveState, shareToken: spoof },
    )).rejects.toThrow("Boardroom share token");
  });

  test("accepts only factory-registered bond markets with canonical wiring", async () => {
    const client = readClient(async (functionName) => functionName === "isBondMarket" ? true : undefined);
    await expect(assertCanonicalBondMarket(client, deployment, boardroomState, bondMarketState)).resolves.toBeUndefined();
    await expect(assertCanonicalBondMarket(client, deployment, boardroomState, { ...bondMarketState, factory: spoof }))
      .rejects.toThrow("configured BondMarketFactory");
    await expect(assertCanonicalBondMarket(
      readClient(async (functionName) => functionName === "isBondMarket" ? false : undefined),
      deployment,
      boardroomState,
      bondMarketState,
    )).rejects.toThrow("not registered");
    await expect(assertCanonicalBondMarket(client, deployment, boardroomState, { ...bondMarketState, boardroom: spoof }))
      .rejects.toThrow("verified Boardroom");
    await expect(assertCanonicalBondMarket(client, deployment, boardroomState, { ...bondMarketState, shareToken: spoof }))
      .rejects.toThrow("Boardroom share token");
  });

  test("accepts only factory-registered liquidity positions with canonical wiring", async () => {
    const client = registryClient({ vaultRegistered: true });
    await expect(assertCanonicalLockedLiquidity(client, deployment, boardroomState, lockerState)).resolves.toBeUndefined();
    await expect(assertCanonicalLockedLiquidity(
      client,
      deployment,
      boardroomState,
      { ...lockerState, factory: spoof },
    )).rejects.toThrow("configured PledgeV4LiquidityFactory");
    await expect(assertCanonicalLockedLiquidity(
      registryClient({ vaultRegistered: false }),
      deployment,
      boardroomState,
      lockerState,
    )).rejects.toThrow("not registered");
    await expect(assertCanonicalLockedLiquidity(
      registryClient({ vaultBoardroom: spoof, vaultRegistered: true }),
      deployment,
      boardroomState,
      lockerState,
    )).rejects.toThrow("Boardroom record");
    await expect(assertCanonicalLockedLiquidity(
      client,
      deployment,
      boardroomState,
      { ...lockerState, boardroom: spoof },
    )).rejects.toThrow("verified Boardroom");
    await expect(assertCanonicalLockedLiquidity(
      client,
      deployment,
      boardroomState,
      { ...lockerState, poolManager: spoof },
    )).rejects.toThrow("configured Uniswap v4 PoolManager");
    await expect(assertCanonicalLockedLiquidity(
      client,
      deployment,
      boardroomState,
      { ...lockerState, tokenA: paymentToken, tokenB: spoof },
    )).rejects.toThrow("Boardroom share token");

    await expect(assertCanonicalLockedLiquidity(
      client,
      deployment,
      { ...boardroomState, liquidityVault: spoof },
      lockerState,
    )).rejects.toThrow("Boardroom liquidity record");

    await expect(assertCanonicalLockedLiquidity(
      registryClient({ vaultForPoolId: spoof }),
      deployment,
      boardroomState,
      lockerState,
    )).rejects.toThrow("PoolId record");
    await expect(assertCanonicalLockedLiquidity(
      client,
      deployment,
      boardroomState,
      { ...lockerState, hook: spoof },
    )).rejects.toThrow("configured PledgeV4Hook");
    await expect(assertCanonicalLockedLiquidity(
      client,
      deployment,
      boardroomState,
      { ...lockerState, protocolFeeRecipient: spoof },
    )).rejects.toThrow("protocol fee recipient");
    await expect(assertCanonicalLockedLiquidity(
      client,
      deployment,
      boardroomState,
      { ...lockerState, currency1: spoof },
    )).rejects.toThrow("currencies");
  });
});

function registryClient(options: {
  distributionBoardroom?: Address;
  distributionKind?: number;
  distributionRegistered?: boolean;
  vaultBoardroom?: Address;
  vaultForPoolId?: Address;
  vaultRegistered?: boolean;
}): PledgeCashReadClient {
  return readClient(async (functionName) => {
    if (functionName === "isDistribution") return options.distributionRegistered ?? true;
    if (functionName === "distributionBoardroom") return options.distributionBoardroom ?? boardroom;
    if (functionName === "distributionKind") return options.distributionKind ?? 0;
    if (functionName === "isVault") return options.vaultRegistered ?? true;
    if (functionName === "vaultBoardroom") return options.vaultBoardroom ?? boardroom;
    if (functionName === "vaultForPoolId") return options.vaultForPoolId ?? locker;
    return undefined;
  });
}

function readClient(read: (functionName: string) => Promise<unknown>): PledgeCashReadClient {
  return {
    readContract: async (request: { functionName?: string }) => await read(request.functionName ?? ""),
  } as unknown as PledgeCashReadClient;
}
