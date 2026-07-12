import type { Address } from "@pledge.cash/sdk";
import { isAddress } from "viem";
import { getSentinelBaseUrl, type SentinelEnv } from "../lib/sentinel";

export type AppView = "project" | "market" | "wallet" | "grants" | "manage" | "activity" | "notifications" | "advanced";

export type PrimaryDestination = "explore" | "portfolio" | "studio";
export type ProjectSection = "overview" | "participate" | "governance" | "transparency";
export type StudioSection = "setup" | "token" | "grants" | "distributions" | "liquidity" | "governance" | "close";
export type LegacyProjectSection = ProjectSection | StudioSection;

export type CanonicalAppRoute =
  | { kind: "explore"; chainId?: number | undefined }
  | { kind: "portfolio"; chainId?: number | undefined }
  | { kind: "studio"; chainId?: number | undefined }
  | { kind: "project"; chainId: number; boardroom: Address; section: ProjectSection }
  | { kind: "studio-project"; chainId: number; boardroom: Address; section: StudioSection }
  | { kind: "grant"; chainId: number; grant: Address; returnBoardroom?: Address | undefined }
  | { kind: "alerts" }
  | { kind: "tools" };

export type AppRoute =
  | CanonicalAppRoute
  | { kind: "legacy-project"; section: LegacyProjectSection; surface: "project" | "studio" }
  | { kind: "not-found" };

export type RouteEnvironment = SentinelEnv & { BASE_URL?: string | undefined };

const DEFAULT_VIEW: AppView = "project";
const PROJECT_SECTIONS = new Set<ProjectSection>(["overview", "participate", "governance", "transparency"]);
const STUDIO_SECTIONS = new Set<StudioSection>([
  "setup",
  "token",
  "grants",
  "distributions",
  "liquidity",
  "governance",
  "close",
]);

const VIEW_BY_PROJECT_SECTION: Record<ProjectSection, AppView> = {
  governance: "activity",
  overview: "project",
  participate: "market",
  transparency: "activity",
};

const LEGACY_ROUTE_BY_SEGMENT: Record<string, AppRoute> = {
  activity: { kind: "legacy-project", section: "transparency", surface: "project" },
  advanced: { kind: "tools" },
  boardroom: { kind: "legacy-project", section: "overview", surface: "project" },
  "boardroom-tools": { kind: "legacy-project", section: "setup", surface: "studio" },
  direct: { kind: "tools" },
  discovery: { kind: "tools" },
  grant: { kind: "portfolio" },
  grants: { kind: "portfolio" },
  manage: { kind: "legacy-project", section: "setup", surface: "studio" },
  market: { kind: "legacy-project", section: "participate", surface: "project" },
  positions: { kind: "portfolio" },
  project: { kind: "legacy-project", section: "overview", surface: "project" },
  swap: { kind: "legacy-project", section: "participate", surface: "project" },
  tools: { kind: "tools" },
  wallet: { kind: "portfolio" },
};

const PATH_BY_VIEW: Record<AppView, string> = {
  activity: "activity",
  advanced: "tools",
  grants: "grants",
  manage: "manage",
  market: "market",
  notifications: "notifications",
  project: "project",
  wallet: "portfolio",
};

export function initialRoute(env: RouteEnvironment = import.meta.env): AppRoute {
  if (typeof window === "undefined") return { kind: "explore" };
  return routeFromLocation(window.location.pathname, window.location.search, env);
}

export function routeFromLocation(
  pathname: string,
  search = "",
  env: RouteEnvironment = import.meta.env,
): AppRoute {
  const route = routeFromPath(pathname, env);
  if (route.kind === "grant") {
    const returnBoardroom = routeGrantReturnBoardroom(search);
    return returnBoardroom ? { ...route, returnBoardroom } : route;
  }
  if (!isPrimaryRoute(route)) return route;
  const chainId = routeChainFromSearch(search);
  return chainId === undefined ? route : { ...route, chainId };
}

