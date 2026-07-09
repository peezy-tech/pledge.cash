import { sql, type SQL } from "drizzle-orm";

import type {
  ActionEvent,
  ActionPipelineEvent,
  ChannelType,
  NotificationEvent,
  QueuedActionRow,
  Severity
} from "../types";

type QueryResult<T> = readonly T[] | { readonly rows: readonly T[] };

export type FanoutDb = {
  execute<T = Record<string, unknown>>(query: SQL): Promise<QueryResult<T>>;
};

export type NotificationFanoutEvent = NotificationEvent;

export type NotificationPipelineEvent =
  | (Omit<ActionPipelineEvent, "event"> & {
      readonly event: ActionEvent | "reminder";
    })
  | (Omit<ActionPipelineEvent, "event"> & {
      readonly event: "policy-admin";
      readonly eventId: string;
    });

export type FanoutOptions = {
  readonly refanoutLimit?: number;
  readonly reminderHoursBeforeEta?: number;
  readonly now?: Date;
  readonly twitterEnabled?: boolean;
};

export type FanoutResult = {
  readonly telegram: number;
  readonly total: number;
  readonly twitter: number;
};

export type FanoutSweepHandle = {
  stop(): void;
};

export type StartFanoutSweepsOptions = FanoutOptions & {
  readonly db: FanoutDb;
  readonly logger?: Pick<Console, "error">;
  readonly refanoutIntervalMs?: number;
  readonly reminderIntervalMs?: number;
};

type InsertedNotificationRow = {
  readonly channelType: ChannelType;
  readonly id: string;
};

const emptyFanoutResult: FanoutResult = { telegram: 0, total: 0, twitter: 0 };

export function severityRank(severity: Severity): number {
  switch (severity) {
    case "low":
      return 1;
    case "medium":
      return 2;
    case "high":
      return 3;
  }
}

export function shouldNotifySeverity(minSeverity: Severity, severity: Severity): boolean {
  return severityRank(minSeverity) <= severityRank(severity);
}

export function buildNotificationDedupeKey(args: {
  readonly actionId?: string;
  readonly actionHash: string;
  readonly chainId: number;
  readonly channelId?: string | null;
  readonly channelType: ChannelType;
  readonly event: NotificationFanoutEvent;
  readonly eventId?: string;
}): string {
  const channelId = args.channelId ?? "public";
  const actionScope =
    args.actionId === undefined
      ? args.actionHash.toLowerCase()
      : `${args.actionId}:${args.actionHash.toLowerCase()}`;
  const eventScope =
    args.event === "policy-admin"
      ? `policy-admin:${requiredPolicyAdminEventId(args.eventId)}`
      : args.event;
  return `${args.chainId}:${actionScope}:${eventScope}:${args.channelType}:${channelId}`;
}

export async function fanout(
  event: NotificationPipelineEvent,
  db: FanoutDb,
  options: FanoutOptions = {}
): Promise<FanoutResult> {
  const subscriberRows = await insertSubscriberNotifications(event, db);
  const twitterRows = await insertTwitterNotification(event, db, options);

  return countInsertedRows([...subscriberRows, ...twitterRows]);
}

export async function runQueuedRefanoutSweep(
  db: FanoutDb,
  options: FanoutOptions = {}
): Promise<FanoutResult> {
  const actions = rowsFromResult(
    await db.execute<QueuedActionRow>(
      sql`
        SELECT
          id,
          chain_id AS "chainId",
          boardroom,
          action_hash AS "actionHash",
          queue_tx_hash AS "queueTxHash",
          salt,
          executor,
          eta,
          queue_block AS "queueBlock",
          queue_log_index AS "queueLogIndex",
          status,
          cancelled_by AS "cancelledBy",
          executed_by AS "executedBy",
          resolved_tx_hash AS "resolvedTxHash",
          decode_status AS "decodeStatus",
          raw_calldata AS "rawCalldata",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM queued_actions
        WHERE status = 'queued'
        ORDER BY eta ASC
        ${sweepLimitSql(options.refanoutLimit)}
      `
    )
  );

  return fanoutActions(actions, "queued", db, options);
}

