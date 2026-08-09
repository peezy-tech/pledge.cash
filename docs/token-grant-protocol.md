# Token grant protocol

## Purpose

`TokenGrantFactory` creates deterministic escrow contracts. Every grant is funded in
full at creation and represented by an ERC721 grant right. The current NFT holder is the
only account that can settle vested tokens.

A grant can be free (`price == 0`) or require an ERC20 payment. The quoted price is per
whole granted token and settlement rounds payment cost up. The grant never mints the
granted asset and never relies on a future issuer balance.

## Creation

The issuer approves the factory for the exact grant amount and calls `createGrant` with:

- holder, granted token, amount, and issuer salt;
- optional payment token and unit price;
- vesting cliff, vesting end, and expiry;
- whether the grant right is transferable and, if so, its unlock time.

Expiry must be at least one day after vesting ends. The factory transfers the exact
escrow balance into a minimal clone, mints the grant-right NFT, and forwards any exact
native creation fee to its configured recipient. Fee-on-transfer, rebasing-during-call,
or otherwise inexact tokens are rejected by balance-delta checks.

If the issuer is a canonical Boardroom, creation must occur through
`Boardroom.execute`. The factory's callbacks atomically reserve external granted or
payment assets and register the grant as an escrow. Boardroom grants are capped at
five years. The Boardroom cannot fund a grant of its own share token because it cannot
execute a call targeting that token; use an external issuer for project-share grants.

## Vesting and settlement

Vesting is linear from cliff to end, or immediate when both timestamps are equal. The
holder may settle any positive amount that is vested, unsettled, and not expired. Paid
settlement transfers payment directly from holder to issuer, then transfers the exact
granted amount from escrow to holder.

The NFT can move only when the grant was declared transferable, its unlock time has
passed, it is not expired, and no settlement or issuer recovery is in progress. A
transfer updates the grant's holder atomically.

## Issuer exits

The issuer may:

- halt vesting once and withdraw the exact unvested amount;
- after expiry, withdraw remaining escrow and close the grant;
- for an expired Boardroom grant whose token no longer transfers safely, use the bounded
  quarantine path to close the escrow while recording any stranded promise.

Full settlement and issuer terminal actions close the grant and burn the grant-right
NFT. Anyone can then prune a canonical Boardroom's closed escrow.

## Invariants

- `settledAmount` never exceeds `claimable`, and `claimable` never exceeds `grantSize`.
- Only the current holder settles; only the issuer halts or recovers.
- The grant right and the grant's `holder` field move together.
- All public token movements require exact sender and recipient deltas.
- A closed grant never reopens and its NFT no longer exists.
- Every time calculation is bounded by fixed timestamps supplied at creation.
