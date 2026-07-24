# x402 Hyperliquid marketplace router v1

## Status

This document defines the implemented v1 boundary and the gates required before
funded use. It does not claim a live deployment.

At the time of this change, `packages/contracts/deployments/998.json` is
`pending`. The router therefore reports not ready and refuses quotes. Funded
readiness requires a checked-in, verified HyperEVM testnet release artifact and
all of the operational gates below.

The router pins `x402-hl` version `0.2.2` to the exact Git commit
`131aff37cf87c48036ab0e347f008e77bf446150`. That version is the first accepted
runtime for funded settlement in this service. Runtime package inspection is a
second fail-closed gate: a prerelease, an older installed version, or unreadable
package metadata cannot enable funded settlement.

## Boundary

V1 joins two testnet-local asset movements:

1. an exact HyperCore spot USDC payment from the user to the router; and
2. a prefunded HyperEVM USDC marketplace action submitted by the router's
   dedicated executor.

It is intentionally not a bridge. No user asset is minted, wrapped, or proven
across consensus systems. The operator temporarily owes either a confirmed
HyperEVM fulfillment or a full HyperCore refund after accepting payment.

Supported actions are:

- `amm_swap`: exact HyperEVM USDC input through the canonical `AmmRouter` into
  the active Boardroom's share token; and
- `fixed_price_sale`: purchase from a canonical, open, uncapped fixed-price
  sale whose payment token is the configured HyperEVM USDC.

Every order requires:

- source network `hyperliquid:testnet`;
- destination chain `eip155:998`;
- payer, output recipient, and refund address to be the same EVM address;
- zero native value;
- a maximum five-minute quote;
- a caller slippage bound no greater than the operator maximum;
- a total source payment no greater than the explicit order cap; and
- enough unreserved destination USDC, token allowance, HyperEVM gas, and
  HyperCore refund USDC at quote time.

Not supported:

- mainnet;
- grants, bonding curves, bond markets, auctions, or capped fixed-price sales;
- arbitrary targets, paths, assets, recipients, values, or calldata;
- delegated payers or output/refund recipients;
- netting customer deposits into destination inventory;
- partial fulfillment or partial refund; or
- an operator choosing a replacement action after payment.

## Architecture

```text
Browser wallet
  | 1. request canonical quote
  v
x402 router API ---- read-only validation ----> HyperEVM testnet RPC
  | 2. immutable quote + inventory holds
  v
Postgres
  | 3. exact 402 requirements + signed execution intent
  v
HyperCore testnet spot settlement
  | 4. durable paid record
  v
policy -> simulate -> sign once -> submit -> confirm
  |                                      |
  v                                      v
HyperEVM fulfillment              HyperCore full refund
```

The route quote is the authority boundary. The paid HTTP request contributes a
signed payment envelope; it cannot replace the persisted target, calldata,
recipient, limits, or intent template.

### Quote and reservation

Before persisting a quote, the service reads the canonical factories and live
market state. It calculates the exact destination principal, converts 6-decimal
HyperEVM USDC to 8-decimal HyperCore USDC, applies the configured basis-point
fee with upward rounding, and rejects totals above
`X402_ROUTER_MAX_ORDER_ATOMIC`.

The same database transaction writes the immutable quote and reserves:

- destination execution inventory for the exact HyperEVM principal; and
- source refund inventory for the complete HyperCore payment, including the
  service fee.

Concurrent quotes cannot each count the same unreserved balance. Expired unpaid
quotes release both holds. The first valid signed payload binds the quote to
one sealed-envelope hash and one recovered-signer/sendAsset identity, then
atomically commits both holds before facilitator settlement. The action
identity is globally single-quote even if mutable x402 extensions differ. A
different envelope cannot take over that quote. Confirmed
fulfillment or refund consumes the corresponding obligation; a definite
no-payment settlement failure releases both.

### Canonical AMM action

An AMM quote is accepted only when:

- `tokenIn` is the configured HyperEVM USDC;
- `tokenOut` is the requested active Boardroom's share token;
- `BoardroomFactory.isBoardroom(boardroom)` is true;
- `AmmFactory.isPool(pool)` is true;
- `AmmFactory.getPool(tokenIn, tokenOut)` returns the same pool;
- the tracked router equals `AmmFactory.liquidityRouter()`;
- the exact-input quote returns a nonzero output;
- slippage produces a nonzero minimum; and
- the executor's USDC balance and allowance cover the exact input.

The router builds `swapExactTokensForTokens` itself. It fixes the two-token
path, exact input, minimum output, same-party recipient, deadline, target, and
zero value.

### Canonical fixed-price action

A fixed-price quote is accepted only when:

