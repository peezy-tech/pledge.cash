import { describe, expect, test } from "bun:test";
import type { Address } from "@pledge.cash/sdk";
import {
  appRouteHref,
  primaryDestination,
  projectRouteHref,
  routeFromLocation,
  routeFromPath,
  studioRouteHref,
} from "../src/app/routing";

const boardroom = "0x1000000000000000000000000000000000000000" as Address;
const grant = "0x2000000000000000000000000000000000000000" as Address;

describe("lean application routing", () => {
  test("parses canonical top-level routes", () => {
    expect(routeFromPath("/")).toEqual({ kind: "explore" });
    expect(routeFromLocation("/portfolio", "?chain=31337")).toEqual({ kind: "portfolio", chainId: 31337 });
    expect(routeFromLocation("/studio", "?chain=84532")).toEqual({ kind: "studio", chainId: 84532 });
    expect(routeFromPath("/settings/identity")).toEqual({ kind: "identity" });
    expect(routeFromPath("/tools")).toEqual({ kind: "tools" });
  });

  test("parses only the lean project and studio section sets", () => {
    expect(routeFromPath(`/projects/31337/${boardroom}/swap`)).toEqual({ kind: "project", chainId: 31337, boardroom, section: "swap" });
    expect(routeFromPath(`/projects/31337/${boardroom}/transparency`)).toEqual({ kind: "project", chainId: 31337, boardroom, section: "transparency" });
    expect(routeFromPath(`/studio/31337/${boardroom}/grants`)).toEqual({ kind: "studio-project", chainId: 31337, boardroom, section: "grants" });
    expect(routeFromPath(`/studio/31337/${boardroom}/close`)).toEqual({ kind: "studio-project", chainId: 31337, boardroom, section: "close" });
    expect(routeFromPath(`/projects/31337/${boardroom}/governance`)).toEqual({ kind: "not-found" });
    expect(routeFromPath(`/studio/31337/${boardroom}/distributions`)).toEqual({ kind: "not-found" });
  });

  test("round-trips canonical links under a non-root base path", () => {
    expect(projectRouteHref(31337, boardroom, "overview", "/pledge-cash/")).toBe(`/pledge-cash/projects/31337/${boardroom}/overview`);
    expect(studioRouteHref(31337, boardroom, "liquidity", "/pledge-cash/")).toBe(`/pledge-cash/studio/31337/${boardroom}/liquidity`);
    const grantRoute = { kind: "grant", chainId: 31337, grant } as const;
    expect(appRouteHref(grantRoute, "/pledge-cash/")).toBe(`/pledge-cash/grants/31337/${grant}`);
    expect(routeFromLocation(`/pledge-cash/grants/31337/${grant}`, "", { BASE_URL: "/pledge-cash/" })).toEqual(grantRoute);
  });

  test("maps primary navigation", () => {
    expect(primaryDestination({ kind: "studio-project", chainId: 31337, boardroom, section: "token" })).toBe("studio");
    expect(primaryDestination({ kind: "project", chainId: 31337, boardroom, section: "swap" })).toBe("explore");
  });

  test("rejects malformed chain IDs, addresses, and paths outside the configured base", () => {
    expect(routeFromPath(`/projects/0/${boardroom}`)).toEqual({ kind: "not-found" });
    expect(routeFromPath("/projects/31337/not-an-address")).toEqual({ kind: "not-found" });
    expect(routeFromPath("/elsewhere/explore", { BASE_URL: "/pledge-cash/" })).toEqual({ kind: "not-found" });
  });
});