export function routeFromPath(pathname: string, env: RouteEnvironment = import.meta.env): AppRoute {
  const segments = routeSegments(pathname, env.BASE_URL);
  if (!segments) return { kind: "not-found" };
  if (segments.length === 0) return { kind: "explore" };

  const [first, ...rest] = segments;
  if (!first) return { kind: "explore" };

  if (first === "explore" && rest.length === 0) return { kind: "explore" };
  if (first === "portfolio" && rest.length === 0) return { kind: "portfolio" };
  if (first === "studio") return studioRoute(rest);
  if (first === "projects") return projectRoute(rest);
  if (first === "settings" && rest.length === 1 && rest[0] === "alerts") {
    return getSentinelBaseUrl(env) ? { kind: "alerts" } : { kind: "explore" };
  }
  if (first === "notifications" || first === "sentinel") {
    return rest.length === 0 && getSentinelBaseUrl(env) ? { kind: "alerts" } : { kind: "explore" };
  }
  if (first === "grants" && rest.length === 2) return grantRoute(rest);
  if (rest.length > 0) return { kind: "not-found" };

  return LEGACY_ROUTE_BY_SEGMENT[first] ?? { kind: "not-found" };
}

export function appRouteHref(route: CanonicalAppRoute, baseUrl = import.meta.env.BASE_URL || "/"): string {
  const base = normalizeBaseUrl(baseUrl);
  const path = routePath(route);
  const search = route.kind === "grant" && route.returnBoardroom
    ? `?project=${route.returnBoardroom.toLowerCase()}`
    : "chainId" in route && route.chainId !== undefined && isPrimaryRoute(route)
      ? `?chain=${route.chainId.toString()}`
      : "";
  return `${base}${path}${search}`;
}

export function projectGrantRoute(
  chainId: number,
  grant: Address,
  returnBoardroom: Address,
): Extract<CanonicalAppRoute, { kind: "grant" }> {
  return { kind: "grant", chainId, grant, returnBoardroom };
}

export function grantReturnRoute(
  route: Extract<AppRoute, { kind: "grant" }>,
): Extract<CanonicalAppRoute, { kind: "portfolio" | "project" }> {
  return route.returnBoardroom
    ? { kind: "project", chainId: route.chainId, boardroom: route.returnBoardroom, section: "overview" }
    : { kind: "portfolio", chainId: route.chainId };
}

export function projectRouteHref(
  chainId: number,
  boardroom: Address,
  section: ProjectSection = "overview",
  baseUrl = import.meta.env.BASE_URL || "/",
): string {
  return appRouteHref({ kind: "project", chainId, boardroom, section }, baseUrl);
}

export function studioRouteHref(
  chainId: number,
  boardroom: Address,
  section: StudioSection = "setup",
  baseUrl = import.meta.env.BASE_URL || "/",
): string {
  return appRouteHref({ kind: "studio-project", chainId, boardroom, section }, baseUrl);
}

export function governanceWatchHref(
  chainId: number,
  boardroom: Address,
  returnHref: string,
  baseUrl = import.meta.env.BASE_URL || "/",
): string {
  const href = appRouteHref({ kind: "alerts" }, baseUrl);
  const query = new URLSearchParams({
    boardroom: boardroom.toLowerCase(),
    chain: chainId.toString(),
    return: returnHref,
  });
  return `${href}?${query.toString()}`;
}

export function primaryDestination(route: AppRoute): PrimaryDestination | undefined {
  switch (route.kind) {
    case "explore":
    case "project":
    case "legacy-project":
      return route.kind === "legacy-project" && route.surface === "studio" ? "studio" : "explore";
    case "portfolio":
    case "grant":
      return "portfolio";
    case "studio":
    case "studio-project":
      return "studio";
    default:
      return undefined;
  }
}

export function initialView(): AppView {
  if (typeof window === "undefined") return DEFAULT_VIEW;
  return viewFromPath(window.location.pathname);
}

/** Compatibility adapter for the legacy workspace coordinator. */
export function viewFromPath(pathname: string, env: SentinelEnv = import.meta.env): AppView {
  const route = routeFromPath(pathname, env);
  switch (route.kind) {
    case "portfolio":
    case "grant":
      return "wallet";
    case "studio":
    case "studio-project":
      return "manage";
    case "project":
      return VIEW_BY_PROJECT_SECTION[route.section];
    case "legacy-project":
      if (route.surface === "studio") return "manage";
      return PROJECT_SECTIONS.has(route.section as ProjectSection)
        ? VIEW_BY_PROJECT_SECTION[route.section as ProjectSection]
        : "project";
    case "alerts":
      return "notifications";
    case "tools":
      return "advanced";
    case "explore":
    case "not-found":
      return DEFAULT_VIEW;
  }
}

