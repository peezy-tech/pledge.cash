---
title: Deployment and local scenarios
description: Validate network profiles, simulate the lean stack, rehearse on disposable forks, and run the retained lifecycle locally.
---

# Deployment and local scenarios

The canonical manifest is `packages/contracts/config/networks.json`. Checked artifacts
must match its chain-specific wrapped-native and Uniswap v4 periphery addresses. Both
canonical testnet pledge.cash artifacts are currently pending.

Run from the repository root:

```sh
bun run validate:networks
bun run simulate:network -- 11155111
bun run simulate:network -- 84532
bun run test:testnet-forks:deployment
bun run scenario:project-token:local
```

Simulation executes the Forge deployment script without public broadcast. Fork gates
start disposable Anvil processes from Ethereum Sepolia and Base Sepolia state, deploy
locally, verify wiring and runtime hashes, and prove a repeated deployment is
idempotent. The scenario proves Boardroom creation, share issuance, grant escrow,
position locking, fee collection, wind-down, locker exit, snapshotting, and redemption.

The lean artifact includes only the deterministic deployer, Boardroom factory, grant
factory, locker factory, fee router, external profile addresses, salts, code hashes,
canonical authorities, and release identity. Root-specific owner and fee-recipient
relationships are derived and checked against the live contracts. See the deep [deployment
specification](https://github.com/peezy-tech/pledge.cash/blob/main/docs/deployment.md).

None of these commands authorizes or performs a public-network broadcast.
