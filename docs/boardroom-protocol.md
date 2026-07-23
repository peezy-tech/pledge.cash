# Boardroom Protocol

This document describes the candidate Boardroom v5 architecture in `packages/contracts/src/boardroom/`. It is not a
mainnet-readiness claim. No v5 mainnet deployment exists. The approved bonding-curve terminal policies are implemented,
but release-candidate proof, production authority ceremony, and independent security assurance remain blockers.

## Authority model

A Boardroom is a canonical treasury, share-token issuer, policy gateway, obligation registry, and redemption account.

Before launch:

- the configured owner can mint shares and submit bounded `execute` or `executeBatch` calls;
- every call still passes its registered policy;
- ownership transfer remains available;
- the first controller address is predictable, but no controller is deployed or adopted.

After launch:

- the owner is the external `BoardroomController`;
- generic ownership transfer, handover, and renunciation are disabled;
- only the controller can enter `executeGovernance`;
- the controller must preserve the scheduled proposer as the policy authority;
- no controller call can bypass the Boardroom gateway, move Boardroom assets directly, or make an arbitrary third-party
  call on the Boardroom's behalf.

The `BoardroomFactory` constructs one immutable `BoardroomControllerFactory`, then constructs the Boardroom
implementation with that factory reference. The controller factory deploys only for a canonical Boardroom registered by
its bound Boardroom factory and only during that Boardroom's explicit deployment-authorization window.

## Launch

`launch(LaunchConfig)` binds all launch-critical values in calldata:

- proposer;
- predicted controller;
- protection staker;
- expected reward pool;
- expected redemption-excess recipient;
- controller delay;
- wind-down delay;
- operation grace period;
- controller generation, which must begin at 1.

The launch transaction verifies nonzero governance-eligible circulating supply and requires the named protection staker
to meet the existing 10% wind-down threshold against both current and previous-block active stake and eligible supply.
It authorizes exactly one deterministic deployment, deploys and initializes generation 1, verifies every relationship and
configuration value, records the controller, advances the governance epoch, and transfers ownership atomically. The
controller salt includes the Boardroom and generation. Any mismatch, occupied prediction, spoofed factory, or partial
initialization reverts the entire launch.

The proposer may be an EOA, a Safe, or another ERC-1271 contract. That distinction affects signature proof, not onchain
Boardroom ownership: the governance gateway still requires `msg.sender == owner/controller`.

## Controller operations

Only the current proposer can schedule operations. Anyone can execute a ready, unexpired operation.

A Boardroom operation commits to:

- Boardroom address;
- the complete ordered call batch;
- user salt;
- Boardroom governance epoch;
- controller generation;
- controller configuration epoch;
- proposer and controller configuration hash.

Every external call is evaluated by the Boardroom's policy registry at execution. `MAX_BATCH_CALLS` remains a
per-transaction bound.

Proposer, delay, and grace-period changes are controller self-operations. They use the same delay and grace period and
advance the configuration epoch when executed, invalidating older configuration-bound operations. The Boardroom is the
immutable canceller: after checking the caller's current and previous-block 1% veto power, `Boardroom.veto` cancels the
operation in the current controller.

Starting wind-down advances the Boardroom governance epoch, invalidating all older operations in constant time. It never
iterates over operation history.

Controller replacement is one delayed Boardroom self-call. During execution the Boardroom authorizes, deploys, and
verifies generation `n + 1`, changes ownership, records the new controller, and advances the governance epoch
atomically. The replacement controller cannot exist beforehand. The Boardroom's wind-down delay and
redemption-excess recipient are not reset.

## ERC-1271 control proof

The controller implements ERC-1271 only as an offchain authority proof:

- an EOA proposer is checked with ordinary signature recovery;
- a contract proposer is checked recursively through ERC-1271;
- validation never schedules, cancels, or executes governance.

Sentinel uses a separate Boardroom-control claim flow. It hashes the exact serialized SIWE message with EIP-191 and
binds audience/domain, destination user or organization, scope, chain ID, Boardroom, controller, generation,
configuration epoch, nonce, issued time, and expiry. Canonical topology reads, block-hash confirmation, and the
ERC-1271 call use one pinned finalized block. Nonce consumption and claim creation are atomic. Every privileged
offchain Boardroom write requires a fresh nonce and proof; a Better Auth session establishes user identity only.

## Lifecycle and obligations

The Boardroom lifecycle is monotonic:

```text
Active -> WindingDown -> Snapshotting -> RedemptionsOpen
```

Wind-down stops new obligations and primary-market activity, advances the governance epoch, and starts the immutable
wind-down delay.

Obligation safety uses ERC-7201 namespaced storage:

- canonical membership and policy mappings;
- scalar active count and per-kind counts;
- permanent provenance tombstones;
- per-obligation dependency assets and per-asset dependency counts.

