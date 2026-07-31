import type { Address } from "viem";

export * from "./generated";
export * from "./helpers";
export type { Address };

import { pledgeCashDeployments, type PledgeCashDeployment } from "./generated";

export const MONAD_TESTNET_CHAIN_ID = 10143;

export const monadTestnet = {
  id: MONAD_TESTNET_CHAIN_ID,
  name: "Monad Testnet",
  nativeCurrency: {
    decimals: 18,
    name: "MON",
    symbol: "MON",
  },
  rpcUrls: {
    default: {
      http: ["https://testnet-rpc.monad.xyz"],
    },
  },
  blockExplorers: {
    default: {
      name: "MonadVision",
      url: "https://testnet.monadvision.com",
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
