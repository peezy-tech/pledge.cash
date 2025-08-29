import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../utils/api'
import { useHyperliquid } from '../providers/HyperliquidProvider'
import * as hl from '@nktkas/hyperliquid'

// Hook to fetch user's spot balances
export function useHyperliquidSpotBalances(address?: `0x${string}`) {
  const { infoClient, isReady } = useHyperliquid()

  return useQuery({
    queryKey: ['spot-balances', address],
    queryFn: async () => {
      if (!infoClient || !address) {
        throw new Error('Info client not ready or address not available')
      }

      const response = await infoClient.spotClearinghouseState({
        user: address,
      })
      return response
    },
    enabled: isReady && !!address && !!infoClient,
  })
}

export function useSpotTokens() {
  const { infoClient } = useHyperliquid()

  return useQuery({
    queryKey: ['spot-tokens'],
    queryFn: async () => {
      try {
        // First try to fetch from our cached endpoint
        const cachedResponse = await api.hyperliquid['spot-tokens'].get()

        if (cachedResponse.data?.success && cachedResponse.data?.data?.tokens) {
          console.log('Using cached spot tokens from backend:', {
            count: cachedResponse.data.data.count,
            lastUpdated: new Date(cachedResponse.data.data.lastUpdated),
            source: cachedResponse.data.data.source,
          })
          return cachedResponse.data.data.tokens
        }

        // Fallback to direct API call if cache is not available
        console.log(
          'Cache not available, falling back to direct Hyperliquid API',
        )
        if (!infoClient) {
          throw new Error('Neither cached data nor info client is available')
        }

        const response = await infoClient.spotMeta()
        return response?.tokens.reduce(
          (acc, t) => {
            acc[t.name] = t
            return acc
          },
          {} as Record<string, hl.SpotToken>,
        )
      } catch (error) {
        console.error(
          'Error fetching spot tokens from cache, trying direct API:',
          error,
        )

        // Final fallback to direct API call
        if (!infoClient) {
          throw new Error(
            'Failed to fetch cached spot tokens and info client not available',
          )
        }

        const response = await infoClient.spotMeta()
        return response?.tokens.reduce(
          (acc, t) => {
            acc[t.name] = t
            return acc
          },
          {} as Record<string, hl.SpotToken>,
        )
      }
    },
    enabled: true, // Always enabled since we have fallback mechanisms
    staleTime: 5 * 60 * 1000, // Consider data stale after 5 minutes
    refetchInterval: 5 * 60 * 1000, // Refetch every 5 minutes
  })
}

// Hook to fetch user's invoices
export function useHyperliquidInvoices() {
  return useQuery({
    queryKey: ['invoices'],
    queryFn: async () => {
      const response = await api.hyperliquid.invoices.get()
      if (response.error) {
        const errorMessage =
          typeof response.error.value === 'object'
            ? JSON.stringify(response.error.value)
            : String(response.error.value)
        throw new Error(errorMessage || 'Failed to fetch invoices')
      }
      return response.data
    },
  })
}

// Hook to get a single invoice by ID
export function useInvoiceById(invoiceId: string | undefined) {
  return useQuery({
    queryKey: ['invoices', invoiceId],
    queryFn: async () => {
      if (!invoiceId) {
        // Return a promise that resolves to null or throws,
        // but it shouldn't be called due to `enabled` flag.
        return Promise.resolve(null)
      }
      const response = await api.hyperliquid.invoices[invoiceId].get()
      if (response.error) {
        if (response.status === 404) {
          return null // Treat 404 as data not found, not an error
        }
        throw new Error(String(response.error.value))
      }
      return response.data
    },
    enabled: !!invoiceId, // Only run the query if invoiceId is available
    retry: (failureCount, error: any) => {
      // Don't retry on 404s
      if (error?.status === 404) {
        return false
      }
      return failureCount < 3
    },
  })
}

