import {
  hydrateQueuedBoardroomActionCandidates,
  queryQueuedBoardroomActions,
  type Address,
  type HydratedQueuedBoardroomActions,
  type PledgeCashGovernanceClient,
  type QueuedBoardroomAction,
  type QueuedBoardroomActionCandidate,
} from "@pledge.cash/sdk";
import { HealthResponseSchema, PublicActionsResponseSchema } from "@pledge.cash/sentinel/dto";
import type { Hex } from "viem";
import type { SentinelClient } from "./sentinel";

export const SENTINEL_GOVERNANCE_PAGE_LIMIT = 100;
export const SENTINEL_GOVERNANCE_MAX_PAGES = 5;
export const SENTINEL_GOVERNANCE_MAX_CANDIDATES =
  SENTINEL_GOVERNANCE_PAGE_LIMIT * SENTINEL_GOVERNANCE_MAX_PAGES;

type GovernanceSentinelClient = Pick<SentinelClient, "health" | "listBoardroomActions">;

type GovernanceActionLoaderDependencies = {
  hydrateCandidates?: typeof hydrateQueuedBoardroomActionCandidates;
  queryChain?: typeof queryQueuedBoardroomActions;
};

export type GovernanceActionLoadInput = {
  boardroom: Address;
  chainId: number;
  currentTime?: bigint | undefined;
  deadlineMs?: number | undefined;
  signal?: AbortSignal | undefined;
  sentinelClient?: GovernanceSentinelClient | undefined;
};

export type GovernanceActionLoadResult = {
  actions: QueuedBoardroomAction[];
  complete: boolean;
  source: "chain" | "sentinel";
  warning?: string | undefined;
};

type SentinelCandidates = {
  candidates: QueuedBoardroomActionCandidate[];
  invalidCount: number;
  truncated: boolean;
};

/**
 * Uses Sentinel only as a bounded candidate index. Every indexed candidate is
 * independently reconstructed and checked against current onchain state by the
 * SDK before it reaches the governance controls.
 */
export async function loadQueuedGovernanceActions(
  client: PledgeCashGovernanceClient,
  input: GovernanceActionLoadInput,
  dependencies: GovernanceActionLoaderDependencies = {},
): Promise<GovernanceActionLoadResult> {
  const loadSignal = linkedGovernanceLoadSignal(input.signal, input.deadlineMs);
  try {
    return await raceWithAbortSignal(
      loadQueuedGovernanceActionsWithSignal(client, input, dependencies, loadSignal.signal),
      loadSignal.signal,
    );
  } finally {
    loadSignal.cleanup();
  }
}

