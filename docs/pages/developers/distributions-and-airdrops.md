---
title: Distribution and airdrop integration
description: Developer bridge for bond markets, fixed-price sales, migrating curves, Merkle leaves, proofs, and lifecycle cleanup.
---

# Distribution and airdrop integration

Use the [Distribution protocol specification](https://github.com/peezy-tech/pledge.cash/blob/main/docs/distribution-protocol.md), [Bond market protocol](https://github.com/peezy-tech/pledge.cash/blob/main/docs/bond-market-protocol.md), and their contract directories for exact formulas and invariants.

## Canonical discovery

Verify the DistributionFactory from the active deployment, its permanent distribution, Boardroom, and type mappings,
and the distribution's reciprocal factory, Boardroom, and share-token fields. While the distribution is active, also
require the Boardroom's live obligation record; after close and prune that record is intentionally cleared and is not a
terminal provenance failure. Preserve a distinct identity per distribution address; one project can have several of the
same type.

Bond markets use a distinct `BondMarketFactory`. Verify `isBondMarket`, reciprocal factory and Boardroom fields, and the
verified project share token. A liquidity bond's quote token must also be a funded pool from the configured AmmFactory
that contains that share token.

## Bond quotes and positions

`readBondPurchaseQuote` returns live auction state, payout, wallet balance, and allowance. Refresh it immediately before
submission, then bind `minimumPayout` and `deadline` through `buildBondPurchaseTransaction`. Approval targets the market,
not the factory. Prices are quote-token smallest units per one whole 18-decimal project token.

Use `readBondPositionsForOwner` for the bounded owner ledger and `buildBondRedeemTransaction` for matured positions.
There is no transfer or approval flow: the owner recorded by the market is immutable, and permissionless redemption
always pays that owner. `buildBondFinalizeTransaction` is permissionless after conclusion; Boardroom-authorized early
close uses `buildBoardroomBondMarketCloseAction`.

## Fixed-price and curve quotes

Fixed-price buys round payment up. Curve buys round cost up and sells round refund down. Use contract or SDK quote helpers immediately before submission and bind maximum/minimum plus deadline onchain.

Persist curve sell rights by recipient account; do not derive them from current ERC20 balance. Once graduation latches,
disable buy and sell. Migration is active-Boardroom only. Migration and cancellation return remaining canonical shares
exactly, while either terminal path can leave explicitly quarantined quote for retry only to the Boardroom.

## Merkle manifests

Generate leaves with the contract's exact type hashes and `abi.encode` layout. Both modes bind chain id, predicted airdrop address, Boardroom, share token, index, account, and amount. Grant leaves additionally bind TokenGrantFactory and `GRANT_TERMS_TYPEHASH` over every grant field.

Neither claim function authenticates `msg.sender`: any relayer may submit a valid proof, but direct shares or the grant right always go to the leaf-bound account. The shipped app does not expose a separate relayer account and instead binds that leaf account to the connected wallet.

Manifest requirements:

- unique indices;
- raw integer amounts, plus separately documented decimals;
- explicit `direct` or `grant` mode;
- full grant terms where applicable: cliff no later than vesting end, expiry still in the future and at least one day
  after vesting end, and canonical Boardroom expiry no more than `5 * 365 days` after intended claim time because the
  factory enforces those conditions at claim execution;
- exact free/paid pairing: zero price with zero payment token, or positive price with a nonzero payment token different
  from the share token and readable `decimals() <= 77`;
- supported bounded-read ERC-20 payment tokens, with every distinct nonzero token pre-admitted or budgeted inside the
  Boardroom's 32-asset redemption basket for the full claim period; airdrop grant-slot reservation does not reserve
  redeemable-asset capacity;
- sorted-pair Merkle tree compatible with Solady `MerkleProofLib`;
- aggregate intended amount no greater than escrow;
- grant leaves no greater than `maxGrantClaims`;
- predicted airdrop address and chain fixed before root construction;
- reproducible root, proof, and manifest checksum.

Never “repair” a failed proof by changing terms in the client. Report the exact leaf inputs.

## Deterministic proof

```sh
bun --cwd packages/contracts test
bun --cwd packages/sdk test
bun --cwd apps/web test
```

Test direct and grant claims, duplicate indices, wrong chain/address, malformed proof, inventory overflow, cap exhaustion, close/cancel, curve cancellation recovery, and wind-down gating.
