---
title: Distributions and liquidity
description: Compare project distributions, Uniswap v4 markets, and Boardroom-governed P4LP liquidity.
---

# Distributions and liquidity

Distribution contracts put project shares into a defined participation path. Uniswap v4 provides exchange execution.
The Boardroom's P4LP vault connects that public market to pledge.cash governance and wind-down without making the hook a
second control plane.

## Fixed-price sale

A sale escrows a fixed share inventory. Buyers pay the configured ERC20 directly to the Boardroom and receive shares
from escrow. Payment rounds up to the payment token's smallest unit. Limits include the sale window, remaining
inventory, buyer cap, user maximum, and deadline. Close or cancellation returns unsold shares.

## Dutch auction

A Dutch auction starts at a high unit price that descends linearly toward a floor. A buyer receives shares immediately
and pays the price when the transaction executes. Maximum payment and deadline protect the order.

Selling out closes the auction; otherwise anyone can finalize after its end. Settlement price is the last successful
purchase price, not an average. Later liquidity is optional and chooses explicit amounts and an initial v4 price; the
auction promises no proceeds percentage.

## Bond market

A reserve or liquidity bond is a pre-funded Sequential Dutch Auction. Buyers commit a reserve ERC20 or the project's
canonical P4LP claim and receive a non-transferable project-token position that matures after a fixed delay. Demand
raises marginal price; inactivity decays it toward a floor. The auction is self-priced and uses neither v4 spot nor an
AMM TWAP as an oracle.

Anyone may execute a mature claim, but tokens always go to the wallet recorded at purchase. Closing returns only unsold
capacity; funded positions keep wind-down blocked until settled.

## Merkle airdrop

An airdrop escrows shares behind one Merkle root. A leaf can transfer shares immediately or create an exact vesting
grant. The root commits to chain, contract, Boardroom, share token, index, account, amount, claim mode, and grant terms.
The manifest and proofs remain an offchain publication responsibility.

## Migrating bonding curve

A curve prices buys and sells from sold supply. Sell rights follow transferable shares but remain bounded by one global
liability. Graduation latches once its target is satisfied and freezes trading.

Migration has a seven-day permissionless window and consumes the curve's reserved P4LP vault/PoolId. It allocates quote
first, derives share liquidity at the terminal marginal price, and accepts at most 50 basis points of initialization-
price deviation. Cancellation, expiry, or failed migration enters a 30-day sell-only unwind. Unreturnable quote enters
quarantine with delayed, holder-vetoable wind-down forfeiture.

## Uniswap v4 market

Canonical project swaps execute through the shared Uniswap v4 PoolManager and Universal Router at a fixed 0.30% PoolKey
fee. Quotes come from the v4 Quoter; product spot comes from StateView slot0 and active liquidity. There is no pair
contract, reserve ledger, or pledge.cash TWAP.

Third-party positions may share the PoolId. They remain ordinary Uniswap positions and do not receive pledge.cash
lifecycle treatment. Native routing is currently disabled; wrap native value before using an ERC20 route.

## P4LP vault

A Boardroom has one permanent quote identity, PoolId, and full-range vault. One P4LP unit represents one unit of that
vault's position liquidity. External deposits are allowed only while Active and cannot change the PoolKey or ticks.

Of fees earned by the vault position, 5% routes to the protocol recipient and 95% routes to the Boardroom while Active.
After Claims begins, non-protocol fees remain in claim backing. This split does not apply to unrelated v4 positions.

During wind-down, exact underlying exit is preferred. If a hostile token blocks it, the vault can enter Claims without
calling the token and the Boardroom can register P4LP itself as a redeemable asset. Holders then redeem proportional
underlying independently. Closure remains explicit and irreversible.

## One project, several prices

Bond auction price, Dutch-auction price, fixed-sale price, curve quote, v4 spot, and final redemption value can all
differ. Compare identity, inventory, active liquidity, fees, P4LP rights, slippage, deadline, and lifecycle state before
participating.
