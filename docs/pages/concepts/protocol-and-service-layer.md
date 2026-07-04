---
title: Protocol And Service Layer
description: How permissionless contract settlement differs from optional hosted social and operational context.
---

# Protocol And Service Layer

pledge.cash should be read in two layers:

1. The permissionless protocol: deployed contracts that wallets can use directly.
2. Optional service context: hosted features that make projects, people, teams, and activity easier to understand.

The service layer should add context. It should not become the gatekeeper for on-chain settlement.

## Protocol Layer

The protocol layer owns facts such as:

- Boardroom creation,
- token minting,
- grant escrow,
- grant settlement,
- sale purchases,
- curve status,
- AMM swaps,
- locked liquidity,
- wind-down status,
- redemptions.

Any wallet can inspect and interact with deployed contracts if it can reach the chain and satisfy contract requirements.

## Service Layer

A hosted service can make the protocol easier to use by adding:

- project profiles,
- verified social accounts,
- team and organization membership,
- participant badges,
- holder cohorts,
- alerts and dashboards,
- private drafts,
- audit logs,
- opt-in association between a person, social account, wallet, and sale.

These features help answer who is willing to be associated with an on-chain action. They do not rewrite what happened on-chain.

## Why Keep Them Separate

Separation protects the core model:

- buyers can verify contract state even if a hosted service changes,
- founders can add richer context without hiding settlement behind an account system,
- advisors and contractors can inspect their grants directly from the chain,
- social identity can be opt-in instead of assumed from wallet activity alone.
