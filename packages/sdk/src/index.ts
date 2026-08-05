import type { Address } from "viem";

export * from "./generated";
export * from "./helpers";
export type { Address };

import {
  pledgeCashDeployments,
  pledgeCashNetworkProfiles,
  pledgeCashNetworkSupportPolicy,
  type PledgeCashDeployment,
  type PledgeCashNetworkProfile,
  type PledgeCashPublicChainId,
} from "./generated";

export const ETHEREUM_MAINNET_CHAIN_ID = 1;
export const ROBINHOOD_CHAIN_MAINNET_CHAIN_ID = 4663;
export const BASE_MAINNET_CHAIN_ID = 8453;
export const ARBITRUM_MAINNET_CHAIN_ID = 42161;
export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const ETHEREUM_SEPOLIA_CHAIN_ID = 11155111;
export const DEFAULT_PUBLIC_CHAIN_ID = pledgeCashNetworkSupportPolicy.defaultChainId;

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const satisfies Address;

export function getPledgeCashDeployment(chainId: number): PledgeCashDeployment | undefined {
  return pledgeCashDeployments[chainId as keyof typeof pledgeCashDeployments];
}

export function getPledgeCashNetworkProfile(
  chainId: number,
): PledgeCashNetworkProfile | undefined {
  return pledgeCashNetworkProfiles.find((profile) => profile.chainId === chainId);
}

export function isPledgeCashPublicChainId(chainId: number): chainId is PledgeCashPublicChainId {
  return pledgeCashNetworkProfiles.some((profile) => profile.chainId === chainId);
}

export function grantTokenId(grantAddress: Address): bigint {
  return BigInt(grantAddress);
}

export function isZeroAddress(address: Address | string | undefined): boolean {
  return !address || address.toLowerCase() === ZERO_ADDRESS;
}
