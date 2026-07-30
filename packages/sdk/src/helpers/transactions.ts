import { encodeFunctionData, type Address, type Hex } from "viem";
import {
  ammRouterAbi,
  boardroomAbi,
  boardroomControllerAbi,
  boardroomFactoryAbi,
  boardroomRewardsAbi,
  boardroomRewardsFactoryAbi,
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
  BoardroomCall,
  BoardroomLaunchConfig,
  BoardroomFixedPriceSaleTerms,
  BoardroomDutchAuctionTerms,
  BoardroomLockedLiquidityTerms,
  BoardroomLockedLiquidityAddTerms,
  BoardroomMerkleAirdropTerms,
  BoardroomMigratingBondingCurveTerms,
  BoardroomShareGrantTerms,
  BondMarketTerms,
  FixedPriceSaleTerms,
  DutchAuctionTerms,
  GrantCreationArgs,
  GrantCreationTerms,
  LockedLiquidityTerms,
  LockedLiquidityAddTerms,
  MerkleAirdropGrantClaimTerms,
  MerkleAirdropTerms,
  MigratingBondingCurveTerms,
} from "./types";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const satisfies Address;

function requireFacetSetHash(value: Hex): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("expectedFacetSetHash must be a 32-byte hex value.");
  }
  return value;
}

export type BoardroomMutationFunctionName = Extract<
  (typeof boardroomAbi)[number],
  { type: "function"; stateMutability: "nonpayable" | "payable" }
>["name"];

const boardroomMutationFunctionNames = new Set<string>(
  boardroomAbi
    .filter(
      (item) =>
        item.type === "function"
        && (item.stateMutability === "nonpayable" || item.stateMutability === "payable"),
    )
    .map((item) => item.name),
);

export function buildBoardroomMutationTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  functionName: BoardroomMutationFunctionName;
  args?: readonly unknown[];
  value?: bigint;
}) {
  if (!boardroomMutationFunctionNames.has(input.functionName)) {
    throw new Error(`${input.functionName} is not a mutating Boardroom route.`);
  }
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: input.functionName,
    args: [
      requireFacetSetHash(input.expectedFacetSetHash),
      ...(input.args ?? []),
    ] as const,
    ...(input.value === undefined ? {} : { value: input.value }),
  } as const;
}

export function buildBoardroomCreateTransaction(input: {
  factory: Address;
  expectedFacetSetHash: Hex;
  owner: Address;
  name: string;
  symbol: string;
  salt: Hex;
}) {
  return {
    address: input.factory,
    abi: boardroomFactoryAbi,
    functionName: "createBoardroom",
    args: [
      requireFacetSetHash(input.expectedFacetSetHash),
      input.owner,
      input.name,
      input.symbol,
      requireFacetSetHash(input.salt),
    ] as const,
  } as const;
}

export function buildBoardroomMigrateTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
}) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "migrateBoardroom",
    args: [requireFacetSetHash(input.expectedFacetSetHash)] as const,
  } as const;
}

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

export function buildBoardroomMintTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  to: Address;
  amount: bigint;
}) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "mint",
    args: [requireFacetSetHash(input.expectedFacetSetHash), input.to, input.amount] as const,
  };
}

export function buildBoardroomLaunchTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  config: BoardroomLaunchConfig;
}) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "launch",
    args: [requireFacetSetHash(input.expectedFacetSetHash), input.config] as const,
  };
}

export function buildBoardroomBeginSnapshotTransaction(input: { boardroom: Address; expectedFacetSetHash: Hex }) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "beginSnapshot",
    args: [requireFacetSetHash(input.expectedFacetSetHash)] as const,
  };
}

export function buildBoardroomSnapshotAssetsTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  maximum: bigint;
}) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "snapshotAssets",
    args: [requireFacetSetHash(input.expectedFacetSetHash), input.maximum] as const,
  };
}

export function buildBoardroomStartWindDownTransaction(input: { boardroom: Address; expectedFacetSetHash: Hex }) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "startWindDown",
    args: [requireFacetSetHash(input.expectedFacetSetHash)] as const,
  };
}

export function buildBoardroomPruneObligationTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  obligation: Address;
}) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "pruneObligation",
    args: [requireFacetSetHash(input.expectedFacetSetHash), input.obligation] as const,
  };
}

export function buildBoardroomPruneObligationsTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  obligations: readonly Address[];
}) {
  if (input.obligations.length === 0 || input.obligations.length > 32) {
    throw new Error("Obligation prune batches must contain between 1 and 32 addresses.");
  }
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "pruneObligations",
    args: [requireFacetSetHash(input.expectedFacetSetHash), input.obligations] as const,
  };
}

export function buildBoardroomWrapNativeBalanceTransaction(input: { boardroom: Address; expectedFacetSetHash: Hex }) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "wrapNativeBalance",
    args: [requireFacetSetHash(input.expectedFacetSetHash)] as const,
  };
}

export function buildBoardroomBurnTreasurySharesTransaction(input: { boardroom: Address; expectedFacetSetHash: Hex }) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "burnTreasuryShares",
    args: [requireFacetSetHash(input.expectedFacetSetHash)] as const,
  };
}

export function buildBoardroomOpenRedemptionsTransaction(input: { boardroom: Address; expectedFacetSetHash: Hex }) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "openRedemptions",
    args: [requireFacetSetHash(input.expectedFacetSetHash)] as const,
  };
}

export function buildBoardroomRegisterRedeemableAssetTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  asset: Address;
}) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "registerRedeemableAsset",
    args: [requireFacetSetHash(input.expectedFacetSetHash), input.asset] as const,
  };
}

export function buildBoardroomRedeemTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  shares: bigint;
}) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "redeem",
    args: [requireFacetSetHash(input.expectedFacetSetHash), input.shares] as const,
  };
}

export function buildBoardroomClaimRedemptionAssetTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  asset: Address;
  recipient: Address;
  minAmountOut: bigint;
}) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "claimRedemptionAsset",
    args: [
      requireFacetSetHash(input.expectedFacetSetHash),
      input.asset,
      input.recipient,
      input.minAmountOut,
    ] as const,
  };
}

export function buildBoardroomRewardsStakeTransaction(input: { rewards: Address; amount: bigint }) {
  return {
    address: input.rewards,
    abi: boardroomRewardsAbi,
    functionName: "stake",
    args: [input.amount] as const,
  };
}

export function buildBoardroomRewardsUnstakeRequestTransaction(input: { rewards: Address; amount: bigint }) {
  return {
    address: input.rewards,
    abi: boardroomRewardsAbi,
    functionName: "requestUnstake",
    args: [input.amount] as const,
  };
}

export function buildBoardroomRewardsCompleteUnstakeTransaction(input: {
  rewards: Address;
  account: Address;
  slot: bigint;
}) {
  return {
    address: input.rewards,
    abi: boardroomRewardsAbi,
    functionName: "completeUnstake",
    args: [input.account, input.slot] as const,
  };
}

export function buildBoardroomRewardsClaimTransaction(input: {
  rewards: Address;
  asset: Address;
  recipient: Address;
}) {
  return {
    address: input.rewards,
    abi: boardroomRewardsAbi,
    functionName: "claim",
    args: [input.asset, input.recipient] as const,
  };
}

export function buildBoardroomRewardsTerminalizeTransaction(input: { rewards: Address }) {
  return {
    address: input.rewards,
    abi: boardroomRewardsAbi,
    functionName: "terminalize",
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

export function buildBoardroomRewardsCreationCall(input: {
  factory: Address;
  cooldown: bigint;
  salt: Hex;
}): BoardroomCall {
  return buildBoardroomCall({
    policy: input.factory,
    target: input.factory,
    data: encodeFunctionData({
      abi: boardroomRewardsFactoryAbi,
      functionName: "createRewards",
      args: [input.cooldown, input.salt],
    }),
  });
}

export function buildBoardroomRewardsCreationTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  factory: Address;
  cooldown: bigint;
  salt: Hex;
}) {
  return buildBoardroomExecuteTransaction({
    boardroom: input.boardroom,
    expectedFacetSetHash: input.expectedFacetSetHash,
    call: buildBoardroomRewardsCreationCall(input),
  });
}