Factories emit canonical creation events and expose append-only bounded pagination. Discovery is not a protocol-capacity
limit. Closed obligations are removed through permissionless `pruneObligation` or bounded
`pruneObligations(address[])`; pruning never erases provenance. Parent-to-child transitions record the child and its
asset dependencies atomically before the parent can become terminal. Grant-slot reservations are not used.

Reward-asset, pending-unstake, proof-size, and batch limits remain deliberate first-release or per-transaction bounds.

## Redemption snapshot

Redeemable assets use canonical membership, append-only enumeration, and dependency counts rather than a fixed basket
capacity. Wind-down cannot begin snapshotting until:

- the immutable wind-down delay has elapsed;
- every active obligation count is zero;
- the canonical reward pool is terminal;
- singleton protocol liquidity is closed;
- treasury-share handling is complete.

`beginSnapshot` freezes the registry length and redemption supply, entering `Snapshotting`. It also freezes asset
registration, liquidity mutation, and treasury-share treatment. Anyone can call `snapshotAssets(maximum)` with a
bounded page size. Each asset is marked snapshotted or explicitly unreadable. `openRedemptions` succeeds only after
the frozen registry is completely processed.

In `RedemptionsOpen`, burned shares create per-holder credits. Each asset can be claimed independently, so one hostile
asset cannot roll back unrelated payouts. Excess above the frozen accounting is sweepable only to the preserved
redemption-excess recipient.

## Primary market

Each Boardroom has a lifetime primary-market mode:

- `Unset`;
- `BondingCurve`;
- `GeneralAvailability`.

A curve can be precommitted only once, before launch and before any other canonical transferable-share release. Its
predicted address, funding amount, and permanent quote asset are committed before funding. While `BondingCurve` is
active, `BoardroomToken` restricts Boardroom-originated mints, transfers, and `transferFrom` calls to the exact curve
or explicitly authorized atomic migration custody. Old allowances do not bypass the check, and burns cannot
desynchronize the curve liability.

Launch from `Unset` permanently selects `GeneralAvailability`. Launch while a curve is selling preserves curve
exclusivity. Curve cancellation or settlement never clears the curve or quote-asset tombstone and never allows a second
curve. Sell rights are fungible: a holder can sell up to the lesser of its transferable share balance and the one global
outstanding curve-share liability.

Third-party holder transfers and permissionless markets remain possible; exclusivity governs Boardroom-authorized
primary issuance and liquidity seeding.

## Protocol-owned liquidity

Each Boardroom has one permanent quote-asset identity, at most one canonical AMM pool, and at most one canonical locker.
There is no replacement pair. State is explicit:

- `Unconfigured`;
- `Active`;
- `Closed`.

Before launch, the owner can configure or add liquidity immediately through policy-checked calls. After launch while
Active, partial or full removal requires a delayed controller operation. Removed assets always return to the Boardroom.
A zero LP balance does not close the singleton: closure is explicit, empty-only, reservation-free, and irreversible.

During `WindingDown`, full exit is permissionless. If hostile underlying tokens prevent exact removal, the LP token can
be returned to the Boardroom as the liveness fallback. `Snapshotting` and `RedemptionsOpen` prohibit liquidity
mutation. Curve migration must consume the singleton reservation and create the first canonical position atomically.
Releasing a reservation never clears the quote identity.

## Curve terminal policy

The immutable release values are a 90-day maximum lifetime, seven-day migration grace, 30-day sell-only settlement
grace, 30-day quote-quarantine delay, seven-day forfeiture-veto window, and 50-basis-point maximum AMM price deviation.
Cancellation, expiry, and failed migration use a permissionless sell-only unwind in which fungible sell rights follow
the shares. Permissionless migration derives shares from quote allocated first at the terminal marginal price.

Quarantined quote retains the active obligation and singleton reservation. It may be forfeited only during wind-down,
after the delay and an unvetoed window. A 1% current-and-previous-block eligible staker may veto. Later recovery goes to
the Boardroom before the redemption snapshot and the immutable redemption-excess recipient afterward.

These choices resolve the product decision gates in blocker 05; they do not resolve the separate release-candidate,
authority-ceremony, or independent-assurance blockers.

## Deterministic proof

Use Foundry v1.7.1.

```sh
bun --cwd packages/contracts build
bun --cwd packages/contracts test
bun run test
bun run format:check
```

Also validate generated SDK ABIs and helpers, Sentinel indexing/control claims, web version gates, documentation, contract
runtime sizes, maximum-gas cases, and adversarial invariants. Passing these checks does not by itself make the project
mainnet-ready; release-candidate proof, authority ceremony, and independent security assurance remain separate blockers.
