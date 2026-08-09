import type { Address } from "viem";
import {
  boardroomAbi,
  boardroomFactoryAbi,
  boardroomTokenAbi,
  erc20Abi,
  liquidityLockerAbi,
  liquidityLockerFactoryAbi,
  positionManagerAbi,
  tokenGrantAbi,
  tokenGrantFactoryAbi,
} from "../generated";
import type {
  BoardroomState,
  BoardroomStatus,
  GrantSettlementQuote,
  GrantState,
  LiquidityLockerState,
  PledgeCashBlockReadClient,
  PledgeCashReadClient,
  TokenGrantFactoryState,
  UniswapV4PoolKey,
} from "./types";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const satisfies Address;

export async function readFactoryState(
  client: PledgeCashReadClient,
  factory: Address,
): Promise<TokenGrantFactoryState> {
  const [owner, boardroomFactory, tokenGrantLogic, feeRecipient, creationFee] = await Promise.all([
    client.readContract({ address: factory, abi: tokenGrantFactoryAbi, functionName: "owner" }),
    client.readContract({ address: factory, abi: tokenGrantFactoryAbi, functionName: "boardroomFactory" }),
    client.readContract({ address: factory, abi: tokenGrantFactoryAbi, functionName: "tokenGrantLogic" }),
    client.readContract({ address: factory, abi: tokenGrantFactoryAbi, functionName: "feeRecipient" }),
    client.readContract({ address: factory, abi: tokenGrantFactoryAbi, functionName: "creationFee" }),
  ]);
  return {
    address: factory,
    owner: owner as Address,
    boardroomFactory: boardroomFactory as Address,
    tokenGrantLogic: tokenGrantLogic as Address,
    feeRecipient: feeRecipient as Address,
    creationFee: creationFee as bigint,
  };
}

export async function readGrantState(
  client: PledgeCashReadClient,
  grant: Address,
  currentTime: bigint = BigInt(Math.floor(Date.now() / 1000)),
): Promise<GrantState> {
  const [
    factory,
    issuer,
    holder,
    token,
    paymentToken,
    tokenId,
    tokenDecimals,
    paymentTokenDecimals,
    grantSize,
    claimable,
    price,
    vestingCliff,
    vestingEnd,
    expiry,
    settledAmount,
    halted,
    closed,
    settleable,
    unsettledAmount,
    transferable,
    transferUnlockTime,
    transferLocked,
    expired,
    quarantined,
    quarantinedAmount,
  ] = await Promise.all([
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "factory" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "issuer" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "holder" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "token" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "paymentToken" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "tokenId" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "tokenDecimals" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "paymentTokenDecimals" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "grantSize" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "claimable" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "price" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "vestingCliff" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "vestingEnd" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "expiry" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "settledAmount" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "vestingIsHalted" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "isClosed" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "getSettleableAmount", args: [currentTime] }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "getUnsettledAmount" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "transferable" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "transferUnlockTime" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "transferLocked" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "isExpired", args: [currentTime] }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "isQuarantined" }),
    client.readContract({ address: grant, abi: tokenGrantAbi, functionName: "quarantinedAmount" }),
  ]);
  const settlementCost = await client.readContract({
    address: grant,
    abi: tokenGrantAbi,
    functionName: "getSettlementCost",
    args: [settleable as bigint],
  });

  return {
    address: grant,
    factory: factory as Address,
    issuer: issuer as Address,
    holder: holder as Address,
    token: token as Address,
    paymentToken: paymentToken as Address,
    tokenId: tokenId as bigint,
    tokenDecimals: Number(tokenDecimals),
    paymentTokenDecimals: Number(paymentTokenDecimals),
    grantSize: grantSize as bigint,
    claimable: claimable as bigint,
    price: price as bigint,
    vestingCliff: vestingCliff as bigint,
    vestingEnd: vestingEnd as bigint,
    expiry: expiry as bigint,
    settledAmount: settledAmount as bigint,
    halted: halted as boolean,
    closed: closed as boolean,
    settleable: settleable as bigint,
    settlementCost: settlementCost as bigint,
    unsettledAmount: unsettledAmount as bigint,
    transferable: transferable as boolean,
    transferUnlockTime: transferUnlockTime as bigint,
    transferLocked: transferLocked as boolean,
    expired: expired as boolean,
    quarantined: quarantined as boolean,
    quarantinedAmount: quarantinedAmount as bigint,
  };
}

