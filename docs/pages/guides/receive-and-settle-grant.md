---
title: Settle a token grant
description: Verify an escrow-backed grant right, calculate vested amount and payment, then settle safely.
---

# Settle a token grant

A grant-right NFT represents control of a fully escrowed Token Grant. It does not mint a
future promise.

1. Open the grant from [Portfolio](../../portfolio) or its chain-and-address route.
2. Verify its TokenGrantFactory relationship and that the connected wallet owns the
   grant-right NFT.
3. Read the granted token, escrow size, settled amount, cliff, end, expiry, transfer
   terms, payment token, and price.
4. Choose an amount no greater than the currently settleable amount.
5. For a paid grant, review the computed total cost and approve only the needed payment
   token amount for the grant contract.
6. After the approval receipt, submit settlement and wait for its receipt.

Settlement transfers payment directly to the issuer, then releases escrow to the current
holder. Full settlement closes the grant and burns the NFT. Before expiry, unvested
amounts remain under the issuer's one-time halt authority. After expiry, only the issuer
can recover remaining escrow.

If the grant right is transferable, a transfer also changes who can settle. Confirm the
current holder again immediately before signing.
