---
title: Boardrooms and project tokens
description: Understand the non-upgradeable project custodian, external owner, share token, obligations, and one-way lifecycle.
---

# Boardrooms and project tokens

A Boardroom is a canonical project account created by `BoardroomFactory`. It deploys and
controls one ERC20 share token, holds treasury assets, and records the grants and locked
liquidity that must close before redemptions.

## Authority

The Boardroom has one external owner. Only that address can mint shares, transfer
ownership, execute calls, and start wind-down. The owner may be a wallet, Safe, or
separately deployed timelock. pledge.cash does not add proposal, veto, or upgrade
authority. Ownership cannot be renounced.

An owner call can temporarily authorize its exact target to reserve assets and register
the grant or locker created by that call. The callback does not survive the transaction.
Calls to the Boardroom itself and its own share token are rejected.

## Lifecycle

- **Active:** operate the treasury, mint shares, and create obligations.
- **WindingDown:** ordinary execution stops; grants and liquidity must close.
- **Snapshotting:** after the delay, all obligations are closed and treasury shares are
  burned, freeze supply and process registered assets in bounded pages.
- **RedemptionsOpen:** holders burn shares into credits and claim each included asset.

Every transition is one-way. Deploying a new Boardroom is the upgrade path while the old
one is still Active.

Read [Treasury obligations and redemptions](treasury-obligations-and-redemptions) for the
shutdown accounting.