export function buildBoardroomRewardFundingCall(input: {
  factory: Address;
  rewards: Address;
  asset: Address;
  amount: bigint;
  duration: bigint;
}): BoardroomCall {
  return buildBoardroomCall({
    policy: input.factory,
    target: input.factory,
    data: encodeFunctionData({
      abi: boardroomRewardsFactoryAbi,
      functionName: "fundReward",
      args: [input.rewards, input.asset, input.amount, input.duration],
    }),
  });
}

export function buildBoardroomRewardFundingBatch(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  factory: Address;
  assetPolicy: Address;
  rewards: Address;
  asset: Address;
  amount: bigint;
  duration: bigint;
}) {
  return buildBoardroomExecuteBatchTransaction({
    boardroom: input.boardroom,
    expectedFacetSetHash: input.expectedFacetSetHash,
    calls: buildBoardroomRewardFundingCalls(input),
  });
}

export function buildBoardroomRewardFundingCalls(input: {
  factory: Address;
  assetPolicy: Address;
  rewards: Address;
  asset: Address;
  amount: bigint;
  duration: bigint;
}): readonly [BoardroomCall, BoardroomCall] {
  const approvalCall = buildBoardroomCall({
    policy: requireAssetPolicy(input.assetPolicy),
    target: input.asset,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [input.factory, input.amount],
    }),
  });
  return [approvalCall, buildBoardroomRewardFundingCall(input)] as const;
}

export function buildBoardroomSelfCall(input: { boardroom: Address; data: Hex; value?: bigint }): BoardroomCall {
  return buildBoardroomCall({
    policy: ZERO_ADDRESS,
    target: input.boardroom,
    data: input.data,
    ...(input.value === undefined ? {} : { value: input.value }),
  });
}

export function buildBoardroomExecuteTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  call: BoardroomCall;
  value?: bigint;
}) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "execute",
    args: [requireFacetSetHash(input.expectedFacetSetHash), input.call] as const,
    value: input.value ?? input.call.value,
  };
}

export function buildBoardroomExecuteBatchTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  calls: readonly BoardroomCall[];
  value?: bigint;
}) {
  if (input.calls.length === 0 || input.calls.length > 16) {
    throw new Error("Boardroom execution batches must contain between 1 and 16 calls.");
  }
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "executeBatch",
    args: [requireFacetSetHash(input.expectedFacetSetHash), input.calls] as const,
    value: input.value ?? input.calls.reduce((total, call) => total + call.value, 0n),
  };
}

export function buildControllerScheduleBoardroomOperationTransaction(input: {
  controller: Address;
  expectedFacetSetHash: Hex;
  calls: readonly BoardroomCall[];
  salt: Hex;
  expectedBoardroomEpoch: bigint;
  expectedConfigurationEpoch: bigint;
}) {
  return {
    address: input.controller,
    abi: boardroomControllerAbi,
    functionName: "scheduleBoardroomOperation",
    args: [
      requireFacetSetHash(input.expectedFacetSetHash),
      input.calls,
      input.salt,
      input.expectedBoardroomEpoch,
      input.expectedConfigurationEpoch,
    ] as const,
  };
}

export function buildControllerScheduleConfigurationOperationTransaction(input: {
  controller: Address;
  expectedFacetSetHash: Hex;
  data: Hex;
  salt: Hex;
  expectedBoardroomEpoch: bigint;
  expectedConfigurationEpoch: bigint;
}) {
  return {
    address: input.controller,
    abi: boardroomControllerAbi,
    functionName: "scheduleControllerOperation",
    args: [
      requireFacetSetHash(input.expectedFacetSetHash),
      input.data,
      input.salt,
      input.expectedBoardroomEpoch,
      input.expectedConfigurationEpoch,
    ] as const,
  };
}

export function buildBoardroomVetoOperationTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  operationId: Hex;
}) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "veto",
    args: [requireFacetSetHash(input.expectedFacetSetHash), input.operationId] as const,
  };
}

