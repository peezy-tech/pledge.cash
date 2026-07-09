import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  analyzeAction,
  type AnalysisDraft,
  type AnalysisStore,
  type AnalyzeActionInput
} from "../src/analysis/analyze";
import type { HarnessAdapter, HarnessRequest, HarnessResponse } from "../src/analysis/adapter";
import { ANALYSIS_FILENAME, INPUT_FILENAME, INSTRUCTIONS_FILENAME } from "../src/analysis/prompt";
import type { AnalysisResult } from "../src/types";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("analyzeAction", () => {
  test("prepares an inert workspace, accepts valid harness output, persists it, and cleans up", async () => {
    const store = new MemoryAnalysisStore();
    const workdir = await tempRoot();
    let capturedWorkspace: string | undefined;
    const adapter = new FakeAdapter(async (req) => {
      capturedWorkspace = req.workspaceDir;
      expect(existsSync(join(req.workspaceDir, INPUT_FILENAME))).toBe(true);
      expect(existsSync(join(req.workspaceDir, INSTRUCTIONS_FILENAME))).toBe(true);
      expect(existsSync(join(req.workspaceDir, "docs", "boardroom-protocol.md"))).toBe(true);
      expect(existsSync(join(req.workspaceDir, "docs", "abi-excerpts.json"))).toBe(true);

      await writeFile(
        join(req.workspaceDir, ANALYSIS_FILENAME),
        JSON.stringify({
          affectedParties: ["share holders", "treasury"],
          effects: ["Executor would be changed."],
          severityRationale: "The rules already marked this as high because executor control changes.",
          summary: "This changes the Boardroom executor after the veto window."
        })
      );

      return {
        harness: "fake",
        model: "fixture-model",
        ok: true,
        outputPath: join(req.workspaceDir, ANALYSIS_FILENAME)
      };
    });

    const result = await analyzeAction(sampleInput(), {
      adapter,
      db: store,
      timeoutMs: 1_000,
      workdir
    });

    expect(result.source).toBe("harness");
    expect(result.harness).toBe("fake");
    expect(result.model).toBe("fixture-model");
    expect(result.summary).toBe("This changes the Boardroom executor after the veto window.");
    expect(store.puts).toBe(1);
    expect(capturedWorkspace).toBeDefined();
    expect(existsSync(capturedWorkspace!)).toBe(false);
  });

  test("returns cached analyses without running the adapter again", async () => {
    const store = new MemoryAnalysisStore();
    const workdir = await tempRoot();
    const adapter = new FakeAdapter(async (req) => {
      await writeFile(
        join(req.workspaceDir, ANALYSIS_FILENAME),
        JSON.stringify({
          affectedParties: ["share holders"],
          effects: ["The action calls setExecutor."],
          severityRationale: "Rules engine severity is high.",
          summary: "Harness result."
        })
      );
      return { harness: "fake", ok: true, outputPath: join(req.workspaceDir, ANALYSIS_FILENAME) };
    });

    const first = await analyzeAction(sampleInput(), { adapter, db: store, timeoutMs: 1_000, workdir });
    const second = await analyzeAction(sampleInput(), { adapter, db: store, timeoutMs: 1_000, workdir });

    expect(first.summary).toBe("Harness result.");
    expect(second.summary).toBe("Harness result.");
    expect(adapter.runs).toBe(1);
    expect(store.gets).toBe(2);
    expect(store.puts).toBe(1);
  });

  test("serializes adapter runs", async () => {
    const store = new MemoryAnalysisStore();
    const workdir = await tempRoot();
    let activeRuns = 0;
    let maxActiveRuns = 0;
    const adapter = new FakeAdapter(async (req) => {
      activeRuns += 1;
      maxActiveRuns = Math.max(maxActiveRuns, activeRuns);
      await sleep(20);
      await writeFile(
        join(req.workspaceDir, ANALYSIS_FILENAME),
        JSON.stringify({
          affectedParties: ["share holders"],
          effects: ["Serialized run completed."],
          severityRationale: "Rules engine severity is high.",
          summary: "Serialized result."
        })
      );
      activeRuns -= 1;
      return { harness: "fake", ok: true, outputPath: join(req.workspaceDir, ANALYSIS_FILENAME) };
    });

    await Promise.all([
      analyzeAction(sampleInput("22222222-2222-4222-8222-222222222222"), {
        adapter,
        db: store,
        timeoutMs: 1_000,
        workdir
      }),
      analyzeAction(
        sampleInput(
          "33333333-3333-4333-8333-333333333333",
          "0xabababababababababababababababababababababababababababababababab"
        ),
        {
          adapter,
          db: store,
          timeoutMs: 1_000,
          workdir
        }
      )
    ]);

    expect(adapter.runs).toBe(2);
    expect(maxActiveRuns).toBe(1);
  });

  test("uses deterministic templates when no adapter is configured", async () => {
    const result = await analyzeAction(sampleInput(), { db: new MemoryAnalysisStore() });

    expect(result.source).toBe("template");
    expect(result.harness).toBe("template");
    expect(result.summary).toContain("HIGH severity governance action queued");
    expect(result.severityRationale).toContain("ruleset 7");
    expect(result.effects).toContain("Rule executor-change (high): Changes the executor address.");
  });

  test("uses deterministic templates when harness output is missing", async () => {
    const workdir = await tempRoot();
    const adapter = new FakeAdapter(async (req) => {
      return { harness: "fake", ok: true, outputPath: join(req.workspaceDir, ANALYSIS_FILENAME) };
    });

    const result = await analyzeAction(sampleInput("missing-output-action"), {
      adapter,
      db: new MemoryAnalysisStore(),
      timeoutMs: 1_000,
      workdir
    });

    expect(result.source).toBe("template");
    expect(result.harness).toBe("fake");
    expect(result.model).toBe(null);
  });

  test("uses deterministic templates when harness JSON is malformed", async () => {
    const workdir = await tempRoot();
    const adapter = new FakeAdapter(async (req) => {
      await writeFile(join(req.workspaceDir, ANALYSIS_FILENAME), "{not-json");
      return {
        harness: "fake",
        model: "bad-json-model",
        ok: true,
        outputPath: join(req.workspaceDir, ANALYSIS_FILENAME)
      };
    });

    const result = await analyzeAction(sampleInput("malformed-json-action"), {
      adapter,
      db: new MemoryAnalysisStore(),
      timeoutMs: 1_000,
      workdir
    });

    expect(result.source).toBe("template");
    expect(result.harness).toBe("fake");
    expect(result.model).toBe("bad-json-model");
    expect(result.summary).toContain("deterministic fallback");
  });

  test("uses deterministic templates when the adapter reports no output", async () => {
    const workdir = await tempRoot();
    const adapter = new FakeAdapter(async () => {
      return { detail: "no file written", ok: false, reason: "no-output" };
    });

    const result = await analyzeAction(sampleInput("adapter-no-output-action"), {
      adapter,
      db: new MemoryAnalysisStore(),
      timeoutMs: 1_000,
      workdir
    });

    expect(result.source).toBe("template");
    expect(result.harness).toBe("fake");
  });

  test("enforces the analyzeAction deadline even when a fake adapter never resolves", async () => {
    const workdir = await tempRoot();
    const adapter = new FakeAdapter(() => new Promise<HarnessResponse>(() => undefined));
    const startedAt = Date.now();

    const result = await analyzeAction(sampleInput("timeout-action"), {
      adapter,
      db: new MemoryAnalysisStore(),
      timeoutMs: 10,
      workdir
    });

    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(result.source).toBe("template");
    expect(result.harness).toBe("fake");
    expect(adapter.runs).toBe(1);
  });

  test("skips the adapter when the action is not harness eligible", async () => {
    const adapter = new FakeAdapter(() => {
      throw new Error("adapter should not run");
    });

    const result = await analyzeAction(
      { ...sampleInput("ineligible-action"), harness: { eligible: false, reason: "no subscribers" } },
      { adapter, db: new MemoryAnalysisStore() }
    );

    expect(result.source).toBe("template");
    expect(result.harness).toBe("template");
    expect(adapter.runs).toBe(0);
  });
});

