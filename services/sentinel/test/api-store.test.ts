import { describe, expect, test } from "bun:test";

import type { SentinelDb } from "../src/db/client";
import {
  decodePublicActionsCursor,
  encodePublicActionsCursor,
  getPublicActions,
  isPublicActionsCursor
} from "../src/api/store";

describe("public action keyset pagination", () => {
  test("round-trips an opaque queue-block/id cursor", () => {
    const cursor = encodePublicActionsCursor({
      id: "00000000-0000-4000-8000-000000000001",
      queueBlock: 123n
    });

    expect(cursor).not.toBe("123");
    expect(isPublicActionsCursor(cursor)).toBe(true);
    expect(decodePublicActionsCursor(cursor)).toEqual({
      id: "00000000-0000-4000-8000-000000000001",
      queueBlock: 123n
    });
    expect(isPublicActionsCursor("25")).toBe(false);
  });

  test("uses an indexed keyset predicate instead of OFFSET", async () => {
    const db = new QueryCaptureDb();
    const cursor = encodePublicActionsCursor({
      id: "00000000-0000-4000-8000-000000000001",
      queueBlock: 123n
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
    expect(expiredQuery).toContain("qa.status = 'queued' AND qa.expires_at IS NOT NULL");
    expect(expiredQuery).not.toContain("'expired'::sentinel_queued_action_status");

    const queuedDb = new QueryCaptureDb();
    await getPublicActions(queuedDb as unknown as SentinelDb, { limit: 25, status: "queued" });
    expect(sqlText(queuedDb.queries[0])).toContain("qa.expires_at IS NULL OR qa.expires_at > NOW()");
  });
});

class QueryCaptureDb {
  readonly queries: unknown[] = [];

  async execute<T>(query: unknown): Promise<readonly T[]> {
    this.queries.push(query);
    return [];
  }
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
