import { createRoute, type RootRoute } from '@tanstack/react-router'
import { PageLayout } from '@/components/PageLayout'
import {
  useOperator,
  useMultisig,
  useCreateMultisigMutation,
  useSpotTokens,
  useHyperliquidSpotBalances,
} from '@/hooks/useHyperliquid'
import { Button } from '@/components/ui/button'
import { useHyperliquid } from '@/providers/HyperliquidProvider'
import { useMultisigClient } from '@/providers/MultisigProvider'
import { useAccount } from 'wagmi'
import { SpotBalances } from '@/components/SpotBalances'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Toaster } from '@/components/ui/sonner'
import { toast } from 'sonner'
import { useState } from 'react'
import { Copy, ExternalLink, ArrowUpRight, ArrowDownLeft, Shield, AlertTriangle } from 'lucide-react'
import { SwapComponent } from './SwapComponent'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

function MultisigInfo() {
  const multisigClient = useMultisigClient()
  const { data: multisig } = useMultisig()
  const { exchangeClient } = useHyperliquid()
  const { data: spotTokens } = useSpotTokens()
  const { address: userAddress } = useAccount()
  const { data: userBalances } = useHyperliquidSpotBalances(userAddress)
  const { data: multisigBalances } = useHyperliquidSpotBalances(multisigClient?.address ? multisigClient.address as `0x${string}` : undefined)
  
  const [transferAmount, setTransferAmount] = useState('')
  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [isTransferring, setIsTransferring] = useState(false)
  const [isWithdrawing, setIsWithdrawing] = useState(false)
  const [showTransferDialog, setShowTransferDialog] = useState(false)
  const [showWithdrawDialog, setShowWithdrawDialog] = useState(false)
  const [showTransferConfirm, setShowTransferConfirm] = useState(false)
  const [showWithdrawConfirm, setShowWithdrawConfirm] = useState(false)

  if (!multisigClient || !multisig) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Multisig Wallet
          </CardTitle>
          <CardDescription>
            No multisig wallet found. Create one to get started.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const { address, client } = multisigClient
  const userUsdcBalance = userBalances?.balances.find(b => b.coin === 'USDC')
  const multisigUsdcBalance = multisigBalances?.balances.find(b => b.coin === 'USDC')

  const copyAddress = () => {
    navigator.clipboard.writeText(address)
    toast.success('Address copied to clipboard')
  }

  const openInExplorer = () => {
    window.open(`https://testnet.hyperliquid.xyz/address/${address}`, '_blank')
  }

  const handleTransfer = async () => {
    if (!transferAmount || isNaN(Number(transferAmount))) {
      toast.error('Please enter a valid amount')
      return
    }

    if (!exchangeClient || !spotTokens?.USDC || !address) {
      toast.error('Missing required data')
      return
    }

    const numAmount = Number(transferAmount)
    const availableBalance = Number(userUsdcBalance?.total || 0)

    if (numAmount > availableBalance) {
      toast.error('Insufficient balance')
      return
    }

    setIsTransferring(true)
    try {
      await exchangeClient.spotSend({
        destination: address as `0x${string}`,
        token: `${spotTokens.USDC.name}:${spotTokens.USDC.tokenId}`,
        amount: transferAmount,
      })
      
      toast.success(`Successfully transferred ${transferAmount} USDC to multisig`)
      setTransferAmount('')
      setShowTransferDialog(false)
      setShowTransferConfirm(false)
    } catch (error) {
      console.error('Transfer failed:', error)
      toast.error('Transfer failed. Please try again.')
    } finally {
      setIsTransferring(false)
    }
  }

  const handleWithdraw = async () => {
    if (!withdrawAmount || isNaN(Number(withdrawAmount))) {
      toast.error('Please enter a valid amount')
      return
    }

    if (!userAddress || !spotTokens?.USDC) {
      toast.error('Missing required data')
      return
    }

    const numAmount = Number(withdrawAmount)
    const availableBalance = Number(multisigUsdcBalance?.total || 0)

    if (numAmount > availableBalance) {
      toast.error('Insufficient multisig balance')
      return
    }

    setIsWithdrawing(true)
    try {
      await client.spotSend({
        destination: userAddress,
        token: `${spotTokens.USDC.name}:${spotTokens.USDC.tokenId}`,
        amount: withdrawAmount,
      })
      
      toast.success(`Successfully withdrew ${withdrawAmount} USDC from multisig`)
      setWithdrawAmount('')
      setShowWithdrawDialog(false)
      setShowWithdrawConfirm(false)
    } catch (error) {
      console.error('Withdrawal failed:', error)
      toast.error('Withdrawal failed. Please try again.')
    } finally {
      setIsWithdrawing(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Multisig Wallet
          <Badge variant="secondary">Active</Badge>
        </CardTitle>
        <CardDescription>
          Your multisig wallet for secure transactions
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Label className="text-sm font-medium">Address:</Label>
          <code className="text-sm bg-muted px-2 py-1 rounded flex-1 truncate">
            {address}
          </code>
          <Button size="sm" variant="outline" onClick={copyAddress}>
            <Copy className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={openInExplorer}>
            <ExternalLink className="h-4 w-4" />
          </Button>
        </div>
        <SpotBalances address={address as `0x${string}`} />
        
        <div className="flex gap-2">
          <Dialog open={showTransferDialog} onOpenChange={setShowTransferDialog}>
            <DialogTrigger asChild>
              <Button className="flex-1" variant="outline">
                <ArrowUpRight className="h-4 w-4 mr-2" />
                Transfer In
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Transfer to Multisig</DialogTitle>
                <DialogDescription>
                  Send USDC from your wallet to the multisig
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="transfer-amount">Amount (USDC)</Label>
                  <Input
                    id="transfer-amount"
                    type="number"
                    placeholder="0.00"
                    value={transferAmount}
                    onChange={(e) => setTransferAmount(e.target.value)}
                    min="0"
                    step="0.01"
                  />
                  <p className="text-sm text-muted-foreground">
                    Available: {userUsdcBalance?.total || '0'} USDC
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowTransferDialog(false)}>
                  Cancel
                </Button>
                <Dialog open={showTransferConfirm} onOpenChange={setShowTransferConfirm}>
                  <DialogTrigger asChild>
                    <Button 
                      disabled={!transferAmount || isNaN(Number(transferAmount)) || Number(transferAmount) <= 0}
                    >
                      Review Transfer
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Confirm Transfer</DialogTitle>
                      <DialogDescription>
                        Are you sure you want to transfer {transferAmount} USDC to the multisig wallet?
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label>From (Your Wallet)</Label>
                        <code className="text-sm bg-muted px-2 py-1 rounded block truncate">
                          {userAddress}
                        </code>
                      </div>
                      <div className="space-y-2">
                        <Label>To (Multisig)</Label>
                        <code className="text-sm bg-muted px-2 py-1 rounded block truncate">
                          {address}
                        </code>
                      </div>
                      <div className="space-y-2">
                        <Label>Amount</Label>
                        <p className="text-lg font-semibold">{transferAmount} USDC</p>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setShowTransferConfirm(false)}>
                        Cancel
                      </Button>
                      <Button onClick={handleTransfer} disabled={isTransferring}>
                        {isTransferring ? 'Transferring...' : 'Confirm Transfer'}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={showWithdrawDialog} onOpenChange={setShowWithdrawDialog}>
            <DialogTrigger asChild>
              <Button className="flex-1" variant="outline">
                <ArrowDownLeft className="h-4 w-4 mr-2" />
                Withdraw
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Withdraw from Multisig</DialogTitle>
                <DialogDescription>
                  Send USDC from the multisig to your wallet
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="withdraw-amount">Amount (USDC)</Label>
                  <Input
                    id="withdraw-amount"
                    type="number"
                    placeholder="0.00"
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    min="0"
                    step="0.01"
                  />
                  <p className="text-sm text-muted-foreground">
                    Available: {multisigUsdcBalance?.total || '0'} USDC
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowWithdrawDialog(false)}>
                  Cancel
                </Button>
                <Dialog open={showWithdrawConfirm} onOpenChange={setShowWithdrawConfirm}>
                  <DialogTrigger asChild>
                    <Button 
                      disabled={!withdrawAmount || isNaN(Number(withdrawAmount)) || Number(withdrawAmount) <= 0}
                    >
                      Review Withdrawal
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Confirm Withdrawal</DialogTitle>
                      <DialogDescription>
                        Are you sure you want to withdraw {withdrawAmount} USDC from the multisig wallet?
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label>From (Multisig)</Label>
                        <code className="text-sm bg-muted px-2 py-1 rounded block truncate">
                          {address}
                        </code>
                      </div>
                      <div className="space-y-2">
                        <Label>To (Your Wallet)</Label>
                        <code className="text-sm bg-muted px-2 py-1 rounded block truncate">
                          {userAddress}
                        </code>
                      </div>
                      <div className="space-y-2">
                        <Label>Amount</Label>
                        <p className="text-lg font-semibold">{withdrawAmount} USDC</p>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setShowWithdrawConfirm(false)}>
                        Cancel
                      </Button>
                      <Button onClick={handleWithdraw} disabled={isWithdrawing}>
                        {isWithdrawing ? 'Withdrawing...' : 'Confirm Withdrawal'}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardContent>
    </Card>
  )
}

