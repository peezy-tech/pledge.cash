import React from 'react'
import { ConvexProvider, ConvexReactClient } from 'convex/react'

// Import the generated API runtime. Types may be stale without `convex dev`,
// but runtime `api` is safe to use.
// Path from web/src/providers -> apps/convex/convex/_generated/api
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { api } from '../../../convex/convex/_generated/api'

const convexUrl = (import.meta as any).env?.VITE_CONVEX_URL || (typeof process !== 'undefined' ? (process as any).env?.VITE_CONVEX_URL : undefined)

const client = new ConvexReactClient(convexUrl || '')

export const ConvexAppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  if (!convexUrl) {
    console.warn('VITE_CONVEX_URL not set; Convex client will not connect.')
  }
  return <ConvexProvider client={client}>{children}</ConvexProvider>
}
