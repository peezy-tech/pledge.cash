import { encodeFunctionData, type Address, type Hex } from "viem";
import {
  boardroomAbi,
  boardroomTokenAbi,
  bondMarketAbi,
  bondMarketFactoryAbi,
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
  BoardroomCall,
  BoardroomFixedPriceSaleTerms,
  BoardroomLockedLiquidityTerms,
  BoardroomMerkleAirdropTerms,
  BoardroomMigratingBondingCurveTerms,
  BoardroomShareGrantTerms,
  BondMarketTerms,
  FixedPriceSaleTerms,
  GrantCreationArgs,
  GrantCreationTerms,
  LockedLiquidityTerms,
  MerkleAirdropGrantClaimTerms,
  MerkleAirdropTerms,
  MigratingBondingCurveTerms,
} from "./types";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const satisfies Address;

function requireAssetPolicy(assetPolicy: Address | undefined): Address {
  if (!assetPolicy) {
    throw new Error("assetPolicy is required for Boardroom approval calls.");
  }
  return assetPolicy;
}

export function grantCreationArgs(terms: GrantCreationTerms): GrantCreationArgs {
  return [
    terms.holder,
    terms.token,
    terms.paymentToken,
    terms.amount,
    terms.price,
    terms.expiry,
    terms.vestingCliff,
    terms.vestingEnd,
    terms.transferable,
    terms.transferUnlockTime,
    terms.salt,
  ] as const;
}

export function buildErc20Approval(input: { token: Address; spender: Address; amount: bigint }) {
  return {
    address: input.token,
    abi: erc20Abi,
    functionName: "approve",
    args: [input.spender, input.amount] as const,
  };
}

export function buildGrantSettlementTransaction(input: { grant: Address; amount: bigint }) {
  return {
    address: input.grant,
    abi: tokenGrantAbi,
    functionName: "settle",
    args: [input.amount] as const,
  };
}

export function buildGrantRightTransferTransaction(input: {
  factory: Address;
  from: Address;
  to: Address;
  tokenId: bigint;
}) {
  return {
    address: input.factory,
    abi: tokenGrantFactoryAbi,
    functionName: "safeTransferFrom",
    args: [input.from, input.to, input.tokenId] as const,
  };
}

export function buildDirectGrantCreationTransaction(input: {
  factory: Address;
  terms: GrantCreationTerms;
  creationFee?: bigint;
}) {
  return {
    address: input.factory,
    abi: tokenGrantFactoryAbi,
    functionName: "createGrant",
    args: grantCreationArgs(input.terms),
    value: input.creationFee ?? 0n,
  };
}

export function buildBoardroomMintTransaction(input: { boardroom: Address; to: Address; amount: bigint }) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "mint",
    args: [input.to, input.amount] as const,
  };
}

export function buildBoardroomLaunchTransaction(input: { boardroom: Address; governanceDelay: bigint }) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "launch",
    args: [input.governanceDelay] as const,
  };
}

export function buildBoardroomSetExecutorTransaction(input: { boardroom: Address; executor: Address }) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "setExecutor",
    args: [input.executor] as const,
  };
}

export function buildBoardroomStartWindDownTransaction(input: { boardroom: Address }) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "startWindDown",
  };
}

export function buildBoardroomWrapNativeBalanceTransaction(input: { boardroom: Address }) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "wrapNativeBalance",
  };
}

export function buildBoardroomBurnTreasurySharesTransaction(input: { boardroom: Address }) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "burnTreasuryShares",
  };
}

export function buildBoardroomOpenRedemptionsTransaction(input: { boardroom: Address }) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "openRedemptions",
  };
}

export function buildBoardroomRegisterRedeemableAssetTransaction(input: { boardroom: Address; asset: Address }) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "registerRedeemableAsset",
    args: [input.asset] as const,
  };
}

export function buildBoardroomRedeemTransaction(input: {
  boardroom: Address;
  shares: bigint;
  recipient: Address;
  minAmountsOut: readonly bigint[];
}) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "redeem",
    args: [input.shares, input.recipient, input.minAmountsOut] as const,
  };
}

export function buildBoardroomClaimRedemptionAssetTransaction(input: {
  boardroom: Address;
  asset: Address;
  recipient: Address;
  minAmountOut: bigint;
}) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "claimRedemptionAsset",
    args: [input.asset, input.recipient, input.minAmountOut] as const,
  };
}