// Hook to create a new invoice
export function useCreateInvoiceMutation() {
  const queryClient = useQueryClient()

  type Hook = {
    event: 'invoice.paid' | 'invoice.created'
    type: 'discord' | 'webhook'
    url: string
  }

  return useMutation({
    mutationFn: async (invoiceData: {
      payerAddress?: string
      token: string
      amount: string
      description?: string
      hooks?: Hook[]
    }) => {
      // @ts-ignore - The api type is not yet updated with the new hooks property
      const response = await api.hyperliquid.invoices.post(invoiceData)
      if (response.error) {
        const errorMessage =
          typeof response.error.value === 'object'
            ? JSON.stringify(response.error.value)
            : String(response.error.value)
        throw new Error(errorMessage || 'Failed to create invoice')
      }
      return response.data
    },
    onSuccess: () => {
      // Invalidate and refetch invoices after creating a new one
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
    },
  })
}

// Hook to confirm payment
export function useConfirmPaymentMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, txHash }: { id: string; txHash: string }) => {
      const response = await api.hyperliquid.invoices[id].confirm.put({
        txHash,
      })
      if (response.error) {
        const errorMessage =
          typeof response.error.value === 'object'
            ? JSON.stringify(response.error.value)
            : String(response.error.value)
        throw new Error(errorMessage || 'Failed to confirm payment')
      }
      return response.data
    },
    onSuccess: () => {
      // Invalidate and refetch invoices after confirming payment
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
    },
  })
}

export function useOperator() {
  return useQuery({
    queryKey: ['operator'],
    queryFn: async () => {
      const response = await api.hyperliquid.operator.get()
      return response.data
    },
  })
}

export function usePledgeWallet() {
  return useQuery({
    queryKey: ['pledge-wallet'],
    queryFn: async () => {
      const response = await api.hyperliquid['pledge-wallet'].get()
      return response.data
    },
  })
}

export function useCreatePledgeWalletMutation() {
  return useMutation({
    mutationFn: async ({
      tx,
      agentWalletAddress,
    }: {
      tx: `0x${string}`
      agentWalletAddress: `0x${string}`
    }) => {
      const response = await api.hyperliquid['pledge-wallet'].post({
        tx,
        agentWalletAddress,
      })
      if (response.error) {
        const errorMessage =
          typeof response.error.value === 'object'
            ? JSON.stringify(response.error.value)
            : String(response.error.value)
        throw new Error(errorMessage || 'Failed to create pledge wallet')
      }
      return response.data
    },
  })
}

// Hook to get WebSocket client status
export function useWebSocketStatus() {
  return useQuery({
    queryKey: ['websocket-status'],
    queryFn: async () => {
      const response = await api.hyperliquid['ws-status'].get()
      if (response.error) {
        const errorMessage =
          typeof response.error.value === 'object'
            ? JSON.stringify(response.error.value)
            : String(response.error.value)
        throw new Error(errorMessage || 'Failed to fetch WebSocket status')
      }
      return response.data
    },
    refetchInterval: 30 * 1000, // Check status every 30 seconds
    staleTime: 15 * 1000, // Consider data stale after 15 seconds
  })
}

// Enhanced hook to get spot tokens with mid prices and metadata
export function useSpotTokensWithPrices() {
  return useQuery({
    queryKey: ['spot-tokens-with-prices'],
    queryFn: async () => {
      const response = await api.hyperliquid['spot-tokens'].get()

      if (response.error) {
        const errorMessage =
          typeof response.error.value === 'object'
            ? JSON.stringify(response.error.value)
            : String(response.error.value)
        throw new Error(
          errorMessage || 'Failed to fetch spot tokens with prices',
        )
      }

      if (!response.data?.success || !response.data?.data) {
        throw new Error('Invalid response format from spot tokens endpoint')
      }

      return {
        tokens: response.data.data.tokens,
        mids: response.data.data.mids,
        lastUpdated: response.data.data.lastUpdated,
        source: response.data.data.source,
        count: response.data.data.count,
      }
    },
    enabled: true,
    staleTime: 2 * 60 * 1000, // Consider data stale after 2 minutes (mid prices update frequently)
    refetchInterval: 2 * 60 * 1000, // Refetch every 2 minutes for real-time prices
  })
}

// ================================
// Recurring Plans
// ================================
export function useRecurringPlans() {
  return useQuery({
    queryKey: ['recurring-plans'],
    queryFn: async () => {
      const response = await api.hyperliquid.recurring.get()
      if (response.error) throw new Error(String(response.error.value))
      return response.data
    },
  })
}

