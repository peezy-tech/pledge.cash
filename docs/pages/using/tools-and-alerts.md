---
title: Tools and Wallet Identity
description: Use protocol diagnostics and optional peezy.tech wallet links without confusing hosted context with onchain authority.
---

# Tools and Wallet Identity

[Tools](../../tools) exposes advanced protocol diagnostics such as canonical deployment
and contract identities. Use it when a normal project or grant route cannot resolve, and
copy chain ID and address together when sharing evidence.

[Wallet identity](../../settings/identity) connects the app to the optional Sentinel
identity service. You can authenticate and link additional wallets to one peezy.tech
identity. A wallet link helps sign-in and discovery only: it does not make that wallet a
Boardroom owner, grant holder, token holder, or transaction signer.

The lean Sentinel service does not watch governance, analyze proposals, send protocol
alerts, or change contract state. If the identity service is unavailable, onchain wallet
transactions and public reads still work.

When hosted context conflicts with a transaction receipt or contract read, preserve the
chain evidence and treat the hosted result as stale until refreshed.
