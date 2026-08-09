---
title: Networks and deployments
description: Distinguish canonical network profiles, pending artifacts, local proof, and live public deployments.
---

# Networks and deployments

A network profile records external chain dependencies. A pledge.cash artifact separately
records whether the lean protocol has been broadcast and verified. Profile support does
not imply a live protocol.

## Current status

| Network | Chain ID | pledge.cash status |
| --- | ---: | --- |
| Ethereum Sepolia | `11155111` | Pending; not broadcast or available |
| Base Sepolia | `84532` | Pending; not broadcast or available |
| Ethereum | `1` | Pending; not authorized or available |
| Base | `8453` | Pending; not authorized or available |
| Arbitrum | `42161` | Pending; not authorized or available |
| Robinhood Chain | `4663` | Pending; not authorized or available |

The two testnets are canonical deployment candidates. The four mainnets are planning
profiles only.

## What a live artifact must prove

A live artifact binds chain ID, release commit, deterministic salts and deployer,
Boardroom factory, TokenGrant factory, LiquidityLocker factory, ProtocolFeeRouter,
external Uniswap and wrapped-native addresses, canonical deployment and protocol
authorities, protocol treasury, runtime code hashes, and verified transaction evidence.
The verifier derives each root owner and fee recipient from those canonical authority
fields and checks the live contracts directly.

Local artifacts and fork receipts are proof fixtures. They never become public deployment
records by changing a status string. Check [Deployment and local
scenarios](../developers/deployment-and-local-scenarios) for the no-broadcast gates.
