---
title: Launch A Boardroom
description: A high-level founder flow for creating and operating a pledge.cash Boardroom.
---

# Launch A Boardroom

This flow is for founders and project operators. It describes the user journey, not a legal launch checklist.

## 1. Define The Project Account

Choose the Boardroom owner, token name, token symbol, and launch assumptions. The owner should be an address the project is comfortable operating publicly.

Before launch, decide what should be on-chain and what belongs in off-chain project docs.

## 2. Create The Boardroom

Create the Boardroom through the app or contracts. The resulting Boardroom address and share token address become the anchors for the project.

Users should be able to inspect:

- Boardroom address,
- owner,
- share token,
- chain,
- deployment artifact.

## 3. Issue Tokens Deliberately

Mint project tokens only for clear uses: treasury supply, sale inventory, grants, liquidity, or other documented project actions.

Because the Boardroom share token is the project token, issuance is one of the most important facts for buyers and contributors to inspect.

## 4. Create Grants

Use grants for advisors, contractors, contributors, or buyers who need escrow-backed vesting or paid settlement rights.

For each grant, make vesting, expiry, payment terms, and transferability clear before asking someone to accept it.

## 5. Run A Sale Or Curve

If the project sells tokens, choose the mechanism that matches the launch:

- fixed-price sale for simple inventory at a configured price,
- migrating curve for curve-based issuance that can move into liquidity.

Users should know what they are paying, what they receive, and whether the sale can close, cancel, or migrate.

## 6. Seed Or Migrate Liquidity

Liquidity can make trading possible, but it also introduces price and reserve risk. Boardroom-owned locked liquidity keeps project-owned LP principal visible and governed by the protocol lifecycle.

## 7. Operate Publicly

After launch, keep the Boardroom state legible:

- share the canonical chain-and-Boardroom project URL,
- inspect grants and distributions,
- monitor treasury balances,
- explain social or project claims outside the contracts,
- avoid implying rights that the contracts do not encode.

## 8. Wind Down If Needed

If the project should close, start wind-down, close obligations, exit locked liquidity, register redeemable assets, and open redemptions when the Boardroom is ready.
