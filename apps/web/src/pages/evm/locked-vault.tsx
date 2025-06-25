import { createRoute, type RootRoute } from '@tanstack/react-router'
import { PageLayout } from '@/components/PageLayout'
import LockedVault from '@/components/evm/LockedVault'

export function LockedVaultPage() {
  return (
    <PageLayout 
      title="EVM Locked Vault"
    >
      <LockedVault />
    </PageLayout>
  )
}

export default (rootRoute: RootRoute) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/evm/locked-vault',
    component: LockedVaultPage,
  }) 