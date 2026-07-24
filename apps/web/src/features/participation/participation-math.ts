import type { Hex } from "viem";

const BPS = 10_000n;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const UNSIGNED_INTEGER_PATTERN = /^\d+$/;

export function maximumWithSlippage(amount: bigint, slippageBps: bigint): bigint {
  requireSlippageBps(slippageBps);
  if (amount === 0n || slippageBps === 0n) return amount;
  return amount + divideUp(amount * slippageBps, BPS);
}

export function minimumWithSlippage(amount: bigint, slippageBps: bigint): bigint {
  requireSlippageBps(slippageBps);
  return amount - (amount * slippageBps) / BPS;
}

export function parseSlippageBps(value: string): bigint {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error("Slippage must be a percentage with at most two decimal places.");
  }

  const [whole = "0", fraction = ""] = normalized.split(".");
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0") || "0");
  requireSlippageBps(result);
  return result;
}

export function parseUnsignedInteger(value: string, label: string): bigint {
  const normalized = value.trim();
  if (!UNSIGNED_INTEGER_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a non-negative whole number.`);
  }
  return BigInt(normalized);
}

export function parseMerkleProof(value: string): readonly Hex[] {
  const normalized = value.trim();
  if (!normalized) return [];

  const candidates = normalized.startsWith("[")
    ? parseProofJson(normalized)
    : normalized.split(/[\s,]+/).filter(Boolean);

  return candidates.map((candidate, index) => {
    if (!BYTES32_PATTERN.test(candidate)) {
      throw new Error(`Proof item ${(index + 1).toString()} must be a 32-byte hex value.`);
    }
    return candidate as Hex;
  });
}

export function parseBytes32(value: string, label: string): Hex {
  const normalized = value.trim();
  if (!BYTES32_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a 32-byte hex value.`);
  }
  return normalized as Hex;
}

export function transactionDeadline(minutes: string, nowSeconds = Math.floor(Date.now() / 1_000)): bigint {
  const duration = parseUnsignedInteger(minutes, "Deadline");
  if (duration === 0n || duration > 1_440n) {
    throw new Error("Deadline must be between 1 and 1,440 minutes.");
  }
  return BigInt(nowSeconds) + duration * 60n;
}

export function unixWindowStatus(
  startTime: bigint,
  endTime: bigint,
  nowSeconds = Math.floor(Date.now() / 1_000),
  endExclusive = false,
): "ended" | "not-started" | "open" {
  const now = BigInt(nowSeconds);
  if (now < startTime) return "not-started";
  if (endTime !== 0n && (endExclusive ? now >= endTime : now > endTime)) return "ended";
  return "open";
}

function requireSlippageBps(value: bigint): void {
  if (value < 0n || value > 5_000n) {
    throw new Error("Slippage must be between 0% and 50%.");
  }
}

function divideUp(numerator: bigint, denominator: bigint): bigint {
  return numerator === 0n ? 0n : (numerator - 1n) / denominator + 1n;
}

function parseProofJson(value: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Proof JSON could not be parsed.");
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error("Proof JSON must be an array of hex strings.");
  }
  return parsed as string[];
}