export function buildControllerExecuteBoardroomOperationTransaction(input: {
  controller: Address;
  expectedFacetSetHash: Hex;
  calls: readonly BoardroomCall[];
  salt: Hex;
  expectedBoardroomEpoch: bigint;
  expectedConfigurationEpoch: bigint;
  authority: Address;
}) {
  return {
    address: input.controller,
    abi: boardroomControllerAbi,
    functionName: "executeBoardroomOperation",
    args: [
      requireFacetSetHash(input.expectedFacetSetHash),
      input.calls,
      input.salt,
      input.expectedBoardroomEpoch,
      input.expectedConfigurationEpoch,
      input.authority,
    ] as const,
  };
}

export function buildControllerExecuteConfigurationOperationTransaction(input: {
  controller: Address;
  expectedFacetSetHash: Hex;
  data: Hex;
  salt: Hex;
  expectedBoardroomEpoch: bigint;
  expectedConfigurationEpoch: bigint;
  authority: Address;
}) {
  return {
    address: input.controller,
    abi: boardroomControllerAbi,
    functionName: "executeControllerOperation",
    args: [
      requireFacetSetHash(input.expectedFacetSetHash),
      input.data,
      input.salt,
      input.expectedBoardroomEpoch,
      input.expectedConfigurationEpoch,
      input.authority,
    ] as const,
  };
}

export function buildBoardroomExecuteWindDownCallTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  call: BoardroomCall;
}) {
  if (input.call.value !== 0n) throw new Error("Wind-down calls cannot transfer native value.");
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "executeWindDownCall",
    args: [requireFacetSetHash(input.expectedFacetSetHash), input.call] as const,
  };
}

export type BoardroomCallExecutionPlan =
  | { kind: "execute"; transaction: ReturnType<typeof buildBoardroomExecuteTransaction> | ReturnType<typeof buildBoardroomExecuteBatchTransaction> }
  | { kind: "schedule"; transaction: ReturnType<typeof buildControllerScheduleBoardroomOperationTransaction> }
  | { kind: "windDown"; transaction: ReturnType<typeof buildBoardroomExecuteWindDownCallTransaction> };

export function planBoardroomCallExecution(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  calls: readonly BoardroomCall[];
  lifecycle: {
    launched: boolean;
    status: number;
    migrationRequired: boolean;
    controller?: Address;
    governanceEpoch?: bigint;
    controllerConfigurationEpoch?: bigint;
    proposer?: Address;
  };
  salt?: Hex;
}): BoardroomCallExecutionPlan {
  if (input.calls.length === 0) throw new Error("At least one Boardroom call is required.");
  if (input.lifecycle.migrationRequired) {
    throw new Error("The Boardroom must be migrated before calls can be prepared.");
  }

  if (input.lifecycle.status === 0) {
    if (input.lifecycle.launched) {
      if (!input.salt) throw new Error("A governance salt is required after launch.");
      const { controller, governanceEpoch, controllerConfigurationEpoch } = input.lifecycle;
      if (!controller || governanceEpoch === undefined || controllerConfigurationEpoch === undefined) {
        throw new Error("Current controller and governance epochs are required after launch.");
      }
      return {
        kind: "schedule",
        transaction: buildControllerScheduleBoardroomOperationTransaction({
          controller,
          expectedFacetSetHash: input.expectedFacetSetHash,
          calls: input.calls,
          salt: input.salt,
          expectedBoardroomEpoch: governanceEpoch,
          expectedConfigurationEpoch: controllerConfigurationEpoch,
        }),
      };
    }

    return input.calls.length === 1
      ? {
          kind: "execute",
          transaction: buildBoardroomExecuteTransaction({
            boardroom: input.boardroom,
            expectedFacetSetHash: input.expectedFacetSetHash,
            call: input.calls[0]!,
          }),
        }
      : {
          kind: "execute",
          transaction: buildBoardroomExecuteBatchTransaction({
            boardroom: input.boardroom,
            expectedFacetSetHash: input.expectedFacetSetHash,
            calls: input.calls,
          }),
        };
  }

  if (input.lifecycle.status === 1) {
    if (input.calls.length !== 1) throw new Error("Wind-down calls must be submitted one at a time.");
    return {
      kind: "windDown",
      transaction: buildBoardroomExecuteWindDownCallTransaction({
        boardroom: input.boardroom,
        expectedFacetSetHash: input.expectedFacetSetHash,
        call: input.calls[0]!,
      }),
    };
  }

  throw new Error("Boardroom calls are unavailable during snapshotting or after redemptions open.");
}

