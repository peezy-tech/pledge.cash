import { RouterProvider } from '@tanstack/react-router'
import { WagmiProvider } from 'wagmi'
import { config } from '@/wagmiConfig'

import { ConnectKitProvider } from 'connectkit'

import * as TanStackQueryProvider from './QueryClientProvider'
import { ThemeProvider } from './ThemeProvider'
import { AuthProvider } from './AuthProvider'
import { router } from '@/pages/router'

import { queryClient } from './QueryClientProvider'

export function getContext() {
  return {
    queryClient,
  }
}

export function Providers() {
  return (
    <WagmiProvider config={config}>
      <TanStackQueryProvider.Provider>
        <ConnectKitProvider>
          <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
            <AuthProvider>
              <RouterProvider router={router} />
            </AuthProvider>
          </ThemeProvider>
        </ConnectKitProvider>
      </TanStackQueryProvider.Provider>
    </WagmiProvider>
  )
}
