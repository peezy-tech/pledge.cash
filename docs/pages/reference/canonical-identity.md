---
title: Canonical identity
description: How pledge.cash proves Boardrooms, project tokens, grants, distributions, pools, and lockers belong to the selected deployment.
---

# Canonical identity

Canonical identity is a relationship, not a logo or address-shaped string. It always includes the chain and current deployment.

## Verification chain

| Object | Canonical proof |
| --- | --- |
| Boardroom | The selected BoardroomFactory reports that it created the address |
| Project token | The Boardroom reports the token, and the token reports that Boardroom as its authority |
| Grant | The selected TokenGrantFactory maps its token id to the grant and the grant reports that factory |
| Boardroom-issued grant | The grant issuer is the Boardroom and the Boardroom records the grant obligation |
| Distribution | The selected DistributionFactory recognizes its type and the Boardroom records it |
| Merkle airdrop | Factory, Boardroom, share token, TokenGrantFactory, and distribution record agree |
| Migrating curve | Factory, Boardroom, project share token, quote token, and migration reservation agree |
| Locked liquidity | LockerFactory, Boardroom, pool, token pair, and recorded obligation agree |
| AMM pool | The configured AmmFactory recognizes the sorted pair and pool address |

No single display field proves the whole row.

## Canonical routes

The app's project and grant routes verify provenance before enabling actions. A contract with bytecode but the wrong factory relationship is an invalid route, not an “unverified version” of the same product.

Transient RPC failure is different. The app can report that a canonical object is temporarily unavailable when it cannot complete a read. Retry that read; do not replace the missing value with zero or silently fall back to another address.

## Deployment identity matters

Chain id alone is insufficient, especially on local Anvil. A reset can deploy a new stack on the same chain id. Transaction refresh and cached state must also match the deployment identity active when the read or transaction began.

The public testnet artifacts for chain `998` and `10143` are currently pending, so there is no current root identity to use for writes on those networks.

## Current state and history

Current storage can prove present owner, supply, status, and obligations. Lifetime lists and governance action history may require event scans. If an RPC cannot scan the required range, the app must label history incomplete.

An absent row from an incomplete scan is not proof the object never existed. **Unknown is not zero, and incomplete is not empty.**

## Sentinel context

Sentinel can index public governance actions and store wallet-linked alert subscriptions and delivery channels. That optional service data does not establish contract provenance. See [Provenance and Sentinel context](../understand/provenance-and-hosted-context).

## A practical verification record

Before a material transaction, record:

- chain id and deployment artifact identity;
- root factory addresses;
- Boardroom and project-token addresses;
- selected child contract and its factory/Boardroom relationships;
- transaction target, function, calldata, value, and simulation block;
- final canonical receipt, including any replacement hash.
