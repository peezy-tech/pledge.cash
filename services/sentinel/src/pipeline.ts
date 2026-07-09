import { and, eq } from "drizzle-orm";
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
        await analyzeAction(
          {
            action: event.action,
            ...(boardroom === undefined ? {} : { boardroom }),
            calls: event.calls,
            risk
          },
          {
            ...(options.adapter === undefined ? {} : { adapter: options.adapter }),
            db: analysisStore,
            timeoutMs: options.config.harness.timeoutMs,
            workdir: options.config.harness.workdir
          }
        );

        await fanout(
          {
            action: event.action,
            calls: event.calls,
            event: event.event
          },
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
