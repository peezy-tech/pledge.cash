import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
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
  const { infoClient, isReady } = useHyperliquid()

  return useQuery({
    queryKey: ['spot-tokens'],
    queryFn: async () => {
      const response = await infoClient?.spotMeta()
      return response?.tokens.reduce(
        (acc, t) => {
          acc[t.name] = t
          return acc
        },
        {} as Record<string, hl.SpotToken>,
      )
    },
    enabled: isReady && !!infoClient,
  })
}

// Hook to fetch user's invoices
export function useHyperliquidInvoices() {
  return useQuery({
    queryKey: ['invoices'],
    queryFn: async () => {
      const response = await api.hyperliquid.invoices.get()
      if (response.error) {
        const errorMessage = typeof response.error.value === 'object' 
          ? JSON.stringify(response.error.value) 
          : response.error.value as string;
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
        throw new Error(response.error.value as string)
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

  return useMutation({
    mutationFn: async (invoiceData: {
      payerAddress?: string
      token: string
      amount: string
      description?: string
      webhookUrl?: string
    }) => {
      const response = await api.hyperliquid.invoices.post(invoiceData)
      if (response.error) {
        const errorMessage = typeof response.error.value === 'object' 
          ? JSON.stringify(response.error.value) 
          : response.error.value as string;
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
        const errorMessage = typeof response.error.value === 'object'
          ? JSON.stringify(response.error.value)
          : response.error.value as string;
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

export function useMultisig() {
  return useQuery({
    queryKey: ['multisig'],
    queryFn: async () => {
      const response = await api.hyperliquid.multisig.get()
      return response.data
    },
  })
}

export function useCreateMultisigMutation() {
  return useMutation({
    mutationFn: async ({
      tx,
      agentWalletAddress,
    }: {
      tx: `0x${string}`
      agentWalletAddress: `0x${string}`
    }) => {
      const response = await api.hyperliquid.multisig.post({
        tx,
        agentWalletAddress,
      })
      if (response.error) {
        const errorMessage = typeof response.error.value === 'object'
          ? JSON.stringify(response.error.value)
          : response.error.value as string;
        throw new Error(errorMessage || 'Failed to create multisig')
      }
      return response.data
    },
  })
}
