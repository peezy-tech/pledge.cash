---
title: Boardrooms and project tokens
description: Understand how a Boardroom combines a project treasury, share-token issuer, policy gateway, obligations, singleton markets, and redemptions.
---

# Boardrooms and project tokens

A Boardroom is a canonical project account created by `BoardroomFactory`. It creates one ERC20 share token and
coordinates treasury execution, obligations, singleton primary-market and liquidity state, governance, wind-down,
snapshotting, and redemptions.

## Token accounting

The Boardroom alone can authorize minting or burning its share token. Before launch, the owner can cause minting through
the policy gateway. Minting stops when wind-down begins.

- Governance uses current and previous-block active stake divided by governance-eligible circulating supply.
- Redemption uses the frozen economic share supply and asset balances.

A liquid token balance therefore does not imply immediate governance power.

## What the Boardroom controls

- share supply and Boardroom-originated primary releases;
- admitted treasury assets and dependency counts;
- policy-checked calls;
- canonical grants, distributions, and one reward pool;
- one lifetime bonding curve and permanent quote identity;
- at most one canonical liquidity locker and pool;
- external delayed governance after launch;
- bounded wind-down cleanup, asset snapshotting, and redemptions.

Obligations use canonical mappings, scalar counts, permanent provenance, and permissionless bounded pruning. Factory
discovery is append-only and paginated; it does not cap concurrent protocol commitments.

## Lifecycle

1. **Active, pre-launch:** owner executes policy-checked calls; no controller exists.
2. **Active, launched:** the external controller proposer schedules delayed operations; anyone executes ready operations.
3. **Winding down:** new commitments and liquidity mutation stop; obligations and singleton liquidity close.
4. **Snapshotting:** asset registry length, balances, and redemption supply are frozen and processed in bounded pages.
5. **Redemptions open:** holders burn shares for frozen per-asset entitlements; ordinary governance is closed.

Transitions are one-way. Starting wind-down invalidates earlier controller operations in constant time.

## Canonical identity

Verify the selected deployment version and code hashes, `BoardroomFactory.isBoardroom`, the Boardroom-reported share
token, and the token's reciprocal Boardroom reference. Verify child factory relationships separately. An ERC20 name,
symbol, copied address, or Sentinel record is not canonical identity.

## Release boundary

The v5 candidate is not deployed on mainnet. Its approved curve policy uses a 90-day maximum lifetime, seven-day
migration grace, 30-day sell-only unwind, 50-basis-point migration-price tolerance, and delayed holder-vetoable
wind-down forfeiture for unrecoverable quote. Unsupported versions and incomplete relationships must fail closed.
Release-candidate proof, production authority ceremony, and independent security assurance remain required.
