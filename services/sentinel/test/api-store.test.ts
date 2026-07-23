import { describe, expect, test } from "bun:test";

import type { SentinelDb } from "../src/db/client";
import {
  decodeNotificationDeliveriesCursor,
  decodePublicActionsCursor,
  encodeNotificationDeliveriesCursor,
  encodePublicActionsCursor,
  getNotificationDeliveries,
  getPublicActions,
  isNotificationDeliveriesCursor,
  isPublicActionsCursor
} from "../src/api/store";

describe("public action keyset pagination", () => {
  test("round-trips an opaque schedule-block/id cursor", () => {
    const cursor = encodePublicActionsCursor({
      id: "00000000-0000-4000-8000-000000000001",
      scheduleBlock: 123n
    });

    expect(cursor).not.toBe("123");
    expect(isPublicActionsCursor(cursor)).toBe(true);
    expect(decodePublicActionsCursor(cursor)).toEqual({
      id: "00000000-0000-4000-8000-000000000001",
      scheduleBlock: 123n
    });
    expect(isPublicActionsCursor("25")).toBe(false);
  });

  test("uses an indexed keyset predicate instead of OFFSET", async () => {
    const db = new QueryCaptureDb();
    const cursor = encodePublicActionsCursor({
      id: "00000000-0000-4000-8000-000000000001",
      scheduleBlock: 123n
    });

    await getPublicActions(db as unknown as SentinelDb, { cursor, limit: 25 });

    const query = sqlText(db.queries[0]);
    expect(query).toContain("qa.queue_block <");
    expect(query).toContain("qa.id <");
    expect(query).toContain("ORDER BY qa.queue_block DESC, qa.id DESC");
    expect(query).not.toContain("OFFSET");
  });

  test("derives expired read-model status without changing the on-chain event status", async () => {
    const expiredDb = new QueryCaptureDb();
    await getPublicActions(expiredDb as unknown as SentinelDb, { limit: 25, status: "expired" });
    const expiredQuery = sqlText(expiredDb.queries[0]);

    expect(expiredQuery).toContain("THEN 'expired'");
    expect(expiredQuery).toContain("qa.status = 'scheduled' AND qa.expires_at IS NOT NULL");
    expect(expiredQuery).not.toContain("'expired'::sentinel_queued_action_status");

    const scheduledDb = new QueryCaptureDb();
    await getPublicActions(scheduledDb as unknown as SentinelDb, { limit: 25, status: "scheduled" });
    expect(sqlText(scheduledDb.queries[0])).toContain("qa.expires_at IS NULL OR qa.expires_at > NOW()");
  });
});

