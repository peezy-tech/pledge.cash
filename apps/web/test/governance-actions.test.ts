import { describe, expect, test } from "bun:test";
import type {
  Address,
  PledgeCashGovernanceClient,
  ScheduledBoardroomOperation,
  ScheduledBoardroomOperationCandidate,
} from "@pledge.cash/sdk";
import type { Hex } from "viem";
import {
  SENTINEL_GOVERNANCE_MAX_CANDIDATES,
  SENTINEL_GOVERNANCE_MAX_PAGES,
  SENTINEL_GOVERNANCE_PAGE_LIMIT,
  loadScheduledGovernanceOperations,
} from "../src/lib/governance-actions";

const boardroom = "0x1000000000000000000000000000000000000000" as Address;
const otherBoardroom = "0x2000000000000000000000000000000000000000" as Address;
const controller = "0x3000000000000000000000000000000000000000" as Address;
const proposer = "0x4000000000000000000000000000000000000000" as Address;
const shareToken = "0x5000000000000000000000000000000000000000" as Address;
const readyOperation = operationFor(1, 101n);

describe("scheduled controller operation loading", () => {
  test("pages Sentinel candidates and hydrates only canonical identity", async () => {
    const requests: Array<Record<string, unknown>> = [];
    let candidates: readonly ScheduledBoardroomOperationCandidate[] = [];
    const sentinelClient = indexedSentinel(async (request) => {
      requests.push(request as unknown as Record<string, unknown>);
      const page = requests.length;
      return { items: [indexedOperation(page)], page: { limit: 100, nextCursor: page === 1 ? "next-page" : null } };
    });

    const result = await loadScheduledGovernanceOperations(governanceClient(200n), {
      boardroom,
      chainId: 998,
      sentinelClient: sentinelClient as never,
    }, {
      async hydrateCandidates(_client, input) {
        candidates = input.candidates;
        return { operations: [readyOperation], errors: [] };
      },
      async queryChain() { throw new Error("A current high-water must not scan old history."); },
    });

    expect(requests.map(withoutSignal)).toEqual([
      { address: boardroom, chainId: 998, query: { limit: 100, status: "scheduled" } },
      { address: boardroom, chainId: 998, query: { cursor: "next-page", limit: 100, status: "scheduled" } },
    ]);
    expect(candidates[0]).toEqual({
      boardroom,
      controller,
      operationId: hashFor(1),
      scheduleBlockNumber: 101n,
      scheduleTransactionHash: hashFor(10_001),
    });
    expect(result).toEqual({ operations: [readyOperation], complete: true, source: "sentinel" });
  });

  test("bounds the index to five 100-item pages and marks coverage incomplete", async () => {
    let calls = 0;
    let hydratedCount = 0;
    const sentinelClient = indexedSentinel(async () => {
      const page = calls++;
      return {
        items: Array.from({ length: SENTINEL_GOVERNANCE_PAGE_LIMIT }, (_, index) =>
          indexedOperation(page * SENTINEL_GOVERNANCE_PAGE_LIMIT + index + 1)),
        page: { limit: 100, nextCursor: `cursor-${calls.toString()}` },
      };
    });
    const result = await loadScheduledGovernanceOperations(governanceClient(200n), {
      boardroom,
      chainId: 998,
      sentinelClient: sentinelClient as never,
    }, {
      async hydrateCandidates(_client, input) {
        hydratedCount = input.candidates.length;
        return { operations: [], errors: [] };
      },
      async queryChain() { return []; },
    });
    expect(calls).toBe(SENTINEL_GOVERNANCE_MAX_PAGES);
    expect(hydratedCount).toBe(SENTINEL_GOVERNANCE_MAX_CANDIDATES);
    expect(result.complete).toBe(false);
    expect(result.warning).toContain("newest 500 scheduled operations");
    expect(result.warning).toContain("Operation coverage could not be confirmed");
  });

  test("rejects malformed scheduled-only index rows before hydration", async () => {
    const malformedBlock = indexedSentinel(async () => ({
      items: [indexedOperation(1, { scheduleBlock: "-1" })],
      page: { limit: 100, nextCursor: null },
    }));
    await expect(loadScheduledGovernanceOperations(governanceClient(200n), {
      boardroom,
      chainId: 998,
      sentinelClient: malformedBlock as never,
    })).rejects.toThrow("invalid schedule block");

    const terminal = indexedSentinel(async () => ({
      items: [indexedOperation(1, { status: "executed" })],
      page: { limit: 100, nextCursor: null },
    }));
    await expect(loadScheduledGovernanceOperations(governanceClient(200n), {
      boardroom,
      chainId: 998,
      sentinelClient: terminal as never,
    })).rejects.toThrow("non-scheduled operation");
  });

  test("ignores wrong-chain, wrong-Boardroom, and malformed candidate identities", async () => {
    let candidates: readonly ScheduledBoardroomOperationCandidate[] = [];
    const sentinelClient = indexedSentinel(async () => ({
      items: [
        indexedOperation(1),
        indexedOperation(2, { chainId: 424242 }),
        indexedOperation(3, { boardroom: { address: otherBoardroom } }),
        indexedOperation(4, { operationId: "0x1234" }),
      ],
      page: { limit: 100, nextCursor: null },
    }));
    const result = await loadScheduledGovernanceOperations(governanceClient(200n), {
      boardroom,
      chainId: 998,
      sentinelClient: sentinelClient as never,
    }, {
      async hydrateCandidates(_client, input) {
        candidates = input.candidates;
        return { operations: [readyOperation], errors: [] };
      },
      async queryChain() { return []; },
    });
    expect(candidates.map((candidate) => candidate.operationId)).toEqual([hashFor(1)]);
    expect(result.complete).toBe(false);
    expect(result.warning).toContain("3 indexed operations could not be verified");
  });

  test("merges only the uncovered high-water tail and exact-deduplicates", async () => {
    const tailOperation = operationFor(2, 205n);
    let tailQuery: Record<string, unknown> | undefined;
    const sentinelClient = indexedSentinel(async () => ({
      items: [indexedOperation(1)],
      page: { limit: 100, nextCursor: null },
    }), "200");
    const result = await loadScheduledGovernanceOperations(governanceClient(205n), {
      boardroom,
      chainId: 998,
      currentTime: 150n,
      sentinelClient: sentinelClient as never,
    }, {
      async hydrateCandidates() { return { operations: [readyOperation], errors: [] }; },
      async queryChain(_client, input) {
        tailQuery = input as unknown as Record<string, unknown>;
        return [readyOperation, tailOperation];
      },
    });
    expect(tailQuery).toMatchObject({ boardrooms: [boardroom], currentTime: 150n, fromBlock: 201n, toBlock: 205n });
    expect(result).toEqual({ operations: [tailOperation, readyOperation], complete: true, source: "sentinel" });
  });

  test("fails closed when independently verified rows conflict", async () => {
    const conflicting = { ...readyOperation, scheduleTransactionHash: hashFor(99_999) };
    const sentinelClient = indexedSentinel(async () => ({
      items: [indexedOperation(1)],
      page: { limit: 100, nextCursor: null },
    }), "200");
    await expect(loadScheduledGovernanceOperations(governanceClient(205n), {
      boardroom,
      chainId: 998,
      sentinelClient: sentinelClient as never,
    }, {
      async hydrateCandidates() { return { operations: [readyOperation], errors: [] }; },
      async queryChain() { return [conflicting]; },
    })).rejects.toThrow("Conflicting verified governance operations");
  });

  test("uses the bounded chain scanner only without Sentinel", async () => {
    let queries = 0;
    const result = await loadScheduledGovernanceOperations(governanceClient(200n), {
      boardroom,
      chainId: 31337,
      currentTime: 150n,
    }, {
      async queryChain(_client, input) {
        queries += 1;
        expect(input).toMatchObject({ boardrooms: [boardroom], currentTime: 150n });
        return [readyOperation];
      },
    });
    expect(result).toEqual({ operations: [readyOperation], complete: true, source: "chain" });
    expect(queries).toBe(1);
  });

  test("propagates superseding aborts and enforces ignored-transport deadlines", async () => {
    const controllerSignal = new AbortController();
    let pageSignal: AbortSignal | undefined;
    const sentinelClient = indexedSentinel(async (request) => {
      pageSignal = request.signal;
      return await new Promise<never>(() => undefined);
    });
    const pending = loadScheduledGovernanceOperations(governanceClient(200n), {
      boardroom,
      chainId: 998,
      signal: controllerSignal.signal,
      sentinelClient: sentinelClient as never,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    controllerSignal.abort(new DOMException("Superseded", "AbortError"));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(pageSignal?.aborted).toBe(true);

    const stalled = { async health() { return await new Promise<never>(() => undefined); }, async listBoardroomActions() { return {}; } };
    await expect(loadScheduledGovernanceOperations(governanceClient(200n), {
      boardroom,
      chainId: 998,
      deadlineMs: 5,
      sentinelClient: stalled as never,
    })).rejects.toMatchObject({ name: "TimeoutError" });
  });
});

function indexedSentinel(
  listBoardroomActions: (request: { address: string; chainId: number; query?: Record<string, unknown>; signal?: AbortSignal }) => Promise<unknown>,
  governanceBlock: string | null = "200",
): { health: () => Promise<unknown>; listBoardroomActions: typeof listBoardroomActions } {
  return {
    async health() {
      return { chains: [{ chainId: 998, ...(governanceBlock === null ? {} : { governanceBlock }) }], database: "ok", ok: true };
    },
    listBoardroomActions,
  };
}

function indexedOperation(index: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const indexedBoardroom = { address: boardroom, name: "Test Boardroom", shareToken, status: "active" };
  const base = {
    id: `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
    chainId: 998,
    operationId: hashFor(index),
    operationKind: "boardroom",
    controller,
    proposer,
    controllerGeneration: "1",
    configurationEpoch: "1",
    boardroomEpoch: "1",
    eta: "2026-07-11T00:00:00.000Z",
    expiresAt: "2026-07-12T00:00:00.000Z",
    invalidatedByEpoch: null,
    scheduleBlock: (100 + index).toString(),
    scheduleTxHash: hashFor(10_000 + index),
    decodeStatus: "decoded",
    status: "scheduled",
    boardroom: indexedBoardroom,
    calls: [],
    risk: null,
    analysis: null,
  };
  return { ...base, ...overrides, ...(isRecord(overrides.boardroom) ? { boardroom: { ...indexedBoardroom, ...overrides.boardroom } } : {}) };
}

function operationFor(index: number, scheduleBlockNumber: bigint): ScheduledBoardroomOperation {
  return {
    boardroom,
    controller,
    operationId: hashFor(index),
    proposer,
    eta: 100n,
    expiresAt: 200n,
    boardroomEpoch: 1n,
    controllerGeneration: 1n,
    configurationEpoch: 1n,
    currentBoardroomEpoch: 1n,
    currentConfigurationEpoch: 1n,
    operationStatus: 1,
    salt: hashFor(90_000 + index),
    scheduleBlockNumber,
    scheduleTransactionHash: hashFor(10_000 + index),
    status: "ready",
  };
}

function governanceClient(head: bigint): PledgeCashGovernanceClient {
  return { async getBlockNumber() { return head; } } as unknown as PledgeCashGovernanceClient;
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
