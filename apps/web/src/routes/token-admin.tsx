import { useState } from 'react'
import { createRoute } from '@tanstack/react-router'
import type { RootRoute } from '@tanstack/react-router'

import CreateConfigForm from '../components/CreateConfigForm'
import CreatePoolForm from '../components/CreatePoolForm'
import CreateSwapForm from '../components/CreateSwapForm'
import { ProtectedRoute } from '../components/ProtectedRoute'
import { PageLayout } from './PageLayout'

import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

export function TokenAdminPage() {
  const [configAddress, setConfigAddress] = useState<string>("")

  const handleConfigCreated = (address: string) => {
    setConfigAddress(address)
  }

  return (
    <ProtectedRoute
      fallback={
        <PageLayout title="Token Admin - Access Restricted">
          <div className="text-center py-12">
            <h2 className="text-2xl font-bold text-slate-800 mb-4">Token Admin Access Restricted</h2>
            <p className="text-gray-600 mb-6">
              You need to connect your wallet and login to access the token administration tools.
            </p>
            <p className="text-sm text-gray-500">
              Click the "Connect Wallet" button (usually in the header or on this page if provided) to get started.
            </p>
          </div>
        </PageLayout>
      }
    >
      <style>{`body { background-color: white; }`}</style>
      <h1>Meteora Dynamic Bonding Curve (DBC) Tools</h1>
      
      <div className="container" style={{ backgroundColor: 'white' }}>
        <div className="form-section" style={{ backgroundColor: 'white' }}>
          <CreateConfigForm onConfigCreated={handleConfigCreated} />
        </div>
        <div className="form-section" style={{ backgroundColor: 'white' }}>
          <CreatePoolForm initialConfigAddress={configAddress} />
        </div>
        <div className="form-section" style={{ backgroundColor: 'white' }}>
          <CreateSwapForm />
        </div>
      </div>
      <div style={{ position: 'absolute', top: '20px', right: '20px', zIndex: 9999 }}>
        <WalletMultiButton />
      </div>
      <footer className="read-the-docs">
        <p>Ensure your devnet wallet has SOL for transaction fees.</p>
        <p>These forms interact directly with the Solana devnet.</p>
        <p><strong>Never use mainnet private keys in a frontend example like this.</strong></p>
      </footer>
    </ProtectedRoute>
  )
}

export default (rootRoute: RootRoute) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/token-admin',
    component: TokenAdminPage,
  }) 