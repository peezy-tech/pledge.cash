---
title: Boardrooms
description: The on-chain project account used by pledge.cash projects.
---

# Boardrooms

A Boardroom is an on-chain project account with its own ERC20 share token. It can hold treasury assets, mint shares, create grants, create distribution flows, own locked liquidity, and coordinate wind-down.

New Boardrooms start in a pre-launch stage. During pre-launch, shares can move through Boardroom-approved grant and sale paths, but ordinary holder-to-holder transfers stay locked. Launch finalization opens normal share transfers and freezes bootstrap minting; post-launch minting must go through the Boardroom's governance mint policy.

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

If redemptions later open, share holders can burn shares for registered redeemable assets according to the Boardroom state.
