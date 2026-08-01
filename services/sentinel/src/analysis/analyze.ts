import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq, gte, sql } from "drizzle-orm";
import { z } from "zod";

import type { SentinelDb } from "../db/client";
import { analyses, harnessRuns } from "../db/schema";
import type {
  AnalysisResult,
  BoardroomRow,
  RiskAssessment,
  ScheduledOperationRow,
  StoredCall
} from "../types";
import type { HarnessAdapter, HarnessResponse } from "./adapter";
import { buildHarnessPrompt } from "./prompt";
import { renderTemplateAnalysis } from "./templates";
import { cleanupAnalysisWorkspace, prepareAnalysisWorkspace } from "./workspace";

const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_WORKDIR = join(tmpdir(), "sentinel-analysis");

const nonEmptyStringSchema = z.string().trim().min(1);

export const AnalysisSchema = z
  .object({
    affectedParties: z.array(nonEmptyStringSchema).default([]),
    effects: z.array(nonEmptyStringSchema).default([]),
    severityRationale: nonEmptyStringSchema,
    summary: nonEmptyStringSchema
  })
  .strict();

export type AnalysisContent = z.infer<typeof AnalysisSchema>;

export type AnalyzeActionInput = {
  readonly action: Pick<
    ScheduledOperationRow,
    | "operationId"
    | "boardroom"
    | "boardroomEpoch"
    | "chainId"
    | "configurationEpoch"
    | "controller"
    | "controllerGeneration"
    | "decodeStatus"
    | "eta"
    | "id"
    | "operationKind"
    | "proposer"
    | "scheduleBlock"
    | "scheduleTxHash"
    | "rawCalldata"
    | "salt"
    | "status"
  >;
  readonly boardroom?: Pick<
    BoardroomRow,
    | "address"
    | "chainId"
    | "configurationEpoch"
    | "bondingCurve"
    | "bondingCurvePhase"
    | "bondingCurvePhaseEndsAt"
    | "bondingCurveSettlementReason"
    | "controller"
    | "controllerGeneration"
    | "controllerDelay"
    | "gracePeriod"
    | "launched"
    | "liquidityVault"
    | "liquidityPoolId"
    | "liquidityQuoteAsset"
    | "liquidityReservationCurve"
    | "liquidityReservationExpectedVault"
    | "liquidityReservationExpectedPoolId"
    | "liquidityReservationExpiresAt"
    | "liquidityReservationPairKey"
    | "liquidityReservationSalt"
    | "liquidityStatus"
    | "name"
    | "owner"
    | "proposer"
    | "primaryMarketMode"
    | "primaryMarketQuoteAsset"
    | "shareToken"
    | "status"
    | "windDownDelay"
  >;
  readonly calls: readonly StoredCall[];
  readonly harness?: {
    readonly eligible: boolean;
    readonly reason?: string;
    readonly subscriberCount?: number;
  };
  readonly risk: RiskAssessment;
};

export type AnalysisDraft = Omit<AnalysisResult, "createdAt" | "updatedAt">;

export type AnalysisStore = {
  get(input: AnalyzeActionInput): Promise<AnalysisResult | undefined>;
  put(draft: AnalysisDraft): Promise<AnalysisResult>;
  reserveHarnessRun(input: {
    readonly actionId: string;
    readonly dailyLimit: number;
    readonly harness: string;
    readonly now: Date;
  }): Promise<boolean>;
};

export type AnalyzeActionDeps = {
  readonly adapter?: HarnessAdapter;
  readonly dailyLimit?: number;
  readonly db: AnalysisStore;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
  readonly workdir?: string;
};

type AnalysisJob = {
  readonly deps: AnalyzeActionDeps;
  readonly input: AnalyzeActionInput;
  readonly priority: number;
  readonly reject: (reason?: unknown) => void;
  readonly resolve: (result: AnalysisResult) => void;
  readonly sequence: number;
};

const analysisQueue: AnalysisJob[] = [];
let analysisQueueActive = false;
let analysisSequence = 0;

export function createDrizzleAnalysisStore(db: SentinelDb): AnalysisStore {
  return {
    async get(input) {
      const [row] = await db.select().from(analyses).where(eq(analyses.actionId, input.action.id)).limit(1);
      return row;
    },
    async put(draft) {
      const [row] = await db
        .insert(analyses)
        .values(draft)
        .onConflictDoUpdate({
          set: {
            affectedParties: draft.affectedParties,
            effects: draft.effects,
            harness: draft.harness,
            model: draft.model,
            severityRationale: draft.severityRationale,
            source: draft.source,
            summary: draft.summary,
            updatedAt: new Date()
          },
          target: analyses.actionId
        })
        .returning();

      if (row === undefined) {
        throw new Error("Analysis write did not return a row");
      }

      return row;
    },
    async reserveHarnessRun(input) {
      if (input.dailyLimit <= 0) return false;

      const [usage] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(harnessRuns)
        .where(gte(harnessRuns.startedAt, utcDayStart(input.now)));
      if ((usage?.count ?? 0) >= input.dailyLimit) return false;

      const inserted = await db
        .insert(harnessRuns)
        .values({ actionId: input.actionId, harness: input.harness, startedAt: input.now })
        .onConflictDoNothing()
        .returning({ id: harnessRuns.id });
      return inserted.length > 0;
    }
  };
}

