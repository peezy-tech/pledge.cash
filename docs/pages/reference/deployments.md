---
title: Deployments
description: Current deployment and network information for pledge.cash users.
---

# Deployments

pledge.cash is currently oriented around testnet and local development flows.

## HyperEVM Testnet

| Field | Value |
| --- | --- |
| Chain id | `998` |
| Default RPC | `https://rpc.hyperliquid-testnet.xyz/evm` |
| Public app | `https://pledge.cash/` |
| Deployment artifact | `https://pledge.cash/deployments/998.json` |

The checked-in deployment artifact is published with the static app so users and the frontend can resolve contract addresses for the active chain.

## Local Development

Local development uses Anvil and a separate local deployment artifact. Local addresses are not public project addresses and should not be treated as durable deployments.

## Mainnet Status

No mainnet deployment is supported by these docs yet. If someone claims a mainnet pledge.cash deployment exists, verify it against official project sources, deployment artifacts, and contract addresses before interacting.

## Contract-Level Reference

The public docs are user-facing. Contract state-machine details live in the repository protocol notes:

- `docs/boardroom-protocol.md`
- `docs/token-grant-protocol.md`
- `docs/distribution-protocol.md`
- `docs/amm-protocol.md`
- `docs/deployment.md`
