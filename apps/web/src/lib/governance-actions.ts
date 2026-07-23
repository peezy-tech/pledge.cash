import {
  hydrateScheduledBoardroomOperationCandidates,
  queryScheduledBoardroomOperations,
  type Address,
  type HydratedScheduledBoardroomOperations,
  type PledgeCashGovernanceClient,
  type ScheduledBoardroomOperation,
  type ScheduledBoardroomOperationCandidate,
} from "@pledge.cash/sdk";
import { HealthResponseSchema, PublicActionsResponseSchema } from "@pledge.cash/sentinel/dto";
import type { Hex } from "viem";
import type { SentinelClient } from "./sentinel";

export const SENTINEL_GOVERNANCE_PAGE_LIMIT = 100;
export const SENTINEL_GOVERNANCE_MAX_PAGES = 5;
export const SENTINEL_GOVERNANCE_MAX_CANDIDATES =
  SENTINEL_GOVERNANCE_PAGE_LIMIT * SENTINEL_GOVERNANCE_MAX_PAGES;

type GovernanceSentinelClient = Pick<SentinelClient, "health" | "listBoardroomActions">;

type GovernanceOperationLoaderDependencies = {
  hydrateCandidates?: typeof hydrateScheduledBoardroomOperationCandidates;
  queryChain?: typeof queryScheduledBoardroomOperations;
};

export type GovernanceOperationLoadInput = {
  boardroom: Address;
  chainId: number;
  currentTime?: bigint | undefined;
  deadlineMs?: number | undefined;
  signal?: AbortSignal | undefined;
  sentinelClient?: GovernanceSentinelClient | undefined;
};

export type GovernanceOperationLoadResult = {
  operations: ScheduledBoardroomOperation[];
  complete: boolean;
  source: "chain" | "sentinel";
  warning?: string | undefined;
};

type SentinelCandidates = {
  candidates: ScheduledBoardroomOperationCandidate[];
  invalidCount: number;
  truncated: boolean;
};

/**
 * Sentinel is a bounded candidate index only. The SDK reconstructs each
 * controller event, transaction payload, operation hash, and current epoch
 * from chain data before an operation reaches execution controls.
 */
export async function loadScheduledGovernanceOperations(
  client: PledgeCashGovernanceClient,
  input: GovernanceOperationLoadInput,
  dependencies: GovernanceOperationLoaderDependencies = {},
): Promise<GovernanceOperationLoadResult> {
  const loadSignal = linkedGovernanceLoadSignal(input.signal, input.deadlineMs);
  try {
    return await raceWithAbortSignal(
      loadScheduledGovernanceOperationsWithSignal(client, input, dependencies, loadSignal.signal),
      loadSignal.signal,
    );
  } finally {
    loadSignal.cleanup();
  }
}

async function loadScheduledGovernanceOperationsWithSignal(
  client: PledgeCashGovernanceClient,
  input: GovernanceOperationLoadInput,
  dependencies: GovernanceOperationLoaderDependencies,
  signal: AbortSignal,
): Promise<GovernanceOperationLoadResult> {
  const queryChain = dependencies.queryChain ?? queryScheduledBoardroomOperations;
  const hydrateCandidates = dependencies.hydrateCandidates ?? hydrateScheduledBoardroomOperationCandidates;
  const currentTime = input.currentTime ?? BigInt(Math.floor(Date.now() / 1_000));
  throwIfGovernanceLoadAborted(signal);

  if (!input.sentinelClient) {
    return {
      operations: await queryChain(client, {
        boardrooms: [input.boardroom],
        currentTime,
        signal,
      }),
      complete: true,
      source: "chain",
    };
  }

  const governanceHighWater = await readSentinelGovernanceHighWater(
    input.sentinelClient,
    input.chainId,
    signal,
  );
  const indexed = await readSentinelGovernanceCandidates(
    input.sentinelClient,
    input.chainId,
    input.boardroom,
    signal,
  );
  const tailPromise = readUncoveredGovernanceTail(client, {
    boardroom: input.boardroom,
    currentTime,
    governanceHighWater,
    queryChain,
    signal,
  });
  const [hydrated, tail] = await Promise.all([
    hydrateCandidates(client, {
      candidates: indexed.candidates,
      currentTime,
      signal,
    }),
    tailPromise,
  ]);
  throwIfGovernanceLoadAborted(signal);
  const complete = tail.complete
    && !indexed.truncated
    && indexed.invalidCount === 0
    && hydrated.errors.length === 0;
  const warning = governanceCandidateWarning(
    indexed.invalidCount + hydrated.errors.length,
    indexed.truncated,
    complete,
  );

  return {
    operations: mergeVerifiedGovernanceOperations(hydrated.operations, tail.operations),
    complete,
    source: "sentinel",
    ...(warning ? { warning } : {}),
  };
}