export function analyzeAction(input: AnalyzeActionInput, deps: AnalyzeActionDeps): Promise<AnalysisResult> {
  return new Promise<AnalysisResult>((resolve, reject) => {
    analysisQueue.push({
      deps,
      input,
      priority: input.harness?.subscriberCount ?? 0,
      reject,
      resolve,
      sequence: analysisSequence++
    });
    analysisQueue.sort(
      (left, right) => right.priority - left.priority || left.sequence - right.sequence
    );
    void drainAnalysisQueue();
  });
}

async function drainAnalysisQueue(): Promise<void> {
  if (analysisQueueActive) return;
  analysisQueueActive = true;

  try {
    let job = analysisQueue.shift();
    while (job !== undefined) {
      try {
        job.resolve(await analyzeActionNow(job.input, job.deps));
      } catch (error) {
        job.reject(error);
      }
      job = analysisQueue.shift();
    }
  } finally {
    analysisQueueActive = false;
    if (analysisQueue.length > 0) void drainAnalysisQueue();
  }
}

async function analyzeActionNow(input: AnalyzeActionInput, deps: AnalyzeActionDeps): Promise<AnalysisResult> {
  const cached = await tryGetCached(input, deps.db);
  if (cached !== undefined) {
    return cached;
  }

  const adapter = input.harness?.eligible === false ? undefined : deps.adapter;
  if (adapter === undefined) {
    return persistAnalysis(templateDraft(input, "template", null), deps.db);
  }

  const now = deps.now?.() ?? new Date();
  const reserved = await deps.db.reserveHarnessRun({
    actionId: input.action.id,
    dailyLimit: deps.dailyLimit ?? Number.MAX_SAFE_INTEGER,
    harness: adapter.harness,
    now
  });
  if (!reserved) {
    return persistAnalysis(templateDraft(input, "template", null), deps.db);
  }

  const workdir = deps.workdir ?? DEFAULT_WORKDIR;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let draft: AnalysisDraft;
  let workspaceDir: string | undefined;

  try {
    const workspace = await prepareAnalysisWorkspace(input, { baseDir: workdir });
    workspaceDir = workspace.workspaceDir;
    const prompt = buildHarnessPrompt();
    const response = await runWithDeadline(adapter, {
      prompt,
      timeoutMs,
      workspaceDir: workspace.workspaceDir
    });
    draft = response.ok
      ? await draftFromHarnessResponse(input, response)
      : templateDraft(input, adapter.harness, null);
  } catch {
    draft = templateDraft(input, adapter.harness, null);
  } finally {
    if (workspaceDir !== undefined) {
      await cleanupAnalysisWorkspace(workspaceDir);
    }
  }

  return await persistAnalysis(draft, deps.db);
}

async function tryGetCached(
  input: AnalyzeActionInput,
  db: AnalysisStore
): Promise<AnalysisResult | undefined> {
  try {
    return await db.get(input);
  } catch {
    return undefined;
  }
}

async function runWithDeadline(
  adapter: HarnessAdapter,
  req: { readonly prompt: string; readonly timeoutMs: number; readonly workspaceDir: string }
): Promise<HarnessResponse> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<HarnessResponse>((resolve) => {
    timer = setTimeout(() => {
      resolve({ detail: `Harness exceeded ${req.timeoutMs}ms deadline.`, ok: false, reason: "timeout" });
    }, req.timeoutMs);
  });

  const run = adapter.run(req).catch((error): HarnessResponse => {
    return { detail: error instanceof Error ? error.message : String(error), ok: false, reason: "error" };
  });

  const response = await Promise.race([run, timeout]);
  if (timer !== undefined) {
    clearTimeout(timer);
  }

  run.catch(() => undefined);
  return response;
}

async function draftFromHarnessResponse(
  input: AnalyzeActionInput,
  response: Extract<HarnessResponse, { ok: true }>
): Promise<AnalysisDraft> {
  try {
    const raw = await readFile(response.outputPath, "utf8");
    const parsed = AnalysisSchema.parse(JSON.parse(raw));
    return {
      ...parsed,
      actionId: input.action.id,
      harness: response.harness,
      model: response.model ?? null,
      source: "harness"
    };
  } catch {
    return templateDraft(input, response.harness, response.model ?? null);
  }
}

function templateDraft(input: AnalyzeActionInput, harness: string, model: string | null): AnalysisDraft {
  return {
    ...renderTemplateAnalysis(input),
    actionId: input.action.id,
    harness,
    model,
    source: "template"
  };
}

async function persistAnalysis(draft: AnalysisDraft, db: AnalysisStore): Promise<AnalysisResult> {
  return await db.put(draft);
}

function utcDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
