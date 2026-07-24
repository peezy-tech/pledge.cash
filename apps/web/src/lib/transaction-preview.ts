import {
  boardroomAbi,
  boardroomControllerAbi,
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
  type BoardroomCall,
} from "@pledge.cash/sdk";
import {
  decodeFunctionData,
  encodeFunctionData,
  isAddress,
  isHex,
  type Address,
  type Hex,
} from "viem";

type EncodableCallRequest = {
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
};

type AbiParameterShape = {
  components?: readonly AbiParameterShape[];
  name?: string;
  type?: string;
};

type AbiFunctionShape = {
  inputs?: readonly AbiParameterShape[];
  name: string;
  type: "function";
};

export type ContractParameterReview = {
  name: string;
  type: string;
  value: string;
};

export type BoardroomCallReview = {
  data: Hex;
  functionName?: string | undefined;
  label: string;
  parameters: ContractParameterReview[];
  policy: Address | "unknown";
  signature?: string | undefined;
  target: Address | "unknown";
  value: bigint;
  verification: "verified" | "unverified";
  verificationReason?: string | undefined;
};

export type ContractCallReview = {
  boardroomCalls?: BoardroomCallReview[] | undefined;
  data: Hex | "unavailable";
  functionName: string;
  label: string;
  parameters: ContractParameterReview[];
  risk: "routine" | "important" | "irreversible";
  target: Address | "unknown";
  value: bigint;
};

const BOARDROOM_SINGLE_CALL_FUNCTIONS = new Set([
  "execute",
  "executeWindDownCall",
]);

const BOARDROOM_BATCH_CALL_FUNCTIONS = new Set([
  "executeBatch",
  "executeBoardroomOperation",
  "scheduleBoardroomOperation",
]);

const ASSET_AND_OBLIGATION_ABIS = [
  boardroomAbi,
  boardroomControllerAbi,
  boardroomRewardsAbi,
  boardroomTokenAbi,
  bondMarketAbi,
  dutchAuctionSaleAbi,
  erc20Abi,
  fixedPriceSaleAbi,
  lockedLiquidityAbi,
  merkleAirdropAbi,
  migratingBondingCurveAbi,
  tokenGrantAbi,
] as const;

const MODULE_FACTORY_ABIS = [
  boardroomRewardsFactoryAbi,
  bondMarketFactoryAbi,
  distributionFactoryAbi,
  lockedLiquidityFactoryAbi,
  tokenGrantFactoryAbi,
] as const;

const FUNCTION_LABELS: Record<string, string> = {
  approve: "Approve token spending",
  beginSnapshot: "Freeze redemption inputs",
  burnTreasuryShares: "Burn treasury-held project shares",
  cancel: "Cancel a participation contract",
  claimFees: "Claim liquidity fees",
  close: "Close a participation contract",
  createBondMarket: "Create a non-transferable bond market",
  createDutchAuction: "Create a Dutch auction",
  createFixedPriceSale: "Create a fixed-price sale",
  createGrant: "Create a token grant",
  createLockedLiquidity: "Create a locked liquidity position",
  createMerkleAirdrop: "Create an airdrop",
  createMigratingBondingCurve: "Create a bonding curve",
  createRewards: "Create a staking and rewards pool",
  finalize: "Finalize a concluded bond market",
  purchase: "Create a non-transferable bond position",
  executeWindDownCall: "Run a wind-down operation",
  executeBoardroomOperation: "Execute a scheduled Boardroom operation",
  executeControllerOperation: "Execute a scheduled controller operation",
  exit: "Exit a liquidity position",
  fundReward: "Fund a reward period",
  launch: "Launch staker governance",
  mint: "Mint project shares",
  openRedemptions: "Open holder redemptions",
  registerRedeemableAsset: "Register a redemption asset",
  scheduleBoardroomOperation: "Schedule a Boardroom operation",
  scheduleControllerOperation: "Schedule a controller operation",
  snapshotAssets: "Process a redemption snapshot page",
  updateConfiguration: "Change controller proposer or timing",
  veto: "Veto a scheduled operation",
  startWindDown: "Start project wind-down",
  stake: "Activate project-token stake",
  requestUnstake: "Start unstake cooldown",
  completeUnstake: "Complete unstake cooldown",
  terminalize: "Terminalize project rewards",
  transfer: "Transfer tokens",
  transferFrom: "Transfer tokens",
  wrapNativeBalance: "Wrap treasury native balance",
};