export function buildControllerUpdateConfigurationData(input: {
  proposer: Address;
  delay: bigint;
  gracePeriod: bigint;
}): Hex {
  return encodeFunctionData({
    abi: boardroomControllerAbi,
    functionName: "updateConfiguration",
    args: [input.proposer, input.delay, input.gracePeriod],
  });
}

export function buildBoardroomReplaceControllerCall(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  expectedCurrentController: Address;
  expectedNextController: Address;
  nextProposer: Address;
  nextDelay: bigint;
  nextGracePeriod: bigint;
  nextGeneration: bigint;
}): BoardroomCall {
  return buildBoardroomSelfCall({
    boardroom: input.boardroom,
    data: encodeFunctionData({
      abi: boardroomAbi,
      functionName: "replaceController",
      args: [
        requireFacetSetHash(input.expectedFacetSetHash),
        input.expectedCurrentController,
        input.expectedNextController,
        input.nextProposer,
        input.nextDelay,
        input.nextGracePeriod,
        input.nextGeneration,
      ],
    }),
  });
}

export function buildBoardroomMintCall(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  to: Address;
  amount: bigint;
}): BoardroomCall {
  return buildBoardroomSelfCall({
    boardroom: input.boardroom,
    data: encodeFunctionData({
      abi: boardroomAbi,
      functionName: "mint",
      args: [requireFacetSetHash(input.expectedFacetSetHash), input.to, input.amount],
    }),
  });
}

