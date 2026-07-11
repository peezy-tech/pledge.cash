# Distribution Protocol

This document describes the Boardroom distribution primitives in `packages/contracts/src/distribution/DistributionFactory.sol`,
`FixedPriceSale.sol`, `MerkleAirdrop.sol`, and `MigratingBondingCurve.sol`.

## Actors

- Boardroom governance: mints treasury-held Boardroom shares, approves the distribution factory, and creates
  distributions. Before launch the owner may call `Boardroom.executeBatch` directly; after launch the executor must
  queue the same Boardroom calls and anyone may execute the ready action.
- Boardroom: owns sale inventory before creation and receives buyer payments directly into its treasury.
- Distribution factory: deploys deterministic distribution clones, records which Boardroom created each one, and acts as the Boardroom call policy for distribution actions.
- Buyer: purchases Boardroom shares from a fixed-price sale or migrating bonding curve.
- Seller: sells curve-issued shares back to an active migrating bonding curve.
- Boardroom governance as migrator: asks a ready curve to migrate reserves into Boardroom-owned locked AMM liquidity,
  using direct owner execution only before launch or a queued action after launch.
- Distribution recipient: receives purchased Boardroom shares.
- Airdrop claimant: proves inclusion in a Merkle root and receives Boardroom shares directly or through a Boardroom-issued grant.

## Assets

- Boardroom share token: ERC20 minted by the Boardroom and sold through distributions.
- Payment or quote token: ERC20 paid by buyers. Fixed-price sale payments go directly to the Boardroom treasury; curve quote reserves stay in the curve until sold back, migrated, or cancelled.
- Distribution escrow: Boardroom shares held by a fixed-price sale or migrating curve until bought, closed, cancelled, or migrated.
- Airdrop escrow: Boardroom shares held by a Merkle airdrop until claimed directly, escrowed into claim-created grants,
  closed, or cancelled.
- Locked liquidity: AMM LP tokens held by `LockedLiquidity` after a curve migrates.

Native value is not used by these distribution flows. In particular, a Merkle grant claim is fee-exempt even when the
shared `TokenGrantFactory` charges a native fee for direct grants. A mutable factory fee therefore cannot invalidate a
committed airdrop entitlement.

## State Machines

### DistributionFactory

The factory deploys deterministic distribution clones and records ownership by Boardroom.

State:

- `lockedLiquidityFactory`: factory used by migrating curves to create Boardroom-owned locked AMM liquidity.
- `fixedPriceSaleLogic`: immutable implementation cloned for each fixed-price sale.
- `merkleAirdropLogic`: immutable implementation cloned for each Merkle airdrop.
- `migratingBondingCurveLogic`: immutable implementation cloned for each migrating curve.
- `isDistribution`: whether an address is a factory-created distribution.
- `distributionBoardroom`: Boardroom that created a distribution.
- `distributionKind`: distribution type.
- `distributionsForBoardroom`: bounded, prunable distribution index for each Boardroom. Closed entries may remain until
  anyone explicitly prunes them or the factory needs capacity for another creation; permanent `isDistribution`,
  Boardroom, and kind mappings preserve historical identity after pruning. The index uses swap-and-pop removal, so
  callers must not treat its ordering as historical.

As a Boardroom policy, the factory allows:

- Boardroom share-token approvals where spender is the distribution factory.
- `DistributionFactory.createFixedPriceSale(...)` calls where `params.shareToken` equals the calling Boardroom's share token.
- `DistributionFactory.createMigratingBondingCurve(...)` calls where `params.shareToken` equals the calling Boardroom's share token and locked-liquidity support is configured.
- `DistributionFactory.createMerkleAirdrop(...)` calls where `params.shareToken` equals the calling Boardroom's share
  token and the Merkle root, inventory, and time window are valid.
- `FixedPriceSale.close()` or `FixedPriceSale.cancel()` calls for fixed-price sales owned by the calling Boardroom.
- `MerkleAirdrop.close()` or `MerkleAirdrop.cancel()` calls for airdrops owned by the calling Boardroom.
- `MigratingBondingCurve.cancel()` or `MigratingBondingCurve.migrate(...)` calls for curves owned by the calling Boardroom.

