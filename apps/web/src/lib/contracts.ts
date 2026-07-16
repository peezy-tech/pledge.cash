import { hyperEvmTestnet, monadTestnet, type Address } from "@pledge.cash/sdk";
import { createPublicClient, defineChain, fallback, http, type Chain, type Hex, type PublicClient } from "viem";

export const LOCAL_ANVIL_CHAIN_ID = 31337;
export const PUBLIC_RPC_BATCH_SIZE = 20;
export const PUBLIC_RPC_RETRY_COUNT = 0;
const SELECTED_NETWORK_STORAGE_KEY = "pledge.cash.selectedNetwork";

export type PledgeCashNetwork = {
  chainId: number;
  key: "hyperevm-testnet" | "monad-testnet" | "local-anvil" | "custom";
  name: string;
  rpcUrl: string;
  explorerName?: string | undefined;
  explorerUrl?: string | undefined;
  wrappedNativeSymbol: string;
  chain: Chain;
};

export type PledgeCashEnvironmentKind = "local" | "testnet" | "custom";

export type PledgeCashEnvironmentIdentity = {
  kind: PledgeCashEnvironmentKind;
  label: "Local" | "Testnet" | "Custom";
  description: string;
  hasRealValue: boolean | undefined;
  resettable: boolean;
  seeded: boolean;
};

export type PledgeCashNetworkEnv = Partial<
  Record<
    | "BASE_URL"
    | "VITE_PLEDGE_CASH_CHAIN_ID"
    | "VITE_PLEDGE_CASH_CHAIN_NAME"
    | "VITE_PLEDGE_CASH_EXPLORER_NAME"
    | "VITE_PLEDGE_CASH_EXPLORER_URL"
    | "VITE_PLEDGE_CASH_HYPEREVM_EXPLORER_NAME"
    | "VITE_PLEDGE_CASH_HYPEREVM_EXPLORER_URL"
    | "VITE_PLEDGE_CASH_HYPEREVM_RPC_URL"
    | "VITE_PLEDGE_CASH_HYPEREVM_WRAPPED_NATIVE_SYMBOL"
    | "VITE_PLEDGE_CASH_LOCAL_EXPLORER_NAME"
    | "VITE_PLEDGE_CASH_LOCAL_EXPLORER_URL"
    | "VITE_PLEDGE_CASH_LOCAL_RPC_URL"
    | "VITE_PLEDGE_CASH_LOCAL_WRAPPED_NATIVE_SYMBOL"
    | "VITE_PLEDGE_CASH_MONAD_EXPLORER_NAME"
    | "VITE_PLEDGE_CASH_MONAD_EXPLORER_URL"
    | "VITE_PLEDGE_CASH_MONAD_RPC_URL"
    | "VITE_PLEDGE_CASH_MONAD_WRAPPED_NATIVE_SYMBOL"
    | "VITE_PLEDGE_CASH_RPC_URL"
    | "VITE_PLEDGE_CASH_WRAPPED_NATIVE_SYMBOL",
    string | undefined
  >
>;

type LegacyNetworkProfile = {
  chainName: string | undefined;
  explorerName: string | undefined;
  explorerUrl: string | undefined;
  initialChainId: number | undefined;
  profileChainId: number;
  rpcUrl: string | undefined;
  wrappedNativeSymbol: string | undefined;
};

const pledgeCashEnv = import.meta.env;
const initialChainIdFromEnv = numericEnv(pledgeCashEnv.VITE_PLEDGE_CASH_CHAIN_ID);

export const PLEDGE_CASH_NETWORKS: PledgeCashNetwork[] = createPledgeCashNetworks(pledgeCashEnv);

export const DEFAULT_NETWORK = networkForChainId(initialChainIdFromEnv ?? hyperEvmTestnet.id);

export function initialSelectedNetwork(): PledgeCashNetwork {
  return networkForChainId(queryNetworkId() ?? storedNetworkId() ?? DEFAULT_NETWORK.chainId);
}

export function networkForChainId(chainId: number): PledgeCashNetwork {
  return supportedNetworkForChainId(chainId) ?? PLEDGE_CASH_NETWORKS[0]!;
}

export function supportedNetworkForChainId(chainId: number): PledgeCashNetwork | undefined {
  return PLEDGE_CASH_NETWORKS.find((network) => network.chainId === chainId);
}

export function networkEnvironmentIdentity(network: Pick<PledgeCashNetwork, "chainId" | "key">): PledgeCashEnvironmentIdentity {
  if (network.chainId === LOCAL_ANVIL_CHAIN_ID || network.key === "local-anvil") {
    return {
      kind: "local",
      label: "Local",
      description: "Local, resettable environment with no real value. State depends on the current local chain.",
      hasRealValue: false,
      resettable: true,
      seeded: false,
    };
  }

  if (network.key === "hyperevm-testnet" || network.key === "monad-testnet") {
    return {
      kind: "testnet",
      label: "Testnet",
      description: "Public test network using test assets with no real value.",
      hasRealValue: false,
      resettable: false,
      seeded: false,
    };
  }

  return {
    kind: "custom",
    label: "Custom",
    description: "Custom network configuration. Verify the chain and asset value before signing.",
    hasRealValue: undefined,
    resettable: false,
    seeded: false,
  };
}