export function buildBoardroomRegisterRedeemableAssetCall(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  asset: Address;
}): BoardroomCall {
  return buildBoardroomSelfCall({
    boardroom: input.boardroom,
    data: encodeFunctionData({
      abi: boardroomAbi,
      functionName: "registerRedeemableAsset",
      args: [requireFacetSetHash(input.expectedFacetSetHash), input.asset],
    }),
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
  expectedFacetSetHash: Hex;
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

  return buildBoardroomExecuteBatchTransaction({
    boardroom: input.boardroom,
    expectedFacetSetHash: input.expectedFacetSetHash,
    calls,
  });
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
  expectedFacetSetHash: Hex;
  policy: Address;
  market: Address;
}) {
  return buildBoardroomExecuteTransaction({
    boardroom: input.boardroom,
    expectedFacetSetHash: input.expectedFacetSetHash,
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
    functionName: "buy" as const,
    args: [input.shareAmount, input.recipient, input.maxPayment, input.deadline] as const,
  };
}

export function buildAmmSwapExactTokensForTokensTransaction(input: {
  router: Address;
  amountIn: bigint;
  amountOutMin: bigint;
  path: readonly [Address, Address];
  recipient: Address;
  deadline: bigint;
}) {
  return {
    address: input.router,
    abi: ammRouterAbi,
    functionName: "swapExactTokensForTokens" as const,
    args: [
      input.amountIn,
      input.amountOutMin,
      input.path,
      input.recipient,
      input.deadline,
    ] as const,
  };
}

export function dutchAuctionArgs(terms: DutchAuctionTerms) {
  return [
    {
      shareToken: terms.shareToken,
      paymentToken: terms.paymentToken,
      shareAmount: terms.shareAmount,
      startPrice: terms.startPrice,
      floorPrice: terms.floorPrice,
      maxPerBuyer: terms.maxPerBuyer,
      startTime: terms.startTime,
      endTime: terms.endTime,
      salt: terms.salt,
    },
  ] as const;
}

export function buildDutchAuctionBuyTransaction(input: {
  auction: Address;
  shareAmount: bigint;
  recipient: Address;
  maxPayment: bigint;
  deadline: bigint;
}) {
  return {
    address: input.auction,
    abi: dutchAuctionSaleAbi,
    functionName: "buy",
    args: [input.shareAmount, input.recipient, input.maxPayment, input.deadline] as const,
  };
}

export function buildDutchAuctionFinalizeTransaction(input: { auction: Address }) {
  return { address: input.auction, abi: dutchAuctionSaleAbi, functionName: "finalize" };
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

export function lockedLiquidityAddArgs(terms: LockedLiquidityAddTerms) {
  return [
    {
      tokenA: terms.tokenA,
      tokenB: terms.tokenB,
      amountADesired: terms.amountADesired,
      amountBDesired: terms.amountBDesired,
      amountAMin: terms.amountAMin,
      amountBMin: terms.amountBMin,
      deadline: terms.deadline,
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
  expectedFacetSetHash: Hex;
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
    expectedFacetSetHash: input.expectedFacetSetHash,
    calls,
  });
}

export function buildBoardroomFixedPriceSaleCloseAction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  policy: Address;
  sale: Address;
}) {
  return buildBoardroomExecuteTransaction({
    boardroom: input.boardroom,
    expectedFacetSetHash: input.expectedFacetSetHash,
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
  expectedFacetSetHash: Hex;
  policy: Address;
  sale: Address;
}) {
  return buildBoardroomExecuteTransaction({
    boardroom: input.boardroom,
    expectedFacetSetHash: input.expectedFacetSetHash,
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

export function buildBoardroomDutchAuctionBatch(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  factory: Address;
  shareToken: Address;
  terms: BoardroomDutchAuctionTerms;
  policy?: Address;
  assetPolicy?: Address;
}) {
  const policy = input.policy ?? input.factory;
  const assetPolicy = requireAssetPolicy(input.assetPolicy);
  const terms = { ...input.terms, shareToken: input.shareToken } satisfies DutchAuctionTerms;
  const calls = [
    buildBoardroomCall({
      policy: assetPolicy,
      target: input.shareToken,
      data: encodeFunctionData({
        abi: boardroomTokenAbi,
        functionName: "approve",
        args: [input.factory, input.terms.shareAmount],
      }),
    }),
    buildBoardroomCall({
      policy,
      target: input.factory,
      data: encodeFunctionData({
        abi: distributionFactoryAbi,
        functionName: "createDutchAuction",
        args: dutchAuctionArgs(terms),
      }),
    }),
  ] as const;

  return buildBoardroomExecuteBatchTransaction({
    boardroom: input.boardroom,
    expectedFacetSetHash: input.expectedFacetSetHash,
    calls,
  });
}

export function buildBoardroomDutchAuctionCloseAction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  policy: Address;
  auction: Address;
}) {
  return buildBoardroomExecuteTransaction({
    boardroom: input.boardroom,
    expectedFacetSetHash: input.expectedFacetSetHash,
    call: buildBoardroomCall({
      policy: input.policy,
      target: input.auction,
      data: encodeFunctionData({ abi: dutchAuctionSaleAbi, functionName: "close" }),
    }),
  });
}

export function buildBoardroomDutchAuctionCancelAction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  policy: Address;
  auction: Address;
}) {
  return buildBoardroomExecuteTransaction({
    boardroom: input.boardroom,
    expectedFacetSetHash: input.expectedFacetSetHash,
    call: buildBoardroomCall({
      policy: input.policy,
      target: input.auction,
      data: encodeFunctionData({ abi: dutchAuctionSaleAbi, functionName: "cancel" }),
    }),
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
  expectedFacetSetHash: Hex;
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
    expectedFacetSetHash: input.expectedFacetSetHash,
    calls,
  });
}

