import { createRoute } from '@tanstack/react-router'
import type { RootRoute } from '@tanstack/react-router'
import { PublicInvoicePage } from './PublicInvoicePage'

// Route definition
export default (rootRoute: RootRoute) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/invoices/$invoiceId',
    component: PublicInvoicePage,
  }) 