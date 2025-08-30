import { useQuery } from 'convex/react'
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { api } from '../../../convex/convex/_generated/api'

export function useConvexLatestPayments(limit = 10) {
  // Types may be `any` until `convex dev` regenerates d.ts
  // @ts-expect-error Generated types may be missing in dev env without codegen
  const data = useQuery(api.payments.listLatest, { limit })
  return { data, isLoading: data === undefined }
}
