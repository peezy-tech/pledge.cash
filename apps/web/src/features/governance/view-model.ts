import {
  boardroomAbi,
  boardroomTokenAbi,
  buildBoardroomCancelActionTransaction,
  buildBoardroomExecuteQueuedActionTransaction,
  buildBoardroomExecuteQueuedBatchTransaction,
  buildBoardroomLaunchTransaction,
  buildBoardroomSetExecutorTransaction,
  distributionFactoryAbi,
  erc20Abi,
  fixedPriceSaleAbi,
  lockedLiquidityAbi,
  lockedLiquidityFactoryAbi,
  merkleAirdropAbi,
  migratingBondingCurveAbi,
  tokenGrantAbi,
  tokenGrantFactoryAbi,
  type BoardroomCall,
  type QueuedBoardroomAction,
  type QueuedBoardroomActionStatus,
} from "@pledge.cash/sdk";
import { decodeFunctionData, formatEther, isAddress, type Address, type Hex } from "viem";
import type { GovernanceTransactionRequest } from "./types";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const HOUR = 3_600n;
const DAY = 86_400n;

const CALL_ABIS = [
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
] as const;

const FUNCTION_LABELS: Record<string, string> = {
  approve: "Approve token spending",
  burnTreasuryShares: "Burn treasury-held project shares",
  cancel: "Cancel a participation contract",
  claimFees: "Claim liquidity fees",
  close: "Close a participation contract",
  createFixedPriceSale: "Create a fixed-price sale",
  createGrant: "Create a token grant",
  createLockedLiquidity: "Create a locked liquidity position",
  createMerkleAirdrop: "Create an airdrop",
  createMigratingBondingCurve: "Create a bonding curve",
  executeWindDownCall: "Run a wind-down operation",
  exit: "Exit a liquidity position",
  launch: "Launch holder governance",
  mint: "Mint project shares",
  openRedemptions: "Open holder redemptions",
  registerRedeemableAsset: "Register a redemption asset",
  setExecutor: "Change the governance executor",
  startWindDown: "Start project wind-down",
  transfer: "Transfer tokens",
  transferFrom: "Transfer tokens",
  wrapNativeBalance: "Wrap treasury native balance",
};

export type GovernanceCallView = {
  data: Hex;
  functionName?: string | undefined;
  label: string;
  policy: Address;
  selector: string;
  target: Address;
  value: bigint;
  valueLabel: string;
};

export type GovernanceActionView = {
  actionHash: Hex;
  calls: GovernanceCallView[];
  expiryLabel: string;
  payloadError?: string | undefined;
  statusDescription: string;
  statusLabel: string;
  statusTone: "default" | "muted" | "warning" | "danger";
  title: string;
};

export type GovernanceDelayPreset = {
  label: string;
  seconds: bigint;
};

export type GovernanceLaunchStep = {
  kind: "setExecutor" | "launch";
  label: string;
  request: GovernanceTransactionRequest;
};

export function governanceActionView(
  action: QueuedBoardroomAction,
  now = BigInt(Math.floor(Date.now() / 1_000)),
): GovernanceActionView {
  const calls = (action.calls ?? []).map(governanceCallView);
  const status = governanceStatusView(action.status, action.eta, action.expiresAt, now);
  const title = calls.length === 0
    ? "Undecoded governance action"
    : calls.length === 1
      ? calls[0]!.label
      : `${calls.length.toString()}-call governance batch`;

  return {
    actionHash: action.actionHash,
    calls,
    expiryLabel: action.expiresAt > 0n ? formatGovernanceTimestamp(action.expiresAt) : "Not available",
    ...(action.payloadError ? { payloadError: action.payloadError } : {}),
    statusDescription: status.description,
    statusLabel: status.label,
    statusTone: status.tone,
    title,
  };
}

export function governanceCallView(call: BoardroomCall): GovernanceCallView {
  const decoded = decodeKnownCall(call.data);
  const selector = call.data.length >= 10 ? call.data.slice(0, 10) : "No selector";
  return {
    data: call.data,
    ...(decoded ? { functionName: decoded.functionName } : {}),
    label: decoded?.label ?? (call.value > 0n && call.data === "0x" ? "Transfer native value" : `Contract call ${selector}`),
    policy: call.policy,
    selector,
    target: call.target,
    value: call.value,
    valueLabel: call.value === 0n
      ? "0 native"
      : `${formatEther(call.value)} native (${call.value.toString()} wei)`,
  };
}

export function governanceStatusView(
  status: QueuedBoardroomActionStatus,
  eta: bigint,
  expiresAt: bigint,
  now: bigint,
): { description: string; label: string; tone: GovernanceActionView["statusTone"] } {
  switch (status) {
    case "waiting":
      return {
        description: eta > now ? `Executable ${formatRelativeTime(eta, now)}.` : "Waiting for the review period to end.",
        label: "In review",
        tone: "warning",
      };
    case "ready":
      return {
        description: expiresAt > now ? `Execution window closes ${formatRelativeTime(expiresAt, now)}.` : "The action is ready to execute.",
        label: "Ready to execute",
        tone: "default",
      };
    case "expired":
      return { description: "The execution window closed without execution.", label: "Expired", tone: "muted" };
    case "invalidated":
      return { description: "A governance epoch change superseded this action.", label: "Superseded", tone: "muted" };
    case "cancelled":
      return { description: "An eligible holder vetoed this action.", label: "Vetoed", tone: "danger" };
    case "executed":
      return { description: "The decoded calls were executed onchain.", label: "Executed", tone: "muted" };
    case "unknown":
      return { description: "The current onchain state could not be classified.", label: "Unknown", tone: "muted" };
  }
}