export function buildBoardroomCall(input: {
  policy: Address;
  target: Address;
  data: Hex;
  value?: bigint;
}): BoardroomCall {
  return {
    policy: input.policy,
    target: input.target,
    value: input.value ?? 0n,
    data: input.data,
  };
}

export function buildBoardroomSelfCall(input: { boardroom: Address; data: Hex; value?: bigint }): BoardroomCall {
  return buildBoardroomCall({
    policy: ZERO_ADDRESS,
    target: input.boardroom,
    data: input.data,
    ...(input.value === undefined ? {} : { value: input.value }),
  });
}

export function buildBoardroomExecuteTransaction(input: { boardroom: Address; call: BoardroomCall; value?: bigint }) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "execute",
    args: [input.call] as const,
    value: input.value ?? input.call.value,
  };
}

export function buildBoardroomExecuteBatchTransaction(input: {
  boardroom: Address;
  calls: readonly BoardroomCall[];
  value?: bigint;
}) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "executeBatch",
    args: [input.calls] as const,
    value: input.value ?? input.calls.reduce((total, call) => total + call.value, 0n),
  };
}

export function buildBoardroomQueueActionTransaction(input: {
  boardroom: Address;
  call: BoardroomCall;
  salt: Hex;
}) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "queueAction",
    args: [input.call, input.salt] as const,
  };
}

export function buildBoardroomQueueBatchTransaction(input: {
  boardroom: Address;
  calls: readonly BoardroomCall[];
  salt: Hex;
}) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "queueBatch",
    args: [input.calls, input.salt] as const,
  };
}

export function buildBoardroomCancelActionTransaction(input: { boardroom: Address; actionHash: Hex }) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "cancelAction",
    args: [input.actionHash] as const,
  };
}

export function buildBoardroomExecuteQueuedActionTransaction(input: {
  boardroom: Address;
  call: BoardroomCall;
  salt: Hex;
  value?: bigint;
}) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "executeQueuedAction",
    args: [input.call, input.salt] as const,
    value: input.value ?? input.call.value,
  };
}

export function buildBoardroomExecuteQueuedBatchTransaction(input: {
  boardroom: Address;
  calls: readonly BoardroomCall[];
  salt: Hex;
  value?: bigint;
}) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "executeQueuedBatch",
    args: [input.calls, input.salt] as const,
    value: input.value ?? totalCallValue(input.calls),
  };
}

export function buildBoardroomExecuteWindDownCallTransaction(input: {
  boardroom: Address;
  call: BoardroomCall;
}) {
  if (input.call.value !== 0n) throw new Error("Wind-down calls cannot transfer native value.");
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "executeWindDownCall",
    args: [input.call] as const,
  };
}

export type BoardroomCallExecutionPlan =
  | { kind: "execute"; transaction: ReturnType<typeof buildBoardroomExecuteTransaction> | ReturnType<typeof buildBoardroomExecuteBatchTransaction> }
  | { kind: "queue"; transaction: ReturnType<typeof buildBoardroomQueueActionTransaction> | ReturnType<typeof buildBoardroomQueueBatchTransaction> }
  | { kind: "windDown"; transaction: ReturnType<typeof buildBoardroomExecuteWindDownCallTransaction> };

export function planBoardroomCallExecution(input: {
  boardroom: Address;
  calls: readonly BoardroomCall[];
  lifecycle: { launched: boolean; status: number };
  salt?: Hex;
}): BoardroomCallExecutionPlan {
  if (input.calls.length === 0) throw new Error("At least one Boardroom call is required.");

  if (input.lifecycle.status === 0) {
    if (input.lifecycle.launched) {
      if (!input.salt) throw new Error("A governance salt is required after launch.");
      return input.calls.length === 1
        ? {
            kind: "queue",
            transaction: buildBoardroomQueueActionTransaction({
              boardroom: input.boardroom,
              call: input.calls[0]!,
              salt: input.salt,
            }),
          }
        : {
            kind: "queue",
            transaction: buildBoardroomQueueBatchTransaction({
              boardroom: input.boardroom,
              calls: input.calls,
              salt: input.salt,
            }),
          };
    }

    return input.calls.length === 1
      ? {
          kind: "execute",
          transaction: buildBoardroomExecuteTransaction({ boardroom: input.boardroom, call: input.calls[0]! }),
        }
      : {
          kind: "execute",
          transaction: buildBoardroomExecuteBatchTransaction({ boardroom: input.boardroom, calls: input.calls }),
        };
  }

  if (input.lifecycle.status === 1) {
    if (input.calls.length !== 1) throw new Error("Wind-down calls must be submitted one at a time.");
    return {
      kind: "windDown",
      transaction: buildBoardroomExecuteWindDownCallTransaction({ boardroom: input.boardroom, call: input.calls[0]! }),
    };
  }

  throw new Error("Boardroom calls are unavailable after redemptions open.");
}

