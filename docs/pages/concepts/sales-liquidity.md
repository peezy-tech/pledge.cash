---
title: Sales And Liquidity
description: User-facing explanation of fixed-price sales, migrating curves, AMM pools, and locked liquidity.
---

# Sales And Liquidity

pledge.cash supports token distribution and liquidity primitives that can be owned by a Boardroom.

These primitives are separate from marketing claims. A sale or pool can show price, inventory, reserves, and status, but it cannot guarantee project quality or future liquidity.

## Fixed-Price Sales

A fixed-price sale sells Boardroom share tokens for a payment token at a configured price.

Important fields include:

- Boardroom,
- share token,
- payment token,
- sale supply,
- remaining shares,
- price,
- buyer cap if any,
- start and end time,
- sale status.

## Migrating Bonding Curves

A migrating bonding curve lets buyers purchase shares along a curve. It can also support sells while active. When migration conditions are met, reserves can move into Boardroom-owned locked AMM liquidity.

The important thing for users is that the curve is a state machine. It can be active, cancelled, or migrated. Price and reserves should be read from the contract.

## AMM Pools

An AMM pool lets users swap between two tokens and add or remove liquidity. Pools collect swap fees for liquidity providers and can also send a protocol fee share to a configured recipient.

AMM activity does not guarantee deep liquidity or stable prices. It only means a pool exists and follows the pool contract rules.

## Locked Liquidity

Boardroom-owned liquidity can be placed in a locked-liquidity contract. The locker can claim fees for the Boardroom while principal remains locked. During wind-down, the locker normally exits principal back to the Boardroom so assets can be considered for redemptions. If a token later blocks an exact exit, the protocol can return the LP token itself after the governance delay so that one hostile asset does not freeze the rest of the wind-down.

For buyers, locked liquidity is useful context because it shows whether a project has Boardroom-owned LP principal and whether that principal can leave before wind-down.
