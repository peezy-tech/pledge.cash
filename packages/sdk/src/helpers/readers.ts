import type { Address, Hex } from "viem";
import {
  ammFactoryAbi,
  boardroomAbi,
  boardroomFactoryAbi,
  distributionFactoryAbi,
  fixedPriceSaleAbi,
  lockedLiquidityAbi,
  lockedLiquidityFactoryAbi,
  migratingBondingCurveAbi,
  tokenGrantAbi,
  tokenGrantFactoryAbi,
} from "../generated";
import type {
  BoardroomState,
  FactoryState,
  FixedPriceSaleState,
  GrantState,
  LockedLiquidityState,
  MigratingBondingCurveState,
  PledgeCashReadClient,
} from "./types";

export async function readFactoryState(client: PledgeCashReadClient, factory: Address): Promise<FactoryState> {
  const [owner, tokenGrantLogic, creationFee] = await Promise.all([
    client.readContract({ address: factory, abi: tokenGrantFactoryAbi, functionName: "owner" }),
    client.readContract({ address: factory, abi: tokenGrantFactoryAbi, functionName: "tokenGrantLogic" }),
    client.readContract({ address: factory, abi: tokenGrantFactoryAbi, functionName: "creationFee" }),
  ]);

  return {
    address: factory,
    owner: owner as Address,
    tokenGrantLogic: tokenGrantLogic as Address,
    creationFee: creationFee as bigint,
  };
}

export async function readGrantState(
  client: PledgeCashReadClient,
  grant: Address,
  currentTime: bigint = BigInt(Math.floor(Date.now() / 1000)),
): Promise<GrantState> {
  const [
    issuer,
    holder,
    token,
    paymentToken,
    grantSize,
    claimable,
    price,
    expiry,
    settledAmount,
    halted,
    closed,
    settleable,
  ] = await Promise.all([
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "issuer" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "holder" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "token" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "paymentToken" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "grantSize" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "claimable" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "price" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "expiry" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "settledAmount" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "vestingIsHalted" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "isClosed" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "getSettleableAmount", args: [currentTime] }),
  ]);

  return {
    address: grant,
    issuer: issuer as Address,
    holder: holder as Address,
    token: token as Address,
    paymentToken: paymentToken as Address,
    grantSize: grantSize as bigint,
    claimable: claimable as bigint,
    price: price as bigint,
    expiry: expiry as bigint,
    settledAmount: settledAmount as bigint,
    halted: halted as boolean,
    closed: closed as boolean,
    settleable: settleable as bigint,
  };
}

export async function readBoardroomState(client: PledgeCashReadClient, boardroom: Address): Promise<BoardroomState> {
  const [
    owner,
    policyRegistry,
    shareToken,
    status,
    redeemableAssets,
    issuedGrants,
    issuedDistributions,
    lockedLiquidityPositions,
  ] =
    await Promise.all([
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "owner" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "policyRegistry" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "shareToken" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "status" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "getRedeemableAssets" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "getIssuedGrants" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "getIssuedDistributions" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "getLockedLiquidityPositions" }),
    ]);

  return {
    address: boardroom,
    owner: owner as Address,
    policyRegistry: policyRegistry as Address,
    shareToken: shareToken as Address,
    status: Number(status),
    redeemableAssets: redeemableAssets as Address[],
    issuedGrants: issuedGrants as Address[],
    issuedDistributions: issuedDistributions as Address[],
    lockedLiquidityPositions: lockedLiquidityPositions as Address[],
  };
}

export async function predictGrantAddress(
  client: PledgeCashReadClient,
  input: { factory: Address; issuer: Address; salt: Hex },
): Promise<Address> {
  return (await client.readContract({
    address: input.factory,
    abi: tokenGrantFactoryAbi,
    functionName: "predictGrantAddress",
    args: [input.issuer, input.salt],
  })) as Address;
}

export async function predictDirectGrantAddress(
  client: PledgeCashReadClient,
  input: { factory: Address; issuer: Address; salt: Hex },
): Promise<Address> {
  return await predictGrantAddress(client, input);
}

