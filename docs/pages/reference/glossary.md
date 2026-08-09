---
title: Glossary
description: Plain-language definitions for the lean pledge.cash contracts, roles, lifecycle, and deployment evidence.
---

# Glossary

| Term | Meaning |
| --- | --- |
| Boardroom | Non-upgradeable project custodian, share issuer, escrow latch, and redemption contract. |
| Boardroom owner | External account with Active-state operation authority; may be a wallet, Safe, or separate timelock. |
| Project token | ERC20 share token minted and burned only by its Boardroom. |
| Redeemable asset | Registered ERC20 considered during the final Boardroom snapshot. |
| Escrow | A canonical grant or locker that must close before snapshotting. |
| Token Grant | Deterministic contract holding the complete escrow for one vesting grant. |
| Grant right | ERC721 whose current holder alone may settle the grant. |
| Liquidity locker | Contract holding one verified Uniswap v4 PositionManager NFT for a Boardroom. |
| PoolKey | v4 currency pair, fee, tick spacing, and hook address that identify pool configuration. |
| ProtocolFeeRouter | Custodian forwarding the protocol share of collected fees to its configured recipient. |
| Active | Boardroom operating state with owner execution and share issuance. |
| WindingDown | Irreversible state for closing grants and liquidity after normal execution stops. |
| Snapshotting | Bounded pass that freezes redemption supply and treasury asset balances. |
| RedemptionsOpen | Final state where burned shares create credits for per-asset claims. |
| Pending artifact | Checked configuration with no verified live pledge.cash addresses. |
| Canonical identity | Chain, artifact, runtime code, and factory relationships proving a protocol object. |
| Hosted identity | Optional peezy.tech sign-in and wallet-link context with no onchain authority. |