### FixedPriceSale

Each sale is initialized once and starts active.

State:

- `boardroom`: Boardroom that created the sale and receives payment.
- `shareToken`: Boardroom share token being sold.
- `paymentToken`: ERC20 paid by buyers.
- `saleSupply`: initial share inventory.
- `remainingShares`: unsold inventory.
- `price`: payment-token units per one 18-decimal share.
- `maxPerBuyer`: optional buyer cap.
- `startTime` and `endTime`: optional sale window.
- `saleStatus`: `Active`, `Closed`, or `Cancelled`.
- `purchasedBy`: per-buyer purchased share total for the buyer cap.

### MigratingBondingCurve

Each curve is initialized once and starts active. It prices buys and sells with a linear integral:

```solidity
price(sold) = basePrice + slope * sold / 1e18;
```

State:

- `boardroom`: Boardroom that created the curve.
- `lockedLiquidityFactory`: factory used during migration.
- `shareToken`: Boardroom share token being sold.
- `quoteToken`: ERC20 paid into and refunded from the curve reserve.
- `saleSupply`: sellable shares available for curve buys.
- `migrationSupply`: reserved shares added to AMM liquidity on migration.
- `remainingSaleShares`: sellable inventory not currently held by buyers.
- `basePrice` and `slope`: quote-token pricing parameters.
- `graduationQuoteTarget`: quote reserve threshold that allows migration.
- `quoteToLpBps`: portion of quote reserve sent into AMM liquidity.
- `locker` and `pool`: created after migration.
- `curveStatus`: `Active`, `Migrated`, or `Cancelled`.
- `accountedQuoteReserve`: quote received from curve buys minus quote returned by sells. Donations and rebases do not
  silently change migration economics.
- `graduationLatched`: permanent readiness flag set once the quote target is reached or inventory sells out and the
  resulting seed is AMM-feasible.
- `quoteQuarantined` and `unrecoveredQuote`: explicit accounting for quote that could not be inspected or returned while
  closing a curve.

## Fixed-Price Create

Preconditions:

- Boardroom governance has minted share inventory to the Boardroom.
- The Boardroom executes a policy-approved batch, directly by its owner before launch or as a queued action after
  launch:
  - approve the distribution factory for the share inventory,
  - call `createFixedPriceSale`.
- share token is the Boardroom's own share token.
- payment token is a deployed contract whose `balanceOf(address)` returns exactly one word under a bounded probe.
- share amount and price are nonzero.
- end time is zero for an open-ended sale, or is strictly after start time and in the future at creation.

Effects:

- factory deploys a sale clone at a deterministic address,
- factory records the sale under the Boardroom,
- sale initializes immutable lifecycle parameters,
- the payment token is registered immediately as a Boardroom redeemable asset, reserving bounded wind-down capacity,
- factory transfers the full share inventory from the Boardroom into sale escrow.

If initialization or escrow transfer fails, the transaction reverts atomically.

## Fixed-Price Buy

Preconditions:

- sale is active,
- creating Boardroom is still active,
- current time is inside the sale window,
- deadline has not passed,
- recipient is nonzero,
- requested share amount is nonzero and not above remaining inventory,
- payment, rounded up to the payment token's smallest unit, is not above the buyer-provided maximum,
- buyer cap is not exceeded.

Effects:

- `remainingShares` decreases,
- buyer purchased total increases,
- payment token transfers from buyer directly to Boardroom,
- share token transfers from sale escrow to recipient.

Both token transfers verify the exact sender decrease and recipient increase. Fee-on-transfer and sender-surcharge
behavior therefore revert the complete purchase instead of overcharging a buyer or under-delivering inventory.

## Close Or Cancel

Only the creating Boardroom contract can close or cancel a sale. Before launch its owner can request this through
`Boardroom.execute`; after launch the executor queues the policy-checked action and any caller may execute it once ready.
`DistributionFactory` remains the required policy in either phase.

Effects:

