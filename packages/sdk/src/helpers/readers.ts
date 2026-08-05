import type { Address, Hex } from "viem";
import {
  boardroomAbi,
  boardroomControllerAbi,
  boardroomControllerFactoryAbi,
  boardroomFactoryAbi,
  boardroomTokenAbi,
  erc20Abi,
  pledgeV4LiquidityFactoryAbi,
  pledgeV4LiquidityVaultAbi,
  tokenGrantAbi,
  tokenGrantFactoryAbi,
} from "../generated";
import type {
  BoardroomControllerState,
  BoardroomState,
  FactoryState,
  GrantSettlementQuote,
  GrantState,
  ProtocolLiquidityVaultState,
  PledgeCashBlockReadClient,
  PledgeCashReadClient,
} from "./types";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const satisfies Address;

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
  const settlementCost = (await client.readContract({
    address: grant,
    abi: tokenGrantAbi,
    functionName: "getSettlementCost",
    args: [amount],
  })) as bigint;

  if (state.paymentToken === ZERO_ADDRESS) {
    return { state, holder: state.holder, amount, settlementCost };
  }

  const [paymentBalance, paymentAllowance] = await Promise.all([
    client.readContract({
      address: state.paymentToken,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [state.holder],
    }),
    client.readContract({
      address: state.paymentToken,
      abi: erc20Abi,
      functionName: "allowance",
      args: [state.holder, grant],
    }),
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
    owner,
    policyRegistry,
    wrappedNative,
    shareToken,
    rewardPool,
    redemptionExcessRecipient,
    status,
    launched,
    controller,
    controllerGeneration,
    governanceEpoch,
    facetSetHash,
    appliedStorageVersion,
    appliedStorageLayoutHash,
    migrationRequired,
    windDownDelay,
    windDownStartedAt,
    protectionStaker,
    redeemableAssetCount,
    snapshotProgress,
    redemptionSupplyState,
    activeObligationCount,
    activeGrantCount,
    activeDistributionCount,
    activeLiquidityCount,
    activeRewardCount,
    primaryMarketMode,
    bondingCurve,
    primaryMarketQuoteAsset,
    liquidityStatus,
    liquidityVault,
    liquidityPoolId,
    liquidityQuoteAsset,
  ] =
    await Promise.all([
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "owner" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "policyRegistry" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "wrappedNative" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "shareToken" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "rewardPool" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "redemptionExcessRecipient" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "status" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "launched" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "controller" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "controllerGeneration" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "governanceEpoch" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "facetSetHash" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "appliedStorageVersion" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "appliedStorageLayoutHash" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "migrationRequired" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "windDownDelay" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "windDownStartedAt" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "protectionStaker" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "redeemableAssetCount" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "assetSnapshotProgress" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "redemptionSupplyState" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "activeObligationCount" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "activeObligationCountByKind", args: [1] }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "activeObligationCountByKind", args: [2] }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "activeObligationCountByKind", args: [3] }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "activeObligationCountByKind", args: [4] }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "primaryMarketMode" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "bondingCurve" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "primaryMarketQuoteAsset" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "liquidityStatus" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "liquidityVault" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "liquidityPoolId" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "liquidityQuoteAsset" }),
    ]);
  const [governanceEligibleSupply, controllerState] = await Promise.all([
    client.readContract({
      address: shareToken as Address,
      abi: boardroomTokenAbi,
      functionName: "governanceEligibleSupply",
    }),
    launched && (controller as Address).toLowerCase() !== ZERO_ADDRESS
      ? readBoardroomControllerState(rawClient, controller as Address, blockNumber)
      : Promise.resolve(undefined),
  ]);

  return {
    address: boardroom,
    blockNumber,
    owner: owner as Address,
    policyRegistry: policyRegistry as Address,
    wrappedNative: wrappedNative as Address,
    shareToken: shareToken as Address,
    rewardPool: rewardPool as Address,
    redemptionExcessRecipient: redemptionExcessRecipient as Address,
    status: Number(status),
    launched: launched as boolean,
    controller: controller as Address,
    proposer: controllerState?.proposer ?? ZERO_ADDRESS,
    controllerDelay: controllerState?.delay ?? 0n,
    controllerGracePeriod: controllerState?.gracePeriod ?? 0n,
    controllerGeneration: controllerGeneration as bigint,
    controllerConfigurationEpoch: controllerState?.configurationEpoch ?? 0n,
    governanceEpoch: governanceEpoch as bigint,
    facetSetHash: facetSetHash as Hex,
    appliedStorageVersion: appliedStorageVersion as bigint,
    appliedStorageLayoutHash: appliedStorageLayoutHash as Hex,
    migrationRequired: migrationRequired as boolean,
    windDownDelay: windDownDelay as bigint,
    windDownStartedAt: windDownStartedAt as bigint,
    protectionStaker: protectionStaker as Address,
    governanceEligibleSupply: governanceEligibleSupply as bigint,
    redeemableAssetCount: redeemableAssetCount as bigint,
    snapshotAssetCount: (snapshotProgress as readonly [bigint, bigint, boolean])[0],
    snapshotCursor: (snapshotProgress as readonly [bigint, bigint, boolean])[1],
    snapshotFrozen: (snapshotProgress as readonly [bigint, bigint, boolean])[2],
    redemptionSupply: (redemptionSupplyState as readonly [bigint, boolean])[0],
    redemptionSupplyFrozen: (redemptionSupplyState as readonly [bigint, boolean])[1],
    activeObligationCount: activeObligationCount as bigint,
    activeGrantCount: activeGrantCount as bigint,
    activeDistributionCount: activeDistributionCount as bigint,
    activeLiquidityCount: activeLiquidityCount as bigint,
    activeRewardCount: activeRewardCount as bigint,
    primaryMarketMode: Number(primaryMarketMode),
    bondingCurve: bondingCurve as Address,
    primaryMarketQuoteAsset: primaryMarketQuoteAsset as Address,
    liquidityStatus: Number(liquidityStatus),
    liquidityVault: liquidityVault as Address,
    liquidityPoolId: liquidityPoolId as Hex,
    liquidityQuoteAsset: liquidityQuoteAsset as Address,
  };
}

