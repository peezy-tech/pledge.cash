---
title: Use Portfolio
description: Discover wallet-specific grants, project roles, and work that needs attention.
---

# Use Portfolio

`Portfolio` is the wallet-specific workspace. Public project pages remain available without connecting, but Portfolio needs an address to discover that wallet’s grants and project responsibilities.

[Open Portfolio](../../portfolio)

## Prerequisites

- Use the injected browser wallet that owns or controls the relevant address.
- Select the network where the positions exist.
- Match the wallet network when you intend to act.

Connecting is used for discovery and authorization. It does not give pledge.cash custody or project authority.

## What Portfolio shows

`Needs attention` orders tasks by status:

- `Needs attention` for an open grant or another decision requiring review.
- `Ready` for an action currently available.
- `For reference` for a role or item that does not require a transaction now.
- `Complete` for a closed record that remains useful as onchain history.

For a grant, choose `Open grant`. For a Boardroom owned by the connected wallet, choose `Open Studio`. `Discovery details` shows what was scanned, the network range, and contracts that could not be read.

## Refresh and recovery

Choose `Refresh portfolio` after a new grant, ownership change, settlement, or network update. Discovery is bounded and deployment-specific; it is not a universal wallet index.

- `Portfolio data is incomplete` means some scan or contract read failed. Review `Discovery details`, correct the network or RPC problem, then refresh.
- `Nothing needs your wallet right now` means the current scan found no open settlement or operator action. It is not a guarantee that no unscanned contract exists.
- After switching networks, Portfolio intentionally resets to that network’s discovery scope.

Grant settlement is available only to the current holder wallet. Issuer controls appear only for an authorized issuer or Boardroom authority.

[Review a grant safely](grant-details) · [Learn about wallet and transaction recovery](transactions-and-wallet)
