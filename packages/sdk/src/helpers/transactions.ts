import { encodeAbiParameters, encodeFunctionData, parseAbi, parseAbiParameters, type Address, type Hex } from "viem";
import {
  boardroomAbi,
  boardroomFactoryAbi,
  erc20Abi,
  liquidityLockerAbi,
  liquidityLockerFactoryAbi,
  positionManagerAbi,
  protocolFeeRouterAbi,
  tokenGrantAbi,
  tokenGrantFactoryAbi,
} from "../generated";
import type {
  BoardroomCall,
  GrantCreationArgs,
  GrantCreationTerms,
  LiquidityLockerCreationTerms,
  UniswapV4PoolKey,
} from "./types";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const satisfies Address;
const MAX_UINT128 = (1n << 128n) - 1n;
const MAX_UINT160 = (1n << 160n) - 1n;
const UNIVERSAL_ROUTER_V4_SWAP = "0x10" as const satisfies Hex;
const V4_EXACT_INPUT_SINGLE_ACTIONS = "0x060c0e" as const satisfies Hex;

export const uniswapUniversalRouterAbi = parseAbi([
  "function execute(bytes commands, bytes[] inputs, uint256 deadline) payable",
]);
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

function requireBytes32(value: Hex, name: string): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${name} must be a 32-byte hex value.`);
  return value;
}

function requireUint128(value: bigint, name: string): bigint {
  if (value < 0n || value > MAX_UINT128) throw new Error(`${name} must fit uint128.`);
  return value;
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
    requireBytes32(terms.salt, "Grant salt"),
  ] as const;
}

export function buildErc20Approval(input: { token: Address; spender: Address; amount: bigint }) {
  if (input.amount < 0n) throw new Error("ERC20 approval amount cannot be negative.");
  return {
    address: input.token,
    abi: erc20Abi,
    functionName: "approve" as const,
    args: [input.spender, input.amount] as const,
  };
}

export function buildBoardroomCreateTransaction(input: {
  factory: Address;
  owner: Address;
  name: string;
  symbol: string;
  salt: Hex;
}) {
  return {
    address: input.factory,
    abi: boardroomFactoryAbi,
    functionName: "createBoardroom" as const,
    args: [input.owner, input.name, input.symbol, requireBytes32(input.salt, "Boardroom salt")] as const,
  };
}

export function buildBoardroomMintTransaction(input: { boardroom: Address; to: Address; amount: bigint }) {
  if (input.amount <= 0n) throw new Error("Boardroom mint amount must be positive.");
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "mint" as const,
    args: [input.to, input.amount] as const,
  };
}

export function buildBoardroomLaunchTransaction(input: { boardroom: Address }) {
  return { address: input.boardroom, abi: boardroomAbi, functionName: "launch" as const };
}

export function buildBoardroomSetRedemptionExcessRecipientTransaction(input: {
  boardroom: Address;
  recipient: Address;
}) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "setRedemptionExcessRecipient" as const,
    args: [input.recipient] as const,
  };
}

export function buildBoardroomTransferOwnershipTransaction(input: {
  boardroom: Address;
  newOwner: Address;
}) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "transferOwnership" as const,
    args: [input.newOwner] as const,
  };
}

export function buildBoardroomStartWindDownTransaction(input: { boardroom: Address }) {
  return { address: input.boardroom, abi: boardroomAbi, functionName: "startWindDown" as const };
}

export function buildBoardroomBeginSnapshotTransaction(input: { boardroom: Address }) {
  return { address: input.boardroom, abi: boardroomAbi, functionName: "beginSnapshot" as const };
}

export function buildBoardroomSnapshotAssetsTransaction(input: { boardroom: Address; maximum: bigint }) {
  if (input.maximum <= 0n || input.maximum > 32n) {
    throw new Error("Boardroom snapshot pages must contain between 1 and 32 assets.");
  }
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "snapshotAssets" as const,
    args: [input.maximum] as const,
  };
}

export function buildBoardroomPruneEscrowTransaction(input: { boardroom: Address; escrow: Address }) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "pruneEscrow" as const,
    args: [input.escrow] as const,
  };
}

export function buildBoardroomWrapNativeBalanceTransaction(input: { boardroom: Address }) {
  return { address: input.boardroom, abi: boardroomAbi, functionName: "wrapNativeBalance" as const };
}

export function buildBoardroomBurnTreasurySharesTransaction(input: { boardroom: Address }) {
  return { address: input.boardroom, abi: boardroomAbi, functionName: "burnTreasuryShares" as const };
}

export function buildBoardroomOpenRedemptionsTransaction(input: { boardroom: Address }) {
  return { address: input.boardroom, abi: boardroomAbi, functionName: "openRedemptions" as const };
}

export function buildBoardroomRegisterRedeemableAssetTransaction(input: { boardroom: Address; asset: Address }) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "registerRedeemableAsset" as const,
    args: [input.asset] as const,
  };
}

export function buildBoardroomTreasuryContributionTransaction(input: {
  boardroom: Address;
  asset: Address;
  amount: bigint;
  deadline: bigint;
}) {
  if (input.amount <= 0n) throw new Error("Treasury contribution amount must be positive.");
  if (input.deadline <= 0n) throw new Error("Treasury contribution requires a deadline.");
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "contributeTreasuryAsset" as const,
    args: [input.asset, input.amount, input.deadline] as const,
  };
}

export function buildBoardroomRedeemTransaction(input: { boardroom: Address; shares: bigint }) {
  if (input.shares <= 0n) throw new Error("Redemption share amount must be positive.");
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "redeem" as const,
    args: [input.shares] as const,
  };
}

export function buildBoardroomClaimRedemptionAssetTransaction(input: {
  boardroom: Address;
  asset: Address;
  recipient: Address;
  minAmountOut: bigint;
}) {
  if (input.minAmountOut < 0n) throw new Error("Minimum redemption amount cannot be negative.");
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "claimRedemptionAsset" as const,
    args: [input.asset, input.recipient, input.minAmountOut] as const,
  };
}

export function buildBoardroomSweepRedemptionExcessTransaction(input: { boardroom: Address; asset: Address }) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "sweepRedemptionExcess" as const,
    args: [input.asset] as const,
  };
}

export function buildBoardroomCall(input: { target: Address; data: Hex; value?: bigint }): BoardroomCall {
  if (input.value !== undefined && input.value < 0n) throw new Error("Boardroom call value cannot be negative.");
  return { target: input.target, value: input.value ?? 0n, data: input.data };
}

export function buildBoardroomExecuteTransaction(input: {
  boardroom: Address;
  call: BoardroomCall;
  value?: bigint;
}) {
  const value = input.value ?? input.call.value;
  if (value !== input.call.value) throw new Error("Boardroom execute value must equal the call value.");
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "execute" as const,
    args: [input.call] as const,
    value,
  };
}

export function buildBoardroomExecuteBatchTransaction(input: {
  boardroom: Address;
  calls: readonly BoardroomCall[];
  value?: bigint;
}) {
  if (input.calls.length === 0 || input.calls.length > 16) {
    throw new Error("Boardroom execution batches must contain between 1 and 16 calls.");
  }
  const requiredValue = input.calls.reduce((total, call) => total + call.value, 0n);
  const value = input.value ?? requiredValue;
  if (value !== requiredValue) throw new Error("Boardroom batch value must equal the sum of call values.");
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "executeBatch" as const,
    args: [input.calls] as const,
    value,
  };
}

export function buildBoardroomExecuteEscrowTransaction(input: {
  boardroom: Address;
  escrow: Address;
  data: Hex;
}) {
  return {
    address: input.boardroom,
    abi: boardroomAbi,
    functionName: "executeEscrow" as const,
    args: [input.escrow, input.data] as const,
  };
}

export function buildGrantSettlementTransaction(input: { grant: Address; amount: bigint }) {
  if (input.amount <= 0n) throw new Error("Grant settlement amount must be positive.");
  return { address: input.grant, abi: tokenGrantAbi, functionName: "settle" as const, args: [input.amount] as const };
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
    functionName: "safeTransferFrom" as const,
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
    functionName: "createGrant" as const,
    args: grantCreationArgs(input.terms),
    value: input.creationFee ?? 0n,
  };
}

export function buildBoardroomGrantApprovalCall(input: {
  token: Address;
  factory: Address;
  amount: bigint;
}): BoardroomCall {
  if (input.amount <= 0n) throw new Error("Grant approval amount must be positive.");
  return buildBoardroomCall({
    target: input.token,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [input.factory, input.amount],
    }),
  });
}

export function buildBoardroomGrantCreationCall(input: {
  factory: Address;
  terms: GrantCreationTerms;
  creationFee?: bigint;
}): BoardroomCall {
  return buildBoardroomCall({
    target: input.factory,
    value: input.creationFee ?? 0n,
    data: encodeFunctionData({
      abi: tokenGrantFactoryAbi,
      functionName: "createGrant",
      args: grantCreationArgs(input.terms),
    }),
  });
}

export function buildBoardroomAssetGrantIssuanceBatch(input: {
  boardroom: Address;
  factory: Address;
  shareToken: Address;
  terms: GrantCreationTerms;
  creationFee?: bigint;
}) {
  if (input.terms.token.toLowerCase() === input.shareToken.toLowerCase()) {
    throw new Error("Boardroom share tokens cannot be grant assets because owner execution rejects the share-token target.");
  }
  return buildBoardroomExecuteBatchTransaction({
    boardroom: input.boardroom,
    calls: [
      buildBoardroomGrantApprovalCall({ token: input.terms.token, factory: input.factory, amount: input.terms.amount }),
      buildBoardroomGrantCreationCall({
        factory: input.factory,
        terms: input.terms,
        creationFee: input.creationFee ?? 0n,
      }),
    ],
  });
}

export function buildGrantIssuerBoardroomCall(input: {
  grant: Address;
  functionName: "quarantineAndClose" | "stopVestingAndWithdrawUnvested" | "withdrawExpiredTokens";
}): BoardroomCall {
  return buildBoardroomCall({
    target: input.grant,
    data: encodeFunctionData({ abi: tokenGrantAbi, functionName: input.functionName }),
  });
}

export function buildGrantIssuerBoardroomAction(input: {
  boardroom: Address;
  grant: Address;
  status: 0 | 1;
  functionName: "quarantineAndClose" | "stopVestingAndWithdrawUnvested" | "withdrawExpiredTokens";
}) {
  const call = buildGrantIssuerBoardroomCall(input);
  return input.status === 0
    ? buildBoardroomExecuteTransaction({ boardroom: input.boardroom, call })
    : buildBoardroomExecuteEscrowTransaction({ boardroom: input.boardroom, escrow: input.grant, data: call.data });
}

export function buildLiquidityLockerCreationCall(input: {
  factory: Address;
  terms: LiquidityLockerCreationTerms;
}): BoardroomCall {
  return buildBoardroomCall({
    target: input.factory,
    data: encodeFunctionData({
      abi: liquidityLockerFactoryAbi,
      functionName: "createLocker",
      args: [
        input.terms.quoteAsset,
        input.terms.poolFee,
        input.terms.tickSpacing,
        requireBytes32(input.terms.salt, "Liquidity locker salt"),
      ],
    }),
  });
}

export function buildBoardroomCreateLiquidityLockerTransaction(input: {
  boardroom: Address;
  factory: Address;
  terms: LiquidityLockerCreationTerms;
}) {
  return buildBoardroomExecuteTransaction({
    boardroom: input.boardroom,
    call: buildLiquidityLockerCreationCall(input),
  });
}

function buildLiquidityLockerCall(input: {
  locker: Address;
  functionName: "preparePositionTransfer" | "registerPosition";
  tokenId: bigint;
}): BoardroomCall {
  return buildBoardroomCall({
    target: input.locker,
    data: encodeFunctionData({ abi: liquidityLockerAbi, functionName: input.functionName, args: [input.tokenId] }),
  });
}

export function buildBoardroomPreparePositionTransferTransaction(input: {
  boardroom: Address;
  locker: Address;
  tokenId: bigint;
}) {
  return buildBoardroomExecuteTransaction({
    boardroom: input.boardroom,
    call: buildLiquidityLockerCall({ ...input, functionName: "preparePositionTransfer" }),
  });
}

export function buildBoardroomRegisterLiquidityPositionTransaction(input: {
  boardroom: Address;
  locker: Address;
  tokenId: bigint;
}) {
  return buildBoardroomExecuteTransaction({
    boardroom: input.boardroom,
    call: buildLiquidityLockerCall({ ...input, functionName: "registerPosition" }),
  });
}

export function buildBoardroomCancelPositionTransferTransaction(input: {
  boardroom: Address;
  locker: Address;
}) {
  return buildBoardroomExecuteTransaction({
    boardroom: input.boardroom,
    call: buildBoardroomCall({
      target: input.locker,
      data: encodeFunctionData({ abi: liquidityLockerAbi, functionName: "cancelPositionTransfer" }),
    }),
  });
}

export function buildBoardroomRecoverUntrackedPositionTransaction(input: {
  boardroom: Address;
  locker: Address;
  tokenId: bigint;
  recipient: Address;
  status: 0 | 1;
}) {
  const data = encodeFunctionData({
    abi: liquidityLockerAbi,
    functionName: "recoverUntrackedPosition",
    args: [input.tokenId, input.recipient],
  });
  return input.status === 0
    ? buildBoardroomExecuteTransaction({
        boardroom: input.boardroom,
        call: buildBoardroomCall({ target: input.locker, data }),
      })
    : buildBoardroomExecuteEscrowTransaction({ boardroom: input.boardroom, escrow: input.locker, data });
}

export function buildPositionManagerSafeTransferToLockerTransaction(input: {
  positionManager: Address;
  from: Address;
  locker: Address;
  tokenId: bigint;
}) {
  return {
    address: input.positionManager,
    abi: positionManagerAbi,
    functionName: "safeTransferFrom" as const,
    args: [input.from, input.locker, input.tokenId] as const,
  };
}

export function buildLiquidityLockerCollectFeesTransaction(input: { locker: Address }) {
  return { address: input.locker, abi: liquidityLockerAbi, functionName: "collectFees" as const };
}

export function buildBoardroomLiquidityLockerCancelTransaction(input: {
  boardroom: Address;
  locker: Address;
  status: 0 | 1;
}) {
  const data = encodeFunctionData({ abi: liquidityLockerAbi, functionName: "cancel" });
  return input.status === 0
    ? buildBoardroomExecuteTransaction({ boardroom: input.boardroom, call: buildBoardroomCall({ target: input.locker, data }) })
    : buildBoardroomExecuteEscrowTransaction({ boardroom: input.boardroom, escrow: input.locker, data });
}

export function buildBoardroomLiquidityLockerExitTransaction(input: {
  boardroom: Address;
  locker: Address;
  amount0Min: bigint;
  amount1Min: bigint;
  deadline: bigint;
}) {
  if (input.deadline <= 0n) throw new Error("Liquidity exit requires a deadline.");
  const data = encodeFunctionData({
    abi: liquidityLockerAbi,
    functionName: "exit",
    args: [requireUint128(input.amount0Min, "amount0Min"), requireUint128(input.amount1Min, "amount1Min"), input.deadline],
  });
  return buildBoardroomExecuteEscrowTransaction({
    boardroom: input.boardroom,
    escrow: input.locker,
    data,
  });
}

export function buildProtocolFeeForwardTokenTransaction(input: { router: Address; token: Address }) {
  return {
    address: input.router,
    abi: protocolFeeRouterAbi,
    functionName: "forwardToken" as const,
    args: [input.token] as const,
  };
}

export function buildProtocolFeeForwardNativeTransaction(input: { router: Address }) {
  return { address: input.router, abi: protocolFeeRouterAbi, functionName: "forwardNative" as const };
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
  requireUint128(input.amountOutMin, "amountOutMin");
  if (input.deadline <= 0n) throw new Error("Uniswap v4 swaps require a deadline.");
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
    ...(input.currencyIn.toLowerCase() === ZERO_ADDRESS ? { value: input.amountIn } : {}),
  };
}

export function buildPermit2ApprovalTransaction(input: {
  permit2: Address;
  token: Address;
  universalRouter: Address;
  amount: bigint;
  expiration: number;
}) {
  if (input.amount < 0n || input.amount > MAX_UINT160) throw new Error("Permit2 amount must fit uint160.");
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
