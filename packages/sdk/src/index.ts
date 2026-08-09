import type { Address } from "viem";

export * from "./generated";
export * from "./helpers";
export type { Address };

import {
  pledgeCashDeployments,
  pledgeCashNetworkSupportPolicy,
  type PledgeCashDeployment,
} from "./generated";

export const DEFAULT_PUBLIC_CHAIN_ID = pledgeCashNetworkSupportPolicy.defaultChainId;

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const satisfies Address;

export function getPledgeCashDeployment(chainId: number): PledgeCashDeployment | undefined {
  return pledgeCashDeployments[chainId as keyof typeof pledgeCashDeployments];
}

export function isZeroAddress(address: Address | string | undefined): boolean {
  return !address || address.toLowerCase() === ZERO_ADDRESS;
}
