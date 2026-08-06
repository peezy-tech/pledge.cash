import { describe, expect, test } from "bun:test";
import type { Address } from "@pledge.cash/sdk";
import { confirmedRouteRefreshPlan } from "../src/app/confirmed-route-refresh";

const boardroom = "0x1000000000000000000000000000000000000000" as Address;
const grant = "0x2000000000000000000000000000000000000000" as Address;

describe("confirmed route refresh plan", () => {
  test("keeps Boardroom invalidation across project and studio sections", () => {
    const submission = { kind: "project", chainId: 31337, boardroom, section: "swap" } as const;
    expect(confirmedRouteRefreshPlan(submission, {
      kind: "studio-project",
      chainId: 31337,
      boardroom,
      section: "liquidity",
    })).toEqual({ kind: "boardroom", chainId: 31337, boardroom });
  });

  test("does not refresh a different Boardroom or chain", () => {
    const submission = { kind: "project", chainId: 31337, boardroom, section: "overview" } as const;
    expect(confirmedRouteRefreshPlan(submission, { ...submission, chainId: 1 })).toEqual({ kind: "none" });
    expect(confirmedRouteRefreshPlan(submission, { kind: "portfolio", chainId: 31337 })).toEqual({ kind: "none" });
  });

  test("refreshes only the same canonical grant identity", () => {
    const submission = { kind: "grant", chainId: 31337, grant } as const;
    expect(confirmedRouteRefreshPlan(submission, { ...submission })).toEqual({ kind: "grant", chainId: 31337, grant });
    expect(confirmedRouteRefreshPlan(submission, { ...submission, chainId: 1 })).toEqual({ kind: "none" });
  });
});
