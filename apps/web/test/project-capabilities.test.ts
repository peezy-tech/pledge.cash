import { describe, expect, test } from "bun:test";
import type { Address } from "@pledge.cash/sdk";
import {
  capabilityAllowsAction,
  capabilityNeedsWalletAction,
  resolveProjectCapabilities,
  type ProjectCapabilityContext,
} from "../src/features/capabilities/project-capabilities";

const owner = "0x1000000000000000000000000000000000000000" as Address;
const holder = "0x2000000000000000000000000000000000000000" as Address;

function context(overrides: Partial<ProjectCapabilityContext> = {}): ProjectCapabilityContext {
  return {
    account: owner,
    routeChainId: 31337,
    walletChainId: 31337,
    project: { owner, status: "active", windDownBlockers: 0 },
    wallet: { shareBalance: 0n },
    ...overrides,
  };
}

describe("lean project capability resolver", () => {
  test("turns public grant and swap opportunities into connect, switch, and enabled states", () => {
    const opportunities = {
      "swap.execute": { available: true },
      "grant.settle": { available: true },
      "grant.halt": { available: false, reason: "Grant is closed." },
    } as const;
    const anonymous = resolveProjectCapabilities(context({ account: undefined, walletChainId: undefined, opportunities }));
    const wrongChain = resolveProjectCapabilities(context({ walletChainId: 1, opportunities }));
    const ready = resolveProjectCapabilities(context({ opportunities }));

    expect(anonymous["swap.execute"].status).toBe("connect");
    expect(wrongChain["grant.settle"].status).toBe("switch");
    expect(ready["swap.execute"].status).toBe("enabled");
    expect(ready["grant.halt"]).toEqual({ status: "blocked", reason: "Grant is closed." });
  });

  test("gives active Boardroom mutation only to the flat owner", () => {
    const ownerCapabilities = resolveProjectCapabilities(context());
    const holderCapabilities = resolveProjectCapabilities(context({ account: holder }));

    expect(ownerCapabilities["studio.mint"].status).toBe("enabled");
    expect(ownerCapabilities["studio.createGrant"].status).toBe("enabled");
    expect(ownerCapabilities["studio.manageLiquidity"].status).toBe("enabled");
    expect(holderCapabilities["studio.mint"]).toEqual({
      status: "blocked",
      reason: "Only the Boardroom owner can perform this action.",
    });
  });

  test("gates wind-down snapshotting on escrows, delay, and cursor completion", () => {
    const blocked = resolveProjectCapabilities(context({
      project: { owner, status: "winding-down", windDownBlockers: 1, windDownMatured: true },
    }));
    const waiting = resolveProjectCapabilities(context({
      project: { owner, status: "winding-down", windDownBlockers: 0, windDownMatured: false },
    }));
    const ready = resolveProjectCapabilities(context({
      project: { owner, status: "winding-down", windDownBlockers: 0, windDownMatured: true },
    }));
    const snapshotting = resolveProjectCapabilities(context({
      project: { owner, status: "snapshotting", snapshotComplete: false },
    }));
    const complete = resolveProjectCapabilities(context({
      project: { owner, status: "snapshotting", snapshotComplete: true },
    }));

    expect(blocked["windDown.beginSnapshot"].reason).toContain("Close every grant and liquidity escrow");
    expect(waiting["windDown.beginSnapshot"].reason).toContain("delay has not elapsed");
    expect(ready["windDown.beginSnapshot"].status).toBe("enabled");
    expect(snapshotting["windDown.processSnapshot"].status).toBe("enabled");
    expect(complete["windDown.openRedemptions"].status).toBe("enabled");
  });

  test("allows redemption only with an open window and nonzero share balance", () => {
    const empty = resolveProjectCapabilities(context({
      project: { owner, status: "redemptions-open" },
      wallet: { shareBalance: 0n },
    }));
    const holderReady = resolveProjectCapabilities(context({
      account: holder,
      project: { owner, status: "redemptions-open" },
      wallet: { shareBalance: 5n },
    }));

    expect(empty["redemption.redeem"].status).toBe("blocked");
    expect(holderReady["redemption.redeem"].status).toBe("enabled");
  });

  test("exposes wallet remediation states to action components", () => {
    const connect = resolveProjectCapabilities(context({ account: undefined, walletChainId: undefined }))["studio.mint"];
    const switchChain = resolveProjectCapabilities(context({ walletChainId: 1 }))["studio.mint"];
    const enabled = resolveProjectCapabilities(context())["studio.mint"];

    expect(capabilityNeedsWalletAction(connect)).toBe(true);
    expect(capabilityNeedsWalletAction(switchChain)).toBe(true);
    expect(capabilityNeedsWalletAction(enabled)).toBe(false);
    expect(capabilityAllowsAction(enabled)).toBe(true);
  });
});
