import type { Address } from "@pledge.cash/sdk";
import type { DiscoverySnapshot } from "./types";

const BIGINT_MARKER = "__pledgeCashBigint";
const DISCOVERY_VERSION = 1;

export function emptyDiscoverySnapshot(): DiscoverySnapshot {
  return {
    complete: true,
    errors: [],
    boardroomsByAddress: {},
    grantsByAddress: {},
    distributionsByAddress: {},
    lockersByAddress: {},
    poolsByAddress: {},
  };
}

export function discoveryStorageKey(chainId: number | undefined, account: Address | undefined): string | undefined {
  if (chainId === undefined || !account) return undefined;
  return `pledge.cash.discovery.v${DISCOVERY_VERSION}.${chainId}.${account.toLowerCase()}`;
}

export function loadDiscoverySnapshot(key: string | undefined): DiscoverySnapshot {
  if (!key || typeof window === "undefined") return emptyDiscoverySnapshot();
  const raw = window.localStorage.getItem(key);
  if (!raw) return emptyDiscoverySnapshot();

  try {
    return {
      ...emptyDiscoverySnapshot(),
      ...(JSON.parse(raw, reviveBigints) as DiscoverySnapshot),
    };
  } catch {
    return emptyDiscoverySnapshot();
  }
}

export function saveDiscoverySnapshot(key: string | undefined, snapshot: DiscoverySnapshot): void {
  if (!key || typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(snapshot, replaceBigints));
}

export function clearDiscoverySnapshot(key: string | undefined): void {
  if (!key || typeof window === "undefined") return;
  window.localStorage.removeItem(key);
}

export function addressMapKey(address: Address): string {
  return address.toLowerCase();
}

function replaceBigints(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return { [BIGINT_MARKER]: value.toString() };
  return value;
}

function reviveBigints(_key: string, value: unknown): unknown {
  if (
    value
    && typeof value === "object"
    && BIGINT_MARKER in value
    && typeof (value as Record<string, unknown>)[BIGINT_MARKER] === "string"
  ) {
    const raw = (value as Record<string, string>)[BIGINT_MARKER];
    if (raw !== undefined) return BigInt(raw);
  }
  return value;
}