- `BoardroomFactory.isBoardroom(boardroom)` is true;
- `DistributionFactory.isDistribution(sale)` is true;
- the recorded distribution kind is fixed-price;
- the factory and Boardroom relationships match live state;
- the sale share token equals the Boardroom share token;
- the payment token is the configured HyperEVM USDC;
- the Boardroom and sale are active and the latest HyperEVM block timestamp is
  inside the sale window;
- `maxPerBuyer` is zero;
- remaining supply covers the request; and
- the executor's balance and sale allowance cover the quoted payment.

Buyer-capped sales are excluded because the onchain contract accounts purchases
against `msg.sender`; a broker would collapse every user into the executor's
cap. The router builds `buy` itself with the requested share amount,
same-party recipient, bounded maximum payment, deadline, and zero value.

### Browser recovery

The web rail is shown only when its build-time API origin, application,
gateway, and destination USDC settings are valid; the connected network is
chain `998`; and the selected AMM input or sale payment token is that exact
USDC. It does not expose this path for any other marketplace action.

After the wallet creates a signed payment payload, the browser stores the
nonsensitive quote and stable order id locally before sending the paid retry.
An account-scoped recovery watcher stays mounted across navigation and market
availability changes, so a reload, route change, or temporary outage resumes
serialized, abortable `GET /v1/orders/:id` polling instead of offering another
payment. If the paid retry never reached the router, an expired quote with no
payment binding becomes a definite `payment_failed` result and releases its
uncommitted holds.

New payment creation requires browser cross-tab locking. Under that lock the
client re-reads both supported action records before signing, so two tabs
cannot overwrite an unresolved order or create concurrent payments for the
same payer. Malformed recovery data is preserved and locks payment creation;
it is never deleted as a parse-error fallback. The lock clears only after
confirmed execution, confirmed refund, or a definite `payment_failed` result.
`recovery_pending` and `manual_intervention` remain locked.

## Durable order state

Postgres is part of the safety boundary, not a cache. Its checked-in migrations
and matching Drizzle schema snapshot create:

- immutable quote and payment-requirement records;
- a one-payload-per-quote payment binding;
- inventory reservations;
- one primary intent record with unique payment, execution, and refund
  transaction identities; and
- encrypted signed-operation journals with compare-and-swap revisions,
  expiring leases, and atomic per-signer nonce plus signed-payload persistence.

The high-level saga is:

```text
quoted
  -> recovery_pending
  -> payment_failed

quoted / recovery_pending
  -> paid
  -> execution_claimed
  -> execution_submitted
  -> executed

execution_failed
  -> refund_pending
  -> refund_claimed
  -> refund_submitted
  -> refunded

ambiguous incoming payment submit or receipt
  -> recovery_pending

ambiguous refund submit or receipt
  -> refund_submitted (same sealed action only)

ambiguous destination execution receipt on the request path
  -> manual_intervention
```

Duplicate payment identities cannot create a second fulfillment. Atomic
revision and status transitions prevent two workers from owning the same
operation. Nonce allocation and encryption of the exact signed transaction or
HyperCore refund action are one database transaction. The service submits and
recovers only that payload, nonce, and hash. It never signs a different
transaction or refund action to guess whether an ambiguous submission
succeeded.

The bounded recovery worker scans only expired leases older than the request
receipt timeout plus a safety grace, so it cannot reclaim a still-live request.
It can replay one exact journaled incoming HyperCore payload, replay the exact
sealed refund action under the same attempt after an ambiguous response,
reconcile an abandoned submitted HyperEVM transaction by receipt, move a
confirmed revert into the refund path, and create a new refund attempt only
after the previous adapter proved that no refund moved. An absent or
under-confirmed receipt remains pending. A normal destination-execution
request-path receipt timeout deliberately becomes `manual_intervention`;
automated recovery does not broaden that ambiguous state into a refund.

`manual_intervention` is terminal for automation. It means chain evidence is
insufficient to declare fulfillment failed and a refund could create a double
payout.

## Assets, authority, and invariants

| Asset or state | Movement authority | Required invariant |
| --- | --- | --- |
| User HyperCore USDC | User signature, verified and settled by the pinned x402 scheme | Payer, amount, asset, network, pay-to address, payment id, quote hash, and intent template match the immutable quote. |
| Executor HyperEVM USDC | Dedicated gateway private key | Only canonical AMM or uncapped sale calldata from a persisted paid intent can consume inventory. |
| HyperCore refund USDC | Dedicated pay-to/refund private key | A full refund goes only to the signed same-party refund address and has one durable transaction identity. |
| HyperEVM HYPE | Dedicated gateway private key | Simulation gas is below the signed and configured maximum before submission. |
| Quote and operation state | Transactional Postgres roles | Unique identities, compare-and-swap transitions, reservation accounting, and encrypted signed journals remain durable. |

