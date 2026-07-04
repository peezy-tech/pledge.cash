---
title: Launch A Boardroom In The App
description: App-specific steps for creating a Boardroom, minting shares, and preparing grants, sales, or liquidity.
---

# Launch A Boardroom In The App

Use this walkthrough when you are the project operator and want to create a Boardroom from the app. It assumes your wallet is connected to the chain shown in the header.

## 1. Confirm The Deployment

Open the app and look at the left sidebar:

- `Deployment` shows the active chain and deployed factory addresses.
- `Wallet` shows your connected account.
- `Artifact` links the deployment artifact used by the frontend.

Do not create a public Boardroom until the chain and deployment match the project you intend to use.

## 2. Connect The Operator Wallet

Use `Connect` in the header. If the wallet is on the wrong chain, use `Switch`.

The connected wallet is the default operator for app actions, but you still choose the Boardroom owner explicitly in the Boardroom form.

## 3. Open Boardroom Tools

Select the `Boardroom Tools` tab.

In `Create Boardroom`, fill:

- `Owner`: the wallet or multisig that should control the Boardroom.
- `Name`: the project token name.
- `Symbol`: the project token symbol.
- `Salt`: keep the generated salt or use `Salt` to create a new one.

Use `Predict` first. This gives you the deterministic Boardroom address before you send the transaction.

## 4. Create And Load The Boardroom

After reviewing the predicted address, use `Create`.

When the transaction confirms, use `Load` in the same panel if the app has not already loaded the Boardroom. The facts panel should show the Boardroom address, owner, share token, status, and treasury context.

## 5. Mint Initial Shares

In the Boardroom panel, use the mint controls to mint project shares.

Common early mints are:

- treasury-held supply for sale inventory,
- supply needed for Boardroom-issued grants,
- supply intended for locked liquidity,
- supply sent to a known recipient.

Keep a written reason for each mint. Token issuance is one of the first things buyers and contributors inspect.

## 6. Prepare Grants

Use the Boardroom grant section when the Boardroom should issue a grant from its share token.

Fill the holder, amount, optional payment token, price, vesting timestamps, expiry, transferability, and salt. Then use:

1. `Predict` to inspect the grant address.
2. `Approve Factory` so the factory can escrow the Boardroom shares.
3. `Create Grant` or `Create Batch`.

Use [Receive And Settle A Grant](receive-settle-grant) for the holder-side walkthrough.

## 7. Prepare A Sale Or Curve

Use `Fixed Price Sale` for simple priced inventory. Use `Migrating Bonding Curve` when the launch should sell along a curve and later migrate reserves into locked liquidity.

Before creating either distribution, write down what buyers should understand:

- payment token,
- price or curve parameters,
- sale supply,
- start and end time,
- buyer cap if any,
- cancellation or migration path.

Use [Buy From A Sale Or Curve](buy-from-sale-or-curve) for the buyer-side walkthrough.

## 8. Inspect With Discovery

After transactions confirm, open `Discovery`, scan from the relevant block range, and verify the Boardroom appears under `My Boardrooms`. Use `Use Boardroom` to load it back into tools.

Discovery is also where holders can find grants, distributions, lockers, and pools associated with their wallet.