export function buildBoardroomMigratingCurveCancelAction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  policy: Address;
  curve: Address;
}) {
  return buildBoardroomExecuteTransaction({
    boardroom: input.boardroom,
    expectedFacetSetHash: input.expectedFacetSetHash,
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

/**
 * Migration and settlement call back into the Boardroom, so the caller commits to the release
 * those callbacks must execute under. An activation landing first reverts the transaction.
 */
export function buildMigratingBondingCurveMigrationTransaction(input: {
  curve: Address;
  expectedFacetSetHash: Hex;
  minShareLiquidity: bigint;
  minQuoteLiquidity: bigint;
  deadline: bigint;
}) {
  return {
    address: input.curve,
    abi: migratingBondingCurveAbi,
    functionName: "migrate",
    args: [
      input.expectedFacetSetHash,
      input.minShareLiquidity,
      input.minQuoteLiquidity,
      input.deadline,
    ] as const,
  };
}

export function buildMigratingBondingCurveExpireTransaction(curve: Address) {
  return { address: curve, abi: migratingBondingCurveAbi, functionName: "expire" } as const;
}

export function buildMigratingBondingCurveFallbackTransaction(curve: Address) {
  return { address: curve, abi: migratingBondingCurveAbi, functionName: "fallbackToUnwind" } as const;
}

export function buildMigratingBondingCurveFinalizeUnwindTransaction(curve: Address, expectedFacetSetHash: Hex) {
  return {
    address: curve,
    abi: migratingBondingCurveAbi,
    functionName: "finalizeUnwind",
    args: [expectedFacetSetHash] as const,
  } as const;
}

export function buildMigratingBondingCurveRecoverQuoteTransaction(curve: Address, expectedFacetSetHash: Hex) {
  return {
    address: curve,
    abi: migratingBondingCurveAbi,
    functionName: "recoverQuarantinedQuote",
    args: [expectedFacetSetHash] as const,
  } as const;
}

export function buildMigratingBondingCurveOpenForfeitureTransaction(curve: Address) {
  return { address: curve, abi: migratingBondingCurveAbi, functionName: "openQuoteForfeiture" } as const;
}

export function buildMigratingBondingCurveVetoForfeitureTransaction(curve: Address) {
  return { address: curve, abi: migratingBondingCurveAbi, functionName: "vetoQuoteForfeiture" } as const;
}

export function buildMigratingBondingCurveFinalizeForfeitureTransaction(curve: Address, expectedFacetSetHash: Hex) {
  return {
    address: curve,
    abi: migratingBondingCurveAbi,
    functionName: "finalizeQuoteForfeiture",
    args: [expectedFacetSetHash] as const,
  } as const;
}

export function buildMigratingBondingCurveRecoverForfeitedQuoteTransaction(curve: Address) {
  return { address: curve, abi: migratingBondingCurveAbi, functionName: "recoverForfeitedQuote" } as const;
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
  expectedFacetSetHash: Hex;
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
    expectedFacetSetHash: input.expectedFacetSetHash,
    calls,
  });
}

export function buildBoardroomMerkleAirdropCloseAction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  policy: Address;
  airdrop: Address;
}) {
  return buildBoardroomExecuteTransaction({
    boardroom: input.boardroom,
    expectedFacetSetHash: input.expectedFacetSetHash,
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
  expectedFacetSetHash: Hex;
  policy: Address;
  airdrop: Address;
}) {
  return buildBoardroomExecuteTransaction({
    boardroom: input.boardroom,
    expectedFacetSetHash: input.expectedFacetSetHash,
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
  expectedFacetSetHash: Hex;
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
    expectedFacetSetHash: input.expectedFacetSetHash,
    calls,
  });
}

export function buildBoardroomLockedLiquidityAddCall(input: {
  policy: Address;
  factory: Address;
  terms: LockedLiquidityAddTerms;
}): BoardroomCall {
  return buildBoardroomCall({
    policy: input.policy,
    target: input.factory,
    data: encodeFunctionData({
      abi: lockedLiquidityFactoryAbi,
      functionName: "addLockedLiquidity",
      args: lockedLiquidityAddArgs(input.terms),
    }),
  });
}

export function buildBoardroomLockedLiquidityAddBatch(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  factory: Address;
  shareToken: Address;
  terms: BoardroomLockedLiquidityAddTerms;
  policy?: Address;
  assetPolicy?: Address;
}) {
  const policy = input.policy ?? input.factory;
  const assetPolicy = requireAssetPolicy(input.assetPolicy);
  const shareTokenSide = input.terms.shareTokenSide ?? "tokenA";
  const terms = shareTokenSide === "tokenA"
    ? ({
        tokenA: input.shareToken,
        tokenB: input.terms.quoteToken,
        amountADesired: input.terms.shareAmountDesired,
        amountBDesired: input.terms.quoteAmountDesired,
        amountAMin: input.terms.shareAmountMin,
        amountBMin: input.terms.quoteAmountMin,
        deadline: input.terms.deadline,
      } satisfies LockedLiquidityAddTerms)
    : ({
        tokenA: input.terms.quoteToken,
        tokenB: input.shareToken,
        amountADesired: input.terms.quoteAmountDesired,
        amountBDesired: input.terms.shareAmountDesired,
        amountAMin: input.terms.quoteAmountMin,
        amountBMin: input.terms.shareAmountMin,
        deadline: input.terms.deadline,
      } satisfies LockedLiquidityAddTerms);
  return buildBoardroomExecuteBatchTransaction({
    boardroom: input.boardroom,
    expectedFacetSetHash: input.expectedFacetSetHash,
    calls: [
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
      buildBoardroomLockedLiquidityAddCall({ policy, factory: input.factory, terms }),
    ],
  });
}

