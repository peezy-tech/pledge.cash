import type { WalletState } from "../../lib/types";

export type AlertsViewState = "active" | "connect-wallet" | "link-delivery" | "sign-wallet" | "wallet-mismatch";

type AlertsViewSession = {
  channels: Array<{ enabled: boolean }>;
  wallets: Array<{ address: string }>;
};

export function alertsViewState(wallet: WalletState, session: AlertsViewSession | undefined): AlertsViewState {
  if (!session) {
    return wallet.account && wallet.chainId ? "sign-wallet" : "connect-wallet";
  }

  const connectedWalletIsLinked = wallet.account
    ? session.wallets.some((linkedWallet) => linkedWallet.address.toLowerCase() === wallet.account?.toLowerCase())
    : true;

  if (!connectedWalletIsLinked) return "wallet-mismatch";
  if (!session.channels.some((channel) => channel.enabled)) return "link-delivery";
  return "active";
}
