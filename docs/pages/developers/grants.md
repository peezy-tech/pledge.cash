---
title: Grant integration
description: Integrate deterministic Token Grants, ERC721 rights, exact escrow, paid settlement, and Boardroom callbacks.
---

# Grant integration

Use `packages/contracts/src/grants/`, generated SDK ABIs, and the deep [Token Grant
specification](https://github.com/peezy-tech/pledge.cash/blob/main/docs/token-grant-protocol.md).

`TokenGrantFactory.createGrant` uses `msg.sender` as issuer and requires the exact native
creation fee. Predict addresses with issuer plus salt. The factory transfers the exact
grant amount, initializes the clone, mints token ID `uint160(grant)`, and records
`grantForTokenId`.

For a canonical Boardroom issuer, encode `createGrant` as a `Boardroom.execute` target.
That single transaction funds escrow, reserves external dependencies, and registers the
escrow. Do not try to fund a Boardroom-issued grant with its own share token.

Quote live data from `getSettleableAmount(timestamp)` and
`getSettlementCost(amount)`. Payment cost rounds up. Submit any payment-token approval
to the grant contract, not the factory. Re-read current ERC721 owner before settlement or
transfer.

Index `TokenGrantCreated`, `GrantSettled`, issuer terminal events, and `GrantClosed`, but
derive current state from the grant and factory. Closed grants have burned rights and can
be pruned from a Boardroom.
