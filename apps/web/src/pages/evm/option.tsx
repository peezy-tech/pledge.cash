import { createRoute, type RootRoute } from '@tanstack/react-router'
import { PageLayout } from '@/components/PageLayout'
import OptionContract from '@/components/evm/OptionContract'

export function OptionPage() {
  return (
    <PageLayout 
      title="EVM Option Contract"
    >
      <OptionContract />
    </PageLayout>
  )
}

export default (rootRoute: RootRoute) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/evm/option',
    component: OptionPage,
  }) 