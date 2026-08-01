# Distribution Protocol

This document describes the candidate distribution contracts in `packages/contracts/src/distribution/`. The candidate is
a mainnet NO-GO. Fixed-price, Dutch-auction, and Merkle paths use the accepted unbounded obligation model. The
bonding-curve terminal paths implement the product decisions approved for this candidate, but still require
release-candidate and independent security proof before deployment.

## Governance envelope

Before launch, the Boardroom owner submits policy-checked calls through `Boardroom.execute` or
`Boardroom.executeBatch`. After launch, the current controller proposer schedules the exact call batch and anyone may
execute it after the delay. The Boardroom gateway preserves the proposer as policy authority.

`DistributionFactory` is both deployment factory and obligation policy. It accepts only a canonical Boardroom whose
share token matches the requested distribution. Creation is atomic: deterministic clone deployment, initialization,
Boardroom obligation registration, dependency accounting, and exact inventory funding either all succeed or all revert.

## Discovery and provenance

The factory permanently records:

- `isDistribution(distribution)`;
- `distributionBoardroom(distribution)`;
- `distributionKind(distribution)`;
- the canonical `DistributionCreated` event.

Per-Boardroom discovery is append-only and exposed through `distributionCountForBoardroom`,
`distributionForBoardroomAt`, and bounded `distributionPageForBoardroom` pages. Closed distributions are not removed
from discovery. Boardroom active membership is separate: permissionless pruning decrements scalar active counts without
erasing provenance.

`DistributionKind.DutchAuction` is appended as kind `3`; the legacy fixed-price, curve, and Merkle values remain `0`,
`1`, and `2`.

There is no concurrent-distribution capacity ceiling.

## Fixed-price sale

A fixed-price sale escrows a fixed share inventory. Creation requires:

- the Boardroom's canonical share token;
- a readable non-share payment asset;
- nonzero inventory and price;
- a valid start/end window;
- exact Boardroom-to-sale funding.

The payment asset becomes a canonical redeemable-asset dependency. Buys require an active Boardroom, open sale window,
nonzero recipient and amount, remaining inventory, buyer-cap compliance, deadline, and buyer maximum. Quote rounds up.
Payment moves directly to the Boardroom and shares move to the recipient with exact sender and recipient balance-delta
checks.

Only a policy-checked Boardroom call closes or cancels the sale. Unsold inventory returns exactly to the Boardroom.
Starting wind-down stops new buys. A closed sale remains permanent factory history and can be pruned from active
Boardroom membership.

## Dutch auction

A Dutch auction escrows a fixed share inventory and exposes one immutable linear price schedule:

```text
price(t) = startPrice - floor((startPrice - floorPrice) * elapsed / duration)
```

Creation requires a readable non-share payment token, nonzero inventory, a strictly descending positive price range,
and a finite window that ends no more than 90 days after creation. A zero start timestamp means “start now”; a future
start does not extend the absolute 90-day bound.

Purchases deliver shares immediately and move payment directly from the buyer to the Boardroom. Payment rounds up at
the price observed during execution. The purchase window is end-exclusive: at `endTime`, buys are closed and
permissionless finalization is available. Each call binds recipient, exact share amount, maximum payment, and deadline;
the optional per-buyer cap is keyed to `msg.sender`, not the recipient. Exact sender and recipient balance checks reject
fee-on-transfer and sender-surcharge behavior atomically.

Selling the final share closes the auction immediately. Otherwise anyone may call `finalize` at or after the end time,
which closes the obligation and returns unsold shares. The recorded `settlementPrice` is the last successful purchase
price, not the average paid price or the scheduled floor; it is zero when no purchase occurred. A Boardroom may cancel
only before the scheduled start and before any purchase. Early closure is available only through Boardroom wind-down.

Post-auction liquidity is a separate, optional Boardroom decision. The auction neither reserves liquidity nor commits
proceeds. For a new canonical PoolId, the Boardroom action supplies an explicit initial `sqrtPriceX96`; if the canonical
vault already exists, additions use its fixed PoolKey and live v4 state. The UI intentionally supplies no default
proceeds percentage, and all amounts, minimums, and deadlines remain explicit.