async function loadQueuedGovernanceActionsWithSignal(
  client: PledgeCashGovernanceClient,
  input: GovernanceActionLoadInput,
  dependencies: GovernanceActionLoaderDependencies,
  signal: AbortSignal,
): Promise<GovernanceActionLoadResult> {
  const queryChain = dependencies.queryChain ?? queryQueuedBoardroomActions;
  const hydrateCandidates = dependencies.hydrateCandidates ?? hydrateQueuedBoardroomActionCandidates;
  const currentTime = input.currentTime ?? BigInt(Math.floor(Date.now() / 1_000));
  throwIfGovernanceLoadAborted(signal);

  if (!input.sentinelClient) {
    return {
      actions: await queryChain(client, {
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
    actions: mergeVerifiedGovernanceActions(hydrated.actions, tail.actions),
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
  } catch (error) {
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
    queryChain: typeof queryQueuedBoardroomActions;
    signal: AbortSignal;
  },
): Promise<{ actions: QueuedBoardroomAction[]; complete: boolean }> {
  if (input.governanceHighWater === undefined || !client.getBlockNumber) {
    return { actions: [], complete: false };
  }

  try {
    const head = await client.getBlockNumber();
    throwIfGovernanceLoadAborted(input.signal);
    if (head < input.governanceHighWater) return { actions: [], complete: false };
    if (head === input.governanceHighWater) return { actions: [], complete: true };
    const actions = await input.queryChain(client, {
      boardrooms: [input.boardroom],
      currentTime: input.currentTime,
      fromBlock: input.governanceHighWater + 1n,
      signal: input.signal,
      toBlock: head,
    });
    throwIfGovernanceLoadAborted(input.signal);
    return { actions, complete: true };
  } catch (error) {
    if (input.signal.aborted) throw governanceAbortReason(input.signal);
    return { actions: [], complete: false };
  }
}

async function readSentinelGovernanceCandidates(
  client: GovernanceSentinelClient,
  chainId: number,
  boardroom: Address,
  signal: AbortSignal,
): Promise<SentinelCandidates> {
  const candidates: QueuedBoardroomActionCandidate[] = [];
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
        status: "queued",
      },
      signal,
    });
    throwIfGovernanceLoadAborted(signal);
    const parsed = PublicActionsResponseSchema.safeParse(response);
    if (!parsed.success) {
      throw new Error("The governance index returned an invalid response.");
    }

    if (parsed.data.items.length > SENTINEL_GOVERNANCE_PAGE_LIMIT) {
      throw new Error("The governance index exceeded its page-size safety limit.");
    }

    for (const item of parsed.data.items) {
      if (unsignedBigInt(item.queueBlock) === undefined) {
        throw new Error("The governance index returned an invalid queue block.");
      }
      if (item.status !== "queued") {
        throw new Error("The governance index returned a non-queued decision for a queued-only request.");
      }
      const candidate = sentinelActionCandidate(item, chainId, boardroom);
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
    if (seenCursors.has(nextCursor)) {
      throw new Error("The governance index returned a repeated cursor.");
    }

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

function sentinelActionCandidate(
  value: unknown,
  expectedChainId: number,
  expectedBoardroom: Address,
): QueuedBoardroomActionCandidate | undefined {
  if (!isRecord(value) || !isRecord(value.boardroom)) return undefined;
  if (value.chainId !== expectedChainId) return undefined;
  if (typeof value.boardroom.address !== "string"
    || value.boardroom.address.toLowerCase() !== expectedBoardroom.toLowerCase()) return undefined;
  if (!isHash(value.actionHash) || !isHash(value.queueTxHash)) return undefined;

  const queueBlockNumber = unsignedBigInt(value.queueBlock);
  if (queueBlockNumber === undefined) return undefined;
  return {
    boardroom: expectedBoardroom,
    actionHash: value.actionHash,
    queueTransactionHash: value.queueTxHash,
    queueBlockNumber,
  };
}

function governanceCandidateWarning(invalidCount: number, truncated: boolean, complete: boolean): string | undefined {
  const parts: string[] = [];
  if (invalidCount > 0) {
    parts.push(`${invalidCount.toLocaleString()} indexed ${invalidCount === 1 ? "decision could" : "decisions could"} not be verified and ${invalidCount === 1 ? "was" : "were"} ignored.`);
  }
  if (truncated) {
    parts.push(`Only the newest ${SENTINEL_GOVERNANCE_MAX_CANDIDATES.toLocaleString()} queued decisions were checked.`);
  }
  if (!complete) {
    parts.push("Queue coverage could not be confirmed. Displayed decisions are verified onchain, but additional decisions may be missing.");
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function mergeVerifiedGovernanceActions(
  indexed: readonly QueuedBoardroomAction[],
  tail: readonly QueuedBoardroomAction[],
): QueuedBoardroomAction[] {
  const actions = new Map<string, QueuedBoardroomAction>();
  for (const action of [...indexed, ...tail]) {
    const key = `${action.boardroom.toLowerCase()}:${action.actionHash.toLowerCase()}`;
    const existing = actions.get(key);
    if (!existing) {
      actions.set(key, action);
      continue;
    }
    if (verifiedGovernanceActionFingerprint(existing) !== verifiedGovernanceActionFingerprint(action)) {
      throw new Error("Conflicting verified governance actions were returned for the same decision.");
    }
  }
  return [...actions.values()].sort((left, right) =>
    left.queueBlockNumber === right.queueBlockNumber
      ? 0
      : left.queueBlockNumber > right.queueBlockNumber ? -1 : 1);
}

function verifiedGovernanceActionFingerprint(action: QueuedBoardroomAction): string {
  return JSON.stringify({
    actionHash: action.actionHash.toLowerCase(),
    actionStatus: action.actionStatus,
    boardroom: action.boardroom.toLowerCase(),
    calls: action.calls?.map((call) => ({
      data: call.data.toLowerCase(),
      policy: call.policy.toLowerCase(),
      target: call.target.toLowerCase(),
      value: call.value.toString(),
    })),
    currentEpoch: action.currentEpoch.toString(),
    epoch: action.epoch.toString(),
    eta: action.eta.toString(),
    executor: action.executor.toLowerCase(),
    expiresAt: action.expiresAt.toString(),
    kind: action.kind,
    payloadError: action.payloadError,
    queueBlockNumber: action.queueBlockNumber.toString(),
    queueTransactionHash: action.queueTransactionHash.toLowerCase(),
    salt: action.salt.toLowerCase(),
    status: action.status,
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

function isHash(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[\da-fA-F]{64}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export type { GovernanceActionLoaderDependencies, HydratedQueuedBoardroomActions };
