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
  if (!boardroomSnapshot) {
    const selected = Boolean(boardroomAddress.trim());

    return {
      roleLabel: account ? "Load Boardroom" : "Connect owner wallet",
      roleTone: "muted",
      statusLabel: selected ? "Selected Boardroom not loaded" : "No Boardroom selected",
      statusTone: selected ? "warning" : "muted",
    };
  }

  const owner = sameAddress(account, boardroomSnapshot.owner);

  return {
    roleLabel: !account ? "Connect owner wallet" : owner ? "Owner wallet" : "Read-only wallet",
    roleTone: owner ? "default" : "muted",
    statusLabel: boardroomStatusText(boardroomSnapshot.status),
    statusTone: "muted",
  };
}

export function boardroomStatusText(status: number): string {
  if (status === 0) return "Active";
  if (status === 1) return "Winding down";
  if (status === 2) return "Snapshotting";
  if (status === 3) return "Redemptions open";
  return "Unknown status";
}

export function sameAddress(first: Address | undefined, second: Address | undefined): boolean {
  return Boolean(first && second && first.toLowerCase() === second.toLowerCase());
}
