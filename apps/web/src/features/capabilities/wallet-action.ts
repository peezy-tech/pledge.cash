import type { Address } from "@pledge.cash/sdk";

export type WalletActionCapability = {
  status: "enabled" | "connect" | "switch" | "blocked";
  reason?: string | undefined;
};

export function walletActionCapability(
  account: Address | undefined,
  walletChainId: number | undefined,
  routeChainId: number,
): WalletActionCapability {
  if (!account) return { status: "connect", reason: "Connect a wallet to continue." };
  if (walletChainId !== routeChainId) {
    return { status: "switch", reason: `Switch the wallet to chain ${routeChainId.toString()}.` };
  }
  return { status: "enabled" };
}