export function contractCallReview(label: string, request: Record<string, unknown>): ContractCallReview {
  const functionName = stringField(request, "functionName") ?? "unknown";
  const requestedTarget = stringField(request, "address");
  const target = requestedTarget && isAddress(requestedTarget) ? requestedTarget : "unknown";
  const boardroomCalls = extractBoardroomCallReviews(request, functionName, target);
  const parameters = callParameters(request, functionName);
  if (boardroomCalls) {
    const callsParameter = parameters[0];
    if (callsParameter) {
      callsParameter.value = `${boardroomCalls.length.toString()} Boardroom call${boardroomCalls.length === 1 ? "" : "s"} — inspect every decoded argument below`;
    }
  }

  return {
    ...(boardroomCalls ? { boardroomCalls } : {}),
    data: encodedCallData(request),
    functionName,
    label,
    parameters,
    risk: maximumTransactionRisk([
      transactionRisk(functionName),
      ...(boardroomCalls ?? []).flatMap((call) =>
        call.verification === "verified" && call.functionName
          ? [transactionRisk(call.functionName)]
          : []),
    ]),
    target,
    value: bigintField(request, "value") ?? 0n,
  };
}

export function boardroomCallReview(call: BoardroomCall, boardroom?: Address): BoardroomCallReview {
  const normalized = normalizeBoardroomCall(call);
  if (!normalized) return malformedBoardroomCallReview(call);

  if (normalized.data === "0x" && normalized.value > 0n) {
    return {
      ...normalized,
      label: "Transfer native value",
      parameters: [],
      signature: "native transfer",
      verification: "verified",
    };
  }

  const selfTarget = boardroom !== undefined && sameAddress(normalized.target, boardroom);
  const abis = selfTarget
    ? [boardroomAbi] as const
    : sameAddress(normalized.target, normalized.policy)
      ? MODULE_FACTORY_ABIS
      : ASSET_AND_OBLIGATION_ABIS;
  const matches = uniqueDecodedMatches(abis, normalized.data);
  if (matches.length !== 1) {
    const candidates = matches.map((match) => match.signature).join(", ");
    return {
      ...normalized,
      label: matches.length === 0 ? `Unverified call ${selector(normalized.data)}` : `Ambiguous call ${selector(normalized.data)}`,
      parameters: [],
      verification: "unverified",
      verificationReason: matches.length === 0
        ? selfTarget
          ? "Calldata does not match a known Boardroom function for this target."
          : "Calldata does not match a uniquely known protocol function for this target."
        : `Selector matches multiple protocol functions: ${candidates}.`,
    };
  }

  const match = matches[0]!;
  return {
    ...normalized,
    functionName: match.functionName,
    label: FUNCTION_LABELS[match.functionName] ?? humanizeFunctionName(match.functionName),
    parameters: match.parameters,
    signature: match.signature,
    verification: "verified",
  };
}

function callParameters(
  request: Record<string, unknown>,
  functionName: string,
): ContractParameterReview[] {
  const abi = Array.isArray(request.abi) ? request.abi : [];
  const item = abi.find((candidate): candidate is AbiFunctionShape => {
    if (!candidate || typeof candidate !== "object") return false;
    const record = candidate as Record<string, unknown>;
    return record.type === "function" && record.name === functionName;
  });
  const inputs = Array.isArray(item?.inputs) ? item.inputs : [];
  const args = Array.isArray(request.args) ? request.args : [];

  return inputs.map((input, index) => ({
    name: cleanParameterName(input.name) || `Argument ${index + 1}`,
    type: input.type ?? "unknown",
    value: formatParameterValue(args[index]),
  }));
}

function cleanParameterName(name: string | undefined): string {
  return (name ?? "").replace(/_+$/g, "");
}

function extractBoardroomCallReviews(
  request: Record<string, unknown>,
  functionName: string,
  boardroom: Address | "unknown",
): BoardroomCallReview[] | undefined {
  const args = Array.isArray(request.args) ? request.args : [];
  let calls: unknown[] | undefined;
  if (BOARDROOM_SINGLE_CALL_FUNCTIONS.has(functionName)) {
    calls = [args[0]];
  } else if (BOARDROOM_BATCH_CALL_FUNCTIONS.has(functionName)) {
    calls = Array.isArray(args[0]) ? args[0] : [args[0]];
  }
  if (!calls) return undefined;

  const boardroomAddress = boardroom === "unknown" ? undefined : boardroom;
  return calls.map((call) => boardroomCallReview(call as BoardroomCall, boardroomAddress));
}

function uniqueDecodedMatches(
  abis: readonly (readonly unknown[])[],
  data: Hex,
): DecodedMatch[] {
  const matches = new Map<string, DecodedMatch>();
  for (const abi of abis) {
    const match = decodeAgainstAbi(abi, data);
    if (match) {
      const identity = `${match.signature}:${match.parameters.map((parameter) => `${parameter.name}:${parameter.type}`).join("|")}`;
      matches.set(identity, match);
    }
  }
  return [...matches.values()];
}

