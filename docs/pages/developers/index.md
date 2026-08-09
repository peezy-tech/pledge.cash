---
title: Developer documentation
description: Map the lean product to its contracts, SDK, deployment artifacts, and deterministic proof commands.
---

# Developer documentation

The integration surface is intentionally small:

- [Boardroom integration](developers/boardroom) for custody, execution, escrows, and redemption;
- [Grant integration](developers/grants) for escrow, vesting, settlement, and grant-right NFTs;
- [Uniswap v4 and liquidity integration](developers/amm-and-liquidity) for lockers, fees, and swaps;
- [Deployment and local scenarios](developers/deployment-and-local-scenarios) for profiles,
  artifacts, simulation, forks, and end-to-end proof.

Use the generated SDK ABIs and the runtime `/deployments/<chainId>.json` artifacts
rather than copying an interface or deployment address from prose. Canonical identity
always includes chain, release artifact, factory relationship, and runtime code.

The protocol does not expose diamond facets, governance controllers, distributions,
bonds, staking, rewards, custom AMM pools, hooks, or legacy aliases. Treat an ABI or
artifact containing those surfaces as stale.
