# Recurring support plans

Status: implementation contract for the first hosted recurring-payment slice.

## Product boundary

A recurring support plan is a project-published schedule for voluntary
contributions. It is not a token sale, a grant, a bond, a subscription share,
or a standing debit mandate.

The router stores the schedule and issues one immutable invoice per calendar
period. Every invoice still requires a fresh x402 payment signature from the
supporter. Creating a subscription authorizes the router to remember the
schedule; it never authorizes the router to move funds.

Version one supports:

- canonical HyperEVM testnet Boardrooms;
- a single monthly cadence, anchored to the subscription creation timestamp;
- configured HyperEVM USDC as the Boardroom treasury asset;
- manual renewal from HyperCore testnet USDC through the existing x402
  settlement, destination execution, refund, and recovery path;
- immutable plan terms and period invoices;
- project-authority plan publication and retirement;
- supporter-signed subscription creation and cancellation.

Version one does not support automatic debits, metered billing, plan edits,
arrears, prorating, project-token issuance, rewards, or entitlement enforcement.
A price or copy change creates a new plan.

## State machines

### Plan

`active -> retired`

Plan terms are immutable. Publication requires a fresh challenge signed by the
Boardroom's live authority. A launched Boardroom uses its controller's ERC-1271
validation over the current proposer's wallet signature; a prelaunch Boardroom
uses its owner, including ERC-1271 owners. Retirement requires a new challenge.
Plans also stop accepting subscriptions and invoices when the Boardroom is not
Active, the configured USDC asset is no longer registered, or the stored
authority generation no longer matches the Boardroom.

### Subscription

`active -> cancelled`

The supporter signs a human-readable challenge binding the plan, payer,
subscription identifier, nonce, and expiry. This signature proves the hosted
schedule request only. Cancellation is immediate for unpaid periods and never
reverses a settled contribution.

### Invoice

`open -> paid`

`open -> cancelled`

One invoice is materialized lazily for the current calendar period. Missed
periods do not become debt. The tuple `(subscription, period index)` is unique,
and its amount, period bounds, plan version, payer, Boardroom, and asset never
change. The invoice row names one active quote attempt. Payment binding takes
both an invoice lock and a payer-plus-Boardroom lock, then rechecks that active
attempt in the same Postgres transaction.

An invoice can have multiple quote attempts only after an earlier attempt is
definitively expired, payment-failed, executed-and-refunded, or otherwise safe
to replace. A bound, paid, executing, recovery-pending, refund-pending, or
manual-intervention order locks the invoice against another payment.
An unresolved payment from any earlier period, replacement schedule, or plan
version also locks that payer and Boardroom pair. A month boundary, cancellation,
new plan, or second device therefore cannot hide uncertainty behind a newer
invoice.

### Payment attempt

The existing router state machine remains authoritative:

`quoted -> paid -> executing -> executed`

or

`paid -> refund_pending -> refunded`

Uncertainty never authorizes a second payment. A contribution is `paid` only
after the destination USDC transfer to the canonical Boardroom is confirmed.

## Asset movement and authority

The only new destination call is:

```text
canonical Boardroom.contributeTreasuryAsset(
  configured HyperEVM USDC,
  invoice amount,
  signed deadline
)
```

The x402 gateway's executor supplies prefunded HyperEVM USDC after the
supporter's HyperCore payment settles and grants only the required Boardroom
allowance. The Boardroom pulls from the signed transaction caller, checks the
deadline, Active state, registered asset, and exact recipient balance increase
atomically, and rejects a stale or inexact contribution. The gateway therefore
remains inventory-backed and custodial during the settlement/execution
interval, just as it is for existing marketplace actions.

Plans, subscriptions, and invoices are hosted attestations, not an on-chain
registry. Challenge messages bind the origin, chain, Boardroom, actor, plan,
payload hash, nonce, and expiry. The router records the signature hash and
verified block evidence rather than serving the raw signature, so readers trust
the gateway's verification and durable database for this hosted layer.

The execution policy revalidates immediately before simulation that:

- the Boardroom is still factory-canonical and Active;
- configured USDC is still a registered redeemable asset;
- the plan is active and its authority identity has not gone stale;
- the quote is still the invoice's active attempt and no earlier payment from
  that payer to the Boardroom remains unresolved;
- calldata is exactly one Boardroom `contributeTreasuryAsset` call for the
  configured USDC, invoice amount, and signed deadline;
- payer, x402 recipient, and refund address are the same wallet;
- no second live or uncertain attempt exists for the invoice.

The Boardroom's only external call is the reentrancy-guarded USDC pull from the
transaction caller. Non-standard tokens are excluded by pinning the configured
deployment USDC and requiring the Boardroom to receive the exact amount.

## Time and bounds

- Challenges expire after five minutes and are single-use.
- Router quotes retain the existing 30-300 second bound.
- Plan title is at most 80 characters; description is at most 280 characters.
- Plan amount is a positive uint256 value and remains subject to the router's
  maximum source-payment policy.
- Monthly periods use UTC calendar-month arithmetic. Day-of-month overflow is
  clamped to the last valid day while preserving the subscription's UTC time.
- APIs return bounded collections; plan listing is capped at 50 plans, with
  active terms first and retired terms retained for payment recovery.
- There are no user-controlled loops over unbounded database or chain data.

## API

```text
GET  /v1/support/plans?boardroom=0x...
POST /v1/support/plans/challenges
POST /v1/support/plans
POST /v1/support/plans/:id/retirement-challenges
POST /v1/support/plans/:id/retire

POST /v1/support/subscriptions/challenges
POST /v1/support/subscriptions
GET  /v1/support/subscriptions/:id
POST /v1/support/subscriptions/:id/cancellation-challenges
POST /v1/support/subscriptions/:id/cancel

POST /v1/support/invoices/:id/quotes
```

Quote execution and recovery continue through the existing endpoints:

```text
POST /v1/quotes/:quoteId/execute
GET  /v1/orders/:quoteId
```

## Visual thesis

The support surface is a calm, ledger-like standing instruction inside the
existing project participation view. It uses the product's dark paper, thin
rules, compact type, and one lime action accent. It must feel like reviewing a
schedule and a receipt, not buying a membership.

Content is ordered as:

1. exact plan amount and monthly cadence;
2. what the signature does and explicitly does not authorize;
3. current period and renewal state;
4. final x402 quote review and payment action;
5. receipt/recovery identity.

Plan rows expand in place. Subscription creation is one deliberate wallet
signature. Renewal then uses the existing payment review dialog and visible
order-state progression. The browser stores only the opaque schedule ID,
exposes it as a recovery receipt, and supports manual recovery by ID. Motion is
limited to the existing page entry, loading indicator, and status transitions.

## Operations and release gate

The database migration is required before enabling the UI. A pending deployment
artifact continues to keep the router fail-closed. Production enablement also
requires funded executor and refund inventories, the hardened pinned `x402-hl`
runtime, configured web/router origins, and end-to-end proof against a canonical
Active Boardroom with registered USDC.

The router prunes expired, unconsumed challenges in bounded batches at startup
and during each recovery pass. The public edge must still rate-limit challenge
issuance before enabling the service for untrusted traffic.

Sentinel remains notification-only. A later iteration may emit invoice-due
events to it, but Sentinel never receives spend authority.
