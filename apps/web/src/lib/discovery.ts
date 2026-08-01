import type { Address, DiscoveryResult, PledgeCashDeployment } from "@pledge.cash/sdk";
import type { DiscoverySnapshot } from "./types";

const BIGINT_MARKER = "__pledgeCashBigint";
const DISCOVERY_VERSION = 1;
const WALLET_ACCESS_DISCOVERY_CHUNK_SIZE = 5000n;
const WALLET_ACCESS_FALLBACK_SCAN_BLOCKS = 100_000n;
const WALLET_ACCESS_DEPLOYMENT_TIMESTAMP_MARGIN_SECONDS = 600n;
const DEPLOYMENT_DISCOVERY_FIELDS = [
  "boardroomFactory",
  "tokenGrantFactory",
  "distributionFactory",
  "pledgeV4LiquidityFactory",
] as const;

export type DiscoveryScanRange = {
  fromBlock: bigint;
  toBlock?: bigint | "latest";
  chunkSize: bigint;
  rangeMode?: DiscoverySnapshot["rangeMode"];
};

type BlockTimestampReader = {
  getBlock: (args?: { blockNumber?: bigint }) => Promise<{ number: bigint | null; timestamp: bigint }>;
};

export function emptyDiscoverySnapshot(): DiscoverySnapshot {
  return {
    complete: true,
    errors: [],
    boardroomsByAddress: {},
    grantsByAddress: {},
    distributionsByAddress: {},
    lockersByAddress: {},
  };
}

export function deploymentDiscoveryIdentity(deployment: PledgeCashDeployment | undefined): string | undefined {
  if (!deployment) return undefined;
  const chain = Number.isNaN(deployment.chainId) ? "status" : deployment.chainId.toString();
  const deployedAt = deployment.deploymentTimestamp?.toString() ?? "-";
  const fields = DEPLOYMENT_DISCOVERY_FIELDS.map((field) => `${field}:${deployment[field]?.toLowerCase() ?? "-"}`);
  return [`chain:${chain}`, `deploymentTimestamp:${deployedAt}`, ...fields].join("|");
}

export async function walletAccessDiscoveryRange(
  client: BlockTimestampReader,
  deployment: PledgeCashDeployment | undefined,
): Promise<DiscoveryScanRange> {
  const latest = await client.getBlock();
  const latestNumber = latest.number ?? 0n;
  const targetTimestamp = deploymentScanTargetTimestamp(deployment?.deploymentTimestamp);

  if (targetTimestamp !== undefined && targetTimestamp <= latest.timestamp) {
    return {
      fromBlock: await firstBlockAtOrAfterTimestamp(client, latestNumber, targetTimestamp),
      chunkSize: WALLET_ACCESS_DISCOVERY_CHUNK_SIZE,
      rangeMode: "deployment",
    };
  }

  return {
    fromBlock: recentDiscoveryStartBlock(latestNumber),
    chunkSize: WALLET_ACCESS_DISCOVERY_CHUNK_SIZE,
    rangeMode: "recent",
  };
}

export function resumeWalletAccessRange(
  range: DiscoveryScanRange,
  discovery: DiscoverySnapshot,
): DiscoveryScanRange {
  if (!canResumeDiscovery(discovery)) {
    return range;
  }

  return { ...range, fromBlock: discovery.lastScannedBlock + 1n };
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

async function firstBlockAtOrAfterTimestamp(
  client: BlockTimestampReader,
  latestNumber: bigint,
  targetTimestamp: bigint,
): Promise<bigint> {
  let low = 0n;
  let high = latestNumber;
  let candidate = latestNumber;

  while (low <= high) {
    const mid = (low + high) / 2n;
    const block = await client.getBlock({ blockNumber: mid });

    if (block.timestamp >= targetTimestamp) {
      candidate = mid;
      if (mid === 0n) break;
      high = mid - 1n;
    } else {
      low = mid + 1n;
    }
  }

  return candidate;
}

function replaceBigints(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return { [BIGINT_MARKER]: value.toString() };
  return value;
}

function reviveBigints(_key: string, value: unknown): unknown {
  if (hasSerializedBigint(value)) {
    return BigInt(value[BIGINT_MARKER]);
  }
  return value;
}

function deploymentScanTargetTimestamp(deploymentTimestamp: bigint | undefined): bigint | undefined {
  if (deploymentTimestamp === undefined) return undefined;
  if (deploymentTimestamp > WALLET_ACCESS_DEPLOYMENT_TIMESTAMP_MARGIN_SECONDS) {
    return deploymentTimestamp - WALLET_ACCESS_DEPLOYMENT_TIMESTAMP_MARGIN_SECONDS;
  }
  return 0n;
}

function recentDiscoveryStartBlock(latestNumber: bigint): bigint {
  return latestNumber > WALLET_ACCESS_FALLBACK_SCAN_BLOCKS
    ? latestNumber - WALLET_ACCESS_FALLBACK_SCAN_BLOCKS
    : 0n;
}

function canResumeDiscovery(discovery: DiscoverySnapshot): discovery is DiscoverySnapshot & { lastScannedBlock: bigint } {
  if (discovery.rangeMode !== "deployment" && discovery.rangeMode !== "recent") return false;
  if (!discovery.complete) return false;
  return discovery.lastScannedBlock !== undefined;
}

function hasSerializedBigint(value: unknown): value is Record<typeof BIGINT_MARKER, string> {
  return Boolean(
    value
      && typeof value === "object"
      && BIGINT_MARKER in value
      && typeof (value as Record<string, unknown>)[BIGINT_MARKER] === "string",
  );
}
