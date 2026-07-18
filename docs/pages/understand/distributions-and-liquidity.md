---
title: Distributions and liquidity
description: Compare bond markets, fixed-price sales, Merkle airdrops, migrating curves, AMM pools, and Boardroom-owned locked liquidity.
---

# Distributions and liquidity

Distribution contracts put project shares into a defined participation path. AMM contracts provide exchange and liquidity after or alongside distribution. They have different custody, pricing, and cancellation economics.

## Fixed-price sale

A sale escrows a fixed share inventory. Buyers pay the configured ERC20 directly to the Boardroom and receive shares from escrow. Payment rounds up to the payment token's smallest unit. Limits include the sale window, remaining inventory, buyer cap, user maximum, and deadline.

Close or cancellation returns unsold shares to the Boardroom. Buying also stops automatically when Boardroom wind-down begins.

## Bond market

A reserve or liquidity bond is a pre-funded Sequential Dutch Auction. Buyers commit a reserve token or a canonical
pledge.cash LP token now and receive a project-token position that matures after a fixed delay. Demand raises marginal
price; inactivity decays it toward a configured floor. The auction is self-priced and does not use the AMM TWAP as an
oracle.

The position is an internal contract record, not an NFT. It cannot be transferred or approved. Anyone may execute a
mature claim, but the project tokens always go to the wallet recorded at purchase. Closing returns only unsold capacity;
already funded positions remain claimable and keep wind-down blocked until settled.

## Merkle airdrop

An airdrop escrows shares behind one Merkle root. A leaf can transfer shares immediately or create an exact vesting grant. The root commits to chain, contract, Boardroom, share token, index, account, amount, claim mode, and—where applicable—every grant term.

The manifest and proof are offchain publication responsibilities. Onchain checks enforce the root, one claim per index, aggregate inventory, and a bounded number of grant claims. See [Claim an airdrop](../guides/claim-airdrop).

## Migrating bonding curve

A curve prices buys and sells from an integral over sold supply:

- buys add quote reserve and create account-bound sell rights for the recipient;
- sells consume that account's sell right and return quote tokens;
- sell rights do not follow ERC20 transfers;
- buy quotes round up and sell refunds round down.

When graduation becomes feasible, it latches and freezes trading. The active Boardroom can migrate reserved shares and
quote into Boardroom-owned locked liquidity. Migration and cancellation both return remaining canonical shares exactly;
quote remainder return is bounded and best-effort, and any hostile-token shortfall remains recorded in the closed curve
and retryable only to the Boardroom.

## AMM pool

The pledge.cash AMM is a constant-product pool with a nominal 30-basis-point input fee. When a protocol fee recipient is
set, a fixed 5% of that nominal swap fee—nominally 1.5 basis points of input before rounding effects—routes there; the
remainder accrues to LP holders through a separate fee vault. When the recipient is unset, all swap fees accrue to LPs.

User protections are exact input, minimum output, route, and deadline. Supported tokens must transfer requested amounts exactly. Direct token transfers to a pool are not a safe deposit method and can be consumed before operational excess recovery.

## Locked liquidity

A Boardroom-owned locker holds LP principal while the project is active. Fees can return to the Boardroom, but principal exits only during wind-down. The initial mint is reserved to the authenticated locker so a third party cannot capture the canonical first liquidity position.

If hostile underlying-token behavior blocks terminal exact exit, the protocol can eventually preserve the LP token itself as a redeemable asset. That keeps a claim on pool reserves without blocking unrelated redemptions.

## One project, several prices

The bond auction price, fixed sale price, curve quote, and AMM spot price can differ. None is guaranteed to equal treasury value or final redemption value. Compare contract address, inventory, reserves, fees, position rights, slippage, deadlines, lifecycle status, and exit route before participating.
