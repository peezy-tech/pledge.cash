import { encodeAbiParameters, encodeFunctionData, parseAbi, parseAbiParameters, type Address, type Hex } from "viem";
import {
  boardroomAbi,
  boardroomControllerAbi,
  boardroomFactoryAbi,
  boardroomTokenAbi,
  erc20Abi,
  pledgeV4LiquidityFactoryAbi,
  pledgeV4LiquidityVaultAbi,
  tokenGrantAbi,
  tokenGrantFactoryAbi,
} from "../generated";
import type {
  BoardroomCall,
  BoardroomLaunchConfig,
  BoardroomProtocolLiquidityTerms,
  BoardroomProtocolLiquidityAddTerms,
  BoardroomShareGrantTerms,
  GrantCreationArgs,
  GrantCreationTerms,
  ProtocolLiquidityTerms,
  ProtocolLiquidityAddTerms,
  UniswapV4PoolKey,
} from "./types";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const satisfies Address;
const MAX_UINT128 = (1n << 128n) - 1n;
const UNIVERSAL_ROUTER_V4_SWAP = "0x10" as const satisfies Hex;
const V4_EXACT_INPUT_SINGLE_ACTIONS = "0x060c0e" as const satisfies Hex;
export const uniswapUniversalRouterAbi = parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"]);
export const permit2Abi = parseAbi([
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
]);
const exactInputSingleParameters = parseAbiParameters(
  "(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, bytes hookData",
);
const currencyAndAmountParameters = parseAbiParameters("address currency, uint256 amount");
const currencyRecipientAndAmountParameters = parseAbiParameters(
  "address currency, address recipient, uint256 amount",
);
const v4SwapCommandParameters = parseAbiParameters("bytes actions, bytes[] params");

export function deriveUniswapV4SqrtPriceX96(input: {
  tokenA: Address;
  tokenB: Address;
  amountA: bigint;
  amountB: bigint;
}): bigint {
  if (input.tokenA.toLowerCase() === input.tokenB.toLowerCase()) {
    throw new Error("Uniswap v4 currencies must be distinct.");
  }
  if (input.amountA <= 0n || input.amountB <= 0n) {
    throw new Error("Uniswap v4 price amounts must be positive.");
  }
  const tokenAIsCurrency0 = input.tokenA.toLowerCase() < input.tokenB.toLowerCase();
  const amount0 = tokenAIsCurrency0 ? input.amountA : input.amountB;
  const amount1 = tokenAIsCurrency0 ? input.amountB : input.amountA;
  const sqrtPriceX96 = integerSqrt((amount1 << 192n) / amount0);
  if (sqrtPriceX96 < 4_295_128_739n || sqrtPriceX96 >= 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342n) {
    throw new Error("Derived Uniswap v4 price is outside TickMath bounds.");
  }
  return sqrtPriceX96;
}

function integerSqrt(value: bigint): bigint {
  if (value < 0n) throw new Error("Cannot take the square root of a negative bigint.");
  if (value < 2n) return value;
  let left = 1n;
  let right = 1n << BigInt((value.toString(2).length + 1) >> 1);
  while (left + 1n < right) {
    const middle = (left + right) >> 1n;
    if (middle * middle <= value) left = middle;
    else right = middle;
  }
  return left;
}

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

export function buildUniswapV4SwapExactInputSingleTransaction(input: {
  universalRouter: Address;
  poolKey: UniswapV4PoolKey;
  currencyIn: Address;
  amountIn: bigint;
  amountOutMin: bigint;
  recipient: Address;
  deadline: bigint;
  hookData?: Hex;
}) {
  if (input.amountIn <= 0n || input.amountIn > MAX_UINT128) {
    throw new Error("amountIn must fit a positive uint128.");
  }
  if (input.amountOutMin < 0n || input.amountOutMin > MAX_UINT128) {
    throw new Error("amountOutMin must fit uint128.");
  }
  const currency0 = input.poolKey.currency0.toLowerCase();
  const currency1 = input.poolKey.currency1.toLowerCase();
  if (currency0 >= currency1) throw new Error("Uniswap v4 PoolKey currencies must be sorted.");
  const currencyIn = input.currencyIn.toLowerCase();
  if (currencyIn !== currency0 && currencyIn !== currency1) {
    throw new Error("currencyIn is not part of the PoolKey.");
  }
  const zeroForOne = currencyIn === currency0;
  const currencyOut = zeroForOne ? input.poolKey.currency1 : input.poolKey.currency0;
  const params = [
    encodeAbiParameters(exactInputSingleParameters, [
      input.poolKey,
      zeroForOne,
      input.amountIn,
      input.amountOutMin,
      input.hookData ?? "0x",
    ]),
    encodeAbiParameters(currencyAndAmountParameters, [input.currencyIn, input.amountIn]),
    encodeAbiParameters(currencyRecipientAndAmountParameters, [currencyOut, input.recipient, 0n]),
  ] as const;
  const commandInput = encodeAbiParameters(v4SwapCommandParameters, [V4_EXACT_INPUT_SINGLE_ACTIONS, params]);
  return {
    address: input.universalRouter,
    abi: uniswapUniversalRouterAbi,
    functionName: "execute" as const,
    args: [UNIVERSAL_ROUTER_V4_SWAP, [commandInput], input.deadline] as const,
  };
}

