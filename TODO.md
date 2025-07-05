- [x] move api scripts to own 'scripts' apps sub-folder
- [x] multisig init flow ("merchant" onboarding). most methods at multisig_send_spot.ts
- [x] generate agent wallet on client side and approve it on backend
- [x] invoice links: whoever clicks can send a transaction to pay for it. (checkout experience)
- [ ] invoice hooks -> run logic after an invoice is paid
- [ ] recurrent invoices: payable by multisig
- [ ] (HUMAN ONLY) approve builder code for swaps and add to frontend swaps 

- [ ] add_repo.js that clones link. if --gh-fork will attempt to fork (or find existing) using gh cli and add the fork url to repos.json instead of original

- [ ] openrouter credits re-seller/re-router app leveraging hyperliquid invoicing (accept any spot -> convert to usdc -> bridge to base when threshold hits. needs some seed capital to be already credited on openRouter)


---

- registration via payment: if a given user address is not on the database and it sends in a txHash invoice that has been paid by it, we should create a user entry on the db for it.
- 

---

Looking at Stripe's core functionality and adapting it to a stablecoin payment system on Hyperliquid, here are the key features you'd need for parity:

## Payment Processing & Management

**Invoice Management System**
- Invoice creation with line items, quantities, and pricing
- Custom fields and metadata support
- Invoice templates and branding customization
- Automatic invoice numbering and organization
- PDF generation and email delivery
- Invoice status tracking (draft, sent, paid, overdue, canceled)

**Payment Links & Checkout**
- Shareable payment links for quick payments
- Embeddable checkout widgets
- QR code generation for easy mobile payments
- Support for partial payments
- Payment scheduling and installment plans

**Multi-currency Support**
- Handle multiple stablecoins (USDC, USDT, etc.)
- Real-time exchange rate display
- Automatic conversion calculations
- Price display in fiat equivalent

## Financial Operations

**Automated Reconciliation**
- Transaction matching with invoices
- Automatic payment detection via blockchain monitoring
- Smart contract events listening
- Overpayment/underpayment handling
- Payment confirmation thresholds

**Recurring Payments**
- Subscription management
- Automated billing cycles
- Failed payment retry logic
- Subscription plan changes and proration
- Usage-based billing support

**Financial Reporting**
- Revenue analytics and dashboards
- Payment history and transaction logs
- Export capabilities (CSV, PDF)
- Tax report generation
- Cash flow projections

## Developer & Integration Features

**API & Webhooks**
- RESTful API for all operations
- GraphQL support for flexible queries
- Webhook notifications for payment events
- SDK libraries for popular languages
- Idempotency keys for safe retries

**Integration Ecosystem**
- Accounting software connectors (QuickBooks, Xero)
- CRM integrations
- E-commerce platform plugins
- ERP system connections
- Zapier/automation tool support

## Customer Experience

**Customer Portal**
- Self-service payment history
- Download invoices and receipts
- Update payment preferences
- Manage subscriptions
- Dispute resolution system

**Communication Tools**
- Automated payment reminders
- Customizable email templates
- SMS notifications
- In-app notifications
- Multi-language support

## Security & Compliance

**Access Control**
- Role-based permissions
- Team member management
- API key management
- Audit logs
- IP allowlisting

**Compliance Features**
- KYC/AML integration capabilities
- Transaction monitoring
- Regulatory reporting tools
- Data retention policies
- GDPR compliance tools

## Advanced Features

- Escrow functionality
- Conditional payments
- Time-locked payments
- Revenue splitting

**Analytics & Insights**
- Customer lifetime value tracking
- Churn prediction
- Payment failure analysis
- Geographic distribution
- Custom report builder

**Pricing & Discount Management**
- Coupon codes
- Volume discounts
- Early payment discounts
- Dynamic pricing rules
- A/B testing for pricing