---
title: Buyers And Holders
description: What buyers, token holders, and grant buyers should understand before interacting with pledge.cash projects.
---

# Buyers And Holders

In these docs, a buyer or holder is a wallet that buys tokens, receives tokens, or holds grant settlement rights. Some teams may call buyers investors, but pledge.cash tokens do not automatically grant equity, debt, dividends, employment, governance, or legal membership.

Your rights come from the deployed contracts and any separate off-chain agreements you accept elsewhere.

## What You May Hold

You may interact with several kinds of assets:

| Asset or right | What it means |
| --- | --- |
| Boardroom share token | The project token minted by a Boardroom. |
| Grant settlement right | The right to settle vested grant tokens under a specific grant contract. |
| Payment obligation | A paid grant may require you to pay a payment token when settling. |
| Redemption claim | If redemptions open, share holders may burn shares for registered redeemable assets. |

## Before Buying

Check the project and contract state before sending funds:

- the Boardroom address,
- the Boardroom owner,
- the token address,
- the sale or grant address,
- price and payment token,
- sale window or grant expiry,
- transferability rules,
- treasury assets,
- locked liquidity positions,
- whether the project is active, winding down, or open for redemptions.

If a page, chat, or social account describes benefits that are not visible in contract state, treat those as separate claims by the project.

## Buying From A Sale

A fixed-price sale sells a set amount of Boardroom share tokens at a configured price. A migrating bonding curve prices buys and sells along a curve and can migrate reserves into Boardroom-owned liquidity.

In both cases, the contract state is the source of truth for inventory, payment token, timing, and current status.

## Buying Or Settling A Grant

A paid grant is different from a normal token sale. The grant escrows tokens and lets the holder settle vested amounts over time. If the grant has a price, settlement requires payment. If the grant is free, settlement only claims vested grant tokens.

Always inspect vesting, expiry, transferred holder state, and whether the grant has been halted or closed.

## Holding After Purchase

Holding a token means your wallet controls that token. It does not guarantee liquidity, redemption value, project success, or legal rights. If the Boardroom eventually opens redemptions, the redemption contract state determines which assets are redeemable and how shares are burned.
