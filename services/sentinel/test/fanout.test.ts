import { describe, expect, test } from "bun:test";

import {
  buildNotificationDedupeKey,
  fanout,
  shouldNotifySeverity,
  type FanoutDb,
  type NotificationPipelineEvent
} from "../src/notify/fanout";
import type { QueuedActionRow } from "../src/types";

type QueryResult<T> = readonly T[] | { readonly rows: readonly T[] };

class FakeDb implements FanoutDb {
  readonly queries: unknown[] = [];
  readonly #results: QueryResult<unknown>[];

  constructor(results: QueryResult<unknown>[]) {
    this.#results = [...results];
  }

  async execute<T>(query: unknown): Promise<QueryResult<T>> {
    this.queries.push(query);
    return (this.#results.shift() ?? []) as QueryResult<T>;
  }
}

describe("notification fanout", () => {
  test("builds deterministic dedupe keys and severity thresholds", () => {
    expect(
      buildNotificationDedupeKey({
        actionId: "00000000-0000-4000-8000-000000000001",
        actionHash: "0xABCDEF",
        chainId: 998,
        channelId: "channel-1",
        channelType: "telegram",
        event: "queued"
      })
    ).toBe("998:00000000-0000-4000-8000-000000000001:0xabcdef:queued:telegram:channel-1");
    expect(
      buildNotificationDedupeKey({
        actionHash: "0xABCDEF",
        chainId: 998,
        channelType: "twitter",
        event: "queued"
      })
    ).toBe("998:0xabcdef:queued:twitter:public");
    expect(shouldNotifySeverity("medium", "high")).toBe(true);
    expect(shouldNotifySeverity("high", "medium")).toBe(false);
  });

  test("inserts subscriber rows and high-severity public Twitter rows idempotently", async () => {
    const db = new FakeDb([
      [{ id: "telegram-row", channelType: "telegram" }],
      [{ id: "twitter-row", channelType: "twitter" }]
    ]);

    const result = await fanout(makeEvent("queued"), db, { twitterEnabled: true });

    expect(result).toEqual({ telegram: 1, total: 2, twitter: 1 });
    expect(db.queries).toHaveLength(2);

    const subscriberSql = sqlText(db.queries[0]);
    expect(subscriberSql).toContain("JOIN share_balances");
    expect(subscriberSql).toContain("LEFT JOIN subscriptions s");
    expect(subscriberSql).toContain("ctx.action_id::text");
    expect(subscriberSql).toContain("COALESCE(s.min_severity, 'medium'::sentinel_severity)");
    expect(subscriberSql).toContain("COALESCE(s.mode, 'holdings'::sentinel_subscription_mode)");
    expect(subscriberSql).toContain("WHERE w.user_id = c.user_id");
    expect(subscriberSql).toContain("ON CONFLICT (dedupe_key) DO NOTHING");
    expect(subscriberSql).toContain("c.type = 'telegram'");

    const twitterSql = sqlText(db.queries[1]);
    expect(twitterSql).toContain("ctx.action_id::text");
    expect(twitterSql).toContain("twitter:public");
    expect(twitterSql).toContain("ctx.severity = 'high'");
    expect(twitterSql).toContain("ON CONFLICT (dedupe_key) DO NOTHING");
  });

  test.each(["cancelled", "executed", "policy-admin"] as const)(
    "threads Twitter %s follow-ups from the original sent queued tweet",
    async (event) => {
      const db = new FakeDb([[], [{ id: `twitter-${event}`, channelType: "twitter" }]]);

      const result = await fanout(makeEvent(event), db, { twitterEnabled: true });

      expect(result).toEqual({ telegram: 0, total: 1, twitter: 1 });
      const followUpSql = sqlText(db.queries[1]);
      expect(followUpSql).toContain("original_tweet");
      expect(followUpSql).toContain("external_id IS NOT NULL");
      expect(followUpSql).toContain("replyToExternalId");
    }
  );
});

function makeEvent(event: NotificationPipelineEvent["event"]): NotificationPipelineEvent {
  return {
    action: makeAction(),
    calls: [],
    event
  };
}

function makeAction(): QueuedActionRow {
  return {
    actionHash: "0x0000000000000000000000000000000000000000000000000000000000000abc",
    boardroom: "0x0000000000000000000000000000000000000b0a",
    cancelledBy: null,
    chainId: 998,
    createdAt: new Date("2026-07-09T00:00:00.000Z"),
    decodeStatus: "decoded",
    eta: new Date("2026-07-10T00:00:00.000Z"),
    executedBy: null,
    executor: "0x0000000000000000000000000000000000000e0e",
    id: "00000000-0000-4000-8000-000000000001",
    queueBlock: 123n,
    queueTxHash: "0x0000000000000000000000000000000000000000000000000000000000000def",
    rawCalldata: "0x",
    resolvedTxHash: null,
    salt: "0x00",
    status: "queued",
    updatedAt: new Date("2026-07-09T00:00:00.000Z")
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
