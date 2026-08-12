import type { Address } from "@pledge.cash/sdk";

export type ExactRational = {
  numerator: bigint;
  denominator: bigint;
};

export type MetricState<T> =
  | { status: "known"; value: T }
  | { status: "unknown" | "unavailable"; reason: string; reasons: readonly string[] };

export type ExactTokenAmount = {
  token: Address;
  raw: bigint;
  decimals: number;
  units: ExactRational;
};

export type NormalizedPrice = {
  baseToken: Address;
  baseDecimals: number;
  quoteToken: Address;
  quoteDecimals: number;
  quotePerBase: ExactRational;
};

export function exactRational(numerator: bigint, denominator: bigint = 1n): ExactRational {
  if (denominator === 0n) throw new Error("An exact rational denominator cannot be zero.");
  if (numerator === 0n) return { numerator: 0n, denominator: 1n };
  const sign = denominator < 0n ? -1n : 1n;
  const divisor = greatestCommonDivisor(absoluteBigInt(numerator), absoluteBigInt(denominator));
  return {
    numerator: (numerator * sign) / divisor,
    denominator: (denominator * sign) / divisor,
  };
}

export function divideRationals(first: ExactRational, second: ExactRational): ExactRational {
  if (second.numerator === 0n) throw new Error("Cannot divide by an exact zero value.");
  return exactRational(first.numerator * second.denominator, first.denominator * second.numerator);
}

export function subtractRationals(first: ExactRational, second: ExactRational): ExactRational {
  return exactRational(
    first.numerator * second.denominator - second.numerator * first.denominator,
    first.denominator * second.denominator,
  );
}

export function knownMetric<T>(value: T): MetricState<T> {
  return { status: "known", value };
}

export function unavailableMetric<T>(reason: string | readonly string[]): MetricState<T> {
  const reasons = typeof reason === "string" ? [reason] : reason;
  return { status: "unavailable", reason: reasons.join(" "), reasons };
}

export function exactTokenAmount(token: Address, raw: bigint, decimals: number): ExactTokenAmount {
  if (raw < 0n) throw new Error("Token amount must not be negative.");
  const checked = checkedDecimals(decimals);
  return { token, raw, decimals: checked, units: exactRational(raw, 10n ** BigInt(checked)) };
}

export function normalizedPriceFromAmounts(
  baseAmount: ExactTokenAmount,
  quoteAmount: ExactTokenAmount,
): NormalizedPrice {
  if (baseAmount.raw === 0n) throw new Error("A normalized price requires a positive base-token amount.");
  return {
    baseToken: baseAmount.token,
    baseDecimals: baseAmount.decimals,
    quoteToken: quoteAmount.token,
    quoteDecimals: quoteAmount.decimals,
    quotePerBase: divideRationals(quoteAmount.units, baseAmount.units),
  };
}

function checkedDecimals(decimals: number): number {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error("Token decimals must be an integer between 0 and 255.");
  }
  return decimals;
}

function absoluteBigInt(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function greatestCommonDivisor(first: bigint, second: bigint): bigint {
  let left = first;
  let right = second;
  while (right !== 0n) {
    const next = left % right;
    left = right;
    right = next;
  }
  return left === 0n ? 1n : left;
}