export async function runReminderSweep(
  db: FanoutDb,
  options: FanoutOptions = {}
): Promise<FanoutResult> {
  const now = options.now ?? new Date();
  const reminderDeadline = new Date(
    now.getTime() + (options.reminderHoursBeforeEta ?? 24) * 3_600_000
  );
  const nowIso = now.toISOString();
  const reminderDeadlineIso = reminderDeadline.toISOString();
  const actions = rowsFromResult(
    await db.execute<QueuedActionRow>(
      sql`
        SELECT
          id,
          chain_id AS "chainId",
          boardroom,
          action_hash AS "actionHash",
          queue_tx_hash AS "queueTxHash",
          salt,
          executor,
          eta,
          queue_block AS "queueBlock",
          queue_log_index AS "queueLogIndex",
          status,
          cancelled_by AS "cancelledBy",
          executed_by AS "executedBy",
          resolved_tx_hash AS "resolvedTxHash",
          decode_status AS "decodeStatus",
          raw_calldata AS "rawCalldata",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM queued_actions
        WHERE status = 'queued'
          AND eta > ${nowIso}::timestamptz
          AND eta <= ${reminderDeadlineIso}::timestamptz
        ORDER BY eta ASC, id ASC
        ${sweepLimitSql(options.refanoutLimit)}
      `
    )
  );

  return fanoutActions(actions, "reminder", db, options);
}

export function startFanoutSweeps(options: StartFanoutSweepsOptions): FanoutSweepHandle {
  const logger = options.logger ?? console;
  let stopped = false;
  let refanoutRunning = false;
  let reminderRunning = false;

  const runRefanout = async (): Promise<void> => {
    if (stopped || refanoutRunning) return;
    refanoutRunning = true;
    try {
      await runQueuedRefanoutSweep(options.db, options);
    } catch (error) {
      logger.error(error);
    } finally {
      refanoutRunning = false;
    }
  };
  const runReminders = async (): Promise<void> => {
    if (stopped || reminderRunning) return;
    reminderRunning = true;
    try {
      await runReminderSweep(options.db, options);
    } catch (error) {
      logger.error(error);
    } finally {
      reminderRunning = false;
    }
  };

  const refanoutTimer = setInterval(
    () => void runRefanout(),
    options.refanoutIntervalMs ?? 3_600_000
  );
  const reminderTimer = setInterval(
    () => void runReminders(),
    options.reminderIntervalMs ?? 600_000
  );
  void runRefanout();
  void runReminders();

  return {
    stop() {
      stopped = true;
      clearInterval(refanoutTimer);
      clearInterval(reminderTimer);
    }
  };
}

async function fanoutActions(
  actions: readonly QueuedActionRow[],
  event: ActionEvent | "reminder",
  db: FanoutDb,
  options: FanoutOptions
): Promise<FanoutResult> {
  let result = emptyFanoutResult;

  for (const action of actions) {
    const nextResult = await fanout({ action, calls: [], event }, db, options);
    result = mergeFanoutResults(result, nextResult);
  }

  return result;
}

async function insertSubscriberNotifications(
  event: NotificationPipelineEvent,
  db: FanoutDb
): Promise<readonly InsertedNotificationRow[]> {
  const eventScope = eventDedupeScope(event);
  return rowsFromResult(
    await db.execute<InsertedNotificationRow>(
      sql`
        WITH action_context AS (
          ${actionContextSql(event.action.id)}
        ),
        eligible_channels AS (
          SELECT DISTINCT
            c.id AS channel_id,
            c.type AS channel_type,
            c.user_id
          FROM action_context ctx
          JOIN channels c
            ON c.enabled = TRUE
          LEFT JOIN subscriptions s
            ON s.user_id = c.user_id
          WHERE CASE COALESCE(s.min_severity, 'medium'::sentinel_severity)
              WHEN 'low' THEN 1
              WHEN 'medium' THEN 2
              WHEN 'high' THEN 3
            END <= CASE ctx.severity
              WHEN 'low' THEN 1
              WHEN 'medium' THEN 2
              WHEN 'high' THEN 3
            END
          AND (
            (
              COALESCE(s.mode, 'holdings'::sentinel_subscription_mode) = 'holdings'
              AND EXISTS (
                SELECT 1
                FROM wallets w
                JOIN share_balances sb
                  ON sb.chain_id = ctx.chain_id
                 AND sb.token = ctx.share_token
                 AND lower(sb.holder) = lower(w.address)
                 AND sb.balance::numeric > 0
                WHERE w.user_id = c.user_id
              )
            ) OR (
              s.mode = 'explicit'
              AND EXISTS (
                SELECT 1
                FROM subscription_boardrooms sbm
                WHERE sbm.user_id = s.user_id
                  AND sbm.chain_id = ctx.chain_id
                  AND lower(sbm.boardroom) = lower(ctx.boardroom)
              )
            )
          )
        )
        INSERT INTO notifications (
          dedupe_key,
          channel_type,
          channel_id,
          user_id,
          action_id,
          event,
          payload,
          status,
          next_attempt_at
        )
        SELECT
          concat(
            ctx.chain_id::text,
            ':',
            ctx.action_id::text,
            ':',
            lower(ctx.action_hash),
            ':',
            ${eventScope}::text,
            ':',
            eligible.channel_type,
            ':',
            eligible.channel_id::text
          ),
          eligible.channel_type,
          eligible.channel_id,
          eligible.user_id,
          ctx.action_id,
          ${event.event}::sentinel_notification_event,
          ${payloadSql(null)},
          'pending',
          NOW()
        FROM action_context ctx
        JOIN eligible_channels eligible ON TRUE
        ON CONFLICT (dedupe_key) DO NOTHING
        RETURNING id, channel_type AS "channelType"
      `
    )
  );
}