async function readSentinelGovernanceHighWater(
  client: GovernanceSentinelClient,
  chainId: number,
  signal: AbortSignal,
): Promise<bigint | undefined> {
  try {
    const response: unknown = await client.health(signal);
    throwIfGovernanceLoadAborted(signal);
    const parsed = HealthResponseSchema.safeParse(response);
    if (!parsed.success) return undefined;
    const matching = parsed.data.chains.filter((entry) => entry.chainId === chainId);
    if (matching.length !== 1) return undefined;
    return unsignedBigInt(matching[0]?.governanceBlock);
  } catch {
    if (signal.aborted) throw governanceAbortReason(signal);
    return undefined;
  }
}

async function readUncoveredGovernanceTail(
  client: PledgeCashGovernanceClient,
  input: {
    boardroom: Address;
    currentTime: bigint;
    governanceHighWater: bigint | undefined;
    queryChain: typeof queryScheduledBoardroomOperations;
    signal: AbortSignal;
  },
): Promise<{ operations: ScheduledBoardroomOperation[]; complete: boolean }> {
  if (input.governanceHighWater === undefined || !client.getBlockNumber) {
    return { operations: [], complete: false };
  }

  try {
    const head = await client.getBlockNumber();
    throwIfGovernanceLoadAborted(input.signal);
    if (head < input.governanceHighWater) return { operations: [], complete: false };
    if (head === input.governanceHighWater) return { operations: [], complete: true };
    const operations = await input.queryChain(client, {
      boardrooms: [input.boardroom],
      currentTime: input.currentTime,
      fromBlock: input.governanceHighWater + 1n,
      signal: input.signal,
      toBlock: head,
    });
    throwIfGovernanceLoadAborted(input.signal);
    return { operations, complete: true };
  } catch {
    if (input.signal.aborted) throw governanceAbortReason(input.signal);
    return { operations: [], complete: false };
  }
}

