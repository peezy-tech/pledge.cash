import { describe, expect, test } from "bun:test";

import type { SentinelDb } from "../src/db/client";
import { countActionSubscribers } from "../src/pipeline";
import type { WatcherPipelineEvent } from "../src/chain/watcher";

describe("analysis subscriber eligibility", () => {
  test("counts both explicit and current-holder subscriptions for the action boardroom", async () => {
    const db = new SubscriberDb(3);
    const count = await countActionSubscribers(
      db as unknown as Pick<SentinelDb, "execute">,
      {
        action: {
          boardroom: "0x1111111111111111111111111111111111111111",
          chainId: 31337
        }
      } as WatcherPipelineEvent
    );

    expect(count).toBe(3);
    const query = sqlText(db.query);
    expect(query).toContain("FROM users u");
    expect(query).toContain("LEFT JOIN subscriptions s");
    expect(query).toContain("s.mode = 'explicit'");
    expect(query).toContain("subscription_boardrooms");
    expect(query).toContain("COALESCE(s.mode, 'holdings'::sentinel_subscription_mode) = 'holdings'");
    expect(query).toContain("JOIN share_balances");
    expect(query).toContain("sb.balance::numeric > 0");
  });
});

class SubscriberDb {
  query: unknown;

  constructor(private readonly count: number) {}

  async execute(query: unknown): Promise<{ rows: readonly [{ count: number }] }> {
    this.query = query;
    return { rows: [{ count: this.count }] };
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
