---
title: Wind down and redeem
description: Close grants and liquidity, freeze a bounded treasury snapshot, burn shares, and claim each asset.
---

# Wind down and redeem

Wind-down is irreversible. It stops minting and general execution, so inventory every
escrow and required exit call before starting.

## Operator sequence

1. Confirm the owner, status, open escrow count, registered assets, and balances.
2. Start wind-down. The Boardroom wraps its native balance and begins the minimum delay.
3. Exit the registered liquidity position through `executeEscrow`, using fresh
   minimum amounts and a deadline. An empty locker may be cancelled instead.
4. Close Boardroom-funded grants by settlement, expiry recovery, or the bounded
   quarantine path when an expired hostile token cannot transfer exactly.
5. Prune every closed escrow that was not closed through `executeEscrow`.
6. After the delay, begin snapshotting. This burns treasury-held shares and freezes
   redemption supply.
7. Process asset pages until the cursor is complete, then open redemptions.

## Holder sequence

1. Re-read frozen supply, asset statuses, and balances.
2. Call `redeem(shares)` once to burn shares into credits.
3. Claim each included asset with a recipient and acceptable minimum output.

An unreadable asset can be excluded. Claims for other assets remain independent. Do not
assume one successful claim means every asset was included or paid.
