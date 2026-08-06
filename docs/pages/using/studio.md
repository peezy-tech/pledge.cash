---
title: Operate a Project in Studio
description: Use Studio to create and operate Boardroom, token, grant, locker, and closeout transactions.
---

# Operate a Project in Studio

[Studio](../../studio) is the operator workspace. It cannot grant authority: the
connected account must be the current Boardroom owner for owner-only calls.

The routed project sections are:

- **Setup:** predict or create a Boardroom and verify its canonical identity.
- **Token:** mint project shares while the Boardroom is Active.
- **Grants:** create standalone grants or Boardroom-funded external-asset grants and
  inspect active obligations.
- **Liquidity:** create the one-position locker, register a received PositionManager
  NFT, collect fees, or prepare the wind-down exit.
- **Close:** start wind-down, close and prune obligations, process the bounded asset
  snapshot, open redemptions, and redeem shares.

Project-share grants require an external issuer rather than the Boardroom. Token launches
also happen externally; Studio manages the locker handoff, not a sale contract.

Before every action, confirm chain, deployment status, owner, Boardroom lifecycle, target,
assets, amount, deadline, and previewed call data.
