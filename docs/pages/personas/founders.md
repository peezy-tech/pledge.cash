---
title: Founders And Project Operators
description: How founders can use pledge.cash to launch and operate a Boardroom-backed token project.
---

# Founders And Project Operators

Founders use pledge.cash to create an on-chain project account and make token-related commitments easier to inspect. The project account is the Boardroom. The Boardroom owns assets, mints the project token, creates grants, starts distribution flows, and can wind down into redemptions.

## Why Use A Boardroom

A Boardroom gives a project one visible place for protocol actions:

- project token issuance,
- contributor and advisor grants,
- sale inventory,
- treasury assets,
- Boardroom-owned liquidity,
- wind-down and redemption state.

The Boardroom does not make the project trustworthy by itself. It makes important asset movements easier to verify.

## Typical Founder Flow

1. Create a Boardroom with a name, symbol, owner, and deterministic salt.
2. Mint project tokens to the Boardroom or to addresses that need to escrow grants.
3. Create grants for advisors, contractors, contributors, or buyers.
4. Run a distribution flow, such as a fixed-price sale or migrating bonding curve.
5. Seed or migrate into liquidity when the project is ready for secondary trading.
6. Use discovery and Boardroom tools to inspect grants, sales, liquidity, and treasury balances.
7. If the project should close, start wind-down and eventually open redemptions.

## What The Founder Controls

The Boardroom owner controls owner-only Boardroom actions while the Boardroom is active. Depending on the deployed policies, that can include minting shares, creating grants, approving protocol calls, creating distributions, and registering assets for redemption.

The owner should usually be a wallet or multisig that the project is prepared to operate publicly. If a project promises governance, operating procedures, legal terms, or reporting outside the contracts, those promises should be documented separately.

## What Buyers And Contributors Need To Know

Before asking people to buy tokens or accept grants, make the contract terms legible:

- Which Boardroom issued the token?
- Who owns the Boardroom?
- What is the token supply?
- Is there a sale, grant, or liquidity position involved?
- Are grants transferable?
- What are the vesting and expiry timestamps?
- What happens if the Boardroom winds down?
- Which claims are on-chain, and which are off-chain project statements?

## Social And Service Context

The protocol stays permissionless: wallets can interact with deployed contracts directly. A hosted service can add context around that protocol, such as verified social accounts, project profiles, participant visibility, team membership, private drafts, alerts, dashboards, and audit logs. That service layer should explain who is willing to be publicly associated with a project, without becoming the authority over on-chain settlement.
