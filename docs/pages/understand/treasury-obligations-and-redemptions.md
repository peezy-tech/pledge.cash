---
title: Treasury obligations and redemptions
description: Understand why grants and locked liquidity close before a bounded treasury snapshot and per-asset claims.
---

# Treasury obligations and redemptions

The Boardroom registry identifies ERC20 assets eligible for final redemption. A grant or
locker records the external assets it can return as dependencies. Snapshotting cannot
start while any recorded obligation remains active.

## Wind-down order

1. The owner starts wind-down; ordinary execution and new share minting stop.
2. The Boardroom wraps native currency.
3. Each locker exits or cancels, and each Boardroom-funded grant reaches a closed state.
4. Anyone prunes closed obligations.
5. After the minimum delay, the Boardroom burns shares held by its own treasury and
   begins snapshotting.
6. Assets are processed in pages of at most 32. Unreadable assets are excluded and
   recorded instead of blocking all other claims.
7. Redemptions open only after the full registry is processed.

A holder burns shares once to receive redemption credits. They then claim each included
asset independently, with a minimum-output check. The claim is proportional to frozen
asset balance and frozen redemption supply. Rounding excess can be swept only after the
entire allocation for that asset has been claimed.

Redemption does not promise a particular asset value. It proves the holder's share of
what the Boardroom actually held at the snapshot.
