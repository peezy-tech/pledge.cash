---
title: Token Grants
description: Escrow-backed grants for vesting, paid settlement, and transferable token rights.
---

# Token Grants

A token grant escrows tokens and gives a holder the right to settle vested amounts over time. The grant can be free or paid.

The grant contract is useful because the tokens are already escrowed. A holder does not have to rely only on a promise that tokens will be sent later.

## Parties

| Party | Role |
| --- | --- |
| Issuer | Creates the grant and escrows grant tokens. |
| Holder | Can settle vested tokens. |
| Factory | Deploys grants and records holder-right NFTs. |
| Payment recipient | Receives payment on paid settlement according to the grant terms. |

## Free Settlement

If `price` is zero and there is no payment token, settlement only claims vested grant tokens.

## Paid Settlement

If a grant has a payment token and price, the holder pays when settling. The holder receives the vested grant tokens being settled.

This resembles exercising or buying vested token rights, but the exact meaning depends on the contract terms and any separate project agreement.

## Vesting

The vesting schedule defines when grant tokens become settleable:

- before the cliff, nothing is vested,
- between cliff and vesting end, the vested amount increases,
- at vesting end, the full grant amount is vested unless vesting was halted,
- after expiry, settlement is no longer allowed.

## Transferable Grant Rights

The factory mints a holder-right NFT for each grant. If the grant is transferable and unlocked, transferring that NFT updates the grant holder.

If the grant is not transferable, the holder should assume the settlement right is bound to the current holder wallet.

## Issuer Controls

Depending on grant state, the issuer may be able to halt unvested vesting or withdraw expired tokens. Inspect the grant before relying on future settlement.
