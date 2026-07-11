---
title: Receive And Settle A Grant
description: App-specific steps for inspecting a token grant, approving payment if required, and settling vested tokens.
---

# Receive And Settle A Grant

Use this walkthrough when someone gives you a pledge.cash grant address. A grant can be free or paid, vested or fully unlocked, transferable or bound to the current holder.

## 1. Confirm The Grant Address

Ask the issuer for:

- chain,
- grant address,
- expected grant token,
- expected holder wallet,
- whether settlement is free or paid.

Open the app, connect the wallet that should hold the grant, and confirm the header shows the right chain.

## 2. Open Portfolio

Open `Portfolio`. Wallet discovery puts grants that need attention first. Select `Open grant` to use the grant's canonical URL.

If discovery has not found the grant yet, the raw address scanner remains available under `Tools`. The grant page should show:

- issuer,
- holder,
- grant token,
- payment token,
- grant size,
- claimable and settleable amounts,
- vesting cliff,
- vesting end,
- expiry,
- halted and closed state.

If the holder is not your wallet, your wallet cannot settle the grant unless the holder-right transfer rules move the right to you.

## 3. Read The Grant Facts

Compare `Grant size`, `Claimable`, `Settled`, `Settleable now`, the exact settlement cost, transfer state, and quarantine or expiry status.

Do not rely on the project message alone. The grant contract controls how much can be settled now.

## 4. Check Whether Payment Is Required

If `Payment token` is `None`, settlement is free. Fill `Settle amount` and use `Settle`.

If the grant has a payment token, check `Price` and fill:

- `Settle amount`: the grant-token amount you want to settle.
- `Payment approval`: the payment-token amount to approve.

Use `Approve Payment` first, then `Settle`. Each call is reviewed and simulated before the wallet opens.

## 5. Watch Expiry

`Expiry` is the last timestamp when settlement is allowed. If you miss it, remaining unclaimed tokens may be unavailable and the issuer may be able to withdraw expired escrow.

## 6. Understand Issuer Actions

The issuer may be able to halt unvested vesting or withdraw expired tokens. If a grant is halted, inspect the facts again before assuming future vesting will continue.

## 7. Find Grants With Portfolio

If you do not have the grant address, connect the wallet and refresh `Portfolio`. Grants can appear when the wallet is the:

- `Current Holder`,
- `Issuer`,
- `Original Holder`.

Use `Open grant` on a discovered item. Manual block-range controls are intentionally kept in `Tools` for diagnostics rather than the normal holder flow.
