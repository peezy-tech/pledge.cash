# Hard release blocker 5: Boardroom lifecycle storage does not match the intended product

Status: **Core architecture accepted; curve terminal economics still need design sign-off, implementation, and proof**

Scope: grant and distribution registration, primary-market exclusivity, bonding curves, liquidity custody, factory
discovery, wind-down liveness, redemption asset enumeration, and the delegated Boardroom storage layout.

## Release decision

Do not freeze the current Boardroom for mainnet. Its hard capacity limits, many-position liquidity model, and repeatable
bonding-curve model are not the intended product. Raising or deleting constants is unsafe because the same arrays are
traversed during pruning, wind-down finalization, redemption, and factory discovery.

The release needs a new storage model that keeps safety checks constant-time or explicitly paginated while removing
arbitrary concurrent-obligation ceilings.

## Current hard limits

The Boardroom arrays are dynamic Solidity arrays, but contract constants impose hard capacity limits:

| Surface | Current limit | What consumes it |
| --- | ---: | --- |
| Issued grants | 128 | Active grants plus slots reserved for future grant-backed distribution claims |
| Issued distributions | 128 | Active fixed sales, Merkle distributions, migrating curves, and other registered distributions |
| Locked-liquidity positions | 32 | One locker per Boardroom/pool pair |
| Redeemable assets | 32 | Assets included in wind-down snapshot and redemption accounting |
| DistributionFactory active discovery | 128 | Open distributions per Boardroom after opportunistic pruning |
| BondMarketFactory active discovery | 128 | Open bond markets per Boardroom after opportunistic pruning |
| LockedLiquidityFactory active discovery | 32 | Funded lockers per Boardroom, including migration reservations in capacity checks |

The grant limit is particularly non-obvious. A grant-backed Merkle distribution reserves its declared maximum future
grant claims against the Boardroom's 128 slots so a valid later claim cannot fail merely because unrelated grants used
the remaining capacity.

These limits prevent unbounded loops today, but the obligation limits are also concurrent product ceilings. Closed
grants, distributions, bonds, and lockers are swap-pop pruned and their capacity can be reused; redeemable assets are
stickier because unrelated open obligations currently block their removal. None should be silently raised to a larger
magic number.

## Separate storage-layout concern

[BoardroomGovernanceLogic](../../packages/contracts/src/boardroom/BoardroomGovernanceLogic.sol) reaches Boardroom state
through manually coordinated raw slot numbers for arrays, mappings, counters, and the reward pool. The main Boardroom
also passes storage-slot descriptors into delegated payout logic.

