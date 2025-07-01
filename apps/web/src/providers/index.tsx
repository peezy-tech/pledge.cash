import { RouterProvider } from '@tanstack/react-router'

import * as TanStackQueryProvider from './QueryClientProvider'
import { ThemeProvider } from './ThemeProvider'
import { AuthProvider } from './AuthProvider'
import { router } from '@/pages/router'

import { queryClient } from './QueryClientProvider'
import { EvmProvider } from './EvmProvider'

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
            <RouterProvider router={router} />
          </AuthProvider>
        </ThemeProvider>
      </EvmProvider>
    </TanStackQueryProvider.Provider>
  )
}
