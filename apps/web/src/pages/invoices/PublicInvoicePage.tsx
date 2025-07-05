import { useParams } from '@tanstack/react-router'
import { useInvoiceById } from '@/hooks/useHyperliquid'
import { usePayInvoice } from './usePayInvoice'
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
import { useAccount } from 'wagmi'

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
  const { isConnected } = useAccount()

  const handlePayment = async () => {
    if (invoice && invoice.creatorAddress) {
      try {
        await pay(invoice, invoice.creatorAddress)
        // Optionally show a success message
      } catch (err) {
        // Error is already handled inside the hook, but you can add more logic here
      }
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

  const canPay = invoice.status === 'pending'

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>Invoice #{invoice.id.slice(0, 8)}</CardTitle>
            <Badge className={getStatusColor(invoice.status)}>
              {invoice.status.toUpperCase()}
            </Badge>
          </div>
          <CardDescription>
            {invoice.description || 'No description provided.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-medium text-gray-500">Amount</p>
              <p className="text-lg font-semibold">
                {invoice.amount} {invoice.token.split(':')[0]}
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">Payer</p>
              <p className="text-sm font-mono break-all">{invoice.payerAddress}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">Creator</p>
              <p className="text-sm font-mono break-all">
                {invoice.creatorAddress}
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">Date Created</p>
              <p className="text-sm">{formatDate(invoice.createdAt)}</p>
            </div>
            {invoice.paidAt && (
              <div>
                <p className="text-sm font-medium text-gray-500">Date Paid</p>
                <p className="text-sm">{formatDate(invoice.paidAt)}</p>
              </div>
            )}
          </div>
          {invoice.txHash && (
            <div>
              <p className="text-sm font-medium text-gray-500">
                Transaction Hash
              </p>
              <p className="text-sm font-mono break-all">{invoice.txHash}</p>
            </div>
          )}
        </CardContent>
        {canPay && (
          <CardFooter className="flex flex-col items-stretch">
             {!isConnected ? (
               <p className="text-center text-sm text-red-500 mt-2">Please connect your wallet to pay.</p>
             ) : (
                <Button onClick={handlePayment} disabled={isPaying}>
                  {isPaying ? 'Processing Payment...' : `Pay ${invoice.amount} ${invoice.token.split(':')[0]}`}
                </Button>
             )}
            {paymentError && (
              <Alert variant="destructive" className="mt-4">
                <AlertTitle>Payment Failed</AlertTitle>
                <AlertDescription>{paymentError}</AlertDescription>
              </Alert>
            )}
          </CardFooter>
        )}
      </Card>
    </div>
  )
} 