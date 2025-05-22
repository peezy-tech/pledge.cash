import 'ses'
import { StrictMode, useMemo } from 'react'
import ReactDOM from 'react-dom/client'
import {
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { clusterApiUrl } from '@solana/web3.js';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import TanStackQueryDemo from './routes/demo.tanstack-query.tsx'
import TokenAdmin from './routes/token-admin.tsx'
import { HomePage } from './routes/home.tsx'
import ProfilePage from './routes/profile.tsx'
import LaunchPage from './routes/launch.tsx'

import Header from './components/Header'
import ShowroomBackground from './components/ShowroomBackground'

import TanStackQueryLayout from './integrations/tanstack-query/layout.tsx'

import * as TanStackQueryProvider from './integrations/tanstack-query/root-provider.tsx'

import './styles.css'
import '@solana/wallet-adapter-react-ui/styles.css';
import reportWebVitals from './reportWebVitals.ts'

const rootRoute = createRootRoute({
  component: () => {
    const network = WalletAdapterNetwork.Mainnet;
    const endpoint = useMemo(() => clusterApiUrl(network), [network]);
    const wallets = useMemo(
      () => [
        new PhantomWalletAdapter(),
        new SolflareWalletAdapter(),
      ],
      [network]
    );

    return (
      <ConnectionProvider endpoint={endpoint}>
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>
            <div style={{ backgroundColor: 'transparent', minHeight: '100vh' }}>
              <ShowroomBackground />
              <Header />
              <Outlet />
              <TanStackRouterDevtools />
              <TanStackQueryLayout />
            </div>
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
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
  TanStackQueryDemo(rootRoute),
  TokenAdmin(rootRoute),
  ProfilePage(rootRoute),
  LaunchPage(rootRoute),
])

const router = createRouter({
  routeTree,
  context: {
    ...TanStackQueryProvider.getContext(),
  },
  defaultPreload: 'intent',
  scrollRestoration: true,
  defaultStructuralSharing: true,
  defaultPreloadStaleTime: 0,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const rootElement = document.getElementById('app')
if (rootElement && !rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement)
  root.render(
    <StrictMode>
      <TanStackQueryProvider.Provider>
        <RouterProvider router={router} />
      </TanStackQueryProvider.Provider>
    </StrictMode>,
  )
}

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals()