## Merkle airdrop

An airdrop escrows shares behind one Merkle root. Direct leaves encode the direct-claim type hash, chain id, index,
predicted airdrop, Boardroom, share token, account, and amount, in that exact order. Grant leaves encode the grant-claim
type hash, chain id, index, predicted airdrop, Boardroom, share token, canonical grant factory, account, amount, and
grant-terms hash, in that exact order. The type hash distinguishes the claim mode; there is no trailing mode field.

Leaves are deliberately not release-bound. `merkleRoot` is immutable, so committing to a facet-set hash would make every
`activateFacetSet` a permanent, protocol-wide invalidation of live manifests. The release is bound per transaction
instead: `claim` and `claimGrant` take an `expectedFacetSetHash` argument that must equal the Boardroom's live
`facetSetHash()`, which rejects a claim whose release changed between authorization and execution while leaving the
published manifest claimable under the new release. Use the SDK's `buildMerkleAirdropDirectClaimLeaf` and
`buildMerkleAirdropGrantClaimLeaf` helpers instead of recreating these layouts.

Direct claims deliver shares to the committed account. Grant claims perform an atomic parent-to-child transition:

1. validate proof, inventory, schedule, and payment-token rules;
2. deploy and fund the child grant;
3. record the child obligation and its asset dependencies;
4. mark the leaf consumed and update parent accounting.

The parent cannot become terminal while it can still create an uncounted child. There is no Boardroom grant-slot
reservation or grant-capacity ceiling. `maxGrantClaims` remains a distribution-specific commitment to the published
root, not a global protocol-capacity limit.

Paid grant claims may add a payment-asset dependency. Asset membership is unbounded; dependency counts prevent removal
while an open parent or child still relies on the asset. Closing or cancelling returns unclaimed shares and stops future
claims.

## Singleton bonding curve

Each Boardroom can create at most one canonical curve in its lifetime. Creation is allowed only:

- before launch;
- while primary-market mode is `Unset`;
- before any other canonical release of transferable shares;
- with a finite nonzero end time;
- with the Boardroom's canonical share token and a readable quote token;
- while singleton protocol liquidity is still unconfigured.

The factory predicts the curve and calls `Boardroom.precommitBondingCurve` before transferring inventory. The Boardroom
permanently records the curve and quote-asset identities, switches primary-market mode to `BondingCurve`, and
authorizes exactly the committed funding amount. Curve deployment, initialization, liquidity reservation, and funding
are atomic.

While `BondingCurve` is active, `BoardroomToken` enforces the primary-market restriction at its transfer boundary.
Boardroom-originated mints, transfers, and `transferFrom` calls may fund only the exact curve or explicitly authorized
atomic migration custody. Earlier allowances do not bypass the rule. Burns that could desynchronize curve liability are
rejected.

Holder-to-holder transfers remain possible. Third-party markets are outside Boardroom-authorized exclusivity.

## Curve pricing and sell liability

The current curve prices buys and sells using the integral of:

```text
price(sold) = basePrice + slope * sold / 1e18
```

Buy quotes round up; sell quotes round down. Exact token balance deltas reject fee-on-transfer and sender-surcharge
behavior.

Sell rights are fungible, not purchase-recipient records. A buy increases one
`outstandingCurveShareLiability`. Any current holder may sell up to the lesser of its transferable share balance and
that global liability. A sale decreases the global liability. Transfers therefore carry economic sell rights with the
shares, while the global cap prevents more shares being sold back than the curve issued.

Prices are denominated in quote-token base units per one whole 18-decimal Boardroom share. Graduation readiness latches
when the quote target is reached or the sale inventory is exhausted, and then freezes trading.

## Curve terminal lifecycle

The explicit phases are `Selling`, `Graduated`, `Unwinding`, `Migrated`, `Settled`, and `Quarantined`.

