# Boardroom Protocol

This document describes the first Boardroom primitive in `packages/contracts/src/boardroom/Boardroom.sol`,
`BoardroomFactory.sol`, and `BoardroomToken.sol`.

A Boardroom is an owned on-chain treasury and issuer account with its own ERC20 share token. It can mint shares and
execute calls through centrally approved policy contracts. `ProtocolPolicy` covers explicit pledge.cash protocol
targets, while `AssetPolicy` covers supported external assets and spender approvals.

## Actors

- Boardroom owner: controls share minting and policy-authorized treasury execution.
- Boardroom: owns assets, creates its share token, and acts as grant issuer.
- Policy registry: protocol-controlled allowlist of policy contracts that Boardrooms may use.
- Protocol policy: owner-managed allowlist of pledge.cash protocol targets, with a separate allowlist for targets that
  may receive native value.
- Asset policy: owner-managed allowlist of supported assets and approval spenders.
- Share holder: receives Boardroom share tokens directly or through grants, and can redeem shares after wind-down.
- Grant holder: receives settlement authority over a Boardroom-issued grant.
- Distribution buyer: buys Boardroom shares through a Boardroom-created distribution.

## Assets

- Boardroom share token: ERC20 minted only by its Boardroom.
- Grant token escrow: ERC20 tokens held by the Boardroom and transferred into a `TokenGrant`.
- Payment token: optional ERC20 paid to the Boardroom when settling a paid grant.
- Distribution payment token: ERC20 paid to the Boardroom when buyers purchase shares from a distribution.
- Redeemable asset: ERC20 registered by the Boardroom owner for pro-rata redemption after wind-down.
- Native HYPE: never redeemable directly. Any native balance held by the Boardroom is wrapped into canonical WHYPE when
  wind-down starts.
- WHYPE: canonical wrapped representation of native HYPE for treasury accounting and redemptions.

## State Machines

### BoardroomFactory

`BoardroomFactory` creates deterministic Boardroom clones and records them. The clone salt is bound to the Boardroom
owner, share token name, share token symbol, and caller-provided salt.

State:

- `policyRegistry`: policy registry used by every Boardroom clone.
- `boardroomLogic`: implementation cloned by the factory.
- `allBoardrooms`: created Boardroom list.
- `isBoardroom`: created Boardroom membership check.

### Boardroom

`Boardroom` has one owner, one policy registry, one canonical wrapped-native token, one share token, and a wind-down
status.

State:

- `policyRegistry`: protocol-controlled registry of allowed call policies.
- `wrappedNative`: canonical WHYPE contract used to normalize raw native HYPE before redemptions.
- `shareToken`: ERC20 minted only by this Boardroom.
- `status`: `Active`, `WindingDown`, or `RedemptionsOpen`.
- `redeemableAssets`: bounded list of ERC20 assets redeemed pro-rata by share holders.
- `issuedGrants`: bounded list of Boardroom-issued token grants created through `TokenGrantFactory`.
- `issuedGrantSlotReservations`: grant slots reserved by recorded distributions that can create Boardroom-issued grants.
- `issuedDistributions`: bounded list of Boardroom-created distributions created through `DistributionFactory`.
- `lockedLiquidityPositions`: bounded list of Boardroom-owned locked AMM liquidity positions.

The owner can mint shares through `Boardroom.mint`. The owner can also call `Boardroom.execute` or
`Boardroom.executeBatch`. Each call names a policy, target, native value, and calldata. The Boardroom first checks that
the registry allows the policy, then asks the policy whether the target call is allowed. If both checks pass, the
Boardroom performs the external call and emits a generic execution event. When active execution creates a grant,
distribution, or locked-liquidity position, the Boardroom records the returned obligation address so redemptions can
later wait for it to close.

Wind-down transitions are one-way:

1. `Active`: owner can mint shares, create grants, create distributions, and register redeemable assets.
2. `WindingDown`: entered only after `startWindDown()` wraps the Boardroom's full native HYPE balance into WHYPE. Owner
   cannot mint shares or create new grants/distributions. Owner may close recorded obligations,
   exit locked liquidity, register final redeemable assets, wrap any late native balance, and burn treasury-held shares.
   Active fixed-price sales and migrating bonding curves stop accepting trades as soon as their Boardroom enters this
   state.
3. `RedemptionsOpen`: share holders can burn shares to redeem registered assets pro-rata. Owner execution is closed.

### BoardroomToken

`BoardroomToken` is a standard ERC20 with immutable `boardroom` authority. Only the Boardroom can mint or burn it.

## Grant Issuance Flow

1. Owner ensures the Boardroom holds the ERC20 token to be granted.
2. Owner builds a `Boardroom.executeBatch` with two policy-checked calls.
3. The first call targets the grant token and approves `TokenGrantFactory` for the grant amount through `AssetPolicy`.
4. The second call targets `TokenGrantFactory.createGrant(...)` through a protocol policy, optionally forwarding the
   exact native creation fee. `TokenGrantFactory` is the only deployment-default protocol target allowed to receive
   native value.
5. `TokenGrantFactory` creates a grant where `issuer == boardroom`.
6. `TokenGrantFactory` transfers the grant tokens from the Boardroom into the grant escrow.
7. The factory mints the grant-right ERC721 token to the grant holder.

For paid grants, settlement payment tokens are transferred to the Boardroom. The Boardroom owner can then use other
registry-approved policies to deploy or spend those proceeds. For example, the Boardroom can sell share grants for USDC
and later create free USDC payroll grants through the same policy-gated batch execution surface.

