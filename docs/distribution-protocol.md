# Distribution Protocol

This document describes the Boardroom distribution primitives in `packages/contracts/src/DistributionFactory.sol`,
`FixedPriceSale.sol`, and `MigratingBondingCurve.sol`.

## Actors

- Boardroom owner: mints treasury-held Boardroom shares, approves the distribution factory, and creates distributions through `Boardroom.executeBatch`.
- Boardroom: owns sale inventory before creation and receives buyer payments directly into its treasury.
- Distribution factory: deploys deterministic distribution clones, records which Boardroom created each one, and acts as the Boardroom call policy for distribution actions.
- Buyer: purchases Boardroom shares from a fixed-price sale or migrating bonding curve.
- Seller: sells curve-issued shares back to an active migrating bonding curve.
- Boardroom owner as migrator: calls a ready curve through `Boardroom.execute` to migrate reserves into Boardroom-owned
  locked AMM liquidity.
- Distribution recipient: receives purchased Boardroom shares.

## Assets

- Boardroom share token: ERC20 minted by the Boardroom and sold through distributions.
- Payment or quote token: ERC20 paid by buyers. Fixed-price sale payments go directly to the Boardroom treasury; curve quote reserves stay in the curve until sold back, migrated, or cancelled.
- Distribution escrow: Boardroom shares held by a fixed-price sale or migrating curve until bought, closed, cancelled, or migrated.
- Locked liquidity: AMM LP tokens held by `LockedLiquidity` after a curve migrates.

Native value is not used by these distribution flows.

## State Machines

### DistributionFactory

The factory deploys deterministic distribution clones and records ownership by Boardroom.

State:

- `lockedLiquidityFactory`: factory used by migrating curves to create Boardroom-owned locked AMM liquidity.
- `fixedPriceSaleLogic`: immutable implementation cloned for each fixed-price sale.
- `migratingBondingCurveLogic`: immutable implementation cloned for each migrating curve.
- `isDistribution`: whether an address is a factory-created distribution.
- `distributionBoardroom`: Boardroom that created a distribution.
- `distributionKind`: distribution type.
- `distributionsForBoardroom`: bounded list of distributions created by each Boardroom.

As a Boardroom policy, the factory allows:

- Boardroom share-token approvals where spender is the distribution factory.
- `DistributionFactory.createFixedPriceSale(...)` calls where `params.shareToken` equals the calling Boardroom's share token.
- `DistributionFactory.createMigratingBondingCurve(...)` calls where `params.shareToken` equals the calling Boardroom's share token and locked-liquidity support is configured.
- `FixedPriceSale.close()` or `FixedPriceSale.cancel()` calls for fixed-price sales owned by the calling Boardroom.
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

## Fixed-Price Create

Preconditions:

- Boardroom owner has minted share inventory to the Boardroom.
- Boardroom executes a policy-approved batch:
  - approve the distribution factory for the share inventory,
  - call `createFixedPriceSale`.
- share token is the Boardroom's own share token.
- payment token is nonzero.
- share amount and price are nonzero.
- end time is zero or not before start time.

Effects:

- factory deploys a sale clone at a deterministic address,
- factory records the sale under the Boardroom,
- sale initializes immutable lifecycle parameters,
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

Both token transfers use exact recipient balance-delta checks, rejecting fee-on-transfer behavior.

## Close Or Cancel

Only the creating Boardroom can close or cancel a sale, and in normal operation this happens through
`Boardroom.execute` with `DistributionFactory` as policy.

Effects:

- sale status becomes closed or cancelled,
- remaining share inventory is returned to the Boardroom,
- future buys fail.

Future buys also fail as soon as the creating Boardroom starts wind-down, even before the Boardroom closes or cancels the
sale.

## Curve Create

Preconditions:

- Boardroom owner has minted `saleSupply + migrationSupply` shares to the Boardroom.
- Boardroom executes a policy-approved batch:
  - approve the distribution factory for the total share inventory,
  - call `createMigratingBondingCurve`.
- share token is the Boardroom's own share token.
- quote token is nonzero and not the share token.
- sale supply, migration supply, base price, graduation target, and LP quote basis points are nonzero.
- total curve supply is at most `MAX_CURVE_SUPPLY`.
- end time is zero or not before start time.
- the distribution factory has a nonzero locked-liquidity factory.

Effects:

- factory deploys a curve clone at a deterministic address,
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

## Curve Migration Or Cancellation

Migration is allowed through the issuing Boardroom when the curve is active and either the quote reserve has reached
`graduationQuoteTarget` or all sellable shares have been bought.

Effects:

- curve status becomes `Migrated`,
- reserved migration shares plus unsold sale shares are paired with `quoteToLpBps` of quote reserve,
- `LockedLiquidityFactory.createLockedLiquidityForBoardroom` creates a Boardroom-owned locker,
- the curve asks the issuing Boardroom to record the locker,
- share or quote remainders return to the Boardroom treasury.

Only a Boardroom-issued distribution can create locked liquidity for that Boardroom through this path. This prevents
untrusted contracts from filling another Boardroom's locker slots or redemption asset list.
The Boardroom-controlled migration call supplies the minimum share and quote amounts accepted into liquidity, so third
parties cannot force migration with weak slippage bounds.

Cancellation is Boardroom-only and returns all curve-held shares and quote reserve to the Boardroom treasury.

## Invariants

- Sale escrow inventory plus sold shares equals original sale supply.
- Fixed-price buyer payments go to the Boardroom, not the factory or sale.
- Curve buyer quote payments stay in the curve reserve until sale, migration, or cancellation.
- Only the creating Boardroom can close or cancel its sale.
- Fixed-price sales cannot keep selling shares after the creating Boardroom starts wind-down.
- Migrating curves cannot buy or sell after the creating Boardroom starts wind-down.
- Curve sell refunds are limited by account-bound sell rights credited by curve buys.
- A Boardroom policy call cannot create a sale for another share token.
- A Boardroom policy call cannot create a curve for another share token.
- Curve migration creates a locker owned by the originating Boardroom, not by the curve.
- The Boardroom records migrated locked liquidity before redemptions can open.
- Fee-on-transfer share or payment tokens fail safely through exact balance-delta checks.
- Distribution lists are bounded by `MAX_DISTRIBUTIONS_PER_BOARDROOM`.

## Deterministic Proof

```sh
bun --cwd packages/contracts build
bun --cwd packages/contracts test
cd packages/contracts && forge fmt --check
```