export function buildPermit2ApprovalTransaction(input: {
  permit2: Address;
  token: Address;
  universalRouter: Address;
  amount: bigint;
  expiration: number;
}) {
  if (input.amount < 0n || input.amount >= 1n << 160n) throw new Error("Permit2 amount must fit uint160.");
  if (!Number.isSafeInteger(input.expiration) || input.expiration < 0 || input.expiration >= 2 ** 48) {
    throw new Error("Permit2 expiration must fit uint48.");
  }
  return {
    address: input.permit2,
    abi: permit2Abi,
    functionName: "approve" as const,
    args: [input.token, input.universalRouter, input.amount, input.expiration] as const,
  };
}

export function protocolLiquidityArgs(terms: ProtocolLiquidityTerms) {
  return [
    {
      tokenA: terms.tokenA,
      tokenB: terms.tokenB,
      amountADesired: terms.amountADesired,
      amountBDesired: terms.amountBDesired,
      amountAMin: terms.amountAMin,
      amountBMin: terms.amountBMin,
      sqrtPriceX96: terms.sqrtPriceX96,
      deadline: terms.deadline,
      salt: terms.salt,
    },
  ] as const;
}

export function protocolLiquidityAddArgs(terms: ProtocolLiquidityAddTerms) {
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

export function buildBoardroomProtocolLiquidityApprovalCall(input: {
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

export function buildBoardroomProtocolLiquidityCreationCall(input: {
  policy: Address;
  factory: Address;
  terms: ProtocolLiquidityTerms;
}): BoardroomCall {
  return buildBoardroomCall({
    policy: input.policy,
    target: input.factory,
    data: encodeFunctionData({
      abi: pledgeV4LiquidityFactoryAbi,
      functionName: "createProtocolLiquidity",
      args: protocolLiquidityArgs(input.terms),
    }),
  });
}

export function buildBoardroomProtocolLiquidityBatch(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  factory: Address;
  shareToken: Address;
  terms: BoardroomProtocolLiquidityTerms;
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
          sqrtPriceX96: input.terms.sqrtPriceX96,
          deadline: input.terms.deadline,
          salt: input.terms.salt,
        } satisfies ProtocolLiquidityTerms)
      : ({
          tokenA: input.terms.quoteToken,
          tokenB: input.shareToken,
          amountADesired: input.terms.quoteAmountDesired,
          amountBDesired: input.terms.shareAmountDesired,
          amountAMin: input.terms.quoteAmountMin,
          amountBMin: input.terms.shareAmountMin,
          sqrtPriceX96: input.terms.sqrtPriceX96,
          deadline: input.terms.deadline,
          salt: input.terms.salt,
        } satisfies ProtocolLiquidityTerms);
  const calls = [
    buildBoardroomProtocolLiquidityApprovalCall({
      policy: assetPolicy,
      token: input.shareToken,
      factory: input.factory,
      amount: input.terms.shareAmountDesired,
    }),
    buildBoardroomProtocolLiquidityApprovalCall({
      policy: assetPolicy,
      token: input.terms.quoteToken,
      factory: input.factory,
      amount: input.terms.quoteAmountDesired,
    }),
    buildBoardroomProtocolLiquidityCreationCall({
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

export function buildBoardroomProtocolLiquidityAddCall(input: {
  policy: Address;
  factory: Address;
  terms: ProtocolLiquidityAddTerms;
}): BoardroomCall {
  return buildBoardroomCall({
    policy: input.policy,
    target: input.factory,
    data: encodeFunctionData({
      abi: pledgeV4LiquidityFactoryAbi,
      functionName: "addProtocolLiquidity",
      args: protocolLiquidityAddArgs(input.terms),
    }),
  });
}

export function buildBoardroomProtocolLiquidityAddBatch(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  factory: Address;
  shareToken: Address;
  terms: BoardroomProtocolLiquidityAddTerms;
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
      } satisfies ProtocolLiquidityAddTerms)
    : ({
        tokenA: input.terms.quoteToken,
        tokenB: input.shareToken,
        amountADesired: input.terms.quoteAmountDesired,
        amountBDesired: input.terms.shareAmountDesired,
        amountAMin: input.terms.quoteAmountMin,
        amountBMin: input.terms.shareAmountMin,
        deadline: input.terms.deadline,
      } satisfies ProtocolLiquidityAddTerms);
  return buildBoardroomExecuteBatchTransaction({
    boardroom: input.boardroom,
    expectedFacetSetHash: input.expectedFacetSetHash,
    calls: [
      buildBoardroomProtocolLiquidityApprovalCall({
        policy: assetPolicy,
        token: input.shareToken,
        factory: input.factory,
        amount: input.terms.shareAmountDesired,
      }),
      buildBoardroomProtocolLiquidityApprovalCall({
        policy: assetPolicy,
        token: input.terms.quoteToken,
        factory: input.factory,
        amount: input.terms.quoteAmountDesired,
      }),
      buildBoardroomProtocolLiquidityAddCall({ policy, factory: input.factory, terms }),
    ],
  });
}

export function buildBoardroomProtocolLiquidityRemoveCall(input: {
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
      abi: pledgeV4LiquidityFactoryAbi,
      functionName: "removeProtocolLiquidity",
      args: [{
        liquidity: input.liquidity,
        amountAMin: input.amountAMin,
        amountBMin: input.amountBMin,
        deadline: input.deadline,
      }],
    }),
  });
}

