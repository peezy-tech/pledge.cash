---
title: Settle a token grant
description: Verify a grant, understand its vesting and payment terms, and settle vested tokens without confusing price with total cost.
---

# Settle a token grant

A grant is an escrow-backed right, represented by an ERC721 grant-right token. It does not mint the promised token. The grant contract already holds the escrow and releases only the amount currently vested and unsettled.

## Prerequisites

- The canonical grant address on the selected network.
- A current deployment whose TokenGrantFactory can verify that address.
- The wallet that currently owns the grant-right NFT.
- For a paid grant, enough payment token and native token for approval, settlement, and gas.
- A decision about how much of the currently settleable amount to receive.

Only the current grant holder can settle. The issuer can halt future vesting or withdraw expired escrow; those are different authorities.

## 1. Verify the grant

1. Connect the expected holder wallet and open [Portfolio](../../portfolio), or open the canonical grant route supplied by the project.
2. Confirm the grant address, issuer, current holder, grant token, payment token, grant size, cliff, vesting end, expiry, halted state, and closed state.
3. Confirm **Settleable now** is known and greater than zero.
4. If the issuer is a Boardroom, follow its project link and confirm the grant appears as that Boardroom's canonical obligation.
5. Stop on a provenance failure or any **Unknown** value needed for the decision.

The current public grant detail does not expose every ERC721 transfer condition. If moving the grant right matters, verify `transferable`, `transferUnlockTime`, ownership, expiry, and closed state directly before relying on transferability.

## 2. Understand price and cost

A free grant has a zero payment-token address and zero price. A paid grant stores a **price rate**, not the total cost of the entire grant.

For a settlement amount `amount`, the contract computes:

```text
settlement cost = ceil(amount × price / 10^grantTokenDecimals)
```

The result is denominated in the payment token's smallest units. Rounding is upward.

> **Current UI gap:** Grant Detail shows the stored price rate and the token amount that is settleable, but it does not show the exact `getSettlementCost(amount)` result beside the settlement form. Before approving a paid settlement, query that public contract function or calculate the exact integer result. Do not treat the displayed price as the total payment.

An approval is only permission to spend. It is not settlement, and an unnecessarily large approval remains after a failed or partial settlement.

## 3. Approve a paid grant

Skip this section for a free grant.

1. Choose the settlement amount, no greater than **Settleable now**.
2. Compute or query the precise payment charge. The current app does not show this total in the form.
3. Enter a payment approval no lower than that cost. Prefer an exact or tightly bounded approval.
4. Review the payment-token address, grant contract as spender, amount, chain, and simulation.
5. Sign the approval and wait for its receipt.

After confirmation, verify the payment-token allowance from the holder to the grant contract. Refreshing the grant view may not display that allowance, so the allowance read or receipt is the proof.

## 4. Settle vested tokens

1. Re-read the grant. Time and earlier transactions may have changed the settleable amount.
2. Enter the desired grant-token amount.
3. Select **Settle** and review the grant address and `settle(amount)` call.
4. For a paid grant, re-check the computed cost and allowance before continuing.
5. Sign with the current holder wallet.

Settlement transfers payment directly from holder to issuer, then transfers grant tokens from escrow to the holder. If all claimable tokens are settled, the grant closes and its grant-right NFT burns.

## Wallet and transaction expectations

Approval and settlement are two independent transactions. Either can be rejected, replaced, repriced, reverted, or confirmed. Use the canonical replacement hash shown in the Transaction Center. A confirmed settlement may show **refreshing workspace data** while the app re-reads the grant and portfolio.

Do not repeat settlement while a submitted or confirmed-refreshing record is unresolved. Verify the receipt and the grant's `settledAmount` first.

## Success proof

Verify all of the following onchain:

- the canonical settlement receipt succeeded;
- `settledAmount` increased by the requested amount;
- the holder received the exact grant-token amount;
- for a paid grant, the issuer received the exact computed payment;
- **Settleable now** decreased accordingly;
- if fully settled, the grant is closed and its grant-right NFT no longer exists.

Token transfers require exact balance changes. Fee-on-transfer, sender-taxed, or no-op tokens can cause settlement to revert rather than silently underpay either side.

## Recovery

- **Nothing is settleable before the cliff:** wait; zero vested is expected only when the read itself succeeded.
- **Settlement cost or decimals are Unknown:** stop and restore a reliable RPC read.
- **Allowance is too low:** submit a deliberate replacement approval, then retry settlement.
- **Settlement reverted after approval:** inspect the current holder, expiry, vesting, balance, allowance, and token behavior. The approval may still exist.
- **Issuer halted vesting:** already vested rights remain claimable, but future vesting is permanently capped and unvested escrow returns to the issuer.
- **Grant expired:** settlement is closed after expiry. The issuer can withdraw remaining escrow; a Boardroom issuer has a bounded quarantine path if a hostile token prevents exact recovery.
- **Wrong wallet owns the grant right:** only that current owner can settle. A transfer is possible only if the grant was created transferable, is unlocked, live, and unexpired.

## Next steps

- Read [Grants and vesting](../understand/grants-and-vesting).
- Return to [Portfolio](../../portfolio) to find other wallet work.
- For project lifecycle risk, read [Treasury obligations and redemptions](../understand/treasury-obligations-and-redemptions).
