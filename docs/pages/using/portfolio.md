---
title: Use Portfolio
description: Discover wallet-specific grants, project roles, and work that needs attention.
---

# Use Portfolio

`Portfolio` is the wallet-specific workspace. Public project pages remain available without connecting, but Portfolio needs an address to discover that wallet’s open grants and Boardrooms whose creation event recorded that address as owner.

[Open Portfolio](../../portfolio)

## Prerequisites

- Use the injected browser wallet that owns or controls the relevant address.
- Select the network where the positions exist.
- Match the wallet network when you intend to act.

Connecting is used for discovery and authorization. It does not give pledge.cash custody or project authority.

## What Portfolio shows

`Needs attention` orders tasks by status:

- `Needs attention` for an open grant that may require review.
- `For reference` for a discovered Boardroom creation-owner role that does not require a transaction now.

For a grant, choose `Open grant`. For a Boardroom whose creation event recorded the connected wallet as owner, choose `Open Studio`, then verify the live owner before relying on operator controls. Portfolio does not currently reconcile Boardroom ownership transfers: a transferred-away Boardroom can remain listed, and a transferred-in Boardroom can be absent. `Discovery details` shows what was scanned, the network range, and contracts that could not be read.

## Refresh and recovery

Choose `Refresh portfolio` after a new grant, settlement, or network update. Refreshing does not add Boardroom ownership-transfer tracking. Discovery is bounded and deployment-specific; it is not a universal wallet index or complete historical record.

- `Portfolio data is incomplete` means some scan or contract read failed. Review `Discovery details`, correct the network or RPC problem, then refresh.
- `Nothing needs your wallet right now` means the current scan found no open settlement or operator action. It is not a guarantee that no unscanned contract exists.
- After switching networks, Portfolio intentionally resets to that network’s discovery scope.

Grant settlement is available only to the current holder wallet. Grant issuer controls normally require the standalone
issuer or, for an Active Boardroom, its current owner or executor. During Boardroom wind-down, the app also exposes
canonical zero-value grant cleanup to any connected wallet through the Boardroom's permissionless
`executeWindDownCall`; the contract restricts that path to recorded obligation policies and targets.

[Review a grant safely](grant-details) · [Learn about wallet and transaction recovery](transactions-and-wallet)
