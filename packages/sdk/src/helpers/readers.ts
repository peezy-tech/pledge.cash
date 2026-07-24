import type { Address, Hex } from "viem";
import {
  ammFactoryAbi,
  boardroomAbi,
  boardroomControllerAbi,
  boardroomControllerFactoryAbi,
  boardroomFactoryAbi,
  boardroomRewardsAbi,
  boardroomTokenAbi,
  bondMarketAbi,
  bondMarketFactoryAbi,
  distributionFactoryAbi,
  dutchAuctionSaleAbi,
  erc20Abi,
  fixedPriceSaleAbi,
  lockedLiquidityAbi,
  lockedLiquidityFactoryAbi,
  merkleAirdropAbi,
  migratingBondingCurveAbi,
  tokenGrantAbi,
  tokenGrantFactoryAbi,
} from "../generated";
import type {
  BoardroomControllerState,
  BoardroomStakerPower,
  BoardroomRewardsAccountState,
  BoardroomRewardsState,
  BoardroomState,
  BondMarketState,
  BondPositionState,
  BondPurchaseQuote,
  FactoryState,
  FixedPriceSaleParticipationQuote,
  FixedPriceSaleState,
  DutchAuctionParticipationQuote,
  DutchAuctionState,
  GrantSettlementQuote,
  GrantState,
  LockedLiquidityState,
  MerkleAirdropClaimState,
  MerkleAirdropState,
  MigratingBondingCurveBuyQuote,
  MigratingBondingCurveSellQuote,
  MigratingBondingCurveState,
  PledgeCashBlockReadClient,
  PledgeCashReadClient,
} from "./types";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const satisfies Address;
const BPS_DENOMINATOR = 10_000n;
const VETO_BPS = 100n;
const WIND_DOWN_BPS = 1_000n;

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

export async function readBoardroomState(client: PledgeCashReadClient, boardroom: Address): Promise<BoardroomState> {
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
    liquidityLocker,
    liquidityPool,
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
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "liquidityLocker" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "liquidityPool" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "liquidityQuoteAsset" }),
    ]);
  const [governanceEligibleSupply, controllerState] = await Promise.all([
    client.readContract({
      address: shareToken as Address,
      abi: boardroomTokenAbi,
      functionName: "governanceEligibleSupply",
    }),
    launched && (controller as Address).toLowerCase() !== ZERO_ADDRESS
      ? readBoardroomControllerState(client, controller as Address)
      : Promise.resolve(undefined),
  ]);

  return {
    address: boardroom,
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
    liquidityLocker: liquidityLocker as Address,
    liquidityPool: liquidityPool as Address,
    liquidityQuoteAsset: liquidityQuoteAsset as Address,
  };
}

