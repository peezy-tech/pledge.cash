import { sql, type SQL } from "drizzle-orm";

import type {
  ActionEvent,
  ActionPipelineEvent,
  ChannelType,
  NotificationEvent,
  QueuedActionRow,
  Severity,
  StoredCall
} from "../types";

type QueryResult<T> = readonly T[] | { readonly rows: readonly T[] };

export type FanoutDb = {
  execute<T = Record<string, unknown>>(query: SQL): Promise<QueryResult<T>>;
};

export type NotificationFanoutEvent = ActionEvent | "policy-admin";

export type NotificationPipelineEvent = Omit<ActionPipelineEvent, "event"> & {
  readonly event: NotificationFanoutEvent;
};

export type FanoutOptions = {
  readonly refanoutLimit?: number;
  readonly twitterEnabled?: boolean;
};

export type FanoutResult = {
  readonly telegram: number;
  readonly total: number;
  readonly twitter: number;
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
  readonly actionHash: string;
  readonly chainId: number;
  readonly channelId?: string | null;
  readonly channelType: ChannelType;
  readonly event: NotificationFanoutEvent;
}): string {
  const channelId = args.channelId ?? "public";
  return `${args.chainId}:${args.actionHash.toLowerCase()}:${args.event}:${args.channelType}:${channelId}`;
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
        LIMIT ${options.refanoutLimit ?? 100}
      `
    )
  );

  return fanoutActions(actions, "queued", db, options);
}

async function fanoutActions(
  actions: readonly QueuedActionRow[],
  event: NotificationFanoutEvent,
  db: FanoutDb,
  options: FanoutOptions
): Promise<FanoutResult> {
  let result = emptyFanoutResult;

  for (const action of actions) {
    const calls = await loadStoredCalls(action.id, db);
    const nextResult = await fanout({ action, calls, event }, db, options);
    result = mergeFanoutResults(result, nextResult);
  }

  return result;
}

async function loadStoredCalls(actionId: string, db: FanoutDb): Promise<StoredCall[]> {
  return [
    ...rowsFromResult(
      await db.execute<StoredCall>(
        sql`
          SELECT
            action_id AS "actionId",
            call_index AS "callIndex",
            policy,
            target,
            value::text AS value,
            data,
            selector,
            decoded_function AS "decodedFunction",
            decoded_args AS "decodedArgs"
          FROM action_calls
          WHERE action_id = ${actionId}
          ORDER BY call_index ASC
        `
      )
    )
  ];
}

async function insertSubscriberNotifications(
  event: NotificationPipelineEvent,
  db: FanoutDb
): Promise<readonly InsertedNotificationRow[]> {
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
            c.user_id,
            c.telegram_chat_id
          FROM action_context ctx
          JOIN subscriptions s
            ON CASE s.min_severity
              WHEN 'low' THEN 1
              WHEN 'medium' THEN 2
              WHEN 'high' THEN 3
            END <= CASE ctx.severity
              WHEN 'low' THEN 1
              WHEN 'medium' THEN 2
              WHEN 'high' THEN 3
            END
          JOIN channels c
            ON c.user_id = s.user_id
           AND c.enabled = TRUE
           AND c.type = 'telegram'
           AND c.telegram_chat_id IS NOT NULL
          WHERE (
            s.mode = 'holdings'
            AND EXISTS (
              SELECT 1
              FROM wallets w
              JOIN share_balances sb
                ON sb.chain_id = ctx.chain_id
               AND sb.token = ctx.share_token
               AND lower(sb.holder) = lower(w.address)
               AND sb.balance::numeric > 0
              WHERE w.user_id = s.user_id
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
            lower(ctx.action_hash),
            ':',
            ${event.event}::text,
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
          ${payloadSql("eligible.telegram_chat_id", null)},
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
          concat(ctx.chain_id::text, ':', lower(ctx.action_hash), ':queued:twitter:public'),
          'twitter',
          NULL,
          NULL,
          ctx.action_id,
          'queued'::sentinel_notification_event,
          ${payloadSql(null, null)},
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
            AND status = 'sent'
            AND external_id IS NOT NULL
          ORDER BY sent_at ASC NULLS LAST, id ASC
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
          concat(ctx.chain_id::text, ':', lower(ctx.action_hash), ':', ${event.event}::text, ':twitter:public'),
          'twitter',
          NULL,
          NULL,
          ctx.action_id,
          ${event.event}::sentinel_notification_event,
          ${payloadSql(null, "original.external_id")},
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

function payloadSql(telegramChatIdSql: string | null, replyToExternalIdSql: string | null): SQL {
  const telegramChatId = telegramChatIdSql === null ? sql`NULL` : sql.raw(telegramChatIdSql);
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
            'telegramChatId', ${telegramChatId},
            'replyToExternalId', ${replyToExternalId}
          )
        )
      )
    )
  `;
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
