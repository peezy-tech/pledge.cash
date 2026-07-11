---
title: Distribution and airdrop integration
description: Developer bridge for fixed-price sales, migrating curves, Merkle leaf construction, manifests, proofs, and lifecycle cleanup.
---

# Distribution and airdrop integration

Use the [Distribution protocol specification](https://github.com/peezy-tech/pledge.cash/blob/main/docs/distribution-protocol.md) and `packages/contracts/src/distribution/` for exact formulas and invariants.

## Canonical discovery

Verify the DistributionFactory from the active deployment, its type mapping, the distribution's Boardroom/share-token fields, and the Boardroom obligation record. Preserve a distinct identity per distribution address; one project can have several of the same type.

## Fixed-price and curve quotes

Fixed-price buys round payment up. Curve buys round cost up and sells round refund down. Use contract or SDK quote helpers immediately before submission and bind maximum/minimum plus deadline onchain.

Persist curve sell rights by recipient account; do not derive them from current ERC20 balance. Once graduation latches, disable buy and sell. Migration is active-Boardroom only. Cancellation returns shares exactly and may leave explicitly quarantined quote for retry.

## Merkle manifests

Generate leaves with the contract's exact type hashes and `abi.encode` layout. Both modes bind chain id, predicted airdrop address, Boardroom, share token, index, account, and amount. Grant leaves additionally bind TokenGrantFactory and `GRANT_TERMS_TYPEHASH` over every grant field.

Neither claim function authenticates `msg.sender`: any relayer may submit a valid proof, but direct shares or the grant right always go to the leaf-bound account. The shipped app does not expose a separate relayer account and instead binds that leaf account to the connected wallet.

Manifest requirements:

- unique indices;
- raw integer amounts, plus separately documented decimals;
- explicit `direct` or `grant` mode;
- full grant terms where applicable;
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