The following must hold before and after every externally reachable action:

1. Payer, recipient, and refund address remain identical.
2. A quote's chain, action, target, calldata, value, bounds, payment
   requirements, and intent template never change after creation.
3. One confirmed source payment can produce at most one destination
   fulfillment.
4. A confirmed fulfillment can never also be refunded.
5. A refund is for the complete accepted source amount, including the service
   fee.
6. Unknown, stale, conflicting, or ambiguous state fails closed.
7. Quote issuance never exceeds the available inventory left after active
   reservations.

## Security model

### Controls

- **Calldata substitution:** The service constructs calls from canonical live
  reads, decodes the signed action during policy evaluation, verifies every
  argument, and compares the exact calldata hash.
- **Route substitution:** Factory membership, factory relationships,
  Boardroom/share-token identity, active state, and tracked release addresses
  are checked at quote time and again at execution policy time.
- **Recipient theft:** V1 binds payer, recipient, refund address, payment
  evidence, and intent user to one checksummed address.
- **Replay and double spend:** Payment ids and all chain transaction identities
  have durable uniqueness constraints; one recovered signer/sendAsset action
  can bind only one quote and one sealed x402 envelope; state changes use
  revisions and claim tokens.
- **Inventory overcommit:** Quote creation atomically accounts for active
  destination and refund reservations, conservatively capping destination
  capacity by the lower of executor balance and live allowance.
- **Crash ambiguity:** Signed requests are encrypted before submit. Expired
  crash leases reconcile only the sealed payload and public receipt; an absent
  receipt remains pending, while an ambiguous request-path timeout becomes
  manual intervention rather than a blind replacement or refund.
- **Stale economics:** Short expiries, exact maximum payment, minimum output,
  maximum slippage, maximum source total, and maximum gas cost are committed
  into the quote and signed intent.
- **Dependency regression:** Funded settlement requires a stable installed
  `x402-hl >= 0.2.2`, and the workspace pins the reviewed 0.2.2 commit.
- **Deployment drift:** Readiness checks the tracked non-pending artifact,
  chain id, required code, and canonical AMM router wiring.

### Residual trust

Users still trust the operator to:

- keep independent destination and refund inventory available;
- protect both signing keys and the journal encryption key;
- use honest, available HyperCore and HyperEVM endpoints;
- retain a consistent Postgres history and respond to manual intervention;
- choose and publish reasonable fee, cap, slippage, gas, confirmation, and
  reserve policies; and
- avoid accepting traffic when operational monitoring is impaired.

This v1 does not provide cryptographic cross-chain solvency or trustless
delivery. A later design would need a different settlement primitive, not a
broader arbitrary-call API.

## Readiness and launch gates

`GET /health/live` proves only that the process can serve HTTP.
`GET /health/ready` must return `200`, `ready: true`, and
`acceptingQuotes: true` before traffic is enabled. Readiness fails when:

- Postgres is unavailable;
- the HyperEVM deployment artifact is missing, pending, incomplete, or fails
  canonical live checks;
- the executor HYPE balance is below `HYPEREVM_MIN_GAS_BALANCE_WEI`;
- HyperCore available spot USDC is below
  `X402_ROUTER_MIN_REFUND_RESERVE_ATOMIC`; or
- any adapter operation requires manual intervention; or
- the installed x402 runtime is below the funded-settlement minimum.

Quote creation and every new unbound signed payment re-run this readiness gate.
Pausing quote traffic does not strand a payment already bound in the durable
journal: only its exact payload may continue through recovery.

Funded testnet launch additionally requires a recorded operator sign-off for
every item below:

- [ ] Exact `x402-hl` commit
  `131aff37cf87c48036ab0e347f008e77bf446150` is present in `bun.lock`, reports
  version `0.2.2`, and passes its release gate.
- [ ] `packages/contracts/deployments/998.json` is verified and no longer
  `pending`.
- [ ] Configured USDC, Boardroom factory, AMM router, AMM factory, and
  distribution factory match the tracked artifact and live code.
- [ ] `X402_ROUTER_SERVICE_FEE_BPS` and
  `X402_ROUTER_MAX_ORDER_ATOMIC` have explicit economic approval.
- [ ] Quote TTL, slippage, gas-cost, confirmation, and operation-lease bounds
  have explicit operational approval.
- [ ] The executor has enough destination USDC, HYPE, and only the required
  canonical allowances.
- [ ] The refund account has enough available HyperCore spot USDC for the
  reserve and expected concurrent order cap.