export async function predictBoardroomGrantAddress(
  client: PledgeCashReadClient,
  input: { factory: Address; boardroom: Address; salt: Hex },
): Promise<Address> {
  return await predictGrantAddress(client, { factory: input.factory, issuer: input.boardroom, salt: input.salt });
}

export async function predictBoardroomAddress(
  client: PledgeCashReadClient,
  input: { factory: Address; owner: Address; name: string; symbol: string; salt: Hex },
): Promise<Address> {
  return (await client.readContract({
    address: input.factory,
    abi: boardroomFactoryAbi,
    functionName: "predictBoardroomAddress",
    args: [input.owner, input.name, input.symbol, input.salt],
  })) as Address;
}

export async function predictFixedPriceSaleAddress(
  client: PledgeCashReadClient,
  input: { factory: Address; boardroom: Address; salt: Hex },
): Promise<Address> {
  return (await client.readContract({
    address: input.factory,
    abi: distributionFactoryAbi,
    functionName: "predictFixedPriceSaleAddress",
    args: [input.boardroom, input.salt],
  })) as Address;
}

export async function predictMigratingBondingCurveAddress(
  client: PledgeCashReadClient,
  input: { factory: Address; boardroom: Address; salt: Hex },
): Promise<Address> {
  return (await client.readContract({
    address: input.factory,
    abi: distributionFactoryAbi,
    functionName: "predictMigratingBondingCurveAddress",
    args: [input.boardroom, input.salt],
  })) as Address;
}

export async function predictAmmPoolAddress(
  client: PledgeCashReadClient,
  input: { factory: Address; tokenA: Address; tokenB: Address },
): Promise<Address> {
  return (await client.readContract({
    address: input.factory,
    abi: ammFactoryAbi,
    functionName: "predictPoolAddress",
    args: [input.tokenA, input.tokenB],
  })) as Address;
}

export async function predictLockedLiquidityAddress(
  client: PledgeCashReadClient,
  input: { factory: Address; boardroom: Address; salt: Hex },
): Promise<Address> {
  return (await client.readContract({
    address: input.factory,
    abi: lockedLiquidityFactoryAbi,
    functionName: "predictLockedLiquidityAddress",
    args: [input.boardroom, input.salt],
  })) as Address;
}

export async function readFixedPriceSaleState(
  client: PledgeCashReadClient,
  sale: Address,
): Promise<FixedPriceSaleState> {
  const [
    factory,
    boardroom,
    shareToken,
    paymentToken,
    saleSupply,
    remainingShares,
    price,
    maxPerBuyer,
    startTime,
    endTime,
    saleStatus,
    closed,
  ] = await Promise.all([
    client.readContract({ address: sale, abi: fixedPriceSaleAbi, functionName: "factory" }),
    client.readContract({ address: sale, abi: fixedPriceSaleAbi, functionName: "boardroom" }),
    client.readContract({ address: sale, abi: fixedPriceSaleAbi, functionName: "shareToken" }),
    client.readContract({ address: sale, abi: fixedPriceSaleAbi, functionName: "paymentToken" }),
    client.readContract({ address: sale, abi: fixedPriceSaleAbi, functionName: "saleSupply" }),
    client.readContract({ address: sale, abi: fixedPriceSaleAbi, functionName: "remainingShares" }),
    client.readContract({ address: sale, abi: fixedPriceSaleAbi, functionName: "price" }),
    client.readContract({ address: sale, abi: fixedPriceSaleAbi, functionName: "maxPerBuyer" }),
    client.readContract({ address: sale, abi: fixedPriceSaleAbi, functionName: "startTime" }),
    client.readContract({ address: sale, abi: fixedPriceSaleAbi, functionName: "endTime" }),
    client.readContract({ address: sale, abi: fixedPriceSaleAbi, functionName: "saleStatus" }),
    client.readContract({ address: sale, abi: fixedPriceSaleAbi, functionName: "isClosed" }),
  ]);

  return {
    address: sale,
    factory: factory as Address,
    boardroom: boardroom as Address,
    shareToken: shareToken as Address,
    paymentToken: paymentToken as Address,
    saleSupply: saleSupply as bigint,
    remainingShares: remainingShares as bigint,
    price: price as bigint,
    maxPerBuyer: maxPerBuyer as bigint,
    startTime: startTime as bigint,
    endTime: endTime as bigint,
    saleStatus: Number(saleStatus),
    closed: closed as boolean,
  };
}

