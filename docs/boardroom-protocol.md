# Boardroom Protocol

This document describes the first Boardroom primitive in `packages/contracts/src/Boardroom.sol`,
`BoardroomFactory.sol`, and `BoardroomToken.sol`.

A Boardroom is an owned on-chain issuer account with its own ERC20 share token. In this first slice, it can mint shares
and issue share-token grants through `TokenGrantFactory`.

## Actors

- Boardroom owner: controls share minting and the narrow execution surface.
- Boardroom: owns assets, creates its share token, and acts as grant issuer.
- Share holder: receives Boardroom share tokens directly or through grants.
- Grant holder: receives settlement authority over a Boardroom-issued grant.

## Assets

- Boardroom share token: ERC20 minted only by its Boardroom.
- Grant token escrow: Boardroom share tokens transferred into a `TokenGrant`.
- Payment token: optional ERC20 paid to the Boardroom when settling a paid grant.
- Native creation fee: optional fee forwarded through the Boardroom to `TokenGrantFactory`.

## State Machines

### BoardroomFactory

`BoardroomFactory` creates deterministic Boardroom clones and records them.

State:

- `tokenGrantFactory`: grant factory used by every Boardroom clone.
- `boardroomLogic`: implementation cloned by the factory.
- `allBoardrooms`: created Boardroom list.
- `isBoardroom`: created Boardroom membership check.

### Boardroom

`Boardroom` has one owner and one share token.

State:

- `tokenGrantFactory`: grant factory used for Boardroom-issued grants.
- `shareToken`: ERC20 minted only by this Boardroom.

The owner can mint shares through `Boardroom.mint`. The owner can also call `Boardroom.createGrant`, which approves the
predicted grant address for the requested share amount and then calls `TokenGrantFactory.createGrant`.

### BoardroomToken

`BoardroomToken` is a standard ERC20 with immutable `boardroom` authority. Only the Boardroom can mint it.

## Grant Issuance Flow

1. Owner mints share tokens to the Boardroom.
2. Owner calls `Boardroom.createGrant(...)`.
3. The Boardroom predicts the grant address through `TokenGrantFactory`.
4. The Boardroom approves the predicted grant for the requested share amount.
5. The Boardroom calls `TokenGrantFactory.createGrant(...)`.
6. `TokenGrantFactory` creates a grant where `issuer == boardroom`.
7. The grant escrows share tokens from the Boardroom.

For paid grants, settlement payment tokens are transferred to the Boardroom.

## Invariants

- Only the Boardroom can mint its share token.
- Only the Boardroom owner can mint shares through the Boardroom.
- Boardroom-created grants use the Boardroom share token as the grant token.
- Boardroom grant creation approves only the predicted grant address for the requested amount.
- A Boardroom-issued grant must have `issuer == boardroom`.
- Share-token grants escrow tokens from the Boardroom before holders can settle.
- Native grant creation fees can be forwarded, but the Boardroom should not retain them.

## Deterministic Proof

```sh
bun --cwd packages/contracts build
bun --cwd packages/contracts test
cd packages/contracts && forge fmt --check
```