async function insertTwitterNotification(
  event: NotificationPipelineEvent,
  db: FanoutDb,
  options: FanoutOptions
): Promise<readonly InsertedNotificationRow[]> {
  if (options.twitterEnabled !== true) {
    return [];
  }

  if (event.event === "queued") {
    return insertQueuedTweet(event, db);
  }

  if (event.event === "cancelled" || event.event === "executed" || event.event === "policy-admin") {
    return insertTwitterFollowUp(event, db);
  }

  return [];
}

async function insertQueuedTweet(
  event: NotificationPipelineEvent,
  db: FanoutDb
): Promise<readonly InsertedNotificationRow[]> {
  return rowsFromResult(
    await db.execute<InsertedNotificationRow>(
      sql`
        WITH action_context AS (
          ${actionContextSql(event.action.id)}
        )
        INSERT INTO notifications (
          dedupe_key,
          channel_type,
          channel_id,
          user_id,
          action_id,
          event,
          payload,
          status,
          next_attempt_at
        )
        SELECT
          concat(ctx.chain_id::text, ':', ctx.action_id::text, ':', lower(ctx.action_hash), ':queued:twitter:public'),
          'twitter',
          NULL,
          NULL,
          ctx.action_id,
          'queued'::sentinel_notification_event,
          ${payloadSql(null)},
          'pending',
          NOW()
        FROM action_context ctx
        WHERE ctx.severity = 'high'
        ON CONFLICT (dedupe_key) DO NOTHING
        RETURNING id, channel_type AS "channelType"
      `
    )
  );
}

async function insertTwitterFollowUp(
  event: NotificationPipelineEvent,
  db: FanoutDb
): Promise<readonly InsertedNotificationRow[]> {
  const eventScope = eventDedupeScope(event);
  return rowsFromResult(
    await db.execute<InsertedNotificationRow>(
      sql`
        WITH action_context AS (
          ${actionContextSql(event.action.id)}
        ),
        original_tweet AS (
          SELECT external_id
          FROM notifications
          WHERE action_id = ${event.action.id}
            AND channel_type = 'twitter'
            AND event = 'queued'
            AND status IN ('pending', 'failed', 'sent')
          ORDER BY created_at ASC, id ASC
          LIMIT 1
        )
        INSERT INTO notifications (
          dedupe_key,
          channel_type,
          channel_id,
          user_id,
          action_id,
          event,
          payload,
          status,
          next_attempt_at
        )
        SELECT
          concat(ctx.chain_id::text, ':', ctx.action_id::text, ':', lower(ctx.action_hash), ':', ${eventScope}::text, ':twitter:public'),
          'twitter',
          NULL,
          NULL,
          ctx.action_id,
          ${event.event}::sentinel_notification_event,
          ${payloadSql("original.external_id")},
          'pending',
          NOW()
        FROM action_context ctx
        JOIN original_tweet original ON TRUE
        ON CONFLICT (dedupe_key) DO NOTHING
        RETURNING id, channel_type AS "channelType"
      `
    )
  );
}