export async function readMigratingBondingCurveState(
  client: PledgeCashReadClient,
  curve: Address,
): Promise<MigratingBondingCurveState> {
  const [
    factory,
    boardroom,
    lockedLiquidityFactory,
    shareToken,
    quoteToken,
    locker,
    pool,
    saleSupply,
    migrationSupply,
    remainingSaleShares,
    basePrice,
    slope,
    graduationQuoteTarget,
    quoteToLpBps,
    startTime,
    endTime,
    migrationSalt,
    curveStatus,
    soldShares,
    quoteReserve,
    canMigrate,
    closed,
  ] = await Promise.all([
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "factory" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "boardroom" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "lockedLiquidityFactory" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "shareToken" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "quoteToken" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "locker" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "pool" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "saleSupply" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "migrationSupply" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "remainingSaleShares" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "basePrice" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "slope" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "graduationQuoteTarget" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "quoteToLpBps" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "startTime" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "endTime" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "migrationSalt" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "curveStatus" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "soldShares" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "quoteReserve" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "canMigrate" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "isClosed" }),
  ]);

  return {
    address: curve,
    factory: factory as Address,
    boardroom: boardroom as Address,
    lockedLiquidityFactory: lockedLiquidityFactory as Address,
    shareToken: shareToken as Address,
    quoteToken: quoteToken as Address,
    locker: locker as Address,
    pool: pool as Address,
    saleSupply: saleSupply as bigint,
    migrationSupply: migrationSupply as bigint,
    remainingSaleShares: remainingSaleShares as bigint,
    basePrice: basePrice as bigint,
    slope: slope as bigint,
    graduationQuoteTarget: graduationQuoteTarget as bigint,
    quoteToLpBps: Number(quoteToLpBps),
    startTime: startTime as bigint,
    endTime: endTime as bigint,
    migrationSalt: migrationSalt as Hex,
    curveStatus: Number(curveStatus),
    soldShares: soldShares as bigint,
    quoteReserve: quoteReserve as bigint,
    canMigrate: canMigrate as boolean,
    closed: closed as boolean,
  };
}

export async function readLockedLiquidityState(
  client: PledgeCashReadClient,
  locker: Address,
): Promise<LockedLiquidityState> {
  const [
    factory,
    boardroom,
    router,
    tokenA,
    tokenB,
    pool,
    seeded,
    lockedLiquidity,
  ] = await Promise.all([
    client.readContract({ address: locker, abi: lockedLiquidityAbi, functionName: "factory" }),
    client.readContract({ address: locker, abi: lockedLiquidityAbi, functionName: "boardroom" }),
    client.readContract({ address: locker, abi: lockedLiquidityAbi, functionName: "router" }),
    client.readContract({ address: locker, abi: lockedLiquidityAbi, functionName: "tokenA" }),
    client.readContract({ address: locker, abi: lockedLiquidityAbi, functionName: "tokenB" }),
    client.readContract({ address: locker, abi: lockedLiquidityAbi, functionName: "pool" }),
    client.readContract({ address: locker, abi: lockedLiquidityAbi, functionName: "seeded" }),
    client.readContract({ address: locker, abi: lockedLiquidityAbi, functionName: "lockedLiquidity" }),
  ]);

  return {
    address: locker,
    factory: factory as Address,
    boardroom: boardroom as Address,
    router: router as Address,
    tokenA: tokenA as Address,
    tokenB: tokenB as Address,
    pool: pool as Address,
    seeded: seeded as boolean,
    lockedLiquidity: lockedLiquidity as bigint,
  };
}
