---
title: Treasury escrows and redemptions
description: Understand why grants and locked liquidity close before a bounded treasury snapshot and per-asset claims.
---

# Treasury escrows and redemptions

The Boardroom's append-only registry identifies ERC20 assets eligible for final
redemption. Grant and locker factories add assets while atomically registering each new
escrow. Snapshotting cannot start while any recorded escrow remains open.

Treasury funding is a direct ERC20 transfer to the Boardroom. The owner can register a
readable asset while Active. During wind-down, transfer an unregistered asset first and
then register it; registration requires the Boardroom to hold a nonzero balance. The
snapshot records the amount actually received, including transfer fees or other token
behavior, rather than a caller-declared contribution amount. This does not make
fee-on-transfer tokens redeemable: claims require exact balance changes and reject them.

## Wind-down order

1. The owner starts wind-down; ordinary execution and new share minting stop.
2. The Boardroom wraps native currency.
3. Each locker exits or cancels, and each Boardroom-funded grant reaches a closed state.
4. Anyone prunes an escrow that closed outside `executeEscrow`.
5. After the minimum delay, the Boardroom burns shares held by its own treasury and
   begins snapshotting.
6. Assets are processed in pages of at most 32. Unreadable assets are recorded and
   skipped instead of blocking all other claims.
7. Redemptions open only after the full registry is processed.

A holder burns shares once to receive redemption credits. They then claim each included
asset independently, with a minimum-output check. The claim is proportional to frozen
asset balance and frozen redemption supply. Rounding excess can be swept only after the
entire allocation for that asset has been claimed.

Redemption does not promise a particular asset value. It proves the holder's share of
what the Boardroom actually held at the snapshot.
