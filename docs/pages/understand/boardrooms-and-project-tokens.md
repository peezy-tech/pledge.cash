---
title: Boardrooms and project tokens
description: Understand how a Boardroom combines a project treasury, share-token issuer, policy account, and lifecycle coordinator.
---

# Boardrooms and project tokens

A Boardroom is a project-owned onchain account created by the canonical BoardroomFactory. It creates one ERC20 share token and coordinates treasury execution, grants, distributions, locked liquidity, governance, wind-down, and redemptions.

## What the project token represents

The Boardroom alone can mint or burn its share token. Before governance launch, only the owner can cause minting. Minting stops permanently when wind-down begins.

The token has two different accounting roles:

- **Governance:** eligible current and previous-block balances can veto delayed actions or start wind-down. Treasury shares and shares in authenticated protocol custody are excluded.
- **Redemption:** economic share ownership participates in the final asset snapshot. Governance custody exclusions do not reduce redemption supply.

A token balance therefore does not automatically mean that balance has immediate governance power, and governance-eligible supply is not the same as total supply.

## What the Boardroom controls

- its project-share supply;
- admitted treasury assets;
- policy-checked external calls;
- project-issued grants;
- fixed sales, airdrops, and migrating curves;
- Boardroom-owned locked liquidity;
- delayed governance after launch;
- wind-down cleanup and the redemption snapshot.

Module factories record obligations so the Boardroom cannot open redemptions while a live commitment may still return assets or require payment.

## Lifecycle

1. **Active, pre-launch:** the owner mints and executes policy-checked calls directly.
2. **Active, launched:** the executor queues delayed actions; holders gain veto and wind-down protections.
3. **Winding down:** new issuance, fixed-price buys, airdrop claims, curve buys/sells, and curve migration stop while
   obligations close and assets are prepared. An already-created public AMM pool is independent of Boardroom lifecycle;
   its permissionless swaps and liquidity actions can continue.
4. **Redemptions open:** shares burn for fixed snapshot entitlements. Owner execution is closed.

These transitions are one-way. See [Governance and holder protections](governance-and-holder-protections) and [Treasury obligations and redemptions](treasury-obligations-and-redemptions).

## Canonical identity

An ERC20 that calls itself a project token is not enough. The current app verifies the Boardroom through the selected
deployment's BoardroomFactory and uses the share-token address reported by that verified Boardroom. It does not yet make
a separate reverse `BoardroomToken.boardroom()` read in the project-route check; verify that reciprocal authority
directly when independent token provenance matters. Child grants, distributions, and lockers have their own links.

Read [Canonical identity](../reference/canonical-identity) before relying on a copied contract address.

## Important limits

- Boardroom arrays and batches are bounded.
- Supported assets must satisfy the protocol's read and exact-transfer assumptions.
- Raw native value is normalized to the canonical wrapped-native token for wind-down.
- A token name, symbol, or Sentinel alert cannot change ownership, supply, policy, or lifecycle state.
- Current legacy Boardrooms cannot be launched safely through the app; see [Govern a project](../guides/govern-a-project).
