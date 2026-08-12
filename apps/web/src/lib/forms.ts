import { pledgeCashErrorMessage, ZERO_ADDRESS, type Address } from "@pledge.cash/sdk";
import { getAddress, isAddress, type Hex } from "viem";
import type {
  BoardroomForm,
  BoardroomGrantForm,
  GrantForm,
  LiquidityExitForm,
  LiquidityLockerForm,
  LiquidityPositionForm,
  WalletState,
  WindDownForm,
} from "./types";

const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const UINT_PATTERN = /^\d+$/;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86_400;
const SECONDS_PER_WEEK = 604_800;
const SECONDS_PER_MONTH = 2_629_800;
const SECONDS_PER_YEAR = 31_557_600;

export function randomSalt(): Hex {
  const bytes = new Uint8Array(32);
  if (globalThis.crypto) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function defaultTimes(): Pick<GrantForm, "vestingCliff" | "vestingEnd" | "expiry"> {
  const now = currentUnixSeconds();
  return {
    vestingCliff: secondsAfter(now, SECONDS_PER_MINUTE),
    vestingEnd: secondsAfter(now, SECONDS_PER_HOUR),
    expiry: secondsAfter(now, 2 * SECONDS_PER_DAY),
  };
}

export function defaultDeadline(): string {
  return secondsAfter(currentUnixSeconds(), 15 * SECONDS_PER_MINUTE);
}

export function defaultGrantForm(): GrantForm {
  return {
    holder: "",
    token: "",
    paymentToken: ZERO_ADDRESS,
    amount: "1",
    price: "0",
    ...defaultTimes(),
    transferable: false,
    transferUnlockTime: "0",
    salt: randomSalt(),
  };
}

export function defaultBoardroomForm(owner = ""): BoardroomForm {
  return { owner, name: "", symbol: "", salt: randomSalt() };
}

export function defaultBoardroomGrantForm(): BoardroomGrantForm {
  return {
    holder: "",
    token: "",
    paymentToken: ZERO_ADDRESS,
    amount: "1",
    price: "0",
    ...defaultTimes(),
    transferable: false,
    transferUnlockTime: "0",
    salt: randomSalt(),
  };
}

export function defaultLiquidityLockerForm(): LiquidityLockerForm {
  return { quoteAsset: "", poolFee: "3000", tickSpacing: "60", salt: randomSalt() };
}

export function defaultLiquidityPositionForm(): LiquidityPositionForm {
  return { tokenId: "" };
}

export function defaultLiquidityExitForm(): LiquidityExitForm {
  return { amount0Min: "0", amount1Min: "0", deadline: defaultDeadline() };
}

export function defaultWindDownForm(): WindDownForm {
  return { asset: "", shares: "0", recipient: "", minAmount: "0" };
}

export function shortAddress(address: string | undefined): string {
  if (!address) return "None";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function errorMessage(error: unknown): string {
  return pledgeCashErrorMessage(error);
}

export function bigintString(value: bigint | undefined): string {
  return value === undefined ? "Unknown" : value.toString();
}

export function dateString(timestamp: bigint | undefined, nowMilliseconds = Date.now()): string {
  if (timestamp === undefined) return "Unknown";
  const milliseconds = Number(timestamp) * 1000;
  if (!Number.isSafeInteger(milliseconds)) return timestamp.toString();
  return `${relativeTimeString(milliseconds, nowMilliseconds)} (${timestamp.toString()}, ${new Date(milliseconds).toLocaleString()})`;
}

function relativeTimeString(milliseconds: number, nowMilliseconds: number): string {
  const deltaSeconds = Math.round((milliseconds - nowMilliseconds) / 1000);
  const absoluteSeconds = Math.abs(deltaSeconds);
  const { unit, value } = relativeTimeUnit(deltaSeconds, absoluteSeconds);
  return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(value, unit);
}

function relativeTimeUnit(
  deltaSeconds: number,
  absoluteSeconds: number,
): { unit: Intl.RelativeTimeFormatUnit; value: number } {
  if (absoluteSeconds < SECONDS_PER_MINUTE) return { unit: "second", value: deltaSeconds };
  if (absoluteSeconds < SECONDS_PER_HOUR) return { unit: "minute", value: Math.round(deltaSeconds / SECONDS_PER_MINUTE) };
  if (absoluteSeconds < SECONDS_PER_DAY) return { unit: "hour", value: Math.round(deltaSeconds / SECONDS_PER_HOUR) };
  if (absoluteSeconds < SECONDS_PER_WEEK) return { unit: "day", value: Math.round(deltaSeconds / SECONDS_PER_DAY) };
  if (absoluteSeconds < SECONDS_PER_MONTH) return { unit: "week", value: Math.round(deltaSeconds / SECONDS_PER_WEEK) };
  if (absoluteSeconds < SECONDS_PER_YEAR) return { unit: "month", value: Math.round(deltaSeconds / SECONDS_PER_MONTH) };
  return { unit: "year", value: Math.round(deltaSeconds / SECONDS_PER_YEAR) };
}

export function requireAddress(value: string, label: string): Address {
  const trimmed = value.trim();
  if (!isAddress(trimmed)) throw new Error(`${label} must be an EVM address.`);
  return getAddress(trimmed);
}

export function requireDeploymentAddress(value: Address | undefined, label: string): Address {
  if (!value) throw new Error(`${label} is missing from the deployment artifact.`);
  return value;
}

export function requireBytes32(value: string, label: string): Hex {
  const trimmed = value.trim();
  if (!BYTES32_PATTERN.test(trimmed)) throw new Error(`${label} must be bytes32.`);
  return trimmed as Hex;
}

export function uintInput(value: string, label: string): bigint {
  const trimmed = value.trim();
  if (!UINT_PATTERN.test(trimmed)) throw new Error(`${label} must be an unsigned integer.`);
  return BigInt(trimmed);
}

export function optionalPaymentToken(value: string): Address {
  const trimmed = value.trim();
  return trimmed ? requireAddress(trimmed, "Payment token") : ZERO_ADDRESS;
}

export function walletState(account: Address | undefined, chainId: number | undefined): WalletState {
  return { ...(account ? { account } : {}), ...(chainId === undefined ? {} : { chainId }) };
}

function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function secondsAfter(startSeconds: number, offsetSeconds: number): string {
  return String(startSeconds + offsetSeconds);
}
