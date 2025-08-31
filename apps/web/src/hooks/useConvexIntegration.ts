import { useEffect, useMemo } from 'react'
import { useQuery as useConvexQuery, useAction, useMutation as useConvexMutation } from 'convex/react'
import { api } from '../../../convex/convex/_generated/api'
import { useAuth } from '@/providers/AuthProvider'

export function useConvexUser() {
  const { walletAddress } = useAuth()
  const user = useConvexQuery(api.users.findByEvm, walletAddress ? { evmAddress: walletAddress } : undefined)
  return { user, walletAddress }
}

// Invoices
export function useConvexInvoices() {
  const { user, walletAddress } = useConvexUser()
  const args = useMemo(() => (user ? { userId: user._id, walletAddress: walletAddress ?? undefined } : undefined), [user, walletAddress])
  const data = useConvexQuery(api.invoices.listForUser, args)
  return { data, isLoading: data === undefined }
}

export function useConvexConfirmInvoice() {
  const confirm = useAction(api.invoices.confirm)
  return confirm
}

export function useConvexCreateInvoice() {
  const mut = useConvexMutation(api.invoices.create)
  const { user } = useConvexUser()
  // Ensure callers cannot override creatorId; it is always derived from the authenticated user
  return async (args: { payerUserId?: string; payerAddress?: string; token: string; amount: string; description?: string }) => {
    if (!user) throw new Error('Not authenticated')
    // Place creatorId after spread so any accidental field in args won't override it
    return mut({ ...args, creatorId: user._id } as any)
  }
}

export function useConvexInvoiceById(id?: string) {
  const inv = useConvexQuery(api.invoices.get, id ? { id: id as any } : undefined)
  const creator = useConvexQuery(api.users.getById, inv ? { id: inv.creatorId as any } : undefined)
  const invoiceWithCreator = useMemo(() => {
    if (!inv) return undefined
    return { ...inv, creatorAddress: creator?.evmAddress ?? null }
  }, [inv, creator])
  return { data: invoiceWithCreator, isLoading: invoiceWithCreator === undefined }
}

// Campaigns & Pledges
export function useConvexDiscoverCampaigns() {
  const data = useConvexQuery(api.campaigns.listActiveCampaigns, {})
  return { data, isLoading: data === undefined }
}

export function useConvexMyCampaigns() {
  const { user } = useConvexUser()
  const args = useMemo(() => (user ? { creatorId: user._id } : undefined), [user])
  const data = useConvexQuery(api.campaigns.listCampaignsByCreator, args)
  return { data, isLoading: data === undefined }
}

export function useConvexCreateCampaign() {
  const mut = useConvexMutation(api.campaigns.createCampaign)
  const { user } = useConvexUser()
  return async (args: any) => {
    if (!user) throw new Error('Not authenticated')
    return mut({ creatorId: user._id, ...args })
  }
}

export function useConvexMyPledges() {
  const { user, walletAddress } = useConvexUser()
  const listByUser = useConvexQuery(api.campaigns.listPledgesByPledgerUser, user ? { pledgerUserId: user._id } : undefined)
  const listByAddress = useConvexQuery(api.campaigns.listPledgesByPledgerAddress, walletAddress ? { address: walletAddress } : undefined)
  const pledges = useMemo(() => ({ pledges: [...(listByUser || []), ...(listByAddress || [])] }), [listByUser, listByAddress])
  const isLoading = listByUser === undefined || listByAddress === undefined
  return { data: pledges, isLoading }
}

export function useConvexCreatePledge() {
  return useConvexMutation(api.campaigns.createPledge)
}

export function useConvexPreparePledgePayment() {
  return useConvexMutation(api.campaigns.preparePledgePayment)
}

export function useConvexConfirmContribution() {
  return useAction(api.campaigns.confirmPledgeContribution)
}

// Donations
export function useConvexDonations() {
  const { user } = useConvexUser()
  const data = useConvexQuery(api.campaigns.listDonationsByCreator, user ? { creatorId: user._id } : undefined)
  return { data, isLoading: data === undefined }
}

export function useConvexRecordDonation() {
  return useConvexMutation(api.campaigns.recordDonation)
}

// Recurring
export function useConvexRecurring() {
  const { user, walletAddress } = useConvexUser()
  const data = useConvexQuery(api.recurring.listPlansForUser, user && walletAddress ? { userId: user._id, walletAddress } : undefined)
  return { data, isLoading: data === undefined }
}

export function useConvexCreatePlan() {
  const mut = useConvexMutation(api.recurring.createPlan)
  const { user } = useConvexUser()
  return async (args: any) => {
    if (!user) throw new Error('Not authenticated')
    return mut({ creatorId: user._id, ...args })
  }
}

export function useConvexUpdatePlan() {
  return useConvexMutation(api.recurring.updatePlan)
}

export function useConvexListCharges(planId?: string) {
  const data = useConvexQuery(api.recurring.listCharges, planId ? { planId: planId as any } : undefined)
  return { data, isLoading: data === undefined }
}

export function useConvexRunPlanNow() {
  return useAction(api.recurring.runNow)
}

// Payments summary
export function useConvexPaymentsSummary() {
  const { user } = useConvexUser()
  const data = useConvexQuery(api.payments.listSummaryForUser, user ? { userId: user._id } : undefined)
  return { data, isLoading: data === undefined }
}

// Pledge wallet
export function useConvexOperator() {
  const data = useConvexQuery(api.pledgeWallet.getOperator, {})
  return { data, isLoading: data === undefined }
}

export function useConvexPledgeWallet() {
  const { walletAddress } = useAuth()
  const data = useConvexQuery(api.pledgeWallet.getByUserAddress, walletAddress ? { userAddress: walletAddress } : undefined)
  return { data, isLoading: data === undefined }
}

export function useConvexInitPledgeWallet() {
  return useAction(api.pledgeWallet.init)
}

// Market (spot tokens)
export function useConvexSpotTokens() {
  const action = useAction(api.market.spotTokens)
  return action
}
