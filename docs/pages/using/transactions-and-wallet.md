---
title: Transactions and Wallet
description: Connect the supported wallet, review each call, and recover from transaction or refresh failures.
---

# Transactions and Wallet

The shipped app connects through an injected browser wallet. Install or enable one, unlock it, allow it on the site, then choose `Connect Wallet`. If the app reports `No browser wallet detected`, choose `Check again` after correcting the browser setup.

WalletConnect and other remote connectors are not available in this build.

## Keep app network and wallet network aligned

The header’s `Network` chooses the app’s read and route context. Your wallet can remain on a different chain. When that happens, use `Switch` or `Switch wallet network`; Studio and other writes remain locked until both chain IDs match.

Changing the app network while an action is running is disabled. Do not manually race a pending action by switching accounts, chains, or deployment configuration in the wallet.

## The transaction sequence

1. Choose an action in `Participate`, a grant page, or `Studio`.
2. Read `Review transaction`: `Action`, `Contract function`, parameters, `Contract`, `Native value`, and `Risk`.
3. Expand `Advanced transaction details` when you need the full destination and encoded call.
4. Confirm every nested Boardroom call says `Verified decode`. An `Unverified call` is blocked.
5. For an irreversible lifecycle action, acknowledge the explicit warning.
6. Choose `Continue to wallet`. The app simulates the call before submission.
7. Verify the wallet prompt and sign or reject it.

`Go back` cancels the app review without opening the wallet.

## Transaction activity

After an action starts, `Transaction activity` stays visible across navigation. Expand it to see recent records and receipts.

| Status | Meaning |
| --- | --- |
| `Waiting for your review` | The app review has not been approved. |
| `Checking the transaction onchain` | Simulation is running. |
| `Waiting for wallet signature` | The wallet prompt is open or pending. |
| `Submitted — waiting for confirmation` | A hash exists, but no final receipt has been accepted. |
| `Confirmed onchain` | The canonical receipt succeeded. |
| `Needs attention` | Simulation, submission, receipt, or contract execution failed. Read the attached error. |
| `Cancelled` | The wallet cancelled or replaced the transaction with a cancellation. |
| `Replaced in wallet` | A different transaction replaced the submitted action. Refresh state before retrying. |

A repriced transaction continues under its canonical replacement hash. Use the `Receipt` link when the selected network has an explorer.

## Refresh after confirmation

Onchain confirmation and fresh UI state are separate:

- `Confirmed — refreshing workspace data`: the receipt succeeded and the app is reloading the affected route. Wait.
- `Confirmed — refresh waiting for the matching deployment`: the original deployment is not active. Return to that chain and deployment to finish the scoped refresh, or inspect the receipt independently.

Do not repeat an action merely because an old balance remains visible during refresh.

## Recover after interruption

- Reloading during review, simulation, or signature marks that attempt as interrupted. Start the action again from fresh state.
- A submitted record with a hash can resume receipt monitoring after reload.
- A submitted record without a receipt hash cannot be resumed and becomes `Needs attention`.
- A timeout or temporary RPC failure does not prove failure; the app keeps monitoring with backoff. Check the receipt before retrying.
- Switching account or network changes the visible transaction identity. Returning to the original identity restores its saved records.
- Use `Clear finished` only to remove terminal history. It does not cancel an onchain transaction.

[Use pledge.cash safely](../start/use-safely) · [Review network availability](../start/networks-and-limitations) · [Open the app](../../explore)
