import { sql, type SQL } from "drizzle-orm";

import type { NotificationChannel, NotificationSendResult } from "./types";
import { renderNotification, type RenderOptions } from "./render";
import type { OutboxRow, RenderedMessage } from "../types";

type QueryResult<T> = readonly T[] | { readonly rows: readonly T[] };

export type DispatcherDbExecutor = {
  execute<T = Record<string, unknown>>(query: SQL): Promise<QueryResult<T>>;
};

export type DispatcherDb = DispatcherDbExecutor & {
  transaction?<T>(callback: (tx: DispatcherDbExecutor) => Promise<T>): Promise<T>;
};

export type DispatchOnceOptions = {
  readonly batchSize?: number;
  readonly channels: readonly NotificationChannel[];
  readonly db: DispatcherDb;
  readonly maxAttempts?: number;
  readonly now?: () => Date;
  readonly rateLimiter?: NotificationRateLimiter;
  readonly render?: (row: OutboxRow) => RenderedMessage;
  readonly renderOptions?: RenderOptions;
};

export type StartDispatcherOptions = DispatchOnceOptions & {
  readonly intervalMs?: number;
  readonly logger?: Pick<Console, "error">;
};

export type DispatcherRunResult = {
  readonly dead: number;
  readonly failed: number;
  readonly selected: number;
  readonly sent: number;
};

export type DispatcherHandle = {
  dispatchOnce(): Promise<DispatcherRunResult>;
  stop(): void;
};

export interface NotificationRateLimiter {
  wait(row: OutboxRow): Promise<void>;
}

type SendResultWithExternalId = NotificationSendResult & {
  readonly externalId?: string;
};

const defaultBatchSize = 20;
const defaultIntervalMs = 3_000;
const defaultMaxAttempts = 8;
const backoffBaseMs = 30_000;
const maxBackoffMs = 3_600_000;

export function startDispatcher(options: StartDispatcherOptions): DispatcherHandle {
  const intervalMs = options.intervalMs ?? defaultIntervalMs;
  const logger = options.logger ?? console;
  const rateLimiter = options.rateLimiter ?? new InMemoryNotificationRateLimiter();
  let stopped = false;
  let inFlight = false;

  const run = async (): Promise<void> => {
    if (stopped || inFlight) {
      return;
    }

    inFlight = true;
    try {
      await dispatchOnce(withRateLimiter(options, rateLimiter));
    } catch (error) {
      logger.error(error);
    } finally {
      inFlight = false;
    }
  };

  const timer = setInterval(() => {
    void run();
  }, intervalMs);
  void run();

  return {
    dispatchOnce: () => dispatchOnce(withRateLimiter(options, rateLimiter)),
    stop() {
      stopped = true;
      clearInterval(timer);
    }
  };
}

function withRateLimiter<T extends DispatchOnceOptions>(
  options: T,
  rateLimiter: NotificationRateLimiter
): T & { readonly rateLimiter: NotificationRateLimiter } {
  return { ...options, rateLimiter };
}

export async function dispatchOnce(options: DispatchOnceOptions): Promise<DispatcherRunResult> {
  const now = options.now ?? (() => new Date());
  const channels = new Map(options.channels.map((channel) => [channel.type, channel]));
  const batchSize = options.batchSize ?? defaultBatchSize;
  const maxAttempts = options.maxAttempts ?? defaultMaxAttempts;
  const render = options.render ?? ((row: OutboxRow) => renderNotification(row, options.renderOptions));
  const rateLimiter = options.rateLimiter ?? new InMemoryNotificationRateLimiter();

  return runInTransaction(options.db, async (tx) => {
    const rows = rowsFromResult(await tx.execute<OutboxRow>(selectPendingSql(batchSize)));
    const result = { dead: 0, failed: 0, selected: rows.length, sent: 0 };

    for (const row of rows) {
      const channel = channels.get(row.channelType);

      if (channel === undefined) {
        const failed = await markFailure(tx, row, {
          error: `No notification channel registered for ${row.channelType}`,
          maxAttempts,
          now: now(),
          retryable: false
        });
        result.dead += failed.dead;
        result.failed += failed.failed;
        continue;
      }

      try {
        const rendered = render(row);
        await rateLimiter.wait(row);
        const sendResult = (await channel.send(row, rendered)) as SendResultWithExternalId;

        if (sendResult.ok) {
          await markSent(tx, row.id, now(), sendResult.externalId);
          result.sent += 1;
        } else {
          const failed = await markFailure(tx, row, {
            error: sendResult.error,
            maxAttempts,
            now: now(),
            retryable: sendResult.retryable
          });
          result.dead += failed.dead;
          result.failed += failed.failed;
        }
      } catch (error) {
        const failed = await markFailure(tx, row, {
          error: error instanceof Error ? error.message : String(error),
          maxAttempts,
          now: now(),
          retryable: true
        });
        result.dead += failed.dead;
        result.failed += failed.failed;
      }
    }

    return result;
  });
}

