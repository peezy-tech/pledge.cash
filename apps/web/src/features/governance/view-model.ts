import {
  boardroomControllerAbi,
  buildBoardroomVetoOperationTransaction,
  buildControllerExecuteBoardroomOperationTransaction,
  type BoardroomCall,
  type ScheduledBoardroomOperation,
  type ScheduledBoardroomOperationStatus,
} from "@pledge.cash/sdk";
import { decodeFunctionData, formatEther, isAddress, type Address, type Hex } from "viem";
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

export type GovernanceOperationView = {
  calls: GovernanceCallView[];
  expiryLabel: string;
  operationId: Hex;
  payloadError?: string | undefined;
  statusDescription: string;
  statusLabel: string;
  statusTone: "default" | "muted" | "warning" | "danger";
  title: string;
};

export type ControllerDelayPreset = {
  label: string;
  seconds: bigint;
};

export function governanceOperationView(
  operation: ScheduledBoardroomOperation,
  now = BigInt(Math.floor(Date.now() / 1_000)),
): GovernanceOperationView {
  const calls = (operation.calls ?? []).map((call) => governanceCallView(call, operation.boardroom));
  const status = governanceStatusView(
    effectiveGovernanceOperationStatus(operation, now),
    operation.eta,
    operation.expiresAt,
    now,
  );
  const title = operation.kind === "controllerOperation"
    ? controllerOperationTitle(operation.controllerData)
    : calls.length === 0
      ? "Undecoded Boardroom operation"
      : calls.length === 1
        ? calls[0]!.label
        : `${calls.length.toString()}-call Boardroom operation`;

  return {
    calls,
    expiryLabel: operation.expiresAt > 0n ? formatGovernanceTimestamp(operation.expiresAt) : "Not available",
    operationId: operation.operationId,
    ...(operation.payloadError ? { payloadError: operation.payloadError } : {}),
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
  status: ScheduledBoardroomOperationStatus,
  eta: bigint,
  expiresAt: bigint,
  now: bigint,
): { description: string; label: string; tone: GovernanceOperationView["statusTone"] } {
  switch (status) {
    case "waiting":
      return {
        description: eta > now ? `Executable ${formatRelativeTime(eta, now)}.` : "Waiting for the review period to end.",
        label: "In review",
        tone: "warning",
      };
    case "ready":
      return {
        description: expiresAt > now ? `Execution window closes ${formatRelativeTime(expiresAt, now)}.` : "The operation is ready to execute.",
        label: "Ready to execute",
        tone: "default",
      };
    case "expired":
      return { description: "The execution window closed without execution.", label: "Expired", tone: "muted" };
    case "invalidated":
      return { description: "A governance or controller configuration epoch superseded this operation.", label: "Superseded", tone: "muted" };
    case "cancelled":
      return { description: "An eligible active staker vetoed this operation.", label: "Vetoed", tone: "danger" };
    case "executed":
      return { description: "The verified operation was executed onchain.", label: "Executed", tone: "muted" };
    case "unknown":
      return { description: "The current onchain state could not be classified.", label: "Unknown", tone: "muted" };
  }
}

export function effectiveGovernanceOperationStatus(
  operation: ScheduledBoardroomOperation,
  now = BigInt(Math.floor(Date.now() / 1_000)),
): ScheduledBoardroomOperationStatus {
  if (
    operation.status === "cancelled"
    || operation.status === "executed"
    || operation.status === "expired"
    || operation.status === "invalidated"
    || operation.status === "unknown"
  ) {
    return operation.status;
  }
  if (operation.eta === 0n || operation.expiresAt === 0n) return "unknown";
  if (now > operation.expiresAt) return "expired";
  if (now >= operation.eta) return "ready";
  return "waiting";
}

export function canVetoScheduledOperation(operation: ScheduledBoardroomOperation, now?: bigint): boolean {
  const status = effectiveGovernanceOperationStatus(operation, now);
  return status === "waiting" || status === "ready";
}

export function canExecuteScheduledOperation(operation: ScheduledBoardroomOperation, now?: bigint): boolean {
  if (effectiveGovernanceOperationStatus(operation, now) !== "ready" || !operation.kind) return false;
  if (operation.kind === "boardroomOperation") return Boolean(operation.calls?.length);
  return isVerifiedControllerConfiguration(operation.controllerData);
}

export function buildGovernanceVetoRequest(
  operation: ScheduledBoardroomOperation,
  now = BigInt(Math.floor(Date.now() / 1_000)),
): GovernanceTransactionRequest {
  if (!canVetoScheduledOperation(operation, now)) {
    throw new Error("This governance operation is no longer available for veto.");
  }
  return buildBoardroomVetoOperationTransaction({
    boardroom: operation.boardroom,
    operationId: operation.operationId,
  });
}

export function buildGovernanceExecutionRequest(
  operation: ScheduledBoardroomOperation,
  now = BigInt(Math.floor(Date.now() / 1_000)),
): GovernanceTransactionRequest {
  if (effectiveGovernanceOperationStatus(operation, now) === "expired") {
    throw new Error("This governance operation has expired and cannot be executed.");
  }
  if (!canExecuteScheduledOperation(operation, now) || !operation.kind) {
    throw new Error("Verified scheduled calldata is required before execution.");
  }

  if (operation.kind === "boardroomOperation") {
    if (!operation.calls?.length) throw new Error("The scheduled operation does not contain Boardroom calls.");
    return buildControllerExecuteBoardroomOperationTransaction({
      controller: operation.controller,
      calls: operation.calls,
      salt: operation.salt,
      expectedBoardroomEpoch: operation.boardroomEpoch,
      expectedConfigurationEpoch: operation.configurationEpoch,
      authority: operation.proposer,
    });
  }

  if (!operation.controllerData || operation.controllerData === "0x") {
    throw new Error("The scheduled controller operation is missing its calldata.");
  }
  return {
    address: operation.controller,
    abi: boardroomControllerAbi,
    functionName: "executeControllerOperation",
    args: [
      operation.controllerData,
      operation.salt,
      operation.boardroomEpoch,
      operation.configurationEpoch,
      operation.proposer,
    ] as const,
  };
}

export function controllerDelayPresets(minimumDelay: bigint): ControllerDelayPreset[] {
  const safeMinimum = minimumDelay > 0n ? minimumDelay : DAY;
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

export function customControllerDelay(amount: string, unit: "days" | "hours"): bigint | undefined {
  if (!/^\d+$/.test(amount.trim())) return undefined;
  const value = BigInt(amount.trim());
  if (value === 0n) return undefined;
  return value * (unit === "days" ? DAY : HOUR);
}

export function governanceProposerError(value: string, currentProposer?: Address): string | undefined {
  if (!isAddress(value, { strict: false })) return "Enter a valid proposer address.";
  if (value.toLowerCase() === ZERO_ADDRESS) return "The proposer cannot be the zero address.";
  if (currentProposer && value.toLowerCase() === currentProposer.toLowerCase()) {
    return "Choose an address other than the current proposer.";
  }
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

function controllerOperationTitle(data: Hex | undefined): string {
  if (!data || data === "0x") return "Undecoded controller operation";
  try {
    const decoded = decodeFunctionData({ abi: boardroomControllerAbi, data });
    if (decoded.functionName === "updateConfiguration") return "Update controller security configuration";
  } catch {
    return "Undecoded controller operation";
  }
  return "Controller operation";
}

function isVerifiedControllerConfiguration(data: Hex | undefined): boolean {
  if (!data || data === "0x") return false;
  try {
    return decodeFunctionData({ abi: boardroomControllerAbi, data }).functionName === "updateConfiguration";
  } catch {
    return false;
  }
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
