---
title: Networks and Limitations
description: Distinguish configured network profiles from live pledge.cash deployments and understand current product boundaries.
---

# Networks and Limitations

The repository has canonical profiles for Ethereum Sepolia (`11155111`) and Base
Sepolia (`84532`). Both pledge.cash deployment artifacts are **pending**: no canonical
Boardroom factory, grant factory, locker factory, fee router, or deterministic deployer
is live there yet.

Planned Ethereum, Base, Arbitrum, and Robinhood Chain mainnet profiles are not deployment
authorization. The app may display a configured network while disabling contract actions
because the artifact is pending.

## Current boundaries

- Wallet support uses an injected browser wallet.
- Swaps require the configured Uniswap Universal Router and Permit2 path.
- Launches happen outside pledge.cash; the docs point to Uniswap CCA.
- A Boardroom owner is external; pledge.cash ships no multisig or governance controller.
- The locker accepts one hookless, unsubscribed v4 position with the exact configured
  pair, fee, and tick spacing.
- Hosted identity is optional and never changes onchain permissions.

Local simulation and disposable fork deployment are development evidence only. Check
[Networks and deployments](../reference/networks-and-deployments) for artifact status.
