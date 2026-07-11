import { describe, expect, test } from "bun:test";
import type {
  Address,
  PledgeCashGovernanceClient,
  QueuedBoardroomAction,
  QueuedBoardroomActionCandidate,
} from "@pledge.cash/sdk";
import type { Hex } from "viem";
import {
  SENTINEL_GOVERNANCE_MAX_CANDIDATES,
  SENTINEL_GOVERNANCE_MAX_PAGES,
  SENTINEL_GOVERNANCE_PAGE_LIMIT,
  loadQueuedGovernanceActions,
} from "../src/lib/governance-actions";

const boardroom = "0x1000000000000000000000000000000000000000" as Address;
const otherBoardroom = "0x2000000000000000000000000000000000000000" as Address;
const executor = "0x3000000000000000000000000000000000000000" as Address;
const shareToken = "0x4000000000000000000000000000000000000000" as Address;

const readyAction = actionFor(1, 101n);

describe("queued governance action loading", () => {
  test("pages the Sentinel index and sends only candidate identity to onchain hydration", async () => {
    const requests: Array<Record<string, unknown>> = [];
    let candidates: readonly QueuedBoardroomActionCandidate[] = [];
    let chainQueries = 0;
    const sentinelClient = indexedSentinel(async (request) => {
      requests.push(request as unknown as Record<string, unknown>);
      const page = requests.length;
      return {
        items: [indexedAction(page)],
        page: { limit: 100, nextCursor: page === 1 ? "next-page" : null },
      };
    });

    const result = await loadQueuedGovernanceActions(governanceClient(200n), {
      boardroom,
      chainId: 998,
      sentinelClient: sentinelClient as never,
    }, {
      async hydrateCandidates(_client, input) {
        candidates = input.candidates;
        return { actions: [readyAction], errors: [] };
      },
      async queryChain() {
        chainQueries += 1;
        return [];
      },
    });

    expect(requests.map(withoutSignal)).toEqual([
      { address: boardroom, chainId: 998, query: { limit: 100, status: "queued" } },
      { address: boardroom, chainId: 998, query: { cursor: "next-page", limit: 100, status: "queued" } },
    ]);
    expect(requests.every((request) => request.signal instanceof AbortSignal)).toBe(true);
    expect(candidates).toHaveLength(2);
    expect(Object.keys(candidates[0] ?? {}).sort()).toEqual([
      "actionHash",
      "boardroom",
      "queueBlockNumber",
      "queueTransactionHash",
    ]);
    expect(candidates[0]).toEqual({
      actionHash: hashFor(1),
      boardroom,
      queueBlockNumber: 101n,
      queueTransactionHash: hashFor(10_001),
    });
    expect(chainQueries).toBe(0);
    expect(result).toEqual({ actions: [readyAction], complete: true, source: "sentinel" });
  });

  test("stops after five 100-item pages and marks the bounded view incomplete", async () => {
    let calls = 0;
    let hydratedCount = 0;
    const sentinelClient = indexedSentinel(async () => {
      const page = calls;
      calls += 1;
      return {
        items: Array.from({ length: SENTINEL_GOVERNANCE_PAGE_LIMIT }, (_, index) =>
          indexedAction(page * SENTINEL_GOVERNANCE_PAGE_LIMIT + index + 1)),
        page: { limit: 100, nextCursor: `cursor-${calls.toString()}` },
      };
    });

    const result = await loadQueuedGovernanceActions(governanceClient(200n), {
      boardroom,
      chainId: 998,
      sentinelClient: sentinelClient as never,
    }, {
      async hydrateCandidates(_client, input) {
        hydratedCount = input.candidates.length;
        return { actions: [], errors: [] };
      },
      async queryChain() {
        throw new Error("A current high-water must not scan chain history.");
      },
    });

    expect(calls).toBe(SENTINEL_GOVERNANCE_MAX_PAGES);
    expect(hydratedCount).toBe(SENTINEL_GOVERNANCE_MAX_CANDIDATES);
    expect(result.complete).toBe(false);
    expect(result.warning).toContain("Only the newest 500 queued decisions were checked.");
    expect(result.warning).toContain("Queue coverage could not be confirmed.");
  });

  test("passes conflicting identities to the SDK and preserves other verified actions", async () => {
    let candidates: readonly QueuedBoardroomActionCandidate[] = [];
    const verifiedAction = actionFor(4, 104n);
    const sentinelClient = indexedSentinel(async () => ({
      items: [
        indexedAction(1),
        indexedAction(4),
        indexedAction(2, { chainId: 10143 }),
        indexedAction(3, { boardroom: { address: otherBoardroom } }),
        indexedAction(5, { actionHash: "0x1234" }),
        indexedAction(1, { queueTxHash: hashFor(99_999) }),
      ],
      page: { limit: 100, nextCursor: null },
    }));

    const result = await loadQueuedGovernanceActions(governanceClient(200n), {
      boardroom,
      chainId: 998,
      sentinelClient: sentinelClient as never,
    }, {
      async hydrateCandidates(_client, input) {
        candidates = input.candidates;
        return {
          actions: [verifiedAction],
          errors: [{ boardroom, actionHash: hashFor(1), message: "Conflicting queue candidates were returned." }],
        };
      },
      async queryChain() {
        throw new Error("A current high-water must not scan chain history.");
      },
    });

    expect(candidates.map((candidate) => candidate.actionHash)).toEqual([hashFor(1), hashFor(4), hashFor(1)]);
    expect(result.actions).toEqual([verifiedAction]);
    expect(result.complete).toBe(false);
    expect(result.warning).toContain("4 indexed decisions could not be verified and were ignored.");
  });

  test("hard-fails a candidate page with a malformed queue block", async () => {
    const sentinelClient = indexedSentinel(async () => ({
      items: [indexedAction(1, { queueBlock: "-1" })],
      page: { limit: 100, nextCursor: null },
    }));

    await expect(loadQueuedGovernanceActions(governanceClient(200n), {
      boardroom,
      chainId: 998,
      sentinelClient: sentinelClient as never,
    }, {
      async hydrateCandidates() {
        throw new Error("Malformed candidates must not reach hydration.");
      },
      async queryChain() {
        throw new Error("Malformed index data must not fall back to history.");
      },
    })).rejects.toThrow("invalid queue block");
  });

  test("hard-fails a non-queued item returned by the queued-only endpoint", async () => {
    const sentinelClient = indexedSentinel(async () => ({
      items: [indexedAction(1, { status: "executed" })],
      page: { limit: 100, nextCursor: null },
    }));

    await expect(loadQueuedGovernanceActions(governanceClient(200n), {
      boardroom,
      chainId: 998,
      sentinelClient: sentinelClient as never,
    }, {
      async hydrateCandidates() {
        throw new Error("Terminal index rows must not reach hydration.");
      },
      async queryChain() {
        throw new Error("Invalid index data must not fall back to history.");
      },
    })).rejects.toThrow("non-queued decision");
  });

  test("merges only the uncovered high-water tail and exact-deduplicates verified actions", async () => {
    const tailAction = actionFor(2, 205n);
    let tailQuery: Record<string, unknown> | undefined;
    const sentinelClient = indexedSentinel(async () => ({
      items: [indexedAction(1)],
      page: { limit: 100, nextCursor: null },
    }), "200");

    const result = await loadQueuedGovernanceActions(governanceClient(205n), {
      boardroom,
      chainId: 998,
      currentTime: 150n,
      sentinelClient: sentinelClient as never,
    }, {
      async hydrateCandidates(_client, input) {
        expect(input.currentTime).toBe(150n);
        return { actions: [readyAction], errors: [] };
      },
      async queryChain(_client, input) {
        tailQuery = input as unknown as Record<string, unknown>;
        return [readyAction, tailAction];
      },
    });

    expect(tailQuery).toMatchObject({
      boardrooms: [boardroom],
      currentTime: 150n,
      fromBlock: 201n,
      toBlock: 205n,
    });
    expect(tailQuery?.signal).toBeInstanceOf(AbortSignal);
    expect(result).toEqual({ actions: [tailAction, readyAction], complete: true, source: "sentinel" });
  });

  test("fails closed when independently verified index and tail rows conflict", async () => {
    const conflicting = { ...readyAction, queueTransactionHash: hashFor(99_999) };
    const sentinelClient = indexedSentinel(async () => ({
      items: [indexedAction(1)],
      page: { limit: 100, nextCursor: null },
    }), "200");

    await expect(loadQueuedGovernanceActions(governanceClient(205n), {
      boardroom,
      chainId: 998,
      sentinelClient: sentinelClient as never,
    }, {
      async hydrateCandidates() {
        return { actions: [readyAction], errors: [] };
      },
      async queryChain() {
        return [conflicting];
      },
    })).rejects.toThrow("Conflicting verified governance actions");
  });

  test("marks a current empty index complete without scanning old history", async () => {
    let chainQueries = 0;
    const sentinelClient = indexedSentinel(async () => ({ items: [], page: { limit: 100, nextCursor: null } }));

    const result = await loadQueuedGovernanceActions(governanceClient(200n), {
      boardroom,
      chainId: 998,
      sentinelClient: sentinelClient as never,
    }, {
      async hydrateCandidates() {
        return { actions: [], errors: [] };
      },
      async queryChain() {
        chainQueries += 1;
        return [];
      },
    });

    expect(result).toEqual({ actions: [], complete: true, source: "sentinel" });
    expect(chainQueries).toBe(0);
  });

  test("does not claim completeness when health has no governance high-water", async () => {
    let headReads = 0;
    const sentinelClient = indexedSentinel(
      async () => ({ items: [], page: { limit: 100, nextCursor: null } }),
      null,
    );
    const noHeadClient = {
      async getBlockNumber() {
        headReads += 1;
        return 200n;
      },
    } as unknown as PledgeCashGovernanceClient;

    const result = await loadQueuedGovernanceActions(noHeadClient, {
      boardroom,
      chainId: 998,
      sentinelClient: sentinelClient as never,
    }, {
      async hydrateCandidates() {
        return { actions: [], errors: [] };
      },
      async queryChain() {
        throw new Error("Missing high-water must not trigger a full scan.");
      },
    });

    expect(headReads).toBe(0);
    expect(result.actions).toEqual([]);
    expect(result.complete).toBe(false);
    expect(result.warning).toContain("Queue coverage could not be confirmed");
  });

  test("preserves verified indexed actions when health is malformed or the tail scan fails", async () => {
    const malformedHealth = {
      async health() { return { ok: true, chains: "invalid" }; },
      async listBoardroomActions() {
        return { items: [indexedAction(1)], page: { limit: 100, nextCursor: null } };
      },
    };
    const missingCursor = await loadQueuedGovernanceActions(governanceClient(205n), {
      boardroom,
      chainId: 998,
      sentinelClient: malformedHealth as never,
    }, {
      async hydrateCandidates() { return { actions: [readyAction], errors: [] }; },
      async queryChain() { throw new Error("Must not scan without high-water."); },
    });

    const staleSentinel = indexedSentinel(
      async () => ({ items: [indexedAction(1)], page: { limit: 100, nextCursor: null } }),
      "200",
    );
    const failedTail = await loadQueuedGovernanceActions(governanceClient(205n), {
      boardroom,
      chainId: 998,
      sentinelClient: staleSentinel as never,
    }, {
      async hydrateCandidates() { return { actions: [readyAction], errors: [] }; },
      async queryChain() { throw new Error("RPC tail unavailable"); },
    });

    for (const result of [missingCursor, failedTail]) {
      expect(result.actions).toEqual([readyAction]);
      expect(result.complete).toBe(false);
      expect(result.warning).toContain("Displayed decisions are verified onchain");
    }
  });

  test("does not fall back to a full-chain scan when the configured index fails", async () => {
    let chainQueries = 0;
    const sentinelClient = indexedSentinel(async () => {
      throw new Error("Sentinel unavailable");
    });

    await expect(loadQueuedGovernanceActions(governanceClient(200n), {
      boardroom,
      chainId: 998,
      sentinelClient: sentinelClient as never,
    }, {
      async hydrateCandidates() { return { actions: [], errors: [] }; },
      async queryChain() {
        chainQueries += 1;
        return [];
      },
    })).rejects.toThrow("Sentinel unavailable");
    expect(chainQueries).toBe(0);
  });

  test("uses the bounded SDK scanner only when no Sentinel index is configured", async () => {
    let hydrateCalls = 0;
    let chainQueries = 0;

    const result = await loadQueuedGovernanceActions(governanceClient(200n), {
      boardroom,
      chainId: 31337,
      currentTime: 150n,
    }, {
      async hydrateCandidates() {
        hydrateCalls += 1;
        return { actions: [], errors: [] };
      },
      async queryChain(_client, input) {
        chainQueries += 1;
        expect(input).toMatchObject({ boardrooms: [boardroom], currentTime: 150n });
        expect(input.signal).toBeInstanceOf(AbortSignal);
        return [readyAction];
      },
    });

    expect(result).toEqual({ actions: [readyAction], complete: true, source: "chain" });
    expect(chainQueries).toBe(1);
    expect(hydrateCalls).toBe(0);
  });

  test("propagates superseding aborts into Sentinel paging", async () => {
    const controller = new AbortController();
    let pageSignal: AbortSignal | undefined;
    const sentinelClient = indexedSentinel(async (request) => {
      pageSignal = request.signal;
      return await new Promise<never>(() => undefined);
    });
    const pending = loadQueuedGovernanceActions(governanceClient(200n), {
      boardroom,
      chainId: 998,
      signal: controller.signal,
      sentinelClient: sentinelClient as never,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort(new DOMException("Superseded", "AbortError"));

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(pageSignal?.aborted).toBe(true);
  });

  test("enforces a deadline even when a transport ignores cancellation", async () => {
    let healthSignal: AbortSignal | undefined;
    const sentinelClient = {
      async health(signal?: AbortSignal) {
        healthSignal = signal;
        return await new Promise<never>(() => undefined);
      },
      async listBoardroomActions() {
        throw new Error("Paging must not start after the deadline.");
      },
    };

    await expect(loadQueuedGovernanceActions(governanceClient(200n), {
      boardroom,
      chainId: 998,
      deadlineMs: 5,
      sentinelClient: sentinelClient as never,
    })).rejects.toMatchObject({ name: "TimeoutError" });
    expect(healthSignal?.aborted).toBe(true);
  });
});

function indexedSentinel(
  listBoardroomActions: (request: {
    address: string;
    chainId: number;
    query?: Record<string, unknown> | undefined;
    signal?: AbortSignal | undefined;
  }) => Promise<unknown>,
  governanceBlock: string | null = "200",
): { health: (signal?: AbortSignal) => Promise<unknown>; listBoardroomActions: typeof listBoardroomActions } {
  return {
    async health() {
      return {
        chains: [{ chainId: 998, ...(governanceBlock === null ? {} : { governanceBlock }) }],
        database: "ok",
        ok: true,
      };
    },
    listBoardroomActions,
  };
}

function governanceClient(head: bigint): PledgeCashGovernanceClient {
  return { async getBlockNumber() { return head; } } as unknown as PledgeCashGovernanceClient;
}

function indexedAction(index: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const indexedBoardroom = {
    address: boardroom,
    name: "Test Boardroom",
    shareToken,
    status: "active",
  };
  const base = {
    actionHash: hashFor(index),
    analysis: null,
    boardroom: indexedBoardroom,
    calls: [{
      callIndex: 0,
      data: "0x1234",
      decodedArgs: { amount: "untrusted" },
      decodedFunction: "untrusted(uint256)",
      policy: executor,
      selector: "0x12345678",
      target: boardroom,
      value: "0",
    }],
    chainId: 998,
    decodeStatus: "decoded",
    epoch: "1",
    eta: "2026-07-11T00:00:00.000Z",
    expiresAt: "2026-07-12T00:00:00.000Z",
    id: `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
    invalidatedByEpoch: null,
    queueBlock: (100 + index).toString(),
    queueTxHash: hashFor(10_000 + index),
    risk: null,
    status: "queued",
  };
  return {
    ...base,
    ...overrides,
    ...(isRecord(overrides.boardroom)
      ? { boardroom: { ...indexedBoardroom, ...overrides.boardroom } }
      : {}),
  };
}

function actionFor(index: number, queueBlockNumber: bigint): QueuedBoardroomAction {
  return {
    boardroom,
    actionHash: hashFor(index),
    executor,
    eta: 100n,
    expiresAt: 200n,
    epoch: 1n,
    currentEpoch: 1n,
    actionStatus: 1,
    salt: hashFor(90_000 + index),
    queueBlockNumber,
    queueTransactionHash: hashFor(10_000 + index),
    status: "ready",
  };
}

function hashFor(value: number): Hex {
  return `0x${value.toString(16).padStart(64, "0")}` as Hex;
}

function withoutSignal(value: Record<string, unknown>): Record<string, unknown> {
  const { signal: _signal, ...rest } = value;
  return rest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