class MemoryAnalysisStore implements AnalysisStore {
  gets = 0;
  puts = 0;
  readonly rows = new Map<string, AnalysisResult>();

  async get(input: AnalyzeActionInput): Promise<AnalysisResult | undefined> {
    this.gets += 1;
    return this.rows.get(input.action.id);
  }

  async put(draft: AnalysisDraft): Promise<AnalysisResult> {
    this.puts += 1;
    const existing = this.rows.get(draft.actionId);
    const now = new Date();
    const row = {
      ...draft,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    this.rows.set(draft.actionId, row);
    return row;
  }
}

class FakeAdapter implements HarnessAdapter {
  readonly harness = "fake";
  runs = 0;

  constructor(private readonly handler: (req: HarnessRequest) => Promise<HarnessResponse>) {}

  async run(req: HarnessRequest): Promise<HarnessResponse> {
    this.runs += 1;
    return this.handler(req);
  }
}

async function tempRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "sentinel-analysis-test-"));
  tempRoots.push(path);
  return path;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sampleInput(
  id = "11111111-1111-4111-8111-111111111111",
  actionHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
): AnalyzeActionInput {
  return {
    action: {
      actionHash,
      boardroom: "0x1111111111111111111111111111111111111111",
      chainId: 31337,
      decodeStatus: "decoded",
      eta: new Date("2026-07-10T00:00:00.000Z"),
      executor: "0x2222222222222222222222222222222222222222",
      id,
      queueBlock: 123n,
      queueTxHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      rawCalldata: "0x12345678",
      salt: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      status: "queued"
    },
    boardroom: {
      address: "0x1111111111111111111111111111111111111111",
      chainId: 31337,
      executor: "0x2222222222222222222222222222222222222222",
      governanceDelay: 86_400n,
      launched: true,
      name: "Test Boardroom",
      owner: "0x3333333333333333333333333333333333333333",
      shareToken: "0x4444444444444444444444444444444444444444",
      status: "active"
    },
    calls: [
      {
        actionId: id,
        callIndex: 0,
        data: "0xabcdef01",
        decodedArgs: { executor: "0x5555555555555555555555555555555555555555" },
        decodedFunction: "setExecutor",
        policy: "0x0000000000000000000000000000000000000000",
        selector: "0xabcdef01",
        target: "0x1111111111111111111111111111111111111111",
        value: "0"
      }
    ],
    risk: {
      actionId: id,
      evaluatedAt: new Date("2026-07-09T00:00:00.000Z"),
      findings: [
        {
          callIndex: 0,
          detail: "Changes the executor address.",
          ruleId: "executor-change",
          severity: "high"
        }
      ],
      rulesetVersion: 7,
      severity: "high"
    }
  };
}
