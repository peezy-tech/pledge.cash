import { AddressLink, Facts, Panel } from "../../components/shell";
import type { WalletState } from "../../lib/types";

export function WalletPanel({ wallet }: { wallet: WalletState }): React.JSX.Element {
  return (
    <Panel title="Wallet">
      <Facts
        columns="one"
        items={[
          { label: "Address", value: wallet.account ? <AddressLink address={wallet.account} /> : "Not connected" },
          { label: "Chain", value: wallet.chainId ? `${wallet.chainId}` : "Unknown" },
        ]}
      />
    </Panel>
  );
}
