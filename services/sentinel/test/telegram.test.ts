import { describe, expect, test } from "bun:test";
import type { SQL } from "drizzle-orm";

import {
  createTelegramChannel,
  type TelegramBotLike,
  type TelegramDb,
  type TelegramSendOptions
} from "../src/notify/channels/telegram";
import type { OutboxRow } from "../src/types";

type QueryResult<T> = readonly T[] | { readonly rows: readonly T[] };

class FakeTelegramDb implements TelegramDb {
  readonly queries: SQL[] = [];
  readonly #results: QueryResult<unknown>[];

  constructor(results: QueryResult<unknown>[]) {
    this.#results = [...results];
  }

  async execute<T = Record<string, unknown>>(query: SQL): Promise<QueryResult<T>> {
    this.queries.push(query);
    return (this.#results.shift() ?? []) as QueryResult<T>;
  }
}

describe("Telegram notification channel", () => {
  test("sends to the live enabled channel instead of stale payload delivery data", async () => {
    const db = new FakeTelegramDb([[{ telegramChatId: "live-chat" }]]);
    const { bot, messages } = makeBot();
    const channel = createTelegramChannel(bot, db);

    const result = await channel.send(makeOutboxRow({ payload: payloadWithDelivery("stale-chat") }), {
      text: "rendered alert"
    });

    expect(result).toEqual({ externalId: "42", ok: true });
    expect(messages).toEqual([
      { chatId: "live-chat", options: { disable_web_page_preview: false }, text: "rendered alert" }
    ]);
    expect(sqlText(db.queries[0])).toContain("enabled = TRUE");
  });

  test("does not send when the saved Telegram channel is gone", async () => {
    const db = new FakeTelegramDb([[]]);
    const { bot, messages } = makeBot();
    const channel = createTelegramChannel(bot, db);

    const result = await channel.send(makeOutboxRow({ payload: payloadWithDelivery("stale-chat") }), {
      text: "rendered alert"
    });

    expect(result).toEqual({
      error: "No Telegram chat id for notification 00000000-0000-4000-8000-000000000003",
      ok: false,
      retryable: false
    });
    expect(messages).toEqual([]);
    expect(db.queries).toHaveLength(1);
  });
});

function makeBot(): {
  readonly bot: TelegramBotLike;
  readonly messages: Array<{ chatId: string; options?: TelegramSendOptions; text: string }>;
} {
  const messages: Array<{ chatId: string; options?: TelegramSendOptions; text: string }> = [];
  return {
    bot: {
      api: {
        async sendMessage(chatId, text, options) {
          messages.push({ chatId, options, text });
          return { message_id: 42 };
        }
      },
      command: () => undefined
    },
    messages
  };
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
    payload: payloadWithDelivery("payload-chat"),
    sentAt: null,
    status: "pending",
    updatedAt: now,
    userId: "00000000-0000-4000-8000-000000000004",
    ...input
  };
}

function payloadWithDelivery(telegramChatId: string): OutboxRow["payload"] {
  return {
    action: {
      actionHash: "0x0000000000000000000000000000000000000000000000000000000000000abc",
      boardroom: "0x0000000000000000000000000000000000000b0a",
      chainId: 998,
      eta: "2026-07-10T00:00:00.000Z",
      id: "00000000-0000-4000-8000-000000000001",
      status: "queued"
    },
    delivery: { telegramChatId }
  } as unknown as OutboxRow["payload"];
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