export function createPledgeCashPublicClient(network: PledgeCashNetwork): PublicClient {
  return createPublicClient({
    chain: network.chain,
    transport: fallback([
      http(network.rpcUrl, {
        batch: { batchSize: PUBLIC_RPC_BATCH_SIZE, wait: 8 },
        key: "batched-http",
        retryCount: PUBLIC_RPC_RETRY_COUNT,
      }),
      http(network.rpcUrl, { key: "unbatched-http", retryCount: PUBLIC_RPC_RETRY_COUNT }),
    ], { retryCount: PUBLIC_RPC_RETRY_COUNT }),
  });
}

export function persistSelectedNetwork(chainId: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SELECTED_NETWORK_STORAGE_KEY, chainId.toString());
  } catch {
    // Network selection still works when browser storage is unavailable.
  }
}

export function syncSelectedNetworkSearch(chainId: number): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("chain", chainId.toString());
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

export function addressUrl(address: Address, chainId?: number): string | undefined {
  const explorerUrl = (chainId === undefined ? selectedNetworkForLinks() : supportedNetworkForChainId(chainId))?.explorerUrl;
  if (!explorerUrl) return undefined;
  return `${explorerUrl}/address/${address}`;
}

export function transactionUrl(hash: Hex, chainId?: number): string | undefined {
  const explorerUrl = (chainId === undefined ? selectedNetworkForLinks() : supportedNetworkForChainId(chainId))?.explorerUrl;
  if (!explorerUrl) return undefined;
  return `${explorerUrl}/tx/${hash}`;
}

export function walletRpcUrl(network: PledgeCashNetwork): string {
  if (!network.rpcUrl.startsWith("/")) return network.rpcUrl;
  if (typeof window === "undefined") return network.rpcUrl;
  return new URL(network.rpcUrl, window.location.origin).toString();
}

export function createPledgeCashNetworks(env: PledgeCashNetworkEnv): PledgeCashNetwork[] {
  const legacy = legacyNetworkProfile(env);
  const networks: PledgeCashNetwork[] = [
    createHyperEvmNetwork(env, legacy),
    createMonadNetwork(env, legacy),
    createLocalAnvilNetwork(env, legacy),
  ];

  const custom = createCustomLegacyNetwork(legacy, networks);
  if (custom) networks.push(custom);

  return networks;
}

function createHyperEvmNetwork(env: PledgeCashNetworkEnv, legacy: LegacyNetworkProfile): PledgeCashNetwork {
  return createNetwork({
    chainId: hyperEvmTestnet.id,
    key: "hyperevm-testnet",
    name: legacyProfileName(legacy, hyperEvmTestnet.id, hyperEvmTestnet.name),
    nativeCurrency: hyperEvmTestnet.nativeCurrency,
    rpcUrl:
      env.VITE_PLEDGE_CASH_HYPEREVM_RPC_URL
      ?? legacyProfileValue(legacy, hyperEvmTestnet.id, legacy.rpcUrl)
      ?? hyperEvmTestnet.rpcUrls.default.http[0],
    explorerName:
      env.VITE_PLEDGE_CASH_HYPEREVM_EXPLORER_NAME
      ?? legacyProfileValue(legacy, hyperEvmTestnet.id, legacy.explorerName)
      ?? hyperEvmTestnet.blockExplorers.default.name,
    explorerUrl:
      env.VITE_PLEDGE_CASH_HYPEREVM_EXPLORER_URL
      ?? legacyProfileValue(legacy, hyperEvmTestnet.id, legacy.explorerUrl)
      ?? hyperEvmTestnet.blockExplorers.default.url,
    wrappedNativeSymbol:
      env.VITE_PLEDGE_CASH_HYPEREVM_WRAPPED_NATIVE_SYMBOL
      ?? legacyProfileValue(legacy, hyperEvmTestnet.id, legacy.wrappedNativeSymbol)
      ?? `W${hyperEvmTestnet.nativeCurrency.symbol}`,
  });
}

function createMonadNetwork(env: PledgeCashNetworkEnv, legacy: LegacyNetworkProfile): PledgeCashNetwork {
  return createNetwork({
    chainId: monadTestnet.id,
    key: "monad-testnet",
    name: legacyProfileName(legacy, monadTestnet.id, monadTestnet.name),
    nativeCurrency: monadTestnet.nativeCurrency,
    rpcUrl:
      env.VITE_PLEDGE_CASH_MONAD_RPC_URL
      ?? legacyProfileValue(legacy, monadTestnet.id, legacy.rpcUrl)
      ?? monadTestnet.rpcUrls.default.http[0],
    explorerName:
      env.VITE_PLEDGE_CASH_MONAD_EXPLORER_NAME
      ?? legacyProfileValue(legacy, monadTestnet.id, legacy.explorerName)
      ?? monadTestnet.blockExplorers.default.name,
    explorerUrl:
      env.VITE_PLEDGE_CASH_MONAD_EXPLORER_URL
      ?? legacyProfileValue(legacy, monadTestnet.id, legacy.explorerUrl)
      ?? monadTestnet.blockExplorers.default.url,
    wrappedNativeSymbol:
      env.VITE_PLEDGE_CASH_MONAD_WRAPPED_NATIVE_SYMBOL
      ?? legacyProfileValue(legacy, monadTestnet.id, legacy.wrappedNativeSymbol)
      ?? `W${monadTestnet.nativeCurrency.symbol}`,
  });
}

