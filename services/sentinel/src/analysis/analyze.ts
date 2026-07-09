import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { z } from "zod";

import type { SentinelDb } from "../db/client";
import { analyses } from "../db/schema";
import type { AnalysisResult, BoardroomRow, QueuedActionRow, RiskAssessment, StoredCall } from "../types";
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
    QueuedActionRow,
    | "actionHash"
    | "boardroom"
    | "chainId"
    | "decodeStatus"
    | "eta"
    | "executor"
    | "id"
    | "queueBlock"
    | "queueTxHash"
    | "rawCalldata"
    | "salt"
    | "status"
  >;
  readonly boardroom?: Pick<
    BoardroomRow,
    | "address"
    | "chainId"
    | "executor"
    | "governanceDelay"
    | "launched"
    | "name"
    | "owner"
    | "shareToken"
    | "status"
  >;
  readonly calls: readonly StoredCall[];
  readonly harness?: {
    readonly eligible: boolean;
    readonly reason?: string;
  };
  readonly risk: RiskAssessment;
};

export type AnalysisDraft = Omit<AnalysisResult, "createdAt" | "updatedAt">;

export type AnalysisStore = {
  get(input: AnalyzeActionInput): Promise<AnalysisResult | undefined>;
  put(draft: AnalysisDraft): Promise<AnalysisResult>;
};

export type AnalyzeActionDeps = {
  readonly adapter?: HarnessAdapter;
  readonly db: AnalysisStore;
  readonly timeoutMs?: number;
  readonly workdir?: string;
};

let analysisQueue: Promise<void> = Promise.resolve();

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

      return row ?? volatileResult(draft);
    }
  };
}

export function analyzeAction(input: AnalyzeActionInput, deps: AnalyzeActionDeps): Promise<AnalysisResult> {
  const run = (): Promise<AnalysisResult> => analyzeActionNow(input, deps);
  const next = analysisQueue.then(run, run);
  analysisQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

async function analyzeActionNow(input: AnalyzeActionInput, deps: AnalyzeActionDeps): Promise<AnalysisResult> {
  const cached = await tryGetCached(input, deps.db);
  if (cached !== undefined) {
    return cached;
  }

  const adapter = input.harness?.eligible === false ? undefined : deps.adapter;
  if (adapter === undefined) {
    return persistOrReturn(templateDraft(input, "template", null), deps.db);
  }

  const workdir = deps.workdir ?? DEFAULT_WORKDIR;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
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
    const draft = response.ok
      ? await draftFromHarnessResponse(input, response)
      : templateDraft(input, adapter.harness, null);

    return await persistOrReturn(draft, deps.db);
  } catch {
    return await persistOrReturn(templateDraft(input, adapter.harness, null), deps.db);
  } finally {
    if (workspaceDir !== undefined) {
      await cleanupAnalysisWorkspace(workspaceDir);
    }
  }
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

async function persistOrReturn(draft: AnalysisDraft, db: AnalysisStore): Promise<AnalysisResult> {
  try {
    return await db.put(draft);
  } catch {
    return volatileResult(draft);
  }
}

function volatileResult(draft: AnalysisDraft): AnalysisResult {
  const now = new Date();
  return { ...draft, createdAt: now, updatedAt: now };
}
