import type { Address } from "viem";

export * from "./generated";
export * from "./helpers";
export type { Address };

import { pledgeCashDeployments, type PledgeCashDeployment } from "./generated";

export const HYPEREVM_TESTNET_CHAIN_ID = 998;

export const hyperEvmTestnet = {
  id: HYPEREVM_TESTNET_CHAIN_ID,
  name: "HyperEVM Testnet",
  nativeCurrency: {
    decimals: 18,
    name: "HYPE",
    symbol: "HYPE",
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.hyperliquid-testnet.xyz/evm"],
    },
  },
  blockExplorers: {
    default: {
      name: "Purrsec",
      url: "https://testnet.purrsec.com",
    },
  },
} as const;

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const satisfies Address;

export function getPledgeCashDeployment(chainId: number): PledgeCashDeployment | undefined {
  return pledgeCashDeployments[chainId as keyof typeof pledgeCashDeployments];
}

export function grantTokenId(grantAddress: Address): bigint {
  return BigInt(grantAddress);
}

export function isZeroAddress(address: Address | string | undefined): boolean {
  return !address || address.toLowerCase() === ZERO_ADDRESS;
}
