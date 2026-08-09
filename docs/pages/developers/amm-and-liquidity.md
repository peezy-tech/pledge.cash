---
title: Uniswap v4 and liquidity integration
description: Verify one-position lockers, PositionManager NFTs, fee collection, exit, and Universal Router swaps.
---

# Uniswap v4 and liquidity integration

Read `packages/contracts/src/uniswap/`, the generated SDK ABI, and the deep [Liquidity
protocol
specification](https://github.com/peezy-tech/pledge.cash/blob/main/docs/liquidity-protocol.md).

Create a locker by targeting `LiquidityLockerFactory.createLocker` through
`Boardroom.execute`. The callback atomically registers the locker as an escrow and adds
the quote asset to the append-only redemption registry. Verify
`lockerOfBoardroom(locker.boardroom()) == locker` and all immutable locker fields.

For a direct CCA mint, create the locker first, set `positionRecipient` to its address,
and call `registerPosition` through the Boardroom after mint. For an existing NFT, first
call `preparePositionTransfer`, then use `safeTransferFrom`. Registration rejects the
wrong PositionManager, owner, currencies, fee, tick spacing, hook, subscriber flag, tick
order, or zero liquidity.

Anyone may call `collectFees` while Active. The locker uses PositionManager's
decrease-by-zero action and exact balance deltas. Exit is Boardroom-only during
WindingDown and burns the complete position.

For swaps, derive the v4 pool ID with `Pool.getPoolId(PoolKey)`, quote with the configured
Quoter, and execute with Permit2 plus Universal Router. Carry the exact PoolKey,
deadline, minimum output, and required native value through the transaction builder.
