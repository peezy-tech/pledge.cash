---
title: Wind down and redeem
description: Stop new obligations, close or quarantine existing commitments, open redemptions, and retry partial asset payouts safely.
---

# Wind down and redeem

Wind-down is a one-way project shutdown path. It stops new issuance, forces existing obligations toward closure, then snapshots a bounded basket of assets for pro-rata redemption.

## Prerequisites

- The canonical Boardroom on the intended network.
- A complete view of lifecycle status, redeemable assets, grants, distributions, and locked liquidity.
- Before launch: the owner wallet. After launch: a holder meeting the 10% current-and-previous-block threshold to start wind-down.
- For redemption: project shares and native gas token.
- For protected payouts: deliberate per-asset minimum amounts.

Do not begin from an incomplete obligation or asset read. **Unknown is not zero**, and an omitted obligation can delay redemptions or return assets later.

## 1. Start wind-down

Before launch, the owner can start wind-down. After launch, a holder with sufficient historical and current eligible power can start it even if the executor is unavailable.

Review the permanent effects before signing:

- status moves from Active to Winding down;
- queued governance actions are invalidated;
- native balance is wrapped into the canonical wrapped-native asset;
- direct governance changes to the redemption excess recipient stop; on an unlaunched Boardroom, an owner-following
  recipient can still rotate with a later ownership transfer;
- share minting and new grants, sales, airdrops, curves, and lockers stop;
- fixed-price buys, airdrop claims, curve buys and sells, and curve migration stop.

**Success proof:** Boardroom status is Winding down, governance epoch advanced, the direct excess-recipient setter is no
longer available, and canonical wrapped-native balance reflects the normalized native treasury value. For an unlaunched
Boardroom, separately track any later ownership transfer that also moves the owner-following recipient.

## 2. Close and prune obligations

Redemptions cannot open while active obligations remain. Cleanup is deliberately permissionless where possible.

1. Close or cancel active fixed-price sales and airdrops; unallocated shares return to the Boardroom.
2. Cancel non-migrated curves. Project shares return exactly. For every verified closed curve—including a curve migrated
   before wind-down and one cancelled during cleanup—inspect `quoteQuarantined` and `unrecoveredQuote`. Both terminal
   paths return quote remainder best-effort, so a hostile quote-token shortfall can remain retryable only to the
   Boardroom. The current Studio does not expose `recoverQuarantinedQuote`; that retry requires a direct contract or
   developer integration against the verified curve.
3. Settle, expire, halt, withdraw, or—only after expiry for a Boardroom-issued hostile-token grant—quarantine grants.
   The current Studio does not expose that quarantine call. An advanced integration must submit a zero-value
   `Boardroom.executeWindDownCall` whose policy is the configured TokenGrantFactory, target is the verified grant, and
   calldata is `quarantineAndClose()`.
4. Claim and exit Boardroom-owned locked liquidity. If an underlying token prevents the exact exit after the terminal delay, the protocol can preserve the LP token itself as the redeemable claim.
5. Prune closed grants, distributions, and lockers from bounded active lists.
6. Wrap any later native balance and burn treasury-held project shares.

Never send new assets to a closing obligation to “unstick” it without verifying its accounting. Late recovery paths have explicit recipients and state.

Decide whether quarantined curve quote should be recovered before opening redemptions. Recovery before opening joins
holder entitlements only if the quote asset is still admitted, or is re-admitted through the positive-balance final-asset
path after recovery and before the snapshot. A closed curve can be pruned and its empty, unpinned quote asset removed, so
timing alone is not enough—verify `isRedeemableAsset`. Recovery after redemptions open is a late Boardroom deposit: it
does not increase holder entitlements and becomes sweepable excess for the then-current
`redemptionExcessRecipient`. See [Distribution and airdrop integration](../developers/distributions-and-airdrops) for the
direct integration boundary.

### Current direct-contract gaps

The shipped Studio does not yet expose several protocol liveness and terminal-recovery calls, and the SDK has generated
ABIs but no first-class transaction builders for them:

- `recoverQuarantinedQuote()` on a verified closed curve whose status is `Migrated` or `Cancelled`;
- the Boardroom-mediated grant `quarantineAndClose()` call described above;
- `Boardroom.quarantineRedeemableAsset(asset)` for an unreadable admitted asset during wind-down;
- `Boardroom.removeRedeemableAsset(asset)` for an empty, unpinned asset after every obligation is closed and pruned;
- `Boardroom.sweepRedemptionExcess(asset)` after redemptions open.

