---
title: Wind down and redeem
description: Invalidate governance, close obligations and singleton liquidity, process a bounded asset snapshot, and claim per-asset redemption credits.
---

# Wind down and redeem

Wind-down is a one-way shutdown path:

```text
Active -> WindingDown -> Snapshotting -> RedemptionsOpen
```

Canonical protocol v1 is pending on both target testnets and is not
mainnet-ready. Do not begin from incomplete registry/release identity,
migration, obligation, liquidity, or asset reads. Unknown is not zero.

## 1. Start wind-down

Before launch, the owner may start wind-down. After launch, a holder must meet the 10% threshold using current and
previous-block active stake against current and previous-block governance-eligible supply.

The transition:

- stops new issuance and commitments;
- advances the Boardroom governance epoch, invalidating older controller operations in O(1);
- starts the immutable wind-down delay;
- disables ordinary active-state governance and liquidity mutation;
- preserves permissionless bounded cleanup.

The controller proposer and permissionless executor are not required for holder-triggered wind-down.

## 2. Resolve obligations

Redemptions cannot begin while `activeObligationCount() != 0`.

- Close fixed-price sales and airdrops; return unused inventory.
- Settle or terminalize grants, bonds, distributions, and the canonical reward pool.
- Prune each terminal obligation with `pruneObligation`, or use a bounded batch of at most 32 addresses.
- Verify scalar total/per-kind counts and every per-asset dependency count after pruning.

Pruning never erases factory provenance or append-only discovery history.

A curve with an open sell liability or stranded quote is not terminal. Cancellation, expiry, or migration fallback enters
a 30-day sell-only unwind. Any current holder may sell transferable shares against the global liability; afterward anyone
may finalize and remaining holders keep their shares. A graduated curve first has a seven-day permissionless migration
window.

If quote return fails, anyone may retry recovery. Forfeiture is unavailable before wind-down and requires 30 days of
quarantine plus an unvetoed seven-day window; a 1% current-and-previous-block eligible staker can restart the delay.
Only recovery or finalized forfeiture closes that dependency and releases its liquidity reservation. Do not bypass it
with a fabricated close state.

## 3. Exit and close singleton liquidity

Each Boardroom has at most one canonical locker and pool.

During WindingDown anyone may:

1. attempt full exact exit to the Boardroom;
2. use the hostile-token fallback that returns the LP token claim to the Boardroom when exact underlying exit cannot
   complete;
3. explicitly close the empty, reservation-free singleton.

A zero LP balance is not closure. Verify `liquidityStatus() == Closed`, with no pending migration reservation, before
snapshotting. Removed assets always return to the Boardroom.

## 4. Begin Snapshotting

After the wind-down delay and once obligations/reward/liquidity gates are
clear, anyone calls `beginSnapshot(expectedFacetSetHash)`.

That transaction:

- wraps current native value;
- burns Boardroom-held treasury shares;
- freezes total redemption supply;
- freezes the append-only asset-registry length;
- enters `Snapshotting`;
- forbids later asset registration, treasury-share treatment changes, and liquidity mutation.

Record `assetSnapshotProgress()` and `redemptionSupplyState()`.

## 5. Process bounded asset pages

Anyone calls `snapshotAssets(expectedFacetSetHash, maximum)`; the maximum page
is 32. Each registry entry becomes:

- Included, with its frozen Boardroom balance;
- Excluded, if membership was removed before freeze;
- Unreadable, if the bounded balance probe failed.

Every attempted entry advances the cursor. Re-read events and per-asset status after each page. No transaction performs
work proportional to the full lifetime registry.

Only when the cursor equals the frozen count may anyone call
`openRedemptions(expectedFacetSetHash)`.

## 6. Redeem and claim assets

`redeem(expectedFacetSetHash, shares)` burns the caller's shares into
caller-owned redemption credits. It does not loop over the asset registry.

For each Included asset, the credit owner calls
`claimRedemptionAsset(expectedFacetSetHash, asset, recipient, minAmountOut)`.
Each asset is allocated once for the relevant credit. A hostile or temporarily
failing token cannot roll back claims for unrelated assets.

A failed asset transfer does not remint shares. Retry only that asset with the credit-owner wallet after checking
`allocatedRedemptionShares`, `redemptionAssetState`, and the earlier receipt.

Late deposits do not change frozen holder entitlements. Proven excess is
sweepable only to the preserved `redemptionExcessRecipient`. Curve quote must
be recovered or resolve through its time-delayed, vetoable terminal policy
before snapshotting.

Registry activation remains possible during wind-down, snapshotting, and open
redemptions. A changed hash makes old calldata stale; a storage-version release
also pauses writes until this Boardroom is permissionlessly migrated. Re-read
the active hash and migration state before every transaction.

## Success proof

Project-level proof requires:

- status `RedemptionsOpen`;
- zero active obligations and per-kind counts;
- terminal reward pool;
- liquidity `Closed` and no reservation;
- frozen supply;
- snapshot cursor equal to frozen count;
- explicit status for every registry entry;
- matching redemption credit, allocation, payout, and excess events.

Holder completion requires every intended Included asset to be allocated and paid or deliberately accepted at the
holder's chosen minimum.

## Recovery

- **Cannot start:** verify prelaunch owner or the 10% two-checkpoint staker threshold.
- **Cannot begin snapshot:** verify delay, scalar obligation counts, reward terminalization, singleton closure, and
  reservation state.
- **Snapshot page fails:** keep the same frozen registry and retry a bounded page; do not rebuild state from a partial
  client list.
- **Asset is Unreadable:** treat the explicit zero snapshot as a security/liveness event and investigate the token.
- **Claim fails:** inspect only that asset's credit/allocation and retry with a deliberate minimum.
- **Curve blocks closure:** stop. The purchaser, timing, migration-price, or quarantine gate is unresolved.
