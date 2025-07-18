import { useState } from 'react'
import { useAccount } from 'wagmi'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { usePayInvoice } from './usePayInvoice'
import { useConfirmPaymentMutation } from '@/hooks/useHyperliquid'
import { ClipboardCopy } from 'lucide-react'
import type { Invoice } from './interfaces'

interface InvoiceListItemProps {
  invoice: Invoice
  type: 'created' | 'received'
}

export function InvoiceListItem({ invoice, type }: InvoiceListItemProps) {
  const { address } = useAccount()
  const { pay, isLoading, error, clearError } = usePayInvoice()
  const confirmPayment = useConfirmPaymentMutation()
  const [showPaymentDetails, setShowPaymentDetails] = useState(false)
  const [showManualConfirm, setShowManualConfirm] = useState(false)
  const [txHashInput, setTxHashInput] = useState('')
  const [manualConfirmError, setManualConfirmError] = useState<string | null>(
    null,
  )
  const [copied, setCopied] = useState(false)

  const canPay =
    type === 'received' &&
    invoice.status === 'pending' &&
    address?.toLowerCase() === invoice.payerAddress?.toLowerCase() &&
    invoice.creatorAddress

  const canManualConfirm = invoice.status === 'pending'

  const handlePay = async () => {
    if (!invoice.creatorAddress) return

    try {
      clearError()
      await pay(invoice, invoice.creatorAddress)
      setShowPaymentDetails(false)
    } catch (error) {
      console.error('Payment failed:', error)
    }
  }

  const handleManualConfirm = async () => {
    if (!txHashInput.trim()) {
      setManualConfirmError('Transaction hash is required')
      return
    }

    if (!txHashInput.match(/^0x[a-fA-F0-9]{64}$/)) {
      setManualConfirmError('Invalid transaction hash format')
      return
    }

    try {
      setManualConfirmError(null)
      await confirmPayment.mutateAsync({
        id: invoice.id,
        txHash: txHashInput.trim(),
      })
      setShowManualConfirm(false)
      setTxHashInput('')
    } catch (error) {
      console.error('Manual confirmation failed:', error)
      setManualConfirmError(
        error instanceof Error ? error.message : 'Failed to confirm payment',
      )
    }
  }

  const handleCopyLink = () => {
    const link = `${window.location.origin}/invoices/${invoice.id}`
    navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000) // Reset after 2 seconds
  }

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid':
        return 'text-green-600 bg-green-100'
      case 'pending':
        return 'text-yellow-600 bg-yellow-100'
      case 'expired':
        return 'text-red-600 bg-red-100'
      default:
        return 'text-gray-600 bg-gray-100'
    }
  }

  const parseTokenName = (token: string) => {
    return token.split(':')[0] // Extract token name from "TOKEN:0x..." format
  }

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg">
              {parseTokenName(invoice.token)} {invoice.amount}
            </CardTitle>
            <CardDescription>
              {type === 'created'
                ? invoice.payerUserId
                  ? `Invoice to ${invoice.payerUserId}`
                  : 'Payable by link (no specific payer)'
                : `Invoice from ${invoice.creatorId}`}
            </CardDescription>
          </div>
          <div className="flex flex-col items-end space-y-2">
            <span
              className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(invoice.status)}`}
            >
              {invoice.status.toUpperCase()}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopyLink}
              className="text-xs h-8"
            >
              {copied ? (
                'Copied!'
              ) : (
                <>
                  <ClipboardCopy className="mr-1 h-3 w-3" />
                  Copy Link
                </>
              )}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {invoice.description && (
          <div>
            <p className="font-medium text-sm text-gray-700">Description:</p>
            <p className="text-sm text-gray-600">{invoice.description}</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="font-medium text-gray-700">Created:</p>
            <p className="text-gray-600">{formatDate(invoice.createdAt)}</p>
          </div>
          {invoice.paidAt && (
            <div>
              <p className="font-medium text-gray-700">Paid:</p>
              <p className="text-gray-600">{formatDate(invoice.paidAt)}</p>
            </div>
          )}
        </div>

        {invoice.txHash && (
          <div className="text-sm">
            <p className="font-medium text-gray-700">Transaction Hash:</p>
            <p className="text-gray-600 font-mono break-all">
              {invoice.txHash}
            </p>
          </div>
        )}

        {/* NEW: Payment method information for paid invoices */}
        {invoice.status === 'paid' &&
          (invoice.paymentType || invoice.actualPayerAddress) && (
            <div className="text-sm border-t pt-3">
              <p className="font-medium text-gray-700 mb-2">Payment Details:</p>
              <div className="grid grid-cols-1 gap-2">
                {invoice.paymentType && (
                  <div className="flex items-center gap-2">
                    <span className="text-gray-600">Method:</span>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                        invoice.paymentType === 'pledge-wallet'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-green-100 text-green-800'
                      }`}
                    >
                      {invoice.paymentType === 'pledge-wallet' ? '🔒' : '👤'}
                      {invoice.paymentType === 'pledge-wallet'
                        ? 'Pledge Wallet'
                        : 'Personal'}
                    </span>
                  </div>
                )}
                {invoice.actualPayerAddress && (
                  <div>
                    <span className="text-gray-600">Paid from:</span>{' '}
                    <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">
                      {invoice.actualPayerAddress.slice(0, 6)}...
                      {invoice.actualPayerAddress.slice(-4)}
                    </code>
                  </div>
                )}
              </div>
            </div>
          )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {(manualConfirmError || confirmPayment.error) && (
          <Alert variant="destructive">
            <AlertDescription>
              {manualConfirmError || confirmPayment.error?.message}
            </AlertDescription>
          </Alert>
        )}

        {/* Manual Confirm Section - Available for all pending invoices */}
        {canManualConfirm && (
          <>
            <Separator />
            <div className="space-y-3">
              {!showManualConfirm ? (
                <Button
                  onClick={() => setShowManualConfirm(true)}
                  variant="outline"
                  className="w-full"
                >
                  Manual Confirm Invoice
                </Button>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="txHash">Transaction Hash</Label>
                    <Input
                      id="txHash"
                      type="text"
                      placeholder="0x..."
                      value={txHashInput}
                      onChange={(e) => setTxHashInput(e.target.value)}
                      className="font-mono"
                    />
                    <p className="text-xs text-gray-500">
                      Enter the transaction hash for this payment
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      onClick={handleManualConfirm}
                      disabled={confirmPayment.isPending}
                      className="flex-1"
                    >
                      {confirmPayment.isPending
                        ? 'Confirming...'
                        : 'Confirm Payment'}
                    </Button>
                    <Button
                      onClick={() => {
                        setShowManualConfirm(false)
                        setTxHashInput('')
                        setManualConfirmError(null)
                      }}
                      variant="outline"
                      disabled={confirmPayment.isPending}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* Automatic Payment Section - Only for received invoices */}
        {canPay && (
          <>
            <Separator />
            <div className="space-y-3">
              {!showPaymentDetails ? (
                <Button
                  onClick={() => setShowPaymentDetails(true)}
                  className="w-full"
                  variant="default"
                >
                  Pay Invoice
                </Button>
              ) : (
                <div className="space-y-3">
                  <Alert>
                    <AlertDescription>
                      You are about to pay {invoice.amount}{' '}
                      {parseTokenName(invoice.token)} to{' '}
                      {invoice.creatorAddress?.slice(0, 6)}...
                      {invoice.creatorAddress?.slice(-4)}. This action cannot be
                      undone.
                    </AlertDescription>
                  </Alert>

                  <div className="flex gap-2">
                    <Button
                      onClick={handlePay}
                      disabled={isLoading}
                      className="flex-1"
                    >
                      {isLoading ? 'Processing...' : 'Confirm Payment'}
                    </Button>
                    <Button
                      onClick={() => setShowPaymentDetails(false)}
                      variant="outline"
                      disabled={isLoading}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
