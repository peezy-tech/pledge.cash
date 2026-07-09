import { describe, expect, test } from "bun:test";

import { computeBackoffMs, dispatchOnce, type DispatcherDb } from "../src/notify/dispatcher";
import type { NotificationChannel, NotificationSendResult } from "../src/notify/types";
import type { OutboxRow, RenderedMessage } from "../src/types";

type QueryResult<T> = readonly T[] | { readonly rows: readonly T[] };

class FakeDb implements DispatcherDb {
  readonly queries: unknown[] = [];
  transactionCount = 0;
  readonly #results: QueryResult<unknown>[];

  constructor(results: QueryResult<unknown>[]) {
    this.#results = [...results];
  }

  async execute<T>(query: unknown): Promise<QueryResult<T>> {
    this.queries.push(query);
    return (this.#results.shift() ?? []) as QueryResult<T>;
  }

  async transaction<T>(callback: (tx: FakeDb) => Promise<T>): Promise<T> {
    this.transactionCount += 1;
    return callback(this);
  }
}

describe("notification dispatcher", () => {
  test("locks pending rows with SKIP LOCKED and marks successful sends", async () => {
    const row = makeOutboxRow();
    const db = new FakeDb([[row], []]);
    const sent: RenderedMessage[] = [];
    const channel = makeChannel("telegram", async (_row, rendered) => {
      sent.push(rendered);
      return { externalId: "telegram-42", ok: true } as NotificationSendResult & {
        readonly externalId: string;
      };
    });

    const result = await dispatchOnce({
      channels: [channel],
      db,
      now: () => new Date("2026-07-09T12:00:00.000Z"),
      rateLimiter: { wait: async () => undefined },
      render: () => ({ text: "rendered alert" })
    });

    expect(result).toEqual({ dead: 0, failed: 0, selected: 1, sent: 1 });
    expect(db.transactionCount).toBe(1);
    expect(sent).toEqual([{ text: "rendered alert" }]);
    expect(sqlText(db.queries[0])).toContain("FOR UPDATE SKIP LOCKED");
    expect(sqlText(db.queries[0])).toContain("ORDER BY created_at ASC, id ASC");
    expect(sqlText(db.queries[1])).toContain("status = 'sent'");
  });

  test("backs off retryable failures", async () => {
    const row = makeOutboxRow();
    const db = new FakeDb([[row], []]);
    const channel = makeChannel("telegram", async () => ({
      error: "temporary",
      ok: false,
      retryable: true
    }));

    const result = await dispatchOnce({
      channels: [channel],
      db,
      now: () => new Date("2026-07-09T12:00:00.000Z"),
      rateLimiter: { wait: async () => undefined },
      render: () => ({ text: "rendered alert" })
    });

    expect(result).toEqual({ dead: 0, failed: 1, selected: 1, sent: 0 });
    expect(computeBackoffMs(0)).toBe(30_000);
    expect(computeBackoffMs(7)).toBe(3_600_000);
    expect(sqlText(db.queries[1])).toContain("next_attempt_at");
  });

  test("dead-letters after the eighth attempt", async () => {
    const row = makeOutboxRow({ attempts: 7 });
    const db = new FakeDb([[row], []]);
    const channel = makeChannel("telegram", async () => ({
      error: "still failing",
      ok: false,
      retryable: true
    }));

    const result = await dispatchOnce({
      channels: [channel],
      db,
      now: () => new Date("2026-07-09T12:00:00.000Z"),
      rateLimiter: { wait: async () => undefined },
      render: () => ({ text: "rendered alert" })
    });

    expect(result).toEqual({ dead: 1, failed: 0, selected: 1, sent: 0 });
  });
});

function makeChannel(
  type: NotificationChannel["type"],
  send: NotificationChannel["send"]
): NotificationChannel {
  return { send, type };
}

function makeOutboxRow(input: Partial<OutboxRow> = {}): OutboxRow {
  const now = new Date("2026-07-09T00:00:00.000Z");
  return {
    actionId: "00000000-0000-4000-8000-000000000001",
    attempts: 0,
    channelId: "00000000-0000-4000-8000-000000000002",
    channelType: "telegram",
    createdAt: now,
    dedupeKey: "998:0xabc:queued:telegram:00000000-0000-4000-8000-000000000002",
    event: "queued",
    externalId: null,
    id: "00000000-0000-4000-8000-000000000003",
    lastError: null,
    nextAttemptAt: now,
    payload: {
      action: {
        actionHash: "0x0000000000000000000000000000000000000000000000000000000000000abc",
        boardroom: "0x0000000000000000000000000000000000000b0a",
        chainId: 998,
        eta: "2026-07-10T00:00:00.000Z",
        id: "00000000-0000-4000-8000-000000000001",
        status: "queued"
      }
    },
    sentAt: null,
    status: "pending",
    updatedAt: now,
    userId: "00000000-0000-4000-8000-000000000004",
    ...input
  };
}

function sqlText(query: unknown): string {
  if (query === undefined || query === null) {
    return "";
  }

  if (typeof query === "string") {
    return query;
  }

  if (typeof query !== "object") {
    return "?";
  }

  const record = query as Readonly<Record<string, unknown>>;
  const value = record.value;
  if (Array.isArray(value)) {
    return value.join("");
  }

  const chunks = record.queryChunks;
  if (Array.isArray(chunks)) {
    return chunks.map(sqlText).join("");
  }

  return "";
}
