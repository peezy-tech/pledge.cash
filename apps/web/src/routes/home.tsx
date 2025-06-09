import { createRoute } from '@tanstack/react-router'
import type { RootRoute } from '@tanstack/react-router'
import { PageLayout } from './PageLayout'

export function HomePage() {
  return (
    <PageLayout 
      title="Explore"
    >
      <div>
        <h1>Home</h1>
      </div>
    </PageLayout>
  )
}

export default (rootRoute: RootRoute) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: HomePage,
  }) 