These are advanced direct-contract or developer-integration paths, not hidden Studio buttons. Resolve every address from
the active deployment, verify canonical provenance and lifecycle preconditions, decode the exact call, and simulate it
before submission. In particular, a full 32-asset basket may require a valid empty-asset removal before a missing
positive-balance final asset can be admitted.

## 3. Open redemptions

After the wind-down delay, anyone can call the opening transition when every active obligation is closed and pruned.

Opening:

- wraps remaining native balance;
- rejects unresolved obligations;
- burns treasury-held project shares;
- fixes redemption supply;
- snapshots each admitted asset's opening balance.

Opening redemptions does not choose or snapshot the excess recipient. A later excess sweep reads the then-current value.
On an unlaunched Boardroom, ownership transfer can still move a recipient that continues to equal the outgoing owner.

Late deposits do not increase holder entitlements. They are excess and can be swept to the current recipient.

**Success proof:** status is Redemptions open and the snapshot supply and per-asset opening balances are readable.

## 4. Redeem shares

1. Open the project's `Close` section in Studio.
2. Enter the shares to burn, payout recipient, and one minimum per snapshot asset.
3. Review the complete asset list. A minimum of zero accepts a zero-rounded payout for that asset.
4. Simulate and sign.

The transaction burns the caller's shares into caller-owned redemption credits. Each asset is then attempted independently under bounded gas. The recipient receives payouts, but only the credit owner can retry failed assets.

## Partial redemption and retry

A redemption can succeed for some assets and remain unpaid for others. A failed transfer or unmet minimum does **not** re-mint burned shares. Instead, the corresponding per-asset credit stays retryable.

1. Inspect the redemption receipt and credit state for every snapshot asset.
2. Record which assets paid and which remain outstanding.
3. For an outstanding asset, use `claimRedemptionAsset` with the credit owner's wallet, chosen recipient, and a fresh minimum.
4. Repeat only after verifying the earlier claim did not allocate that asset.

An asset cannot allocate the same burned-share credit twice. Do not judge completion solely from the wallet's share balance; it is expected to be lower immediately after the first redemption.

## Wallet and transaction expectations

Start, cleanup, open, redeem, and retry are separate transactions. Many cleanup actions can be called by any wallet, but redemption credits belong to the share burner. Transaction replacement and delayed workspace refresh follow the same rules described in [Troubleshooting](../reference/troubleshooting).

## Success proof

A holder is fully redeemed only when:

- the canonical redemption receipt succeeded;
- burned shares are reflected in total supply;
- each snapshot asset has either paid or been deliberately allocated under the holder's minimum;
- no per-asset credit remains for the burned shares;
- recipient balance changes match the asset claim events.

Project-level completion also requires all snapshot entitlements to be paid or forfeited; only then can terminal residuals be swept.

## Recovery

- **Cannot start:** an unlaunched Boardroom requires its owner; after launch, verify the 10% current-and-previous-block
  holder threshold.
- **Cannot open:** check the wind-down delay, remaining grant/distribution/locker obligations, admitted-asset reads, and any
  reported failure in the automatic native wrapping or treasury-share burn. A plain native balance or treasury-held
  share balance is not itself a blocker: `openRedemptions()` wraps and burns those before the snapshot.
- **Asset read fails during wind-down:** before launch, only the owner can admit a positive-balance final asset; after
  launch, the caller must meet the 10% current-and-previous-block holder threshold. Unreadable admitted assets have a
  bounded quarantine escape hatch, but the current Studio has no control for it; an advanced integration must call the
  verified Boardroom's `quarantineRedeemableAsset(asset)` directly.
- **Redemption only partly paid:** retry each unpaid asset from the credit-owner wallet; do not request a second full redemption for the same burned shares.
- **Minimum was too high:** lower it only after independently reassessing the expected entitlement.
- **Late tokens arrived:** they are not owed to redeemers and do not change the snapshot.

## Next steps

- Read [Treasury obligations and redemptions](../understand/treasury-obligations-and-redemptions).
- Preserve receipts, snapshot balances, credits, and retry outcomes as the project's closing record.
- Developers should use the [Boardroom integration bridge](../developers/boardroom) for exact state-machine details.
