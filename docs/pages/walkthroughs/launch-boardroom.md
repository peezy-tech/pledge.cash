---
title: Launch A Boardroom In The App
description: App-specific steps for creating, configuring, and launching a governed Boardroom.
---

# Launch A Boardroom In The App

Use this walkthrough when you operate a project and want to create a Boardroom from the app. The public project pages are read-only by default; creation and lifecycle controls live in `Studio`.

## 1. Choose The Network

Open `Studio` from the primary navigation and choose the intended network in the header. The selected network determines which deployment and factories the app reads.

Do not create a public Boardroom until the network and project owner are correct.

## 2. Connect The Operator Wallet

Use `Connect Wallet` in the header. If the wallet is on a different network, the header offers `Switch` before a write can continue.

Connecting does not grant authority. Each contract still verifies the owner, executor, or holder that is allowed to act.

## 3. Create The Boardroom In Setup

In `Studio`, open `Setup`. Fill:

- `Owner`: the wallet or multisig that should control the Boardroom before governance launch.
- `Name`: the project token name.
- `Symbol`: the project token symbol.
- `Salt`: keep the generated salt or create a new one.

Use `Predict` first. This shows the deterministic Boardroom address before a transaction is sent. Then use `Create`, review the exact contract call, and continue to the wallet. The app simulates the call before submission and keeps the receipt visible while you navigate.

## 4. Issue Tokens Deliberately

Open the `Token` Studio section to mint project tokens. Common allocations include sale inventory, grants, locked liquidity, and an explicitly documented recipient allocation.

Keep a reason for each mint. Supply and treasury inventory are visible on the project's `Transparency` page.

## 5. Configure Grants

Open `Grants` to prepare a Boardroom-issued grant. Enter the holder, amount, optional payment terms, vesting timestamps, expiry, transfer rules, and salt.

Use the batched path when approval and grant creation should be one Boardroom action. After governance launch, the same workflow prepares a delayed queued action instead of trying to bypass governance.

Use [Receive And Settle A Grant](receive-settle-grant) for the holder-side flow.

## 6. Choose A Distribution

Open `Distributions` and choose the mechanism that matches the project:

- fixed-price sale for known unit pricing,
- migrating bonding curve for live curve pricing and later liquidity migration,
- Merkle airdrop for a published allocation manifest.

Write down the payment token, inventory, limits, time window, and close or migration path before creating the distribution. Buyers use the project's `Participate` page rather than operator tools.

## 7. Configure Liquidity

Open `Liquidity` to create or inspect Boardroom-owned locked liquidity. Review token ordering, desired amounts, protected minimums, deadline, and predicted locker address before signing.

## 8. Launch Governance

Open `Governance` only after at least one whole governance-eligible project token is circulating. Confirm:

- the executor that will queue future changes,
- the holder review delay,
- holder veto and wind-down thresholds.

Launching is permanent: direct owner execution ends. The app requires a separate acknowledgement, simulates the launch, and then displays queued actions with timing, targets, value, and calldata.

## 9. Verify The Public Record

Open the project's canonical URL and review `Overview`, `Participate`, `Governance`, and `Transparency`. `Portfolio` discovers wallet-specific grants and roles; `Tools` retains raw diagnostics when a protocol-level investigation is necessary.
