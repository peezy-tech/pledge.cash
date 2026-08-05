---
title: Deployment and local scenarios
description: Developer bridge for deterministic broadcasts, verified and pending artifacts, local Anvil deployment, seeding, and browser verification.
---

# Deployment and local scenarios

Use the [deployment specification](https://github.com/peezy-tech/pledge.cash/blob/main/docs/deployment.md) for environment variables, authority wiring, deterministic salts, broadcast wrappers, artifact schema, and verification commands.

## Public testnet status

Canonical protocol v1 is pending on Ethereum Sepolia `11155111` and Base
Sepolia `84532`; neither checked-in artifact provides usable root addresses.
Ethereum `1`, Base `8453`, Arbitrum `42161`, and Robinhood Chain `4663` are
planned mainnet profiles whose deployments remain pending and unauthorized.
Clients must withhold contract-dependent workflows while the selected
artifact is pending.

Do not develop against guessed or historical addresses. A candidate artifact
becomes publishable only after deterministic provenance, the complete
registry/facet release, live code, ownership, policy, helper, factory, router,
fee, and immutable-wiring verification succeeds.

## Deterministic deployment flow

1. Configure the broadcaster, deterministic deployer owner, protocol
   governance, treasury, and an operator-owned RPC. The canonical manifest
   supplies wrapped native, CREATE2, PoolManager, Universal Router, v4 Quoter,
   StateView, PositionManager, and Permit2 identities.
2. Run the chain-specific dry-run wrapper and confirm chain id.
3. Broadcast through the maintained wrapper.
4. Verify the candidate against live RPC state and runtime code hashes.
5. Retain the verified candidate and receipts, then promote them only through
   a separate explicit release decision.
6. Build the web app and confirm it resolves the promoted deployment.

Use the exact commands in the engineering deployment note; network gas behavior and Foundry variants differ.

## Testnet fork gates

Before any public broadcast, run the complete deployment against local forks
of both candidate testnets' canonical Uniswap v4 stacks:

```sh
bun run test:sepolia-fork:deployment
bun run test:base-sepolia-fork:deployment
```

The gate checks the upstream chain and dependency bytecode, deploys and
receipt-verifies protocol genesis, reruns the deterministic deployment, and
then verifies that its addresses, release identity, ownership, policies, and
live wiring remain unchanged. It uses no Sepolia funds and sends no Sepolia
transactions. Pin `SEPOLIA_FORK_BLOCK` or `BASE_SEPOLIA_FORK_BLOCK` when the
evidence must be exactly repeatable, and use an archive-capable RPC for a
pinned historical block.

## Local Anvil scenario

Local Anvil uses chain id `31337`, normally on port `8547`. Deploy the full stack with a local wrapped-native contract, write the ignored local artifact, then run the maintained seed scenario.

Also run `bun run scenario:boardroom:local` on a fresh Anvil state. That
scenario activates release B, proves writes stop before migration, migrates
three Boardrooms independently, and resumes cleanup and redemption.

The seed covers standalone grant variants plus nine Boardroom projects: direct canonical P4LP/v4 liquidity, active fixed price, active
Dutch auction, active curve, closed sale, live Merkle airdrop, launched generation-1 controller governance with a
scheduled operation, winding down with an open distribution blocker, and winding down with CASH registered while the
snapshot delay remains pending. The fixture does not skip the required Snapshotting phase. The seed manifest carries deterministic
actors, controller/proposer identity, operation hash/salt/calldata/Boardroom epoch, airdrop proofs, blocker identity,
and snapshot-pending balances. Read ETA and expiry from the controller's `operationState`; Forge simulation timestamps are
deliberately excluded from the fixture.

Its addresses belong only to that Anvil state. Resetting Anvil invalidates the deployment artifact, seed manifest, browser cache, and prior receipt-refresh context together. Reuse a fixed `LOCAL_SEED_NONCE` only with a reset state; use a new nonce to append another deterministic batch.

For a subpath browser deployment, use the repository's `build:local` or `dev:local` flow so app base path and RPC proxy agree.

## Verification

```sh
bun run test
bun run format:check
bun run docs:check
```

Then verify in a real browser:

- Explore discovery and canonical project routes;
- project Overview, Participate, Governance, and Transparency;
- Portfolio grant/role discovery;
- Studio operator actions without sending unintended writes;
- 320 px layout, titles, headings, overflow, and console errors;
- the durable served app route and RPC route, not only a temporary dev server.

Preserve the artifact and seed output with any reproducible bug report.
