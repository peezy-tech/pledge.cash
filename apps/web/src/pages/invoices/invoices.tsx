import { createRoute } from '@tanstack/react-router'
import { InvoicesDashboard } from '@/components/InvoicesDashboard'

export default function InvoicesPage(parentRoute: any) {
  const invoicesRoute = createRoute({
    getParentRoute: () => parentRoute,
    path: '/invoices',
    component: () => {
      return (
        <div className="container mx-auto px-4 py-8">
          <InvoicesDashboard />
        </div>
      )
    },
  })

  return invoicesRoute
} 