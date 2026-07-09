import { and, eq, sql } from "drizzle-orm";
import { getPledgeCashDeployment } from "@pledge.cash/sdk";

import type { Config } from "./config";
import type { SentinelDb } from "./db/client";
import { boardrooms, riskAssessments } from "./db/schema";
import type { BoardroomRow, RiskAssessment } from "./types";
import { analyzeAction, createDrizzleAnalysisStore } from "./analysis/analyze";
import type { HarnessAdapter } from "./analysis/adapter";
import type { WatcherPipelineEvent } from "./chain/watcher";
import { evaluateAction } from "./risk/engine";
import { fanout, type FanoutDb } from "./notify/fanout";

export type ActionPipeline = {
  handle(event: WatcherPipelineEvent): Promise<void>;
};

export type CreateActionPipelineOptions = {
  readonly adapter?: HarnessAdapter;
  readonly config: Config;
  readonly db: SentinelDb;
  readonly logger?: Pick<Console, "error">;
};

export function createActionPipeline(options: CreateActionPipelineOptions): ActionPipeline {
  const analysisStore = createDrizzleAnalysisStore(options.db);
  const logger = options.logger ?? console;

  return {
    async handle(event) {
      try {
        const risk = evaluatePipelineRisk(event);
        await persistRisk(options.db, risk);
        const boardroom = await loadBoardroom(options.db, event);
        const subscriberCount = await countActionSubscribers(options.db, event);
        const allowlisted = options.config.harness.boardroomAllowlist.includes(
          event.action.boardroom.toLowerCase()
        );
        await analyzeAction(
          {
            action: event.action,
            ...(boardroom === undefined ? {} : { boardroom }),
            calls: event.calls,
            harness: {
              eligible: allowlisted || subscriberCount > 0,
              reason: allowlisted
                ? "operator allowlist"
                : subscriberCount > 0
                  ? "subscribers"
                  : "no subscribers",
              subscriberCount
            },
            risk
          },
          {
            ...(options.adapter === undefined ? {} : { adapter: options.adapter }),
            dailyLimit: options.config.harness.dailyLimit,
            db: analysisStore,
            timeoutMs: options.config.harness.timeoutMs,
            workdir: options.config.harness.workdir
          }
        );

        const notificationEvent =
          event.event === "policy-admin"
            ? {
                action: event.action,
                calls: event.calls,
                event: event.event,
                eventId: event.eventId
              }
            : { action: event.action, calls: event.calls, event: event.event };
        await fanout(
          notificationEvent,
          options.db as unknown as FanoutDb,
          { twitterEnabled: options.config.twitter.enabled }
        );
      } catch (error) {
        logger.error(error);
        throw error;
      }
    }
  };
}

type SubscriberCountRow = { readonly count: number | string };
type QueryResult<T> = readonly T[] | { readonly rows: readonly T[] };

export async function countActionSubscribers(
  db: Pick<SentinelDb, "execute">,
  event: WatcherPipelineEvent
): Promise<number> {
  const rows = rowsFromResult(
    await db.execute<SubscriberCountRow>(
      sql`
        SELECT COUNT(DISTINCT u.id)::int AS count
        FROM users u
        LEFT JOIN subscriptions s
          ON s.user_id = u.id
        WHERE (
          s.mode = 'explicit'
          AND EXISTS (
            SELECT 1
            FROM subscription_boardrooms sbm
            WHERE sbm.user_id = u.id
              AND sbm.chain_id = ${event.action.chainId}
              AND lower(sbm.boardroom) = lower(${event.action.boardroom})
          )
        ) OR (
          COALESCE(s.mode, 'holdings'::sentinel_subscription_mode) = 'holdings'
          AND EXISTS (
            SELECT 1
            FROM wallets w
            JOIN boardrooms b
              ON b.chain_id = ${event.action.chainId}
             AND lower(b.address) = lower(${event.action.boardroom})
            JOIN share_balances sb
              ON sb.chain_id = b.chain_id
             AND lower(sb.token) = lower(b.share_token)
             AND lower(sb.holder) = lower(w.address)
             AND sb.balance::numeric > 0
            WHERE w.user_id = u.id
          )
        )
      `
    )
  );
  return Number(rows[0]?.count ?? 0);
}

function rowsFromResult<T>(result: QueryResult<T>): readonly T[] {
  if (Array.isArray(result)) return result;
  return (result as { readonly rows: readonly T[] }).rows;
}

function evaluatePipelineRisk(event: WatcherPipelineEvent): RiskAssessment {
  const deployment = getPledgeCashDeployment(event.action.chainId);
  return evaluateAction(event.calls, {
    actionId: event.action.id,
    ...(deployment?.assetPolicy === undefined ? {} : { assetPolicy: deployment.assetPolicy }),
    boardroom: event.action.boardroom,
    decodeStatus: event.action.decodeStatus,
    evaluatedAt: new Date(),
    ...(deployment?.boardroomPolicyRegistry === undefined
      ? {}
      : { policyRegistry: deployment.boardroomPolicyRegistry })
  });
}

async function persistRisk(db: SentinelDb, risk: RiskAssessment): Promise<void> {
  await db
    .insert(riskAssessments)
    .values({
      actionId: risk.actionId,
      evaluatedAt: risk.evaluatedAt,
      findings: risk.findings,
      rulesetVersion: risk.rulesetVersion,
      severity: risk.severity
    })
    .onConflictDoUpdate({
      target: riskAssessments.actionId,
      set: {
        evaluatedAt: risk.evaluatedAt,
        findings: risk.findings,
        rulesetVersion: risk.rulesetVersion,
        severity: risk.severity
      }
    });
}

async function loadBoardroom(
  db: SentinelDb,
  event: WatcherPipelineEvent
): Promise<BoardroomRow | undefined> {
  const [row] = await db
    .select()
    .from(boardrooms)
    .where(
      and(eq(boardrooms.chainId, event.action.chainId), eq(boardrooms.address, event.action.boardroom))
    )
    .limit(1);
  return row;
}