## Fixed-Price Share Sale Flow

1. Owner mints Boardroom shares to the Boardroom treasury.
2. Owner builds a `Boardroom.executeBatch` with two policy-checked calls.
3. The first call targets the share token and approves `DistributionFactory` for the sale inventory through
   `AssetPolicy`.
4. The second call targets `DistributionFactory.createFixedPriceSale(...)`.
5. `DistributionFactory` verifies the sale uses the Boardroom's own share token.
6. The factory deploys and records a `FixedPriceSale`.
7. The factory transfers sale inventory from the Boardroom into sale escrow.
8. Buyers pay the configured ERC20 payment token directly to the Boardroom and receive shares from sale escrow.
9. The Boardroom can close or cancel its own sale through the same policy-gated execution surface.

## Migrating Bonding Curve Flow

1. Owner mints Boardroom shares to the Boardroom treasury.
2. Owner builds a `Boardroom.executeBatch` that approves `DistributionFactory` and calls
   `createMigratingBondingCurve`.
3. Buyers buy shares from the curve while the Boardroom is active. Sellers can sell curve-issued shares back while the
   Boardroom is active.
4. Once the quote reserve reaches the graduation target or sellable inventory is gone, the owner can migrate the curve
   through `Boardroom.execute`.
5. Migration creates Boardroom-owned locked AMM liquidity through `LockedLiquidityFactory` and records the locker on the
   Boardroom. The Boardroom-controlled call supplies the AMM slippage bounds.
6. Any quote or share remainder returns to the Boardroom treasury.

## Wind-Down And Redemption Flow

1. Owner registers ERC20 assets that should be redeemable. Raw native HYPE is not a redeemable asset; register WHYPE
   instead when native value should be claimable.
2. Owner calls `startWindDown`, which wraps the Boardroom's full native HYPE balance into WHYPE before moving from
   `Active` to `WindingDown`.
3. Owner closes, cancels, or migrates every recorded distribution and halts or expires every recorded grant.
4. Owner exits every recorded locked-liquidity position.
5. Owner calls `openRedemptions`, which wraps any native HYPE received after wind-down started.
6. `openRedemptions` verifies no recorded grants, distributions, or locked-liquidity positions are still open, burns
   treasury-held shares, and moves the Boardroom to `RedemptionsOpen`.
7. A share holder calls `redeem(shares, recipient, minAmountsOut)`.
8. The Boardroom wraps any late native HYPE balance, burns any shares currently held by the Boardroom, then calculates
   each asset amount from current Boardroom balances and total share supply.
9. The Boardroom burns the holder's shares and transfers each registered asset to the recipient with exact Boardroom and
   recipient balance-delta checks.

Redemption loops are bounded by `MAX_REDEEMABLE_ASSETS`. Wind-down gates are bounded by `MAX_ISSUED_GRANTS`,
`MAX_ISSUED_DISTRIBUTIONS`, and `MAX_LOCKED_LIQUIDITY_POSITIONS`.

## Invariants

- Only the Boardroom can mint its share token.
- Only the Boardroom can burn its share token.
- Only the Boardroom owner can mint shares through the Boardroom.
- Shares cannot be minted after wind-down starts.
- Boardroom execution requires a policy allowed by the central registry.
- Boardroom execution requires the selected policy to allow the target, value, and calldata.
- Boardroom execution cannot create new obligations after wind-down starts.
- `ProtocolPolicy` never authorizes calls to unregistered protocol targets.
- `ProtocolPolicy` never authorizes nonzero native value unless the target is explicitly value-enabled.
- `AssetPolicy` never authorizes arbitrary token calls.
- Asset approvals are limited to allowed assets and allowed protocol spenders.
- Boardroom-created grants approve `TokenGrantFactory` as spender for the requested grant amount through `AssetPolicy`.
- A Boardroom-issued grant must have `issuer == boardroom`.
- Boardroom-issued grants escrow tokens from the Boardroom before holders can settle.
- Native grant creation fees flow to `TokenGrantFactory.owner()`. If that owner is the Boardroom, the raw native balance
  is normalized into WHYPE on wind-down.
- Boardroom-created fixed-price sales can only sell the Boardroom's own share token.
- Boardroom-created migrating curves can only sell the Boardroom's own share token.
- Fixed-price sale payments are transferred directly to the Boardroom treasury.
- Fixed-price sale purchases stop once the creating Boardroom starts wind-down.
- Migrating curves stop buy and sell trades once the creating Boardroom starts wind-down.
- Curve migration can only record locked liquidity for a Boardroom that issued that curve.
- Only the Boardroom that created a distribution can close, cancel, or migrate it through the distribution policy.
- Redemptions cannot open while a recorded grant or distribution is still open.
- Redemptions cannot open while a recorded locked-liquidity position still holds LP principal.
- Raw native HYPE is never redeemed directly.
- `startWindDown()` wraps native HYPE before `status` changes to `WindingDown`.
- `openRedemptions()` and `redeem()` wrap any late native HYPE balance before redemption pricing.
- Treasury-held shares are burned before redemptions open.
- Shares sent to the Boardroom after redemptions open are burned before the next redemption is priced.
- Share redemption burns shares before transferring redeemable assets.
- Fee-on-transfer redeemable assets fail safely through exact Boardroom and recipient balance-delta checks.

## Deterministic Proof

```sh
bun --cwd packages/contracts build
bun --cwd packages/contracts test
cd packages/contracts && forge fmt --check
```
