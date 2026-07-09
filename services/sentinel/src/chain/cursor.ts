export const WATCHER_CURSOR_SCOPES = [
  "factory-discovery",
  "governance",
  "share-transfers"
] as const;

export type WatcherCursorScope = (typeof WATCHER_CURSOR_SCOPES)[number];

export type CursorWindow = {
  readonly fromBlock: bigint;
  readonly previousBlock: bigint;
  readonly scope: WatcherCursorScope;
  readonly toBlock: bigint;
};

export type CursorReader = {
  getCursor(chainId: number, scope: WatcherCursorScope): Promise<bigint | undefined>;
};

export type CursorWriter = CursorReader & {
  setCursor(chainId: number, scope: WatcherCursorScope, blockNumber: bigint): Promise<void>;
};

export type CursorWindowInput = {
  readonly chainId: number;
  readonly initialBlock: bigint;
  readonly maxBlockRange: bigint;
  readonly safeHead: bigint;
  readonly scope: WatcherCursorScope;
};

export async function loadCursorWindow(
  store: CursorReader,
  input: CursorWindowInput
): Promise<CursorWindow | undefined> {
  const current = await store.getCursor(input.chainId, input.scope);
  return cursorWindow({
    currentBlock: current ?? input.initialBlock,
    maxBlockRange: input.maxBlockRange,
    safeHead: input.safeHead,
    scope: input.scope
  });
}

export function cursorWindow(input: {
  readonly currentBlock: bigint;
  readonly maxBlockRange: bigint;
  readonly safeHead: bigint;
  readonly scope: WatcherCursorScope;
}): CursorWindow | undefined {
  if (input.maxBlockRange <= 0n) {
    throw new Error("SENTINEL_MAX_BLOCK_RANGE must be positive");
  }

  if (input.currentBlock >= input.safeHead) return undefined;

  const toBlock = minBigInt(input.safeHead, input.currentBlock + input.maxBlockRange);
  return {
    fromBlock: input.currentBlock + 1n,
    previousBlock: input.currentBlock,
    scope: input.scope,
    toBlock
  };
}

export async function advanceCursor(
  store: CursorWriter,
  chainId: number,
  window: CursorWindow | undefined
): Promise<void> {
  if (!window) return;
  await store.setCursor(chainId, window.scope, window.toBlock);
}

function minBigInt(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}
