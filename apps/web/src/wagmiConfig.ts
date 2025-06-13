import { getDefaultConfig } from 'connectkit'
import { http, createConfig } from 'wagmi'
import { defineChain } from 'viem'

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
      http: ['http://127.0.0.1:9999'],
      webSocket: ['ws://127.0.0.1:9999'],
    },
  },
  // blockExplorers: {
  //   default: { name: 'Explorer', url: 'https://explorer.hyperliquid.xyz' },
  // },
  // contracts: {
  //   multicall3: {
  //     address: '0xcA11bde05977b3631167028862bE2a173976CA11',
  //     blockCreated: 5882,
  //   },
  // },
})

export const config = createConfig(
  getDefaultConfig({
    appName: 'APP_NAME',
    appIcon: 'https://mainnet.xyz/favicon.ico',
    appDescription: 'mainnet',
    appUrl: 'https://mainnet.xyz',
    walletConnectProjectId: '',
    chains: [hyperliquid],
    transports: {
      [hyperliquid.id]: http(),
    },
  }),
)
