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
2. **Participate** — compare the exact bond, sale, curve, airdrop, or AMM routes discovered for that project.
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

HyperEVM testnet has a verified deterministic v5 deployment and a source-bound receipt manifest. Monad testnet remains **pending** and has no usable current contract stack. The HQ environment also exposes a seeded local Anvil scenario for isolated product testing; local state is not the public HyperEVM deployment.

External-controller launch is available only to a verified v5 candidate deployment. Legacy Boardrooms remain readable
but fail closed for launch and control writes. The verified public v5 artifact is limited to HyperEVM testnet, and the
project remains a mainnet NO-GO.

Read [Networks and current limitations](start/networks-and-limitations) before interacting with any claimed deployment.

## Understand The Boundary

Project tokens are ERC-20 protocol assets. Depending on Boardroom lifecycle, active stakers can have limited onchain veto and wind-down powers. Liquid token ownership alone carries no governance power. Tokens do not automatically create equity, debt, dividends, employment, legal membership, or offchain governance rights.

Hosted services such as Sentinel can index public governance actions and deliver configured alerts. They are optional context, not settlement authority. Contract state remains the source of truth for protocol actions.

Continue with [What pledge.cash is](start/what-is-pledge-cash), [Choose your path](start/choose-your-path), or the [Glossary](reference/glossary).
