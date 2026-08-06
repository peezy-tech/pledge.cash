---
title: Create and operate a project
description: Choose external authority, create a Boardroom, issue shares, manage grants, and lock a canonical v4 position.
---

# Create and operate a project

No public pledge.cash deployment is live yet. Use this sequence locally or after a
future artifact is independently marked live.

## Before creation

Choose the Boardroom owner, token name and symbol, deterministic salt, wrapped-native
profile, and redemption-excess recipient. The owner may be a wallet, Safe, or separate
timelock. There is no built-in governance or upgrade controller.

## Operate

1. In [Studio](../../studio), predict and create the Boardroom. Verify the factory event,
   owner, share token, and wrapped-native asset.
2. Mint only the intended share allocations while Active, then set the one-way launch
   marker when public presentation is ready.
3. Create escrow-backed grants. Use the Boardroom for grants of external treasury assets;
   use an external issuer for grants of the project share token.
4. Create one locker through `Boardroom.execute` with the quote asset, fee, and tick
   spacing that the launch will use.
5. Run token distribution externally. For Uniswap CCA, set `positionRecipient` to the
   locker.
6. Register the minted PositionManager NFT through the Boardroom, then verify the exact
   hookless PoolKey and nonzero liquidity.
7. Collect fees as needed; the fixed split routes 95 percent to the Boardroom and 5
   percent to the protocol fee router.

Ownership transfer is the only authority rotation. Verify the new address and its
operational policy before submitting it.