export async function readGrantSettlementQuote(
  client: PledgeCashReadClient,
  grant: Address,
  amount: bigint,
  currentTime: bigint = BigInt(Math.floor(Date.now() / 1000)),
): Promise<GrantSettlementQuote> {
  const state = await readGrantState(client, grant, currentTime);
  const settlementCost = await client.readContract({
    address: grant,
    abi: tokenGrantAbi,
    functionName: "getSettlementCost",
    args: [amount],
  }) as bigint;
  if (state.paymentToken === ZERO_ADDRESS) return { state, holder: state.holder, amount, settlementCost };

  const [paymentBalance, paymentAllowance] = await Promise.all([
    client.readContract({ address: state.paymentToken, abi: erc20Abi, functionName: "balanceOf", args: [state.holder] }),
    client.readContract({ address: state.paymentToken, abi: erc20Abi, functionName: "allowance", args: [state.holder, grant] }),
  ]);
  return {
    state,
    holder: state.holder,
    amount,
    settlementCost,
    paymentBalance: paymentBalance as bigint,
    paymentAllowance: paymentAllowance as bigint,
  };
}

export async function readBoardroomState(
  rawClient: PledgeCashBlockReadClient,
  boardroom: Address,
): Promise<BoardroomState> {
  const blockNumber = await rawClient.getBlockNumber();
  const client = {
    readContract(request: Parameters<PledgeCashReadClient["readContract"]>[0]) {
      return rawClient.readContract({ ...request, blockNumber } as never);
    },
  } as PledgeCashReadClient;
  const [
    factory,
    owner,
    wrappedNative,
    shareToken,
    redemptionExcessRecipient,
    status,
    launched,
    windDownDelay,
    windDownStartedAt,
    redeemableAssetCount,
    snapshotProgress,
    redemptionSupplyState,
    openEscrowCount,
    liquidityMutationAllowed,
    lockedLiquidityExitAllowed,
  ] = await Promise.all([
    client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "factory" }),
    client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "owner" }),
    client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "wrappedNative" }),
    client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "shareToken" }),
    client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "redemptionExcessRecipient" }),
    client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "status" }),
    client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "launched" }),
    client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "windDownDelay" }),
    client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "windDownStartedAt" }),
    client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "redeemableAssetCount" }),
    client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "assetSnapshotProgress" }),
    client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "redemptionSupplyState" }),
    client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "openEscrowCount" }),
    client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "liquidityMutationAllowed" }),
    client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "lockedLiquidityExitAllowed" }),
  ]);
  const [totalShareSupply, treasuryShareBalance] = await Promise.all([
    client.readContract({ address: shareToken as Address, abi: boardroomTokenAbi, functionName: "totalSupply" }),
    client.readContract({ address: shareToken as Address, abi: boardroomTokenAbi, functionName: "balanceOf", args: [boardroom] }),
  ]);
  const snapshot = snapshotProgress as readonly [bigint, bigint, boolean];
  const redemption = redemptionSupplyState as readonly [bigint, boolean];
  return {
    address: boardroom,
    blockNumber,
    factory: factory as Address,
    owner: owner as Address,
    wrappedNative: wrappedNative as Address,
    shareToken: shareToken as Address,
    redemptionExcessRecipient: redemptionExcessRecipient as Address,
    status: Number(status) as BoardroomStatus,
    launched: launched as boolean,
    windDownDelay: windDownDelay as bigint,
    windDownStartedAt: windDownStartedAt as bigint,
    totalShareSupply: totalShareSupply as bigint,
    treasuryShareBalance: treasuryShareBalance as bigint,
    redeemableAssetCount: redeemableAssetCount as bigint,
    snapshotAssetCount: snapshot[0],
    snapshotCursor: snapshot[1],
    snapshotFrozen: snapshot[2],
    redemptionSupply: redemption[0],
    redemptionSupplyFrozen: redemption[1],
    openEscrowCount: openEscrowCount as bigint,
    liquidityMutationAllowed: liquidityMutationAllowed as boolean,
    lockedLiquidityExitAllowed: lockedLiquidityExitAllowed as boolean,
  };
}

export async function predictGrantAddress(
  client: PledgeCashReadClient,
  input: { factory: Address; issuer: Address; salt: `0x${string}` },
): Promise<Address> {
  return await client.readContract({
    address: input.factory,
    abi: tokenGrantFactoryAbi,
    functionName: "predictGrantAddress",
    args: [input.issuer, input.salt],
  }) as Address;
}

