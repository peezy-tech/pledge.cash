---
title: Networks and Limitations
description: Current network choices, deployment availability, wallet support, and known product boundaries.
---

# Networks and Limitations

The app’s `Network` selector can show Monad Testnet and `Local`. Selecting a network changes which deployment artifact, RPC, projects, and transaction history the app uses. It does not automatically switch an already connected wallet; use `Switch` when the header asks you to match networks.

## Current deployment availability

| Network | Chain ID | Current status |
| --- | ---: | --- |
| Monad Testnet | `10143` | Canonical protocol v1 is `pending`; it has not been broadcast. Contract-dependent app workflows are unavailable. |
| Local Anvil | `31337` | Intended for a host or developer environment that provides the matching RPC and local deployment artifact. Local addresses and state are not durable public deployments. |

No mainnet deployment is supported by these docs. A network appearing in the selector is not proof that a current pledge.cash contract stack exists there.

## Wallet support

The shipped app connects through an injected browser wallet. It checks for wallets available in the browser and shows `No browser wallet detected` when none is available. WalletConnect and other remote-connection flows are not wired into this build.

If connection fails, unlock or enable the browser wallet for the site and choose `Check again`. If the app and wallet are on different chains, use `Switch wallet network` rather than signing on the wrong network.

## Governance and release limitation

Canonical protocol v1 includes external-controller launch and global
registry-routed Boardroom releases, but the target testnet does not have a usable
artifact. The app must fail closed for launch, controller operations, and
Boardroom-control claims while a deployment is pending.

Every state-changing Boardroom call and controller authorization is bound to
an expected facet-set hash. After a storage-version activation, writes remain
unavailable on each Boardroom until its permissionless migration completes.
Local success is not a mainnet-readiness claim.

## Read and service limitations

- Public RPC calls can fail, rate-limit, or return partial history. The app labels incomplete current state and historical activity; retry rather than treating unknown fields as zero.
- Project and grant pages verify canonical factory provenance before exposing transaction guidance. An address alone is not enough.
- `Governance alerts` depends on the optional Sentinel API. When Sentinel is not configured, alert routes return to `Explore`.
- Explorer links are absent on networks without a configured explorer.
- The app and docs do not validate offchain claims or create legal rights beyond contract state.

[Use pledge.cash safely](use-safely) · [Open the network-aware project directory](../../explore)
