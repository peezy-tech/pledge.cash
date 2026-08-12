import type { Address, DiscoveryResult } from "@pledge.cash/sdk";
import type { DiscoverySnapshot } from "./types";

export function emptyDiscoverySnapshot(): DiscoverySnapshot {
  return {
    complete: true,
    errors: [],
    boardroomsByAddress: {},
    grantsByAddress: {},
    lockersByAddress: {},
  };
}

export function addressMapKey(address: Address): string {
  return address.toLowerCase();
}

export function combineDiscoveryLastScanned(results: readonly DiscoveryResult<unknown>[]): bigint | undefined {
  const scanned = results.map((result) => result.lastScannedBlock).filter((block): block is bigint => block !== undefined);
  if (scanned.length === 0) return undefined;
  return scanned.reduce((minimum, block) => (block < minimum ? block : minimum));
}

export function discoveryErrors(results: readonly DiscoveryResult<unknown>[]): string[] {
  return results.flatMap((result) => result.errors.map((error) => error.message));
}

export function emptyDiscoveryResult<T>(items: T[] = []): DiscoveryResult<T> {
  return {
    items,
    fromBlock: 0n,
    toBlock: undefined,
    complete: true,
    errors: [],
  };
}

export function mergeAddressMap<T>(
  current: Record<string, T>,
  items: readonly T[],
  key: (item: T) => Address,
): Record<string, T> {
  const next = { ...current };
  for (const item of items) {
    next[addressMapKey(key(item))] = item;
  }
  return next;
}

export function parseDiscoveryToBlock(value: string): bigint | "latest" {
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "latest") return "latest";
  if (!/^\d+$/.test(trimmed)) throw new Error("To block must be an unsigned integer or latest.");
  return BigInt(trimmed);
}
