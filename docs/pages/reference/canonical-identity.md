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
| Project token | Full reciprocal proof is that the Boardroom reports the token and the token reports that Boardroom as authority. The current app uses the factory-verified Boardroom's token field but does not separately read the reverse token authority |
| Grant | The selected TokenGrantFactory maps its token id to the grant and the grant reports that factory |
| Boardroom-issued grant | The grant has the factory proof above and reports the verified Boardroom as issuer; the Boardroom's obligation record is an additional live-state check only while the grant remains active |
| Distribution | The selected DistributionFactory permanently records the address, Boardroom, and kind, while the distribution reports that factory, Boardroom, and verified project share token |
| Bond market | The selected BondMarketFactory reports the market, while the market reports that factory, the verified Boardroom, and its project share token; liquidity bonds additionally accept only a funded pool from the configured AmmFactory that contains that share token |
| Merkle airdrop | The distribution proof above and the configured TokenGrantFactory agree |
| Migrating curve | The distribution proof above holds and the curve reports the configured LockedLiquidityFactory; a migration reservation exists only before it is consumed or released |
| Locked liquidity | The LockerFactory's permanent locker and Boardroom mappings agree with the locker-reported factory and Boardroom, its router is the configured AMM router, and its token pair contains the verified project share token |
| AMM pool | The configured AmmFactory recognizes the sorted pair and pool address |

No single display field proves the whole row.

Active obligation lists and migration reservations prove current lifecycle state, not permanent identity. They are cleared
when obligations are pruned or reservations are consumed or released. A terminal grant, distribution, or locker can
remain canonical through its permanent factory and reciprocal contract records; after curve migration, verify the
resulting locker and pool rather than requiring the spent reservation.

## Canonical routes

The app's project and grant routes verify provenance before enabling actions. A contract with bytecode but the wrong factory relationship is an invalid route, not an “unverified version” of the same product.

Transient RPC failure is different. The app can report that a canonical object is temporarily unavailable when it cannot complete a read. Retry that read; do not replace the missing value with zero or silently fall back to another address.

## Deployment identity matters

Chain id alone is insufficient, especially on local Anvil. A reset can deploy a new stack on the same chain id. Transaction refresh and cached state must also match the deployment identity active when the read or transaction began.

The current HyperEVM testnet identity is the verified chain `998` artifact anchored by BoardroomFactory
`0xd0b2aE6603d7Ae140cd0Cb4Eb4451923C28cAaef`, deployment block `59850507`, and source commit
`87f51633f437a0164d7a2a2503a3660b01a6450a`. Chain `10143` remains pending and has no current root identity for
writes.

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
