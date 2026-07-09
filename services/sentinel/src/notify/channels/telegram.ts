import { sql, type SQL } from "drizzle-orm";
import { Bot } from "grammy";

import type { NotificationChannel, NotificationSendResult } from "../types";
import type { OutboxRow, RenderedMessage } from "../../types";

type QueryResult<T> = readonly T[] | { readonly rows: readonly T[] };

export type TelegramDb = {
  execute<T = Record<string, unknown>>(query: SQL): Promise<QueryResult<T>>;
};

export type TelegramSendOptions = {
  readonly disable_web_page_preview?: boolean;
  readonly parse_mode?: "HTML";
};

export type TelegramBotLike = {
  readonly api: {
    sendMessage(
      chatId: string,
      text: string,
      options?: TelegramSendOptions
    ): Promise<{ readonly message_id?: number | string }>;
  };
  command(command: string, handler: (ctx: TelegramStartContext) => Promise<void>): unknown;
  start?(): Promise<void> | void;
  stop?(): Promise<void> | void;
};

export type TelegramStartContext = {
  readonly chat?: {
    readonly id: number | string;
  };
  readonly match?: string | { toString(): string };
  reply(text: string): Promise<unknown>;
};

export type TelegramBotConfig = {
  readonly botFactory?: (token: string) => TelegramBotLike;
  readonly botToken?: string;
  readonly token?: string;
};

export type TelegramBotBundle = {
  readonly bot: TelegramBotLike;
  readonly channel: NotificationChannel;
};

type ChatIdRow = {
  readonly telegramChatId: string | null;
};

type LinkCodeRow = {
  readonly channelId: string;
};

type TelegramPayload = OutboxRow["payload"] & {
  readonly delivery?: {
    readonly telegramChatId?: string;
  };
};

export function createTelegramBot(config: TelegramBotConfig, db: TelegramDb): TelegramBotBundle {
  const token = config.botToken ?? config.token;
  if (token === undefined) {
    throw new Error("TELEGRAM_BOT_TOKEN is required to create the Telegram bot");
  }

  const bot = config.botFactory?.(token) ?? (new Bot(token) as unknown as TelegramBotLike);
  bot.command("start", (ctx) => handleTelegramStart(ctx, db));

  return {
    bot,
    channel: createTelegramChannel(bot, db)
  };
}

export function createTelegramChannel(bot: TelegramBotLike, db: TelegramDb): NotificationChannel {
  return {
    type: "telegram",
    async send(row: OutboxRow, rendered: RenderedMessage): Promise<NotificationSendResult> {
      const payload = row.payload as TelegramPayload;
      const chatId = payload.delivery?.telegramChatId ?? (await lookupTelegramChatId(db, row));
      if (chatId === undefined) {
        return {
          error: `No Telegram chat id for notification ${row.id}`,
          ok: false,
          retryable: false
        };
      }

      try {
        const sendOptions: TelegramSendOptions =
          rendered.html === undefined
            ? { disable_web_page_preview: false }
            : { disable_web_page_preview: false, parse_mode: "HTML" };
        const message = await bot.api.sendMessage(chatId, rendered.html ?? rendered.text, {
          ...sendOptions
        });
        const externalId = message.message_id === undefined ? undefined : String(message.message_id);
        return externalId === undefined
          ? { ok: true }
          : ({ externalId, ok: true } as NotificationSendResult & { readonly externalId: string });
      } catch (error) {
        return {
          error: errorMessage(error),
          ok: false,
          retryable: isRetryableTelegramError(error)
        };
      }
    }
  };
}

async function handleTelegramStart(ctx: TelegramStartContext, db: TelegramDb): Promise<void> {
  const code = extractStartCode(ctx);
  const chatId = ctx.chat?.id;

  if (code === undefined || chatId === undefined) {
    await ctx.reply("Open Sentinel settings and use the Telegram link button to connect this chat.");
    return;
  }

  const linked = rowsFromResult(
    await db.execute<LinkCodeRow>(
      sql`
        WITH consumed_code AS (
          UPDATE telegram_link_codes
          SET used_at = NOW()
          WHERE code = ${code}
            AND used_at IS NULL
            AND expires_at > NOW()
          RETURNING user_id
        ),
        linked_channel AS (
          INSERT INTO channels (user_id, type, telegram_chat_id, enabled, updated_at)
          SELECT user_id, 'telegram', ${String(chatId)}, TRUE, NOW()
          FROM consumed_code
          ON CONFLICT (telegram_chat_id)
          DO UPDATE SET
            user_id = EXCLUDED.user_id,
            enabled = TRUE,
            updated_at = NOW()
          RETURNING id AS "channelId"
        )
        SELECT "channelId"
        FROM linked_channel
      `
    )
  );

  if (linked.length === 0) {
    await ctx.reply("This Telegram link code is invalid or expired.");
    return;
  }

  await ctx.reply("Telegram alerts are connected for this Sentinel account.");
}

async function lookupTelegramChatId(db: TelegramDb, row: OutboxRow): Promise<string | undefined> {
  if (row.channelId === null) {
    return undefined;
  }

  const rows = rowsFromResult(
    await db.execute<ChatIdRow>(
      sql`
        SELECT telegram_chat_id AS "telegramChatId"
        FROM channels
        WHERE id = ${row.channelId}
          AND type = 'telegram'
          AND enabled = TRUE
        LIMIT 1
      `
    )
  );

  return rows[0]?.telegramChatId ?? undefined;
}

function extractStartCode(ctx: TelegramStartContext): string | undefined {
  const raw = ctx.match;
  if (raw === undefined) {
    return undefined;
  }

  const code = raw.toString().trim();
  return code.length === 0 ? undefined : code;
}

function isRetryableTelegramError(error: unknown): boolean {
  const code = errorCode(error);
  if (code === undefined) {
    return true;
  }

  return code === 429 || code >= 500;
}

function errorCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const record = error as Readonly<Record<string, unknown>>;
  const nested = record.error;
  const directCode = record.error_code;

  if (typeof directCode === "number") {
    return directCode;
  }

  if (typeof nested === "object" && nested !== null) {
    const nestedCode = (nested as Readonly<Record<string, unknown>>).error_code;
    return typeof nestedCode === "number" ? nestedCode : undefined;
  }

  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function rowsFromResult<T>(result: QueryResult<T>): readonly T[] {
  if (Array.isArray(result)) {
    return result;
  }

  return (result as { readonly rows: readonly T[] }).rows;
}
