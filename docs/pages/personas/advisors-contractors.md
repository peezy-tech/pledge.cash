---
title: Advisors And Contractors
description: How advisors, contractors, and contributors should read token grants.
---

# Advisors And Contractors

Advisors and contractors may receive token grants for work, introductions, services, or other contributions. A pledge.cash grant is an escrow-backed contract that defines who can settle tokens, how much can be settled over time, whether payment is required, and when the grant expires.

It does not by itself define employment, taxes, confidentiality, intellectual property, service obligations, or legal compensation terms. Those belong in separate agreements.

## What A Grant Tells You

A grant should be inspected before you rely on it:

- issuer,
- current holder,
- original token amount,
- grant token,
- payment token if any,
- price if settlement is paid,
- vesting cliff,
- vesting end,
- expiry,
- amount already settled,
- amount currently settleable,
- whether vesting has been halted,
- whether the grant has closed,
- whether the grant right can be transferred.

## Free Grants

A free grant has no payment token and no settlement price. The holder can settle vested tokens according to the grant schedule.

Free does not mean unrestricted. Vesting, expiry, transferability, and issuer controls still matter.

## Paid Grants

A paid grant requires the holder to pay a token amount when settling. The payment goes according to the grant contract terms, and the holder receives the vested grant tokens being settled.

Paid grants are useful when a project wants delayed, escrow-backed token access with an explicit exercise or purchase price.

## Transferability

Some grant rights can be transferred. Some cannot. A transferable grant may also have a transfer unlock timestamp. If you expect to move the grant right to another wallet, inspect transferability before accepting it.

## Expiry And Halted Vesting

Expiry is the last timestamp when settlement is allowed. If you do not settle before expiry, remaining rights may be unavailable and the issuer may be able to withdraw expired tokens.

If vesting is halted, future vesting stops under the grant rules. Already vested or already settled amounts should be interpreted from the grant state, not from an informal project message.