export async function readBoardroomControllerState(
  rawClient: PledgeCashBlockReadClient,
  controller: Address,
  atBlockNumber?: bigint,
): Promise<BoardroomControllerState> {
  const blockNumber = atBlockNumber ?? await rawClient.getBlockNumber();
  const client = {
    readContract(request: Parameters<PledgeCashReadClient["readContract"]>[0]) {
      return rawClient.readContract({ ...request, blockNumber } as never);
    },
  } as PledgeCashReadClient;
  const [factory, boardroom, proposer, delay, gracePeriod, generation, configurationEpoch, configurationHash] =
    await Promise.all([
      client.readContract({ address: controller, abi: boardroomControllerAbi, functionName: "factory" }),
      client.readContract({ address: controller, abi: boardroomControllerAbi, functionName: "boardroom" }),
      client.readContract({ address: controller, abi: boardroomControllerAbi, functionName: "proposer" }),
      client.readContract({ address: controller, abi: boardroomControllerAbi, functionName: "delay" }),
      client.readContract({ address: controller, abi: boardroomControllerAbi, functionName: "gracePeriod" }),
      client.readContract({ address: controller, abi: boardroomControllerAbi, functionName: "generation" }),
      client.readContract({ address: controller, abi: boardroomControllerAbi, functionName: "configurationEpoch" }),
      client.readContract({ address: controller, abi: boardroomControllerAbi, functionName: "configurationHash" }),
    ]);
  return {
    address: controller,
    factory: factory as Address,
    boardroom: boardroom as Address,
    proposer: proposer as Address,
    delay: delay as bigint,
    gracePeriod: gracePeriod as bigint,
    generation: generation as bigint,
    configurationEpoch: configurationEpoch as bigint,
    configurationHash: configurationHash as Hex,
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

export async function predictBoardroomControllerAddress(
  client: PledgeCashReadClient,
  input: { controllerFactory: Address; boardroom: Address; generation: bigint },
): Promise<Address> {
  return (await client.readContract({
    address: input.controllerFactory,
    abi: boardroomControllerFactoryAbi,
    functionName: "predictControllerAddress",
    args: [input.boardroom, input.generation],
  })) as Address;
}

export async function readProtocolLiquidityPoolId(
  client: PledgeCashReadClient,
  input: { factory: Address; tokenA: Address; tokenB: Address },
): Promise<Hex> {
  return (await client.readContract({
    address: input.factory,
    abi: pledgeV4LiquidityFactoryAbi,
    functionName: "poolIdFor",
    args: [input.tokenA, input.tokenB],
  })) as Hex;
}

export async function predictProtocolLiquidityVaultAddress(
  client: PledgeCashReadClient,
  input: { factory: Address; boardroom: Address; salt: Hex },
): Promise<Address> {
  return (await client.readContract({
    address: input.factory,
    abi: pledgeV4LiquidityFactoryAbi,
    functionName: "predictLiquidityVaultAddress",
    args: [input.boardroom, input.salt],
  })) as Address;
}

export async function readProtocolLiquidityVaultState(
  client: PledgeCashReadClient,
  vault: Address,
): Promise<ProtocolLiquidityVaultState> {
  const [
    factory,
    boardroom,
    poolManager,
    protocolFeeRecipient,
    tokenA,
    tokenB,
    currency0,
    currency1,
    hook,
    poolId,
    positionSalt,
    tickLower,
    tickUpper,
    poolFee,
    tickSpacing,
    liquidityState,
    positionLiquidity,
    totalSupply,
  ] = await Promise.all([
    client.readContract({ address: vault, abi: pledgeV4LiquidityVaultAbi, functionName: "factory" }),
    client.readContract({ address: vault, abi: pledgeV4LiquidityVaultAbi, functionName: "boardroom" }),
    client.readContract({ address: vault, abi: pledgeV4LiquidityVaultAbi, functionName: "poolManager" }),
    client.readContract({ address: vault, abi: pledgeV4LiquidityVaultAbi, functionName: "protocolFeeRecipient" }),
    client.readContract({ address: vault, abi: pledgeV4LiquidityVaultAbi, functionName: "tokenA" }),
    client.readContract({ address: vault, abi: pledgeV4LiquidityVaultAbi, functionName: "tokenB" }),
    client.readContract({ address: vault, abi: pledgeV4LiquidityVaultAbi, functionName: "currency0" }),
    client.readContract({ address: vault, abi: pledgeV4LiquidityVaultAbi, functionName: "currency1" }),
    client.readContract({ address: vault, abi: pledgeV4LiquidityVaultAbi, functionName: "hook" }),
    client.readContract({ address: vault, abi: pledgeV4LiquidityVaultAbi, functionName: "poolId" }),
    client.readContract({ address: vault, abi: pledgeV4LiquidityVaultAbi, functionName: "positionSalt" }),
    client.readContract({ address: vault, abi: pledgeV4LiquidityVaultAbi, functionName: "tickLower" }),
    client.readContract({ address: vault, abi: pledgeV4LiquidityVaultAbi, functionName: "tickUpper" }),
    client.readContract({ address: vault, abi: pledgeV4LiquidityVaultAbi, functionName: "poolFee" }),
    client.readContract({ address: vault, abi: pledgeV4LiquidityVaultAbi, functionName: "tickSpacing" }),
    client.readContract({ address: vault, abi: pledgeV4LiquidityVaultAbi, functionName: "liquidityState" }),
    client.readContract({ address: vault, abi: pledgeV4LiquidityVaultAbi, functionName: "positionLiquidity" }),
    client.readContract({ address: vault, abi: pledgeV4LiquidityVaultAbi, functionName: "totalSupply" }),
  ]);

  return {
    address: vault,
    factory: factory as Address,
    boardroom: boardroom as Address,
    poolManager: poolManager as Address,
    protocolFeeRecipient: protocolFeeRecipient as Address,
    tokenA: tokenA as Address,
    tokenB: tokenB as Address,
    currency0: currency0 as Address,
    currency1: currency1 as Address,
    hook: hook as Address,
    poolId: poolId as Hex,
    positionSalt: positionSalt as Hex,
    tickLower: Number(tickLower),
    tickUpper: Number(tickUpper),
    poolFee: Number(poolFee),
    tickSpacing: Number(tickSpacing),
    liquidityState: Number(liquidityState),
    positionLiquidity: positionLiquidity as bigint,
    totalSupply: totalSupply as bigint,
  };
}
