---
title: Explore Projects
description: Discover canonical Boardrooms and locked Uniswap v4 pools without connecting a wallet.
---

# Explore Projects

[Explore](../../explore) is the public entry point. Choose a network, then inspect
Boardrooms and the hookless v4 pools discovered from their canonical liquidity lockers.
Reading does not require a connected wallet.

For each result, confirm the chain, Boardroom address, share token, owner, lifecycle
status, locker, quote asset, fee, tick spacing, and position registration. A project with
no registered position has no pledge.cash-verified locked pool, even if an unrelated
pool exists for the same token pair.

Open a project to use its Overview, Swap, and Transparency sections. If a read is
incomplete, the app should show the missing evidence instead of converting it to a zero
balance or safe status. Retry a public RPC read only after confirming the chain and
address are unchanged.
