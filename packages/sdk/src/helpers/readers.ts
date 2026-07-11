import type { Address, Hex } from "viem";
import {
  ammFactoryAbi,
  boardroomAbi,
  boardroomFactoryAbi,
  boardroomTokenAbi,
  distributionFactoryAbi,
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
  BoardroomGovernanceConfig,
  BoardroomHolderPower,
  BoardroomState,
  FactoryState,
  FixedPriceSaleParticipationQuote,
  FixedPriceSaleState,
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
const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000" as const satisfies Hex;
const BPS_DENOMINATOR = 10_000n;

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
    status,
    launched,
    executor,
    governanceDelay,
    governanceConfigResult,
    governanceStateResult,
    redeemableAssets,
    issuedGrants,
    issuedDistributions,
    lockedLiquidityPositions,
  ] =
    await Promise.all([
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "owner" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "policyRegistry" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "wrappedNative" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "shareToken" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "status" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "launched" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "executor" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "governanceDelay" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "governanceConfig" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "governanceState", args: [ZERO_HASH] }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "getRedeemableAssets" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "getIssuedGrants" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "getIssuedDistributions" }),
      client.readContract({ address: boardroom, abi: boardroomAbi, functionName: "getLockedLiquidityPositions" }),
    ]);
  const governanceConfig = boardroomGovernanceConfig(governanceConfigResult);
  const [governanceEpoch] = governanceStateResult as readonly [bigint, bigint, bigint, bigint, number];
  const governanceEligibleSupply = await client.readContract({
    address: shareToken as Address,
    abi: boardroomTokenAbi,
    functionName: "governanceEligibleSupply",
  });

  return {
    address: boardroom,
    owner: owner as Address,
    policyRegistry: policyRegistry as Address,
    wrappedNative: wrappedNative as Address,
    shareToken: shareToken as Address,
    status: Number(status),
    launched: launched as boolean,
    executor: executor as Address,
    governanceDelay: governanceDelay as bigint,
    governanceEpoch,
    governanceEligibleSupply: governanceEligibleSupply as bigint,
    governanceConfig,
    redeemableAssets: redeemableAssets as Address[],
    issuedGrants: issuedGrants as Address[],
    issuedDistributions: issuedDistributions as Address[],
    lockedLiquidityPositions: lockedLiquidityPositions as Address[],
  };
}

export function governanceHolderPowerThreshold(
  currentEligibleSupply: bigint,
  pastEligibleSupply: bigint,
  thresholdBps: bigint,
): bigint {
  const currentRequired = ceilMulDiv(currentEligibleSupply, thresholdBps, BPS_DENOMINATOR);
  const pastRequired = ceilMulDiv(pastEligibleSupply, thresholdBps, BPS_DENOMINATOR);
  return currentRequired > pastRequired ? currentRequired : pastRequired;
}

export async function readBoardroomHolderPower(
  client: PledgeCashBlockReadClient,
  input: { boardroom: Address; account: Address },
): Promise<BoardroomHolderPower> {
  const [blockNumber, shareToken, governanceConfigResult] = await Promise.all([
    client.getBlockNumber(),
    client.readContract({ address: input.boardroom, abi: boardroomAbi, functionName: "shareToken" }),
    client.readContract({ address: input.boardroom, abi: boardroomAbi, functionName: "governanceConfig" }),
  ]);
  if (blockNumber === 0n) throw new Error("Holder power requires at least one mined block.");

  const snapshotBlock = blockNumber - 1n;
  const token = shareToken as Address;
  const config = boardroomGovernanceConfig(governanceConfigResult);
  const [encumbered, currentBalance, pastBalance, currentEligibleSupply, pastEligibleSupply] = await Promise.all([
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
    client.readContract({
      address: token,
      abi: boardroomTokenAbi,
      functionName: "getPastBalance",
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
  const balance = currentBalance as bigint;
  const priorBalance = pastBalance as bigint;
  const isEncumbered = encumbered as boolean;
  const vetoRequired = governanceHolderPowerThreshold(currentSupply, pastSupply, config.vetoBps);
  const windDownRequired = governanceHolderPowerThreshold(currentSupply, pastSupply, config.windDownBps);
  const hasPower = (required: bigint): boolean =>
    !isEncumbered && currentSupply !== 0n && pastSupply !== 0n && balance >= required && priorBalance >= required;

  return {
    boardroom: input.boardroom,
    shareToken: token,
    account: input.account,
    blockNumber,
    snapshotBlock,
    encumbered: isEncumbered,
    currentBalance: balance,
    pastBalance: priorBalance,
    currentEligibleSupply: currentSupply,
    pastEligibleSupply: pastSupply,
    vetoRequired,
    windDownRequired,
    canVeto: hasPower(vetoRequired),
    canStartWindDown: hasPower(windDownRequired),
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
    graduationLatched,
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
    client.readContract({ address: curve, abi: migratingBondingCurveAbi, functionName: "graduationLatched" }),
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
    graduationLatched: graduationLatched as boolean,
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
      functionName: "sellableSharesBy",
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

function boardroomGovernanceConfig(result: unknown): BoardroomGovernanceConfig {
  const [minimumDelay, actionGracePeriod, vetoBps, windDownBps] = result as readonly [bigint, bigint, bigint, bigint];
  return { minimumDelay, actionGracePeriod, vetoBps, windDownBps };
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
