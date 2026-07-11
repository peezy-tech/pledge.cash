import type { Address } from "@pledge.cash/sdk";
import type { AppRoute } from "./routing";

export type ConfirmedRouteRefreshPlan =
  | { kind: "none" }
  | { kind: "grant"; chainId: number; grant: Address }
  | { kind: "product"; boardroom: Address; refreshGovernance: boolean };

export function confirmedRouteRefreshPlan(
  routeAtSubmission: AppRoute,
  currentRoute: AppRoute,
): ConfirmedRouteRefreshPlan {
  if (routeAtSubmission.kind === "grant" && currentRoute.kind === "grant") {
    return routeAtSubmission.chainId === currentRoute.chainId && sameAddress(routeAtSubmission.grant, currentRoute.grant)
      ? { kind: "grant", chainId: currentRoute.chainId, grant: currentRoute.grant }
      : { kind: "none" };
  }
  if (!isProductRoute(routeAtSubmission) || !isProductRoute(currentRoute)) return { kind: "none" };
  if (routeAtSubmission.chainId !== currentRoute.chainId || !sameAddress(routeAtSubmission.boardroom, currentRoute.boardroom)) {
    return { kind: "none" };
  }
  return {
    kind: "product",
    boardroom: currentRoute.boardroom,
    refreshGovernance: (currentRoute.kind === "project" && currentRoute.section === "governance")
      || (currentRoute.kind === "studio-project" && (currentRoute.section === "governance" || currentRoute.section === "close")),
  };
}

function isProductRoute(route: AppRoute): route is Extract<AppRoute, { kind: "project" | "studio-project" }> {
  return route.kind === "project" || route.kind === "studio-project";
}

function sameAddress(first: Address, second: Address): boolean {
  return first.toLowerCase() === second.toLowerCase();
}
