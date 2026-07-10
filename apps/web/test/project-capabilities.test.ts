import { describe, expect, test } from "bun:test";
import type { Address } from "@pledge.cash/sdk";
import {
  capabilityAllowsAction,
  capabilityNeedsWalletAction,
  resolveProjectCapabilities,
  type ProjectCapabilityContext,
} from "../src/features/capabilities/project-capabilities";

const owner = "0x1000000000000000000000000000000000000000" as Address;
const executor = "0x2000000000000000000000000000000000000000" as Address;
const holder = "0x3000000000000000000000000000000000000000" as Address;

function context(overrides: Partial<ProjectCapabilityContext> = {}): ProjectCapabilityContext {
  return {
    account: owner,
    routeChainId: 31337,
    walletChainId: 31337,
    project: {
      owner,
      executor,
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
    const opportunity = { "participate.fixedSale.buy": { available: true } } as const;

    const anonymous = resolveProjectCapabilities(context({ account: undefined, walletChainId: undefined, opportunities: opportunity }));
    expect(anonymous["participate.fixedSale.buy"]).toEqual({ status: "connect", reason: "Connect a wallet to continue." });

    const wrongChain = resolveProjectCapabilities(context({ walletChainId: 1, opportunities: opportunity }));
    expect(wrongChain["participate.fixedSale.buy"].status).toBe("switch");
    expect(wrongChain["participate.fixedSale.buy"].reason).toContain("31337");

    const ready = resolveProjectCapabilities(context({ opportunities: opportunity }));
    expect(capabilityAllowsAction(ready["participate.fixedSale.buy"])).toBe(true);
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
    expect(ready["governance.queue"].status).toBe("hidden");

    const blockedLaunch = resolveProjectCapabilities(context({
      project: {
        owner,
        executor,
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

  test("moves post-launch operations to the executor", () => {
    const launchedProject = {
      owner,
      executor,
      launched: true,
      status: "active" as const,
      windDownBlockers: 0,
    };
    const ownerCapabilities = resolveProjectCapabilities(context({ project: launchedProject }));
    expect(ownerCapabilities["studio.createGrant"].status).toBe("blocked");
    expect(ownerCapabilities["studio.createGrant"].reason).toContain("executor");

    const executorCapabilities = resolveProjectCapabilities(context({ account: executor, project: launchedProject }));
    expect(executorCapabilities["studio.createGrant"].status).toBe("enabled");
    expect(executorCapabilities["governance.queue"].status).toBe("enabled");
    expect(executorCapabilities["governance.launch"].status).toBe("hidden");
  });

  test("separates holder veto authority from permissionless ready execution", () => {
    const project = { owner, executor, launched: true, status: "active" as const };
    const eligible = resolveProjectCapabilities(context({
      account: holder,
      project,
      wallet: { vetoEligible: true },
      governance: { queuedActionCount: 1, readyActionCount: 1 },
    }));
    expect(eligible["governance.veto"].status).toBe("enabled");
    expect(eligible["governance.executeReady"].status).toBe("enabled");

    const ineligible = resolveProjectCapabilities(context({
      account: holder,
      project,
      wallet: { vetoEligible: false },
      governance: { queuedActionCount: 1, readyActionCount: 1 },
    }));
    expect(ineligible["governance.veto"].status).toBe("blocked");
    expect(ineligible["governance.executeReady"].status).toBe("enabled");
  });

  test("blocks wind-down until obligations and authority requirements are satisfied", () => {
    const blocked = resolveProjectCapabilities(context({
      project: { owner, executor, launched: false, status: "active", windDownBlockers: 2 },
    }));
    expect(blocked["windDown.start"]).toEqual({
      status: "blocked",
      reason: "Resolve 2 project obligations before wind-down.",
    });

    const holderCanStart = resolveProjectCapabilities(context({
      account: holder,
      project: { owner, executor, launched: true, status: "active", windDownBlockers: 0 },
      wallet: { windDownEligible: true },
    }));
    expect(holderCanStart["windDown.start"].status).toBe("enabled");
  });

  test("allows redemption only with an open window and a nonzero share balance", () => {
    const noShares = resolveProjectCapabilities(context({
      account: holder,
      project: { owner, executor, launched: true, status: "redemptions-open" },
      wallet: { shareBalance: 0n },
    }));
    expect(noShares["redemption.redeem"].status).toBe("blocked");

    const hasShares = resolveProjectCapabilities(context({
      account: holder,
      project: { owner, executor, launched: true, status: "redemptions-open" },
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