type DecodedMatch = {
  functionName: string;
  parameters: ContractParameterReview[];
  signature: string;
};

function decodeAgainstAbi(abi: readonly unknown[], data: Hex): DecodedMatch | undefined {
  try {
    const decoded = decodeFunctionData({ abi: abi as never, data });
    const args = Array.isArray(decoded.args) ? decoded.args : [];
    const item = matchingFunctionItem(abi, decoded.functionName, args, data);
    if (!item) return undefined;
    return {
      functionName: decoded.functionName,
      parameters: flattenDecodedParameters(item.inputs ?? [], args),
      signature: functionSignature(item),
    };
  } catch {
    return undefined;
  }
}

function matchingFunctionItem(
  abi: readonly unknown[],
  functionName: string,
  args: readonly unknown[],
  data: Hex,
): AbiFunctionShape | undefined {
  const candidates = abi.filter((item): item is AbiFunctionShape => {
    if (!item || typeof item !== "object") return false;
    const record = item as Record<string, unknown>;
    return record.type === "function" && record.name === functionName;
  });
  return candidates.find((item) => {
    try {
      const encode = encodeFunctionData as unknown as (parameters: EncodableCallRequest) => Hex;
      return encode({ abi: [item], functionName, args }) === data;
    } catch {
      return false;
    }
  });
}

function functionSignature(item: AbiFunctionShape): string {
  return `${item.name}(${(item.inputs ?? []).map(canonicalParameterType).join(",")})`;
}

function canonicalParameterType(parameter: AbiParameterShape): string {
  const type = parameter.type ?? "unknown";
  if (!type.startsWith("tuple")) return type;
  const suffix = type.slice("tuple".length);
  return `(${(parameter.components ?? []).map(canonicalParameterType).join(",")})${suffix}`;
}

function flattenDecodedParameters(
  inputs: readonly AbiParameterShape[],
  args: readonly unknown[],
  prefix = "",
): ContractParameterReview[] {
  return inputs.flatMap((input, index) => {
    const name = input.name || `Argument ${index + 1}`;
    const path = prefix ? `${prefix}.${name}` : name;
    return flattenDecodedParameter(input, args[index], path);
  });
}

function flattenDecodedParameter(
  input: AbiParameterShape,
  value: unknown,
  path: string,
): ContractParameterReview[] {
  const type = input.type ?? "unknown";
  const components = input.components ?? [];
  if (components.length === 0 || !type.startsWith("tuple")) {
    return [{ name: path, type, value: formatParameterValue(value) }];
  }

  if (type.includes("[") && Array.isArray(value)) {
    return value.flatMap((entry, index) => flattenTupleComponents(components, entry, `${path}[${index.toString()}]`));
  }
  return flattenTupleComponents(components, value, path);
}

function flattenTupleComponents(
  components: readonly AbiParameterShape[],
  value: unknown,
  path: string,
): ContractParameterReview[] {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  const values = Array.isArray(value) ? value : undefined;
  return components.flatMap((component, index) => {
    const componentName = component.name || `Argument ${index + 1}`;
    const componentValue = record?.[componentName] ?? values?.[index];
    return flattenDecodedParameter(component, componentValue, `${path}.${componentName}`);
  });
}

function normalizeBoardroomCall(call: BoardroomCall): {
  data: Hex;
  policy: Address;
  target: Address;
  value: bigint;
} | undefined {
  if (!call || typeof call !== "object") return undefined;
  const record = call as unknown as Record<string, unknown>;
  if (!isAddress(record.policy as string) || !isAddress(record.target as string) || !isHex(record.data) || typeof record.value !== "bigint") {
    return undefined;
  }
  return {
    data: record.data,
    policy: record.policy as Address,
    target: record.target as Address,
    value: record.value,
  };
}

function malformedBoardroomCallReview(call: BoardroomCall): BoardroomCallReview {
  const record = call && typeof call === "object" ? call as unknown as Record<string, unknown> : {};
  return {
    data: isHex(record.data) ? record.data : "0x",
    label: "Malformed Boardroom call",
    parameters: [],
    policy: typeof record.policy === "string" && isAddress(record.policy) ? record.policy : "unknown",
    target: typeof record.target === "string" && isAddress(record.target) ? record.target : "unknown",
    value: typeof record.value === "bigint" ? record.value : 0n,
    verification: "unverified",
    verificationReason: "The Boardroom call tuple is missing a valid policy, target, value, or calldata field.",
  };
}

