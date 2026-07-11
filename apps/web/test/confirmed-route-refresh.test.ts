import { describe, expect, test } from "bun:test";
import type { Address } from "@pledge.cash/sdk";
import { confirmedRouteRefreshPlan } from "../src/app/confirmed-route-refresh";

const boardroom = "0x1000000000000000000000000000000000000000" as Address;
const otherBoardroom = "0x2000000000000000000000000000000000000000" as Address;
const grant = "0x3000000000000000000000000000000000000000" as Address;

describe("confirmed route refresh plan", () => {
  test("keeps product invalidation across sections of the same canonical project", () => {
    const submission = { kind: "project", chainId: 31337, boardroom, section: "participate" } as const;

    expect(confirmedRouteRefreshPlan(submission, { ...submission, section: "overview" })).toEqual({
      kind: "product",
      boardroom,
      refreshGovernance: false,
    });
    expect(confirmedRouteRefreshPlan(submission, { ...submission, section: "governance" })).toEqual({
      kind: "product",
      boardroom,
      refreshGovernance: true,
    });
    expect(confirmedRouteRefreshPlan(submission, { ...submission, boardroom: otherBoardroom })).toEqual({ kind: "none" });
  });

  test("refreshes only the same canonical grant identity", () => {
    const submission = { kind: "grant", chainId: 31337, grant } as const;

    expect(confirmedRouteRefreshPlan(submission, submission)).toEqual({ kind: "grant", chainId: 31337, grant });
    expect(confirmedRouteRefreshPlan(submission, { ...submission, chainId: 1 })).toEqual({ kind: "none" });
    expect(confirmedRouteRefreshPlan(submission, { kind: "portfolio", chainId: 31337 })).toEqual({ kind: "none" });
  });
});