- sale status becomes closed or cancelled,
- remaining share inventory is returned to the Boardroom,
- future buys fail.

Future buys also fail as soon as the creating Boardroom starts wind-down, even before the Boardroom closes or cancels the
sale.

## Merkle Airdrop Create And Claim

Preconditions:

- Boardroom governance has minted share inventory to the Boardroom.
- The Boardroom executes a policy-approved batch, directly by its owner before launch or as a queued action after
  launch:
  - approve the distribution factory for the airdrop inventory,
  - call `createMerkleAirdrop`.
- share token is the Boardroom's own share token.
- share amount and Merkle root are nonzero.
- end time is zero for an open-ended claim period, or is strictly after start time and in the future at creation.
- `maxGrantClaims` is the maximum number of grant-claim leaves the airdrop can honor.

Effects:

- factory deploys an airdrop clone at a deterministic address,
- factory records the airdrop under the Boardroom,
- Boardroom reserves `maxGrantClaims` issued-grant slots for the airdrop,
- airdrop initializes lifecycle and Merkle parameters,
- factory transfers the full share inventory from the Boardroom into airdrop escrow.

Anyone may submit a valid direct or grant proof; the leaf-bound `account`, not `msg.sender`, receives the shares or grant
right. Direct claims transfer proven share amounts from airdrop escrow to that account. Grant claims create a
Boardroom-issued `TokenGrant` funded by the airdrop escrow, consume one reserved Boardroom grant slot, and record that
grant so redemptions cannot open while it remains live. Grant-claim leaves are capped by `maxGrantClaims`; once the cap
is reached, otherwise valid grant proofs revert instead of overflowing the Boardroom's bounded issued-grant list.
Distribution-created grants always use the factory's explicit zero-fee path; `claimGrant` is nonpayable.
At claim execution, `TokenGrantFactory` still validates the committed Boardroom grant schedule: cliff cannot be after
vesting end, expiry must be in the future and at least one day after vesting ends, and expiry can be no more than
`5 * 365 days` after the claim block. Merkle validity does not bypass those factory checks; as time advances, the
five-year upper bound becomes easier while the future-expiry requirement eventually closes the claimable schedule.
For a paid claim, the factory also calls the issuing Boardroom's `reserveRedeemableAsset(paymentToken)` before grant
creation. Free terms require zero price and zero payment token; paid terms require positive price, a nonzero payment
token different from the share token, and readable `decimals() <= 77`. The token must also pass bounded ERC-20 reads even
if already admitted, and a newly admitted payment token needs a free slot in the 32-asset redemption basket. Airdrop
creation reserves issued-grant capacity but does not reserve these asset slots, so an otherwise valid Merkle leaf can
still revert on grant terms, token support, or basket capacity at claim time.
The token-grant factory grants that exemption only when its immutable canonical `BoardroomFactory` recognizes the issuer
and the issuer currently recognizes the calling airdrop in its recorded issued-distribution set. That Boardroom
membership is removed when the closed distribution obligation is pruned, so it is not permanent; the distribution
factory's identity mapping remains permanent for historical attribution. The airdrop itself still requires both its own
status and the Boardroom status to be active for any claim.

Both direct-claim and grant-claim leaves commit to `block.chainid`, the predicted airdrop address, Boardroom, share token,
claim index, claimant, and amount. Grant leaves additionally commit to the token-grant factory and a hash of every grant
term. The deployed grant salt is further derived from the airdrop address, claim index, account, and leaf-bound salt.
Claims track `claimedShares`, and the contract rejects any claim that would take aggregate claimed inventory above the
originally escrowed `airdropSupply`.

The Merkle root is an opaque commitment, so several properties remain an offchain root-construction responsibility and
cannot be proven during `createMerkleAirdrop`: use unique indices, encode the exact onchain type hashes and chain id, use
sorted-pair hashing compatible with Solady `MerkleProofLib`, ensure the sum of intended claim amounts does not exceed
`shareAmount`, keep the number of grant leaves at or below `maxGrantClaims`, and design each grant expiry to remain no
more than `5 * 365 days` after its intended claim time. Root construction must also budget every paid-grant payment token
inside the Boardroom's bounded redemption basket for the entire claim period. The token-grant factory enforces the expiry,
token-read, and asset-capacity conditions relative to the actual claim block. Onchain claim accounting and the bitmap
still enforce the inventory cap and one successful claim per index if a malformed root is published.

