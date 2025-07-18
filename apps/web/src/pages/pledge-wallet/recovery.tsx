import { createRoute, type RootRoute } from '@tanstack/react-router'
import { PageLayout } from '@/components/PageLayout'
import {
  useHyperliquidSpotBalances,
  useSpotTokens,
} from '@/hooks/useHyperliquid'
import { useAccount, useWalletClient } from 'wagmi'
import { useState, useMemo } from 'react'
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
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Toaster } from '@/components/ui/sonner'
import { toast } from 'sonner'
import {
  Copy,
  ExternalLink,
  Shield,
  AlertTriangle,
  ArrowDownLeft,
  RefreshCw,
} from 'lucide-react'
import { SpotBalances } from '@/components/SpotBalances'
import * as hl from '@nktkas/hyperliquid'
import { isAddress } from 'viem'

const IS_TESTNET = true

function PledgeWalletRecoveryInfo({
  pledgeWalletAddress,
}: {
  pledgeWalletAddress: string
}) {
  const { data: spotTokens } = useSpotTokens()
  const { address: userAddress } = useAccount()
  const { data: walletClient } = useWalletClient()
  const { data: pledgeWalletBalances } = useHyperliquidSpotBalances(
    pledgeWalletAddress as `0x${string}`,
  )

  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [isWithdrawing, setIsWithdrawing] = useState(false)
  const [showWithdrawDialog, setShowWithdrawDialog] = useState(false)
  const [showWithdrawConfirm, setShowWithdrawConfirm] = useState(false)
  const [isTestingConnection, setIsTestingConnection] = useState(false)
  const [canSign, setCanSign] = useState<boolean | null>(null)
  const [isConverting, setIsConverting] = useState(false)
  const [showConvertDialog, setShowConvertDialog] = useState(false)

  // Create a pledge wallet client for the provided address
  const pledgeWalletClient = useMemo(() => {
    if (!walletClient || !userAddress || !pledgeWalletAddress) return null

    try {
      return new hl.MultiSignClient({
        transport: new hl.HttpTransport({ isTestnet: IS_TESTNET }),
        multiSignAddress: pledgeWalletAddress as `0x${string}`,
        signatureChainId: `0x${(1337).toString(16)}` as `0x${string}`,
        signers: [
          {
            address: userAddress,
            signTypedData: async (params: {
              domain: {
                name: string
                version: string
                chainId: number
                verifyingContract: hl.Hex
              }
              types: {
                [key: string]: {
                  name: string
                  type: string
                }[]
              }
              primaryType: string
              message: Record<string, unknown>
            }) => {
              const signature = await walletClient.signTypedData({
                ...params,
                domain: {
                  ...params.domain,
                  chainId: 1337,
                },
              })
              return signature
            },
          },
        ],
        isTestnet: IS_TESTNET,
      })
    } catch (error) {
      console.error('Failed to create pledge wallet client:', error)
      return null
    }
  }, [walletClient, userAddress, pledgeWalletAddress])

  const testConnection = async () => {
    if (!pledgeWalletClient || !spotTokens?.USDC || !userAddress) {
      toast.error('Missing pledge wallet client, USDC token, or user address')
      return
    }

    setIsTestingConnection(true)
    try {
      // Test if we can create a multisig client and if the wallet can sign
      // by attempting to create a test signature (without sending a transaction)
      const testMessage = {
        domain: {
          name: 'Hyperliquid',
          version: '1',
          chainId: 1337,
          verifyingContract: pledgeWalletAddress as `0x${string}`,
        },
        types: {
          TestMessage: [
            { name: 'message', type: 'string' },
            { name: 'timestamp', type: 'uint256' },
          ],
        },
        primaryType: 'TestMessage' as const,
        message: {
          message: 'Test connection for pledge wallet recovery',
          timestamp: BigInt(Date.now()),
        },
      }

      // Try to sign a test message to validate the signer
      if (walletClient) {
        await walletClient.signTypedData({
          ...testMessage,
          domain: {
            ...testMessage.domain,
            chainId: 1337,
          },
        })
      }

      setCanSign(true)
      toast.success('✅ You can sign for this pledge wallet!')
    } catch (error) {
      console.error('Connection test failed:', error)
      setCanSign(false)
      toast.error(
        '❌ You cannot sign for this pledge wallet or signing was rejected',
      )
    } finally {
      setIsTestingConnection(false)
    }
  }

  const copyAddress = () => {
    navigator.clipboard.writeText(pledgeWalletAddress)
    toast.success('Address copied to clipboard')
  }

  const openInExplorer = () => {
    window.open(
      `https://testnet.hyperliquid.xyz/address/${pledgeWalletAddress}`,
      '_blank',
    )
  }

  const pledgeWalletUsdcBalance = pledgeWalletBalances?.balances.find(
    (b) => b.coin === 'USDC',
  )

  const handleWithdraw = async () => {
    if (!withdrawAmount || isNaN(Number(withdrawAmount))) {
      toast.error('Please enter a valid amount')
      return
    }

    if (!userAddress || !spotTokens?.USDC || !pledgeWalletClient) {
      toast.error('Missing required data')
      return
    }

    const numAmount = Number(withdrawAmount)
    const availableBalance = Number(pledgeWalletUsdcBalance?.total || 0)

    if (numAmount > availableBalance) {
      toast.error('Insufficient pledge wallet balance')
      return
    }

    setIsWithdrawing(true)
    try {
      await pledgeWalletClient.spotSend({
        destination: userAddress,
        token: `${spotTokens.USDC.name}:${spotTokens.USDC.tokenId}`,
        amount: withdrawAmount,
      })

      toast.success(
        `Successfully withdrew ${withdrawAmount} USDC from pledge wallet`,
      )
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

  const handleConvertToRegular = async () => {
    if (!pledgeWalletClient) {
      toast.error('Missing pledge wallet client')
      return
    }

    setIsConverting(true)
    try {
      // Convert pledge wallet to regular user by setting empty authorized users array
      const convertTx = await pledgeWalletClient.convertToMultiSigUser({
        authorizedUsers: [],
        threshold: 1,
      })

      console.log('convertTx', convertTx)

      toast.success('Successfully converted pledge wallet to regular wallet!')
      setShowConvertDialog(false)

      // Reset the signing status since the pledge wallet no longer exists
      setCanSign(null)
    } catch (error) {
      console.error('Conversion failed:', error)
      toast.error(
        'Failed to convert pledge wallet to regular wallet. Please try again.',
      )
    } finally {
      setIsConverting(false)
    }
  }

  if (!pledgeWalletClient) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          Unable to create pledge wallet client. Please ensure you have a
          connected wallet.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Pledge Wallet Recovery
          {canSign && <Badge variant="secondary">✅ Valid Signer</Badge>}
          {canSign === false && (
            <Badge variant="destructive">❌ Invalid Signer</Badge>
          )}
        </CardTitle>
        <CardDescription>
          Recover funds from a pledge wallet if you're a valid signer
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Label className="text-sm font-medium">Pledge Wallet Address:</Label>
          <code className="text-sm bg-muted px-2 py-1 rounded flex-1 truncate">
            {pledgeWalletAddress}
          </code>
          <Button size="sm" variant="outline" onClick={copyAddress}>
            <Copy className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={openInExplorer}>
            <ExternalLink className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Label className="text-sm font-medium">Your Address:</Label>
          <code className="text-sm bg-muted px-2 py-1 rounded flex-1 truncate">
            {userAddress}
          </code>
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={testConnection}
            disabled={isTestingConnection}
            className="flex-1"
          >
            <RefreshCw
              className={`h-4 w-4 mr-2 ${isTestingConnection ? 'animate-spin' : ''}`}
            />
            {isTestingConnection ? 'Testing...' : 'Test Connection'}
          </Button>
        </div>

        {canSign && (
          <>
            <SpotBalances address={pledgeWalletAddress as `0x${string}`} />

            <div className="space-y-2">
              <Dialog
                open={showWithdrawDialog}
                onOpenChange={setShowWithdrawDialog}
              >
                <DialogTrigger asChild>
                  <Button className="w-full" variant="destructive">
                    <ArrowDownLeft className="h-4 w-4 mr-2" />
                    Recover Funds
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Recover from Pledge Wallet</DialogTitle>
                    <DialogDescription>
                      Withdraw USDC from the pledge wallet to your wallet
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
                        Available: {pledgeWalletUsdcBalance?.total || '0'} USDC
                      </p>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setShowWithdrawDialog(false)}
                    >
                      Cancel
                    </Button>
                    <Dialog
                      open={showWithdrawConfirm}
                      onOpenChange={setShowWithdrawConfirm}
                    >
                      <DialogTrigger asChild>
                        <Button
                          disabled={
                            !withdrawAmount ||
                            isNaN(Number(withdrawAmount)) ||
                            Number(withdrawAmount) <= 0
                          }
                          variant="destructive"
                        >
                          Review Recovery
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Confirm Fund Recovery</DialogTitle>
                          <DialogDescription>
                            Are you sure you want to recover {withdrawAmount}{' '}
                            USDC from the pledge wallet?
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                          <div className="space-y-2">
                            <Label>From (Pledge Wallet)</Label>
                            <code className="text-sm bg-muted px-2 py-1 rounded block truncate">
                              {pledgeWalletAddress}
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
                            <p className="text-lg font-semibold">
                              {withdrawAmount} USDC
                            </p>
                          </div>
                        </div>
                        <DialogFooter>
                          <Button
                            variant="outline"
                            onClick={() => setShowWithdrawConfirm(false)}
                          >
                            Cancel
                          </Button>
                          <Button
                            onClick={handleWithdraw}
                            disabled={isWithdrawing}
                            variant="destructive"
                          >
                            {isWithdrawing
                              ? 'Recovering...'
                              : 'Confirm Recovery'}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Dialog
                open={showConvertDialog}
                onOpenChange={setShowConvertDialog}
              >
                <DialogTrigger asChild>
                  <Button className="w-full" variant="outline">
                    <Shield className="h-4 w-4 mr-2" />
                    Convert to Regular Wallet
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>
                      Convert Pledge Wallet to Regular Wallet
                    </DialogTitle>
                    <DialogDescription>
                      This will permanently convert the pledge wallet back to a
                      regular wallet. This action cannot be undone.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        <strong>Warning:</strong> This action will permanently
                        remove the pledge wallet functionality from this wallet.
                        After conversion, it will become a regular wallet
                        controlled only by the private key holder.
                      </AlertDescription>
                    </Alert>
                    <div className="space-y-2">
                      <Label>Pledge Wallet Address</Label>
                      <code className="text-sm bg-muted px-2 py-1 rounded block truncate">
                        {pledgeWalletAddress}
                      </code>
                    </div>
                    <div className="space-y-2">
                      <Label>Will become regular wallet controlled by</Label>
                      <code className="text-sm bg-muted px-2 py-1 rounded block truncate">
                        {pledgeWalletAddress}
                      </code>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setShowConvertDialog(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleConvertToRegular}
                      disabled={isConverting}
                      variant="destructive"
                    >
                      {isConverting
                        ? 'Converting...'
                        : 'Convert to Regular Wallet'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </>
        )}

        {canSign === false && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              You are not a valid signer for this pledge wallet. You cannot
              recover funds from this address.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}

export function PledgeWalletRecoveryPage() {
  const [pledgeWalletAddress, setPledgeWalletAddress] = useState('')
  const [isValidAddress, setIsValidAddress] = useState(false)
  const { address: userAddress } = useAccount()

  const handleAddressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setPledgeWalletAddress(value)
    setIsValidAddress(isAddress(value))
  }

  if (!userAddress) {
    return (
      <PageLayout title="Pledge Wallet Recovery">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Please connect your wallet to use the pledge wallet recovery
            feature.
          </AlertDescription>
        </Alert>
        <Toaster />
      </PageLayout>
    )
  }

  return (
    <PageLayout title="Pledge Wallet Recovery">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Enter Pledge Wallet Address</CardTitle>
            <CardDescription>
              Enter the pledge wallet address you want to recover funds from
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pledge-wallet-address">
                Pledge Wallet Address
              </Label>
              <Input
                id="pledge-wallet-address"
                placeholder="0x..."
                value={pledgeWalletAddress}
                onChange={handleAddressChange}
                className={
                  !pledgeWalletAddress
                    ? ''
                    : isValidAddress
                      ? 'border-green-500'
                      : 'border-red-500'
                }
              />
              {pledgeWalletAddress && !isValidAddress && (
                <p className="text-sm text-red-500">
                  Please enter a valid Ethereum address
                </p>
              )}
              {pledgeWalletAddress && isValidAddress && (
                <p className="text-sm text-green-500">
                  ✅ Valid address format
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {isValidAddress && pledgeWalletAddress && (
          <PledgeWalletRecoveryInfo pledgeWalletAddress={pledgeWalletAddress} />
        )}
      </div>
      <Toaster />
    </PageLayout>
  )
}

export default (rootRoute: RootRoute) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/pledge-wallet/recovery',
    component: PledgeWalletRecoveryPage,
  })
