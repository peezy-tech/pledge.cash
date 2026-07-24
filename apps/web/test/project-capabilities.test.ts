import { describe, expect, test } from "bun:test";
import type { Address } from "@pledge.cash/sdk";
import {
  capabilityAllowsAction,
  capabilityNeedsWalletAction,
  resolveProjectCapabilities,
  type ProjectCapabilityContext,
} from "../src/features/capabilities/project-capabilities";

const owner = "0x1000000000000000000000000000000000000000" as Address;
const proposer = "0x2000000000000000000000000000000000000000" as Address;
const holder = "0x3000000000000000000000000000000000000000" as Address;

function context(overrides: Partial<ProjectCapabilityContext> = {}): ProjectCapabilityContext {
  return {
    account: owner,
    routeChainId: 31337,
    walletChainId: 31337,
    project: {
      owner,
      proposer,
      launched: false,
      status: "active",
      launchReady: true,
      windDownBlockers: 0,
    },
    ...overrides,
  };
}

describe("project capability resolver", () => {
  test("turns an available public opportunity into connect, switch, or enabled states", () => {
    const opportunity = {
      "participate.dutchAuction.buy": { available: true },
      "participate.fixedSale.buy": { available: true },
    } as const;

    const anonymous = resolveProjectCapabilities(context({ account: undefined, walletChainId: undefined, opportunities: opportunity }));
    expect(anonymous["participate.fixedSale.buy"]).toEqual({ status: "connect", reason: "Connect a wallet to continue." });

    const wrongChain = resolveProjectCapabilities(context({ walletChainId: 1, opportunities: opportunity }));
    expect(wrongChain["participate.fixedSale.buy"].status).toBe("switch");
    expect(wrongChain["participate.fixedSale.buy"].reason).toContain("31337");

    const ready = resolveProjectCapabilities(context({ opportunities: opportunity }));
    expect(capabilityAllowsAction(ready["participate.fixedSale.buy"])).toBe(true);
    expect(capabilityAllowsAction(ready["participate.dutchAuction.buy"])).toBe(true);
    expect(ready["participate.curve.buy"].status).toBe("hidden");
  });

  test("keeps a relevant but unavailable opportunity visible with its reason", () => {
    const capabilities = resolveProjectCapabilities(context({
      opportunities: {
        "participate.curve.buy": { available: false, reason: "The curve has reached its graduation target." },
      },
    }));

    expect(capabilities["participate.curve.buy"]).toEqual({
      status: "blocked",
      reason: "The curve has reached its graduation target.",
    });
  });

  test("does not enable a surfaced opportunity before project state loads", () => {
    const capabilities = resolveProjectCapabilities(context({
      project: undefined,
      opportunities: { "participate.fixedSale.buy": { available: true } },
    }));
    expect(capabilities["participate.fixedSale.buy"]).toEqual({
      status: "blocked",
      reason: "Project state is still loading.",
    });
  });

  test("gives pre-launch operations to the owner and respects launch readiness", () => {
    const ready = resolveProjectCapabilities(context());
    expect(ready["studio.mint"].status).toBe("enabled");
    expect(ready["governance.launch"].status).toBe("enabled");
    expect(ready["governance.schedule"].status).toBe("hidden");

    const blockedLaunch = resolveProjectCapabilities(context({
      project: {
        owner,
        proposer,
        launched: false,
        status: "active",
        launchReady: false,
        launchBlockedReason: "Distribute the minimum circulating supply first.",
      },
    }));
    expect(blockedLaunch["governance.launch"]).toEqual({
      status: "blocked",
      reason: "Distribute the minimum circulating supply first.",
    });
  });

  test("moves post-launch scheduling to the controller proposer", () => {
    const launchedProject = {
      owner,
      proposer,
      launched: true,
      status: "active" as const,
      windDownBlockers: 0,
    };
    const ownerCapabilities = resolveProjectCapabilities(context({ project: launchedProject }));
    expect(ownerCapabilities["studio.createGrant"].status).toBe("blocked");
    expect(ownerCapabilities["studio.createGrant"].reason).toContain("proposer");

    const proposerCapabilities = resolveProjectCapabilities(context({ account: proposer, project: launchedProject }));
    expect(proposerCapabilities["studio.createGrant"].status).toBe("enabled");
    expect(proposerCapabilities["governance.schedule"].status).toBe("enabled");
    expect(proposerCapabilities["governance.launch"].status).toBe("hidden");
  });

  test("separates staker veto authority from permissionless ready execution", () => {
    const project = { owner, proposer, launched: true, status: "active" as const };
    const eligible = resolveProjectCapabilities(context({
      account: holder,
      project,
      wallet: { vetoEligible: true },
      governance: { scheduledOperationCount: 1, readyActionCount: 1 },
    }));
    expect(eligible["governance.veto"].status).toBe("enabled");
    expect(eligible["governance.executeReady"].status).toBe("enabled");

    const ineligible = resolveProjectCapabilities(context({
      account: holder,
      project,
      wallet: { vetoEligible: false },
      governance: { scheduledOperationCount: 1, readyActionCount: 1 },
    }));
    expect(ineligible["governance.veto"].status).toBe("blocked");
    expect(ineligible["governance.executeReady"].status).toBe("enabled");
  });

  test("allows authorized wind-down before obligations are cleaned up", () => {
    const ownerCanStart = resolveProjectCapabilities(context({
      project: { owner, proposer, launched: false, status: "active", windDownBlockers: 2 },
    }));
    expect(ownerCanStart["windDown.start"].status).toBe("enabled");

    const holderCanStart = resolveProjectCapabilities(context({
      account: holder,
      project: { owner, proposer, launched: true, status: "active", windDownBlockers: 0 },
      wallet: { windDownEligible: true },
    }));
    expect(holderCanStart["windDown.start"].status).toBe("enabled");
  });

  test("freezes launched asset registration and exposes bounded Snapshotting progress", () => {
    const ineligibleHolder = resolveProjectCapabilities(context({
      account: holder,
      project: { owner, proposer, launched: true, status: "winding-down", windDownBlockers: 0 },
      wallet: { windDownEligible: false },
    }));

    expect(ineligibleHolder["windDown.registerAsset"].status).toBe("hidden");
    expect(ineligibleHolder["windDown.beginSnapshot"].status).toBe("enabled");
    expect(ineligibleHolder["windDown.openRedemptions"].status).toBe("hidden");

    const anonymous = resolveProjectCapabilities(context({
      account: undefined,
      walletChainId: undefined,
      project: { owner, proposer, launched: true, status: "snapshotting", snapshotComplete: true },
    }));
    expect(anonymous["windDown.openRedemptions"].status).toBe("connect");
  });

  test("allows redemption only with an open window and a nonzero share balance", () => {
    const noShares = resolveProjectCapabilities(context({
      account: holder,
      project: { owner, proposer, launched: true, status: "redemptions-open" },
      wallet: { shareBalance: 0n },
    }));
    expect(noShares["redemption.redeem"].status).toBe("blocked");

    const hasShares = resolveProjectCapabilities(context({
      account: holder,
      project: { owner, proposer, launched: true, status: "redemptions-open" },
      wallet: { shareBalance: 1n },
    }));
    expect(hasShares["redemption.redeem"].status).toBe("enabled");
  });

  test("exposes wallet remediation states to action components", () => {
    const connect = resolveProjectCapabilities(context({ account: undefined, walletChainId: undefined }))["governance.launch"];
    const switchNetwork = resolveProjectCapabilities(context({ walletChainId: 1 }))["governance.launch"];
    expect(capabilityNeedsWalletAction(connect)).toBe(true);
    expect(capabilityNeedsWalletAction(switchNetwork)).toBe(true);
  });
});
