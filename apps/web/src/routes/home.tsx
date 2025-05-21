import { createRoute } from '@tanstack/react-router'
import type { RootRoute } from '@tanstack/react-router'
import { WorldGrid } from './home/components/WorldGrid'
import { PageLayout } from './PageLayout'

export function HomePage() {
  return (
    <PageLayout 
      title="Explore"
      description="Discover and trade user-built virtual worlds and games. Each world is tokenized, allowing you to buy and sell these digital experiences."
    >
      <WorldGrid />
    </PageLayout>
  )
}

export default (rootRoute: RootRoute) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: HomePage,
  }) 