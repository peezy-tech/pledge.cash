import ProfilePage from './profile/profile.tsx'
import LaunchPage from './launch/launch.tsx'

import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'

import { HomePage } from '@/routes/home/home.tsx'

import Header from '@/components/Header.tsx'

import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import * as TanStackQueryProvider from '@/providers/QueryClientProvider'

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

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomePage,
})

export const routeTree = rootRoute.addChildren([
  indexRoute,
  ProfilePage(rootRoute),
  LaunchPage(rootRoute),
])

const routerContext = { ...TanStackQueryProvider.getContext() }

export const router = createRouter({
  routeTree,
  context: routerContext,
  defaultPreload: 'intent',
  scrollRestoration: true,
  defaultStructuralSharing: true,
  defaultPreloadStaleTime: 0,
})
