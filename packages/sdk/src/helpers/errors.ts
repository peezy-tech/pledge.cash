import { decodeErrorResult, isHex, type Abi, type Hex } from "viem";
import {
  boardroomAbi,
  boardroomFactoryAbi,
  boardroomTokenAbi,
  liquidityLockerAbi,
  liquidityLockerFactoryAbi,
  pledgeCashDeterministicDeployerAbi,
  protocolFeeRouterAbi,
  tokenGrantAbi,
  tokenGrantFactoryAbi,
} from "../generated";
import type { DecodedPledgeCashError } from "./types";

const pledgeCashErrorAbis: readonly Abi[] = [
  boardroomAbi,
  boardroomFactoryAbi,
  boardroomTokenAbi,
  liquidityLockerAbi,
  liquidityLockerFactoryAbi,
  pledgeCashDeterministicDeployerAbi,
  protocolFeeRouterAbi,
  tokenGrantAbi,
  tokenGrantFactoryAbi,
];

const pledgeCashErrorAbi = pledgeCashErrorAbis.flatMap((abi) =>
  abi.filter((item) => item.type === "error")
) as Abi;

export function decodeKnownPledgeCashError(input: unknown): DecodedPledgeCashError | undefined {
  const data = extractHexData(input);
  if (!data) return undefined;

  try {
    const decoded = decodeErrorResult({ abi: pledgeCashErrorAbi, data });
    const args = decoded.args ?? [];
    return {
      name: decoded.errorName,
      args,
      data,
      message: humanErrorMessage(decoded.errorName, args),
    };
  } catch {
    return undefined;
  }
}

export function pledgeCashErrorMessage(input: unknown): string {
  const decoded = decodeKnownPledgeCashError(input);
  if (decoded) return decoded.message;
  if (input instanceof Error) return input.message;
  return String(input);
}

function extractHexData(input: unknown, seen = new Set<unknown>()): Hex | undefined {
  if (typeof input === "string") return isHex(input) ? input : undefined;
  if (!input || typeof input !== "object" || seen.has(input)) return undefined;
  seen.add(input);

  const record = input as Record<string, unknown>;
  for (const key of ["data", "cause", "error", "details"]) {
    const value = record[key];
    const found = extractHexData(value, seen);
    if (found) return found;
  }

  return undefined;
}

function humanErrorMessage(name: string, args: readonly unknown[]): string {
  switch (name) {
    case "InvalidCreationFeePayment":
      return `Invalid creation fee payment: expected ${argString(args[0])}, received ${argString(args[1])}.`;
    case "UnexpectedTokenBalanceChange":
      return `Unexpected token balance change for ${argString(args[0])}: expected ${argString(
        args[1],
      )}, received ${argString(args[2])}.`;
    case "OnlyHolder":
      return "Only the current grant holder can perform this action.";
    case "OnlyIssuer":
      return "Only the grant issuer can perform this action.";
    case "GrantClosed":
      return "This grant is already closed.";
    case "GrantExpired":
      return "This grant is expired.";
    case "NotYetExpired":
      return "This grant has not expired yet.";
    case "NonTransferableGrant":
      return `Grant right ${argString(args[0])} is not transferable.`;
    case "GrantTransferLocked":
      return `Grant right ${argString(args[0])} is temporarily transfer locked.`;
    case "GrantTransferNotUnlocked":
      return `Grant right ${argString(args[0])} unlocks at ${argString(args[1])}.`;
    case "InsufficientVestedAmount":
      return `Insufficient vested amount: requested ${argString(args[0])}, available ${argString(args[1])}.`;
    case "AmountExceedsTotal":
      return `Amount exceeds grant total: requested ${argString(args[0])}, available ${argString(args[1])}.`;
    case "CallFailed":
      return `Boardroom call to ${argString(args[0])} failed.`;
    case "EmptyBatch":
      return "Boardroom batch is empty.";
    case "TooManyCalls":
      return `Boardroom batch has ${argString(args[0])} calls; maximum is ${argString(args[1])}.`;
    case "InvalidAddress":
      return "One of the addresses is invalid.";
    case "InvalidAmount":
      return "Amount must be greater than zero.";
    case "InvalidPaymentToken":
      return "Payment token does not match the grant pricing mode.";
    case "InvalidVestingSchedule":
      return "Vesting cliff must be before or equal to vesting end.";
    case "InvalidExpiry":
      return "Expiry must be in the future and at or after vesting end.";
    case "OnlyBoardroom":
      return `Only the locker Boardroom may perform this action; caller was ${argString(args[0])}.`;
    case "PositionNotRegistered":
      return "The liquidity locker has no active PositionManager position.";
    case "LockerAlreadyClosed":
      return "The liquidity locker is already closed.";
    case "DeadlineExpired":
      return `The transaction deadline ${argString(args[0])} has expired.`;
    default:
      return `${name}${args.length > 0 ? `(${args.map(argString).join(", ")})` : ""}`;
  }
}

function argString(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return `[${value.map(argString).join(", ")}]`;
  return String(value);
}
