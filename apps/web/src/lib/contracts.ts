import {
  DEFAULT_PUBLIC_CHAIN_ID,
  pledgeCashNetworkProfiles,
  type Address,
  type PledgeCashNetworkKey,
  type PledgeCashNetworkProfile,
} from "@pledge.cash/sdk";
import { createPublicClient, defineChain, fallback, http, type Chain, type Hex, type PublicClient } from "viem";

export const LOCAL_ANVIL_CHAIN_ID = 31337;
export const PUBLIC_RPC_BATCH_SIZE = 20;
export const PUBLIC_RPC_RETRY_COUNT = 0;
const SELECTED_NETWORK_STORAGE_KEY = "pledge.cash.selectedNetwork";

export type PledgeCashNetwork = {
  chainId: number;
  key: PledgeCashNetworkKey | "local-anvil" | "custom";
  name: string;
  environment: "mainnet" | "testnet" | "local" | "custom";
  rpcUrl: string;
  explorerName?: string | undefined;
  explorerUrl?: string | undefined;
  wrappedNativeSymbol: string;
  chain: Chain;
};

export type PledgeCashEnvironmentKind = PledgeCashNetwork["environment"];

export type PledgeCashEnvironmentIdentity = {
  kind: PledgeCashEnvironmentKind;
  label: "Local" | "Testnet" | "Mainnet" | "Custom";
  description: string;
  hasRealValue: boolean | undefined;
  resettable: boolean;
  seeded: boolean;
};

export type PledgeCashNetworkEnv = Partial<Record<string, string | undefined>>;

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

export const DEFAULT_NETWORK = networkForChainId(initialChainIdFromEnv ?? DEFAULT_PUBLIC_CHAIN_ID);

export function initialSelectedNetwork(): PledgeCashNetwork {
  return networkForChainId(queryNetworkId() ?? storedNetworkId() ?? DEFAULT_NETWORK.chainId);
}

export function networkForChainId(chainId: number): PledgeCashNetwork {
  return supportedNetworkForChainId(chainId) ?? PLEDGE_CASH_NETWORKS[0]!;
}

export function supportedNetworkForChainId(chainId: number): PledgeCashNetwork | undefined {
  return PLEDGE_CASH_NETWORKS.find((network) => network.chainId === chainId);
}

