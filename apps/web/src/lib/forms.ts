import { pledgeCashErrorMessage, ZERO_ADDRESS, type Address } from "@pledge.cash/sdk";
import { getAddress, isAddress, type Hex } from "viem";
import type { BoardroomGrantForm, GrantForm, WalletState } from "./types";

export function randomSalt(): Hex {
  const bytes = new Uint8Array(32);
  if (globalThis.crypto) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function defaultTimes(): Pick<GrantForm, "vestingCliff" | "vestingEnd" | "expiry"> {
  const now = Math.floor(Date.now() / 1000);
  return {
    vestingCliff: String(now + 60),
    vestingEnd: String(now + 3600),
    expiry: String(now + 7200),
  };
}

export function defaultGrantForm(): GrantForm {
  return {
    holder: "",
    token: "",
    paymentToken: ZERO_ADDRESS,
    amount: "1000000000000000000",
    price: "0",
    ...defaultTimes(),
    transferable: false,
    transferUnlockTime: "0",
    salt: randomSalt(),
  };
}

export function defaultBoardroomGrantForm(): BoardroomGrantForm {
  return {
    holder: "",
    paymentToken: ZERO_ADDRESS,
    amount: "1000000000000000000",
    price: "0",
    ...defaultTimes(),
    transferable: false,
    transferUnlockTime: "0",
    salt: randomSalt(),
  };
}

export function shortAddress(address: string | undefined): string {
  if (!address) return "None";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function errorMessage(error: unknown): string {
  return pledgeCashErrorMessage(error);
}

export function bigintString(value: bigint | undefined): string {
  if (value === undefined) return "Unknown";
  return value.toString();
}

export function dateString(timestamp: bigint | undefined): string {
  if (timestamp === undefined) return "Unknown";
  const milliseconds = Number(timestamp) * 1000;
  if (!Number.isSafeInteger(milliseconds)) return timestamp.toString();
  return `${timestamp.toString()} (${new Date(milliseconds).toLocaleString()})`;
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
  if (!/^0x[0-9a-fA-F]{64}$/.test(trimmed)) throw new Error(`${label} must be bytes32.`);
  return trimmed as Hex;
}

export function uintInput(value: string, label: string): bigint {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) throw new Error(`${label} must be an unsigned integer.`);
  return BigInt(trimmed);
}

export function optionalPaymentToken(value: string): Address {
  const trimmed = value.trim();
  if (!trimmed) return ZERO_ADDRESS;
  return requireAddress(trimmed, "Payment token");
}

export function walletState(account: Address | undefined, chainId: number | undefined): WalletState {
  const next: WalletState = {};
  if (account) next.account = account;
  if (chainId !== undefined) next.chainId = chainId;
  return next;
}