Closing or cancelling an airdrop returns unclaimed share inventory to the Boardroom and releases any unused reserved
grant slots. Starting Boardroom wind-down stops claims immediately even if the airdrop has not yet been explicitly
closed or cancelled.

## Curve Create

Preconditions:

- Boardroom governance has minted `saleSupply + migrationSupply` shares to the Boardroom.
- The Boardroom executes a policy-approved batch, directly by its owner before launch or as a queued action after
  launch:
  - approve the distribution factory for the total share inventory,
  - call `createMigratingBondingCurve`.
- share token is the Boardroom's own share token.
- quote token is a deployed contract whose `balanceOf(address)` returns exactly one word under a bounded probe, is not
  the share token, and is not another canonical Boardroom share token.
- sale supply, migration supply, base price, graduation target, and LP quote basis points are nonzero.
- total curve supply is at most the AMM `uint112` reserve limit.
- a full sale must allocate nonzero quote no greater than the AMM reserve limit and produce an initial LP amount above
  the AMM's `MINIMUM_LIQUIDITY` safety floor after applying the mandatory 95% migration minima.
- end time is zero for an open-ended sale, or is strictly after start time and in the future at creation.
- the distribution factory has a nonzero locked-liquidity factory.

Effects:

- factory deploys a curve clone at a deterministic address,
- the quote token is registered immediately as a Boardroom redeemable asset,
- the locked-liquidity factory reserves the Boardroom's migration salt, share/quote pair, locker slot, predicted locker,
  and AMM initializer before accepting the curve,
- factory records the curve under the Boardroom,
- curve initializes lifecycle and pricing parameters,
- factory transfers the full share inventory from the Boardroom into curve escrow.

## Curve Buy And Sell

Buys require the curve and creating Boardroom to be active, the buy window to be open, and the quoted payment to be at or
below the buyer's maximum. Buy quotes round up to avoid zero-cost dust purchases.

Sells require the curve and creating Boardroom to be active, the seller's amount to be no more than that account's
remaining curve sell right and no more than currently sold shares, and the quote refund to be at or above the seller's
minimum. Sell quotes round down so refunds never exceed the curve integral.

Effects:

- buys decrease `remainingSaleShares`, increase quote reserve, credit an account-bound sell right to the share recipient,
  and transfer shares to the recipient,
- sells decrease the seller's account-bound sell right, increase `remainingSaleShares`, decrease quote reserve, and
  refund quote tokens to the recipient.

All curve token transfers require exact sender and recipient balance deltas, rejecting fee-on-transfer and sender-taxed
tokens. Curve sell rights do not follow ERC20 transfers; a recipient that transfers away curve-bought shares keeps the
sell right but still needs enough shares to sell.

Once graduation readiness is feasible it latches permanently. Further buys and sells revert, freezing the reserve,
inventory, and migration amounts until the Boardroom migrates or cancels.

## Curve Migration Or Cancellation

Migration is allowed through the issuing Boardroom only while that Boardroom is active and after graduation has
latched. Once wind-down begins the only terminal path is cancellation, so a cleanup caller cannot burn redemption value
into a fresh AMM position. The share and quote allocations must fit the AMM's `uint112` reserves and produce more than
the AMM's `MINIMUM_LIQUIDITY` initial-supply safety floor. Reserved Boardroom initialization mints that full initial
supply to the authenticated locker rather than permanently burning a slice. Caller minima for both assets must be at
least 95% of the desired seed amounts; weaker slippage bounds revert before any external call.

Effects:

- curve status becomes `Migrated`,
- reserved migration shares plus unsold sale shares are paired with `quoteToLpBps` of quote reserve,
- `LockedLiquidityFactory.createLockedLiquidityForBoardroom` creates a Boardroom-owned locker,
- the curve asks the issuing Boardroom to record the locker,
- the share remainder returns exactly to the Boardroom treasury, while the quote remainder uses bounded best-effort
  return and can be quarantined if the quote token becomes hostile.

