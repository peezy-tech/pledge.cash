---
title: Launches and locked liquidity
description: Understand external token launches, canonical Uniswap v4 positions, fee collection, and Boardroom wind-down.
---

# Launches and locked liquidity

pledge.cash does not implement a sale, airdrop, curve, or auction. A project may distribute
its token through an external mechanism such as Uniswap's CCA Liquidity Launchpad.

The retained onchain boundary begins at the finished Uniswap v4 position. A Boardroom
creates one locker configured for its share token, a quote asset, fee, and tick spacing.
The locker accepts one plain PositionManager NFT only when the NFT has nonzero liquidity,
the exact hookless PoolKey, and no subscriber.

Projects using CCA set the launch strategy's `positionRecipient` to that locker. After
mint, the Boardroom registers the token ID so the locker can verify it. An NFT merely
sent to the address is not canonical until this registration succeeds.

While the Boardroom is Active, anyone can collect accrued fees without removing
principal. The locker sends 95 percent of each currency to the Boardroom and 5 percent
to the protocol fee router. During wind-down, the Boardroom exits the whole position,
receives both currencies, and closes the locker escrow before snapshotting.

Swaps use standard Uniswap periphery and are not a pledge.cash pool contract. Verify the
chain-specific router, Permit2 address, PoolKey, token approvals, deadline, and minimum
output for every trade.