- [ ] Postgres migrations, point-in-time recovery, encrypted backups, restore
  rehearsal, least-privilege credentials, and a no-diff Drizzle generation
  check are complete.
- [ ] Both signing keys and the journal encryption key are stored outside the
  image and repository, with tested access and rotation procedures.
- [ ] TLS, rate limits, request limits, log redaction, readiness-based traffic
  gating, and alert delivery are enabled.
- [ ] Unit/type checks and deterministic Anvil/Postgres integration pass from a
  clean checkout with Bun `1.3.11` and Foundry `1.7.1`.
- [ ] A separately approved funded testnet exercise proves one AMM execution,
  one fixed-price execution, one forced execution failure with a full refund,
  duplicate-payment handling, restart recovery, and an ambiguous-receipt drill.

No CI job should hold funded keys. CI proves deterministic service behavior
with Postgres, Anvil, and a mock HyperCore boundary; funded evidence is a
separate controlled operation.

## Operations

### Deployment

1. Build the image from a clean, reviewed repository state with the frozen Bun
   lock.
2. Provision a dedicated Postgres database and secret-manager references.
3. Set an explicit fee and order limit; do not copy example economics without
   approval.
4. Fund the two inventory accounts and establish only the canonical
   allowances.
5. Start one release with traffic disabled. Let the runtime apply checked-in
   migrations.
6. Build the web app with `VITE_X402_ROUTER_API_URL`,
   `VITE_X402_ROUTER_APPLICATION`,
   `VITE_X402_ROUTER_GATEWAY_ADDRESS`, and
   `VITE_X402_ROUTER_HYPEREVM_USDC_ADDRESS` matching the service.
7. Verify `/health/live`, `/health/ready`, `/v1/status`, the installed x402
   version, live addresses, balances, and allowances.
8. Enable traffic only while readiness remains green.

Do not roll back application code across a forward-only database migration.
Deploy a compatible fix forward. Before horizontal scaling, prove the database
lease, signer-nonce, and connection-capacity behavior under the intended
replica count.

### Monitoring

Alert on:

- any non-`200` readiness response for two consecutive probes;
- readiness failure for database, deployment, x402 version, executor gas, or
  refund inventory;
- any `manual_intervention` order immediately;
- any `payment_failed` result rate above the expected user-failure baseline;
- any `recovery_pending` order beyond the declared service objective;
- operation leases that expire while `claimed`, `signed`, or `submitted`;
- paid orders that do not reach a terminal state inside the declared service
  objective;
- repeated quote, settlement, execution, simulation, or refund failures;
- active reservations approaching actual inventory;
- destination allowance changes;
- unexpected signer nonce movement;
- database storage, replication, backup, or connection pressure; and
- a mismatch between the running image/lock digest and the approved release.

Metrics and logs must use quote ids, payment identifiers, status, revisions,
and public transaction hashes. Never log private keys, signed payloads,
unencrypted journals, full payment headers, claim tokens, database credentials,
or the journal encryption key.

### Incident and reconciliation

When a submission or receipt is uncertain:

1. Disable quote traffic without terminating the database or deleting leases.
2. Preserve the database, image digest, configuration fingerprint, RPC
   responses, and public logs.
3. Read the persisted signed transaction hash or HyperCore action nonce and
   query multiple trusted endpoints on the relevant chain.
4. Reconcile the exact payment, execution, or refund identity. Do not sign a
   replacement and do not issue a refund while fulfillment may have succeeded.
5. Resume the same idempotent operation only when the stored state and chain
   evidence agree. Otherwise retain `manual_intervention` and escalate.
6. Re-enable traffic only after readiness, inventory accounting, and signer
   nonce state are consistent.

For a signing-key compromise, halt traffic, preserve evidence, revoke
allowances or move remaining inventory with a separately approved response,
and rotate the intent domain/gateway deliberately. Changing the gateway makes
old intent-domain assumptions invalid; never treat it as an in-place secret
swap.

For a database loss, do not restart against an empty database while either
signer may have submitted operations. Restore the database and matching journal
key, then reconcile every nonterminal record against both chains before
accepting traffic.

## Deterministic proof

The repository-level commands are:

```sh
bun install --frozen-lockfile
bun --cwd services/x402-router drizzle:generate # must report no schema changes
X402_ROUTER_TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/x402_router \
bun run router:test
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/x402_router \
bun run router:integration:anvil
docker build -f services/x402-router/Dockerfile .
```

The integration proof is deliberately unfunded. Its HyperCore settlement
boundary and HyperEVM marketplace contracts are test doubles; it exercises the
router saga, not the production pledge.cash bytecode or either public route. A
funded launch remains blocked until every launch-gate checkbox above has
independent evidence.
