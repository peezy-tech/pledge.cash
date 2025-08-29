import { createRoute, type RootRoute } from '@tanstack/react-router'
import { PageLayout } from '@/components/PageLayout'
import { usePayments } from '@/hooks/useHyperliquid'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

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
  const { data, isLoading, error } = usePayments()
  return (
    <PageLayout title="Payments Overview">
      {isLoading && <div>Loading...</div>}
      {error && <div className="text-red-500">{(error as any).message}</div>}
      <div className="grid md:grid-cols-2 gap-6">
        <PaymentList title="As Creator" items={data?.asCreator || []} />
        <PaymentList title="As Payer" items={data?.asPayer || []} />
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