export function buildBoardroomSetExecutorCall(input: { boardroom: Address; executor: Address }): BoardroomCall {
  return buildBoardroomSelfCall({
    boardroom: input.boardroom,
    data: encodeFunctionData({ abi: boardroomAbi, functionName: "setExecutor", args: [input.executor] }),
  });
}

export function buildBoardroomMintCall(input: { boardroom: Address; to: Address; amount: bigint }): BoardroomCall {
  return buildBoardroomSelfCall({
    boardroom: input.boardroom,
    data: encodeFunctionData({ abi: boardroomAbi, functionName: "mint", args: [input.to, input.amount] }),
  });
}

export function buildBoardroomRegisterRedeemableAssetCall(input: {
  boardroom: Address;
  asset: Address;
}): BoardroomCall {
  return buildBoardroomSelfCall({
    boardroom: input.boardroom,
    data: encodeFunctionData({ abi: boardroomAbi, functionName: "registerRedeemableAsset", args: [input.asset] }),
  });
}

export function buildBoardroomGrantApprovalCall(input: {
  policy: Address;
  shareToken: Address;
  factory: Address;
  amount: bigint;
}): BoardroomCall {
  return buildBoardroomCall({
    policy: input.policy,
    target: input.shareToken,
    data: encodeFunctionData({
      abi: boardroomTokenAbi,
      functionName: "approve",
      args: [input.factory, input.amount],
    }),
  });
}

export function fixedPriceSaleArgs(terms: FixedPriceSaleTerms) {
  return [
    {
      shareToken: terms.shareToken,
      paymentToken: terms.paymentToken,
      shareAmount: terms.shareAmount,
      price: terms.price,
      maxPerBuyer: terms.maxPerBuyer,
      startTime: terms.startTime,
      endTime: terms.endTime,
      salt: terms.salt,
    },
  ] as const;
}

export function bondMarketArgs(terms: BondMarketTerms) {
  return [
    {
      quoteToken: terms.quoteToken,
      kind: terms.kind,
      capacity: terms.capacity,
      initialPrice: terms.initialPrice,
      minimumPrice: terms.minimumPrice,
      debtBuffer: terms.debtBuffer,
      vesting: terms.vesting,
      start: terms.start,
      duration: terms.duration,
      depositInterval: terms.depositInterval,
      salt: terms.salt,
    },
  ] as const;
}

export function buildBondPurchaseTransaction(input: {
  market: Address;
  quoteAmount: bigint;
  minimumPayout: bigint;
  deadline: bigint;
}) {
  return {
    address: input.market,
    abi: bondMarketAbi,
    functionName: "purchase",
    args: [input.quoteAmount, input.minimumPayout, input.deadline] as const,
  };
}

export function buildBondRedeemTransaction(input: { market: Address; positionId: bigint }) {
  return {
    address: input.market,
    abi: bondMarketAbi,
    functionName: "redeem",
    args: [input.positionId] as const,
  };
}

export function buildBondFinalizeTransaction(input: { market: Address }) {
  return { address: input.market, abi: bondMarketAbi, functionName: "finalize" };
}

