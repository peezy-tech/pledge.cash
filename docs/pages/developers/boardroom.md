---
title: Boardroom integration
description: Integrate the flat Boardroom custodian, factory identity, callbacks, escrows, snapshotting, and redemptions.
---

# Boardroom integration

The authoritative implementation is `packages/contracts/src/boardroom/` and the deep
[Boardroom protocol
specification](https://github.com/peezy-tech/pledge.cash/blob/main/docs/boardroom-protocol.md).

## Discover and verify

Read `BoardroomFactory.isBoardroom(address)`, then verify `factory`, `owner`,
`shareToken`, `wrappedNative`, and `status` from the Boardroom itself. Confirm the share
token with `BoardroomFactory.isShareToken`. Discover Boardrooms from
`BoardroomCreated` logs; the factory intentionally has no enumerable catalog. Creation
events are an index, not a substitute for current reads.

## Write boundaries

Owner calls operate only while Active. `execute` and the 16-call bounded batch reject the
Boardroom and share token as targets. A target may call `reserveRedeemableAsset` and
`registerEscrow` only inside its active execution frame.

In WindingDown, `executeEscrow` can call only a recorded open grant or locker.
Snapshotting requires the delay and zero open escrows. Process assets in pages no
larger than `MAX_SNAPSHOT_PAGE`, then open redemptions. A holder burns shares into
credits before claiming individual assets.

Read enum values from `IBoardroom`; do not infer status from timestamps or events alone.
