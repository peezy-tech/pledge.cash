import { pledgeCashErrorMessage, ZERO_ADDRESS, type Address } from "@pledge.cash/sdk";
import { getAddress, isAddress, type Hex } from "viem";
import type {
  CurveMigrationForm,
  FixedPriceSaleForm,
  GrantForm,
  LockedLiquidityExitForm,
  LockedLiquidityForm,
  MigratingCurveForm,
  BoardroomGrantForm,
  WalletState,
  WindDownForm,
} from "./types";

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

export function defaultWorkflowWindow(): { startTime: string; endTime: string } {
  const now = Math.floor(Date.now() / 1000);
  return {
    startTime: String(now),
    endTime: String(now + 7200),
  };
}

export function defaultDeadline(): string {
  return String(Math.floor(Date.now() / 1000) + 900);
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

export function defaultFixedPriceSaleForm(): FixedPriceSaleForm {
  return {
    paymentToken: "",
    shareAmount: "1000000000000000000",
    price: "1000000000000000000",
    maxPerBuyer: "0",
    ...defaultWorkflowWindow(),
    salt: randomSalt(),
  };
}

export function defaultMigratingCurveForm(): MigratingCurveForm {
  return {
    quoteToken: "",
    saleSupply: "1000000000000000000",
    migrationSupply: "1000000000000000000",
    basePrice: "1000000000000000000",
    slope: "0",
    graduationQuoteTarget: "1000000000000000000",
    quoteToLpBps: "5000",
    ...defaultWorkflowWindow(),
    migrationSalt: randomSalt(),
    salt: randomSalt(),
  };
}

export function defaultLockedLiquidityForm(): LockedLiquidityForm {
  return {
    quoteToken: "",
    shareAmountDesired: "1000000000000000000",
    quoteAmountDesired: "1000000000000000000",
    shareAmountMin: "0",
    quoteAmountMin: "0",
    deadline: defaultDeadline(),
    salt: randomSalt(),
    shareTokenSide: "tokenA",
  };
}

export function defaultCurveMigrationForm(): CurveMigrationForm {
  return {
    minShareLiquidity: "0",
    minQuoteLiquidity: "0",
    deadline: defaultDeadline(),
  };
}

export function defaultLockedLiquidityExitForm(): LockedLiquidityExitForm {
  return {
    amountAMin: "0",
    amountBMin: "0",
    deadline: defaultDeadline(),
  };
}

export function defaultWindDownForm(): WindDownForm {
  return {
    redeemableAsset: "",
    redeemShares: "0",
    redeemRecipient: "",
    minAmountsOut: "",
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