- Every curve has a finite end no more than 90 days after creation. A future start cannot extend that absolute bound.
- Cancellation before graduation or permissionless expiry begins a 30-day sell-only unwind. Any current holder may sell
  transferable shares against the global liability. After the deadline anyone finalizes; residual quote and unused
  inventory return to the Boardroom, remaining holders retain their shares, and the primary market becomes
  `GeneralAvailability` without automatic liquidity.
- Graduation opens a seven-day permissionless migration window. If migration does not complete, anyone may enter the
  same 30-day sell-only unwind.
- Settlement and migration release the active curve obligation atomically. Permanent curve and quote tombstones remain.

## Singleton liquidity reservation

Curve creation reserves the Boardroom's one predicted vault and canonical PoolId initialization. The reservation binds
Boardroom, curve, share token, permanent quote asset, full PoolKey, PoolId, and salt. The `beforeInitialize` hook rejects
any initializer other than the factory's currently authorized reservation, and reservation/funding also reject an
already initialized PoolId.

A successful migration must consume that exact reservation and activate the first and only canonical vault/PoolId.
Reservation release never clears the Boardroom's quote identity.

## Migration price continuity

The terminal marginal price is:

```text
terminalPrice = basePrice + floor(slope * soldShares / 1e18)
```

Migration selects quote first from the recorded reserve according to `quoteToLpBps`, then derives share inventory as
`floor(quoteToLiquidity * 1e18 / terminalPrice)`. Unused reserved shares and quote return to the Boardroom. Actual v4
funding must satisfy caller minimums of at least 95% of the protocol-derived amounts, and the supplied initialization
price may deviate from the terminal price by at most 50 basis points. These conventions are simulated across edge and fuzzed
parameter grids in `BondingCurveEconomicSimulation.t.sol`.

## Quarantined quote

A failed best-effort quote return enters `Quarantined`; it is not a closed obligation and retains the singleton
liquidity reservation. Anyone may retry recovery. Before snapshotting, recovered value goes to the Boardroom. After the
redemption snapshot boundary, it goes to the immutable redemption-excess recipient.

Forfeiture is impossible before wind-down. After 30 days in quarantine, anyone may open a seven-day forfeiture window.
A staker with at least 1% power against both current and previous-block eligible supply may veto, restarting the 30-day
delay. If no veto occurs, anyone may finalize forfeiture. Only then does the curve become terminal and release its
reservation. Quote that later becomes recoverable follows the same Boardroom-before-snapshot and excess-recipient-after-
snapshot rule.

## Safety invariants

- A Boardroom has at most one permanent curve, quote asset, P4LP vault, and PoolId.
- A curve cannot be created after launch or after any other canonical transferable-share release.
- Curve funding cannot be redirected or repeated.
- Old allowances cannot bypass the token-level primary-market guard.
- Global curve liability equals the maximum aggregate shares the curve remains obligated to repurchase.
- A transferee can exercise the same fungible sell right as an original buyer without exceeding global liability.
- A bounded unwind may discharge the global repurchase liability only after every holder had the full 30-day sell window;
  remaining holders keep their shares.
- No stranded quote path may mark the curve closed before recovery or the delayed, vetoable wind-down forfeiture.
- Factory discovery is append-only and bounded by page size, not lifetime count.
- Parent-to-child creation is atomic and reentrancy-safe.
- Dutch-auction prices never increase, payment rounds up, and settlement records only the last successful execution
  price.
- Auction finalization is permissionless and bounded; optional liquidity remains a separate governed action.
- No lifecycle transition performs work proportional to unbounded history.

## Deterministic proof

Use Foundry v1.7.1 and run:

```sh
bun --cwd packages/contracts build
bun --cwd packages/contracts test
forge test --match-path test/distribution/Distribution.t.sol -vv
forge test --match-path test/boardroom/BoardroomWindDownInvariant.t.sol -vv
bun run format:check
```

Also run SDK, web, Sentinel, docs, contract-size, and maximum-gas checks. These checks do not remove the explicit
mainnet blockers.
