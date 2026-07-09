export type AppView = "project" | "market" | "wallet" | "grants" | "manage" | "activity" | "advanced";

const DEFAULT_VIEW: AppView = "project";

const VIEW_BY_ROUTE_SEGMENT: Record<string, AppView> = {
  advanced: "advanced",
  activity: "activity",
  boardroom: "project",
  "boardroom-tools": "manage",
  direct: "advanced",
  discovery: "advanced",
  grant: "grants",
  grants: "grants",
  manage: "manage",
  market: "market",
  portfolio: "wallet",
  positions: "wallet",
  project: "project",
  swap: "market",
  tools: "advanced",
  wallet: "wallet",
};

const PATH_BY_VIEW: Record<AppView, string> = {
  activity: "activity",
  advanced: "tools",
  grants: "grants",
  manage: "manage",
  market: "market",
  project: "project",
  wallet: "wallet",
};

export function initialView(): AppView {
  if (typeof window === "undefined") return DEFAULT_VIEW;
  return viewFromPath(window.location.pathname);
}

export function viewFromPath(pathname: string): AppView {
  return VIEW_BY_ROUTE_SEGMENT[firstRouteSegment(pathname)] ?? DEFAULT_VIEW;
}

export function viewHref(view: AppView): string {
  const base = import.meta.env.BASE_URL || "/";
  const search = typeof window === "undefined" ? "" : window.location.search;
  return `${base}${PATH_BY_VIEW[view]}${search}`;
}

export function viewUsesProjectDashboard(view: AppView): boolean {
  return view === "project" || view === "manage" || view === "activity";
}

function firstRouteSegment(pathname: string): string {
  const base = import.meta.env.BASE_URL || "/";
  const relative = pathname.startsWith(base) ? pathname.slice(base.length) : pathname.replace(/^\/+/, "");
  return relative.split("/")[0] || DEFAULT_VIEW;
}
