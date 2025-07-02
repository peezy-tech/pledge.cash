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
      return response?.tokens.reduce((acc, t) => {
        acc[t.name] = t
        return acc
      }, {} as Record<string, hl.SpotToken>)
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
        throw new Error(response.error.value as string)
      }
      return response.data
    },
  })
}

// Hook to create a new invoice
export function useCreateInvoiceMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (invoiceData: {
      payerAddress: string
      token: string
      amount: string
      description?: string
    }) => {
      const response = await api.hyperliquid.invoices.post(invoiceData)
      if (response.error) {
        throw new Error(response.error.value as string)
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
        throw new Error(response.error.value as string)
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
    mutationFn: async ({ tx }: { tx: `0x${string}` }) => {
      const response = await api.hyperliquid.multisig.post({ tx })
      if (response.error) {
        throw new Error(response.error.value as string)
      }
      return response.data
    },
  })
}
