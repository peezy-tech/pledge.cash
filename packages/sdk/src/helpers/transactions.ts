import { encodeFunctionData, type Address, type Hex } from "viem";
import {
  boardroomAbi,
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
  BoardroomCall,
  BoardroomFixedPriceSaleTerms,
  BoardroomLockedLiquidityTerms,
  BoardroomMerkleAirdropTerms,
  BoardroomMigratingBondingCurveTerms,
  BoardroomShareGrantTerms,
  FixedPriceSaleTerms,
  GrantCreationArgs,
  GrantCreationTerms,
  LockedLiquidityTerms,
  MerkleAirdropGrantClaimTerms,
  MerkleAirdropTerms,
  MigratingBondingCurveTerms,
} from "./types";

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
    call: buildBoardroomCall({
      policy: input.policy,
      target: input.sale,
      data: encodeFunctionData({ abi: fixedPriceSaleAbi, functionName: "close" }),
    }),
  });
}

export function buildBoardroomFixedPriceSaleCancelAction(input: {
  boardroom: Address;
  policy: Address;
  sale: Address;
}) {
  return buildBoardroomExecuteTransaction({
    boardroom: input.boardroom,
    call: buildBoardroomCall({
      policy: input.policy,
      target: input.sale,
      data: encodeFunctionData({ abi: fixedPriceSaleAbi, functionName: "cancel" }),
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
    call: buildBoardroomCall({
      policy: input.policy,
      target: input.curve,
      data: encodeFunctionData({ abi: migratingBondingCurveAbi, functionName: "cancel" }),
    }),
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
    call: buildBoardroomCall({
      policy: input.policy,
      target: input.curve,
      data: encodeFunctionData({
        abi: migratingBondingCurveAbi,
        functionName: "migrate",
        args: [input.minShareLiquidity, input.minQuoteLiquidity, input.deadline],
      }),
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
    call: buildBoardroomCall({
      policy: input.policy,
      target: input.airdrop,
      data: encodeFunctionData({ abi: merkleAirdropAbi, functionName: "close" }),
    }),
  });
}

export function buildBoardroomMerkleAirdropCancelAction(input: {
  boardroom: Address;
  policy: Address;
  airdrop: Address;
}) {
  return buildBoardroomExecuteTransaction({
    boardroom: input.boardroom,
    call: buildBoardroomCall({
      policy: input.policy,
      target: input.airdrop,
      data: encodeFunctionData({ abi: merkleAirdropAbi, functionName: "cancel" }),
    }),
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
  creationFee?: bigint;
}) {
  return {
    address: input.airdrop,
    abi: merkleAirdropAbi,
    functionName: "claimGrant",
    args: [input.index, input.account, input.amount, merkleAirdropGrantClaimArgs(input.terms), input.proof] as const,
    value: input.creationFee ?? 0n,
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
    call: buildBoardroomCall({
      policy: input.policy,
      target: input.locker,
      data: encodeFunctionData({ abi: lockedLiquidityAbi, functionName: "claimFees" }),
    }),
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
    call: buildBoardroomCall({
      policy: input.policy,
      target: input.grant,
      data: encodeFunctionData({ abi: tokenGrantAbi, functionName: input.functionName }),
    }),
  });
}
