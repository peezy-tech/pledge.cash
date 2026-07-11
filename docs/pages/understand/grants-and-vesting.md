---
title: Grants and vesting
description: Understand escrow-backed grants, vesting, paid settlement, grant-right ownership, expiry, and issuer controls.
---

# Grants and vesting

A pledge.cash grant escrows an existing ERC20 balance. It never relies on a future promise to mint. The current owner of its factory-issued ERC721 grant right is the holder allowed to settle vested tokens.

## Terms that matter

- **Grant size:** tokens originally placed in escrow.
- **Cliff:** no vesting occurs before this timestamp.
- **Vesting end:** the scheduled point of full vesting unless the issuer halts earlier.
- **Claimable:** the maximum that can ever be settled after any halt.
- **Settleable now:** currently vested minus already settled, while live and unexpired.
- **Expiry:** last timestamp at which settlement is allowed; it must be at least one day after vesting end.
- **Price:** payment-token units per one whole grant token, not the total grant cost.

For paid settlement, exact cost is rounded up:

```text
ceil(settlement amount × price / 10^grantTokenDecimals)
```

The current UI displays the price rate but not that exact computed cost in the settlement form. Query `getSettlementCost(amount)` before approving payment. See [Receive and settle a grant](../guides/receive-and-settle-grant).

## Free and paid grants

A free grant has `price = 0` and a zero payment-token address. A paid grant has a nonzero price and a separate payment token. During settlement, payment moves from holder to issuer and grant tokens move from escrow to holder in one transaction.

Transfers require exact balance deltas. Fee-on-transfer, rebasing, sender-taxed, or no-op token behavior is outside the supported settlement model.

## Grant-right ownership

The ERC721 owner and grant holder remain synchronized while the grant is live. A non-transferable grant rejects transfers and per-token approvals. A transferable grant can move only after its unlock time and before expiry or close.

When the grant closes, the holder is cleared and the grant-right NFT burns. Historical settlement and close events remain evidence.

## Issuer controls

- **Halt vesting:** snapshots vested value, returns unvested tokens to the issuer, and permanently caps future claimable value.
- **Withdraw expired:** after expiry, returns remaining escrow and closes the grant.
- **Quarantine:** only for an expired Boardroom-issued grant whose token prevents exact bounded recovery; records the stranded promise so one hostile token cannot block the entire Boardroom forever.

These powers cannot erase tokens already settled. Halt does change the holder's future vesting expectation, so evaluate issuer and project governance before accepting a grant.

## Boardroom obligations

When a Boardroom issues a grant, the grant remains a recorded obligation until closed and pruned. Non-share grant tokens and paid-grant payment tokens are admitted to the Boardroom's redemption accounting because they can later reach the treasury.
