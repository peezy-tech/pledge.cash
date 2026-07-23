import type { ScheduledBoardroomOperation } from "@pledge.cash/sdk";

const TIMER_MAX_DELAY_MS = 2_147_000_000;
export const GOVERNANCE_BASELINE_REFRESH_MS = 30_000;

export function governanceRefreshDelay(
  operations: readonly ScheduledBoardroomOperation[],
  nowMs = Date.now(),
): number {
  const nowSeconds = BigInt(Math.floor(nowMs / 1_000));
  const boundaries = operations.flatMap((operation) => {
    if (["cancelled", "executed", "expired", "invalidated", "unknown"].includes(operation.status)) return [];
    if (operation.status === "waiting" && operation.eta > nowSeconds) return [operation.eta];
    if (operation.expiresAt >= nowSeconds) return [operation.expiresAt];
    return [];
  });
  if (boundaries.length === 0) return GOVERNANCE_BASELINE_REFRESH_MS;

  const nextBoundaryMs = boundaries.reduce((earliest, boundary) => boundary < earliest ? boundary : earliest) * 1_000n;
  const delay = Number(nextBoundaryMs - BigInt(Math.floor(nowMs)) + 1_000n);
  return Math.min(GOVERNANCE_BASELINE_REFRESH_MS, TIMER_MAX_DELAY_MS, Math.max(1_000, delay));
}