export function buildBoardroomProtocolLiquidityRemoveAction(input: {
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
    call: buildBoardroomProtocolLiquidityRemoveCall(input),
  });
}

export function buildBoardroomProtocolLiquidityCloseCall(input: {
  policy: Address;
  factory: Address;
}): BoardroomCall {
  return buildBoardroomCall({
    policy: input.policy,
    target: input.factory,
    data: encodeFunctionData({ abi: pledgeV4LiquidityFactoryAbi, functionName: "closeProtocolLiquidity" }),
  });
}

export function buildBoardroomProtocolLiquidityCloseAction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  policy: Address;
  factory: Address;
}) {
  return buildBoardroomExecuteTransaction({
    boardroom: input.boardroom,
    expectedFacetSetHash: input.expectedFacetSetHash,
    call: buildBoardroomProtocolLiquidityCloseCall(input),
  });
}

export function buildBoardroomProtocolLiquidityExitTransaction(input: {
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

export function buildBoardroomReturnProtocolLiquidityClaimsTransaction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
}) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "returnProtocolLiquidityClaims",
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

export function buildBoardroomProtocolLiquidityFeeClaimAction(input: {
  boardroom: Address;
  expectedFacetSetHash: Hex;
  policy: Address;
  vault: Address;
}) {
  return buildBoardroomExecuteTransaction({
    boardroom: input.boardroom,
    expectedFacetSetHash: input.expectedFacetSetHash,
    call: buildBoardroomProtocolLiquidityFeeClaimCall(input),
  });
}

export function buildBoardroomProtocolLiquidityFeeClaimCall(input: { policy: Address; vault: Address }): BoardroomCall {
  return buildBoardroomCall({
    policy: input.policy,
    target: input.vault,
    data: encodeFunctionData({ abi: pledgeV4LiquidityVaultAbi, functionName: "claimFees" }),
  });
}

export function buildProtocolLiquidityClaimDepositTransaction(input: {
  vault: Address;
  amountADesired: bigint;
  amountBDesired: bigint;
  amountAMin: bigint;
  amountBMin: bigint;
  recipient: Address;
  deadline: bigint;
}) {
  return {
    address: input.vault,
    abi: pledgeV4LiquidityVaultAbi,
    functionName: "depositLiquidityForClaims" as const,
    args: [
      input.amountADesired,
      input.amountBDesired,
      input.amountAMin,
      input.amountBMin,
      input.recipient,
      input.deadline,
    ] as const,
  };
}

export function buildProtocolLiquidityClaimRedemptionTransaction(input: {
  vault: Address;
  claims: bigint;
  amountAMin: bigint;
  amountBMin: bigint;
  recipient: Address;
  deadline: bigint;
}) {
  return {
    address: input.vault,
    abi: pledgeV4LiquidityVaultAbi,
    functionName: "redeemClaims" as const,
    args: [input.claims, input.amountAMin, input.amountBMin, input.recipient, input.deadline] as const,
  };
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
