---
title: Networks and Limitations
description: Current network choices, deployment availability, wallet support, and known product boundaries.
---

# Networks and Limitations

The app’s `Network` selector can show HyperEVM Testnet, Monad Testnet, and `Local`. Selecting a network changes which deployment artifact, RPC, projects, and transaction history the app uses. It does not automatically switch an already connected wallet; use `Switch` when the header asks you to match networks.

## Current deployment availability

| Network | Chain ID | Current status |
| --- | ---: | --- |
| HyperEVM Testnet | `998` | The checked-in authority-hardened deterministic v4 artifact is `pending`; it has not been broadcast. Contract-dependent app workflows are therefore unavailable. |
| Monad Testnet | `10143` | The checked-in authority-hardened deterministic v4 artifact is `pending`; it has not been broadcast. Contract-dependent app workflows are therefore unavailable. |
| Local Anvil | `31337` | Intended for a host or developer environment that provides the matching RPC and local deployment artifact. Local addresses and state are not durable public deployments. |

No mainnet deployment is supported by these docs. A network appearing in the selector is not proof that a current pledge.cash contract stack exists there.

## Wallet support

The shipped app connects through an injected browser wallet. It checks for wallets available in the browser and shows `No browser wallet detected` when none is available. WalletConnect and other remote-connection flows are not wired into this build.

If connection fails, unlock or enable the browser wallet for the site and choose `Check again`. If the app and wallet are on different chains, use `Switch wallet network` rather than signing on the wrong network.

## Governance limitation

The current deployed Boardroom version signs `launch(uint256)` without binding the expected executor. Because a pending owner transaction could change the executor before launch is mined, the app shows `Secure governance launch is unavailable for this Boardroom version` and provides no launch transaction.

This limitation concerns creating the permanent authority transition. It does not hide readable governance state on existing Boardrooms.

## Read and service limitations

- Public RPC calls can fail, rate-limit, or return partial history. The app labels incomplete current state and historical activity; retry rather than treating unknown fields as zero.
- Project and grant pages verify canonical factory provenance before exposing transaction guidance. An address alone is not enough.
- `Governance alerts` depends on the optional Sentinel API. When Sentinel is not configured, alert routes return to `Explore`.
- Explorer links are absent on networks without a configured explorer.
- The app and docs do not validate offchain claims or create legal rights beyond contract state.

[Use pledge.cash safely](use-safely) · [Open the network-aware project directory](../../explore)
