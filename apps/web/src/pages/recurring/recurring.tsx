import { createRoute, type RootRoute } from '@tanstack/react-router'
import { PageLayout } from '@/components/PageLayout'
import { useState } from 'react'
import {
  useRecurringPlans,
  useRecurringCharges,
  useCreateRecurringPlanMutation,
  useUpdateRecurringPlanMutation,
  useRunRecurringPlanMutation,
  useSpotTokens,
} from '@/hooks/useHyperliquid'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'

function CreateRecurringForm() {
  const { data: spotTokens } = useSpotTokens()
  const createPlan = useCreateRecurringPlanMutation()
  const [payerAddress, setPayerAddress] = useState('')
  const [token, setToken] = useState('')
  const [amount, setAmount] = useState('')
  const [cadence, setCadence] = useState<'daily' | 'weekly' | 'monthly'>('monthly')
  const [autopay, setAutopay] = useState(true)

  const tokens = spotTokens
    ? Object.values(spotTokens).map((t) => ({ name: t.name, tokenId: t.tokenId }))
    : []

  const handleCreate = async () => {
    if (!token || !amount) return
    await createPlan.mutateAsync({
      payerAddress: payerAddress ? payerAddress.toLowerCase() : undefined,
      token: `${token}:${tokens.find((t) => t.name === token)?.tokenId}`,
      amount,
      cadence,
      autopayEnabled: autopay,
    })
    setPayerAddress('')
    setAmount('')
    setToken('')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create Recurring Plan</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Payer Address (optional)</Label>
            <Input placeholder="0x..." value={payerAddress} onChange={(e) => setPayerAddress(e.target.value)} />
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
            <Label>Amount</Label>
            <Input type="number" step="any" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
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
            <Select value={autopay ? 'true' : 'false'} onValueChange={(v) => setAutopay(v === 'true')}>
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
        <Button onClick={handleCreate} disabled={createPlan.isPending}>
          {createPlan.isPending ? 'Creating...' : 'Create Plan'}
        </Button>
      </CardContent>
    </Card>
  )
}

function PlanRow({ plan }: { plan: any }) {
  const updatePlan = useUpdateRecurringPlanMutation()
  const runPlan = useRunRecurringPlanMutation()
  const [showCharges, setShowCharges] = useState(false)
  const { data: charges } = useRecurringCharges(showCharges ? plan.id : undefined)

  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold">{plan.cadence.toUpperCase()} • {plan.amount} {plan.token.split(':')[0]}</div>
            <div className="text-sm text-muted-foreground">Payer: {plan.payerAddress || plan.payerUserId || 'Any'} | Status: {plan.status}</div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowCharges((s) => !s)}>
              {showCharges ? 'Hide Charges' : 'View Charges'}
            </Button>
            <Button variant="outline" onClick={() => runPlan.mutate({ id: plan.id })} disabled={runPlan.isPending}>
              {runPlan.isPending ? 'Running...' : 'Run Now'}
            </Button>
            {plan.status !== 'cancelled' && (
              <Button
                variant="outline"
                onClick={() =>
                  updatePlan.mutate({ id: plan.id, status: plan.status === 'active' ? 'paused' : 'active' })
                }
                disabled={updatePlan.isPending}
              >
                {plan.status === 'active' ? 'Pause' : 'Resume'}
              </Button>
            )}
            {plan.status !== 'cancelled' && (
              <Button
                variant="destructive"
                onClick={() => updatePlan.mutate({ id: plan.id, status: 'cancelled' })}
                disabled={updatePlan.isPending}
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
        {showCharges && (
          <div className="space-y-2">
            <Separator />
            <div className="text-sm font-medium">Charges</div>
            <div className="space-y-2">
              {(charges || []).length === 0 && (
                <div className="text-sm text-muted-foreground">No charges yet</div>
              )}
              {(charges || []).map((c: any) => (
                <div key={c.id} className="text-sm flex justify-between">
                  <div>
                    {c.amount} {c.token.split(':')[0]} • {new Date(c.dueAt).toLocaleString()}
                  </div>
                  <div>
                    <span className="uppercase">{c.status}</span>
                    {c.txHash && <span className="ml-2 font-mono">{c.txHash}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function RecurringPageComponent() {
  const { data, isLoading, error } = useRecurringPlans()

  return (
    <PageLayout title="Recurring Plans">
      <div className="space-y-6">
        <CreateRecurringForm />
        {isLoading && <div>Loading...</div>}
        {error && <div className="text-red-500">{(error as any).message}</div>}
        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <Card>
              <CardHeader>
                <CardTitle>Created Plans</CardTitle>
              </CardHeader>
            </Card>
            {data?.created?.map((p: any) => (
              <PlanRow key={p.id} plan={p} />
            ))}
          </div>
          <div className="space-y-3">
            <Card>
              <CardHeader>
                <CardTitle>Plans Where You're the Payer</CardTitle>
              </CardHeader>
            </Card>
            {data?.asPayer?.map((p: any) => (
              <PlanRow key={p.id} plan={p} />
            ))}
          </div>
        </div>
      </div>
    </PageLayout>
  )
}

export default (rootRoute: RootRoute) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/recurring',
    component: RecurringPageComponent,
  })

