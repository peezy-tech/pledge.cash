import { createRoute, type RootRoute } from '@tanstack/react-router'
import { PageLayout } from '@/components/PageLayout'
import { Button } from '@/components/ui/button'
import { TokenBalances } from '@/components/evm/TokenBalances'

const currencyAddress = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const underlyingAddress = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0'

export function HomePage() {
  return (
    <PageLayout 
      title="Explore"
    >
      <div>
        <Button variant="outline">Click me</Button>
        <TokenBalances currencyAddress={currencyAddress} underlyingAddress={underlyingAddress} />
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