export function useRecurringCharges(planId: string | undefined) {
  return useQuery({
    queryKey: ['recurring-charges', planId],
    queryFn: async () => {
      if (!planId) return []
      const response = await api.hyperliquid.recurring[planId].charges.get()
      if (response.error) throw new Error(String(response.error.value))
      return response.data
    },
    enabled: !!planId,
  })
}

export function useCreateRecurringPlanMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: {
      payerUserId?: string
      payerAddress?: string
      token: string
      amount: string
      cadence: 'daily' | 'weekly' | 'monthly'
      startAt?: number
      endAt?: number
      autopayEnabled?: boolean
    }) => {
      const response = await api.hyperliquid.recurring.post(data as any)
      if (response.error) throw new Error(String(response.error.value))
      return response.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recurring-plans'] }),
  })
}

export function useUpdateRecurringPlanMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      status,
      autopayEnabled,
      endAt,
    }: {
      id: string
      status?: 'active' | 'paused' | 'cancelled'
      autopayEnabled?: boolean
      endAt?: number
    }) => {
      const response = await api.hyperliquid.recurring[id].patch({
        status,
        autopayEnabled,
        endAt,
      } as any)
      if (response.error) throw new Error(String(response.error.value))
      return response.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recurring-plans'] }),
  })
}

export function useRunRecurringPlanMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const response = await api.hyperliquid.recurring[id].run.post()
      if (response.error) throw new Error(String(response.error.value))
      return response.data
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['recurring-charges', variables.id] })
    },
  })
}

// ================================
// Pledges & Campaigns
// ================================
export function usePledgeCampaigns() {
  return useQuery({
    queryKey: ['pledge-campaigns'],
    queryFn: async () => {
      const response = await api.hyperliquid['pledge-campaigns'].get()
      if (response.error) throw new Error(String(response.error.value))
      return response.data
    },
  })
}

export function useDiscoverPledgeCampaigns() {
  return useQuery({
    queryKey: ['pledge-campaigns-discover'],
    queryFn: async () => {
      const response = await api.hyperliquid['pledge-campaigns'].discover.get()
      if (response.error) throw new Error(String(response.error.value))
      return response.data
    },
  })
}

export function useMyPledges() {
  return useQuery({
    queryKey: ['my-pledges'],
    queryFn: async () => {
      const response = await api.hyperliquid.pledges.get()
      if (response.error) throw new Error(String(response.error.value))
      return response.data
    },
  })
}

export function useCreatePledgeCampaignMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: {
      name: string
      description?: string
      goalToken: string
      goalAmount: string
    }) => {
      const response = await api.hyperliquid['pledge-campaigns'].post(data)
      if (response.error) throw new Error(String(response.error.value))
      return response.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pledge-campaigns'] }),
  })
}

export function useCreatePledgeMutation() {
  return useMutation({
    mutationFn: async (data: {
      campaignId: string
      pledgerUserId?: string
      pledgerAddress?: string
      token: string
      amountPerCadence: string
      cadence: 'daily' | 'weekly' | 'monthly'
      startAt?: number
      autopayEnabled?: boolean
    }) => {
      const response = await api.hyperliquid.pledges.post(data)
      if (response.error) throw new Error(String(response.error.value))
      return response.data
    },
  })
}

export function usePayPledgeMutation() {
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const response = await api.hyperliquid.pledges[id].pay.post()
      if (response.error) throw new Error(String(response.error.value))
      return response.data
    },
  })
}

export function useConfirmContributionMutation() {
  return useMutation({
    mutationFn: async ({ id, txHash }: { id: string; txHash: `0x${string}` }) => {
      const response = await api.hyperliquid['pledge-contributions'][id].confirm.put({
        txHash,
      })
      if (response.error) throw new Error(String(response.error.value))
      return response.data
    },
  })
}

// ================================
// Donations & Payments
// ================================
export function useDonations() {
  return useQuery({
    queryKey: ['donations'],
    queryFn: async () => {
      const response = await api.hyperliquid.donations.get()
      if (response.error) throw new Error(String(response.error.value))
      return response.data
    },
  })
}

export function usePayments() {
  return useQuery({
    queryKey: ['payments'],
    queryFn: async () => {
      const response = await api.hyperliquid.payments.get()
      if (response.error) throw new Error(String(response.error.value))
      return response.data
    },
    refetchInterval: 30_000,
  })
}
