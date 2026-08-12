---
title: What Is pledge.cash?
description: Learn the four retained protocol surfaces and the responsibilities delegated to external systems.
---

# What Is pledge.cash?

pledge.cash gives a token-backed project a small onchain operating core:

- a **Boardroom**, which holds treasury assets, issues one ERC20 project token, records
  escrows, and ends in redemptions;
- **Token Grants**, which escrow existing ERC20s and release vested amounts to an
  ERC721 grant-right holder;
- a **Liquidity Locker**, which holds one verified Uniswap v4 PositionManager NFT and
  routes fees to the Boardroom and protocol;
- optional **peezy.tech identity**, which groups sign-in methods and linked wallets but
  never grants contract authority.

Projects choose their Boardroom owner externally. It can be a wallet, Safe, or separate
timelock. Public token launches can use Uniswap's CCA Liquidity Launchpad. Swaps use
Uniswap periphery. pledge.cash does not provide bespoke governance, auctions,
airdrops, staking, rewards, bonds, or a custom AMM.

A project token is not an equity certificate, legal promise, guaranteed claim, or price
guarantee. Its concrete protocol right is participation in the Boardroom's final
redemption state, subject to the assets and supply frozen onchain.

Next, read [Boardrooms and project tokens](../understand/boardrooms-and-project-tokens)
or [choose your path](choose-your-path).