export function buildBoardroomLockedLiquidityRemoveCall(input: {
  policy: Address;
  factory: Address;
  liquidity: bigint;
  amountAMin: bigint;
  amountBMin: bigint;
  deadline: bigint;
}): BoardroomCall {
  return buildBoardroomCall({
    policy: input.policy,
    target: input.factory,
    data: encodeFunctionData({
      abi: lockedLiquidityFactoryAbi,
      functionName: "removeLockedLiquidity",
      args: [{
        liquidity: input.liquidity,
        amountAMin: input.amountAMin,
        amountBMin: input.amountBMin,
        deadline: input.deadline,
      }],
    }),
  });
}

export function buildBoardroomLockedLiquidityRemoveAction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  policy: Address;
  factory: Address;
  liquidity: bigint;
  amountAMin: bigint;
  amountBMin: bigint;
  deadline: bigint;
}) {
  return buildBoardroomExecuteTransaction({
    boardroom: input.boardroom,
    expectedFacetSetHash: input.expectedFacetSetHash,
    call: buildBoardroomLockedLiquidityRemoveCall(input),
  });
}

export function buildBoardroomLockedLiquidityCloseCall(input: {
  policy: Address;
  factory: Address;
}): BoardroomCall {
  return buildBoardroomCall({
    policy: input.policy,
    target: input.factory,
    data: encodeFunctionData({ abi: lockedLiquidityFactoryAbi, functionName: "closeLockedLiquidity" }),
  });
}

export function buildBoardroomLockedLiquidityCloseAction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  policy: Address;
  factory: Address;
}) {
  return buildBoardroomExecuteTransaction({
    boardroom: input.boardroom,
    expectedFacetSetHash: input.expectedFacetSetHash,
    call: buildBoardroomLockedLiquidityCloseCall(input),
  });
}

export function buildBoardroomLockedLiquidityExitTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  amountAMin: bigint;
  amountBMin: bigint;
  deadline: bigint;
}) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "exitProtocolLiquidity",
    args: [
      requireFacetSetHash(input.expectedFacetSetHash),
      input.amountAMin,
      input.amountBMin,
      input.deadline,
    ] as const,
  };
}

export function buildBoardroomReturnProtocolLiquidityAsLpTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
}) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "returnProtocolLiquidityAsLp",
    args: [requireFacetSetHash(input.expectedFacetSetHash)] as const,
  };
}

export function buildBoardroomCloseProtocolLiquidityTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
}) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "closeProtocolLiquidityAfterWindDown",
    args: [requireFacetSetHash(input.expectedFacetSetHash)] as const,
  };
}

export function buildBoardroomLockedLiquidityFeeClaimAction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  policy: Address;
  locker: Address;
}) {
  return buildBoardroomExecuteTransaction({
    boardroom: input.boardroom,
    expectedFacetSetHash: input.expectedFacetSetHash,
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
  expectedFacetSetHash: Hex;
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
    expectedFacetSetHash: input.expectedFacetSetHash,
    calls,
    value: input.creationFee ?? 0n,
  });
}

export function buildGrantIssuerBoardroomAction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  policy: Address;
  grant: Address;
  functionName: "stopVestingAndWithdrawUnvested" | "withdrawExpiredTokens";
}) {
  return buildBoardroomExecuteTransaction({
    boardroom: input.boardroom,
    expectedFacetSetHash: input.expectedFacetSetHash,
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