async function readSentinelGovernanceCandidates(
  client: GovernanceSentinelClient,
  chainId: number,
  boardroom: Address,
  signal: AbortSignal,
): Promise<SentinelCandidates> {
  const candidates: ScheduledBoardroomOperationCandidate[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let invalidCount = 0;
  let truncated = false;

  for (let pageIndex = 0; pageIndex < SENTINEL_GOVERNANCE_MAX_PAGES; pageIndex += 1) {
    throwIfGovernanceLoadAborted(signal);
    const response: unknown = await client.listBoardroomActions({
      address: boardroom,
      chainId,
      query: {
        ...(cursor ? { cursor } : {}),
        limit: SENTINEL_GOVERNANCE_PAGE_LIMIT,
        status: "scheduled",
      },
      signal,
    });
    throwIfGovernanceLoadAborted(signal);
    const parsed = PublicActionsResponseSchema.safeParse(response);
    if (!parsed.success) throw new Error("The governance index returned an invalid response.");
    if (parsed.data.items.length > SENTINEL_GOVERNANCE_PAGE_LIMIT) {
      throw new Error("The governance index exceeded its page-size safety limit.");
    }

    for (const item of parsed.data.items) {
      const raw = item as unknown;
      if (!isRecord(raw) || unsignedBigInt(raw.scheduleBlock) === undefined) {
        throw new Error("The governance index returned an invalid schedule block.");
      }
      if (raw.status !== "scheduled") {
        throw new Error("The governance index returned a non-scheduled operation for a scheduled-only request.");
      }
      const candidate = sentinelOperationCandidate(raw, chainId, boardroom);
      if (!candidate) {
        invalidCount += 1;
        continue;
      }
      candidates.push(candidate);
    }

    const nextCursor = parsed.data.page.nextCursor ?? undefined;
    if (!nextCursor) {
      cursor = undefined;
      break;
    }
    if (seenCursors.has(nextCursor)) throw new Error("The governance index returned a repeated cursor.");
    seenCursors.add(nextCursor);
    cursor = nextCursor;
    if (pageIndex === SENTINEL_GOVERNANCE_MAX_PAGES - 1) truncated = true;
  }

  return {
    candidates: candidates.slice(0, SENTINEL_GOVERNANCE_MAX_CANDIDATES),
    invalidCount,
    truncated: truncated || candidates.length > SENTINEL_GOVERNANCE_MAX_CANDIDATES || cursor !== undefined,
  };
}

function sentinelOperationCandidate(
  value: Record<string, unknown>,
  expectedChainId: number,
  expectedBoardroom: Address,
): ScheduledBoardroomOperationCandidate | undefined {
  if (value.chainId !== expectedChainId) return undefined;
  const boardroom = nestedAddress(value.boardroom);
  if (!boardroom || boardroom.toLowerCase() !== expectedBoardroom.toLowerCase()) return undefined;
  const controller = addressField(value.controller);
  if (!controller || !isHash(value.operationId) || !isHash(value.scheduleTxHash)) return undefined;
  const scheduleBlockNumber = unsignedBigInt(value.scheduleBlock);
  if (scheduleBlockNumber === undefined) return undefined;
  return {
    boardroom: expectedBoardroom,
    controller,
    operationId: value.operationId,
    scheduleTransactionHash: value.scheduleTxHash,
    scheduleBlockNumber,
  };
}

function governanceCandidateWarning(invalidCount: number, truncated: boolean, complete: boolean): string | undefined {
  const parts: string[] = [];
  if (invalidCount > 0) {
    parts.push(`${invalidCount.toLocaleString()} indexed ${invalidCount === 1 ? "operation could" : "operations could"} not be verified and ${invalidCount === 1 ? "was" : "were"} ignored.`);
  }
  if (truncated) {
    parts.push(`Only the newest ${SENTINEL_GOVERNANCE_MAX_CANDIDATES.toLocaleString()} scheduled operations were checked.`);
  }
  if (!complete) {
    parts.push("Operation coverage could not be confirmed. Displayed operations are verified onchain, but additional operations may be missing.");
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function mergeVerifiedGovernanceOperations(
  indexed: readonly ScheduledBoardroomOperation[],
  tail: readonly ScheduledBoardroomOperation[],
): ScheduledBoardroomOperation[] {
  const operations = new Map<string, ScheduledBoardroomOperation>();
  for (const operation of [...indexed, ...tail]) {
    const key = `${operation.controller.toLowerCase()}:${operation.operationId.toLowerCase()}`;
    const existing = operations.get(key);
    if (!existing) {
      operations.set(key, operation);
      continue;
    }
    if (verifiedGovernanceOperationFingerprint(existing) !== verifiedGovernanceOperationFingerprint(operation)) {
      throw new Error("Conflicting verified governance operations were returned for the same operation ID.");
    }
  }
  return [...operations.values()].sort((left, right) =>
    left.scheduleBlockNumber === right.scheduleBlockNumber
      ? 0
      : left.scheduleBlockNumber > right.scheduleBlockNumber ? -1 : 1);
}

function verifiedGovernanceOperationFingerprint(operation: ScheduledBoardroomOperation): string {
  return JSON.stringify({
    boardroom: operation.boardroom.toLowerCase(),
    boardroomEpoch: operation.boardroomEpoch.toString(),
    calls: operation.calls?.map((call) => ({
      data: call.data.toLowerCase(),
      policy: call.policy.toLowerCase(),
      target: call.target.toLowerCase(),
      value: call.value.toString(),
    })),
    configurationEpoch: operation.configurationEpoch.toString(),
    controller: operation.controller.toLowerCase(),
    controllerData: operation.controllerData?.toLowerCase(),
    controllerGeneration: operation.controllerGeneration.toString(),
    currentBoardroomEpoch: operation.currentBoardroomEpoch.toString(),
    currentConfigurationEpoch: operation.currentConfigurationEpoch.toString(),
    eta: operation.eta.toString(),
    expiresAt: operation.expiresAt.toString(),
    kind: operation.kind,
    operationId: operation.operationId.toLowerCase(),
    operationStatus: operation.operationStatus,
    payloadError: operation.payloadError,
    proposer: operation.proposer.toLowerCase(),
    salt: operation.salt.toLowerCase(),
    scheduleBlockNumber: operation.scheduleBlockNumber.toString(),
    scheduleTransactionHash: operation.scheduleTransactionHash.toLowerCase(),
    status: operation.status,
  });
}

function linkedGovernanceLoadSignal(
  parent: AbortSignal | undefined,
  deadlineMs: number | undefined,
): { signal: AbortSignal; cleanup: () => void } {
  if (deadlineMs !== undefined && (!Number.isFinite(deadlineMs) || deadlineMs <= 0)) {
    throw new Error("Governance load deadline must be positive.");
  }
  const controller = new AbortController();
  const forwardAbort = (): void => controller.abort(parent?.reason);
  if (parent?.aborted) forwardAbort();
  else parent?.addEventListener("abort", forwardAbort, { once: true });

  let deadline: ReturnType<typeof setTimeout> | undefined;
  if (deadlineMs !== undefined) {
    deadline = setTimeout(() => {
      const error = new Error("Governance loading timed out. Try again.");
      error.name = "TimeoutError";
      controller.abort(error);
    }, deadlineMs);
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      if (deadline !== undefined) clearTimeout(deadline);
      parent?.removeEventListener("abort", forwardAbort);
    },
  };
}

function raceWithAbortSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(governanceAbortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener("abort", onAbort);
      reject(governanceAbortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function throwIfGovernanceLoadAborted(signal: AbortSignal): void {
  if (signal.aborted) throw governanceAbortReason(signal);
}

function governanceAbortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Governance loading was cancelled.", "AbortError");
}

function unsignedBigInt(value: unknown): bigint | undefined {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

function addressField(value: unknown): Address | undefined {
  return typeof value === "string" && /^0x[\da-fA-F]{40}$/.test(value) ? value as Address : undefined;
}

function nestedAddress(value: unknown): Address | undefined {
  if (typeof value === "string") return addressField(value);
  return isRecord(value) ? addressField(value.address) : undefined;
}

function isHash(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[\da-fA-F]{64}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export type { GovernanceOperationLoaderDependencies, HydratedScheduledBoardroomOperations };
