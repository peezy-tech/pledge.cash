---
title: Treasury obligations and redemptions
description: Understand why grants, distributions, and liquidity must close before the treasury can be snapshotted for holders.
---

# Treasury obligations and redemptions

A Boardroom cannot snapshot only the tokens visible in its wallet today. Grants, distributions, curves, and locked liquidity can hold project shares or return external assets later. The protocol records them as obligations so wind-down accounts for those paths first.

## Redeemable assets

Canonical wrapped native is admitted when a Boardroom initializes. Module creation admits assets that can later reach the treasury, such as grant tokens, payment tokens, distribution quote tokens, and liquidity sides. Governance can append additional supported ERC20s to the permanent registry; bounded pagination, rather than a protocol-wide asset capacity, keeps processing finite per transaction.

An arbitrary transfer to the Boardroom does not automatically prove the asset belongs in the redemption basket. During
wind-down, a holder with the required 10% current-and-previous-block eligible stake can admit a positive-balance final
asset. Snapshotting freezes registration and liquidity/supply treatment. An unreadable admitted asset is classified
explicitly during a bounded snapshot page instead of silently skipped or allowed to create an unbounded loop.

## Why obligations must close

- a grant may return unvested or expired escrow;
- a sale or airdrop may return unallocated shares;
- a curve may return shares and quote reserve or create locked liquidity;
- a locker may return underlying assets or, in a hostile-token fallback, the LP token itself.

Redemptions open only after active obligation counts reach zero and every frozen asset-registry entry has been processed.
Permissionless pruning removes terminal members from active accounting while permanent provenance tombstones remain.

## The opening snapshot

Beginning Snapshotting burns treasury shares, fixes economic share supply and treasury-share treatment, and freezes the
asset registry and liquidity mutation. Permissionless calls then process at most 32 frozen registry entries at a time.
Only a completely processed registry may enter RedemptionsOpen. Late deposits do not change entitlement; excess goes to
the explicit redemption-excess recipient whose semantics survive launch and controller replacement.

Holder payout uses remaining snapshot balance and remaining entitlement shares, preserving the final indivisible remainder for the final claimant.

## Burned shares and per-asset credits

`redeem` burns shares into credits owned by the caller, then attempts every snapshot asset independently. A failed transfer, gas-bounded failure, or unmet minimum leaves that asset's credit outstanding. Other assets can still pay.

The credit owner later calls `claimRedemptionAsset` for each unpaid asset. The recipient can differ, but it does not own the retry authority. A successful allocation cannot occur twice.

This is why a lower post-transaction share balance is not proof that every asset paid. Follow [Wind down and redeem](../guides/wind-down-and-redeem) and verify each credit.

## Hostile-token boundaries

Exact-transfer checks prevent taxed or no-op transfers from silently corrupting balances. Bounded calls, quarantine, and LP fallback protect liveness, but they cannot make a malicious token valuable or transferable. A quarantined amount or LP fallback is explicit evidence of unresolved asset quality, not a guaranteed cash payout.
