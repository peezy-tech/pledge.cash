# Distribution Protocol

This document describes the first Boardroom distribution primitive in `packages/contracts/src/DistributionFactory.sol`
and `packages/contracts/src/FixedPriceSale.sol`.

## Actors

- Boardroom owner: mints treasury-held Boardroom shares, approves the distribution factory, and creates sales through `Boardroom.executeBatch`.
- Boardroom: owns sale inventory before creation and receives buyer payments directly into its treasury.
- Distribution factory: deploys deterministic sale clones, records which Boardroom created each sale, and acts as the Boardroom call policy for distribution actions.
- Buyer: purchases Boardroom shares from a sale by paying the configured ERC20 payment token.
- Sale recipient: receives purchased Boardroom shares.

## Assets

- Boardroom share token: ERC20 minted by the Boardroom and sold through the fixed-price sale.
- Payment token: ERC20 paid by buyers directly to the Boardroom treasury.
- Sale escrow: Boardroom shares held by the fixed-price sale until bought, closed, or cancelled.

Native value is not used by the fixed-price sale flow.

## State Machines

### DistributionFactory

The factory deploys deterministic distribution clones and records ownership by Boardroom.

State:

- `fixedPriceSaleLogic`: immutable implementation cloned for each sale.
- `isDistribution`: whether an address is a factory-created distribution.
- `distributionBoardroom`: Boardroom that created a distribution.
- `distributionKind`: distribution type.
- `distributionsForBoardroom`: bounded list of distributions created by each Boardroom.

As a Boardroom policy, the factory allows:

- Boardroom share-token approvals where spender is the distribution factory.
- `DistributionFactory.createFixedPriceSale(...)` calls where `params.shareToken` equals the calling Boardroom's share token.
- `FixedPriceSale.close()` or `FixedPriceSale.cancel()` calls for distributions owned by the calling Boardroom.

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

## Create

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

## Buy

Preconditions:

- sale is active,
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

## Invariants

- Sale escrow inventory plus sold shares equals original sale supply.
- Buyer payments go to the Boardroom, not the factory or sale.
- Only the creating Boardroom can close or cancel its sale.
- A Boardroom policy call cannot create a sale for another share token.
- Fee-on-transfer share or payment tokens fail safely through exact balance-delta checks.
- Distribution lists are bounded by `MAX_DISTRIBUTIONS_PER_BOARDROOM`.

## Deterministic Proof

```sh
bun --cwd packages/contracts build
bun --cwd packages/contracts test
cd packages/contracts && forge fmt --check
```