export function buildBoardroomBondMarketBatch(input: {
  boardroom: Address;
  factory: Address;
  shareToken: Address;
  terms: BondMarketTerms;
  assetPolicy?: Address;
  policy?: Address;
}) {
  const assetPolicy = requireAssetPolicy(input.assetPolicy);
  const calls = [
    buildBoardroomCall({
      policy: assetPolicy,
      target: input.shareToken,
      data: encodeFunctionData({
        abi: boardroomTokenAbi,
        functionName: "approve",
        args: [input.factory, input.terms.capacity],
      }),
    }),
    buildBoardroomCall({
      policy: input.policy ?? input.factory,
      target: input.factory,
      data: encodeFunctionData({
        abi: bondMarketFactoryAbi,
        functionName: "createBondMarket",
        args: bondMarketArgs(input.terms),
      }),
    }),
  ] as const;

  return buildBoardroomExecuteBatchTransaction({ boardroom: input.boardroom, calls });
}

export function buildBoardroomBondMarketCloseCall(input: { policy: Address; market: Address }): BoardroomCall {
  return buildBoardroomCall({
    policy: input.policy,
    target: input.market,
    data: encodeFunctionData({ abi: bondMarketAbi, functionName: "close" }),
  });
}

export function buildBoardroomBondMarketCloseAction(input: {
  boardroom: Address;
  policy: Address;
  market: Address;
}) {
  return buildBoardroomExecuteTransaction({
    boardroom: input.boardroom,
    call: buildBoardroomBondMarketCloseCall(input),
  });
}

export function buildFixedPriceSaleBuyTransaction(input: {
  sale: Address;
  shareAmount: bigint;
  recipient: Address;
  maxPayment: bigint;
  deadline: bigint;
}) {
  return {
    address: input.sale,
    abi: fixedPriceSaleAbi,
    functionName: "buy",
    args: [input.shareAmount, input.recipient, input.maxPayment, input.deadline] as const,
  };
}

export function migratingBondingCurveArgs(terms: MigratingBondingCurveTerms) {
  return [
    {
      shareToken: terms.shareToken,
      quoteToken: terms.quoteToken,
      saleSupply: terms.saleSupply,
      migrationSupply: terms.migrationSupply,
      basePrice: terms.basePrice,
      slope: terms.slope,
      graduationQuoteTarget: terms.graduationQuoteTarget,
      quoteToLpBps: terms.quoteToLpBps,
      startTime: terms.startTime,
      endTime: terms.endTime,
      migrationSalt: terms.migrationSalt,
      salt: terms.salt,
    },
  ] as const;
}

export function buildMigratingBondingCurveBuyTransaction(input: {
  curve: Address;
  shareAmount: bigint;
  recipient: Address;
  maxQuoteIn: bigint;
  deadline: bigint;
}) {
  return {
    address: input.curve,
    abi: migratingBondingCurveAbi,
    functionName: "buy",
    args: [input.shareAmount, input.recipient, input.maxQuoteIn, input.deadline] as const,
  };
}

export function buildMigratingBondingCurveSellTransaction(input: {
  curve: Address;
  shareAmount: bigint;
  recipient: Address;
  minQuoteOut: bigint;
  deadline: bigint;
}) {
  return {
    address: input.curve,
    abi: migratingBondingCurveAbi,
    functionName: "sell",
    args: [input.shareAmount, input.recipient, input.minQuoteOut, input.deadline] as const,
  };
}

export function merkleAirdropArgs(terms: MerkleAirdropTerms) {
  return [
    {
      shareToken: terms.shareToken,
      shareAmount: terms.shareAmount,
      merkleRoot: terms.merkleRoot,
      startTime: terms.startTime,
      endTime: terms.endTime,
      maxGrantClaims: terms.maxGrantClaims,
      salt: terms.salt,
    },
  ] as const;
}

export function merkleAirdropGrantClaimArgs(terms: MerkleAirdropGrantClaimTerms) {
  return {
    paymentToken: terms.paymentToken,
    price: terms.price,
    expiry: terms.expiry,
    vestingCliff: terms.vestingCliff,
    vestingEnd: terms.vestingEnd,
    transferable: terms.transferable,
    transferUnlockTime: terms.transferUnlockTime,
    salt: terms.salt,
  } as const;
}

export function lockedLiquidityArgs(terms: LockedLiquidityTerms) {
  return [
    {
      tokenA: terms.tokenA,
      tokenB: terms.tokenB,
      amountADesired: terms.amountADesired,
      amountBDesired: terms.amountBDesired,
      amountAMin: terms.amountAMin,
      amountBMin: terms.amountBMin,
      deadline: terms.deadline,
      salt: terms.salt,
    },
  ] as const;
}

