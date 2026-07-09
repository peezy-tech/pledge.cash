import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { http, WagmiProvider, createConfig } from "wagmi";
import { injected } from "wagmi/connectors";
import { SimpleKitProvider } from "./simplekit";
import { PLEDGE_CASH_NETWORKS, walletRpcUrl } from "../lib/contracts";

type Web3ProviderProps = {
  children: React.ReactNode;
};

const chains = PLEDGE_CASH_NETWORKS.map((network) => network.chain) as [
  (typeof PLEDGE_CASH_NETWORKS)[number]["chain"],
  ...(typeof PLEDGE_CASH_NETWORKS)[number]["chain"][],
];

const connectors = [injected()];
const transports = createWalletTransports();

const config = createConfig({
  chains,
  connectors,
  transports,
});

const queryClient = new QueryClient();

function Web3Provider({ children }: Web3ProviderProps): React.JSX.Element {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <SimpleKitProvider>{children}</SimpleKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

function createWalletTransports() {
  return Object.fromEntries(PLEDGE_CASH_NETWORKS.map((network) => [network.chainId, http(walletRpcUrl(network))]));
}

export { Web3Provider };
