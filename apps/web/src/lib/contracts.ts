import { hyperEvmTestnet, type Address } from "@pledge.cash/sdk";
import { createPublicClient, defineChain, http, type Hex } from "viem";

export const RPC_URL = hyperEvmTestnet.rpcUrls.default.http[0] ?? "https://rpc.hyperliquid-testnet.xyz/evm";
export const EXPLORER_URL = hyperEvmTestnet.blockExplorers.default.url;

export const chain = defineChain({
  id: hyperEvmTestnet.id,
  name: hyperEvmTestnet.name,
  nativeCurrency: hyperEvmTestnet.nativeCurrency,
  rpcUrls: hyperEvmTestnet.rpcUrls,
  blockExplorers: hyperEvmTestnet.blockExplorers,
});

export const publicClient = createPublicClient({
  chain,
  transport: http(RPC_URL),
});

export function addressUrl(address: Address): string {
  return `${EXPLORER_URL}/address/${address}`;
}

export function transactionUrl(hash: Hex): string {
  return `${EXPLORER_URL}/tx/${hash}`;
}
