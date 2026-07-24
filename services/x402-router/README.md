# pledge.cash x402 marketplace router

The x402 router accepts exact HyperCore testnet USDC payments and fulfills a
small, canonical set of marketplace actions on HyperEVM testnet. It is a
prefunded broker, not an asset bridge: the payer's HyperCore payment and the
router's HyperEVM execution are separate transfers joined by a signed execution
intent and a durable state machine.

V1 supports only:

- HyperCore spot USDC on `hyperliquid:testnet`;
- HyperEVM testnet (`eip155:998`);
- exact-input swaps through the tracked pledge.cash `AmmRouter`, from the
  configured HyperEVM USDC token into the active Boardroom share token;
- canonical, open, uncapped fixed-price sales paid in that same USDC token; and
- hosted monthly support plans whose manually approved invoices transfer the
  configured HyperEVM USDC directly to a canonical Active Boardroom;
- one address as payer, destination recipient, and refund recipient.

Recurring support does not grant the router a debit mandate: publishing,
subscribing, cancellation, and every monthly renewal require fresh wallet
signatures. Bonding curves, grants, capped sales, automatic debits, arbitrary
calldata, delegated recipients, mainnet, and best-effort or operator-edited
orders are outside this boundary.
See [the architecture and operations document](../../docs/x402-marketplace-router-v1.md)
and [the recurring-support contract](../../docs/recurring-support-plans.md) for
the trust model, state machines, and launch gates.

## Current availability

The service fails closed until every readiness check passes. In particular, the
tracked `packages/contracts/deployments/998.json` artifact is currently
`pending`, so this checkout is not evidence of a live funded route. Do not
advertise the rail or fund an operator until a verified non-pending artifact
with the canonical Boardroom, AMM, and distribution factory addresses is
checked in.

Funded settlement also requires `x402-hl` version `0.2.2` or newer. This service
pins version `0.2.2` to Git commit
`131aff37cf87c48036ab0e347f008e77bf446150`; the runtime additionally reads the
installed package metadata and disables funded settlement if the minimum is not
met.

## Prerequisites

- Bun `1.3.11`;
- Postgres `16`;
- Foundry `1.7.1` for the deterministic Anvil integration harness;
- a verified pledge.cash HyperEVM testnet deployment artifact;
- a dedicated HyperEVM executor funded with the configured USDC and HYPE for
  gas, with only the required canonical allowances; and
- a dedicated HyperCore testnet account funded with enough spot USDC to cover
  the configured refund reserve.

The HyperEVM executor address must equal `X402_ROUTER_GATEWAY_ADDRESS`. The
HyperCore refund signer must equal `HYPERLIQUID_PAY_TO_ADDRESS`. Startup rejects
either mismatch.

## Configuration

Copy the example and replace every empty or zero placeholder:

```sh
cp services/x402-router/.env.example services/x402-router/.env
```

