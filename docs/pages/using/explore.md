---
title: Explore Projects
description: Search the public Boardroom directory and recover from incomplete project reads.
---

# Explore Projects

`Explore` is the public entry point. It reads the Boardrooms discovered from the selected network and does not require a wallet.

[Open Explore](../../explore)

## Find a project

1. Confirm the header’s `Network`.
2. Use `Search projects` to enter a name, symbol, or Boardroom address.
3. Narrow the directory with `All`, `Fixed price`, `Curve`, `Airdrop`, or `AMM`.
4. Select a project row to open its canonical project workspace.

Search text and participation type are kept in the URL, so browser back and forward navigation restores them. When the directory is paginated, `Load more projects` expands the loaded set; a search only filters projects already loaded.

## Read a project row

Each row links to the exact chain-and-Boardroom workspace. Its lifecycle and participation summary come from the selected network. Opening it does not connect a wallet or authorize a transaction.

From the project, use:

- `Overview` for authority, supply, treasury, obligations, and the next useful action.
- `Participate` for live sale, curve, airdrop, or AMM routes.
- `Governance` for authority, delay, thresholds, and queued decisions.
- `Transparency` for detailed balances, commitments, history, and addresses.

[Learn the project workspace](project-workspace)

## If Explore is empty or incomplete

- `No projects discovered` means the selected network returned no Boardroom in the scanned catalog. It does not prove no contract exists outside that deployment.
- `No projects match these filters` means clear the search or choose `All`; if offered, load more projects.
- For `The directory could not be loaded`, choose `Try again` after checking the network and RPC.
- For `More projects could not be loaded`, the rows already shown remain usable, but the directory is incomplete.

If you know the Boardroom address and have operator access, `Studio` can load it. Canonical verification still has to succeed before controls appear.

[Open Studio](../../studio) · [Review current network limits](../start/networks-and-limitations)
