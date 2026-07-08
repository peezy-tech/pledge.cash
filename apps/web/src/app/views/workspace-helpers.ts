import type { Address } from "@pledge.cash/sdk";
import type { BoardroomSnapshot } from "../../lib/types";

export function manageWorkspaceSummary(
  account: Address | undefined,
  boardroomAddress: string,
  boardroomSnapshot: BoardroomSnapshot | undefined,
): {
  roleLabel: string;
  roleTone: "default" | "muted" | "warning";
  statusLabel: string;
  statusTone: "default" | "muted" | "warning";
} {
  const selected = Boolean(boardroomSnapshot || boardroomAddress.trim());
  const owner = sameAddress(account, boardroomSnapshot?.owner);

  return {
    roleLabel: !account ? "Connect owner wallet" : !boardroomSnapshot ? "Load Boardroom" : owner ? "Owner wallet" : "Read-only wallet",
    roleTone: owner ? "default" : "muted",
    statusLabel: boardroomSnapshot ? boardroomStatusText(boardroomSnapshot.status) : selected ? "Selected Boardroom not loaded" : "No Boardroom selected",
    statusTone: boardroomSnapshot ? "muted" : selected ? "warning" : "muted",
  };
}

export function boardroomStatusText(status: number): string {
  if (status === 0) return "Active";
  if (status === 1) return "Winding down";
  if (status === 2) return "Redemptions open";
  return "Unknown status";
}

export function sameAddress(first: Address | undefined, second: Address | undefined): boolean {
  return Boolean(first && second && first.toLowerCase() === second.toLowerCase());
}
