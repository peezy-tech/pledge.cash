import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
      expect(existsSync(join(req.workspaceDir, "docs", "distribution-protocol.md"))).toBe(true);
      expect(existsSync(join(req.workspaceDir, "docs", "amm-protocol.md"))).toBe(true);
      expect(existsSync(join(req.workspaceDir, "docs", "abi-excerpts.json"))).toBe(true);

      const abiExcerpts = JSON.parse(
        await readFile(join(req.workspaceDir, "docs", "abi-excerpts.json"), "utf8")
      ) as Record<string, Array<{ name?: string }>>;
      expect(abiExcerpts.BoardroomPolicyRegistry?.map((item) => item.name)).toEqual(
        expect.arrayContaining(["ModulePolicyRegistered", "isModulePolicy", "registerModulePolicy"])
      );
      expect(abiExcerpts.Boardroom?.map((item) => item.name)).toEqual(
        expect.arrayContaining([
          "BoardroomOperationVetoed",
          "BoardroomSnapshottingStarted",
          "claimRedemptionAsset",
          "executeGovernance"
        ])
      );
      expect(abiExcerpts.BoardroomController?.map((item) => item.name)).toEqual(
        expect.arrayContaining([
          "BoardroomOperationScheduled",
          "ControllerOperationScheduled",
          "updateConfiguration"
        ])
      );
      expect(abiExcerpts.AssetPolicy?.map((item) => item.name)).toEqual(
        expect.arrayContaining(["canCall", "setApprovalSpenderAllowed", "setAssetAllowed"])
      );
      expect(abiExcerpts.DistributionFactory?.map((item) => item.name)).toEqual(
        expect.arrayContaining([
          "createDutchAuction",
          "createFixedPriceSale",
          "createMerkleAirdrop",
          "createMigratingBondingCurve",
          "isDistribution"
        ])
      );
      expect(abiExcerpts.DutchAuctionSale?.map((item) => item.name)).toEqual(
        expect.arrayContaining(["DutchAuctionPurchase", "buy", "cancel", "close", "finalize"])
      );
      expect(abiExcerpts.TokenGrantFactory?.map((item) => item.name)).toEqual(
        expect.arrayContaining(["createGrant", "createGrantFromDistribution", "setCreationFee"])
      );
      expect(abiExcerpts.LockedLiquidityFactory?.map((item) => item.name)).toEqual(
        expect.arrayContaining([
          "ProtocolLiquidityCreated",
          "MigrationReserved",
          "createLockedLiquidity",
          "addLockedLiquidity",
          "removeLockedLiquidity",
          "closeLockedLiquidity"
        ])
      );
      expect(abiExcerpts.LockedLiquidity?.map((item) => item.name)).toEqual(
        expect.arrayContaining(["claimFees", "FeesForwarded", "LiquidityReturnedAsLp"])
      );
      expect(abiExcerpts.MigratingBondingCurve?.map((item) => item.name)).toEqual(
        expect.arrayContaining([
          "migrate",
          "cancel",
          "CurveGraduationLatched",
          "CurveMigrated",
          "expire",
          "fallbackToUnwind",
          "finalizeUnwind",
          "openQuoteForfeiture",
          "finalizeQuoteForfeiture"
        ])
      );

      await writeFile(
        join(req.workspaceDir, ANALYSIS_FILENAME),
        JSON.stringify({
          affectedParties: ["share holders", "treasury"],
          effects: ["controller would be changed."],
          severityRationale: "The rules already marked this as high because controller control changes.",
          summary: "This changes the Boardroom controller after the veto window."
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
    expect(result.summary).toBe("This changes the Boardroom controller after the veto window.");
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
          effects: ["The operation calls updateConfiguration."],
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

  test("prioritizes scheduled harness work by subscriber count", async () => {
    const store = new MemoryAnalysisStore();
    const workdir = await tempRoot();
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    let markFirstStarted: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstId = "priority-first";
    const adapter = new FakeAdapter(async (req) => {
      const input = JSON.parse(await readFile(join(req.workspaceDir, INPUT_FILENAME), "utf8")) as {
        action: { id: string };
      };
      order.push(input.action.id);
      if (input.action.id === firstId) {
        markFirstStarted?.();
        await firstCanFinish;
      }
      await writeValidAnalysis(req.workspaceDir, `Analysis for ${input.action.id}.`);
      return { harness: "fake", ok: true, outputPath: join(req.workspaceDir, ANALYSIS_FILENAME) };
    });

    const first = analyzeAction(
      { ...sampleInput(firstId, bytes32("1")), harness: { eligible: true, subscriberCount: 1 } },
      { adapter, db: store, timeoutMs: 1_000, workdir }
    );
    await firstStarted;
    const low = analyzeAction(
      { ...sampleInput("priority-low", bytes32("2")), harness: { eligible: true, subscriberCount: 2 } },
      { adapter, db: store, timeoutMs: 1_000, workdir }
    );
    const high = analyzeAction(
      { ...sampleInput("priority-high", bytes32("3")), harness: { eligible: true, subscriberCount: 10 } },
      { adapter, db: store, timeoutMs: 1_000, workdir }
    );

    releaseFirst?.();
    await Promise.all([first, low, high]);

    expect(order).toEqual([firstId, "priority-high", "priority-low"]);
  });

  test("uses deterministic templates when no adapter is configured", async () => {
    const result = await analyzeAction(sampleInput(), { db: new MemoryAnalysisStore() });

    expect(result.source).toBe("template");
    expect(result.harness).toBe("template");
    expect(result.summary).toContain("HIGH severity governance operation scheduled");
    expect(result.severityRationale).toContain("ruleset 7");
    expect(result.effects).toContain("Rule controller-configuration (high): Changes the controller address.");
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

  test("reserves harness runs and falls back after the UTC daily limit", async () => {
    const store = new MemoryAnalysisStore();
    const workdir = await tempRoot();
    const now = () => new Date("2026-07-09T12:00:00.000Z");
    const adapter = new FakeAdapter(async (req) => {
      await writeValidAnalysis(req.workspaceDir, "Reserved harness result.");
      return { harness: "fake", ok: true, outputPath: join(req.workspaceDir, ANALYSIS_FILENAME) };
    });

    const first = await analyzeAction(sampleInput("daily-first", bytes32("4")), {
      adapter,
      dailyLimit: 1,
      db: store,
      now,
      workdir
    });
    const second = await analyzeAction(sampleInput("daily-second", bytes32("5")), {
      adapter,
      dailyLimit: 1,
      db: store,
      now,
      workdir
    });

    expect(first.source).toBe("harness");
    expect(second.source).toBe("template");
    expect(second.harness).toBe("template");
    expect(adapter.runs).toBe(1);
  });

  test("propagates persistence failures so watcher delivery can retry", async () => {
    await expect(
      analyzeAction(sampleInput("persistence-failure-action"), { db: new FailingAnalysisStore() })
    ).rejects.toThrow("analysis database unavailable");
  });
});

class MemoryAnalysisStore implements AnalysisStore {
  gets = 0;
  puts = 0;
  readonly harnessRuns = new Map<string, Date>();
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

  async reserveHarnessRun(input: {
    readonly actionId: string;
    readonly dailyLimit: number;
    readonly harness: string;
    readonly now: Date;
  }): Promise<boolean> {
    if (input.dailyLimit <= 0 || this.harnessRuns.has(input.actionId)) return false;
    const dayStart = Date.UTC(
      input.now.getUTCFullYear(),
      input.now.getUTCMonth(),
      input.now.getUTCDate()
    );
    const runsToday = [...this.harnessRuns.values()].filter(
      (startedAt) => startedAt.getTime() >= dayStart
    ).length;
    if (runsToday >= input.dailyLimit) return false;
    this.harnessRuns.set(input.actionId, input.now);
    return true;
  }
}

class FailingAnalysisStore extends MemoryAnalysisStore {
  override async put(_draft: AnalysisDraft): Promise<AnalysisResult> {
    this.puts += 1;
    throw new Error("analysis database unavailable");
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

async function writeValidAnalysis(workspaceDir: string, summary: string): Promise<void> {
  await writeFile(
    join(workspaceDir, ANALYSIS_FILENAME),
    JSON.stringify({
      affectedParties: ["share holders"],
      effects: ["The governance action may execute."],
      severityRationale: "Rules engine severity is high.",
      summary
    })
  );
}

function bytes32(value: string): string {
  return `0x${value.padStart(64, "0")}`;
}

function sampleInput(
  id = "11111111-1111-4111-8111-111111111111",
  operationId = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
): AnalyzeActionInput {
  return {
    action: {
      operationId,
      boardroom: "0x1111111111111111111111111111111111111111",
      boardroomEpoch: 2n,
      chainId: 31337,
      configurationEpoch: 1n,
      controller: "0x2222222222222222222222222222222222222222",
      controllerGeneration: 1n,
      decodeStatus: "decoded",
      eta: new Date("2026-07-10T00:00:00.000Z"),
      id,
      operationKind: "controller",
      proposer: "0x3333333333333333333333333333333333333333",
      scheduleBlock: 123n,
      scheduleTxHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      rawCalldata: "0x12345678",
      salt: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      status: "scheduled"
    },
    boardroom: {
      address: "0x1111111111111111111111111111111111111111",
      chainId: 31337,
      configurationEpoch: 1n,
      controller: "0x2222222222222222222222222222222222222222",
      controllerGeneration: 1n,
      controllerDelay: 86_400n,
      gracePeriod: 604_800n,
      launched: true,
      name: "Test Boardroom",
      owner: "0x3333333333333333333333333333333333333333",
      proposer: "0x3333333333333333333333333333333333333333",
      shareToken: "0x4444444444444444444444444444444444444444",
      status: "active",
      windDownDelay: 86_400n
    },
    calls: [
      {
        actionId: id,
        callIndex: 0,
        data: "0xabcdef01",
        decodedArgs: { controller: "0x5555555555555555555555555555555555555555" },
        decodedFunction: "updateConfiguration",
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
          detail: "Changes the controller address.",
          ruleId: "controller-configuration",
          severity: "high"
        }
      ],
      rulesetVersion: 7,
      severity: "high"
    }
  };
}
