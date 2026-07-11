import type { QueuedBoardroomAction } from "@pledge.cash/sdk";

const TIMER_MAX_DELAY_MS = 2_147_000_000;
export const GOVERNANCE_BASELINE_REFRESH_MS = 30_000;

export function governanceRefreshDelay(
  actions: readonly QueuedBoardroomAction[],
  nowMs = Date.now(),
): number {
  const nowSeconds = BigInt(Math.floor(nowMs / 1_000));
  const boundaries = actions.flatMap((action) => {
    if (["cancelled", "executed", "expired", "invalidated", "unknown"].includes(action.status)) return [];
    if (action.status === "waiting" && action.eta > nowSeconds) return [action.eta];
    if (action.expiresAt >= nowSeconds) return [action.expiresAt];
    return [];
  });
  if (boundaries.length === 0) return GOVERNANCE_BASELINE_REFRESH_MS;

  const nextBoundaryMs = boundaries.reduce((earliest, boundary) => boundary < earliest ? boundary : earliest) * 1_000n;
  const delay = Number(nextBoundaryMs - BigInt(Math.floor(nowMs)) + 1_000n);
  return Math.min(GOVERNANCE_BASELINE_REFRESH_MS, TIMER_MAX_DELAY_MS, Math.max(1_000, delay));
}
