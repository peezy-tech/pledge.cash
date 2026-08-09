# Liquidity protocol

## Purpose

pledge.cash locks one canonical Uniswap v4 `PositionManager` NFT for each
Boardroom. `LiquidityLockerFactory` creates the locker, and the Boardroom records it
as an escrow. The locker replaces the former custom hook, vault, and
third-party liquidity-claim system.

The locker does not create an auction, initialize a pool, or mint liquidity. Projects
may use Uniswap's Liquidity Launchpad or another v4-native path, then deliver the
finished position NFT to the locker.

## Canonical identity

A locker is canonical only when all of these relationships hold:

- `LiquidityLockerFactory.lockerOfBoardroom(locker.boardroom())` is the locker;
- `locker.boardroom()` is a Boardroom recognized by `BoardroomFactory`;
- `locker.shareToken()` is that Boardroom's share token;
- `locker.positionManager()` is the profile's v4 `PositionManager`;
- the position currencies are exactly the share token and configured quote asset;
- the fee and tick spacing match the locker configuration;
- the pool is hookless, the position has nonzero liquidity, and it has no subscriber.

The factory permits one open locker escrow per Boardroom. A replacement can be created
only after the previous escrow is closed and pruned. Creation events provide the
append-only discovery history; the mapping identifies the current canonical locker.

## Position receipt

There are two supported receipt paths:

1. A launch mechanism mints the NFT directly to the locker. The Boardroom then calls
   `registerPosition(tokenId)` through `execute`.
2. The Boardroom calls `preparePositionTransfer(tokenId)` through `execute`, then the
   current holder uses `safeTransferFrom` to send that exact NFT to the locker.

An unprepared safe transfer reverts. An unsafe `transferFrom` does not register the
position; while the Boardroom is Active it may recover that untracked NFT to a safe
recipient.

## Fees

Anyone may call `collectFees` while the Boardroom is Active. The locker invokes the v4
decrease-liquidity-by-zero action, which collects accrued fees without removing
principal. Five percent of each collected currency goes to `ProtocolFeeRouter`; the
other 95 percent goes to the Boardroom. Exact balance-delta checks reject tokens whose
transfer behavior does not match the requested amount.

`ProtocolFeeRouter` holds protocol fees until anyone calls `forwardToken` or
`forwardNative`. Only its owner can change the recipient.

## Wind-down

Starting Boardroom wind-down disables ordinary locker mutation. The Boardroom must call
`exit(amount0Min, amount1Min, deadline)` through `executeEscrow`. Exit collects final
fees, burns the complete v4 position, transfers both currencies to the Boardroom, and
marks the locker closed. A locker that never received a position can instead be
cancelled. The closed escrow must be pruned before snapshotting begins unless the closing
call already updated the Boardroom state.

## Security boundaries

- The locker holds one ERC721 and transient ERC20 balances only.
- It never approves an arbitrary operator.
- It accepts no hooked or subscribed position.
- The Boardroom is the only caller for registration, cancellation, recovery, and exit.
- Fee collection is permissionless but has a fixed destination and fixed split.
- Deadlines and minimum outputs bound final exit.
- The integration assumes canonical v4 periphery behavior and ordinary ERC20 balance
  semantics for both pool currencies.
