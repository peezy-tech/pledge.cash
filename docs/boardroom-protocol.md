# Boardroom protocol

## Purpose

A Boardroom is a non-upgradeable project custodian created by
`BoardroomFactory`. It owns one `BoardroomToken`, holds treasury assets, executes
owner-authorized calls, records grants and locked liquidity as escrows, and ends in
pro-rata redemption.

The owner is an external account. It may be an EOA, a Safe, or a separately deployed
timelock, but pledge.cash does not ship a governance controller. Ownership cannot be
renounced. A project that needs a different contract deploys a new Boardroom and moves
assets while the old one is Active.

## Creation and identity

`BoardroomFactory.createBoardroom(owner, name, symbol, salt)` deploys a deterministic
clone of an immutable implementation. Initialization deploys the Boardroom's ERC20
share token and registers the profile's wrapped-native token as the first redeemable
asset. The factory records both identities in `isBoardroom` and `isShareToken`.
It does not maintain an on-chain catalog. Discover creations from
`BoardroomCreated` logs, then verify current identity through those mappings and the
Boardroom's own fields.

## Active state

Only the owner can mint shares, transfer ownership, configure the excess recipient,
start wind-down, and use `execute` or `executeBatch`. Batches contain at most 16 calls.
The Boardroom rejects calls to itself and its own share token.

The execution target gets callback-scoped authority for the duration of one call. A
canonical `TokenGrantFactory` or `LiquidityLockerFactory` uses that context to reserve
redeemable assets and register the exact escrow it just created. An arbitrary external
caller cannot register an escrow.

The asset registry is append-only and contains ERC20s that can participate in final
redemption. External contributors may add an exact amount of an already registered asset
before a deadline.

## Escrows

Boardroom-funded grants and the canonical liquidity locker are one-shot escrows. Each
escrow moves from `None` to `Open` to `Closed` and can never be reactivated. Open escrows
prevent snapshotting. Anyone may prune an escrow after its canonical `isClosed()` probe
returns true.

During wind-down the owner may call only a recorded open escrow through `executeEscrow`.
That is how a Boardroom exits its locker or closes a Boardroom-funded
grant without regaining general-purpose execution.

## Lifecycle

The state machine is irreversible:

1. `Active`: the owner may operate the treasury, issue shares, and create escrows.
2. `WindingDown`: ordinary execution and minting stop. Native balance is wrapped, and
   escrows must close. The minimum delay is one day.
3. `Snapshotting`: after the delay and after every escrow is closed, the Boardroom
   burns any shares it holds, freezes total supply, and processes the asset registry in
   pages of at most 32.
4. `RedemptionsOpen`: after every asset is processed, holders burn shares into
   redemption credits and claim each included asset independently.

Unreadable assets are marked and excluded rather than blocking every other asset.
Claims use exact balance deltas and a caller-provided minimum output. Rounding excess is
sent only to the configured excess recipient after all allocated shares for that asset
have been claimed.

## Asset and authority invariants

- Only the Boardroom contract can mint or burn its share token.
- General external execution exists only in `Active` and only for the owner.
- An escrow can be registered once and can never be reactivated.
- Snapshotting cannot begin while an escrow is open.
- Snapshot balances and redemption supply freeze before any holder redeems.
- A holder's claim for one asset cannot consume another holder's allocation.
- Native currency is wrapped before snapshotting, so redemptions use ERC20 accounting.
- Loops are bounded by constants or user-supplied pages capped by constants.

## Architecture history

An earlier prototype used a diamond and a protocol facet registry to fit governance,
markets, and redemption logic behind one address. Those subsystems were removed before
release. The remaining custodian fits in one contract, so facet upgrades and
release-hash coordination would add authority and review surface without serving a live
migration need.
