---
title: Treasury escrows and redemptions
description: Understand why grants and locked liquidity close before a bounded treasury snapshot and per-asset claims.
---

# Treasury escrows and redemptions

The Boardroom's append-only registry identifies ERC20 assets eligible for final
redemption. Grant and locker factories add assets while atomically registering each new
escrow. Snapshotting cannot start while any recorded escrow remains open.

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
