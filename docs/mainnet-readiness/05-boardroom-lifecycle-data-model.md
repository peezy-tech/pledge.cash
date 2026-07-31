# Hard release blocker 5: Boardroom lifecycle and storage proof

Status: **Implemented locally; blocked on final acceptance, target-chain proof,
and audit**

Scope: obligations, discovery, primary-market exclusivity, bonding curves,
liquidity custody, wind-down liveness, redemption accounting, ERC-7201
storage, and release migration.

## Accepted model

The canonical Boardroom lifecycle is monotonic:

```text
Active -> WindingDown -> Snapshotting -> RedemptionsOpen
```

One permanent Boardroom address holds project assets throughout that
lifecycle. Its kernel routes behavior through the global protocol registry;
no lifecycle phase pins or freezes logic.

## Obligations and discovery

Safety-critical obligation state uses:

- canonical address-to-record membership;
- permanent policy and kind provenance;
- scalar active total and per-kind counts;
- per-obligation dependency assets;
- per-asset dependency counts;
- permanent tombstones after pruning.

Parent-to-child transitions record the child and dependencies atomically.
Terminal obligations are pruned permissionlessly, individually or in bounded
batches. Pruning removes active counts but never erases provenance.

Factories expose canonical creation events and bounded append-only discovery
pages. Discovery history is not a protocol-capacity or lifecycle dependency.
No public transition iterates over all lifetime grants, distributions, bonds,
or liquidity vaults.

## Redeemable assets and snapshotting

Redeemable assets use canonical membership, append-only enumeration, and
dependency counts. `beginSnapshot` is unavailable until:

- the immutable wind-down delay elapsed;
- every active obligation count is zero;
- the reward pool is terminal;
- singleton protocol liquidity is closed;
- treasury-share handling is complete.

Beginning snapshotting freezes the asset-registry length and redemption supply.
Anyone processes a bounded page. Each frozen entry becomes Included, Excluded,
or explicitly Unreadable; every attempt advances the cursor. Redemptions open
only when the full frozen registry has been processed.

Burned shares become holder-owned redemption credits. Assets are claimed
independently with exact-transfer accounting, so one hostile token cannot roll
back another payout. Proven late excess is sweepable only to the preserved
redemption-excess recipient.

## Primary market and curve terminal policy

Each Boardroom has one monotonic primary-market mode:

```text
Unset -> BondingCurve
Unset -> GeneralAvailability
BondingCurve -> GeneralAvailability
```

Only one lifetime bonding curve can be precommitted, before launch and before
another canonical transferable-share release. The curve and quote-asset
identities remain permanent tombstones.

While a curve is active, `BoardroomToken` enforces its exclusivity at the share
transfer boundary, including prior allowances and Boardroom-originated
liquidity seeding. Holder transfers and third-party markets remain possible.
Sell rights follow transferred shares but cannot exceed one global outstanding
curve-share liability.

The immutable terminal bounds are:

- 90-day maximum sale lifetime;
- seven-day migration grace;
- 30-day sell-only unwind;
- 30-day quote quarantine;
- seven-day holder-veto window;
- 50-basis-point maximum v4 initialization-price deviation.

Cancellation, expiry, or failed migration enters the bounded unwind.
Permissionless migration uses the terminal marginal curve price and consumes
the Boardroom's singleton liquidity reservation atomically. Unrecoverable
quote remains an active obligation; forfeiture is available only during
wind-down after quarantine and an unvetoed window.

## Protocol-owned liquidity

Each Boardroom has one permanent quote identity, at most one canonical Uniswap v4 PoolId,
and at most one canonical P4LP vault:

```text
Unconfigured -> Active -> Closed
```

Prelaunch setup and repeated additions target that same full-range position. After launch, active removal requires
delayed controller governance, can burn only protocol-held P4LP, and returns assets only to the Boardroom. During
wind-down, full exit is permissionless; when hostile underlying tokens prevent exact removal, the vault enters Claims
without calling them and protocol-held P4LP becomes a Boardroom redemption asset.

Exact exit closes an empty vault. The Claims fallback separately closes and prunes the Boardroom obligation while
preserving proportional underlying rights for external P4LP holders. Snapshotting and open redemptions reject active
liquidity mutation.

## ERC-7201 storage and migration

The kernel owns
`pledge.cash.boardroom.diamond.kernel`, which contains initialization,
migration lock, applied storage version, and applied layout commitment.
Business concerns use distinct Boardroom ERC-7201 namespaces. Release B adds a
separate additive namespace.

Every registry release commits the required storage version and layout hash.
A version increase requires exactly one pinned Migration route. Activation
immediately changes global routing and blocks ordinary writes on each
unmigrated Boardroom. Anyone may migrate one Boardroom atomically; the kernel
holds a migration reentrancy lock and post-verifies the exact target
version/layout and unchanged registry release metadata.

Views must safely decode supported prior layouts or explicitly report
migration required. Publication without activation causes no downtime, and a
same-version activation needs no storage migration.

## Required invariants

1. Obligation counts cannot underflow, double-decrement, omit an active child,
   or be forged by a noncanonical policy.
2. Pruning cannot erase provenance or make a tombstoned obligation reusable.
3. Wind-down and snapshot progress remain bounded regardless of lifetime
   history.
4. Redemptions cannot open around one active obligation, unresolved asset
   dependency, open liquidity position, or curve quote.
5. One frozen asset registry and supply determine all credits and exact
   payouts.
6. One lifetime curve, quote identity, PoolId, and P4LP vault cannot be replaced or
   duplicated.
7. Holder curve sell rights remain fungible without exceeding global
   liability.
8. Migration, unwind, quarantine, and liquidity reservation transitions are
   atomic and cannot strand an uncounted asset.
9. A release/facet cannot corrupt kernel metadata or another concern's
   namespace without the postconditions reverting.
10. A hostile payout cannot prevent healthy-asset claims or destroy retryable
    credit.

## Focused evidence

The canonical Boardroom behavior suite records 64 passing tests; module
integration records 13; the wind-down file records seven deterministic/stateful
tests and six invariant campaigns at 256 runs and 128,000 handler calls each.
The integrated local scenario covers active modules, wind-down, release
activation, pre-migration write failure, independent migration of three
Boardrooms, cleanup, paged snapshotting, redemption, and hostile-path
boundaries.

Exact commands and the current evidence caveats are in the
[canonical design/evidence report](../design/boardroom-diamondization-spike.md).

## Exit criteria

- [x] Canonical mapping/count/tombstone obligation model is implemented.
- [x] Discovery is bounded and not a liveness dependency.
- [x] Singleton primary-market and protocol-liquidity state is implemented.
- [x] Terminal curve economics and time bounds are implemented.
- [x] Dependency-counted paginated snapshotting and independent redemption
      claims are implemented.
- [x] Business and kernel state use named ERC-7201 namespaces.
- [x] Global release activation, expected-hash binding, migration downtime, and
      permissionless atomic migration are implemented.
- [ ] Final exact-head contract, SDK, application, and service acceptance is
      green.
- [ ] Maximum activation/migration/lifecycle gas fits the selected target
      chain.
- [ ] The exact release passes independent security and economic review.
- [ ] A promoted public-testnet deployment completes the entire lifecycle and
      release migration through supported product paths.

Until the open items close, this is local feature-parity evidence, not
production authorization.