function formatParameterValue(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return `[${value.map((item) => formatParameterValue(item)).join(", ")}]`;
  if (value === null || value === undefined) return "Not supplied";
  try {
    return JSON.stringify(value, (_, nested) => typeof nested === "bigint" ? nested.toString() : nested);
  } catch {
    return String(value);
  }
}

const IRREVERSIBLE_FUNCTIONS = new Set([
  "burnTreasuryShares",
  "cancel",
  "close",
  "closeGrant",
  "exit",
  "exitLockedLiquidity",
  "exitToBoardroom",
  "finalize",
  "finalizeQuoteForfeiture",
  "finalizeUnwind",
  "finalizeWindDown",
  "launch",
  "beginSnapshot",
  "migrate",
  "openRedemptions",
  "quarantineAndClose",
  "quarantineRedeemableAsset",
  "fallbackToUnwind",
  "returnLpToBoardroom",
  "startWindDown",
  "stopVestingAndWithdrawUnvested",
  "terminalize",
  "withdrawExpiredTokens",
]);

const IMPORTANT_FUNCTIONS = new Set([
  "addLiquidity",
  "addLiquidityNative",
  "approve",
  "buy",
  "claim",
  "claimFees",
  "claimGrant",
  "claimRedemptionAsset",
  "createBoardroom",
  "createBondMarket",
  "createDutchAuction",
  "createFixedPriceSale",
  "createGrant",
  "createLockedLiquidity",
  "createMerkleAirdrop",
  "createMigratingBondingCurve",
  "createRewards",
  "fundReward",
  "execute",
  "executeBatch",
  "executeBoardroomOperation",
  "executeControllerOperation",
  "executeWindDownCall",
  "expire",
  "mint",
  "openQuoteForfeiture",
  "stake",
  "requestUnstake",
  "completeUnstake",
  "purchase",
  "scheduleBoardroomOperation",
  "scheduleControllerOperation",
  "snapshotAssets",
  "redeem",
  "registerRedeemableAsset",
  "recoverForfeitedQuote",
  "recoverQuarantinedQuote",
  "removeLiquidity",
  "removeLiquidityNative",
  "safeTransferFrom",
  "sell",
  "setApprovalForAll",
  "updateConfiguration",
  "veto",
  "vetoQuoteForfeiture",
  "setRedemptionExcessRecipient",
  "settle",
  "swapExactNativeForTokens",
  "swapExactTokensForNative",
  "swapExactTokensForTokens",
  "transfer",
  "transferFrom",
  "wrapNativeBalance",
]);

function transactionRisk(functionName: string): ContractCallReview["risk"] {
  if (IRREVERSIBLE_FUNCTIONS.has(functionName)) {
    return "irreversible";
  }
  if (IMPORTANT_FUNCTIONS.has(functionName)) {
    return "important";
  }
  return "routine";
}

function maximumTransactionRisk(
  risks: readonly ContractCallReview["risk"][],
): ContractCallReview["risk"] {
  if (risks.includes("irreversible")) return "irreversible";
  if (risks.includes("important")) return "important";
  return "routine";
}

export function contractCallPreview(label: string, request: Record<string, unknown>): string {
  const { data, functionName, target, value } = contractCallReview(label, request);

  return `${label} call target=${target} function=${functionName} value=${value.toString()} data=${data}`;
}

function encodedCallData(request: Record<string, unknown>): Hex | "unavailable" {
  const call = encodableCallRequest(request);
  if (!call) return "unavailable";

  try {
    const encode = encodeFunctionData as unknown as (parameters: EncodableCallRequest) => Hex;
    return encode(call);
  } catch {
    return "unavailable";
  }
}

function encodableCallRequest(request: Record<string, unknown>): EncodableCallRequest | undefined {
  if (!request.abi || typeof request.functionName !== "string") return undefined;
  return {
    abi: request.abi as readonly unknown[],
    functionName: request.functionName,
    args: Array.isArray(request.args) ? request.args : [],
  };
}

function stringField(request: Record<string, unknown>, key: string): string | undefined {
  const value = request[key];
  return typeof value === "string" ? value : undefined;
}

function bigintField(request: Record<string, unknown>, key: string): bigint | undefined {
  const value = request[key];
  return typeof value === "bigint" ? value : undefined;
}

function selector(data: Hex): string {
  return data.length >= 10 ? data.slice(0, 10) : "without a function selector";
}

function humanizeFunctionName(functionName: string): string {
  const words = functionName
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
  return words.length > 0 ? words.charAt(0).toUpperCase() + words.slice(1) : "Contract call";
}

function sameAddress(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
