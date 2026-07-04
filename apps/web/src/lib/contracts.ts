import { hyperEvmTestnet, monadTestnet, type Address } from "@pledge.cash/sdk";
import { createPublicClient, defineChain, http, type Chain, type Hex, type PublicClient } from "viem";

export const LOCAL_ANVIL_CHAIN_ID = 31337;
const SELECTED_NETWORK_STORAGE_KEY = "pledge.cash.selectedNetwork";

export type PledgeCashNetwork = {
  chainId: number;
  key: "hyperevm-testnet" | "monad-testnet" | "local-anvil";
  name: string;
  rpcUrl: string;
  explorerName?: string | undefined;
  explorerUrl?: string | undefined;
  wrappedNativeSymbol: string;
  chain: Chain;
};

const initialChainIdFromEnv = numericEnv(import.meta.env.VITE_PLEDGE_CASH_CHAIN_ID);
const legacyRpcUrl = import.meta.env.VITE_PLEDGE_CASH_RPC_URL;
const legacyChainName = import.meta.env.VITE_PLEDGE_CASH_CHAIN_NAME;
const legacyExplorerUrl = blankToUndefined(import.meta.env.VITE_PLEDGE_CASH_EXPLORER_URL);
const legacyExplorerName = import.meta.env.VITE_PLEDGE_CASH_EXPLORER_NAME;
const legacyWrappedNativeSymbol = import.meta.env.VITE_PLEDGE_CASH_WRAPPED_NATIVE_SYMBOL;
const legacyProfileChainId = initialChainIdFromEnv ?? hyperEvmTestnet.id;

export const PLEDGE_CASH_NETWORKS: PledgeCashNetwork[] = [
  createNetwork({
    chainId: hyperEvmTestnet.id,
    key: "hyperevm-testnet",
    name: legacyProfileChainId === hyperEvmTestnet.id && legacyChainName ? legacyChainName : hyperEvmTestnet.name,
    nativeCurrency: hyperEvmTestnet.nativeCurrency,
    rpcUrl: import.meta.env.VITE_PLEDGE_CASH_HYPEREVM_RPC_URL
      ?? (legacyProfileChainId === hyperEvmTestnet.id ? legacyRpcUrl : undefined)
      ?? hyperEvmTestnet.rpcUrls.default.http[0],
    explorerName: import.meta.env.VITE_PLEDGE_CASH_HYPEREVM_EXPLORER_NAME
      ?? (legacyProfileChainId === hyperEvmTestnet.id ? legacyExplorerName : undefined)
      ?? hyperEvmTestnet.blockExplorers.default.name,
    explorerUrl: import.meta.env.VITE_PLEDGE_CASH_HYPEREVM_EXPLORER_URL
      ?? (legacyProfileChainId === hyperEvmTestnet.id ? legacyExplorerUrl : undefined)
      ?? hyperEvmTestnet.blockExplorers.default.url,
    wrappedNativeSymbol: import.meta.env.VITE_PLEDGE_CASH_HYPEREVM_WRAPPED_NATIVE_SYMBOL
      ?? (legacyProfileChainId === hyperEvmTestnet.id ? legacyWrappedNativeSymbol : undefined)
      ?? `W${hyperEvmTestnet.nativeCurrency.symbol}`,
  }),
  createNetwork({
    chainId: monadTestnet.id,
    key: "monad-testnet",
    name: legacyProfileChainId === monadTestnet.id && legacyChainName ? legacyChainName : monadTestnet.name,
    nativeCurrency: monadTestnet.nativeCurrency,
    rpcUrl: import.meta.env.VITE_PLEDGE_CASH_MONAD_RPC_URL
      ?? (legacyProfileChainId === monadTestnet.id ? legacyRpcUrl : undefined)
      ?? monadTestnet.rpcUrls.default.http[0],
    explorerName: import.meta.env.VITE_PLEDGE_CASH_MONAD_EXPLORER_NAME
      ?? (legacyProfileChainId === monadTestnet.id ? legacyExplorerName : undefined)
      ?? monadTestnet.blockExplorers.default.name,
    explorerUrl: import.meta.env.VITE_PLEDGE_CASH_MONAD_EXPLORER_URL
      ?? (legacyProfileChainId === monadTestnet.id ? legacyExplorerUrl : undefined)
      ?? monadTestnet.blockExplorers.default.url,
    wrappedNativeSymbol: import.meta.env.VITE_PLEDGE_CASH_MONAD_WRAPPED_NATIVE_SYMBOL
      ?? (legacyProfileChainId === monadTestnet.id ? legacyWrappedNativeSymbol : undefined)
      ?? `W${monadTestnet.nativeCurrency.symbol}`,
  }),
  createNetwork({
    chainId: LOCAL_ANVIL_CHAIN_ID,
    key: "local-anvil",
    name: legacyProfileChainId === LOCAL_ANVIL_CHAIN_ID && legacyChainName ? legacyChainName : "Local Anvil",
    nativeCurrency: {
      decimals: 18,
      name: "HYPE",
      symbol: "HYPE",
    },
    rpcUrl: import.meta.env.VITE_PLEDGE_CASH_LOCAL_RPC_URL
      ?? (legacyProfileChainId === LOCAL_ANVIL_CHAIN_ID ? legacyRpcUrl : undefined)
      ?? defaultLocalRpcUrl(),
    explorerName: import.meta.env.VITE_PLEDGE_CASH_LOCAL_EXPLORER_NAME
      ?? (legacyProfileChainId === LOCAL_ANVIL_CHAIN_ID ? legacyExplorerName : undefined)
      ?? undefined,
    explorerUrl: import.meta.env.VITE_PLEDGE_CASH_LOCAL_EXPLORER_URL
      ?? (legacyProfileChainId === LOCAL_ANVIL_CHAIN_ID ? legacyExplorerUrl : undefined)
      ?? undefined,
    wrappedNativeSymbol: import.meta.env.VITE_PLEDGE_CASH_LOCAL_WRAPPED_NATIVE_SYMBOL
      ?? (legacyProfileChainId === LOCAL_ANVIL_CHAIN_ID ? legacyWrappedNativeSymbol : undefined)
      ?? "WHYPE",
  }),
];

