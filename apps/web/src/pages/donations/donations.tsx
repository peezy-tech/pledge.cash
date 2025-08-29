import { createRoute, type RootRoute } from '@tanstack/react-router'
import { PageLayout } from '@/components/PageLayout'
import { useDonations } from '@/hooks/useHyperliquid'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

function DonationsPageComponent() {
  const { data, isLoading, error } = useDonations()

  return (
    <PageLayout title="Donations">
      <Card>
        <CardHeader>
          <CardTitle>Your Received Donations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading && <div>Loading...</div>}
          {error && <div className="text-red-500">{(error as any).message}</div>}
          {(data || []).length === 0 && <div className="text-sm text-muted-foreground">No donations yet</div>}
          {(data || []).map((d: any) => (
            <div key={d.id} className="text-sm flex justify-between">
              <div>
                {d.amount} {d.token.split(':')[0]}
              </div>
              <div className="font-mono">{d.txHash}</div>
            </div>
          ))}
        </CardContent>
      </Card>
    </PageLayout>
  )
}

export default (rootRoute: RootRoute) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/donations',
    component: DonationsPageComponent,
  })

