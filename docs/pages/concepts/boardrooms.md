---
title: Boardrooms
description: The on-chain project account used by pledge.cash projects.
---

# Boardrooms

A Boardroom is an on-chain project account with its own ERC20 share token. It can hold treasury assets, mint shares, create grants, create distribution flows, own locked liquidity, and coordinate wind-down.

The simplest way to think about a Boardroom is: the project has a wallet-like contract account, and that account can only perform protocol actions allowed by its policies.

## Core Fields

| Field | Meaning |
| --- | --- |
| Owner | The address allowed to perform owner-only Boardroom actions. |
| Share token | The Boardroom's project token. |
| Status | Active, winding down, or redemptions open. |
| Treasury assets | Tokens or native assets held by the Boardroom. |
| Issued grants | Token grants created by the Boardroom. |
| Issued distributions | Sales or curve distributions created by the Boardroom. |
| Locked liquidity | Boardroom-owned LP positions held by lockers. |

## Active Boardrooms

While active, a Boardroom can mint shares, create grants, start supported sales, register supported assets, and seed protocol-owned liquidity according to policy.

The Boardroom cannot call arbitrary contracts unless a policy allows the call. This keeps the protocol surface explicit.

## Policy

Boardroom actions go through policies. A policy decides whether a target call is allowed. The protocol uses this to distinguish pledge.cash protocol actions from external asset approvals.

For users, the practical question is: is the Boardroom action visible, expected, and allowed by a known policy?

## Share Tokens

The Boardroom share token is the project token. Holding it means your wallet holds that ERC20 token. It does not automatically create equity, debt, voting, dividend, or employment rights.

For on-chain holder-power checks, shares held inside authenticated grants, distributions, AMM pools, and fee vaults are treated as protocol custody rather than as an active voter. Current and prior-block custody are both checkpointed so moving shares into or out of those contracts cannot create a one-block threshold shortcut.

If redemptions later open, share holders can burn shares for registered redeemable assets according to the Boardroom state.