export async function predictBoardroomAddress(
  client: PledgeCashReadClient,
  input: { factory: Address; owner: Address; name: string; symbol: string; salt: `0x${string}` },
): Promise<Address> {
  return await client.readContract({
    address: input.factory,
    abi: boardroomFactoryAbi,
    functionName: "predictBoardroomAddress",
    args: [input.owner, input.name, input.symbol, input.salt],
  }) as Address;
}

export async function readLiquidityLockerForBoardroom(
  client: PledgeCashReadClient,
  input: { factory: Address; boardroom: Address },
): Promise<Address> {
  return await client.readContract({
    address: input.factory,
    abi: liquidityLockerFactoryAbi,
    functionName: "lockerOfBoardroom",
    args: [input.boardroom],
  }) as Address;
}

export async function readLiquidityLockerState(
  client: PledgeCashReadClient,
  locker: Address,
): Promise<LiquidityLockerState> {
  const [
    boardroom,
    shareToken,
    quoteAsset,
    currency0,
    currency1,
    protocolFeeRouter,
    positionManager,
    poolFee,
    tickSpacing,
    tokenId,
    pendingTokenId,
    positionRegistered,
    transferPrepared,
    closed,
  ] = await Promise.all([
    client.readContract({ address: locker, abi: liquidityLockerAbi, functionName: "boardroom" }),
    client.readContract({ address: locker, abi: liquidityLockerAbi, functionName: "shareToken" }),
    client.readContract({ address: locker, abi: liquidityLockerAbi, functionName: "quoteAsset" }),
    client.readContract({ address: locker, abi: liquidityLockerAbi, functionName: "currency0" }),
    client.readContract({ address: locker, abi: liquidityLockerAbi, functionName: "currency1" }),
    client.readContract({ address: locker, abi: liquidityLockerAbi, functionName: "protocolFeeRouter" }),
    client.readContract({ address: locker, abi: liquidityLockerAbi, functionName: "positionManager" }),
    client.readContract({ address: locker, abi: liquidityLockerAbi, functionName: "poolFee" }),
    client.readContract({ address: locker, abi: liquidityLockerAbi, functionName: "tickSpacing" }),
    client.readContract({ address: locker, abi: liquidityLockerAbi, functionName: "tokenId" }),
    client.readContract({ address: locker, abi: liquidityLockerAbi, functionName: "pendingTokenId" }),
    client.readContract({ address: locker, abi: liquidityLockerAbi, functionName: "positionRegistered" }),
    client.readContract({ address: locker, abi: liquidityLockerAbi, functionName: "transferPrepared" }),
    client.readContract({ address: locker, abi: liquidityLockerAbi, functionName: "isClosed" }),
  ]);
  const state: LiquidityLockerState = {
    address: locker,
    boardroom: boardroom as Address,
    shareToken: shareToken as Address,
    quoteAsset: quoteAsset as Address,
    currency0: currency0 as Address,
    currency1: currency1 as Address,
    protocolFeeRouter: protocolFeeRouter as Address,
    positionManager: positionManager as Address,
    poolFee: Number(poolFee),
    tickSpacing: Number(tickSpacing),
    tokenId: tokenId as bigint,
    pendingTokenId: pendingTokenId as bigint,
    positionRegistered: positionRegistered as boolean,
    transferPrepared: transferPrepared as boolean,
    closed: closed as boolean,
  };
  if (state.positionRegistered) {
    const [position, positionLiquidity] = await Promise.all([
      client.readContract({
        address: state.positionManager,
        abi: positionManagerAbi,
        functionName: "getPoolAndPositionInfo",
        args: [state.tokenId],
      }),
      client.readContract({
        address: state.positionManager,
        abi: positionManagerAbi,
        functionName: "getPositionLiquidity",
        args: [state.tokenId],
      }),
    ]);
    state.positionInfo = position[1];
    state.positionLiquidity = positionLiquidity;
  }
  return state;
}

/**
 * Returns the locker's immutable hookless PoolKey. Use `Pool.getPoolId` from
 * `@uniswap/v4-sdk` when a StateView pool identifier is needed.
 */
export function liquidityLockerPoolKey(
  state: Pick<LiquidityLockerState, "currency0" | "currency1" | "poolFee" | "tickSpacing">,
): UniswapV4PoolKey {
  return {
    currency0: state.currency0,
    currency1: state.currency1,
    fee: state.poolFee,
    tickSpacing: state.tickSpacing,
    hooks: ZERO_ADDRESS,
  };
}
