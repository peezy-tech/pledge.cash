---
title: Grants and vesting
description: Understand fully escrowed grants, vesting, optional payment, grant-right ownership, expiry, and issuer exits.
---

# Grants and vesting

A Token Grant holds the complete granted ERC20 balance from creation. The factory mints
an ERC721 grant right whose current owner is the only account allowed to settle.

Vesting may be immediate or linear between a cliff and end timestamp. Settlement cannot
exceed the vested, unsettled amount and must occur before expiry. A free grant transfers
only the granted token. A paid grant first transfers the exact payment from holder to
issuer, then releases the exact granted amount.

The issuer can halt vesting once and recover the unvested portion. After expiry, the
issuer can recover remaining escrow and close. Canonical Boardroom grants also have a
bounded quarantine exit for a token that becomes non-standard and cannot be recovered
exactly, preventing one hostile asset from trapping the whole Boardroom lifecycle.

The grant right moves only if its terms allow transfer, its unlock time has passed, and
the grant is open and not mid-settlement. Full settlement or issuer closure burns it.

For Boardroom-funded grants, creation happens through `Boardroom.execute`; the factory
atomically records external token dependencies. Project-share grants use an external
issuer because a Boardroom cannot target its own share token.

See [Settle a token grant](../guides/receive-and-settle-grant) for holder steps.
