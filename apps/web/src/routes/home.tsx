import { createRoute } from '@tanstack/react-router'
import type { RootRoute } from '@tanstack/react-router'
import { PageLayout } from './PageLayout'
import OptionContract from '@/components/evm/OptionContract'

export function HomePage() {
  return (
    <PageLayout 
      title="Explore"
    >
      <div>
        <OptionContract />
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