export function buildBoardroomFixedPriceSaleApprovalCall(input: {
  policy: Address;
  shareToken: Address;
  factory: Address;
  amount: bigint;
}): BoardroomCall {
  return buildBoardroomCall({
    policy: input.policy,
    target: input.shareToken,
    data: encodeFunctionData({
      abi: boardroomTokenAbi,
      functionName: "approve",
      args: [input.factory, input.amount],
    }),
  });
}

export function buildBoardroomFixedPriceSaleCreationCall(input: {
  policy: Address;
  factory: Address;
  terms: FixedPriceSaleTerms;
}): BoardroomCall {
  return buildBoardroomCall({
    policy: input.policy,
    target: input.factory,
    data: encodeFunctionData({
      abi: distributionFactoryAbi,
      functionName: "createFixedPriceSale",
      args: fixedPriceSaleArgs(input.terms),
    }),
  });
}

export function buildBoardroomFixedPriceSaleBatch(input: {
  boardroom: Address;
  factory: Address;
  shareToken: Address;
  terms: BoardroomFixedPriceSaleTerms;
  policy?: Address;
  assetPolicy?: Address;
}) {
  const policy = input.policy ?? input.factory;
  const assetPolicy = requireAssetPolicy(input.assetPolicy);
  const terms = { ...input.terms, shareToken: input.shareToken } satisfies FixedPriceSaleTerms;
  const calls = [
    buildBoardroomFixedPriceSaleApprovalCall({
      policy: assetPolicy,
      shareToken: input.shareToken,
      factory: input.factory,
      amount: input.terms.shareAmount,
    }),
    buildBoardroomFixedPriceSaleCreationCall({
      policy,
      factory: input.factory,
      terms,
    }),
  ] as const;

  return buildBoardroomExecuteBatchTransaction({
    boardroom: input.boardroom,
    calls,
  });
}

export function buildBoardroomFixedPriceSaleCloseAction(input: {
  boardroom: Address;
  policy: Address;
  sale: Address;
}) {
  return buildBoardroomExecuteTransaction({
    boardroom: input.boardroom,
    call: buildBoardroomFixedPriceSaleCloseCall(input),
  });
}

export function buildBoardroomFixedPriceSaleCloseCall(input: { policy: Address; sale: Address }): BoardroomCall {
  return buildBoardroomCall({
    policy: input.policy,
    target: input.sale,
    data: encodeFunctionData({ abi: fixedPriceSaleAbi, functionName: "close" }),
  });
}

export function buildBoardroomFixedPriceSaleCancelAction(input: {
  boardroom: Address;
  policy: Address;
  sale: Address;
}) {
  return buildBoardroomExecuteTransaction({
    boardroom: input.boardroom,
    call: buildBoardroomFixedPriceSaleCancelCall(input),
  });
}

export function buildBoardroomFixedPriceSaleCancelCall(input: { policy: Address; sale: Address }): BoardroomCall {
  return buildBoardroomCall({
    policy: input.policy,
    target: input.sale,
    data: encodeFunctionData({ abi: fixedPriceSaleAbi, functionName: "cancel" }),
  });
}

export function buildBoardroomMigratingCurveApprovalCall(input: {
  policy: Address;
  shareToken: Address;
  factory: Address;
  saleSupply: bigint;
  migrationSupply: bigint;
}): BoardroomCall {
  return buildBoardroomCall({
    policy: input.policy,
    target: input.shareToken,
    data: encodeFunctionData({
      abi: boardroomTokenAbi,
      functionName: "approve",
      args: [input.factory, input.saleSupply + input.migrationSupply],
    }),
  });
}

export function buildBoardroomMigratingCurveCreationCall(input: {
  policy: Address;
  factory: Address;
  terms: MigratingBondingCurveTerms;
}): BoardroomCall {
  return buildBoardroomCall({
    policy: input.policy,
    target: input.factory,
    data: encodeFunctionData({
      abi: distributionFactoryAbi,
      functionName: "createMigratingBondingCurve",
      args: migratingBondingCurveArgs(input.terms),
    }),
  });
}

