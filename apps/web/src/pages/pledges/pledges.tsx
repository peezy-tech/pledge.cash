import { createRoute, type RootRoute } from '@tanstack/react-router'
import { PageLayout } from '@/components/PageLayout'
import { useState } from 'react'
import {
  usePledgeCampaigns,
  useDiscoverPledgeCampaigns,
  useMyPledges,
  useCreatePledgeCampaignMutation,
  useCreatePledgeMutation,
  usePayPledgeMutation,
  useConfirmContributionMutation,
  useSpotTokens,
} from '@/hooks/useHyperliquid'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { useHyperliquid } from '@/providers/HyperliquidProvider'
import { toast } from 'sonner'

function CreateCampaignForm() {
  const { data: spotTokens } = useSpotTokens()
  const createCampaign = useCreatePledgeCampaignMutation()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [goalToken, setGoalToken] = useState('')
  const [goalAmount, setGoalAmount] = useState('')

  const tokens = spotTokens
    ? Object.values(spotTokens).map((t) => ({ name: t.name, tokenId: t.tokenId }))
    : []

  const handleCreate = async () => {
    if (!name || !goalToken || !goalAmount) return
    await createCampaign.mutateAsync({
      name,
      description: description || undefined,
      goalToken: `${goalToken}:${tokens.find((t) => t.name === goalToken)?.tokenId}`,
      goalAmount,
    })
    setName('')
    setDescription('')
    setGoalToken('')
    setGoalAmount('')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create Pledge Campaign</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Goal Token</Label>
            <Select value={goalToken} onValueChange={setGoalToken}>
              <SelectTrigger>
                <SelectValue placeholder="Select token" />
              </SelectTrigger>
              <SelectContent>
                {tokens.map((t) => (
                  <SelectItem key={t.tokenId} value={t.name}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Description (optional)</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Goal Amount</Label>
            <Input type="number" step="any" value={goalAmount} onChange={(e) => setGoalAmount(e.target.value)} />
          </div>
        </div>
        <Button onClick={handleCreate} disabled={createCampaign.isPending}>
          {createCampaign.isPending ? 'Creating...' : 'Create Campaign'}
        </Button>
      </CardContent>
    </Card>
  )
}

function CreatePledgeForm() {
  const { data: spotTokens } = useSpotTokens()
  const createPledge = useCreatePledgeMutation()
  const [campaignId, setCampaignId] = useState('')
  const [token, setToken] = useState('')
  const [amount, setAmount] = useState('')
  const [cadence, setCadence] = useState<'daily' | 'weekly' | 'monthly'>('monthly')
  const [autopay, setAutopay] = useState(true)

  const tokens = spotTokens
    ? Object.values(spotTokens).map((t) => ({ name: t.name, tokenId: t.tokenId }))
    : []

  const handleCreate = async () => {
    if (!campaignId || !token || !amount) return
    await createPledge.mutateAsync({
      campaignId,
      token: `${token}:${tokens.find((t) => t.name === token)?.tokenId}`,
      amountPerCadence: amount,
      cadence,
      autopayEnabled: autopay,
    })
    setCampaignId('')
    setToken('')
    setAmount('')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create Pledge</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Campaign ID</Label>
            <Input value={campaignId} onChange={(e) => setCampaignId(e.target.value)} placeholder="plcmp_..." />
          </div>
          <div className="space-y-2">
            <Label>Token</Label>
            <Select value={token} onValueChange={setToken}>
              <SelectTrigger>
                <SelectValue placeholder="Select token" />
              </SelectTrigger>
              <SelectContent>
                {tokens.map((t) => (
                  <SelectItem key={t.tokenId} value={t.name}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Amount Per Cadence</Label>
            <Input type="number" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Cadence</Label>
            <Select value={cadence} onValueChange={(v) => setCadence(v as any)}>
              <SelectTrigger>
                <SelectValue placeholder="Select cadence" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Autopay</Label>
            <Select value={autopay ? 'true' : 'false'} onValueChange={(v) => (v === 'true' ? setAutopay(true) : setAutopay(false))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="true">Enabled</SelectItem>
                <SelectItem value="false">Disabled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button onClick={handleCreate} disabled={createPledge.isPending}>
          {createPledge.isPending ? 'Creating...' : 'Create Pledge'}
        </Button>
      </CardContent>
    </Card>
  )
}

function CampaignsList() {
  const { data, isLoading, error } = usePledgeCampaigns()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your Campaigns</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <div>Loading...</div>}
        {error && <div className="text-red-500">{(error as any).message}</div>}
        {(data?.created || []).length === 0 && (
          <div className="text-sm text-muted-foreground">No campaigns yet</div>
        )}
        {(data?.created || []).map((c: any) => (
          <div key={c.id} className="text-sm flex justify-between">
            <div>
              <div className="font-medium">{c.name}</div>
              <div className="text-muted-foreground">Goal: {c.goalAmount} {c.goalToken.split(':')[0]}</div>
            </div>
            <div>Raised: {c.raisedAmount}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function DiscoverCampaigns() {
  const { data, isLoading, error } = useDiscoverPledgeCampaigns()
  return (
    <Card>
      <CardHeader>
        <CardTitle>Discover Campaigns</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <div>Loading...</div>}
        {error && <div className="text-red-500">{(error as any).message}</div>}
        {(data?.active || []).length === 0 && (
          <div className="text-sm text-muted-foreground">No active campaigns</div>
        )}
        {(data?.active || []).map((c: any) => (
          <div key={c.id} className="text-sm flex justify-between">
            <div>
              <div className="font-medium">{c.name}</div>
              <div className="text-muted-foreground">
                Goal: {c.goalAmount} {c.goalToken.split(':')[0]}
              </div>
            </div>
            <div>Raised: {c.raisedAmount}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function MyPledges() {
  const { data, isLoading, error } = useMyPledges()
  return (
    <Card>
      <CardHeader>
        <CardTitle>My Pledges</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <div>Loading...</div>}
        {error && <div className="text-red-500">{(error as any).message}</div>}
        {(data?.pledges || []).length === 0 && (
          <div className="text-sm text-muted-foreground">No pledges yet</div>
        )}
        {(data?.pledges || []).map((p: any) => (
          <div key={p.id} className="text-sm flex justify-between">
            <div>
              <div>
                {p.amountPerCadence} {p.token.split(':')[0]} • {p.cadence.toUpperCase()}
              </div>
              <div className="text-muted-foreground">Campaign: {p.campaignId}</div>
            </div>
            <div className="uppercase">{p.status}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function ContributeSection() {
  const payPledge = usePayPledgeMutation()
  const confirmContrib = useConfirmContributionMutation()
  const { exchangeClient } = useHyperliquid()
  const [pledgeId, setPledgeId] = useState('')
  const [contributionId, setContributionId] = useState('')
  const [txHash, setTxHash] = useState('')
  const [creatorAddress, setCreatorAddress] = useState('')
  const [token, setToken] = useState('')
  const [amount, setAmount] = useState('')

  const handlePrepare = async () => {
    if (!pledgeId) return
    const res = await payPledge.mutateAsync({ id: pledgeId })
    if (res?.id) setContributionId(res.id)
    toast.success('Contribution prepared. You can now pay and confirm the tx hash.')
  }

  const handlePayViaWallet = async () => {
    try {
      if (!exchangeClient) throw new Error('Wallet not connected')
      if (!creatorAddress || !token || !amount) throw new Error('Missing fields')
      await exchangeClient.spotSend({
        destination: creatorAddress as `0x${string}`,
        token: token as `${string}:0x${string}`,
        amount,
      })
      toast.success('Payment sent. Retrieve tx hash from explorer and confirm below.')
    } catch (e) {
      toast.error((e as any).message || 'Failed to send payment')
    }
  }

  const handleConfirm = async () => {
    if (!contributionId || !txHash) return
    await confirmContrib.mutateAsync({ id: contributionId, txHash: txHash as `0x${string}` })
    setTxHash('')
    toast.success('Contribution confirmed')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contribute to a Pledge</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Pledge ID</Label>
            <Input value={pledgeId} onChange={(e) => setPledgeId(e.target.value)} placeholder="pldg_..." />
          </div>
          <div className="flex items-end gap-2">
            <Button onClick={handlePrepare} disabled={payPledge.isPending}>
              {payPledge.isPending ? 'Preparing...' : 'Prepare'}
            </Button>
          </div>
        </div>
        {contributionId && (
          <div className="text-xs text-muted-foreground">Contribution ID: <span className="font-mono">{contributionId}</span></div>
        )}
        <Separator />
        <div className="grid md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>Creator Address</Label>
            <Input value={creatorAddress} onChange={(e) => setCreatorAddress(e.target.value)} placeholder="0x..." />
          </div>
          <div className="space-y-2">
            <Label>Token (e.g. USDC:0x...)</Label>
            <Input value={token} onChange={(e) => setToken(e.target.value)} placeholder="SYMBOL:tokenId" />
          </div>
          <div className="space-y-2">
            <Label>Amount</Label>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handlePayViaWallet}>Pay via Wallet</Button>
        </div>
        <Separator />
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Transaction Hash</Label>
            <Input value={txHash} onChange={(e) => setTxHash(e.target.value)} placeholder="0x..." />
          </div>
          <div className="flex items-end">
            <Button onClick={handleConfirm} disabled={confirmContrib.isPending}>
              {confirmContrib.isPending ? 'Confirming...' : 'Confirm Contribution'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function PledgesPageComponent() {
  return (
    <PageLayout title="Pledges & Campaigns">
      <div className="space-y-6">
        <CreateCampaignForm />
        <CampaignsList />
        <DiscoverCampaigns />
        <CreatePledgeForm />
        <MyPledges />
        <ContributeSection />
      </div>
    </PageLayout>
  )
}

export default (rootRoute: RootRoute) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/pledges',
    component: PledgesPageComponent,
  })
