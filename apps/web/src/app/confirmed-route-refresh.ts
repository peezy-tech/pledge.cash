import type { Address } from "@pledge.cash/sdk";
import type { AppRoute } from "./routing";

export type ConfirmedRouteRefreshPlan =
  | { kind: "none" }
  | { kind: "grant"; chainId: number; grant: Address }
  | { kind: "boardroom"; chainId: number; boardroom: Address };

export function confirmedRouteRefreshPlan(
  routeAtSubmission: AppRoute,
  currentRoute: AppRoute,
): ConfirmedRouteRefreshPlan {
  if (routeAtSubmission.kind === "grant" && currentRoute.kind === "grant") {
    return routeAtSubmission.chainId === currentRoute.chainId && sameAddress(routeAtSubmission.grant, currentRoute.grant)
      ? { kind: "grant", chainId: currentRoute.chainId, grant: currentRoute.grant }
      : { kind: "none" };
  }
  if (!isBoardroomRoute(routeAtSubmission) || !isBoardroomRoute(currentRoute)) return { kind: "none" };
  if (routeAtSubmission.chainId !== currentRoute.chainId || !sameAddress(routeAtSubmission.boardroom, currentRoute.boardroom)) {
    return { kind: "none" };
  }
  return { kind: "boardroom", chainId: currentRoute.chainId, boardroom: currentRoute.boardroom };
}

function isBoardroomRoute(route: AppRoute): route is Extract<AppRoute, { kind: "project" | "studio-project" }> {
  return route.kind === "project" || route.kind === "studio-project";
}

function sameAddress(first: Address, second: Address): boolean {
  return first.toLowerCase() === second.toLowerCase();
}
