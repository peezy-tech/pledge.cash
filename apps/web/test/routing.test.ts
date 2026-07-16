import { describe, expect, test } from "bun:test";
import type { Address } from "@pledge.cash/sdk";
import {
  appRouteHref,
  grantReturnRoute,
  governanceWatchHref,
  primaryDestination,
  projectGrantRoute,
  projectRouteHref,
  routeFromLocation,
  routeFromPath,
  studioRouteHref,
  viewFromPath,
} from "../src/app/routing";

const boardroom = "0xAbCd00000000000000000000000000000000aBcD" as Address;
const normalizedBoardroom = boardroom.toLowerCase() as Address;

describe("canonical application routing", () => {
  test("parses canonical primary and exact project routes", () => {
    expect(routeFromPath("/explore")).toEqual({ kind: "explore" });
    expect(routeFromPath("/portfolio")).toEqual({ kind: "portfolio" });
    expect(routeFromPath("/studio")).toEqual({ kind: "studio" });
    expect(routeFromPath(`/projects/31337/${boardroom}/governance`)).toEqual({
      kind: "project",
      chainId: 31337,
      boardroom: normalizedBoardroom,
      section: "governance",
    });
    expect(routeFromPath(`/studio/31337/${boardroom}/liquidity`)).toEqual({
      kind: "studio-project",
      chainId: 31337,
      boardroom: normalizedBoardroom,
      section: "liquidity",
    });
  });

  test("defaults only valid exact routes to their first section", () => {
    expect(routeFromPath(`/projects/31337/${boardroom}`)).toMatchObject({ kind: "project", section: "overview" });
    expect(routeFromPath(`/studio/31337/${boardroom}`)).toMatchObject({ kind: "studio-project", section: "setup" });
  });

  test("handles a deployed base path without accepting paths outside it", () => {
    const env = { BASE_URL: "/pledge-cash/" };
    expect(routeFromPath(`/pledge-cash/projects/31337/${boardroom}/overview`, env)).toMatchObject({
      kind: "project",
      boardroom: normalizedBoardroom,
    });
    expect(routeFromPath(`/projects/31337/${boardroom}/overview`, env)).toEqual({ kind: "not-found" });
  });

  test("rejects malformed identities and unknown nested sections", () => {
    expect(routeFromPath(`/projects/not-a-chain/${boardroom}/overview`)).toEqual({ kind: "not-found" });
    expect(routeFromPath("/projects/31337/not-an-address/overview")).toEqual({ kind: "not-found" });
    expect(routeFromPath(`/projects/31337/${boardroom}/settings`)).toEqual({ kind: "not-found" });
    expect(routeFromPath("/explore/extra")).toEqual({ kind: "not-found" });
  });

  test("maps legacy aliases without losing their intended project job", () => {
    expect(routeFromPath("/market")).toEqual({ kind: "legacy-project", section: "participate", surface: "project" });
    expect(routeFromPath("/activity")).toEqual({ kind: "legacy-project", section: "transparency", surface: "project" });
    expect(routeFromPath("/manage")).toEqual({ kind: "legacy-project", section: "setup", surface: "studio" });
    expect(routeFromPath("/wallet")).toEqual({ kind: "portfolio" });
    expect(routeFromPath("/advanced")).toEqual({ kind: "tools" });
  });

  test("always classifies alert aliases independently of Sentinel configuration", () => {
    expect(routeFromPath("/settings/alerts", {})).toEqual({ kind: "alerts" });
    expect(routeFromPath("/notifications", {})).toEqual({ kind: "alerts" });
    expect(routeFromPath("/sentinel", {})).toEqual({ kind: "alerts" });
    expect(routeFromPath("/settings/alerts", { VITE_SENTINEL_API_URL: "https://alerts.example.test" })).toEqual({ kind: "alerts" });
    expect(routeFromPath("/notifications/history", {})).toEqual({ kind: "not-found" });
  });

  test("builds stable canonical hrefs and preserves compatibility views", () => {
    expect(projectRouteHref(31337, boardroom, "transparency", "/pledge-cash/")).toBe(
      `/pledge-cash/projects/31337/${normalizedBoardroom}/transparency`,
    );
    expect(studioRouteHref(31337, boardroom, "grants", "/")).toBe(`/studio/31337/${normalizedBoardroom}/grants`);
    expect(appRouteHref({ kind: "portfolio", chainId: 31337 }, "/pledge-cash/")).toBe("/pledge-cash/portfolio?chain=31337");
    expect(viewFromPath(`/projects/31337/${boardroom}/participate`)).toBe("market");
    expect(viewFromPath(`/projects/31337/${boardroom}/transparency`)).toBe("activity");
  });

  test("round-trips the selected chain on primary routes", () => {
    const route = routeFromLocation("/explore", "?chain=31337");
    expect(route).toEqual({ kind: "explore", chainId: 31337 });
    expect(appRouteHref(route as Extract<typeof route, { kind: "explore" }>)).toBe("/explore?chain=31337");
    expect(routeFromLocation("/portfolio", "?chain=01")).toEqual({ kind: "portfolio" });
    expect(routeFromLocation(`/projects/31337/${boardroom}/overview`, "?chain=998")).toMatchObject({
      kind: "project",
      chainId: 31337,
    });
  });

  test("round-trips only a valid project return context on grant routes", () => {
    const grant = "0x6000000000000000000000000000000000000000" as Address;
    const route = projectGrantRoute(31337, grant, boardroom);
    const href = appRouteHref(route, "/pledge-cash/");
    expect(href).toBe(`/pledge-cash/grants/31337/${grant}?project=${normalizedBoardroom}`);
    expect(routeFromLocation(
      `/pledge-cash/grants/31337/${grant}`,
      `?project=${boardroom}`,
      { BASE_URL: "/pledge-cash/" },
    )).toEqual({ ...route, returnBoardroom: normalizedBoardroom });
    expect(grantReturnRoute(route)).toEqual({
      kind: "project",
      chainId: 31337,
      boardroom,
      section: "overview",
    });

    const withoutContext = routeFromLocation(
      `/pledge-cash/grants/31337/${grant}`,
      "?project=//evil.example/path",
      { BASE_URL: "/pledge-cash/" },
    );
    expect(withoutContext).toEqual({ kind: "grant", chainId: 31337, grant });
    expect(grantReturnRoute(withoutContext as Extract<typeof withoutContext, { kind: "grant" }>)).toEqual({
      kind: "portfolio",
      chainId: 31337,
    });
  });

  test("derives the three-destination product navigation state", () => {
    expect(primaryDestination({ kind: "project", chainId: 31337, boardroom, section: "overview" })).toBe("explore");
    expect(primaryDestination({ kind: "grant", chainId: 31337, grant: boardroom })).toBe("portfolio");
    expect(primaryDestination({ kind: "studio-project", chainId: 31337, boardroom, section: "setup" })).toBe("studio");
    expect(primaryDestination({ kind: "tools" })).toBeUndefined();
  });

  test("builds a chain-bound governance watch handoff with a safe return route", () => {
    const boardroom = "0x1000000000000000000000000000000000000000";
    const href = governanceWatchHref(31337, boardroom, `/projects/31337/${boardroom}/governance`, "/pledge-cash/");
    const url = new URL(href, "https://example.test");
    expect(url.pathname).toBe("/pledge-cash/settings/alerts");
    expect(url.searchParams.get("chain")).toBe("31337");
    expect(url.searchParams.get("boardroom")).toBe(boardroom);
    expect(url.searchParams.get("return")).toBe(`/projects/31337/${boardroom}/governance`);
  });
});
