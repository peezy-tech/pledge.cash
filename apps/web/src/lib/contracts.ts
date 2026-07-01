import { hyperEvmTestnet, type Address } from "@pledge.cash/sdk";
import { createPublicClient, defineChain, http, type Hex } from "viem";

export const ACTIVE_CHAIN_ID = Number(import.meta.env.VITE_PLEDGE_CASH_CHAIN_ID ?? hyperEvmTestnet.id);
export const ACTIVE_CHAIN_NAME = import.meta.env.VITE_PLEDGE_CASH_CHAIN_NAME ?? hyperEvmTestnet.name;
export const RPC_URL = import.meta.env.VITE_PLEDGE_CASH_RPC_URL ?? hyperEvmTestnet.rpcUrls.default.http[0] ?? "https://rpc.hyperliquid-testnet.xyz/evm";
export const EXPLORER_URL = import.meta.env.VITE_PLEDGE_CASH_EXPLORER_URL ?? hyperEvmTestnet.blockExplorers.default.url;
export const EXPLORER_NAME = import.meta.env.VITE_PLEDGE_CASH_EXPLORER_NAME ?? hyperEvmTestnet.blockExplorers.default.name;
export const WALLET_RPC_URL = absoluteUrl(RPC_URL);

export const chain = defineChain({
  id: ACTIVE_CHAIN_ID,
  name: ACTIVE_CHAIN_NAME,
  nativeCurrency: hyperEvmTestnet.nativeCurrency,
  rpcUrls: {
    default: {
      http: [RPC_URL],
    },
  },
  ...(EXPLORER_URL
    ? {
        blockExplorers: {
          default: {
            name: EXPLORER_NAME,
            url: EXPLORER_URL,
          },
        },
      }
    : {}),
});

export const publicClient = createPublicClient({
  chain,
  transport: http(RPC_URL),
});

export function addressUrl(address: Address): string | undefined {
  if (!EXPLORER_URL) return undefined;
  return `${EXPLORER_URL}/address/${address}`;
}

export function transactionUrl(hash: Hex): string | undefined {
  if (!EXPLORER_URL) return undefined;
  return `${EXPLORER_URL}/tx/${hash}`;
}

function absoluteUrl(url: string): string {
  if (!url.startsWith("/")) return url;
  if (typeof window === "undefined") return url;
  return new URL(url, window.location.origin).toString();
}