/** Compatibility adapter for the legacy workspace coordinator. */
export function viewHref(view: AppView): string {
  const base = normalizeBaseUrl(import.meta.env.BASE_URL || "/");
  const search = typeof window === "undefined" ? "" : window.location.search;
  return `${base}${PATH_BY_VIEW[view]}${search}`;
}

export function viewUsesProjectDashboard(view: AppView): boolean {
  return view === "project" || view === "manage" || view === "activity";
}

function projectRoute(segments: string[]): AppRoute {
  if (segments.length !== 2 && segments.length !== 3) return { kind: "not-found" };
  const identity = routeIdentity(segments[0], segments[1]);
  if (!identity) return { kind: "not-found" };
  const section = segments[2] ?? "overview";
  if (!PROJECT_SECTIONS.has(section as ProjectSection)) return { kind: "not-found" };
  return { kind: "project", ...identity, section: section as ProjectSection };
}

function studioRoute(segments: string[]): AppRoute {
  if (segments.length === 0) return { kind: "studio" };
  if (segments.length !== 2 && segments.length !== 3) return { kind: "not-found" };
  const identity = routeIdentity(segments[0], segments[1]);
  if (!identity) return { kind: "not-found" };
  const section = segments[2] ?? "setup";
  if (!STUDIO_SECTIONS.has(section as StudioSection)) return { kind: "not-found" };
  return { kind: "studio-project", ...identity, section: section as StudioSection };
}

function grantRoute(segments: string[]): AppRoute {
  const chainId = routeChainId(segments[0]);
  const grant = routeAddress(segments[1]);
  return chainId && grant ? { kind: "grant", chainId, grant } : { kind: "not-found" };
}

function routeIdentity(
  chainSegment: string | undefined,
  addressSegment: string | undefined,
): { chainId: number; boardroom: Address } | undefined {
  const chainId = routeChainId(chainSegment);
  const boardroom = routeAddress(addressSegment);
  return chainId && boardroom ? { chainId, boardroom } : undefined;
}

function routeChainId(value: string | undefined): number | undefined {
  if (!value || !/^[1-9]\d*$/.test(value)) return undefined;
  const chainId = Number(value);
  return Number.isSafeInteger(chainId) ? chainId : undefined;
}

function routeChainFromSearch(search: string): number | undefined {
  try {
    return routeChainId(new URLSearchParams(search).get("chain") ?? undefined);
  } catch {
    return undefined;
  }
}

function routeGrantReturnBoardroom(search: string): Address | undefined {
  try {
    return routeAddress(new URLSearchParams(search).get("project") ?? undefined);
  } catch {
    return undefined;
  }
}

function routeAddress(value: string | undefined): Address | undefined {
  if (!value || !isAddress(value, { strict: false })) return undefined;
  return value.toLowerCase() as Address;
}

function routeSegments(pathname: string, baseUrl = "/"): string[] | undefined {
  const base = normalizeBaseUrl(baseUrl);
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  let relative: string;
  if (base !== "/" && normalizedPath === base.slice(0, -1)) {
    relative = "";
  } else if (normalizedPath.startsWith(base)) {
    relative = normalizedPath.slice(base.length);
  } else if (base !== "/") {
    return undefined;
  } else {
    relative = normalizedPath.slice(1);
  }

  try {
    return relative.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
  } catch {
    return undefined;
  }
}

function routePath(route: CanonicalAppRoute): string {
  switch (route.kind) {
    case "explore":
      return "explore";
    case "portfolio":
      return "portfolio";
    case "studio":
      return "studio";
    case "project":
      return `projects/${route.chainId.toString()}/${route.boardroom.toLowerCase()}/${route.section}`;
    case "studio-project":
      return `studio/${route.chainId.toString()}/${route.boardroom.toLowerCase()}/${route.section}`;
    case "grant":
      return `grants/${route.chainId.toString()}/${route.grant.toLowerCase()}`;
    case "alerts":
      return "settings/alerts";
    case "tools":
      return "tools";
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  const withLeadingSlash = baseUrl.startsWith("/") ? baseUrl : `/${baseUrl}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

function isPrimaryRoute(route: AppRoute): route is Extract<CanonicalAppRoute, { kind: PrimaryDestination }> {
  return route.kind === "explore" || route.kind === "portfolio" || route.kind === "studio";
}
