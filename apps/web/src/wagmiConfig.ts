import { http, createConfig } from 'wagmi'
import { defineChain } from 'viem'

const IS_TESTNET = true

export const hyperliquid = defineChain({
  id: 9999,
  name: 'Hyperliquid',
  nativeCurrency: {
    decimals: 18,
    name: 'Hyperliquid',
    symbol: 'HYPE',
  },
  rpcUrls: {
    default: {
      http: [IS_TESTNET ? 'http://127.0.0.1:9999' : 'https://rpc.hyperliquid.xyz'],
      webSocket: [IS_TESTNET ? 'ws://127.0.0.1:9999' : 'wss://rpc.hyperliquid.xyz'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Explorer',
      url: IS_TESTNET
        ? 'https://app.hyperliquid-testnet.xyz/explorer/'
        : 'https://app.hyperliquid.xyz/explorer/',
    },
  },
  fees: {
    baseFeeMultiplier: 1,
  },
  // contracts: {
  //   multicall3: {
  //     address: '0xcA11bde05977b3631167028862bE2a173976CA11',
  //     blockCreated: 5882,
  //   },
  // },
})

export const config = createConfig({
  chains: [hyperliquid],
  transports: {
    [hyperliquid.id]: http(),
  },
})