function createLocalAnvilNetwork(env: PledgeCashNetworkEnv, legacy: LegacyNetworkProfile): PledgeCashNetwork {
  return createNetwork({
    chainId: LOCAL_ANVIL_CHAIN_ID,
    key: "local-anvil",
    name: legacyProfileName(legacy, LOCAL_ANVIL_CHAIN_ID, "Local Anvil"),
    nativeCurrency: {
      decimals: 18,
      name: "HYPE",
      symbol: "HYPE",
    },
    rpcUrl:
      env.VITE_PLEDGE_CASH_LOCAL_RPC_URL
      ?? legacyProfileValue(legacy, LOCAL_ANVIL_CHAIN_ID, legacy.rpcUrl)
      ?? defaultLocalRpcUrl(env.BASE_URL),
    explorerName:
      env.VITE_PLEDGE_CASH_LOCAL_EXPLORER_NAME
      ?? legacyProfileValue(legacy, LOCAL_ANVIL_CHAIN_ID, legacy.explorerName)
      ?? undefined,
    explorerUrl:
      env.VITE_PLEDGE_CASH_LOCAL_EXPLORER_URL
      ?? legacyProfileValue(legacy, LOCAL_ANVIL_CHAIN_ID, legacy.explorerUrl)
      ?? undefined,
    wrappedNativeSymbol:
      env.VITE_PLEDGE_CASH_LOCAL_WRAPPED_NATIVE_SYMBOL
      ?? legacyProfileValue(legacy, LOCAL_ANVIL_CHAIN_ID, legacy.wrappedNativeSymbol)
      ?? "WHYPE",
  });
}

function createCustomLegacyNetwork(
  legacy: LegacyNetworkProfile,
  networks: readonly PledgeCashNetwork[],
): PledgeCashNetwork | undefined {
  if (legacy.initialChainId === undefined) return undefined;
  if (networks.some((network) => network.chainId === legacy.initialChainId)) return undefined;

  const defaultChain = legacy.initialChainId === monadTestnet.id ? monadTestnet : hyperEvmTestnet;
  return createNetwork({
    chainId: legacy.initialChainId,
    key: "custom",
    name: legacy.chainName ?? defaultChain.name,
    nativeCurrency: defaultChain.nativeCurrency,
    rpcUrl:
      legacy.rpcUrl
      ?? defaultChain.rpcUrls.default.http[0]
      ?? hyperEvmTestnet.rpcUrls.default.http[0],
    explorerName: legacy.explorerName ?? defaultChain.blockExplorers.default.name,
    explorerUrl: legacy.explorerUrl ?? defaultChain.blockExplorers.default.url,
    wrappedNativeSymbol: legacy.wrappedNativeSymbol ?? `W${defaultChain.nativeCurrency.symbol}`,
  });
}

function legacyNetworkProfile(env: PledgeCashNetworkEnv): LegacyNetworkProfile {
  const initialChainId = numericEnv(env.VITE_PLEDGE_CASH_CHAIN_ID);
  return {
    chainName: env.VITE_PLEDGE_CASH_CHAIN_NAME,
    explorerName: env.VITE_PLEDGE_CASH_EXPLORER_NAME,
    explorerUrl: env.VITE_PLEDGE_CASH_EXPLORER_URL,
    initialChainId,
    profileChainId: initialChainId ?? hyperEvmTestnet.id,
    rpcUrl: env.VITE_PLEDGE_CASH_RPC_URL,
    wrappedNativeSymbol: env.VITE_PLEDGE_CASH_WRAPPED_NATIVE_SYMBOL,
  };
}

function legacyProfileName(legacy: LegacyNetworkProfile, chainId: number, fallback: string): string {
  if (legacy.profileChainId === chainId && legacy.chainName) return legacy.chainName;
  return fallback;
}

function legacyProfileValue<T>(legacy: LegacyNetworkProfile, chainId: number, value: T | undefined): T | undefined {
  return legacy.profileChainId === chainId ? value : undefined;
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
  try {
    return numericString(window.localStorage.getItem(SELECTED_NETWORK_STORAGE_KEY));
  } catch {
    return undefined;
  }
}

function numericEnv(value: string | undefined): number | undefined {
  return numericString(value);
}

function numericString(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function defaultLocalRpcUrl(baseUrl: string | undefined): string {
  return baseUrl === "/pledge-cash/" ? "/pledge-cash/rpc" : "http://127.0.0.1:8547";
}