export function computeBackoffMs(attemptsBeforeFailure: number): number {
  return Math.min(2 ** attemptsBeforeFailure * backoffBaseMs, maxBackoffMs);
}

export class InMemoryNotificationRateLimiter implements NotificationRateLimiter {
  readonly #nextAvailableByKey = new Map<string, number>();
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #nowMs: () => number;

  constructor(options: { readonly nowMs?: () => number; readonly sleep?: (ms: number) => Promise<void> } = {}) {
    this.#nowMs = options.nowMs ?? (() => Date.now());
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async wait(row: OutboxRow): Promise<void> {
    const limits = rateLimitsFor(row);
    if (limits.length === 0) {
      return;
    }

    const now = this.#nowMs();
    const waitMs = Math.max(
      0,
      ...limits.map((limit) => (this.#nextAvailableByKey.get(limit.key) ?? now) - now)
    );

    if (waitMs > 0) {
      await this.#sleep(waitMs);
    }

    const nextNow = this.#nowMs();
    for (const limit of limits) {
      this.#nextAvailableByKey.set(limit.key, nextNow + limit.intervalMs);
    }
  }
}

function rateLimitsFor(row: OutboxRow): readonly { readonly intervalMs: number; readonly key: string }[] {
  if (row.channelType === "telegram") {
    const channelKey = row.channelId ?? row.userId ?? "unknown";
    return [
      { intervalMs: 40, key: "telegram:global" },
      { intervalMs: 1_000, key: `telegram:${channelKey}` }
    ];
  }

  if (row.channelType === "twitter") {
    return [{ intervalMs: 10_000, key: "twitter:public" }];
  }

  return [];
}

function selectPendingSql(batchSize: number): SQL {
  return sql`
    SELECT
      id,
      dedupe_key AS "dedupeKey",
      channel_type AS "channelType",
      channel_id AS "channelId",
      user_id AS "userId",
      action_id AS "actionId",
      event,
      payload,
      status,
      attempts,
      next_attempt_at AS "nextAttemptAt",
      sent_at AS "sentAt",
      external_id AS "externalId",
      last_error AS "lastError",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM notifications
    WHERE status IN ('pending', 'failed')
      AND next_attempt_at <= NOW()
    ORDER BY id
    LIMIT ${batchSize}
    FOR UPDATE SKIP LOCKED
  `;
}

async function markSent(
  tx: DispatcherDbExecutor,
  id: string,
  now: Date,
  externalId: string | undefined
): Promise<void> {
  const externalIdSql = externalId === undefined ? sql`external_id` : sql`${externalId}`;

  await tx.execute(
    sql`
      UPDATE notifications
      SET status = 'sent',
          sent_at = ${now},
          external_id = ${externalIdSql},
          last_error = NULL,
          updated_at = ${now}
      WHERE id = ${id}
    `
  );
}

async function markFailure(
  tx: DispatcherDbExecutor,
  row: OutboxRow,
  args: {
    readonly error: string;
    readonly maxAttempts: number;
    readonly now: Date;
    readonly retryable: boolean;
  }
): Promise<{ readonly dead: number; readonly failed: number }> {
  const attempts = row.attempts + 1;
  const dead = !args.retryable || attempts >= args.maxAttempts;
  const nextAttemptAt = dead ? args.now : new Date(args.now.getTime() + computeBackoffMs(row.attempts));
  const status = dead ? "dead" : "failed";

  await tx.execute(
    sql`
      UPDATE notifications
      SET status = ${status}::sentinel_notification_status,
          attempts = ${attempts},
          next_attempt_at = ${nextAttemptAt},
          last_error = ${args.error},
          updated_at = ${args.now}
      WHERE id = ${row.id}
    `
  );

  return dead ? { dead: 1, failed: 0 } : { dead: 0, failed: 1 };
}

async function runInTransaction<T>(
  db: DispatcherDb,
  callback: (tx: DispatcherDbExecutor) => Promise<T>
): Promise<T> {
  if (db.transaction === undefined) {
    return callback(db);
  }

  return db.transaction(callback);
}

function rowsFromResult<T>(result: QueryResult<T>): readonly T[] {
  if (Array.isArray(result)) {
    return result;
  }

  return (result as { readonly rows: readonly T[] }).rows;
}
