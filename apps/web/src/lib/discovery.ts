import type { Address, DiscoveryResult, PledgeCashDeployment } from "@pledge.cash/sdk";
import type { DiscoverySnapshot } from "./types";

const BIGINT_MARKER = "__pledgeCashBigint";
const DISCOVERY_VERSION = 1;
const DEPLOYMENT_DISCOVERY_FIELDS = [
  "boardroomFactory",
  "tokenGrantFactory",
  "distributionFactory",
  "lockedLiquidityFactory",
  "ammFactory",
] as const;

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

export function deploymentDiscoveryIdentity(deployment: PledgeCashDeployment | undefined): string | undefined {
  if (!deployment) return undefined;
  const chain = Number.isNaN(deployment.chainId) ? "status" : deployment.chainId.toString();
  const fields = DEPLOYMENT_DISCOVERY_FIELDS.map((field) => `${field}:${deployment[field]?.toLowerCase() ?? "-"}`);
  return [`chain:${chain}`, ...fields].join("|");
}

export function discoveryStorageKey(
  chainId: number | undefined,
  account: Address | undefined,
  deploymentIdentity?: string | undefined,
): string | undefined {
  if (chainId === undefined || !account) return undefined;
  const scope = deploymentIdentity ? `.${encodeURIComponent(deploymentIdentity)}` : "";
  return `pledge.cash.discovery.v${DISCOVERY_VERSION}.${chainId}${scope}.${account.toLowerCase()}`;
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

export function combineDiscoveryLastScanned(results: readonly DiscoveryResult<unknown>[]): bigint | undefined {
  const scanned = results.map((result) => result.lastScannedBlock).filter((block): block is bigint => block !== undefined);
  if (scanned.length === 0) return undefined;
  return scanned.reduce((minimum, block) => (block < minimum ? block : minimum));
}

export function discoveryErrors(results: readonly DiscoveryResult<unknown>[]): string[] {
  return results.flatMap((result) => result.errors.map((error) => error.message));
}

export function discoveryItems<T>(items: Record<string, T>): T[] {
  return Object.values(items);
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