export function buildBoardroomMigratingCurveBatch(input: {
  boardroom: Address;
  factory: Address;
  shareToken: Address;
  terms: BoardroomMigratingBondingCurveTerms;
  policy?: Address;
  assetPolicy?: Address;
}) {
  const policy = input.policy ?? input.factory;
  const assetPolicy = requireAssetPolicy(input.assetPolicy);
  const terms = { ...input.terms, shareToken: input.shareToken } satisfies MigratingBondingCurveTerms;
  const calls = [
    buildBoardroomMigratingCurveApprovalCall({
      policy: assetPolicy,
      shareToken: input.shareToken,
      factory: input.factory,
      saleSupply: input.terms.saleSupply,
      migrationSupply: input.terms.migrationSupply,
    }),
    buildBoardroomMigratingCurveCreationCall({
      policy,
      factory: input.factory,
      terms,
    }),
  ] as const;

  return buildBoardroomExecuteBatchTransaction({
    boardroom: input.boardroom,
    calls,
  });
}

export function buildBoardroomMigratingCurveCancelAction(input: {
  boardroom: Address;
  policy: Address;
  curve: Address;
}) {
  return buildBoardroomExecuteTransaction({
    boardroom: input.boardroom,
    call: buildBoardroomMigratingCurveCancelCall(input),
  });
}

export function buildBoardroomMigratingCurveCancelCall(input: { policy: Address; curve: Address }): BoardroomCall {
  return buildBoardroomCall({
    policy: input.policy,
    target: input.curve,
    data: encodeFunctionData({ abi: migratingBondingCurveAbi, functionName: "cancel" }),
  });
}

export function buildBoardroomMigratingCurveMigrationAction(input: {
  boardroom: Address;
  policy: Address;
  curve: Address;
  minShareLiquidity: bigint;
  minQuoteLiquidity: bigint;
  deadline: bigint;
}) {
  return buildBoardroomExecuteTransaction({
    boardroom: input.boardroom,
    call: buildBoardroomMigratingCurveMigrationCall(input),
  });
}

export function buildBoardroomMigratingCurveMigrationCall(input: {
  policy: Address;
  curve: Address;
  minShareLiquidity: bigint;
  minQuoteLiquidity: bigint;
  deadline: bigint;
}): BoardroomCall {
  return buildBoardroomCall({
    policy: input.policy,
    target: input.curve,
    data: encodeFunctionData({
      abi: migratingBondingCurveAbi,
      functionName: "migrate",
      args: [input.minShareLiquidity, input.minQuoteLiquidity, input.deadline],
    }),
  });
}

export function buildBoardroomMerkleAirdropApprovalCall(input: {
  policy: Address;
  shareToken: Address;
  factory: Address;
  amount: bigint;
}): BoardroomCall {
  return buildBoardroomCall({
    policy: input.policy,
    target: input.shareToken,
    data: encodeFunctionData({
      abi: boardroomTokenAbi,
      functionName: "approve",
      args: [input.factory, input.amount],
    }),
  });
}

export function buildBoardroomMerkleAirdropCreationCall(input: {
  policy: Address;
  factory: Address;
  terms: MerkleAirdropTerms;
}): BoardroomCall {
  return buildBoardroomCall({
    policy: input.policy,
    target: input.factory,
    data: encodeFunctionData({
      abi: distributionFactoryAbi,
      functionName: "createMerkleAirdrop",
      args: merkleAirdropArgs(input.terms),
    }),
  });
}

export function buildBoardroomMerkleAirdropBatch(input: {
  boardroom: Address;
  factory: Address;
  shareToken: Address;
  terms: BoardroomMerkleAirdropTerms;
  policy?: Address;
  assetPolicy?: Address;
}) {
  const policy = input.policy ?? input.factory;
  const assetPolicy = requireAssetPolicy(input.assetPolicy);
  const terms = { ...input.terms, shareToken: input.shareToken } satisfies MerkleAirdropTerms;
  const calls = [
    buildBoardroomMerkleAirdropApprovalCall({
      policy: assetPolicy,
      shareToken: input.shareToken,
      factory: input.factory,
      amount: input.terms.shareAmount,
    }),
    buildBoardroomMerkleAirdropCreationCall({
      policy,
      factory: input.factory,
      terms,
    }),
  ] as const;

  return buildBoardroomExecuteBatchTransaction({
    boardroom: input.boardroom,
    calls,
  });
}

