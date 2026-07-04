---
title: pledge.cash
description: User-facing documentation for Boardrooms, token grants, token sales, liquidity, and wind-down flows.
---

# pledge.cash

`pledge.cash` is a protocol for creating token-backed Boardrooms, selling or granting tokens, and keeping the resulting asset movements visible on-chain.

A Boardroom is an on-chain project account. It can hold treasury assets, mint its own project token, create grants, run token distribution flows, seed liquidity, and eventually wind down into redemptions. The important product promise is not that every project is good. The promise is that the project account, token movements, grants, sales, liquidity, and redemptions can be inspected from contract state.

## What You Can Do

| User | Common job |
| --- | --- |
| Founder or project operator | Create a Boardroom, issue a project token, run a token sale, grant tokens to contributors, and manage treasury-owned liquidity. |
| Buyer or holder | Buy tokens or paid grants, inspect what the contract says you hold, and understand what rights are actually encoded. |
| Advisor or contractor | Receive a vesting token grant, settle vested tokens over time, and understand expiry, transferability, and payment terms. |

## What A Token Means

Tokens created or distributed through pledge.cash are protocol assets. They do not automatically represent equity, debt, dividends, employment, voting rights, legal membership, or any other off-chain entitlement. A project may describe additional terms somewhere else, but those terms are not created merely because a wallet holds a token.

When these docs use words like buyer, holder, investor, advisor, or contractor, they refer to how a person interacts with the protocol. They do not imply rights beyond the deployed contracts and any separate agreements a project makes outside the protocol.

## How To Read These Docs

Start with the persona closest to your role:

- [Founders and project operators](personas/founders)
- [Buyers and holders](personas/buyers-holders)
- [Advisors and contractors](personas/advisors-contractors)

Then use the concept pages when you need to understand a specific primitive:

- [Boardrooms](concepts/boardrooms)
- [Token grants](concepts/token-grants)
- [Sales and liquidity](concepts/sales-liquidity)
- [Wind-down](concepts/wind-down)
- [Protocol and service layer](concepts/protocol-and-service-layer)

## Current Status

The public app and docs are early. The protocol is being built around HyperEVM and Monad testnet deployments, local scenarios, and contract-level verification. Treat mainnet use, unsupported deployments, and claims made outside the contracts as separate risk.