export const DEFAULT_NETWORK = networkForChainId(initialChainIdFromEnv ?? hyperEvmTestnet.id);

export function initialSelectedNetwork(): PledgeCashNetwork {
  return networkForChainId(queryNetworkId() ?? storedNetworkId() ?? DEFAULT_NETWORK.chainId);
}

export function networkForChainId(chainId: number): PledgeCashNetwork {
  return PLEDGE_CASH_NETWORKS.find((network) => network.chainId === chainId) ?? PLEDGE_CASH_NETWORKS[0]!;
}

export function createPledgeCashPublicClient(network: PledgeCashNetwork): PublicClient {
  return createPublicClient({
    chain: network.chain,
    transport: http(network.rpcUrl),
  });
}

export function persistSelectedNetwork(chainId: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SELECTED_NETWORK_STORAGE_KEY, chainId.toString());
}

export function syncSelectedNetworkSearch(chainId: number): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("chain", chainId.toString());
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

export function addressUrl(address: Address): string | undefined {
  const explorerUrl = selectedNetworkForLinks().explorerUrl;
  if (!explorerUrl) return undefined;
  return `${explorerUrl}/address/${address}`;
}

export function transactionUrl(hash: Hex, chainId?: number): string | undefined {
  const explorerUrl = (chainId === undefined ? selectedNetworkForLinks() : networkForChainId(chainId)).explorerUrl;
  if (!explorerUrl) return undefined;
  return `${explorerUrl}/tx/${hash}`;
}

export function walletRpcUrl(network: PledgeCashNetwork): string {
  if (!network.rpcUrl.startsWith("/")) return network.rpcUrl;
  if (typeof window === "undefined") return network.rpcUrl;
  return new URL(network.rpcUrl, window.location.origin).toString();
}

function createNetwork(input: {
  chainId: number;
  key: PledgeCashNetwork["key"];
  name: string;
  nativeCurrency: Chain["nativeCurrency"];
  rpcUrl: string;
  explorerName?: string | undefined;
  explorerUrl?: string | undefined;
  wrappedNativeSymbol: string;
}): PledgeCashNetwork {
  const chain = defineChain({
    id: input.chainId,
    name: input.name,
    nativeCurrency: input.nativeCurrency,
    rpcUrls: {
      default: {
        http: [input.rpcUrl],
      },
    },
    ...(input.explorerUrl
      ? {
          blockExplorers: {
            default: {
              name: input.explorerName ?? "Explorer",
              url: input.explorerUrl,
            },
          },
        }
      : {}),
  });

  return { ...input, chain };
}

function selectedNetworkForLinks(): PledgeCashNetwork {
  return networkForChainId(queryNetworkId() ?? storedNetworkId() ?? DEFAULT_NETWORK.chainId);
}

function queryNetworkId(): number | undefined {
  if (typeof window === "undefined") return undefined;
  return numericString(new URL(window.location.href).searchParams.get("chain"));
}

function storedNetworkId(): number | undefined {
  if (typeof window === "undefined") return undefined;
  return numericString(window.localStorage.getItem(SELECTED_NETWORK_STORAGE_KEY));
}

function numericEnv(value: string | undefined): number | undefined {
  return numericString(value);
}

function numericString(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function blankToUndefined(value: string | undefined): string | undefined {
  return value?.trim() ? value : undefined;
}

function defaultLocalRpcUrl(): string {
  return import.meta.env.BASE_URL === "/pledge-cash/" ? "/pledge-cash/rpc" : "http://127.0.0.1:8547";
}