describe("notification delivery keyset pagination", () => {
  test("round-trips an opaque created-at/id cursor", () => {
    const createdAt = "2026-07-12T12:00:00.000Z";
    const cursor = encodeNotificationDeliveriesCursor({
      createdAt,
      id: "00000000-0000-4000-8000-000000000001"
    });

    expect(cursor).not.toContain(createdAt);
    expect(isNotificationDeliveriesCursor(cursor)).toBe(true);
    expect(decodeNotificationDeliveriesCursor(cursor)).toEqual({
      createdAt,
      id: "00000000-0000-4000-8000-000000000001"
    });
    expect(isNotificationDeliveriesCursor("not-a-cursor")).toBe(false);
    expect(
      isNotificationDeliveriesCursor(
        Buffer.from(
          JSON.stringify({
            createdAt: "0",
            id: "00000000-0000-4000-8000-000000000001"
          }),
          "utf8"
        ).toString("base64url")
      )
    ).toBe(false);
  });

  test("uses a user-scoped keyset query and selects no raw delivery errors", async () => {
    const db = new QueryCaptureDb();
    const cursor = encodeNotificationDeliveriesCursor({
      createdAt: "2026-07-12T12:00:00.000Z",
      id: "00000000-0000-4000-8000-000000000001"
    });

    await getNotificationDeliveries(
      db as unknown as SentinelDb,
      "00000000-0000-4000-8000-000000000009",
      { cursor, limit: 20 }
    );

    const query = sqlText(db.queries[0]);
    expect(query).toContain("WHERE n.user_id =");
    expect(query).toContain("n.created_at <");
    expect(query).toContain("n.id <");
    expect(query).toContain("ORDER BY n.created_at DESC, n.id DESC");
    expect(query).not.toContain("OFFSET");
    expect(query).not.toContain("last_error");
    expect(query).not.toMatch(/SELECT\s+n\.payload(?:\s|,)/);
  });

  test("returns safe receipt fields and emits a cursor only when another row exists", async () => {
    const rows = [
      notificationRow("00000000-0000-4000-8000-000000000003", "2026-07-12T12:03:00.000Z"),
      notificationRow("00000000-0000-4000-8000-000000000002", "2026-07-12T12:02:00.000Z")
    ];
    const db = new QueryCaptureDb(rows);

    const response = await getNotificationDeliveries(
      db as unknown as SentinelDb,
      "00000000-0000-4000-8000-000000000009",
      { limit: 1 }
    );

    expect(response.items).toEqual([
      {
        action: {
          operationId: `0x${"ab".repeat(32)}`,
          boardroom: "0x1111111111111111111111111111111111111111",
          chainId: 31337,
          eta: "2026-07-13T12:00:00.000Z",
          expiresAt: "2026-07-20T12:00:00.000Z",
          id: "00000000-0000-4000-8000-000000000010",
          status: "scheduled"
        },
        attempts: 1,
        channelType: "telegram",
        createdAt: "2026-07-12T12:03:00.000Z",
        event: "scheduled",
        id: "00000000-0000-4000-8000-000000000003",
        nextAttemptAt: "2026-07-12T12:04:00.000Z",
        sentAt: null,
        severity: "high",
        status: "failed",
        summary: "Executor authority changes.",
        updatedAt: "2026-07-12T12:03:30.000Z"
      }
    ]);
    expect(response.page.limit).toBe(1);
    expect(response.page.nextCursor).not.toBeNull();
    expect(decodeNotificationDeliveriesCursor(response.page.nextCursor ?? undefined)).toEqual({
      createdAt: "2026-07-12T12:03:00.000Z",
      id: "00000000-0000-4000-8000-000000000003"
    });
    expect(response.items[0]).not.toHaveProperty("lastError");
  });
});

class QueryCaptureDb {
  readonly queries: unknown[] = [];

  constructor(private readonly rows: readonly unknown[] = []) {}

  async execute<T>(query: unknown): Promise<readonly T[]> {
    this.queries.push(query);
    return this.rows as readonly T[];
  }
}

function notificationRow(id: string, createdAt: string) {
  return {
    operationId: `0x${"ab".repeat(32)}`,
    actionId: "00000000-0000-4000-8000-000000000010",
    actionStatus: "scheduled" as const,
    attempts: 1,
    boardroom: "0x1111111111111111111111111111111111111111",
    chainId: 31337,
    channelType: "telegram" as const,
    createdAt,
    eta: "2026-07-13T12:00:00.000Z",
    event: "scheduled" as const,
    expiresAt: "2026-07-20T12:00:00.000Z",
    id,
    nextAttemptAt: "2026-07-12T12:04:00.000Z",
    sentAt: null,
    severity: "high" as const,
    status: "failed" as const,
    summary: "Executor authority changes.",
    updatedAt: "2026-07-12T12:03:30.000Z"
  };
}

function sqlText(query: unknown): string {
  if (query === undefined || query === null) return "";
  if (typeof query === "string") return query;
  if (typeof query !== "object") return "?";

  const record = query as Readonly<Record<string, unknown>>;
  if (Array.isArray(record.value)) return record.value.join("");
  if (Array.isArray(record.queryChunks)) return record.queryChunks.map(sqlText).join("");
  return "";
}