export async function readBoardroomControllerState(
  client: PledgeCashReadClient,
  controller: Address,
): Promise<BoardroomControllerState> {
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

export function governanceStakerPowerThreshold(
  currentEligibleSupply: bigint,
  pastEligibleSupply: bigint,
  thresholdBps: bigint,
): bigint {
  const currentRequired = ceilMulDiv(currentEligibleSupply, thresholdBps, BPS_DENOMINATOR);
  const pastRequired = ceilMulDiv(pastEligibleSupply, thresholdBps, BPS_DENOMINATOR);
  return currentRequired > pastRequired ? currentRequired : pastRequired;
}

export async function readBoardroomStakerPower(
  client: PledgeCashBlockReadClient,
  input: { boardroom: Address; account: Address },
): Promise<BoardroomStakerPower> {
  const [blockNumber, shareToken, rewardPool] = await Promise.all([
    client.getBlockNumber(),
    client.readContract({ address: input.boardroom, abi: boardroomAbi, functionName: "shareToken" }),
    client.readContract({ address: input.boardroom, abi: boardroomAbi, functionName: "rewardPool" }),
  ]);
  if (blockNumber === 0n) throw new Error("Staker power requires at least one mined block.");

  const snapshotBlock = blockNumber - 1n;
  const token = shareToken as Address;
  const rewards = rewardPool as Address;
  const [encumbered, currentTokenBalance, currentActiveStake, pastActiveStake, currentEligibleSupply, pastEligibleSupply] = await Promise.all([
    client.readContract({
      address: token,
      abi: boardroomTokenAbi,
      functionName: "isEncumberedAccount",
      args: [input.account],
      blockNumber,
    }),
    client.readContract({
      address: token,
      abi: boardroomTokenAbi,
      functionName: "balanceOf",
      args: [input.account],
      blockNumber,
    }),
    rewards === ZERO_ADDRESS
      ? Promise.resolve(0n)
      : client.readContract({
          address: rewards,
          abi: boardroomRewardsAbi,
          functionName: "activeStakeOf",
          args: [input.account],
          blockNumber,
        }),
    rewards === ZERO_ADDRESS
      ? Promise.resolve(0n)
      : client.readContract({
          address: rewards,
          abi: boardroomRewardsAbi,
          functionName: "getPastActiveStake",
          args: [input.account, snapshotBlock],
          blockNumber,
        }),
    client.readContract({
      address: token,
      abi: boardroomTokenAbi,
      functionName: "governanceEligibleSupply",
      blockNumber,
    }),
    client.readContract({
      address: token,
      abi: boardroomTokenAbi,
      functionName: "getPastGovernanceEligibleSupply",
      args: [snapshotBlock],
      blockNumber,
    }),
  ]);
  const currentSupply = currentEligibleSupply as bigint;
  const pastSupply = pastEligibleSupply as bigint;
  const balance = currentActiveStake as bigint;
  const priorBalance = pastActiveStake as bigint;
  const isEncumbered = encumbered as boolean;
  const vetoRequired = governanceStakerPowerThreshold(currentSupply, pastSupply, VETO_BPS);
  const windDownRequired = governanceStakerPowerThreshold(currentSupply, pastSupply, WIND_DOWN_BPS);
  const hasPower = (required: bigint): boolean =>
    !isEncumbered && currentSupply !== 0n && pastSupply !== 0n && balance >= required && priorBalance >= required;

  return {
    boardroom: input.boardroom,
    shareToken: token,
    rewardPool: rewards,
    account: input.account,
    blockNumber,
    snapshotBlock,
    encumbered: isEncumbered,
    currentTokenBalance: currentTokenBalance as bigint,
    currentBalance: balance,
    pastBalance: priorBalance,
    currentActiveStake: balance,
    pastActiveStake: priorBalance,
    currentEligibleSupply: currentSupply,
    pastEligibleSupply: pastSupply,
    vetoRequired,
    windDownRequired,
    canVeto: hasPower(vetoRequired),
    canStartWindDown: hasPower(windDownRequired),
  };
}

/** @deprecated Use governanceStakerPowerThreshold. */
export const governanceHolderPowerThreshold = governanceStakerPowerThreshold;

/** @deprecated Use readBoardroomStakerPower. */
export const readBoardroomHolderPower = readBoardroomStakerPower;

export async function readBoardroomRewardsState(
  client: PledgeCashReadClient,
  rewards: Address,
): Promise<BoardroomRewardsState> {
  const [factory, boardroom, shareToken, cooldown, terminalized, totalActiveStake, rewardAssets] = await Promise.all([
    client.readContract({ address: rewards, abi: boardroomRewardsAbi, functionName: "factory" }),
    client.readContract({ address: rewards, abi: boardroomRewardsAbi, functionName: "boardroom" }),
    client.readContract({ address: rewards, abi: boardroomRewardsAbi, functionName: "shareToken" }),
    client.readContract({ address: rewards, abi: boardroomRewardsAbi, functionName: "cooldown" }),
    client.readContract({ address: rewards, abi: boardroomRewardsAbi, functionName: "terminalized" }),
    client.readContract({ address: rewards, abi: boardroomRewardsAbi, functionName: "totalActiveStake" }),
    client.readContract({ address: rewards, abi: boardroomRewardsAbi, functionName: "getRewardAssets" }),
  ]);
  const assets = rewardAssets as Address[];
  const rewardStates = await Promise.all(
    assets.map(async (asset) => {
      const [periodFinish, lastUpdateTime, rewardRate, rewardPerTokenStored, unallocated] = (await client.readContract({
        address: rewards,
        abi: boardroomRewardsAbi,
        functionName: "rewardState",
        args: [asset],
      })) as readonly [bigint, bigint, bigint, bigint, bigint];
      return { asset, periodFinish, lastUpdateTime, rewardRate, rewardPerTokenStored, unallocated };
    }),
  );

  return {
    address: rewards,
    factory: factory as Address,
    boardroom: boardroom as Address,
    shareToken: shareToken as Address,
    cooldown: cooldown as bigint,
    terminalized: terminalized as boolean,
    totalActiveStake: totalActiveStake as bigint,
    rewardAssets: rewardStates,
  };
}

export async function readBoardroomRewardsAccountState(
  client: PledgeCashReadClient,
  input: { rewards: Address; account: Address },
): Promise<BoardroomRewardsAccountState> {
  const [shareToken, rewardAssets, activeStake, lockedStake, pendingSlots] = await Promise.all([
    client.readContract({ address: input.rewards, abi: boardroomRewardsAbi, functionName: "shareToken" }),
    client.readContract({ address: input.rewards, abi: boardroomRewardsAbi, functionName: "getRewardAssets" }),
    client.readContract({
      address: input.rewards,
      abi: boardroomRewardsAbi,
      functionName: "activeStakeOf",
      args: [input.account],
    }),
    client.readContract({
      address: input.rewards,
      abi: boardroomRewardsAbi,
      functionName: "lockedStakeOf",
      args: [input.account],
    }),
    client.readContract({ address: input.rewards, abi: boardroomRewardsAbi, functionName: "MAX_PENDING_UNSTAKES" }),
  ]);
  const token = shareToken as Address;
  const assets = rewardAssets as Address[];
  const slotCount = Number(pendingSlots as bigint);
  const [transferableBalance, requests, earned] = await Promise.all([
    client.readContract({
      address: token,
      abi: boardroomTokenAbi,
      functionName: "transferableBalanceOf",
      args: [input.account],
    }),
    Promise.all(
      Array.from({ length: slotCount }, async (_, slot) => {
        const [amount, unlockAt] = (await client.readContract({
          address: input.rewards,
          abi: boardroomRewardsAbi,
          functionName: "unstakeRequest",
          args: [input.account, BigInt(slot)],
        })) as readonly [bigint, bigint];
        return { slot, amount, unlockAt };
      }),
    ),
    Promise.all(
      assets.map(async (asset) => ({
        asset,
        amount: (await client.readContract({
          address: input.rewards,
          abi: boardroomRewardsAbi,
          functionName: "earned",
          args: [input.account, asset],
        })) as bigint,
      })),
    ),
  ]);

  return {
    rewards: input.rewards,
    account: input.account,
    activeStake: activeStake as bigint,
    lockedStake: lockedStake as bigint,
    transferableBalance: transferableBalance as bigint,
    pendingUnstakes: requests.filter((request) => request.amount !== 0n),
    earned,
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

export async function predictBondMarketAddress(
  client: PledgeCashReadClient,
  input: { factory: Address; boardroom: Address; salt: Hex },
): Promise<Address> {
  return (await client.readContract({
    address: input.factory,
    abi: bondMarketFactoryAbi,
    functionName: "predictBondMarketAddress",
    args: [input.boardroom, input.salt],
  })) as Address;
}

export async function readBondMarketPageForBoardroom(
  client: PledgeCashReadClient,
  input: { factory: Address; boardroom: Address; cursor: bigint; size: bigint },
): Promise<{ markets: Address[]; nextCursor: bigint }> {
  const [markets, nextCursor] = (await client.readContract({
    address: input.factory,
    abi: bondMarketFactoryAbi,
    functionName: "bondMarketPageForBoardroom",
    args: [input.boardroom, input.cursor, input.size],
  })) as unknown as readonly [Address[], bigint];
  return { markets, nextCursor };
}

export async function readBondMarketState(
  client: PledgeCashReadClient,
  market: Address,
): Promise<BondMarketState> {
  const [
    factory,
    boardroom,
    shareToken,
    quoteToken,
    kind,
    status,
    initialCapacity,
    capacity,
    minimumPrice,
    currentPrice,
    maximumPayout,
    purchased,
    sold,
    outstandingPayout,
    returnedPayout,
    startTime,
    conclusion,
    vestingTerm,
    nextPositionId,
    live,
    closed,
  ] = await Promise.all([
    client.readContract({ address: market, abi: bondMarketAbi, functionName: "factory" }),
    client.readContract({ address: market, abi: bondMarketAbi, functionName: "boardroom" }),
    client.readContract({ address: market, abi: bondMarketAbi, functionName: "shareToken" }),
    client.readContract({ address: market, abi: bondMarketAbi, functionName: "quoteToken" }),
    client.readContract({ address: market, abi: bondMarketAbi, functionName: "marketKind" }),
    client.readContract({ address: market, abi: bondMarketAbi, functionName: "marketStatus" }),
    client.readContract({ address: market, abi: bondMarketAbi, functionName: "initialCapacity" }),
    client.readContract({ address: market, abi: bondMarketAbi, functionName: "capacity" }),
    client.readContract({ address: market, abi: bondMarketAbi, functionName: "minimumPrice" }),
    client.readContract({ address: market, abi: bondMarketAbi, functionName: "marketPrice" }),
    client.readContract({ address: market, abi: bondMarketAbi, functionName: "maxPayout" }),
    client.readContract({ address: market, abi: bondMarketAbi, functionName: "purchased" }),
    client.readContract({ address: market, abi: bondMarketAbi, functionName: "sold" }),
    client.readContract({ address: market, abi: bondMarketAbi, functionName: "outstandingPayout" }),
    client.readContract({ address: market, abi: bondMarketAbi, functionName: "returnedPayout" }),
    client.readContract({ address: market, abi: bondMarketAbi, functionName: "startTime" }),
    client.readContract({ address: market, abi: bondMarketAbi, functionName: "conclusion" }),
    client.readContract({ address: market, abi: bondMarketAbi, functionName: "vestingTerm" }),
    client.readContract({ address: market, abi: bondMarketAbi, functionName: "nextPositionId" }),
    client.readContract({ address: market, abi: bondMarketAbi, functionName: "isLive" }),
    client.readContract({ address: market, abi: bondMarketAbi, functionName: "isClosed" }),
  ]);

  return {
    address: market,
    factory: factory as Address,
    boardroom: boardroom as Address,
    shareToken: shareToken as Address,
    quoteToken: quoteToken as Address,
    kind: Number(kind),
    status: Number(status),
    initialCapacity: initialCapacity as bigint,
    capacity: capacity as bigint,
    minimumPrice: minimumPrice as bigint,
    currentPrice: currentPrice as bigint,
    maximumPayout: maximumPayout as bigint,
    purchased: purchased as bigint,
    sold: sold as bigint,
    outstandingPayout: outstandingPayout as bigint,
    returnedPayout: returnedPayout as bigint,
    startTime: Number(startTime),
    conclusion: Number(conclusion),
    vestingTerm: Number(vestingTerm),
    nextPositionId: nextPositionId as bigint,
    live: live as boolean,
    closed: closed as boolean,
  };
}

export async function readBondPosition(
  client: PledgeCashReadClient,
  input: { market: Address; positionId: bigint },
): Promise<BondPositionState> {
  const [owner, payout, maturity, redeemed] = (await client.readContract({
    address: input.market,
    abi: bondMarketAbi,
    functionName: "positions",
    args: [input.positionId],
  })) as readonly [Address, bigint, number, boolean];
  return { market: input.market, positionId: input.positionId, owner, payout, maturity, redeemed };
}

export async function readBondPositionsForOwner(
  client: PledgeCashReadClient,
  input: { market: Address; owner: Address; limit?: number },
): Promise<BondPositionState[]> {
  const rawCount = await client.readContract({
    address: input.market,
    abi: bondMarketAbi,
    functionName: "positionCountFor",
    args: [input.owner],
  });
  const count = Number(rawCount);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("Bond position count is invalid.");
  const limit = Math.max(0, Math.min(input.limit ?? 64, 64));
  const start = Math.max(0, count - limit);
  const positionIds = await Promise.all(
    Array.from({ length: count - start }, (_, offset) => start + offset).map(async (index) =>
      await client.readContract({
        address: input.market,
        abi: bondMarketAbi,
        functionName: "positionForOwnerAt",
        args: [input.owner, BigInt(index)],
      }) as bigint
    ),
  );
  return await Promise.all(positionIds.map(async (positionId) =>
    await readBondPosition(client, { market: input.market, positionId })
  ));
}

export async function readBondPurchaseQuote(
  client: PledgeCashReadClient,
  input: { market: Address; buyer: Address; quoteAmount: bigint },
): Promise<BondPurchaseQuote> {
  const state = await readBondMarketState(client, input.market);
  const [payout, quoteBalance, quoteAllowance] = await Promise.all([
    client.readContract({
      address: input.market,
      abi: bondMarketAbi,
      functionName: "payoutFor",
      args: [input.quoteAmount],
    }),
    client.readContract({
      address: state.quoteToken,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [input.buyer],
    }),
    client.readContract({
      address: state.quoteToken,
      abi: erc20Abi,
      functionName: "allowance",
      args: [input.buyer, input.market],
    }),
  ]);
  return {
    state,
    buyer: input.buyer,
    quoteAmount: input.quoteAmount,
    payout: payout as bigint,
    quoteBalance: quoteBalance as bigint,
    quoteAllowance: quoteAllowance as bigint,
  };
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

export async function predictDutchAuctionAddress(
  client: PledgeCashReadClient,
  input: { factory: Address; boardroom: Address; salt: Hex },
): Promise<Address> {
  return (await client.readContract({
    address: input.factory,
    abi: distributionFactoryAbi,
    functionName: "predictDutchAuctionAddress",
    args: [input.boardroom, input.salt],
  })) as Address;
}

export async function predictMerkleAirdropAddress(
  client: PledgeCashReadClient,
  input: { factory: Address; boardroom: Address; salt: Hex },
): Promise<Address> {
  return (await client.readContract({
    address: input.factory,
    abi: distributionFactoryAbi,
    functionName: "predictMerkleAirdropAddress",
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

export async function readFixedPriceSaleParticipationQuote(
  client: PledgeCashReadClient,
  input: { sale: Address; buyer: Address; shareAmount: bigint },
): Promise<FixedPriceSaleParticipationQuote> {
  const state = await readFixedPriceSaleState(client, input.sale);
  const [paymentAmount, purchasedBy, paymentBalance, paymentAllowance] = await Promise.all([
    client.readContract({
      address: input.sale,
      abi: fixedPriceSaleAbi,
      functionName: "getPaymentAmount",
      args: [input.shareAmount],
    }),
    client.readContract({
      address: input.sale,
      abi: fixedPriceSaleAbi,
      functionName: "purchasedBy",
      args: [input.buyer],
    }),
    client.readContract({
      address: state.paymentToken,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [input.buyer],
    }),
    client.readContract({
      address: state.paymentToken,
      abi: erc20Abi,
      functionName: "allowance",
      args: [input.buyer, input.sale],
    }),
  ]);
  const purchased = purchasedBy as bigint;
  const buyerCapacity = state.maxPerBuyer === 0n
    ? state.remainingShares
    : minBigInt(state.remainingShares, saturatingSub(state.maxPerBuyer, purchased));

  return {
    state,
    buyer: input.buyer,
    shareAmount: input.shareAmount,
    paymentAmount: paymentAmount as bigint,
    purchasedBy: purchased,
    remainingBuyerCapacity: buyerCapacity,
    paymentBalance: paymentBalance as bigint,
    paymentAllowance: paymentAllowance as bigint,
  };
}

export async function readDutchAuctionState(
  client: PledgeCashReadClient,
  auction: Address,
): Promise<DutchAuctionState> {
  const [
    factory,
    boardroom,
    shareToken,
    paymentToken,
    saleSupply,
    remainingShares,
    startPrice,
    floorPrice,
    currentPrice,
    maxPerBuyer,
    totalPayment,
    soldShares,
    lastPurchasePrice,
    settlementPrice,
    startTime,
    endTime,
    saleStatus,
    closed,
  ] = await Promise.all([
    client.readContract({ address: auction, abi: dutchAuctionSaleAbi, functionName: "factory" }),
    client.readContract({ address: auction, abi: dutchAuctionSaleAbi, functionName: "boardroom" }),
    client.readContract({ address: auction, abi: dutchAuctionSaleAbi, functionName: "shareToken" }),
    client.readContract({ address: auction, abi: dutchAuctionSaleAbi, functionName: "paymentToken" }),
    client.readContract({ address: auction, abi: dutchAuctionSaleAbi, functionName: "saleSupply" }),
    client.readContract({ address: auction, abi: dutchAuctionSaleAbi, functionName: "remainingShares" }),
    client.readContract({ address: auction, abi: dutchAuctionSaleAbi, functionName: "startPrice" }),
    client.readContract({ address: auction, abi: dutchAuctionSaleAbi, functionName: "floorPrice" }),
    client.readContract({ address: auction, abi: dutchAuctionSaleAbi, functionName: "currentPrice" }),
    client.readContract({ address: auction, abi: dutchAuctionSaleAbi, functionName: "maxPerBuyer" }),
    client.readContract({ address: auction, abi: dutchAuctionSaleAbi, functionName: "totalPayment" }),
    client.readContract({ address: auction, abi: dutchAuctionSaleAbi, functionName: "soldShares" }),
    client.readContract({ address: auction, abi: dutchAuctionSaleAbi, functionName: "lastPurchasePrice" }),
    client.readContract({ address: auction, abi: dutchAuctionSaleAbi, functionName: "settlementPrice" }),
    client.readContract({ address: auction, abi: dutchAuctionSaleAbi, functionName: "startTime" }),
    client.readContract({ address: auction, abi: dutchAuctionSaleAbi, functionName: "endTime" }),
    client.readContract({ address: auction, abi: dutchAuctionSaleAbi, functionName: "saleStatus" }),
    client.readContract({ address: auction, abi: dutchAuctionSaleAbi, functionName: "isClosed" }),
  ]);

  return {
    address: auction,
    factory: factory as Address,
    boardroom: boardroom as Address,
    shareToken: shareToken as Address,
    paymentToken: paymentToken as Address,
    saleSupply: saleSupply as bigint,
    remainingShares: remainingShares as bigint,
    startPrice: startPrice as bigint,
    floorPrice: floorPrice as bigint,
    currentPrice: currentPrice as bigint,
    maxPerBuyer: maxPerBuyer as bigint,
    totalPayment: totalPayment as bigint,
    soldShares: soldShares as bigint,
    lastPurchasePrice: lastPurchasePrice as bigint,
    settlementPrice: settlementPrice as bigint,
    startTime: startTime as bigint,
    endTime: endTime as bigint,
    saleStatus: Number(saleStatus),
    closed: closed as boolean,
  };
}

export async function readDutchAuctionParticipationQuote(
  client: PledgeCashReadClient,
  input: { auction: Address; buyer: Address; shareAmount: bigint },
): Promise<DutchAuctionParticipationQuote> {
  const state = await readDutchAuctionState(client, input.auction);
  const [paymentAmount, purchasedBy, paymentBalance, paymentAllowance] = await Promise.all([
    client.readContract({
      address: input.auction,
      abi: dutchAuctionSaleAbi,
      functionName: "getPaymentAmount",
      args: [input.shareAmount],
    }),
    client.readContract({
      address: input.auction,
      abi: dutchAuctionSaleAbi,
      functionName: "purchasedBy",
      args: [input.buyer],
    }),
    client.readContract({
      address: state.paymentToken,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [input.buyer],
    }),
    client.readContract({
      address: state.paymentToken,
      abi: erc20Abi,
      functionName: "allowance",
      args: [input.buyer, input.auction],
    }),
  ]);
  const purchased = purchasedBy as bigint;
  const buyerCapacity = state.maxPerBuyer === 0n
    ? state.remainingShares
    : minBigInt(state.remainingShares, saturatingSub(state.maxPerBuyer, purchased));

  return {
    state,
    buyer: input.buyer,
    shareAmount: input.shareAmount,
    paymentAmount: paymentAmount as bigint,
    purchasedBy: purchased,
    remainingBuyerCapacity: buyerCapacity,
    paymentBalance: paymentBalance as bigint,
    paymentAllowance: paymentAllowance as bigint,
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
    outstandingCurveShareLiability,
    basePrice,
    slope,
    graduationQuoteTarget,
    quoteToLpBps,
    startTime,
    endTime,
    phaseEndsAt,
    quarantineStartedAt,
    forfeitureEligibleAt,
    forfeitureWindowEndsAt,
    migrationSalt,
    curveStatus,
    settlementReason,
    postQuarantinePhase,
    soldShares,
    quoteReserve,
    migrationAmounts,
    terminalCurvePrice,
    graduationLatched,
    migrationReservationHeld,
    quoteQuarantined,
    forfeitureFinalized,
    unrecoveredQuote,
    forfeitedQuote,
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
    client.readContract({
      address: curve,
      abi: migratingBondingCurveAbi,
      functionName: "outstandingCurveShareLiability",
    }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "basePrice" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "slope" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "graduationQuoteTarget" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "quoteToLpBps" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "startTime" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "endTime" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "phaseEndsAt" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "quarantineStartedAt" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "forfeitureEligibleAt" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "forfeitureWindowEndsAt" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "migrationSalt" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "curveStatus" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "settlementReason" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "postQuarantinePhase" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "soldShares" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "quoteReserve" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "migrationAmounts" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "terminalCurvePrice" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "graduationLatched" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "migrationReservationHeld" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "quoteQuarantined" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "forfeitureFinalized" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "unrecoveredQuote" }),
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "forfeitedQuote" }),
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
    outstandingCurveShareLiability: outstandingCurveShareLiability as bigint,
    basePrice: basePrice as bigint,
    slope: slope as bigint,
    graduationQuoteTarget: graduationQuoteTarget as bigint,
    quoteToLpBps: Number(quoteToLpBps),
    startTime: startTime as bigint,
    endTime: endTime as bigint,
    phaseEndsAt: phaseEndsAt as bigint,
    quarantineStartedAt: quarantineStartedAt as bigint,
    forfeitureEligibleAt: forfeitureEligibleAt as bigint,
    forfeitureWindowEndsAt: forfeitureWindowEndsAt as bigint,
    migrationSalt: migrationSalt as Hex,
    curveStatus: Number(curveStatus),
    settlementReason: Number(settlementReason),
    postQuarantinePhase: Number(postQuarantinePhase),
    soldShares: soldShares as bigint,
    quoteReserve: quoteReserve as bigint,
    terminalCurvePrice: terminalCurvePrice as bigint,
    migrationShares: (migrationAmounts as readonly [bigint, bigint])[0],
    migrationQuote: (migrationAmounts as readonly [bigint, bigint])[1],
    graduationLatched: graduationLatched as boolean,
    migrationReservationHeld: migrationReservationHeld as boolean,
    quoteQuarantined: quoteQuarantined as boolean,
    forfeitureFinalized: forfeitureFinalized as boolean,
    unrecoveredQuote: unrecoveredQuote as bigint,
    forfeitedQuote: forfeitedQuote as bigint,
    canMigrate: canMigrate as boolean,
    closed: closed as boolean,
  };
}

export async function readMigratingBondingCurveBuyQuote(
  client: PledgeCashReadClient,
  input: { curve: Address; buyer: Address; shareAmount: bigint },
): Promise<MigratingBondingCurveBuyQuote> {
  const state = await readMigratingBondingCurveState(client, input.curve);
  const [quoteIn, quoteBalance, quoteAllowance] = await Promise.all([
    client.readContract({
      address: input.curve,
      abi: migratingBondingCurveAbi,
      functionName: "getBuyQuote",
      args: [input.shareAmount],
    }),
    client.readContract({
      address: state.quoteToken,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [input.buyer],
    }),
    client.readContract({
      address: state.quoteToken,
      abi: erc20Abi,
      functionName: "allowance",
      args: [input.buyer, input.curve],
    }),
  ]);

  return {
    state,
    buyer: input.buyer,
    shareAmount: input.shareAmount,
    quoteIn: quoteIn as bigint,
    quoteBalance: quoteBalance as bigint,
    quoteAllowance: quoteAllowance as bigint,
  };
}

export async function readMigratingBondingCurveSellQuote(
  client: PledgeCashReadClient,
  input: { curve: Address; seller: Address; shareAmount: bigint },
): Promise<MigratingBondingCurveSellQuote> {
  const state = await readMigratingBondingCurveState(client, input.curve);
  const [quoteOut, sellableShares, shareBalance, shareAllowance] = await Promise.all([
    client.readContract({
      address: input.curve,
      abi: migratingBondingCurveAbi,
      functionName: "getSellQuote",
      args: [input.shareAmount],
    }),
    client.readContract({
      address: input.curve,
      abi: migratingBondingCurveAbi,
      functionName: "sellableShares",
      args: [input.seller],
    }),
    client.readContract({
      address: state.shareToken,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [input.seller],
    }),
    client.readContract({
      address: state.shareToken,
      abi: erc20Abi,
      functionName: "allowance",
      args: [input.seller, input.curve],
    }),
  ]);

  return {
    state,
    seller: input.seller,
    shareAmount: input.shareAmount,
    quoteOut: quoteOut as bigint,
    sellableShares: sellableShares as bigint,
    shareBalance: shareBalance as bigint,
    shareAllowance: shareAllowance as bigint,
  };
}

export async function readMerkleAirdropState(
  client: PledgeCashReadClient,
  airdrop: Address,
): Promise<MerkleAirdropState> {
  const [
    factory,
    boardroom,
    shareToken,
    tokenGrantFactory,
    airdropSupply,
    claimedShares,
    remainingShares,
    merkleRoot,
    startTime,
    endTime,
    maxGrantClaims,
    claimedGrantCount,
    airdropStatus,
    closed,
  ] = await Promise.all([
    client.readContract({ address: airdrop, abi: merkleAirdropAbi, functionName: "factory" }),
    client.readContract({ address: airdrop, abi: merkleAirdropAbi, functionName: "boardroom" }),
    client.readContract({ address: airdrop, abi: merkleAirdropAbi, functionName: "shareToken" }),
    client.readContract({ address: airdrop, abi: merkleAirdropAbi, functionName: "tokenGrantFactory" }),
    client.readContract({ address: airdrop, abi: merkleAirdropAbi, functionName: "airdropSupply" }),
    client.readContract({ address: airdrop, abi: merkleAirdropAbi, functionName: "claimedShares" }),
    client.readContract({ address: airdrop, abi: merkleAirdropAbi, functionName: "remainingShares" }),
    client.readContract({ address: airdrop, abi: merkleAirdropAbi, functionName: "merkleRoot" }),
    client.readContract({ address: airdrop, abi: merkleAirdropAbi, functionName: "startTime" }),
    client.readContract({ address: airdrop, abi: merkleAirdropAbi, functionName: "endTime" }),
    client.readContract({ address: airdrop, abi: merkleAirdropAbi, functionName: "maxGrantClaims" }),
    client.readContract({ address: airdrop, abi: merkleAirdropAbi, functionName: "claimedGrantCount" }),
    client.readContract({ address: airdrop, abi: merkleAirdropAbi, functionName: "airdropStatus" }),
    client.readContract({ address: airdrop, abi: merkleAirdropAbi, functionName: "isClosed" }),
  ]);

  return {
    address: airdrop,
    factory: factory as Address,
    boardroom: boardroom as Address,
    shareToken: shareToken as Address,
    tokenGrantFactory: tokenGrantFactory as Address,
    airdropSupply: airdropSupply as bigint,
    claimedShares: claimedShares as bigint,
    remainingShares: remainingShares as bigint,
    merkleRoot: merkleRoot as Hex,
    startTime: startTime as bigint,
    endTime: endTime as bigint,
    maxGrantClaims: Number(maxGrantClaims),
    claimedGrantCount: Number(claimedGrantCount),
    airdropStatus: Number(airdropStatus),
    closed: closed as boolean,
  };
}

export async function readMerkleAirdropClaimState(
  client: PledgeCashReadClient,
  input: { airdrop: Address; index: bigint },
): Promise<MerkleAirdropClaimState> {
  const claimed = await client.readContract({
    address: input.airdrop,
    abi: merkleAirdropAbi,
    functionName: "isClaimed",
    args: [input.index],
  });
  return { airdrop: input.airdrop, index: input.index, claimed: claimed as boolean };
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
    liquidityState,
    lockedLiquidity,
  ] = await Promise.all([
    client.readContract({ address: locker, abi: lockedLiquidityAbi, functionName: "factory" }),
    client.readContract({ address: locker, abi: lockedLiquidityAbi, functionName: "boardroom" }),
    client.readContract({ address: locker, abi: lockedLiquidityAbi, functionName: "router" }),
    client.readContract({ address: locker, abi: lockedLiquidityAbi, functionName: "tokenA" }),
    client.readContract({ address: locker, abi: lockedLiquidityAbi, functionName: "tokenB" }),
    client.readContract({ address: locker, abi: lockedLiquidityAbi, functionName: "pool" }),
    client.readContract({ address: locker, abi: lockedLiquidityAbi, functionName: "liquidityState" }),
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
    liquidityState: Number(liquidityState),
    lockedLiquidity: lockedLiquidity as bigint,
  };
}

function ceilMulDiv(value: bigint, multiplier: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error("Cannot divide by zero.");
  if (value === 0n || multiplier === 0n) return 0n;
  return (value * multiplier + denominator - 1n) / denominator;
}

function minBigInt(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

function saturatingSub(left: bigint, right: bigint): bigint {
  return left > right ? left - right : 0n;
}
