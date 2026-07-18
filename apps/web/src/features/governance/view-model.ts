import {
  buildBoardroomCancelActionTransaction,
  buildBoardroomExecuteQueuedActionTransaction,
  buildBoardroomExecuteQueuedBatchTransaction,
  type BoardroomCall,
  type QueuedBoardroomAction,
  type QueuedBoardroomActionStatus,
} from "@pledge.cash/sdk";
import { formatEther, isAddress, type Address, type Hex } from "viem";
import { boardroomCallReview, type ContractParameterReview } from "../../lib/transaction-preview";
import type { GovernanceTransactionRequest } from "./types";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const HOUR = 3_600n;
const DAY = 86_400n;

export type GovernanceCallView = {
  data: Hex;
  functionName?: string | undefined;
  label: string;
  parameters: ContractParameterReview[];
  policy: Address;
  selector: string;
  signature?: string | undefined;
  target: Address;
  value: bigint;
  valueLabel: string;
  verification: "verified" | "unverified";
  verificationReason?: string | undefined;
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

export function governanceActionView(
  action: QueuedBoardroomAction,
  now = BigInt(Math.floor(Date.now() / 1_000)),
): GovernanceActionView {
  const calls = (action.calls ?? []).map((call) => governanceCallView(call, action.boardroom));
  const status = governanceStatusView(effectiveGovernanceActionStatus(action, now), action.eta, action.expiresAt, now);
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

export function governanceCallView(call: BoardroomCall, boardroom?: Address): GovernanceCallView {
  const decoded = boardroomCallReview(call, boardroom);
  const selector = call.data.length >= 10 ? call.data.slice(0, 10) : "No selector";
  return {
    data: call.data,
    ...(decoded.functionName ? { functionName: decoded.functionName } : {}),
    label: decoded.label,
    parameters: decoded.parameters,
    policy: call.policy,
    selector,
    ...(decoded.signature ? { signature: decoded.signature } : {}),
    target: call.target,
    value: call.value,
    valueLabel: call.value === 0n
      ? "0 native"
      : `${formatEther(call.value)} native (${call.value.toString()} wei)`,
    verification: decoded.verification,
    ...(decoded.verificationReason ? { verificationReason: decoded.verificationReason } : {}),
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
      return { description: "An eligible active staker vetoed this action.", label: "Vetoed", tone: "danger" };
    case "executed":
      return { description: "The decoded calls were executed onchain.", label: "Executed", tone: "muted" };
    case "unknown":
      return { description: "The current onchain state could not be classified.", label: "Unknown", tone: "muted" };
  }
}

export function effectiveGovernanceActionStatus(
  action: QueuedBoardroomAction,
  now = BigInt(Math.floor(Date.now() / 1_000)),
): QueuedBoardroomActionStatus {
  if (
    action.status === "cancelled"
    || action.status === "executed"
    || action.status === "expired"
    || action.status === "invalidated"
    || action.status === "unknown"
  ) {
    return action.status;
  }
  if (action.eta === 0n || action.expiresAt === 0n) return "unknown";
  if (now > action.expiresAt) return "expired";
  if (now >= action.eta) return "ready";
  return "waiting";
}

export function canVetoQueuedAction(action: QueuedBoardroomAction, now?: bigint): boolean {
  const status = effectiveGovernanceActionStatus(action, now);
  return status === "waiting" || status === "ready";
}

export function canExecuteQueuedAction(action: QueuedBoardroomAction, now?: bigint): boolean {
  return effectiveGovernanceActionStatus(action, now) === "ready"
    && action.calls !== undefined
    && action.calls.length > 0
    && action.kind !== undefined;
}

export function buildGovernanceVetoRequest(
  action: QueuedBoardroomAction,
  now = BigInt(Math.floor(Date.now() / 1_000)),
): GovernanceTransactionRequest {
  if (!canVetoQueuedAction(action, now)) {
    throw new Error("This governance action is no longer available for veto.");
  }
  return buildBoardroomCancelActionTransaction({ boardroom: action.boardroom, actionHash: action.actionHash });
}

export function buildGovernanceExecutionRequest(
  action: QueuedBoardroomAction,
  now = BigInt(Math.floor(Date.now() / 1_000)),
): GovernanceTransactionRequest {
  if (effectiveGovernanceActionStatus(action, now) === "expired") {
    throw new Error("This governance action has expired and cannot be executed.");
  }
  if (!canExecuteQueuedAction(action, now) || !action.calls || !action.kind) {
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