function actionContextSql(actionId: string): SQL {
  return sql`
    SELECT
      qa.id AS action_id,
      qa.chain_id,
      qa.boardroom,
      qa.action_hash,
      qa.queue_tx_hash,
      qa.resolved_tx_hash,
      qa.eta,
      qa.status,
      b.name AS boardroom_name,
      b.share_token,
      r.severity,
      r.findings,
      a.summary,
      a.effects,
      a.affected_parties,
      a.severity_rationale,
      a.source,
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_strip_nulls(
              jsonb_build_object(
                'actionId', ac.action_id,
                'callIndex', ac.call_index,
                'policy', ac.policy,
                'target', ac.target,
                'value', ac.value::text,
                'data', ac.data,
                'selector', ac.selector,
                'decodedFunction', ac.decoded_function,
                'decodedArgs', ac.decoded_args
              )
            )
            ORDER BY ac.call_index
          )
          FROM action_calls ac
          WHERE ac.action_id = qa.id
        ),
        '[]'::jsonb
      ) AS calls
    FROM queued_actions qa
    JOIN boardrooms b
      ON b.chain_id = qa.chain_id
     AND lower(b.address) = lower(qa.boardroom)
    JOIN risk_assessments r
      ON r.action_id = qa.id
    JOIN analyses a
      ON a.action_id = qa.id
    WHERE qa.id = ${actionId}
  `;
}

function payloadSql(replyToExternalIdSql: string | null): SQL {
  const replyToExternalId =
    replyToExternalIdSql === null ? sql`NULL` : sql.raw(replyToExternalIdSql);

  return sql`
    jsonb_strip_nulls(
      jsonb_build_object(
        'action', jsonb_strip_nulls(
          jsonb_build_object(
            'id', ctx.action_id,
            'chainId', ctx.chain_id,
            'boardroom', ctx.boardroom,
            'actionHash', ctx.action_hash,
            'eta', ctx.eta,
            'status', ctx.status,
            'queueTxHash', ctx.queue_tx_hash,
            'resolvedTxHash', ctx.resolved_tx_hash
          )
        ),
        'boardroom', jsonb_strip_nulls(
          jsonb_build_object(
            'address', ctx.boardroom,
            'chainId', ctx.chain_id,
            'name', ctx.boardroom_name
          )
        ),
        'risk', jsonb_build_object(
          'severity', ctx.severity,
          'findings', ctx.findings
        ),
        'analysis', jsonb_strip_nulls(
          jsonb_build_object(
            'summary', ctx.summary,
            'effects', ctx.effects,
            'affectedParties', ctx.affected_parties,
            'severityRationale', ctx.severity_rationale,
            'source', ctx.source
          )
        ),
        'calls', ctx.calls,
        'delivery', jsonb_strip_nulls(
          jsonb_build_object(
            'replyToExternalId', ${replyToExternalId}
          )
        )
      )
    )
  `;
}

function eventDedupeScope(event: NotificationPipelineEvent): string {
  return event.event === "policy-admin"
    ? `policy-admin:${requiredPolicyAdminEventId(event.eventId)}`
    : event.event;
}

function requiredPolicyAdminEventId(eventId: string | undefined): string {
  if (eventId === undefined || eventId.length === 0) {
    throw new Error("policy-admin notifications require a source event id");
  }
  return eventId;
}

function sweepLimitSql(limit: number | undefined): SQL {
  return limit === undefined ? sql`` : sql`LIMIT ${limit}`;
}

function countInsertedRows(rows: readonly InsertedNotificationRow[]): FanoutResult {
  if (rows.length === 0) {
    return emptyFanoutResult;
  }

  let telegram = 0;
  let twitter = 0;

  for (const row of rows) {
    if (row.channelType === "telegram") {
      telegram += 1;
    } else if (row.channelType === "twitter") {
      twitter += 1;
    }
  }

  return { telegram, total: rows.length, twitter };
}

function mergeFanoutResults(left: FanoutResult, right: FanoutResult): FanoutResult {
  return {
    telegram: left.telegram + right.telegram,
    total: left.total + right.total,
    twitter: left.twitter + right.twitter
  };
}

function rowsFromResult<T>(result: QueryResult<T>): readonly T[] {
  if (Array.isArray(result)) {
    return result;
  }

  return (result as { readonly rows: readonly T[] }).rows;
}

export type { NotificationEvent };
