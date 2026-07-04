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

## 2. Open Inspect Grant

Select `Inspect Grant`.

Paste the grant address into `Grant address` and use `Load`. The app should show:

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

## 3. Read The Vesting Chart

Use the vesting chart to compare total grant size, vested amount, settled amount, and currently settleable amount.

Do not rely on the project message alone. The grant contract controls how much can be settled now.

## 4. Check Whether Payment Is Required

If `Payment token` is `None`, settlement is free. Fill `Settle amount` and use `Settle`.

If the grant has a payment token, check `Price` and fill:

- `Settle amount`: the grant-token amount you want to settle.
- `Payment approval`: the payment-token amount to approve.

Use `Approve Payment` first, then `Settle`.

## 5. Watch Expiry

`Expiry` is the last timestamp when settlement is allowed. If you miss it, remaining unclaimed tokens may be unavailable and the issuer may be able to withdraw expired escrow.

## 6. Understand Issuer Actions

The issuer may be able to halt unvested vesting or withdraw expired tokens. If a grant is halted, inspect the chart and facts again before assuming future vesting will continue.

## 7. Find Grants With Discovery

If you do not have the grant address, open `Discovery`, set the block range, and use `Scan`. Grants can appear in:

- `Current Holder`,
- `Issuer`,
- `Original Holder`.

Use `Inspect` on a discovered grant to load it into `Inspect Grant`.
