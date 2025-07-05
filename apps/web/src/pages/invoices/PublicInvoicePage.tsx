import { useParams } from '@tanstack/react-router'
import { useInvoiceById, useMultisig, useConfirmPaymentMutation } from '@/hooks/useHyperliquid'
import { usePayInvoice } from './usePayInvoice'
import { useMultisigClient } from '@/providers/MultisigProvider'
import { useHyperliquid } from '@/providers/HyperliquidProvider'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { useAccount } from 'wagmi'
import { useState } from 'react'
import { Shield, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { Toaster } from '@/components/ui/sonner'

// Enhanced Invoice type to match the new API response
interface ExtendedInvoice {
  id: string;
  creatorId: string;
  payerAddress: string | null;
  payerUserId?: string | null;
  paymentType?: "personal" | "multisig" | null;
  actualPayerAddress?: string | null;
  token: string;
  amount: string;
  description?: string | null;
  status: "pending" | "paid" | "expired";
  txHash?: string | null;
  createdAt: number;
  paidAt?: number | null;
  expiresAt?: number | null;
  creatorAddress?: string | null;
}

function formatDate(timestamp: number | null | undefined) {
  if (!timestamp) return 'N/A'
  return new Date(timestamp).toLocaleString()
}

function getStatusColor(status: string) {
  switch (status) {
    case 'paid':
      return 'bg-green-100 text-green-800'
    case 'pending':
      return 'bg-yellow-100 text-yellow-800'
    case 'expired':
      return 'bg-red-100 text-red-800'
    default:
      return 'bg-gray-100 text-gray-800'
  }
}

export function PublicInvoicePage() {
  const { invoiceId } = useParams({ from: '/invoices/$invoiceId' })
  const { data: invoice, isLoading, isError, error } = useInvoiceById(invoiceId)
  const {
    pay,
    isLoading: isPaying,
    error: paymentError,
  } = usePayInvoice()
  const { isConnected, address: userAddress } = useAccount()
  
  // Multisig related hooks and state
  const { data: multisig } = useMultisig()
  const multisigClient = useMultisigClient()
  const { infoClient } = useHyperliquid()
  const confirmPayment = useConfirmPaymentMutation()
  const [isPayingWithMultisig, setIsPayingWithMultisig] = useState(false)
  const [showMultisigConfirm, setShowMultisigConfirm] = useState(false)
  const [multisigPaymentError, setMultisigPaymentError] = useState<string | null>(null)

  // Type assertion for invoice to handle API type mismatch
  const typedInvoice = invoice as ExtendedInvoice | null

  const handlePayment = async () => {
    if (typedInvoice && typedInvoice.creatorAddress) {
      try {
        await pay(typedInvoice as any, typedInvoice.creatorAddress)
        // Optionally show a success message
      } catch (err) {
        // Error is already handled inside the hook, but you can add more logic here
      }
    }
  }

  const handleMultisigPayment = async () => {
    if (!typedInvoice || !multisigClient || !userAddress || !infoClient) {
      toast.error('Missing required data for multisig payment')
      return
    }

    setIsPayingWithMultisig(true)
    setMultisigPaymentError(null)
    
    try {
      // Record the timestamp before sending
      const sendTimestamp = Date.now()
      
      // Execute the multisig payment
      await multisigClient.client.spotSend({
        destination: typedInvoice.creatorAddress as `0x${string}`,
        token: typedInvoice.token as `${string}:0x${string}`,
        amount: typedInvoice.amount,
      })
      
      toast.success('Multisig payment sent, confirming...')
      
      // Wait for transaction to be indexed
      await new Promise(resolve => setTimeout(resolve, 3000))
      
      // Get the multisig transaction details to find the transaction hash
      const multisigDetails = await infoClient.userDetails({ user: multisigClient.address })
      
      // Find the most recent spot send transaction that matches our criteria
      const spotSendTx = multisigDetails
        .filter((tx: any) => 
          tx.action.type === 'spotSend' && 
          tx.time > sendTimestamp && // Transaction happened after we sent
          tx.action.destination?.toLowerCase() === typedInvoice.creatorAddress?.toLowerCase() &&
          tx.action.token === typedInvoice.token &&
          tx.action.amount === typedInvoice.amount &&
          tx.error === null // Transaction was successful
        )
        .sort((a: any, b: any) => b.time - a.time)[0] // Get the most recent one

      if (!spotSendTx || !spotSendTx.hash) {
        throw new Error("Could not find multisig transaction hash. Please try again or verify manually.")
      }

      const txHash = spotSendTx.hash
      console.log(`Found multisig transaction hash: ${txHash}`)

      // Confirm the payment with our backend
      await confirmPayment.mutateAsync({ id: typedInvoice.id, txHash })
      
      toast.success(`Successfully paid ${typedInvoice.amount} ${typedInvoice.token.split(':')[0]} from multisig`)
      setShowMultisigConfirm(false)
      
    } catch (error) {
      console.error('Multisig payment failed:', error)
      const errorMessage = error instanceof Error ? error.message : 'Multisig payment failed'
      setMultisigPaymentError(errorMessage)
      toast.error(errorMessage)
    } finally {
      setIsPayingWithMultisig(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <p>Loading invoice...</p>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex justify-center items-center h-screen">
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            {error?.message || 'Failed to load invoice.'}
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  if (!invoice) {
    return (
      <div className="flex justify-center items-center h-screen">
        <Alert>
          <AlertTitle>Invoice Not Found</AlertTitle>
          <AlertDescription>
            The invoice you are looking for does not exist or could not be found.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  const canPay = typedInvoice && typedInvoice.status === 'pending'
  const hasMultisig = multisig?.address && multisigClient?.address
  const tokenSymbol = typedInvoice ? typedInvoice.token.split(':')[0] : ''

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>Invoice #{typedInvoice?.id.slice(0, 8)}</CardTitle>
            <Badge className={getStatusColor(typedInvoice?.status || 'pending')}>
              {(typedInvoice?.status || 'pending').toUpperCase()}
            </Badge>
          </div>
          <CardDescription>
            {typedInvoice?.description || 'No description provided.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-medium text-gray-500">Amount</p>
              <p className="text-lg font-semibold">
                {typedInvoice?.amount} {tokenSymbol}
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">Payer</p>
              <p className="text-sm font-mono break-all">
                {typedInvoice?.payerAddress || 'Any address'}
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">Creator</p>
              <p className="text-sm font-mono break-all">
                {typedInvoice?.creatorAddress}
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">Date Created</p>
              <p className="text-sm">{formatDate(typedInvoice?.createdAt)}</p>
            </div>
            {typedInvoice?.paidAt && (
              <div>
                <p className="text-sm font-medium text-gray-500">Date Paid</p>
                <p className="text-sm">{formatDate(typedInvoice.paidAt)}</p>
              </div>
            )}
          </div>
          
          {/* NEW: Address abstraction info */}
          {typedInvoice?.status === 'paid' && (typedInvoice?.paymentType || typedInvoice?.actualPayerAddress) && (
            <div className="border-t pt-4">
              <p className="text-sm font-medium text-gray-500 mb-2">Payment Details</p>
              <div className="grid grid-cols-2 gap-4">
                {typedInvoice.paymentType && (
                  <div>
                    <p className="text-sm font-medium text-gray-500">Payment Type</p>
                    <div className="flex items-center gap-2">
                      {typedInvoice.paymentType === 'multisig' ? (
                        <Shield className="h-4 w-4 text-blue-500" />
                      ) : (
                        <Wallet className="h-4 w-4 text-green-500" />
                      )}
                      <span className="text-sm capitalize">{typedInvoice.paymentType}</span>
                    </div>
                  </div>
                )}
                {typedInvoice.actualPayerAddress && (
                  <div>
                    <p className="text-sm font-medium text-gray-500">Actual Payer</p>
                    <p className="text-sm font-mono break-all">{typedInvoice.actualPayerAddress}</p>
                  </div>
                )}
              </div>
            </div>
          )}
          
          {typedInvoice?.txHash && (
            <div>
              <p className="text-sm font-medium text-gray-500">
                Transaction Hash
              </p>
              <p className="text-sm font-mono break-all">{typedInvoice.txHash}</p>
            </div>
          )}
        </CardContent>
        {canPay && (
          <CardFooter className="flex flex-col items-stretch space-y-3">
            {!isConnected ? (
              <p className="text-center text-sm text-red-500 mt-2">Please connect your wallet to pay.</p>
            ) : (
              <>
                {/* Regular payment button */}
                <Button onClick={handlePayment} disabled={isPaying} className="w-full">
                  <Wallet className="h-4 w-4 mr-2" />
                  {isPaying ? 'Processing Payment...' : `Pay ${invoice.amount} ${tokenSymbol}`}
                </Button>
                
                {/* Multisig payment button */}
                {hasMultisig && (
                  <Dialog open={showMultisigConfirm} onOpenChange={setShowMultisigConfirm}>
                    <DialogTrigger asChild>
                      <Button variant="outline" className="w-full">
                        <Shield className="h-4 w-4 mr-2" />
                        Pay with Multisig
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Confirm Multisig Payment</DialogTitle>
                        <DialogDescription>
                          Are you sure you want to pay this invoice from your multisig wallet?
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <Label>From (Multisig)</Label>
                          <code className="text-sm bg-muted px-2 py-1 rounded block truncate">
                            {multisigClient?.address}
                          </code>
                        </div>
                        <div className="space-y-2">
                          <Label>To (Invoice Creator)</Label>
                          <code className="text-sm bg-muted px-2 py-1 rounded block truncate">
                            {invoice.creatorAddress}
                          </code>
                        </div>
                        <div className="space-y-2">
                          <Label>Amount</Label>
                          <p className="text-lg font-semibold">{invoice.amount} {tokenSymbol}</p>
                        </div>
                        <div className="space-y-2">
                          <Label>Token</Label>
                          <p className="text-sm">{invoice.token}</p>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setShowMultisigConfirm(false)}>
                          Cancel
                        </Button>
                        <Button onClick={handleMultisigPayment} disabled={isPayingWithMultisig}>
                          {isPayingWithMultisig ? 'Processing...' : 'Confirm Payment'}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}
                
                {!hasMultisig && (
                  <p className="text-center text-sm text-muted-foreground">
                    Create a multisig wallet to enable multisig payments
                  </p>
                )}
              </>
            )}
            
            {/* Error messages */}
            {paymentError && (
              <Alert variant="destructive" className="mt-4">
                <AlertTitle>Payment Failed</AlertTitle>
                <AlertDescription>{paymentError}</AlertDescription>
              </Alert>
            )}
            
            {multisigPaymentError && (
              <Alert variant="destructive" className="mt-4">
                <AlertTitle>Multisig Payment Failed</AlertTitle>
                <AlertDescription>{multisigPaymentError}</AlertDescription>
              </Alert>
            )}
          </CardFooter>
        )}
      </Card>
      <Toaster />
    </div>
  )
} 