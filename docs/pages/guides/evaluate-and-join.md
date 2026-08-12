---
title: Evaluate and join a project
description: Verify a Boardroom and its locked Uniswap v4 pool before deciding whether to swap for project tokens.
---

# Evaluate and join a project

Start with the chain and Boardroom address, not a name or token symbol.

1. Open [Explore](../../explore) and select the intended network.
2. Confirm the artifact is live; both canonical testnet artifacts are currently pending,
   so public contract actions are unavailable today.
3. Verify `BoardroomFactory.isBoardroom`, the Boardroom owner and lifecycle, its share
   token, supply, registered treasury assets, and open escrows.
4. Verify the liquidity locker through its factory and compare its Boardroom, share
   token, quote asset, fee, tick spacing, PositionManager, and registered token ID.
5. Read the grant and wind-down terms that may return assets or change final treasury
   composition.

If you choose to swap, obtain a fresh quote and review input, expected output, minimum
output, Permit2 approval, Universal Router target, deadline, and gas. Price, liquidity,
and redemption assets can change independently. A project token does not guarantee a
profit, fixed treasury claim, or legal ownership right.

Wait for the swap receipt, then re-read the token balance and project state on the same
chain.