export function networkEnvironmentIdentity(
  network: Pick<PledgeCashNetwork, "chainId" | "key"> & Partial<Pick<PledgeCashNetwork, "environment">>,
): PledgeCashEnvironmentIdentity {
  if (network.chainId === LOCAL_ANVIL_CHAIN_ID || network.key === "local-anvil" || network.environment === "local") {
    return {
      kind: "local",
      label: "Local",
      description: "Local, resettable environment with no real value. State depends on the current local chain.",
      hasRealValue: false,
      resettable: true,
      seeded: false,
    };
  }

  if (network.environment === "testnet" || pledgeCashNetworkProfiles.some(
    (profile) => profile.chainId === network.chainId && profile.environment === "testnet",
  )) {
    return {
      kind: "testnet",
      label: "Testnet",
      description: "Public test network using test assets with no real value.",
      hasRealValue: false,
      resettable: false,
      seeded: false,
    };
  }

  if (network.environment === "mainnet" || pledgeCashNetworkProfiles.some(
    (profile) => profile.chainId === network.chainId && profile.environment === "mainnet",
  )) {
    return {
      kind: "mainnet",
      label: "Mainnet",
      description: "Public main network using assets with real value. Verify every transaction before signing.",
      hasRealValue: true,
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
    ...pledgeCashNetworkProfiles.map((profile) => createCanonicalNetwork(profile, env, legacy)),
    createLocalAnvilNetwork(env, legacy),
  ];

  const custom = createCustomLegacyNetwork(legacy, networks);
  if (custom) networks.push(custom);

  return networks;
}

function createCanonicalNetwork(
  profile: PledgeCashNetworkProfile,
  env: PledgeCashNetworkEnv,
  legacy: LegacyNetworkProfile,
): PledgeCashNetwork {
  const chainId = profile.chainId;
  return createNetwork({
    chainId,
    key: profile.key as PledgeCashNetworkKey,
    name:
      env[`VITE_PLEDGE_CASH_CHAIN_NAME_${chainId.toString()}`]
      ?? legacyProfileName(legacy, chainId, profile.name),
    environment: profile.environment,
    nativeCurrency: profile.nativeCurrency,
    rpcUrl:
      env[`VITE_PLEDGE_CASH_RPC_URL_${chainId.toString()}`]
      ?? legacyProfileValue(legacy, chainId, legacy.rpcUrl)
      ?? profile.defaultRpcUrl,
    explorerName:
      env[`VITE_PLEDGE_CASH_EXPLORER_NAME_${chainId.toString()}`]
      ?? legacyProfileValue(legacy, chainId, legacy.explorerName)
      ?? profile.explorer.name,
    explorerUrl:
      env[`VITE_PLEDGE_CASH_EXPLORER_URL_${chainId.toString()}`]
      ?? legacyProfileValue(legacy, chainId, legacy.explorerUrl)
      ?? profile.explorer.url,
    wrappedNativeSymbol:
      env[`VITE_PLEDGE_CASH_WRAPPED_NATIVE_SYMBOL_${chainId.toString()}`]
      ?? legacyProfileValue(legacy, chainId, legacy.wrappedNativeSymbol)
      ?? profile.wrappedNative.symbol,
  });
}

function createLocalAnvilNetwork(env: PledgeCashNetworkEnv, legacy: LegacyNetworkProfile): PledgeCashNetwork {
  return createNetwork({
    chainId: LOCAL_ANVIL_CHAIN_ID,
    key: "local-anvil",
    name: legacyProfileName(legacy, LOCAL_ANVIL_CHAIN_ID, "Local Anvil"),
    environment: "local",
    nativeCurrency: {
      decimals: 18,
      name: "Ether",
      symbol: "ETH",
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
      ?? "WETH",
  });
}

function createCustomLegacyNetwork(
  legacy: LegacyNetworkProfile,
  networks: readonly PledgeCashNetwork[],
): PledgeCashNetwork | undefined {
  if (legacy.initialChainId === undefined) return undefined;
  if (networks.some((network) => network.chainId === legacy.initialChainId)) return undefined;

  const defaultProfile = pledgeCashNetworkProfiles.find((profile) => profile.chainId === DEFAULT_PUBLIC_CHAIN_ID)
    ?? pledgeCashNetworkProfiles[0]!;
  return createNetwork({
    chainId: legacy.initialChainId,
    key: "custom",
    name: legacy.chainName ?? defaultProfile.name,
    environment: "custom",
    nativeCurrency: defaultProfile.nativeCurrency,
    rpcUrl: legacy.rpcUrl ?? defaultProfile.defaultRpcUrl,
    explorerName: legacy.explorerName ?? defaultProfile.explorer.name,
    explorerUrl: legacy.explorerUrl ?? defaultProfile.explorer.url,
    wrappedNativeSymbol: legacy.wrappedNativeSymbol ?? defaultProfile.wrappedNative.symbol,
  });
}

function legacyNetworkProfile(env: PledgeCashNetworkEnv): LegacyNetworkProfile {
  const initialChainId = numericEnv(env.VITE_PLEDGE_CASH_CHAIN_ID);
  return {
    chainName: env.VITE_PLEDGE_CASH_CHAIN_NAME,
    explorerName: env.VITE_PLEDGE_CASH_EXPLORER_NAME,
    explorerUrl: env.VITE_PLEDGE_CASH_EXPLORER_URL,
    initialChainId,
    profileChainId: initialChainId ?? DEFAULT_PUBLIC_CHAIN_ID,
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
  environment: PledgeCashNetwork["environment"];
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