export function buildBoardroomMerkleAirdropCloseAction(input: {
  boardroom: Address;
  policy: Address;
  airdrop: Address;
}) {
  return buildBoardroomExecuteTransaction({
    boardroom: input.boardroom,
    call: buildBoardroomMerkleAirdropCloseCall(input),
  });
}

export function buildBoardroomMerkleAirdropCloseCall(input: { policy: Address; airdrop: Address }): BoardroomCall {
  return buildBoardroomCall({
    policy: input.policy,
    target: input.airdrop,
    data: encodeFunctionData({ abi: merkleAirdropAbi, functionName: "close" }),
  });
}

export function buildBoardroomMerkleAirdropCancelAction(input: {
  boardroom: Address;
  policy: Address;
  airdrop: Address;
}) {
  return buildBoardroomExecuteTransaction({
    boardroom: input.boardroom,
    call: buildBoardroomMerkleAirdropCancelCall(input),
  });
}

export function buildBoardroomMerkleAirdropCancelCall(input: { policy: Address; airdrop: Address }): BoardroomCall {
  return buildBoardroomCall({
    policy: input.policy,
    target: input.airdrop,
    data: encodeFunctionData({ abi: merkleAirdropAbi, functionName: "cancel" }),
  });
}

export function buildMerkleAirdropClaimTransaction(input: {
  airdrop: Address;
  index: bigint;
  account: Address;
  amount: bigint;
  proof: readonly Hex[];
}) {
  return {
    address: input.airdrop,
    abi: merkleAirdropAbi,
    functionName: "claim",
    args: [input.index, input.account, input.amount, input.proof] as const,
  };
}

export function buildMerkleAirdropGrantClaimTransaction(input: {
  airdrop: Address;
  index: bigint;
  account: Address;
  amount: bigint;
  terms: MerkleAirdropGrantClaimTerms;
  proof: readonly Hex[];
}) {
  return {
    address: input.airdrop,
    abi: merkleAirdropAbi,
    functionName: "claimGrant",
    args: [input.index, input.account, input.amount, merkleAirdropGrantClaimArgs(input.terms), input.proof] as const,
  };
}

export function buildBoardroomLockedLiquidityApprovalCall(input: {
  policy: Address;
  token: Address;
  factory: Address;
  amount: bigint;
}): BoardroomCall {
  return buildBoardroomCall({
    policy: input.policy,
    target: input.token,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [input.factory, input.amount],
    }),
  });
}

export function buildBoardroomLockedLiquidityCreationCall(input: {
  policy: Address;
  factory: Address;
  terms: LockedLiquidityTerms;
}): BoardroomCall {
  return buildBoardroomCall({
    policy: input.policy,
    target: input.factory,
    data: encodeFunctionData({
      abi: lockedLiquidityFactoryAbi,
      functionName: "createLockedLiquidity",
      args: lockedLiquidityArgs(input.terms),
    }),
  });
}

export function buildBoardroomLockedLiquidityBatch(input: {
  boardroom: Address;
  factory: Address;
  shareToken: Address;
  terms: BoardroomLockedLiquidityTerms;
  policy?: Address;
  assetPolicy?: Address;
}) {
  const policy = input.policy ?? input.factory;
  const assetPolicy = requireAssetPolicy(input.assetPolicy);
  const shareTokenSide = input.terms.shareTokenSide ?? "tokenA";
  const terms =
    shareTokenSide === "tokenA"
      ? ({
          tokenA: input.shareToken,
          tokenB: input.terms.quoteToken,
          amountADesired: input.terms.shareAmountDesired,
          amountBDesired: input.terms.quoteAmountDesired,
          amountAMin: input.terms.shareAmountMin,
          amountBMin: input.terms.quoteAmountMin,
          deadline: input.terms.deadline,
          salt: input.terms.salt,
        } satisfies LockedLiquidityTerms)
      : ({
          tokenA: input.terms.quoteToken,
          tokenB: input.shareToken,
          amountADesired: input.terms.quoteAmountDesired,
          amountBDesired: input.terms.shareAmountDesired,
          amountAMin: input.terms.quoteAmountMin,
          amountBMin: input.terms.shareAmountMin,
          deadline: input.terms.deadline,
          salt: input.terms.salt,
        } satisfies LockedLiquidityTerms);
  const calls = [
    buildBoardroomLockedLiquidityApprovalCall({
      policy: assetPolicy,
      token: input.shareToken,
      factory: input.factory,
      amount: input.terms.shareAmountDesired,
    }),
    buildBoardroomLockedLiquidityApprovalCall({
      policy: assetPolicy,
      token: input.terms.quoteToken,
      factory: input.factory,
      amount: input.terms.quoteAmountDesired,
    }),
    buildBoardroomLockedLiquidityCreationCall({
      policy,
      factory: input.factory,
      terms,
    }),
  ] as const;

  return buildBoardroomExecuteBatchTransaction({
    boardroom: input.boardroom,
    calls,
  });
}

