import { RouterProvider } from '@tanstack/react-router'

import * as TanStackQueryProvider from './QueryClientProvider'
import { ThemeProvider } from './ThemeProvider'
import { AuthProvider } from './AuthProvider'
import { router } from '@/pages/router'

import { queryClient } from './QueryClientProvider'
import { EvmProvider } from './EvmProvider'
import { HyperliquidProvider } from './HyperliquidProvider'

export function getContext() {
  return {
    queryClient,
  }
}

export function Providers() {
  return (
    <TanStackQueryProvider.Provider>
      <EvmProvider>
        <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
          <AuthProvider>
            <HyperliquidProvider>
              <RouterProvider router={router} />
            </HyperliquidProvider>
          </AuthProvider>
        </ThemeProvider>
      </EvmProvider>
    </TanStackQueryProvider.Provider>
  )
}
