export interface Invoice {
  id: string
  creatorId: string
  payerAddress: string
  payerUserId?: string | null
  paymentType?: 'personal' | 'pledge-wallet' | null
  actualPayerAddress?: string | null
  token: string
  amount: string
  description?: string | null
  status: 'pending' | 'paid' | 'expired'
  txHash?: string | null
  createdAt: number
  paidAt?: number | null
  expiresAt?: number | null
  creatorAddress?: string | null
}
