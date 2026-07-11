---
title: Review and Settle a Grant
description: Verify a token grant, understand vesting and payment, then approve or settle safely.
---

# Review and Settle a Grant

Open a grant from `Portfolio` or a project’s `Transparency` section. The canonical grant URL includes chain ID and grant address. Before showing settlement guidance, the app checks contract code, factory provenance, and current terms.

[Open Portfolio](../../portfolio)

## Read before connecting

The `Review grant settlement` page keeps grant terms public. Under `Grant Detail`, verify:

- `Issuer`, `Holder`, and `Grant token`
- `Grant size`, `Claimable`, `Settled`, and `Settleable now`
- `Payment token` and `Price`
- `Vesting cliff`, `Vesting end`, and `Expiry`
- `Halted` and `Closed`

The vesting chart separates `Settled`, `Settleable`, `Future`, and `Removed` amounts. `Removed` is value that can no longer become claimable under the current terms, including after a vesting halt; it is not an expiry bucket. The chart describes contract timing and state—it does not create an employment, equity, or other offchain right.

## Settle as the holder

1. Connect the current `Grant holder` wallet and match the route’s network.
2. Enter a `Settle amount` no greater than `Settleable now`.
3. For a paid grant, query `getSettlementCost(amount)` or calculate the exact upward-rounded cost before approving. The displayed `Price` is a rate, and the current form does not show the total charge.
4. Enter an exact or tightly bounded `Payment approval` no lower than that cost, then choose `Approve Payment`.
5. Wait for that approval to confirm and refresh.
6. Choose `Settle`, review the exact transaction, and continue to the wallet.

A free grant shows `Payment token` as `None` and `Price` as `Free`; no payment approval is needed. Settlement is unavailable to an observer or original holder who is no longer the current holder.

## Issuer and wind-down controls

The app makes `Issuer Controls` visible from the connected account and issuer path. For a standalone grant, that account
is the issuer. For a Boardroom-issued grant while the Boardroom is Active, it is the prelaunch owner or launched
executor. While the Boardroom is Winding down, canonical obligation cleanup is permissionless, so the section can appear
for any connected account. Visibility is not proof that a particular action will succeed. Account/network capability
gates the buttons, but the current UI does not fully pre-disable them for grant state or expiry—for example, an early
`Withdraw Expired` or a repeated halt is rejected during simulation or by the contract. A permitted wind-down action uses
the zero-value `executeWindDownCall` path; the Boardroom restricts it to a recorded obligation policy and target, and
seeing the section does not make the caller the issuer or project authority.

- `Halt Vesting` affects future vesting and can withdraw the unvested portion according to contract rules.
- `Withdraw Expired` recovers tokens that remain after settlement expiry.

These are asset-affecting actions. Re-read the current grant state and transaction review before signing.

## Recovery

- `Verifying grant`: wait for canonical verification; no action controls are shown yet.
- `Grant temporarily unavailable`: check RPC access and choose `Retry verification`.
- `Grant not found`: confirm the network and address. The app will not treat an arbitrary contract as a pledge.cash grant.
- A disabled action explains whether you need to connect, switch networks, use the holder wallet, or resolve grant state.
- After confirmation, wait for `Confirmed — refreshing workspace data` to finish before relying on new settleable or closed values.

[Use pledge.cash safely](../start/use-safely) · [Understand transaction statuses](transactions-and-wallet)
