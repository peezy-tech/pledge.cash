import { describe, expect, test } from "bun:test";
import type { Address } from "@pledge.cash/sdk";
import {
  createProjectEvidenceBundle,
  PROJECT_EVIDENCE_SCHEMA,
  projectEvidenceFilename,
  projectEvidenceJson,
} from "../src/lib/project-evidence";
import type { ProductBoardroomDashboardState } from "../src/lib/product-boardroom";

const BOARDROOM = "0x0000000000000000000000000000000000000010" as Address;
const SHARE = "0x0000000000000000000000000000000000000020" as Address;
const OWNER = "0x0000000000000000000000000000000000000030" as Address;

describe("project evidence export", () => {
  test("preserves exact integer state, coverage, and incomplete-read warnings", () => {
    const bundle = createProjectEvidenceBundle(dashboard(), 31337, "2026-07-12T12:00:00.000Z");
    const json = projectEvidenceJson(bundle);
    const parsed = JSON.parse(json) as Record<string, unknown>;

    expect(bundle.schema).toBe(PROJECT_EVIDENCE_SCHEMA);
    expect(bundle.boardroom).toBe(BOARDROOM);
    expect(bundle.warnings).toEqual([
      "Only the newest grants were read.",
      "History deadline reached.",
      `${SHARE}: metadata unavailable`,
    ]);
    expect(json.endsWith("\n")).toBe(true);
    expect((parsed.currentState as { nativeBalance: string }).nativeBalance).toBe("900719925474099312345");
    expect(json).not.toContain("900719925474099300000");
    expect((parsed.coverage as { grants: { complete: boolean } }).grants.complete).toBe(false);
  });

  test("uses a stable chain-bound filename", () => {
    expect(projectEvidenceFilename({ boardroom: BOARDROOM, chainId: 31337 }))
      .toBe(`pledge-cash-project-31337-${BOARDROOM}.json`);
  });
});

function dashboard(): ProductBoardroomDashboardState {
  return {
    address: BOARDROOM,
    catalog: [],
    nativeBalance: 900719925474099312345n,
    currentStateCoverage: {
      grants: { complete: false, shown: 1, total: 2 },
      distributions: { complete: true, shown: 0, total: 0 },
      lockedLiquidity: { complete: true, shown: 0, total: 0 },
      redeemableAssets: { complete: true, shown: 0, total: 0 },
    },
    historyErrors: ["History deadline reached."],
    treasuryAssets: [{
      address: SHARE,
      label: "Project token",
      balance: 10n,
      totalSupply: 100n,
      error: "metadata unavailable",
    }],
    snapshot: {
      address: BOARDROOM,
      owner: OWNER,
      policyRegistry: OWNER,
      wrappedNative: OWNER,
      shareToken: SHARE,
      status: 0,
      launched: false,
      executor: OWNER,
      governanceDelay: 0n,
      governanceEpoch: 0n,
      governanceEligibleSupply: 0n,
      governanceConfig: {
        minimumDelay: 86_400n,
        actionGracePeriod: 604_800n,
        vetoBps: 2_000n,
        windDownBps: 5_000n,
      },
      redeemableAssets: [],
      issuedGrants: [],
      issuedDistributions: [],
      lockedLiquidityPositions: [],
      grantSummaries: [],
      distributionSummaries: [],
      lockedLiquiditySummaries: [],
      summaryWarnings: ["Only the newest grants were read."],
    },
  };
}