Only the reserved curve can consume its predicted locked-liquidity and AMM initializer reservation. This prevents
untrusted contracts from filling another Boardroom's locker slots, pre-seeding the pair, or consuming a reserved salt.
The locked-liquidity factory accepts migration reservations only for Boardrooms recognized by its immutable canonical
`BoardroomFactory`, and permanently used locker salts are rejected before a curve is accepted. The reservation is
consumed atomically by migration.

Cancellation is Boardroom-only and releases the unused migration reservation. Canonical Boardroom shares are returned
first with exact transfer checks. Both migration and cancellation return quote remainder best-effort: bounded-gas
balance and transfer calls cannot block either terminal transition if the quote token later reverts, burns gas, or
returns malformed data. Any shortfall is quarantined explicitly in `unrecoveredQuote`; anyone can retry
`recoverQuarantinedQuote` after the curve is `Migrated` or `Cancelled`, but recovery can only pay the issuing Boardroom.
Since the quote asset was registered at creation, recovery before `openRedemptions` joins holder entitlements only if
that asset remains admitted or is re-admitted after recovery and before the snapshot. A closed curve can be pruned and
its empty, unpinned quote asset removed first. Recovery after opening is a late Boardroom deposit: it does not increase
holder entitlements and is sweepable as excess to the current `redemptionExcessRecipient`.

## Invariants

- Sale escrow inventory plus sold shares equals original sale supply.
- Fixed-price buyer payments go to the Boardroom, not the factory or sale.
- Curve buyer quote payments stay in the curve reserve until sale, migration, or cancellation.
- Curve migration economics use accounted quote, not unsolicited token balance changes.
- Graduation is monotonic and freezes buys and sells once latched.
- Only the creating Boardroom can close or cancel its sale.
- Fixed-price sales cannot keep selling shares after the creating Boardroom starts wind-down.
- Migrating curves cannot buy, sell, or migrate after the creating Boardroom starts wind-down.
- Curve sell refunds are limited by account-bound sell rights credited by curve buys.
- A Boardroom policy call cannot create a sale for another share token.
- A Boardroom policy call cannot create a curve for another share token.
- A Boardroom policy call cannot create an airdrop for another share token.
- Grant-claim airdrops reserve Boardroom issued-grant capacity before claims can create grants.
- Grant-claim proofs do not bypass the token-grant factory's claim-time expiry and settlement-grace bounds.
- Paid grant claims do not bypass payment-token validation or the Boardroom's bounded redeemable-asset capacity.
- Curve migration creates a locker owned by the originating Boardroom, not by the curve.
- Active curve migration salts, token pairs, locker slots, and initial AMM liquidity are reserved before share escrow.
- Curve cancellation cannot be blocked by a subsequently hostile quote token; unrecovered quote remains explicitly
  quarantined and canonical share recovery remains exact.
- The Boardroom records migrated locked liquidity before redemptions can open.
- Fee-on-transfer and sender-surcharge share or payment tokens fail safely through exact two-sided balance-delta checks.
- Aggregate Merkle claims never exceed the airdrop inventory committed at creation.
- Merkle claims require both the airdrop and its creating Boardroom to remain active.
- Distribution indexes are bounded by `MAX_DISTRIBUTIONS_PER_BOARDROOM`, and closed entries can be pruned without
  erasing their permanent factory identity.

## Deterministic Proof

```sh
bun --cwd packages/contracts build
bun --cwd packages/contracts test
cd packages/contracts && forge fmt --check
```

The current distribution-specific suite does not yet exercise Merkle-valid grant claims rejected by the five-year
claim-time maximum, ordinary expiry or settlement-grace validation, unsupported payment tokens, or a full redemption
basket. Those end-to-end cases remain an explicit coverage gap; add them before changing grant-claim or asset-reservation
behavior rather than inferring them from direct TokenGrantFactory tests alone.