Run the service with that environment loaded by your process supervisor. The
service does not read a committed secret file.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Dedicated Postgres connection used for migrations, immutable quotes, reservations, intent state, and sealed operation journals. |
| `X402_ROUTER_PORT` | no | HTTP port; defaults to `8788`. |
| `X402_ROUTER_PUBLIC_ORIGIN` | yes | Exact public API origin, without a path. |
| `X402_ROUTER_WEB_ORIGIN` | yes | Single browser origin allowed by CORS. |
| `X402_ROUTER_APPLICATION` | yes | Stable application identifier committed into every signed execution intent. |
| `X402_ROUTER_GATEWAY_ADDRESS` | yes | Intent gateway and HyperEVM executor address. |
| `X402_ROUTER_JOURNAL_ENCRYPTION_KEY` | yes | Exactly 32 random bytes in hexadecimal for signed payloads stored in Postgres. |
| `HYPERLIQUID_NETWORK` | no | Must be `hyperliquid:testnet`; defaults to that network. |
| `HYPERLIQUID_PAY_TO_ADDRESS` | yes | HyperCore spot account that receives customer payments and signs refunds. |
| `HYPERLIQUID_REFUND_PRIVATE_KEY` | yes | Dedicated HyperCore refund signer; must derive the pay-to address. |
| `X402_ROUTER_PAYMENT_ASSET` | no | Must be the pinned HyperCore testnet USDC asset identifier; defaults to that asset. |
| `X402_ROUTER_PAYMENT_DECIMALS` | no | Must be `8`; defaults to `8`. |
| `HYPEREVM_CHAIN_ID` | no | Must be `998`; defaults to `998`. |
| `HYPEREVM_RPC_URL` | no | Trusted HyperEVM testnet RPC endpoint; defaults to the public testnet RPC. |
| `X402_ROUTER_HYPEREVM_USDC_ADDRESS` | yes | Destination USDC contract used by canonical routes. |
| `HYPEREVM_EXECUTOR_PRIVATE_KEY` | yes | Dedicated fulfillment signer; must derive the gateway address. |
| `HYPEREVM_CONFIRMATIONS` | no | Required execution receipt confirmations; defaults to `1`. |
| `HYPEREVM_RECEIPT_TIMEOUT_MS` | no | Receipt deadline before the order enters manual intervention. |
| `HYPEREVM_MIN_GAS_BALANCE_WEI` | no | Minimum HYPE balance required for readiness; defaults to `100000000000000000`. |
| `X402_ROUTER_QUOTE_TTL_SECONDS` | no | Quote lifetime from `30` through `300` seconds; defaults to `300`. |
| `X402_ROUTER_MAX_ORDER_ATOMIC` | yes | Maximum total source payment, in 8-decimal HyperCore USDC atomic units. |
| `X402_ROUTER_SERVICE_FEE_BPS` | yes | Explicit fee in basis points; `0` explicitly disables the fee. |
| `X402_ROUTER_MIN_REFUND_RESERVE_ATOMIC` | yes | Minimum available HyperCore USDC reserve, in 8-decimal atomic units. |
| `X402_ROUTER_MAX_GAS_COST_WEI` | no | Maximum simulated HyperEVM gas cost committed into an intent; defaults to `2500000000000000`. |
| `X402_ROUTER_MAX_SLIPPAGE_BPS` | no | Upper bound on a caller's requested slippage; defaults to `100`. |
| `X402_ROUTER_OPERATION_LEASE_MS` | no | Durable operation claim lease; defaults to `60000`. |

Fee and order-limit values have no hidden production defaults. Review them as
an economic policy before every deployment. The example values are testnet
placeholders, not a recommendation.

Keep all private keys and the journal encryption key in a secret manager. A
database backup without the matching encryption key cannot recover a pending
signed operation; an encryption key without the database cannot prove which
operation was already submitted. Back up and restore them as one operational
unit.

### Web build settings

The web rail is hidden unless all four values below are present and valid at
build time:

| Variable | Must match |
| --- | --- |
| `VITE_X402_ROUTER_API_URL` | `X402_ROUTER_PUBLIC_ORIGIN` |
| `VITE_X402_ROUTER_APPLICATION` | `X402_ROUTER_APPLICATION` |
| `VITE_X402_ROUTER_GATEWAY_ADDRESS` | `X402_ROUTER_GATEWAY_ADDRESS` |
| `VITE_X402_ROUTER_HYPEREVM_USDC_ADDRESS` | `X402_ROUTER_HYPEREVM_USDC_ADDRESS` |

The browser additionally requires chain `998`, the connected payer to equal
the destination and refund recipient, and the selected AMM input, sale payment
token, or support-plan asset to equal the configured destination USDC. For
recurring support, it also verifies exact ERC-20 transfer calldata against the
invoice amount and canonical Boardroom. A signed unresolved order identifier
is retained locally. An account-scoped watcher continues status recovery
across navigation and unavailable marketplace routes.
Serialized, abortable polling resumes after reload, while an exclusive browser
lock and a fresh storage check prevent two tabs from creating overlapping
payments. Unreadable recovery data is preserved and disables new payments
until it is reconciled.

## Local commands

Install from the repository root so the exact workspace lock is honored:

```sh
bun install --frozen-lockfile
bun --cwd services/x402-router drizzle:generate # must report no schema changes
bun run router:test
X402_ROUTER_TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/x402_router \
bun run router:test
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/x402_router \
bun run router:integration:anvil
bun run router:dev
```

