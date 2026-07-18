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
3. Narrow the directory with `All`, `Saved`, `Fixed price`, `Curve`, `Airdrop`, or `AMM`.
4. Select a project row to open its canonical project workspace.

Search text and participation type are kept in the URL, so browser back and forward navigation restores them. When the directory is paginated, `Load more projects` expands the loaded set; a search only filters projects already loaded.

## Read a project row

Each row links to the exact chain-and-Boardroom workspace. Its lifecycle and participation summary come from the selected network. Opening it does not connect a wallet or authorize a transaction.

Use the star at the end of a row to save that project in this browser. Saved identities are keyed by both chain and
Boardroom address, so the same address on another network is a separate item. The `Saved` filter is shareable as
`type=saved`, but the saved list itself stays in the browser and is not placed in the URL.

The filter applies to the part of the directory already loaded. If a saved project is outside the current page, keep
loading the directory or open the network's `Saved projects` list in Portfolio. Saving is only a shortcut: it does not
connect a wallet, subscribe to governance alerts, or prove that the project's current reads are complete.

From the project, use:

- `Overview` for authority, supply, treasury, obligations, and the next useful action.
- `Participate` for live bond, sale, curve, airdrop, or AMM routes.
- `Governance` for authority, delay, thresholds, and queued decisions.
- `Transparency` for detailed balances, commitments, history, and addresses.

[Learn the project workspace](project-workspace)

## If Explore is empty or incomplete

- `No projects discovered` means the selected network returned no Boardroom in the scanned catalog. It does not prove no contract exists outside that deployment.
- `No projects match these filters` means clear the search or choose `All`; if offered, load more projects.
- `No saved projects on this network` means this browser has no saved identity for the selected chain.
- `No saved projects are in the loaded directory` means saved identities exist, but none are in the currently loaded
  directory page and search result.
- `Saved projects could not be restored` means browser storage is invalid or unavailable. Browsing still works; new
  saves may last only for the current tab until browser storage is available again.
- For `The directory could not be loaded`, choose `Try again` after checking the network and RPC.
- For `More projects could not be loaded`, the rows already shown remain usable, but the directory is incomplete.

If you know the Boardroom address and have operator access, `Studio` can load it. Canonical verification still has to succeed before controls appear.

[Open Studio](../../studio) · [Review current network limits](../start/networks-and-limitations)