export function canVetoQueuedAction(action: QueuedBoardroomAction): boolean {
  return action.status === "waiting" || action.status === "ready";
}

export function canExecuteQueuedAction(action: QueuedBoardroomAction): boolean {
  return action.status === "ready" && action.calls !== undefined && action.calls.length > 0 && action.kind !== undefined;
}

export function buildGovernanceVetoRequest(action: QueuedBoardroomAction): GovernanceTransactionRequest {
  return buildBoardroomCancelActionTransaction({ boardroom: action.boardroom, actionHash: action.actionHash });
}

export function buildGovernanceExecutionRequest(action: QueuedBoardroomAction): GovernanceTransactionRequest {
  if (!canExecuteQueuedAction(action) || !action.calls || !action.kind) {
    throw new Error("Verified queued calldata is required before execution.");
  }

  if (action.kind === "queueAction") {
    const call = action.calls[0];
    if (!call) throw new Error("The queued action does not contain a call.");
    return buildBoardroomExecuteQueuedActionTransaction({
      boardroom: action.boardroom,
      call,
      salt: action.salt,
    });
  }

  return buildBoardroomExecuteQueuedBatchTransaction({
    boardroom: action.boardroom,
    calls: action.calls,
    salt: action.salt,
  });
}

export function buildGovernanceLaunchSteps(input: {
  boardroom: Address;
  currentExecutor: Address;
  governanceDelay: bigint;
  nextExecutor: Address;
}): GovernanceLaunchStep[] {
  const steps: GovernanceLaunchStep[] = [];
  if (!sameAddress(input.currentExecutor, input.nextExecutor)) {
    steps.push({
      kind: "setExecutor",
      label: "Set governance executor",
      request: buildBoardroomSetExecutorTransaction({ boardroom: input.boardroom, executor: input.nextExecutor }),
    });
  }
  steps.push({
    kind: "launch",
    label: "Launch holder governance",
    request: buildBoardroomLaunchTransaction({ boardroom: input.boardroom, governanceDelay: input.governanceDelay }),
  });
  return steps;
}

export function governanceDelayPresets(minimumDelay: bigint): GovernanceDelayPreset[] {
  const safeMinimum = minimumDelay > 0n ? minimumDelay : HOUR;
  const values = [safeMinimum, 2n * DAY, 3n * DAY, 7n * DAY, 14n * DAY, safeMinimum * 2n]
    .filter((seconds) => seconds >= safeMinimum);
  const unique = [...new Set(values.map((seconds) => seconds.toString()))]
    .map((seconds) => BigInt(seconds))
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
    .slice(0, 4);

  return unique.map((seconds, index) => ({
    label: index === 0 ? `Minimum — ${formatGovernanceDuration(seconds)}` : formatGovernanceDuration(seconds),
    seconds,
  }));
}

export function customGovernanceDelay(amount: string, unit: "days" | "hours"): bigint | undefined {
  if (!/^\d+$/.test(amount.trim())) return undefined;
  const value = BigInt(amount.trim());
  if (value === 0n) return undefined;
  return value * (unit === "days" ? DAY : HOUR);
}

export function governanceExecutorError(value: string): string | undefined {
  if (!isAddress(value, { strict: false })) return "Enter a valid executor address.";
  if (value.toLowerCase() === ZERO_ADDRESS) return "The executor cannot be the zero address.";
  return undefined;
}

export function formatGovernanceDuration(seconds: bigint): string {
  if (seconds % DAY === 0n) {
    const days = seconds / DAY;
    return `${days.toString()} ${days === 1n ? "day" : "days"}`;
  }
  if (seconds % HOUR === 0n) {
    const hours = seconds / HOUR;
    return `${hours.toString()} ${hours === 1n ? "hour" : "hours"}`;
  }
  const minutes = seconds / 60n;
  return `${minutes.toString()} ${minutes === 1n ? "minute" : "minutes"}`;
}

export function formatGovernanceTimestamp(seconds: bigint): string {
  const milliseconds = seconds * 1_000n;
  if (milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) return `Unix ${seconds.toString()}`;
  const date = new Date(Number(milliseconds));
  if (Number.isNaN(date.getTime())) return `Unix ${seconds.toString()}`;
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date) + " UTC";
}

function decodeKnownCall(data: Hex): { functionName: string; label: string } | undefined {
  if (data.length < 10) return undefined;
  for (const abi of CALL_ABIS) {
    try {
      const decoded = decodeFunctionData({ abi, data });
      const functionName = decoded.functionName;
      return {
        functionName,
        label: FUNCTION_LABELS[functionName] ?? humanizeFunctionName(functionName),
      };
    } catch {
      // A selector belongs to at most one of the known protocol ABIs. Try the next ABI.
    }
  }
  return undefined;
}

function humanizeFunctionName(functionName: string): string {
  const words = functionName
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
  return words.length > 0 ? words.charAt(0).toUpperCase() + words.slice(1) : "Contract call";
}

function formatRelativeTime(target: bigint, now: bigint): string {
  const difference = target - now;
  const absolute = difference < 0n ? -difference : difference;
  const duration = absolute >= DAY
    ? formatGovernanceDuration((absolute / DAY) * DAY)
    : absolute >= HOUR
      ? formatGovernanceDuration((absolute / HOUR) * HOUR)
      : formatGovernanceDuration(((absolute + 59n) / 60n) * 60n);
  return difference >= 0n ? `in ${duration}` : `${duration} ago`;
}

function sameAddress(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
