import { getAbiItem, isHex, type Address, type Hex } from "viem";
import {
  boardroomFactoryAbi,
  liquidityLockerFactoryAbi,
  tokenGrantFactoryAbi,
} from "../generated";
import { pledgeCashErrorMessage } from "./errors";
import {
  readBoardroomState,
  readGrantState,
  readLiquidityLockerState,
} from "./readers";
import type {
  BoardroomState,
  DiscoveredBoardroom,
  DiscoveredGrant,
  DiscoveredLiquidityLocker,
  DiscoveryError,
  DiscoveryRange,
  DiscoveryResult,
  EnrichedDiscovery,
  GrantDiscoveryRange,
  GrantState,
  LiquidityLockerState,
  PledgeCashBlockReadClient,
  PledgeCashLogClient,
  PledgeCashReadClient,
} from "./types";

type RawEventLog = {
  args?: Record<string, unknown>;
  blockNumber?: bigint;
  logIndex?: number;
  transactionHash?: Hex;
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const satisfies Address;

const tokenGrantCreatedEvent = getAbiItem({ abi: tokenGrantFactoryAbi, name: "TokenGrantCreated" });
const grantClosedEvent = getAbiItem({ abi: tokenGrantFactoryAbi, name: "GrantClosed" });
const transferEvent = getAbiItem({ abi: tokenGrantFactoryAbi, name: "Transfer" });
const boardroomCreatedEvent = getAbiItem({
  abi: boardroomFactoryAbi,
  name: "BoardroomCreated",
});
const liquidityLockerCreatedEvent = getAbiItem({
  abi: liquidityLockerFactoryAbi,
  name: "LiquidityLockerCreated",
});

export async function queryGrantHistory(
  client: PledgeCashLogClient,
  range: GrantDiscoveryRange,
): Promise<DiscoveredGrant[]> {
  const result = await discoverGrantHistory(client, range);
  if (!result.complete) throw new Error(discoveryErrorsMessage(result.errors));
  return result.items;
}

export async function discoverGrantHistory(
  client: PledgeCashLogClient,
  range: GrantDiscoveryRange,
): Promise<DiscoveryResult<DiscoveredGrant>> {
  const [createdLogs, transferLogs, closedLogs] = await Promise.all([
    getLogs(client, range, range.factory, tokenGrantCreatedEvent),
    getLogs(client, range, range.factory, transferEvent),
    getLogs(client, range, range.factory, grantClosedEvent),
  ]);

  const grants = new Map<string, DiscoveredGrant>();
  for (const grant of range.knownGrants ?? []) {
    grants.set(tokenKey(grant.tokenId), { ...grant });
  }

  for (const log of [...createdLogs.logs].sort(compareLogs)) {
    const args = log.args ?? {};
    const grantAddress = addressArg(args, "grantAddress");
    const tokenId = bigintArg(args, "tokenId");
    if (!grantAddress || tokenId === undefined) continue;

    const discovered: DiscoveredGrant = {
      grantAddress,
      tokenId,
      issuer: addressArg(args, "issuer") ?? ZERO_ADDRESS,
      initialHolder: addressArg(args, "holder") ?? ZERO_ADDRESS,
      currentHolder: addressArg(args, "holder") ?? ZERO_ADDRESS,
      token: addressArg(args, "token") ?? ZERO_ADDRESS,
      paymentToken: addressArg(args, "paymentToken") ?? ZERO_ADDRESS,
      amount: bigintArg(args, "amount") ?? 0n,
      price: bigintArg(args, "price") ?? 0n,
      expiry: bigintArg(args, "expiry") ?? 0n,
      vestingCliff: bigintArg(args, "vestingCliff") ?? 0n,
      vestingEnd: bigintArg(args, "vestingEnd") ?? 0n,
      transferable: booleanArg(args, "transferable") ?? false,
      transferUnlockTime: bigintArg(args, "transferUnlockTime") ?? 0n,
      salt: hexArg(args, "salt") ?? "0x",
      closed: false,
    };
    if (log.blockNumber !== undefined) {
      discovered.createdBlock = log.blockNumber;
      discovered.updatedBlock = log.blockNumber;
    }
    if (log.transactionHash) {
      discovered.transactionHash = log.transactionHash;
    }

    grants.set(tokenKey(tokenId), discovered);
  }

  for (const log of [...transferLogs.logs].sort(compareLogs)) {
    const args = log.args ?? {};
    const tokenId = bigintArg(args, "id") ?? bigintArg(args, "tokenId");
    if (tokenId === undefined) continue;
    const grant = grants.get(tokenKey(tokenId));
    if (!grant) continue;

    const to = addressArg(args, "to");
    if (to) {
      grant.currentHolder = to;
      if (log.blockNumber !== undefined) {
        grant.updatedBlock = log.blockNumber;
      }
    }
  }

  for (const log of [...closedLogs.logs].sort(compareLogs)) {
    const tokenId = bigintArg(log.args ?? {}, "tokenId");
    if (tokenId === undefined) continue;
    const grant = grants.get(tokenKey(tokenId));
    if (!grant) continue;

    grant.closed = true;
    grant.currentHolder = ZERO_ADDRESS;
    const lastHolder = addressArg(log.args ?? {}, "lastHolder");
    if (lastHolder) {
      grant.lastHolder = lastHolder;
    }
    if (log.blockNumber !== undefined) {
      grant.updatedBlock = log.blockNumber;
    }
  }

  return discoveryResult(
    range,
    [...grants.values()].sort((left, right) => compareBlockDesc(left.createdBlock, right.createdBlock)),
    [createdLogs, transferLogs, closedLogs],
  );
}

export async function discoverBoardrooms(
  client: PledgeCashLogClient,
  input: DiscoveryRange & { factory: Address; owner?: Address },
): Promise<DiscoveryResult<DiscoveredBoardroom>> {
  const result = await getLogs(client, input, input.factory, boardroomCreatedEvent);
  const boardrooms = new Map<string, DiscoveredBoardroom>();

  for (const log of [...result.logs].sort(compareLogs)) {
    const args = log.args ?? {};
    const boardroom = addressArg(args, "boardroom");
    const owner = addressArg(args, "owner");
    const shareToken = addressArg(args, "shareToken");
    if (!boardroom || !owner || !shareToken) continue;
    if (input.owner && !sameAddress(owner, input.owner)) continue;

    boardrooms.set(addressKey(boardroom), {
      boardroom,
      owner,
      wrappedNative: addressArg(args, "wrappedNative") ?? ZERO_ADDRESS,
      shareToken,
      name: stringArg(args, "name") ?? "",
      symbol: stringArg(args, "symbol") ?? "",
      salt: hexArg(args, "salt") ?? "0x",
      createdAtBlock: log.blockNumber ?? 0n,
      transactionHash: log.transactionHash ?? "0x",
    });
  }

  return discoveryResult(
    input,
    [...boardrooms.values()].sort((left, right) => compareBlockDesc(left.createdAtBlock, right.createdAtBlock)),
    [result],
  );
}

export async function discoverLiquidityLockers(
  client: PledgeCashLogClient,
  input: DiscoveryRange & { factory: Address; boardroom?: Address },
): Promise<DiscoveryResult<DiscoveredLiquidityLocker>> {
  const result = await getLogs(client, input, input.factory, liquidityLockerCreatedEvent);
  const lockers = new Map<string, DiscoveredLiquidityLocker>();

  for (const log of [...result.logs].sort(compareLogs)) {
    const args = log.args ?? {};
    const locker = addressArg(args, "locker");
    const boardroom = addressArg(args, "boardroom");
    if (!locker || !boardroom) continue;
    if (input.boardroom && !sameAddress(boardroom, input.boardroom)) continue;

    lockers.set(addressKey(locker), {
      locker,
      boardroom,
      factory: input.factory,
      quoteAsset: addressArg(args, "quoteAsset") ?? ZERO_ADDRESS,
      poolFee: numberArg(args, "poolFee") ?? 0,
      tickSpacing: numberArg(args, "tickSpacing") ?? 0,
      salt: hexArg(args, "salt") ?? "0x",
      createdAtBlock: log.blockNumber ?? 0n,
      transactionHash: log.transactionHash ?? "0x",
    });
  }

  return discoveryResult(
    input,
    [...lockers.values()].sort((left, right) => compareBlockDesc(left.createdAtBlock, right.createdAtBlock)),
    [result],
  );
}

export async function enrichDiscoveredBoardrooms(
  client: PledgeCashBlockReadClient,
  boardrooms: readonly DiscoveredBoardroom[],
): Promise<EnrichedDiscovery<DiscoveredBoardroom, BoardroomState>[]> {
  return await Promise.all(
    boardrooms.map(async (boardroom) => {
      try {
        return { ...boardroom, state: await readBoardroomState(client, boardroom.boardroom), stale: false };
      } catch (error) {
        return { ...boardroom, stale: true, error: error instanceof Error ? error.message : String(error) };
      }
    }),
  );
}

export async function enrichDiscoveredGrants(
  client: PledgeCashReadClient,
  grants: readonly DiscoveredGrant[],
): Promise<EnrichedDiscovery<DiscoveredGrant, GrantState>[]> {
  return await Promise.all(
    grants.map(async (grant) => {
      try {
        return { ...grant, state: await readGrantState(client, grant.grantAddress), stale: false };
      } catch (error) {
        return { ...grant, stale: true, error: error instanceof Error ? error.message : String(error) };
      }
    }),
  );
}

export async function enrichDiscoveredLiquidityLockers(
  client: PledgeCashReadClient,
  lockers: readonly DiscoveredLiquidityLocker[],
): Promise<EnrichedDiscovery<DiscoveredLiquidityLocker, LiquidityLockerState>[]> {
  return await Promise.all(
    lockers.map(async (locker) => {
      try {
        return { ...locker, state: await readLiquidityLockerState(client, locker.locker), stale: false };
      } catch (error) {
        return { ...locker, stale: true, error: error instanceof Error ? error.message : String(error) };
      }
    }),
  );
}

export async function queryGrantsIssuedByAddress(
  client: PledgeCashLogClient,
  input: GrantDiscoveryRange & { issuer: Address; includeClosed?: boolean },
): Promise<DiscoveredGrant[]> {
  const grants = await queryGrantHistory(client, input);
  return grants.filter(
    (grant) => sameAddress(grant.issuer, input.issuer) && (input.includeClosed || !grant.closed),
  );
}

export async function queryGrantsHeldByAddress(
  client: PledgeCashLogClient,
  input: GrantDiscoveryRange & { holder: Address; includeClosed?: boolean },
): Promise<DiscoveredGrant[]> {
  const grants = await queryGrantHistory(client, input);
  return grants.filter((grant) => {
    if (sameAddress(grant.currentHolder, input.holder) && (input.includeClosed || !grant.closed)) return true;
    return Boolean(input.includeClosed && grant.closed && grant.lastHolder && sameAddress(grant.lastHolder, input.holder));
  });
}

type LogDiscoveryResult = DiscoveryResult<RawEventLog> & {
  logs: RawEventLog[];
};

async function getLogs(
  client: PledgeCashLogClient,
  range: DiscoveryRange,
  address: Address,
  event: unknown,
): Promise<LogDiscoveryResult> {
  const fromBlock = range.fromBlock ?? 0n;
  let toBlock = range.toBlock;
  const chunkSize = range.chunkSize;

  if (chunkSize !== undefined && chunkSize <= 0n) {
    return {
      logs: [],
      items: [],
      fromBlock,
      toBlock,
      complete: false,
      errors: [
        {
          fromBlock,
          toBlock,
          message: "Discovery chunk size must be greater than zero.",
        },
      ],
    };
  }

  if (chunkSize !== undefined && (toBlock === undefined || toBlock === "latest")) {
    if (!client.getBlockNumber) {
      return await getLogsSingleRange(client, address, event, fromBlock, toBlock);
    }

    try {
      toBlock = await client.getBlockNumber();
    } catch (error) {
      return {
        logs: [],
        items: [],
        fromBlock,
        toBlock: range.toBlock,
        complete: false,
        errors: [
          {
            fromBlock,
            toBlock: range.toBlock,
            message: `Unable to resolve latest block before chunked discovery. ${pledgeCashErrorMessage(error)}`,
          },
        ],
      };
    }
  }

  if (chunkSize === undefined || typeof toBlock !== "bigint") {
    return await getLogsSingleRange(client, address, event, fromBlock, toBlock);
  }

  if (fromBlock > toBlock) {
    return { logs: [], items: [], fromBlock, toBlock, lastScannedBlock: toBlock, complete: true, errors: [] };
  }

  const logs: RawEventLog[] = [];
  const errors: DiscoveryError[] = [];
  let start = fromBlock;
  let lastScannedBlock: bigint | undefined;

  while (start <= toBlock) {
    const end = minBigInt(start + chunkSize - 1n, toBlock);
    try {
      logs.push(...(await getRawLogs(client, address, event, start, end)));
      lastScannedBlock = end;
      start = end + 1n;
    } catch (error) {
      errors.push(discoveryError(start, end, error));
      break;
    }
  }

  return {
    logs,
    items: logs,
    fromBlock,
    toBlock,
    ...(lastScannedBlock !== undefined ? { lastScannedBlock } : {}),
    complete: errors.length === 0,
    errors,
  };
}

async function getLogsSingleRange(
  client: PledgeCashLogClient,
  address: Address,
  event: unknown,
  fromBlock: bigint,
  toBlock: bigint | "latest" | undefined,
): Promise<LogDiscoveryResult> {
  try {
    const logs = await getRawLogs(client, address, event, fromBlock, toBlock);
    return {
      logs,
      items: logs,
      fromBlock,
      toBlock,
      ...(typeof toBlock === "bigint" ? { lastScannedBlock: toBlock } : {}),
      complete: true,
      errors: [],
    };
  } catch (error) {
    return {
      logs: [],
      items: [],
      fromBlock,
      toBlock,
      complete: false,
      errors: [discoveryError(fromBlock, toBlock, error)],
    };
  }
}

async function getRawLogs(
  client: PledgeCashLogClient,
  address: Address,
  event: unknown,
  fromBlock: bigint,
  toBlock: bigint | "latest" | undefined,
): Promise<RawEventLog[]> {
  return (await client.getLogs({
    address,
    event,
    fromBlock,
    toBlock,
  } as never)) as RawEventLog[];
}

function discoveryResult<T>(
  range: DiscoveryRange,
  items: T[],
  logResults: readonly LogDiscoveryResult[],
): DiscoveryResult<T> {
  const lastScannedBlock = combinedLastScannedBlock(logResults);
  const result: DiscoveryResult<T> = {
    items,
    fromBlock: range.fromBlock ?? 0n,
    toBlock: range.toBlock,
    complete: logResults.every((result) => result.complete),
    errors: logResults.flatMap((result) => result.errors),
  };
  if (lastScannedBlock !== undefined) {
    result.lastScannedBlock = lastScannedBlock;
  }
  return result;
}

function combinedLastScannedBlock(results: readonly LogDiscoveryResult[]): bigint | undefined {
  const blocks = results.map((result) => result.lastScannedBlock).filter((block): block is bigint => block !== undefined);
  if (blocks.length === 0) return undefined;
  return blocks.reduce((minimum, block) => minBigInt(minimum, block));
}

function discoveryError(
  fromBlock: bigint,
  toBlock: bigint | "latest" | undefined,
  error: unknown,
): DiscoveryError {
  return {
    fromBlock,
    toBlock,
    message: `RPC rejected logs for blocks ${fromBlock.toString()}-${toBlock?.toString() ?? "latest"}. Try a smaller chunk size or narrower block range. ${pledgeCashErrorMessage(error)}`,
  };
}

function discoveryErrorsMessage(errors: readonly DiscoveryError[]): string {
  if (errors.length === 0) return "Discovery failed.";
  return errors.map((error) => error.message).join(" ");
}

function minBigInt(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

function sameAddress(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function compareLogs(left: RawEventLog, right: RawEventLog): number {
  const blockOrder = compareBlockAsc(left.blockNumber, right.blockNumber);
  if (blockOrder !== 0) return blockOrder;
  return (left.logIndex ?? 0) - (right.logIndex ?? 0);
}

function compareBlockAsc(left: bigint | undefined, right: bigint | undefined): number {
  const leftBlock = left ?? 0n;
  const rightBlock = right ?? 0n;
  if (leftBlock < rightBlock) return -1;
  if (leftBlock > rightBlock) return 1;
  return 0;
}

function compareBlockDesc(left: bigint | undefined, right: bigint | undefined): number {
  return compareBlockAsc(right, left);
}

function tokenKey(tokenId: bigint): string {
  return tokenId.toString();
}

function addressKey(address: Address): string {
  return address.toLowerCase();
}

function addressArg(args: Record<string, unknown>, name: string): Address | undefined {
  const value = args[name];
  return typeof value === "string" ? (value as Address) : undefined;
}

function stringArg(args: Record<string, unknown>, name: string): string | undefined {
  const value = args[name];
  return typeof value === "string" ? value : undefined;
}

function hexArg(args: Record<string, unknown>, name: string): Hex | undefined {
  const value = args[name];
  return typeof value === "string" && isHex(value) ? value : undefined;
}

function bigintArg(args: Record<string, unknown>, name: string): bigint | undefined {
  const value = args[name];
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  return undefined;
}

function numberArg(args: Record<string, unknown>, name: string): number | undefined {
  const value = args[name];
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "bigint" && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  return undefined;
}

function booleanArg(args: Record<string, unknown>, name: string): boolean | undefined {
  const value = args[name];
  return typeof value === "boolean" ? value : undefined;
}
