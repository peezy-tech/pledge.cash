import type { Address } from "@pledge.cash/sdk";

export type TransactionIdentity = {
  account: Address;
  chainId: number;
  deploymentIdentity: string | undefined;
  routeIdentity: string;
};

export type LiveTransactionIdentity = {
  account: Address | undefined;
  chainId: number;
  deploymentIdentity: string | undefined;
  routeIdentity: string;
  walletChainId: number | undefined;
};

export function assertTransactionIdentity(
  expected: TransactionIdentity,
  current: LiveTransactionIdentity,
  phase: "review" | "simulation" | "submission",
): void {
  if (current.chainId !== expected.chainId || current.walletChainId !== expected.chainId) {
    throw new Error(`The active network changed before transaction ${phase}. Review the transaction again.`);
  }
  if (!current.account || current.account.toLowerCase() !== expected.account.toLowerCase()) {
    throw new Error(`The connected account changed before transaction ${phase}. Review the transaction again.`);
  }
  if (current.routeIdentity !== expected.routeIdentity) {
    throw new Error(`The active workspace changed before transaction ${phase}. Review the transaction again.`);
  }
  if (current.deploymentIdentity !== expected.deploymentIdentity) {
    throw new Error(`The active deployment changed before transaction ${phase}. Review the transaction again.`);
  }
}