function CreateMultisigSection() {
  const { data: operator } = useOperator()
  const { data: multisig } = useMultisig()
  const { mutate: createMultisig } = useCreateMultisigMutation()
  const { data: spotTokens } = useSpotTokens()
  const { exchangeClient, infoClient } = useHyperliquid()
  const [isCreating, setIsCreating] = useState(false)

  const sendSeedTx = async () => {
    if (!operator?.operator || !spotTokens?.USDC) {
      toast.error('Missing operator or USDC token')
      return
    }

    setIsCreating(true)
    try {
      let agentPrivateKey = localStorage.getItem('agentPrivateKey');
      if (!agentPrivateKey) {
        agentPrivateKey = generatePrivateKey();
        localStorage.setItem('agentPrivateKey', agentPrivateKey);
      }
      const agentAccount = privateKeyToAccount(agentPrivateKey as `0x${string}`);

      const tokenIdentifier = `${spotTokens.USDC.name}:${spotTokens.USDC.tokenId}` as const
      
      const tx = await exchangeClient?.spotSend({
        destination: operator.operator,
        token: tokenIdentifier,
        amount: '5',
      })

      toast.success('Seed transaction sent, creating multisig...')
      
      // Wait for tx to be indexed
      await new Promise((resolve) => setTimeout(resolve, 1000))

      const userDetails = await infoClient?.userDetails({
        user: operator.operator,
      })

      const txHash = userDetails
        ?.filter((tx) => {
          const matches =
            tx.action.type === 'spotSend' &&
            tx.action.destination &&
            typeof tx.action.destination === 'string' &&
            tx.action.destination.toLowerCase() === operator.operator?.toLowerCase() &&
            tx.action.token === tokenIdentifier &&
            tx.action.amount === '5' &&
            tx.error === null

          return matches
        })
        ?.sort((a, b) => b.time - a.time)[0]?.hash

      if (!txHash) {
        throw new Error('Transaction not found')
      }

      createMultisig({ tx: txHash, agentWalletAddress: agentAccount.address })
      toast.success('Multisig created successfully!')
    } catch (error) {
      console.error('Create multisig failed:', error)
      toast.error('Failed to create multisig. Please try again.')
    } finally {
      setIsCreating(false)
    }
  }

  if (multisig?.address) {
    return null // Don't show create section if multisig already exists
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Create Multisig Wallet
        </CardTitle>
        <CardDescription>
          Initialize a new multisig wallet for secure transactions
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Creating a multisig requires a 5 USDC seed transaction to the operator.
          </AlertDescription>
        </Alert>
        
        <div className="space-y-2">
          <Label>Operator Address</Label>
          <code className="text-sm bg-muted px-2 py-1 rounded block truncate">
            {operator?.operator || 'Loading...'}
          </code>
        </div>
        
        <Button 
          onClick={sendSeedTx} 
          disabled={isCreating || !operator?.operator}
          className="w-full"
        >
          {isCreating ? 'Creating Multisig...' : 'Create Multisig (5 USDC)'}
        </Button>
      </CardContent>
    </Card>
  )
}

export function MultisigPage() {
  const { data: multisig } = useMultisig()

  return (
    <PageLayout title="Multisig">
      <div className="space-y-6">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-6">
            <MultisigInfo />
            <CreateMultisigSection />
          </div>
          <div className="space-y-6">
            <SwapComponent />
          </div>
        </div>
      </div>
      <Toaster />
    </PageLayout>
  )
}

export default (rootRoute: RootRoute) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/multisig',
    component: MultisigPage,
  })
