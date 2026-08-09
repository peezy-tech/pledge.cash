---
title: Provenance and hosted identity
description: Separate canonical onchain relationships from optional peezy.tech authentication and linked-wallet context.
---

# Provenance and hosted identity

Canonical protocol identity is entirely onchain and chain-specific:

- `BoardroomFactory.isBoardroom` proves a Boardroom;
- its `shareToken` and the factory's `isShareToken` prove the project token;
- `TokenGrantFactory.grantForTokenId` links a grant-right NFT to its grant;
- `LiquidityLockerFactory.lockerOfBoardroom` and the locker's immutable `boardroom`
  identify the active locker;
- the locker itself verifies the PositionManager owner, PoolKey, and position data.

The optional Sentinel service provides peezy.tech authentication and wallet links. It
can group sign-in methods and help a user find their own addresses. It cannot transfer a
grant right, own a Boardroom, sign a transaction, or override factory relationships.

If hosted context disagrees with the selected chain, artifact, contract owner, or event
history, the onchain evidence wins. Treat a linked wallet as an identity hint until the
wallet signs the required contract action.

See [Canonical identity](../reference/canonical-identity) for integration checks.
