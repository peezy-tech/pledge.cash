import 'ses'
import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import {
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { WagmiProvider } from 'wagmi'
import { config } from './wagmiConfig'
import TokenAdmin from './routes/token-admin.tsx'
import { HomePage } from './routes/home.tsx'
import ProfilePage from './routes/profile.tsx'
import LaunchPage from './routes/launch.tsx'
import createAdminGameServersRoute from './routes/admin-game-servers.tsx'
import createPlayGameRoute from './routes/play-game.tsx'

import { AuthProvider } from './providers/AuthProvider'
import { ThemeProvider } from './providers/ThemeProvider'
import { ConnectKitProvider } from 'connectkit'
import Header from './components/Header.tsx'

import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import * as TanStackQueryProvider from './providers/QueryClientProvider.tsx'

import './styles.css'
import reportWebVitals from './reportWebVitals.ts'

const rootRoute = createRootRoute({
  component: () => {
    return (
      <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
        <AuthProvider>
          <Header />
          <Outlet />
          <TanStackRouterDevtools />
          <ReactQueryDevtools buttonPosition="bottom-right" />
        </AuthProvider>
      </ThemeProvider>
    )
  },
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomePage,
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  TokenAdmin(rootRoute),
  ProfilePage(rootRoute),
  LaunchPage(rootRoute),
  createAdminGameServersRoute(rootRoute),
  createPlayGameRoute(rootRoute),
])

const routerContext = { ...TanStackQueryProvider.getContext() }

const router = createRouter({
  routeTree,
  context: routerContext,
  defaultPreload: 'intent',
  scrollRestoration: true,
  defaultStructuralSharing: true,
  defaultPreloadStaleTime: 0,
})

const rootElement = document.getElementById('app')
if (rootElement && !rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement)
  root.render(
    <StrictMode>
      <WagmiProvider config={config}>
        <TanStackQueryProvider.Provider>
          <ConnectKitProvider>
            <RouterProvider router={router} />
          </ConnectKitProvider>
        </TanStackQueryProvider.Provider>
      </WagmiProvider>
    </StrictMode>,
  )
}

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals()
