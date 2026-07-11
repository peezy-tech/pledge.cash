import { erc20Abi, isZeroAddress, type Address, type PledgeCashReadClient } from "@pledge.cash/sdk";
import { formatUnits, parseUnits } from "viem";
import { errorMessage } from "./forms";

export type TokenMetadata = {
  address: Address;
  decimals?: number;
  symbol?: string;
  error?: string;
};

type TokenAmountFormatOptions = {
  compact?: boolean;
  maximumFractionDigits?: number;
  rawFallback?: boolean;
  symbol?: string | undefined;
};

const DECIMAL_INPUT_PATTERN = /^\d+(?:\.\d+)?$/;
const COMPACT_SUFFIXES = ["", "k", "m", "b", "t", "q"] as const;
const DEFAULT_COMPACT_FRACTION_DIGITS = 4;
const DEFAULT_FULL_FRACTION_DIGITS = 6;
const TOKEN_METADATA_READ_CONCURRENCY = 8;

export async function readTokenMetadata(
  client: PledgeCashReadClient,
  address: Address,
): Promise<TokenMetadata> {
  const metadata: TokenMetadata = { address };

  try {
    metadata.symbol = (await client.readContract({ address, abi: erc20Abi, functionName: "symbol" })) as string;
  } catch (error) {
    metadata.error = errorMessage(error);
  }

  try {
    metadata.decimals = Number(await client.readContract({ address, abi: erc20Abi, functionName: "decimals" }));
  } catch (error) {
    metadata.error = metadata.error ?? errorMessage(error);
  }

  return metadata;
}

export async function readTokenMetadataMap(
  client: PledgeCashReadClient,
  addresses: readonly (Address | undefined)[],
): Promise<Record<string, TokenMetadata>> {
  const unique = uniqueTokenAddresses(addresses);
  const entries: Array<readonly [string, TokenMetadata]> = [];
  for (let index = 0; index < unique.length; index += TOKEN_METADATA_READ_CONCURRENCY) {
    entries.push(...await Promise.all(unique.slice(index, index + TOKEN_METADATA_READ_CONCURRENCY)
      .map(async (address) => [address.toLowerCase(), await readTokenMetadata(client, address)] as const)));
  }
  return Object.fromEntries(entries);
}

export function tokenMetadataFor(
  metadataByAddress: Record<string, TokenMetadata> | undefined,
  address: Address | undefined,
): TokenMetadata | undefined {
  if (!isUsableTokenAddress(address)) return undefined;
  return metadataByAddress?.[address.toLowerCase()];
}

export function parseTokenAmountInput(value: string, metadata: TokenMetadata, label: string): bigint {
  if (metadata.decimals === undefined) {
    throw new Error(`${label} cannot be parsed because token decimals could not be read.`);
  }

  const normalized = normalizeDecimalInput(value, label);
  return parseUnits(normalized, metadata.decimals);
}

export function formatTokenAmount(
  amount: bigint | undefined,
  metadata: TokenMetadata | undefined,
  options: TokenAmountFormatOptions = {},
): string {
  if (amount === undefined) return "Unknown";
  const symbol = options.symbol ?? metadata?.symbol;

  if (!hasTokenDecimals(metadata)) {
    return appendTokenSymbol(formatRawTokenAmount(amount, options.rawFallback), symbol);
  }

  return appendTokenSymbol(formatDecimalString(formatUnits(amount, metadata.decimals), {
    compact: options.compact ?? true,
    maximumFractionDigits: options.maximumFractionDigits ?? DEFAULT_COMPACT_FRACTION_DIGITS,
  }), symbol);
}

export function formatNativeTokenAmount(amount: bigint | undefined, symbol = "native"): string {
  if (amount === undefined) return "Unknown";
  const value = formatDecimalString(formatUnits(amount, 18), {
    compact: true,
    maximumFractionDigits: DEFAULT_COMPACT_FRACTION_DIGITS,
  });
  return `${value} ${symbol}`;
}

export function normalizeDecimalInput(value: string, label: string): string {
  const trimmed = value.trim().replace(/,/g, "");
  if (!trimmed) return "0";
  if (!DECIMAL_INPUT_PATTERN.test(trimmed)) {
    throw new Error(`${label} must be a positive decimal amount.`);
  }
  return trimmed;
}

export function formatDecimalString(
  value: string,
  options: { compact?: boolean; maximumFractionDigits?: number } = {},
): string {
  const trimmed = trimDecimal(value);
  if (!options.compact) return trimFraction(trimmed, options.maximumFractionDigits ?? DEFAULT_FULL_FRACTION_DIGITS);
  return compactDecimalString(trimmed, options.maximumFractionDigits ?? DEFAULT_COMPACT_FRACTION_DIGITS);
}

export function trimDecimal(value: string): string {
  if (!value.includes(".")) return value;
  return value.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
}

function uniqueTokenAddresses(addresses: readonly (Address | undefined)[]): Address[] {
  const seen = new Set<string>();
  const unique: Address[] = [];

  for (const address of addresses) {
    if (!isUsableTokenAddress(address)) continue;
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(address);
  }

  return unique;
}

function compactDecimalString(value: string, maximumFractionDigits: number): string {
  const [wholePart = "0", fractionPart = ""] = value.split(".");
  const whole = stripLeadingZeroes(wholePart);
  if (whole !== "0" && whole.length >= 4) return formatCompactInteger(whole);
  if (whole !== "0") return trimFraction(`${whole}.${fractionPart}`, maximumFractionDigits);

  return compactFractionOnlyDecimal(fractionPart, maximumFractionDigits);
}

function compactFractionOnlyDecimal(fractionPart: string, maximumFractionDigits: number): string {
  const trimmedFraction = fractionPart.replace(/0+$/, "");
  if (!trimmedFraction) return "0";
  const firstNonZero = trimmedFraction.search(/[1-9]/);
  const visibleDigits = Math.max(maximumFractionDigits, firstNonZero + 2);
  return trimFraction(`0.${trimmedFraction}`, visibleDigits);
}

function formatCompactInteger(value: string): string {
  const whole = stripLeadingZeroes(value);
  if (whole.length < 4) return whole;

  const tier = Math.min(Math.floor((whole.length - 1) / 3), COMPACT_SUFFIXES.length - 1);
  const suffix = COMPACT_SUFFIXES[tier] ?? "";
  const groupDigits = whole.length - tier * 3;
  const leading = whole.slice(0, groupDigits);
  const decimal = whole.slice(groupDigits, groupDigits + 1);
  const compact = decimal && decimal !== "0" ? `${leading}.${decimal}` : leading;
  return `${compact}${suffix}`;
}

function trimFraction(value: string, maximumFractionDigits: number): string {
  if (!value.includes(".")) return value;
  const [whole = "0", fraction = ""] = value.split(".");
  const trimmed = fraction.slice(0, maximumFractionDigits).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

function stripLeadingZeroes(value: string): string {
  return value.replace(/^0+/, "") || "0";
}

function isUsableTokenAddress(address: Address | undefined): address is Address {
  return Boolean(address && !isZeroAddress(address));
}

function hasTokenDecimals(metadata: TokenMetadata | undefined): metadata is TokenMetadata & { decimals: number } {
  return metadata?.decimals !== undefined;
}

function formatRawTokenAmount(amount: bigint, rawFallback: boolean | undefined): string {
  if (rawFallback === false) return amount.toString();
  return `${formatCompactInteger(amount.toString())} raw`;
}

function appendTokenSymbol(value: string, symbol: string | undefined): string {
  return symbol ? `${value} ${symbol}` : value;
}
