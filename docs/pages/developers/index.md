---
title: Developer documentation
description: Integration map from user-facing product flows to pledge.cash SDK helpers, contracts, deployment artifacts, and engineering specifications.
---

# Developer documentation

These pages bridge the product documentation to the repository's authoritative engineering notes. They do not duplicate every invariant or ABI.

## Integration map

| Area | Start here | Authoritative engineering note |
| --- | --- | --- |
| Boardroom, governance, wind-down, redemption | [Boardroom integration](developers/boardroom) | [Boardroom protocol](https://github.com/peezy-tech/pledge.cash/blob/main/docs/boardroom-protocol.md) |
| Direct and Boardroom-issued grants | [Grant integration](developers/grants) | [Token grant protocol](https://github.com/peezy-tech/pledge.cash/blob/main/docs/token-grant-protocol.md) |
| Fixed sales, curves, and Merkle airdrops | [Distribution and airdrop integration](developers/distributions-and-airdrops) | [Distribution protocol](https://github.com/peezy-tech/pledge.cash/blob/main/docs/distribution-protocol.md) |
| Pools, router, fees, and locked liquidity | [AMM and liquidity integration](developers/amm-and-liquidity) | [AMM and locked liquidity protocol](https://github.com/peezy-tech/pledge.cash/blob/main/docs/amm-protocol.md) |
| Broadcasts, artifacts, and local seeding | [Deployment and local scenarios](developers/deployment-and-local-scenarios) | [Deployment](https://github.com/peezy-tech/pledge.cash/blob/main/docs/deployment.md) |

## Repository surfaces

- `packages/contracts`: Solidity contracts, Foundry tests, deployment scripts, and artifacts.
- `packages/sdk`: generated ABIs plus readers, discovery helpers, governance utilities, types, and transaction builders.
- `apps/web`: canonical provenance checks and routes, product workflows, transaction review, receipt recovery, and the optional Sentinel client.
- `services/sentinel`: optional hosted indexing, authentication, risk, and wallet-alert service where configured.
- `docs`: engineering specifications and this public guide.

## Integration rules

1. Select a non-pending deployment artifact and verify its live code and wiring.
2. Verify canonical factory relationships before rendering or enabling a write.
3. Preserve chain, account, deployment identity, route, and submitted hash through receipt handling.
4. Treat read failure as unknown or incomplete—not zero or empty.
5. Use SDK transaction builders and onchain limits rather than reconstructing calldata casually.
6. Simulate immediately before wallet submission and follow replacement receipts.
7. Re-read scoped state after confirmation; do not report refresh success when a required reader failed.

Run the smallest deterministic proof for the subsystem, then the full repository checks before publishing an integration.
