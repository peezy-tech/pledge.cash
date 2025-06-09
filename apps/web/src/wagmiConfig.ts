import { getDefaultConfig } from 'connectkit'
import { http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'

export const config = createConfig(
  getDefaultConfig({
    appName: 'APP_NAME',
    appIcon: 'https://mainnet.xyz/favicon.ico',
    appDescription: 'mainnet',
    appUrl: 'https://mainnet.xyz',
    walletConnectProjectId: '',
    chains: [mainnet], 
    transports: {
      [mainnet.id]: http(),
    },
  }),
)