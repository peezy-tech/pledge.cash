export type AppView = "project" | "market" | "wallet" | "grants" | "manage" | "activity" | "advanced";

export function initialView(): AppView {
  if (typeof window === "undefined") return "project";
  return viewFromPath(window.location.pathname);
}

export function viewFromPath(pathname: string): AppView {
  const base = import.meta.env.BASE_URL || "/";
  const relative = pathname.startsWith(base) ? pathname.slice(base.length) : pathname.replace(/^\/+/, "");
  const segment = relative.split("/")[0] || "project";
  if (segment === "boardroom" || segment === "project") return "project";
  if (segment === "swap" || segment === "market") return "market";
  if (segment === "positions" || segment === "wallet" || segment === "portfolio") return "wallet";
  if (segment === "grant" || segment === "grants") return "grants";
  if (segment === "manage" || segment === "boardroom-tools") return "manage";
  if (segment === "activity") return "activity";
  if (segment === "advanced" || segment === "tools" || segment === "direct" || segment === "discovery") return "advanced";
  return "project";
}

export function viewHref(view: AppView): string {
  const base = import.meta.env.BASE_URL || "/";
  const search = typeof window === "undefined" ? "" : window.location.search;
  const path = view === "project" ? "project" : view === "advanced" ? "tools" : view;
  return `${base}${path}${search}`;
}

export function viewUsesProjectDashboard(view: AppView): boolean {
  return view === "project" || view === "manage" || view === "activity";
}
