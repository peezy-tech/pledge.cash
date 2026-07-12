---
title: Project Workspace
description: Read a project through its Overview, Participate, Governance, and Transparency sections.
---

# Project Workspace

A project URL contains the chain ID and Boardroom address. The app verifies that exact identity before showing project state or transaction guidance. All four sections are public and readable without connecting a wallet.

Open a project from [Explore](explore) to begin.

## Overview

`Overview` answers “what matters now?”

- `Your position` keeps the public overview readable while adding wallet-specific facts after connection: the direct
  canonical project-token balance, settleable grants denominated in that same project token, and current plus
  previous-block governance power.
- The position read is bound to the selected chain, Boardroom, share token, wallet, and deployment. Changing any of
  them discards the earlier response instead of carrying it into the new project context.
- A single next action leads to the most relevant verified destination: a settleable grant, holder governance, an
  active participation route, or Transparency.
- `Project state` shows Boardroom, owner, project token, lifecycle, native treasury, token supply, open grants, and participation routes.
- `Treasury at a glance` lists non-share assets held by the Boardroom.

Grant amounts are added only when they use the canonical project token. A grant in another asset remains a separate
instrument and is never folded into the project-token amount. If a balance, grant, or previous-block power read fails,
the position shows `Unknown`; it does not substitute zero. Disconnecting the wallet removes the position read without
hiding public project state.

Use `Refresh` when state may have changed. `Open Studio` provides an operator handoff, but public facts remain separate from controls and an unauthorized wallet sees the section as locked.

## Participate

`Participate` compares every route discovered for this Boardroom. Available route types are `Fixed-price sale`, `Bonding curve`, `Airdrop`, and `AMM market`.

Select the exact route before entering an amount. A closed, sold-out, fully claimed, or migrated route stays visible as history but does not expose an actionable workflow. Approval, quote, price protection, deadline, recipient, balance, allowance, and wallet-specific limits appear only where the route needs them.

If the page says `No participation route is available`, use `Transparency` to inspect the project; do not send assets directly to an address in an attempt to participate.

## Governance

`Governance` shows:

- `Decision system`: current authority, owner, executor, delay, eligible supply, and epoch.
- `Holder protections`: review window, veto threshold, and wind-down threshold.
- `Queued decisions`: decoded targets, values, intent, and current status.
- `Decision history` when the optional governance activity service is available.

Connecting a holder wallet lets the app compare its current and snapshot power. `Some queued decisions were not shown` or `Governance data is incomplete` means retry before concluding the queue is empty.

For a pre-launch Boardroom, the app currently reports `Secure governance launch is unavailable for this Boardroom version`. That is a safety block, not a missing button.

## Transparency

`Transparency` separates current balances from event-derived history:

- `Treasury and supply`
- `Open commitments`
- `Grants`
- `Distributions`
- `Participation history`
- `Liquidity`
- `Technical details`

Coverage notices disclose when only some child contracts or events were read. `Unknown` is intentionally different from zero or “not applicable.” Use grant links in this section to open the verified [grant details](grant-details).

## Recover from a bad project read

- `Some project data could not be read`: choose `Try again` after checking RPC access.
- `Current contract-state detail is incomplete`: choose `Retry current state`; do not infer missing records.
- `Historical activity is incomplete`: current balances may still be readable, but lifetime totals are partial.
- `Unsupported network`: return to `Explore` and choose a configured network.
- A non-retryable provenance failure keeps the canonical URL visible, blocks project controls, and shows `Project not
  found` with a `Return to Explore` button. It does not redirect automatically.

[Read the safety checklist](../start/use-safely) · [Open Explore](../../explore)