This is brittle even though Boardroom clones are immutable rather than upgradeable. Adding, reordering, or changing a
field can make delegated logic operate on the wrong state unless every slot description is updated perfectly. The new
release should use named, [ERC-7201 namespaced storage](https://eips.ethereum.org/EIPS/eip-7201) libraries for each
concern rather than numeric lifecycle slots.

## Required model: membership and counts, not active arrays

Boardroom safety needs to answer these questions onchain:

- is this address a canonical active obligation of this Boardroom?
- which policy authenticated it?
- what kind of obligation is it?
- are any obligations still open before redemptions may begin?

None requires an array of every active address. A representative namespaced layout is:

```solidity
library BoardroomObligationStorage {
    enum Kind { None, Grant, Distribution }

    struct Record {
        address policy;
        Kind kind;
        bool active;
        bool everRegistered;
    }

    /// @custom:storage-location erc7201:pledge.cash.boardroom.obligations
    struct Layout {
        uint256 activeCount;
        mapping(Kind => uint256) activeByKind;
        mapping(address => Record) obligationOf;
    }

    // The Layout root is the precomputed ERC-7201 location for the namespace above.
}
```

The exact packing is an implementation detail. The invariants are not:

- only a successful, policy-authorized Boardroom call may register an obligation;
- canonical factory and reciprocal Boardroom relationships are verified before incrementing counts;
- one address can be registered only once;
- a permissionless `pruneObligation(address)` verifies terminal state before setting `active = false` and decrementing
  exactly one count; policy, kind, and the permanent registration tombstone are retained;
- a bounded `pruneObligations(address[])` may improve operations but must cap work per transaction; and
- opening redemptions checks scalar active counts rather than traversing every historical obligation, then separately
  proves that singleton liquidity is closed and the singleton reward pool is terminal.

Without a grant capacity limit, future-claim slot reservations disappear. Grant-backed distributions still need an
explicit lifecycle: every claimed grant is registered, and the parent distribution cannot be terminal while it may
still create children. Parent-to-child registration and any parent decrement must be one reentrancy-safe atomic
transition; pruning cannot interleave after a parent marks itself terminal but before its child is counted. Wind-down
cleanup may take multiple permissionless transactions, but no single transaction is allowed to grow with history.

A disabled module policy must remain usable for bounded lifecycle checks, cleanup, and pruning of obligations it
previously authenticated. Disabling new creation must not strand existing obligations.

## Discovery belongs outside the safety state

Permanent history and live authorization should not share one array.

- Boardroom registration events should form the canonical cross-policy journal. Factory events may add module-specific
  history but cannot be the only source if future policy types are extensible.
- If contracts need onchain discovery, factories may retain append-only histories without a lifetime cap, but expose
  `count`, `at`, and bounded `page` reads rather than returning the full array.
- Boardroom state should keep only current membership and scalar counts needed for authorization and terminal-state
  checks.
- SDK, web, and Sentinel discovery must tolerate pagination and independently verify every discovered relationship.

This prevents an indexing convenience from becoming a protocol liveness limit.

## Required model: one canonical bonding curve

A Boardroom may create at most one bonding curve in its lifetime, and only before launch. The curve is a primary-market
mode, not another repeatable distribution in the general obligation collection.

A representative monotonic state is:

```solidity
enum PrimaryMarketMode { Unset, BondingCurve, GeneralAvailability }

enum CurvePhase { None, Selling, Graduated, Unwinding, Migrated, Settled, Quarantined }

enum SettlementReason { None, Cancelled, Expired, MigrationFailed }

struct BondingCurveState {
    address curve;
    address quoteAsset;
    CurvePhase phase;
    SettlementReason settlementReason;
    uint64 saleEndsAt;
    uint64 phaseEndsAt;
    bool everConfigured;
}
```

The required high-level transitions are:

1. a new Boardroom starts `Unset`;
2. creating the one canonical curve before any competing availability path records a permanent curve tombstone and
   moves to `BondingCurve / Selling`;
3. any non-curve Boardroom action that first makes transferable project shares available moves `Unset` to
   `GeneralAvailability` and permanently disables curve creation;
4. launching an `Unset` Boardroom moves it to `GeneralAvailability`, so no curve can be introduced after launch;
   launching a Boardroom whose curve is already selling does not end or bypass that curve;
5. reaching the configured quote target or selling the configured sale supply latches `Graduated`, stops normal curve
   buys and sells, and permits sell-only reopening only through the explicit failed-migration fallback;
6. a deterministic, permissionless migration moves `Graduated` to `Migrated`, creates the singleton liquidity position,
   and moves the primary market to `GeneralAvailability` atomically;
7. cancellation before graduation or permissionless expiry moves `Selling` to a bounded `Unwinding` phase rather than
   confiscating the reserve or declaring the curve closed immediately; and
8. a successful unwind settlement, failed-migration fallback, or explicit quarantine resolution moves the mode to
   `GeneralAvailability`, but never clears the curve or quote-asset tombstone and never permits another curve.

While `BondingCurve` is active, it is the only Boardroom-authorized primary share-distribution and price-discovery
route. The Boardroom must reject other paths that release its shares, including fixed-price sales, share airdrops or
grants, share-funded rewards, bond inventory, direct public minting or treasury transfers, and direct liquidity seeding.
It must also reject approvals or spender paths that could pull Boardroom shares around that rule. Every call in a batch
rechecks the live mode immediately before execution, so curve creation and a competing release cannot be pre-authorized
from the same `Unset` snapshot.

### Exclusivity must be enforced by the share token

Boardroom policy and factory checks are necessary but not sufficient. An allowance granted before curve creation, or a
future policy mistake, could otherwise use `transferFrom` to pull treasury shares after the curve became canonical.

Curve creation must therefore precommit the predicted canonical curve address before the factory funds or initializes
it, and [BoardroomToken](../../packages/contracts/src/boardroom/BoardroomToken.sol) must enforce the canonical
primary-market state in its transfer boundary. While `BondingCurve` is active:

- a Boardroom-authorized mint may target only the Boardroom, the exact precommitted curve, or explicitly named atomic
  migration custody;
- a transfer or `transferFrom` whose source is the Boardroom may target only that same canonical custody, regardless of
  who holds an allowance;
- later treasury top-ups outside the reviewed curve lifecycle are rejected; and
- burns or other supply changes that would desynchronize outstanding curve shares are rejected or accounted for in the
  same atomic transition.

The exact storage placement may be chosen during implementation, but the token hook must obtain mode, curve, and
migration-custody identity from its immutable Boardroom relationship, never from caller-supplied parameters. The
Boardroom, token, curve factory, curve clone, migration reservation, and exact inventory funding must either all commit
successfully in one non-reentrant transaction or all revert.

This is protocol-level exclusivity, not a claim that a transferable token cannot trade anywhere else. Holders can
transfer tokens peer to peer, and third parties may create external pools in permissionless systems. The product may
certify only that the Boardroom and its canonical factories did not provide a competing primary route.

The DistributionFactory and Boardroom should both expose the permanent `bondingCurveOfBoardroom` relationship. A curve
must use the Boardroom's one canonical quote asset and reserve its one canonical liquidity position. Creation requires a
mandatory end time bounded by a release-wide `MAX_CURVE_LIFETIME`; `endTime == 0` and practically unbounded timestamps
are invalid.

Curve creation must atomically reserve initial liquidity for the canonical share/quote pair and fail if that canonical
AMM pair has already been seeded or reserved incompatibly. A mempool race may make creation revert, but it must never
silently adopt an attacker-priced pool.

### Forced progress and purchaser settlement

Graduation cannot leave buys and sells disabled while only the Boardroom may perform the next step. Migration after
graduation must be permissionless, use protocol-derived amounts and bounds, and atomically mark the curve migrated,
consume its reservation, create and register the singleton liquidity position, and move the primary market to
`GeneralAvailability`. If deterministic migration remains impossible for a bounded migration grace period, anyone must
be able to enter the same sell-only unwind used by cancellation or expiry; governance absence or holder veto cannot
deadlock both singletons forever.

Expiry must be an explicit permissionless state transition. If graduation is already satisfied at the deadline,
graduation takes priority over expiry. Otherwise `expire()` stops buys and begins a fixed settlement grace period.
Cancellation before graduation uses the same transition; cancellation after graduation cannot replace migration or its
forced fallback.

The recommended purchaser treatment, which still requires explicit product and economic sign-off, is:

1. while `Unwinding`, buys remain disabled but any current holder may sell shares back along the same downward curve;
2. sellability follows the transferable share, not a non-transferable credit recorded for the original recipient;
3. the curve maintains one global outstanding-curve-share count, so peer transfers do not change aggregate liability;
4. after the settlement grace period, anyone may finalize: unsold and reserved migration shares return to the
   Boardroom, remaining quote goes to the Boardroom, remaining holders keep their shares, and the result becomes a
   completed primary sale without automatic liquidity; and
5. the liquidity reservation is released only by that finalization, while its quote-asset identity remains permanent
   and any later direct singleton-liquidity setup must use the same quote asset.

This optional sell-only unwind followed by a completed-sale fallback is recommended over an address-based refund ledger:
the token is transferable, so purchase-recipient credits do not represent the current economic owner. Immediate
cancellation that sends the reserve to the Boardroom while removing every sell route is forbidden.

`MAX_CURVE_LIFETIME`, the migration grace period, and the settlement grace period must be immutable release parameters
selected before implementation. Their exact values are economic policy, not a caller choice.

### Migration price continuity

Caller-supplied amount minimums do not prove that the initial AMM price is economically continuous with the terminal
curve price. Migration must define a normalized terminal marginal curve price, derive the quote and share amounts used
for initial liquidity from that price, and enforce a release-wide maximum price-deviation bound after actual pool
funding. One defensible formula is to choose the quote allocation first and derive shares-to-liquidity as
`quoteToLiquidity / terminalCurvePrice`, returning unused reserved shares to the Boardroom. The exact price definition,
rounding direction, and maximum deviation require economic sign-off and adversarial simulation.

If migration cannot satisfy that invariant, it reverts without consuming the reservation or changing phase. After the
bounded migration grace period, the permissionless unwind fallback above preserves liveness without silently seeding a
mispriced pool.

### Quarantine is not terminal

A failed quote-asset return must not make `isClosed()` true while value remains stranded. The curve remains an active
dependency in `Quarantined`; redemptions cannot open and the singleton reservation is not reusable until permissionless
recovery succeeds or an explicit delayed-governance or wind-down quarantine transition records the forfeiture and makes
snapshot accounting coherent. The authority, waiting period, later-recovery recipient, and accounting for that explicit
forfeiture are a remaining design decision. Merely setting a boolean and ignoring the balance is not sufficient.

## Required model: one canonical protocol-owned liquidity position

The current implementation permits up to 32 lockers because it models one locker per pool. The intended model is one
canonical share-token liquidity pool per Boardroom.

A representative Boardroom state is:

```solidity
enum LiquidityStatus { Unconfigured, Active, Closed }

struct MigrationReservation {
    address curve;
    bytes32 pairKey;
    bytes32 salt;
    uint64 expiresAt;
}

struct LiquidityState {
    address locker;
    address pool;
    address quoteAsset;
    LiquidityStatus status;
    MigrationReservation pendingMigration;
}
```

The factory should use direct singleton mappings such as `lockerOfBoardroom` and `reservationOfBoardroom`, not locker
arrays. Creation binds the share token, one quote asset, one AMM pool, and one locker. Subsequent liquidity additions
must add to that same locker and pool.

The current locker is seed-once, so it needs a separately authorized `addLiquidity` path with exact balance-delta and
slippage checks. Additional liquidity must never create a second Boardroom pool. The quote asset and pool become
permanent when first configured. An LP balance of zero does not mean the position is terminal while additions remain
possible: only an explicit irreversible transition to `Closed` does.

### Removal semantics

The accepted model is protocol-owned liquidity rather than a promise of an irrevocable time lock:

- before launch, the visibly identified pre-launch owner retains immediate setup authority;
- after launch while **Active**, partial or full removal is possible only through delayed controller governance, sends
  all LP or underlying assets back to the Boardroom, honors minimum outputs and a deadline, and never accepts an
  arbitrary recipient;
- while **WindingDown**, anyone may trigger a full exit, retaining the existing hostile-token fallback that returns LP
  tokens to the Boardroom; and
- while **Snapshotting** or **RedemptionsOpen**, no liquidity mutation is allowed.

Removing all LP while Active leaves the singleton configured and permits later additions to the same pool. A separate
delayed `closeLiquidity` transition is allowed only with an empty locker and no reservation; `Closed` is irreversible
and does not permit a replacement pair or second pool. Wind-down also ends in `Closed`.

## Migrating-curve consequence

The permanent bonding-curve singleton resolves the multiple-migration ambiguity. A canonical curve can be created only
while liquidity is `Unconfigured`; it exclusively reserves that slot and may create the first canonical pool on
migration. A prior direct liquidity configuration would already have moved the primary market to
`GeneralAvailability` and therefore made curve creation impossible. There is no later curve that can add to an existing
spot-priced pool.

The singleton reservation binds the permanent curve, pair, Boardroom-derived locker salt, and finite expiry. Before
launch the owner may cancel through the lifecycle path; after launch cancellation is delayed governance and remains
subject to holder veto, and neither path can cancel a curve after graduation. Wind-down, sale expiry, and failed
migration each have bounded permissionless progress into unwind or settlement. Entering unwind does not release the
reservation: release occurs only when settlement and asset return complete, or when the explicit quarantine path accepts
the loss. Once released, the curve can never attempt migration into that slot.

The curve-selected quote asset is a permanent Boardroom tombstone even when migration, cancellation, expiry, or
quarantine produces no pool. Any later direct setup of the liquidity singleton must use that quote asset. Pool and
locker identity become permanent when the position is first configured.

## Redeemable-asset consequence

Removing the 32-asset cap needs more than paginated reads. Each obligation should register dependency counts for every
relevant token, payment token, quote token, or LP token. Closing the obligation decrements exactly those counts, so one
long-lived unrelated grant does not prevent removal of an otherwise unused asset.

If the release permits an unbounded registry, wind-down needs an explicit **Snapshotting** state:

1. freeze asset registration and liquidity mutation;
2. freeze the redemption supply and treasury-share treatment;
3. snapshot assets in bounded, permissionless cursor pages;
4. quarantine or isolate an unreadable token without restarting completed pages; and
5. enter **RedemptionsOpen** only after the frozen registry is fully processed.

One-asset claims do not by themselves solve safe snapshot initialization.

## Limits that should not be removed blindly

Not every hard bound is the same design problem.

- `MAX_BATCH_CALLS = 16`, AMM path length 8, and AMM sample count 32 are per-transaction computation bounds and should
  remain bounded.
- Reward assets 8 and pending unstake requests 5 bound user-facing loops and storage. They may remain explicit product
  limits or receive their own paginated/state-machine redesign; merely deleting the constants is unsafe.
- Redeemable assets 32 currently bound snapshot and payout work. Removing this limit requires the dependency accounting
  and paginated Snapshotting state above. An unbounded atomic redemption basket is not acceptable.
- Time, duration, numeric-width, and slippage limits express economic or arithmetic domains and should be reviewed on
  their own merits rather than grouped with collection capacity.

The principle is not "no limits." It is "no arbitrary concurrent-capacity limit imposed solely because protocol safety
depends on iterating a growing collection."

## Remaining design decisions

These are not straight implementation tasks and must be settled before the curve redesign is assigned:

1. **Cancellation and expiry economics.** Approve or replace the recommended sell-only unwind followed by completed-sale
   settlement. The design must state exactly what purchasers own, when sell rights end, and where the residual reserve
   goes.
2. **Lifecycle time bounds.** Select immutable maximum sale duration, migration grace, and settlement grace values. A
   caller-selected unlimited or effectively unlimited deadline is not acceptable.
3. **Migration pricing.** Select the terminal curve-price definition, share/quote allocation formula, rounding rules,
   and maximum allowed AMM price deviation. This requires economic simulation, not only Solidity unit tests.
4. **Unrecoverable quote assets.** Define who may accept forfeiture, after what delay, how holder veto applies, whether
   the path is available before wind-down, and who receives assets recovered after the redemption snapshot.

The singleton, exclusivity, capacity, storage, and protocol-owned-liquidity directions are accepted. These four items
remain design gates because choosing them changes purchaser rights or asset disposition.

## Accepted decisions

- Active obligations use mappings, scalar counts, permanent tombstones, and bounded permissionless pruning rather than
  capped active arrays.
- Grant capacity reservations disappear; parent-to-child creation remains atomic and reentrancy-safe.
- Factories use canonical events and bounded pagination; discovery storage cannot impose protocol capacity.
- Redeemable assets use per-asset dependency counts and a paginated Snapshotting state rather than a 32-asset ceiling.
- Reward-asset and pending-unstake bounds remain explicit first-release product and transaction limits.
- Each Boardroom has at most one lifetime bonding curve, created only before launch and before another canonical share
  availability path.
- An active curve is the exclusive Boardroom-authorized primary share-distribution and liquidity-seeding route.
- Exclusivity is enforced at the BoardroomToken transfer boundary as well as in Boardroom policy and factories, so old
  allowances cannot extract treasury shares around the mode.
- The curve and its liquidity reservation have mandatory bounded phases and permissionless forced progress; every
  individual phase transition is atomic.
- The curve-selected quote asset remains permanent even if the curve settles without creating liquidity.
- Each Boardroom has one permanent quote-asset identity and at most one pool and locker identity; once configured, none
  can be replaced.
- Liquidity is protocol-owned rather than irrevocably time-locked. After launch, removal requires delayed governance and
  always returns assets to the Boardroom; wind-down exit remains permissionless.
- Repeated additions and removals use the same configured pool until an irreversible empty close.
- Delegated Boardroom logic uses ERC-7201 namespaced storage rather than coordinated raw numeric slots.

## Required invariants and tests

The redesigned release must prove at least:

- more than 128 concurrent grants or distributions can be represented without an unbounded state transition;
- no single lifecycle or finalization call performs work proportional to lifetime history;
- obligation counts cannot underflow, double-decrement, omit an active child, or be forged by a disabled/noncanonical
  policy;
- pruned obligation tombstones cannot be re-registered, and disabled policies remain cleanup-capable;
- parent-to-child creation cannot be interleaved with pruning or expose an uncounted child;
- wind-down cleanup makes bounded permissionless progress and redemptions cannot open while one obligation remains;
- per-asset dependency counts cannot be bypassed, and paginated snapshotting freezes one coherent registry and supply;
- the permanent curve can be created only from `Unset`, only before launch, and never after another share-availability
  path or prior curve tombstone;
- launching while the singleton curve is selling preserves curve exclusivity; launching from `Unset` permanently
  disables curve creation;
- while the curve is active, every Boardroom-authorized competing share release and direct liquidity seed is rejected;
- BoardroomToken rejects mints, burns, treasury transfers, prior approvals, batched calls, and policy/spender paths that
  would bypass or desynchronize primary-market mode;
- curve creation never adopts a preexisting attacker-seeded canonical pool;
- transferees can exercise the same curve sell rights as original purchasers without exceeding the global outstanding
  curve-share liability;
- sale expiry is mandatory and bounded, `expire()` is permissionless, and satisfied graduation takes priority at the
  deadline;
- graduation has permissionless deterministic migration and a bounded permissionless fallback if migration cannot
  complete;
- cancellation and expiry cannot immediately transfer the purchaser reserve away while removing all sell rights;
- successful migration enforces the approved terminal-curve-to-AMM price-continuity invariant independently of caller
  slippage inputs;
- curve migration, cancellation, expiry, unwind settlement, and quarantine resolution atomically update every state
  they respectively own, without a reusable reservation or a second-curve path;
- a cancelled, expired, or failed-migration curve preserves its quote-asset tombstone for later direct liquidity;
- a curve with stranded quote remains an active dependency until recovery or explicit forfeiture, and redemptions
  cannot snapshot around unaccounted value;
- exactly one locker, quote asset, and pool can ever be canonical for a Boardroom;
- repeated additions use the same pool and preserve exact token and LP accounting;
- zero LP balance and explicit closure have distinct, tested semantics;
- active removal obeys controller delay, holder veto, slippage, and Boardroom-only recipient rules;
- wind-down full exit and LP fallback remain live with hostile underlying tokens;
- migration reservations cannot squat, duplicate, or deadlock the singleton slot;
- pagination has stable bounds and cannot omit or duplicate entries under concurrent creation; and
- delegated logic resolves only namespaced storage owned by the intended Boardroom concern.

## Exit criteria

This blocker is cleared only when all of the following are true:

- [x] The capacity, curve-singleton, exclusivity, redemption, discovery, storage, and liquidity directions are approved
      and recorded.
- [ ] Purchaser settlement, lifecycle time bounds, migration pricing, and quarantine asset disposition are explicitly
      approved.
- [ ] Boardroom obligation authorization uses mappings and scalar counts rather than capped active arrays.
- [ ] Pruned obligations retain permanent provenance tombstones and lifecycle transitions are reentrancy-safe.
- [ ] Grant slot reservations and factory concurrent-capacity constants are removed or replaced by the accepted model.
- [ ] Discovery uses events or bounded pagination without affecting protocol liveness.
- [ ] Boardroom liquidity is an explicit-state singleton with tested repeated add, closure, and conditional removal.
- [ ] The Boardroom and DistributionFactory enforce one lifetime pre-launch curve and monotonic primary-market mode.
- [ ] BoardroomToken enforces the active curve as the only Boardroom-originated primary distribution and
      liquidity-seeding route, including against old allowances.
- [ ] Transferee sell rights, global curve liability, explicit expiry, permissionless migration, and bounded fallback are
      implemented and tested.
- [ ] Curve migration obeys the approved price-continuity formula and deviation bound.
- [ ] Curve migration, cancellation, expiry, quarantine, and its finite singleton reservation obey the accepted one-pool
      and permanent-quote rule.
- [ ] Redemption asset limits are either explicitly accepted or replaced by dependency counts and paginated snapshotting;
      no unbounded loop is introduced.
- [ ] Boardroom delegated logic uses named namespaced storage rather than manually coordinated raw slot numbers.
- [ ] Contract, SDK, web, Sentinel, and documentation surfaces match the new model.
- [ ] Maximum-gas and adversarial lifecycle tests pass on the selected release chain.
- [ ] The exact redesigned release passes independent security and economic review.

Increasing the existing constants does not clear this blocker.
