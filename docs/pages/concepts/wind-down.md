---
title: Wind-Down
description: How Boardrooms move from active operation to redemptions.
---

# Wind-Down

Wind-down is the process for closing a Boardroom's active project operations and preparing assets for redemption.

It is a one-way lifecycle. Once a Boardroom starts winding down, it cannot keep acting like a normal active issuer.

## Lifecycle

| Status | Meaning |
| --- | --- |
| Active | The Boardroom can mint shares and create supported grants, sales, and liquidity positions. |
| Winding down | New issuance-style actions are closed. The Boardroom prepares assets, closes obligations, exits locked liquidity, and registers redeemable assets. |
| Redemptions open | Share holders can burn shares to redeem registered assets pro rata. |

## Why It Matters

Wind-down makes closure legible. Instead of quietly abandoning a token or treasury, a Boardroom can move into a state where remaining assets and outstanding obligations are visible.

## Native Assets

Native HYPE held by a Boardroom is normalized into wrapped HYPE during wind-down so redemption accounting can use ERC20-style assets.

## Obligations

Before redemptions open, users should inspect outstanding grants, sales, curves, and locked liquidity positions. These obligations can affect which assets are available and when redemptions can safely begin. A locked-liquidity position that cannot exit an underlying token exactly may resolve into the LP token itself after the governance delay; that preserves the pool claim while allowing unrelated redemption assets to proceed.

## Redemptions

When redemptions are open, share holders burn Boardroom share tokens to receive registered redeemable assets pro rata. Governance excludes authenticated protocol custody from holder-power thresholds, but redemption accounting continues to use total economic share supply.

The redemption set is limited to assets registered by the Boardroom according to contract rules. Holding shares does not create a claim on assets that are not registered for redemption.
