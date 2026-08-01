---
title: Start Here
description: Understand pledge.cash, choose the right workspace, and verify what is available before connecting a wallet.
---

# pledge.cash

Inspect the project before you act.

pledge.cash is an onchain workspace for token-backed project accounts. It makes project tokens, grants, distributions, governance actions, treasury assets, liquidity, and redemptions inspectable from contract state.

It does **not** certify a team, guarantee a token's value, or turn project claims into legal rights.

## Choose Where To Start

| Your job | Start here | What you will find |
| --- | --- | --- |
| Understand or join a project | [Explore](using/explore) | Canonical projects and their current participation routes. |
| Review your grants and roles | [Portfolio](using/portfolio) | Wallet-specific items ordered by what needs attention. |
| Create or operate a project | [Studio](using/studio) | Setup, token, grant, distribution, liquidity, governance, and close workflows. |

[Open the app](../explore) when you are ready to inspect live state.

## Read A Project In Four Passes

Every canonical project workspace uses the same sequence:

1. **Overview** — identify the Boardroom, project token, lifecycle, and available actions.
2. **Participate** — compare the exact bond, sale, curve, airdrop, or Uniswap v4 routes discovered for that project.
3. **Governance** — see the controller/proposer, scheduled operations, and when active stakers can intervene.
4. **Transparency** — inspect treasury assets, supply, obligations, distributions, liquidity, and provenance.

See [Project workspace](using/project-workspace) for what each section proves—and what it does not.

## Before A Wallet Opens

- Confirm the network and the chain ID embedded in the route.
- Use canonical project and grant URLs instead of copying an address into an unrelated screen.
- Treat `Unknown`, partial history, and failed reads as incomplete information—not zero.
- Read the transaction review, target, value, and calldata summary. After you continue, the app simulates the call and stops before opening the wallet if simulation fails; it does not show a separate successful simulation result inside the review.
- Expect a submitted transaction to remain visible while it confirms, is replaced, or the workspace refreshes.

Read [Use pledge.cash safely](start/use-safely) and [Transactions and wallet activity](using/transactions-and-wallet) before your first write.

## Current Availability

Canonical protocol v1 has not been broadcast to Monad testnet. Its checked-in
artifact is **pending**, so public
contract-dependent workflows are unavailable. A matching local Anvil
deployment and seed can be used for isolated development; local state is not a
public deployment.

The app must fail closed for creation, launch, participation, governance, and
redemption when the selected artifact is pending or its registry/facet
identity cannot be verified. No mainnet deployment is supported.

Read [Networks and current limitations](start/networks-and-limitations) before interacting with any claimed deployment.

## Understand The Boundary

Project tokens are ERC-20 protocol assets. Depending on Boardroom lifecycle, active stakers can have limited onchain veto and wind-down powers. Liquid token ownership alone carries no governance power. Tokens do not automatically create equity, debt, dividends, employment, legal membership, or offchain governance rights.

Hosted services such as Sentinel can index public governance actions and deliver configured alerts. They are optional context, not settlement authority. Contract state remains the source of truth for protocol actions.

Continue with [What pledge.cash is](start/what-is-pledge-cash), [Choose your path](start/choose-your-path), or the [Glossary](reference/glossary).
