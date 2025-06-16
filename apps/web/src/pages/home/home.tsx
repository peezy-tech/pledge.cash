import { createRoute, type RootRoute } from '@tanstack/react-router'
import { PageLayout } from '@/components/PageLayout'
import OptionContract from '@/components/evm/OptionContract'
import { Button } from '@/components/ui/button'


export function HomePage() {
  return (
    <PageLayout 
      title="Explore"
    >
      <div>
        <Button>Click me</Button>
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