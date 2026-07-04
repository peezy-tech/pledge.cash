---
title: Buy From A Sale Or Curve
description: App-specific steps for inspecting Boardroom distributions and using swap or Boardroom tools safely.
---

# Buy From A Sale Or Curve

Use this walkthrough when a project is distributing Boardroom share tokens through a fixed-price sale, migrating bonding curve, or AMM route.

The app is still early. Some buyer actions may happen through project-specific pages or direct contracts while the general tools expose inspection and operator flows. Always verify addresses and transaction previews before signing.

## 1. Start From A Boardroom Address

Get the Boardroom address and chain from the project. Open the app, connect your wallet, and confirm the header chain.

Open `Discovery` if you need to find project objects from your wallet history. Otherwise open `Boardroom Tools`, paste the Boardroom address into `Boardroom address`, and use `Load`.

## 2. Inspect Distributions

After loading the Boardroom, check `Boardroom Obligations`.

For a fixed-price sale, use `Use Sale` to load the sale panel. Inspect:

- sale status,
- share token,
- payment token,
- remaining shares,
- price,
- sale window.

For a migrating curve, use `Use Curve` to load the curve panel. Inspect:

- curve status,
- whether it can migrate,
- remaining sale shares,
- sold shares,
- quote reserve,
- quote token,
- locker and pool after migration.

## 3. Separate Sale Terms From Project Claims

The sale or curve tells you payment token, price mechanics, inventory, and status. It does not automatically give you equity, dividends, employment rights, or legal governance.

If the project promises rights outside the contracts, read those documents separately before buying.

## 4. Use Swap For AMM Buys

If the project token trades in an AMM pool, open `Swap`.

Use the token selectors for `From token` and `To token`, enter `Amount in`, set `Slippage bps`, and use `Quote`. The facts panel shows expected output, minimum received, fee, pool, reserves, and approval state.

If approval is required, use `Approve` first. Then use `Swap`.

Native HYPE routes use the `Native swap` control when the pair supports wrapped native.

## 5. Recheck After The Transaction

After buying or swapping, verify:

- your token balance in the wallet,
- the sale, curve, or pool state,
- the Boardroom treasury or reserve effects,
- whether the Boardroom has changed status.

For fixed-price sales and curves, project operators may still close, cancel, or migrate according to contract state. For AMM swaps, price and liquidity can move between quote and execution.

## 6. Monitor Wind-Down

If the Boardroom later enters wind-down, open `Boardroom Tools` and inspect `Wind-Down`. Redemptions only apply to registered redeemable assets after redemptions open.