The first test command runs unit tests and type checking. Setting
`X402_ROUTER_TEST_DATABASE_URL` also enables the Postgres concurrency,
uniqueness, recurring-invoice, reservation, and sealed-journal tests. The
deterministic Anvil integration uses Postgres, a mock HyperCore settlement
boundary, and test-only marketplace contract doubles. It does not deploy the
production pledge.cash marketplace bytecode, spend funded testnet assets, or
prove any public route.

The checked-in Drizzle migrations are applied by the runtime before it accepts
traffic. For schema changes, generate and review a new immutable migration:

```sh
DATABASE_URL=postgres://x402_router:x402_router@127.0.0.1:5432/x402_router \
bun run --cwd services/x402-router drizzle:generate
```

Never edit a migration that has been applied to an environment. The newest
checked-in snapshot is the schema-generation baseline. Running the generation
command without a schema change must report `No schema changes`; a
duplicate-table migration is a release blocker.

## HTTP surface

| Route | Meaning |
| --- | --- |
| `GET /health/live` | Process liveness only. |
| `GET /health/ready` | Fail-closed database, deployment, unresolved-operation, gas, refund-inventory, and x402 runtime gate. |
| `GET /v1/status` | Public supported-boundary and x402 runtime status. |
| `POST /v1/quotes` | Validate a canonical action and atomically reserve destination and refund inventory. |
| `POST /v1/quotes/:id/execute` | Return `402` requirements or settle the signed payment and run the durable saga. New unbound payments re-run readiness; an exact bound payment remains recoverable while quote traffic is paused. |
| `GET /v1/orders/:id` | Read the sanitized order, execution, and refund status by quote id. |
| `GET /v1/support/plans` | List active and recent retired monthly plans for one canonical Boardroom. |
| `POST /v1/support/plans/*` | Issue signed-authority challenges, publish immutable plans, or retire plans. |
| `/v1/support/subscriptions/*` | Issue supporter challenges and create, inspect, or cancel hosted schedules. |
| `POST /v1/support/invoices/:id/quotes` | Create the exact x402 attempt for one current-period invoice. |

Only the configured web origin receives CORS access. Treat order responses as
public receipts: they intentionally omit signed payloads, private keys,
operation leases, and raw internal failures.

Public order status distinguishes `recovery_pending` (the exact payment is
being reconciled), `payment_failed` (no payment moved; request a fresh quote),
`paid`, `executing`, `executed`, `refund_pending`, `refunded`, and
`manual_intervention`. Never submit another payment for a
`recovery_pending`, `paid`, `executing`, `refund_pending`, or
`manual_intervention` order.

## Docker

Build from the repository root:

```sh
docker build \
  -f services/x402-router/Dockerfile \
  -t pledge-cash-x402-router .
```

Run the container behind TLS with an external Postgres database and a
supervisor-provided environment:

```sh
docker run --rm \
  --env-file /secure/path/x402-router.env \
  -p 8788:8788 \
  pledge-cash-x402-router
```

The image runs as the unprivileged `bun` user and probes process liveness. The
orchestrator must gate traffic on `/health/ready`, not on the container health
probe.

## Operator rule

Nonce allocation and encrypted signed-payload persistence are one Postgres
transaction for both destination execution and HyperCore refund signers. A
signer nonce must never exist without the exact sealed payload that owns it.
After a process crash, the recovery loop may reclaim an expired submitted
operation and inspect or submit only that sealed transaction or sendAsset
action. A confirmed receipt finalizes execution or refund, a confirmed revert
enters the refund path, and an absent or under-confirmed receipt stays pending.

An ambiguous incoming HyperCore payment or refund stays submitted. After its
lease expires, recovery may call the facilitator again only with the exact
sealed `sendAsset` action and signer nonce; it never creates a replacement
while that result is uncertain. A definitively pre-submit or expired
no-transfer result may release the payment holds or authorize a new
attempt-scoped refund.

A destination-execution request-path receipt timeout remains a deliberately
conservative boundary: it enters `manual_intervention` instead of assuming
that an RPC timeout means failure. Background recovery does not broaden that
manual state into an automatic refund. If a journal mismatch or chain result
cannot be reconciled from the sealed identity, stop accepting quotes and
escalate; never create a replacement payment, execution, or refund by hand.
