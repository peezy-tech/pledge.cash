import type { Address } from "@pledge.cash/sdk";

export type TransactionIdentity = {
  account: Address;
  chainId: number;
  contextGeneration: number;
  deploymentIdentity: string | undefined;
  routeIdentity: string;
};

export type LiveTransactionIdentity = {
  account: Address | undefined;
  chainId: number;
  contextGeneration: number;
  deploymentIdentity: string | undefined;
  routeIdentity: string;
  walletChainId: number | undefined;
};

export function assertTransactionIdentity(
  expected: TransactionIdentity,
  current: LiveTransactionIdentity,
  phase: "review" | "simulation" | "submission",
): void {
  if (current.contextGeneration !== expected.contextGeneration) {
    throw new Error(`The transaction context changed before transaction ${phase}. Review the transaction again.`);
  }
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

export type TransactionContextTicket = {
  generation: number;
  identity: string;
};

export class TransactionContextGuard {
  #generation = 0;
  #identity: string;

  constructor(identity: string) {
    this.#identity = identity;
  }

  capture(): TransactionContextTicket {
    return { generation: this.#generation, identity: this.#identity };
  }

  isCurrent(ticket: TransactionContextTicket): boolean {
    return ticket.generation === this.#generation && ticket.identity === this.#identity;
  }

  sync(identity: string): void {
    if (identity === this.#identity) return;
    this.#identity = identity;
    this.#generation += 1;
  }
}
