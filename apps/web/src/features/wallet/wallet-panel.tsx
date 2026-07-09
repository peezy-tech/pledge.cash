import type { ReactNode } from "react";
import { AddressLink, Facts, Panel } from "../../components/shell";
import type { WalletState } from "../../lib/types";

type WalletPanelProps = {
  wallet: WalletState;
};

type WalletFact = {
  label: string;
  value: ReactNode;
};

export function WalletPanel({ wallet }: WalletPanelProps): React.JSX.Element {
  const walletFacts = buildWalletFacts(wallet);

  return (
    <Panel title="Wallet">
      <Facts columns="one" items={walletFacts} />
    </Panel>
  );
}

function buildWalletFacts(wallet: WalletState): WalletFact[] {
  return [
    { label: "Address", value: walletAddressValue(wallet) },
    { label: "Chain", value: walletChainValue(wallet) },
  ];
}

function walletAddressValue(wallet: WalletState): ReactNode {
  if (!wallet.account) return "Not connected";
  return <AddressLink address={wallet.account} />;
}

function walletChainValue(wallet: WalletState): string {
  if (!wallet.chainId) return "Unknown";
  return `${wallet.chainId}`;
}
