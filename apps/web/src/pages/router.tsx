import { Outlet, createRootRoute, createRouter } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { getContext } from '@/providers'

import HomePage from './home/home'
import OptionPage from './evm/option'
import LockedVaultPage from './evm/locked-vault'
import InvoicesPage from './invoices/invoices'
import MultisigPage from './multisig/multisig'

import Header from '@/components/Header'

const rootRoute = createRootRoute({
  component: () => {
    return (
      <>
        <Header />
        <Outlet />
        <TanStackRouterDevtools />
        <ReactQueryDevtools buttonPosition="bottom-right" />
      </>
    )
  },
})

const routes = rootRoute.addChildren([
  HomePage(rootRoute),
  OptionPage(rootRoute),
  LockedVaultPage(rootRoute),
  InvoicesPage(rootRoute),
  MultisigPage(rootRoute),
])

export const router = createRouter({
  routeTree: routes,
  context: getContext(),
  defaultPreload: 'intent',
  scrollRestoration: true,
  defaultStructuralSharing: true,
  defaultPreloadStaleTime: 0,
})
