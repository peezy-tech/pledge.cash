import { QuoteRequestError } from "../api/dto";

export function ceilBps(amount: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new QuoteRequestError("Basis points are outside the supported range.", "invalid_bps");
  }
  if (amount < 0n) {
    throw new QuoteRequestError("Amount cannot be negative.", "invalid_amount");
  }
  return (amount * BigInt(bps) + 9_999n) / 10_000n;
}

export function minimumWithSlippage(amount: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new QuoteRequestError("Slippage is outside the supported range.", "invalid_slippage");
  }
  return (amount * BigInt(10_000 - bps)) / 10_000n;
}

export function maximumWithSlippage(amount: bigint, bps: number): bigint {
  return amount + ceilBps(amount, bps);
}

export function convertAtomicDecimals(
  amount: bigint,
  fromDecimals: number,
  toDecimals: number,
): bigint {
  if (
    amount < 0n ||
    !Number.isInteger(fromDecimals) ||
    !Number.isInteger(toDecimals) ||
    fromDecimals < 0 ||
    toDecimals < 0 ||
    fromDecimals > 30 ||
    toDecimals > 30
  ) {
    throw new QuoteRequestError("Invalid atomic-unit conversion.", "invalid_decimals");
  }
  if (fromDecimals === toDecimals) return amount;
  if (fromDecimals < toDecimals) {
    return amount * 10n ** BigInt(toDecimals - fromDecimals);
  }
  const divisor = 10n ** BigInt(fromDecimals - toDecimals);
  if (amount % divisor !== 0n) {
    throw new QuoteRequestError(
      "The destination amount cannot be represented exactly by the payment asset.",
      "inexact_payment_amount",
    );
  }
  return amount / divisor;
}