export function buildBoardroomLockedLiquidityExitTransaction(input: {
  boardroom: Address;
  locker: Address;
  amountAMin: bigint;
  amountBMin: bigint;
  deadline: bigint;
}) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "exitLockedLiquidity",
    args: [input.locker, input.amountAMin, input.amountBMin, input.deadline] as const,
  };
}

export function buildBoardroomLockedLiquidityFeeClaimAction(input: {
  boardroom: Address;
  policy: Address;
  locker: Address;
}) {
  return buildBoardroomExecuteTransaction({
    boardroom: input.boardroom,
    call: buildBoardroomLockedLiquidityFeeClaimCall(input),
  });
}

export function buildBoardroomLockedLiquidityFeeClaimCall(input: { policy: Address; locker: Address }): BoardroomCall {
  return buildBoardroomCall({
    policy: input.policy,
    target: input.locker,
    data: encodeFunctionData({ abi: lockedLiquidityAbi, functionName: "claimFees" }),
  });
}

export function buildBoardroomGrantCreationCall(input: {
  policy: Address;
  factory: Address;
  terms: GrantCreationTerms;
  creationFee?: bigint;
}): BoardroomCall {
  return buildBoardroomCall({
    policy: input.policy,
    target: input.factory,
    value: input.creationFee ?? 0n,
    data: encodeFunctionData({
      abi: tokenGrantFactoryAbi,
      functionName: "createGrant",
      args: grantCreationArgs(input.terms),
    }),
  });
}

export function buildBoardroomShareGrantIssuanceBatch(input: {
  boardroom: Address;
  factory: Address;
  shareToken: Address;
  terms: BoardroomShareGrantTerms;
  creationFee?: bigint;
  policy?: Address;
  assetPolicy?: Address;
}) {
  const policy = input.policy ?? input.factory;
  const assetPolicy = requireAssetPolicy(input.assetPolicy);
  const terms = { ...input.terms, token: input.shareToken } satisfies GrantCreationTerms;
  const calls = [
    buildBoardroomGrantApprovalCall({
      policy: assetPolicy,
      shareToken: input.shareToken,
      factory: input.factory,
      amount: input.terms.amount,
    }),
    buildBoardroomGrantCreationCall({
      policy,
      factory: input.factory,
      terms,
      creationFee: input.creationFee ?? 0n,
    }),
  ] as const;

  return buildBoardroomExecuteBatchTransaction({
    boardroom: input.boardroom,
    calls,
    value: input.creationFee ?? 0n,
  });
}

export function buildGrantIssuerBoardroomAction(input: {
  boardroom: Address;
  policy: Address;
  grant: Address;
  functionName: "stopVestingAndWithdrawUnvested" | "withdrawExpiredTokens";
}) {
  return buildBoardroomExecuteTransaction({
    boardroom: input.boardroom,
    call: buildGrantIssuerBoardroomCall(input),
  });
}

export function buildGrantIssuerBoardroomCall(input: {
  policy: Address;
  grant: Address;
  functionName: "stopVestingAndWithdrawUnvested" | "withdrawExpiredTokens";
}): BoardroomCall {
  return buildBoardroomCall({
    policy: input.policy,
    target: input.grant,
    data: encodeFunctionData({ abi: tokenGrantAbi, functionName: input.functionName }),
  });
}

function totalCallValue(calls: readonly BoardroomCall[]): bigint {
  return calls.reduce((total, call) => total + call.value, 0n);
}
