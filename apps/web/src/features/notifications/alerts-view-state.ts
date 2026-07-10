import type { WalletState } from "../../lib/types";

export type AlertsViewState = "active" | "connect-wallet" | "link-delivery" | "sign-wallet";

type AlertsViewSession = {
  channels: Array<{ enabled: boolean }>;
};

export function alertsViewState(wallet: WalletState, session: AlertsViewSession | undefined): AlertsViewState {
  if (!session) {
    return wallet.account && wallet.chainId ? "sign-wallet" : "connect-wallet";
  }

  if (!session.channels.some((channel) => channel.enabled)) return "link-delivery";
  return "active";
}
