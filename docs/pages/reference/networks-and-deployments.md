---
title: Networks and deployments
description: Current pledge.cash network availability, pending testnet artifacts, local development boundaries, and deployment verification.
---

# Networks and deployments

Network support is not the same as a live protocol deployment. The app can offer a network selector while deliberately withholding contract actions when its checked-in artifact is pending.

## Current status

| Network | Chain id | Current artifact | What users should do |
| --- | ---: | --- | --- |
| Monad testnet | `10143` | **Pending** — canonical protocol v1 has not been broadcast | Do not submit pledge.cash protocol transactions |
| Local Anvil | `31337` | Generated locally and ignored by Git | Use only for the local scenario that produced it |
| Mainnet | — | No supported deployment | Treat any claimed mainnet address as unsupported |

The checked-in `10143.json` file contains pending status only and does not
certify usable factory addresses. A local proof, old transaction,
screenshot, or candidate file is not a promoted public identity.

## Default RPCs

- Pending Monad testnet: `https://testnet-rpc.monad.xyz`
- Local Anvil: normally `http://127.0.0.1:8547`, or the deployment's configured reverse-proxied RPC route

RPC availability proves only that a chain can answer. It does not prove the pledge.cash deployment artifact is current.

## Selecting a network

The app stores network selection locally and supports direct selection with:

- `?chain=10143`
- `?chain=31337`

Changing network changes contract identity, balances, receipts, and provenance. Confirm the chain in both the app and wallet before every signature.

## What a current artifact must prove

A usable deployment artifact binds:

- chain id and deterministic release identity;
- protocol version, source commit, receipt boundary, registry, kernel, active
  release and facet-set hash, 97-route/code-hash inventory, required storage
  version/layout, and root factory, policy, helper, router, and fee addresses;
- wrapped-native address;
- ownership, governance, and treasury roles;
- PoolManager, Universal Router, v4 Quoter, StateView, PositionManager, Permit2, and their code hashes;
- immutable reciprocal wiring between registry, kernel, BoardroomFactory,
  ControllerFactory, controller implementation, governance, market, and payout
  helpers, plus grant, distribution, Pledge v4 liquidity, and bond-market factories;
- runtime code hashes and live post-broadcast verification.

A subsystem marked pending is unavailable. The app should fail closed instead of reusing stale addresses.

## Local Anvil boundary

Local artifacts are created by the active local deployment and seed flow. They are not durable public addresses and can become wrong after an Anvil reset, redeploy, or seed change. A browser cached transaction from one local deployment must not refresh a different deployment that later reused chain id `31337`.

Record the local artifact, deployment identity, seed output, and chain state together when reproducing an issue.

## Wallet support

The current app connects through an injected browser wallet. WalletConnect QR, Coinbase Wallet mobile handoff, and a generic remote-wallet connector are not currently supported. Read-only access does not require a wallet.

## Before interacting

1. Read the artifact and ensure it is not pending.
2. Confirm chain id from the RPC and wallet.
3. Verify root runtime code and immutable wiring.
4. Verify the project through the configured BoardroomFactory.
5. Compare every transaction target with the artifact and canonical child relationship.

See [Canonical identity](canonical-identity) and the [Deployment and local scenarios developer bridge](../developers/deployment-and-local-scenarios).
