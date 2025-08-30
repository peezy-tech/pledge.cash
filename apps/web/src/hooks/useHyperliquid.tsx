import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useHyperliquid } from '../providers/HyperliquidProvider'
import { useAccount } from 'wagmi'
import * as hl from '@nktkas/hyperliquid'
import {
  useConvexInvoices,
  useConvexConfirmInvoice,
  useConvexCreateInvoice,
  useConvexInvoiceById,
  useConvexMyCampaigns,
  useConvexDiscoverCampaigns,
  useConvexCreateCampaign,
  useConvexMyPledges,
  useConvexCreatePledge,
  useConvexPreparePledgePayment,
  useConvexConfirmContribution,
  useConvexRecurring,
  useConvexListCharges,
  useConvexCreatePlan,
  useConvexUpdatePlan,
  useConvexRunPlanNow,
  useConvexOperator,
  useConvexPledgeWallet,
  useConvexInitPledgeWallet,
  useConvexDonations,
  useConvexPaymentsSummary,
} from './useConvexIntegration'

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
      if (!infoClient) throw new Error('Info client not available')
      const response = await infoClient.spotMeta()
      return response?.tokens.reduce(
        (acc, t) => {
          acc[t.name] = t
          return acc
        },
        {} as Record<string, hl.SpotToken>,
      )
    },
    enabled: true, // Always enabled since we have fallback mechanisms
    staleTime: 5 * 60 * 1000, // Consider data stale after 5 minutes
    refetchInterval: 5 * 60 * 1000, // Refetch every 5 minutes
  })
}

// Hook to fetch user's invoices
export function useHyperliquidInvoices() {
  const { data, isLoading } = useConvexInvoices()
  return { data, isLoading, error: undefined as any }
}

// Hook to get a single invoice by ID
export function useInvoiceById(invoiceId: string | undefined) {
  const { data, isLoading } = useConvexInvoiceById(invoiceId)
  return { data: data ?? null, isLoading, isError: false as any, error: undefined as any }
}

// Hook to create a new invoice
export function useCreateInvoiceMutation() {
  const queryClient = useQueryClient()
  const create = useConvexCreateInvoice()
  return useMutation({
    mutationFn: async (invoiceData: { payerAddress?: string; token: string; amount: string; description?: string }) =>
      create({ creatorId: undefined as any, payerUserId: undefined, payerAddress: invoiceData.payerAddress, token: invoiceData.token, amount: invoiceData.amount, description: invoiceData.description } as any),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invoices'] }),
  })
}

// Hook to confirm payment
export function useConfirmPaymentMutation() {
  const queryClient = useQueryClient()
  const confirm = useConvexConfirmInvoice()
  return useMutation({
    mutationFn: async ({ id, txHash }: { id: string; txHash: string }) => confirm({ id: id as any, txHash }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invoices'] }),
  })
}

export function useOperator() {
  const { data, isLoading } = useConvexOperator()
  return { data, isLoading }
}

export function usePledgeWallet() {
  const { data, isLoading } = useConvexPledgeWallet()
  return { data, isLoading }
}

export function useCreatePledgeWalletMutation() {
  const init = useConvexInitPledgeWallet()
  const { address } = useAccount()
  return useMutation({
    mutationFn: async ({ tx, agentWalletAddress }: { tx: `0x${string}`; agentWalletAddress: `0x${string}` }) =>
      init({ userAddress: (address as `0x${string}`) || ('' as any), agentWalletAddress, txHash: tx }),
  })
}

// Hook to get WebSocket client status
export function useWebSocketStatus() {
  const { isReady, error } = useHyperliquid()
  return { data: { success: true, data: { connected: isReady, lastUpdated: Date.now(), note: error ? `Error: ${error}` : 'OK' } }, isLoading: false }
}

// Enhanced hook to get spot tokens with mid prices and metadata
export function useSpotTokensWithPrices() {
  const { infoClient } = useHyperliquid()
  return useQuery({
    queryKey: ['spot-tokens-with-prices'],
    queryFn: async () => {
      if (!infoClient) throw new Error('Info client not available')
      const response = await infoClient.spotMeta()
      const tokens = response?.tokens.reduce(
        (acc, t) => {
          acc[t.name] = t
          return acc
        },
        {} as Record<string, hl.SpotToken>,
      )
      return { tokens, mids: null, lastUpdated: Date.now(), source: 'frontend', count: Object.keys(tokens).length }
    },
    enabled: true,
    staleTime: 2 * 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  })
}

// ================================
// Recurring Plans
// ================================
export function useRecurringPlans() {
  const { data, isLoading } = useConvexRecurring()
  return { data, isLoading }
}

export function useRecurringCharges(planId: string | undefined) {
  const { data, isLoading } = useConvexListCharges(planId)
  return { data: data || [], isLoading }
}

export function useCreateRecurringPlanMutation() {
  const create = useConvexCreatePlan()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: any) => create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recurring-plans'] }),
  })
}

export function useUpdateRecurringPlanMutation() {
  const update = useConvexUpdatePlan()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...patch }: any) => update({ id: id as any, ...patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recurring-plans'] }),
  })
}

export function useRunRecurringPlanMutation() {
  const run = useConvexRunPlanNow()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => run({ planId: id as any }),
    onSuccess: (_data, variables) => qc.invalidateQueries({ queryKey: ['recurring-charges', variables.id] }),
  })
}

// ================================
// Pledges & Campaigns
// ================================
export function usePledgeCampaigns() {
  const { data, isLoading } = useConvexMyCampaigns()
  return { data: { created: data || [] }, isLoading }
}

export function useDiscoverPledgeCampaigns() {
  const { data, isLoading } = useConvexDiscoverCampaigns()
  return { data: { active: data || [] }, isLoading }
}

export function useMyPledges() {
  const { data, isLoading } = useConvexMyPledges()
  return { data, isLoading }
}

export function useCreatePledgeCampaignMutation() {
  const create = useConvexCreateCampaign()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: any) => create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pledge-campaigns'] }),
  })
}

export function useCreatePledgeMutation() {
  const create = useConvexCreatePledge()
  return useMutation({ mutationFn: async (data: any) => create(data) })
}

export function usePayPledgeMutation() {
  const prepare = useConvexPreparePledgePayment()
  return useMutation({ mutationFn: async ({ id }: { id: string }) => prepare({ pledgeId: id as any }) })
}

export function useConfirmContributionMutation() {
  const confirm = useConvexConfirmContribution()
  return useMutation({ mutationFn: async ({ id, txHash }: { id: string; txHash: `0x${string}` }) => confirm({ contributionId: id as any, txHash }) })
}

// ================================
// Donations & Payments
// ================================
export function useDonations() {
  const { data, isLoading } = useConvexDonations()
  return { data, isLoading }
}

export function usePayments() {
  const { data, isLoading } = useConvexPaymentsSummary()
  return { data, isLoading }
}
