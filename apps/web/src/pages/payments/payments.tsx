import { createRoute, type RootRoute } from '@tanstack/react-router'
import { PageLayout } from '@/components/PageLayout'
import { usePayments } from '@/hooks/useHyperliquid'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useConvexLatestPayments } from '@/hooks/useConvexPayments'

function PaymentList({ title, items }: { title: string; items: any[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 && <div className="text-sm text-muted-foreground">No payments</div>}
        {items.map((p) => (
          <div key={p.id} className="text-sm flex justify-between">
            <div>
              <span className="uppercase">{p.type}</span> • {p.amount} {p.token.split(':')[0]} • {p.status}
            </div>
            <div className="font-mono">{p.txHash || ''}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function PaymentsPageComponent() {
  const { data, isLoading } = usePayments()
  const convex = useConvexLatestPayments(10)
  return (
    <PageLayout title="Payments Overview">
      {isLoading && <div>Loading...</div>}
      <div className="grid md:grid-cols-3 gap-6">
        <PaymentList title="As Creator" items={data?.asCreator || []} />
        <PaymentList title="As Payer" items={data?.asPayer || []} />
        <Card>
          <CardHeader>
            <CardTitle>Convex (latest)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {convex.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
            {!convex.isLoading && (!convex.data || convex.data.length === 0) && (
              <div className="text-sm text-muted-foreground">No Convex payments yet</div>
            )}
            {Array.isArray(convex.data) && convex.data.map((p: any) => (
              <div key={p._id} className="text-sm flex justify-between">
                <div>
                  <span className="uppercase">{p.type}</span> • {p.amount} {p.token.split(':')[0]} • {p.status}
                </div>
                <div className="font-mono">{p.txHash || ''}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  )
}

export default (rootRoute: RootRoute) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/payments',
    component: PaymentsPageComponent,
  })
