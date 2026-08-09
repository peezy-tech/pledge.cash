import type { Address } from "@pledge.cash/sdk";
import { isAddress } from "viem";

export type PrimaryDestination = "explore" | "portfolio" | "studio";
export type ProjectSection = "overview" | "swap" | "transparency";
export type StudioSection = "setup" | "token" | "grants" | "liquidity" | "close";

export type CanonicalAppRoute =
  | { kind: "explore"; chainId?: number | undefined }
  | { kind: "portfolio"; chainId?: number | undefined }
  | { kind: "studio"; chainId?: number | undefined }
  | { kind: "project"; chainId: number; boardroom: Address; section: ProjectSection }
  | { kind: "studio-project"; chainId: number; boardroom: Address; section: StudioSection }
  | { kind: "grant"; chainId: number; grant: Address }
  | { kind: "identity" }
  | { kind: "tools" };

export type AppRoute = CanonicalAppRoute | { kind: "not-found" };
export type RouteEnvironment = { readonly BASE_URL?: string | undefined };

const PROJECT_SECTIONS = new Set<ProjectSection>(["overview", "swap", "transparency"]);
const STUDIO_SECTIONS = new Set<StudioSection>(["setup", "token", "grants", "liquidity", "close"]);

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
  if (!isPrimaryRoute(route)) return route;
  const chainId = routeChainFromSearch(search);
  return chainId === undefined ? route : { ...route, chainId };
}

export function routeFromPath(pathname: string, env: RouteEnvironment = import.meta.env): AppRoute {
  const segments = routeSegments(pathname, env.BASE_URL);
  if (!segments) return { kind: "not-found" };
  if (segments.length === 0) return { kind: "explore" };

  const [first, ...rest] = segments;
  if (first === "explore" && rest.length === 0) return { kind: "explore" };
  if (first === "portfolio" && rest.length === 0) return { kind: "portfolio" };
  if (first === "studio") return studioRoute(rest);
  if (first === "projects") return projectRoute(rest);
  if (first === "grants" && rest.length === 2) return grantRoute(rest);
  if (first === "settings" && rest.length === 1 && rest[0] === "identity") return { kind: "identity" };
  if (first === "tools" && rest.length === 0) return { kind: "tools" };
  return { kind: "not-found" };
}

export function appRouteHref(route: CanonicalAppRoute, baseUrl = import.meta.env.BASE_URL || "/"): string {
  const base = normalizeBaseUrl(baseUrl);
  const path = routePath(route);
  const search = "chainId" in route && route.chainId !== undefined && isPrimaryRoute(route)
    ? `?chain=${route.chainId.toString()}`
    : "";
  return `${base}${path}${search}`;
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

export function primaryDestination(route: AppRoute): PrimaryDestination | undefined {
  switch (route.kind) {
    case "explore":
    case "project":
      return "explore";
    case "portfolio":
    case "grant":
      return "portfolio";
    case "studio":
    case "studio-project":
      return "studio";
    case "identity":
    case "tools":
    case "not-found":
      return undefined;
  }
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
    case "identity":
      return "settings/identity";
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
