# Boardroom Protocol

This document describes the first Boardroom primitive in `packages/contracts/src/boardroom/Boardroom.sol`,
`BoardroomFactory.sol`, and `BoardroomToken.sol`.

A Boardroom is an owned on-chain treasury and issuer account with its own ERC20 share token. Before launch, its owner
can mint shares and execute policy-checked calls directly. After launch, the Boardroom moves to delayed push-forward
governance: the current executor queues delayed actions, share holders can cancel queued actions or start wind-down,
and anyone may execute an action after its delay. `AssetPolicy` covers supported external assets and spender approvals,
while obligation-creating protocol modules such as `TokenGrantFactory`, `DistributionFactory`, and
`LockedLiquidityFactory` act as their own call policies so the Boardroom can record created obligations.

## Actors

- Boardroom owner: controls share minting and policy-authorized treasury execution before launch.
- Executor: queues delayed governance actions after launch. This can be an EOA, multisig, or governance contract;
  execution becomes permissionless when an action is ready.
- Boardroom: owns assets, creates its share token, and acts as grant issuer.
- Policy registry: protocol-controlled registry of call status plus permanent module identity. Disabling a module
  blocks new obligations without erasing the cleanup authority of obligations it already created.
- Module policies: pledge.cash factories that authorize their own Boardroom calls and report created obligations.
- Asset policy: owner-managed allowlist of supported assets and approval spenders.
- Share holder: receives Boardroom share tokens directly or through grants, can cancel queued actions and start
  wind-down after launch, and can redeem shares after redemptions open.
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
- WHYPE: canonical wrapped representation of native HYPE for treasury accounting and redemptions. Every Boardroom
  registers canonical WHYPE as its first redeemable asset during initialization.

## State Machines

### BoardroomFactory

`BoardroomFactory` creates deterministic Boardroom clones and records them. The clone salt is bound to the Boardroom
owner, share token name, share token symbol, and caller-provided salt.

State:

- `policyRegistry`: policy registry used by every Boardroom clone.
- `boardroomLogic`: implementation cloned by the factory.
- `redemptionPayoutLogic`: immutable delegate helper used by every clone for isolated redemption accounting, exact
  transfers, native wrapping, treasury-share burning, and active-obligation pruning. Callers cannot select this target.
- `allBoardrooms`: created Boardroom list.
- `isBoardroom`: created Boardroom membership check.

### Boardroom

`Boardroom` has one owner, one policy registry, one canonical wrapped-native token, one share token, and a wind-down
status.

State:

- `policyRegistry`: protocol-controlled registry of allowed call policies.
- `wrappedNative`: canonical WHYPE contract used to normalize raw native HYPE before redemptions.
- `shareToken`: ERC20 minted only by this Boardroom.
- `launched`: one-way flag that disables direct owner execution and enables queued governance.
- `executor`: account allowed to queue delayed actions after launch.
- `governanceDelay`: delay applied to every queued action after launch.
- `queuedActionEta`: ETA for queued single-call and batch action hashes.
- `status`: `Active`, `WindingDown`, or `RedemptionsOpen`.
- `redeemableAssets`: bounded list of ERC20 assets redeemed pro-rata by share holders.
- `issuedGrants`: bounded active list of Boardroom-issued token grants created through `TokenGrantFactory`.
- `issuedGrantSlotReservations`: grant slots reserved by recorded distributions that can create Boardroom-issued grants.
- `issuedDistributions`: bounded active list of Boardroom-created distributions created through `DistributionFactory`.
- `lockedLiquidityPositions`: bounded active list of Boardroom-owned locked AMM liquidity positions.
- `obligationPolicyOf`: permanent canonical-policy identity for every obligation ever recorded. Active-array pruning
  never erases this binding.
- redemption credits: burned shares retained per holder until each redeemable asset has allocated and paid that
  holder's corresponding entitlement.

The owner can mint shares through `Boardroom.mint` before launch. The owner can also call `Boardroom.execute` or
`Boardroom.executeBatch` before launch. Each call names a policy, target, native value, and calldata. Raw calls may omit
the policy, but calls to a registered pledge.cash module must use that module even when its current status is disabled.
Module identity is one-way and independent of `Active`, `LifecycleOnly`, or `Disabled` status, so disabling a module
cannot reopen a raw-call bypass. New module calls require active status. Calls to a recorded obligation must use its
permanent canonical policy, and only selectors approved by that policy's lifecycle hook may run. This cleanup route
continues to work after the central registry disables the module.

Obligation hooks are fail-closed: a registered module must successfully report the obligation created by a call, and a
lifecycle hook must successfully classify cleanup and reservation release. A reverting or malformed hook reverts the
entire call. Plain policies such as `AssetPolicy` do not implement or invoke obligation hooks.

After launch, owner-only functions that affect treasury or shares must be called by the Boardroom itself through a
queued action. The current executor queues a single call or batch with a salt. The action becomes executable by any
caller after `governanceDelay`; queue authority remains executor-only. The delay must be nonzero and cannot exceed 30
days. Any current share holder can cancel a queued action and can start wind-down directly.

Wind-down transitions are one-way:

1. `Active`: before launch, the owner can mint shares, create grants, create distributions, and register redeemable
   assets. After launch, those actions must go through queued self-governance.
2. `WindingDown`: entered only after `startWindDown()` wraps the Boardroom's full native HYPE balance into WHYPE. The
   Boardroom cannot mint shares or create new grants/distributions. Governance may close recorded obligations, exit
   locked liquidity, register final redeemable assets, wrap any late native balance, and burn treasury-held shares.
   Active fixed-price sales and migrating bonding curves stop accepting trades as soon as their Boardroom enters this
   state.
3. `RedemptionsOpen`: share holders can burn shares into per-asset redemption credits. Each asset pays independently,
   and failed payouts remain retryable. Owner execution is closed.

### BoardroomToken

`BoardroomToken` is a standard ERC20 with immutable `boardroom` authority. Only the Boardroom can mint or burn it.

## Grant Issuance Flow

1. Owner ensures the Boardroom holds the ERC20 token to be granted.
2. Owner builds a `Boardroom.executeBatch` with two policy-checked calls.
3. The first call targets the grant token and approves `TokenGrantFactory` for the grant amount through `AssetPolicy`.
4. The second call targets `TokenGrantFactory.createGrant(...)` through `TokenGrantFactory` as the policy, optionally
   forwarding the exact native creation fee.
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
9. The Boardroom can close or cancel its own sale through `DistributionFactory` as the policy.

## Migrating Bonding Curve Flow

1. Owner mints Boardroom shares to the Boardroom treasury.
2. Owner builds a `Boardroom.executeBatch` that approves `DistributionFactory` and calls
   `createMigratingBondingCurve`.
3. Buyers buy shares from the curve while the Boardroom is active. Sellers can sell curve-issued shares back while the
   Boardroom is active.
4. Once the quote reserve reaches the graduation target or sellable inventory is gone, governance can migrate the curve
   through `Boardroom.execute` before launch or a queued action after launch.
5. Migration creates Boardroom-owned locked AMM liquidity through `LockedLiquidityFactory` and records the locker on the
   Boardroom. The Boardroom-controlled call supplies the AMM slippage bounds.
6. Any quote or share remainder returns to the Boardroom treasury.

## Wind-Down And Redemption Flow

1. Governance registers ERC20 assets that should be redeemable. Canonical WHYPE is already registered during
   initialization, so raw native HYPE and WHYPE received later cannot be omitted from the basket.
2. Before launch, the owner calls `startWindDown`. After launch, any current share holder can call `startWindDown`.
   The call wraps the Boardroom's full native HYPE balance into WHYPE before moving from `Active` to `WindingDown`.
3. Governance closes, cancels, or migrates every recorded distribution and halts or expires every recorded grant.
4. Governance exits every recorded locked-liquidity position.
5. Governance calls `openRedemptions`, which wraps any native HYPE received after wind-down started.
6. `openRedemptions` prunes closed obligations from the bounded active lists, verifies every remaining obligation is
   still a blocker, burns treasury-held shares, and moves the Boardroom to `RedemptionsOpen`. Closure events and the
   permanent `obligationPolicyOf` binding retain history after an item leaves an active list.
7. A share holder calls `redeem(shares, recipient, minAmountsOut)`.
8. The Boardroom wraps any late native HYPE balance, burns and forfeits any shares currently held by the Boardroom, then
   burns the caller's shares into credits owned by that caller. `recipient` only selects the payout address and never
   owns the credits.
9. Each asset is attempted independently with bounded gas. Its amount uses full-precision multiplication over the
   current unallocated balance, the caller's unallocated burned shares, and that asset's remaining entitlement shares.
   This preserves failed claims and allocates deposits received after earlier claims among the shares still waiting.
10. A successful nonzero asset payout records its allocated shares before making an exact-delta transfer. A zero or
    rounded-to-zero amount, reverting token, sender surcharge, or unmet per-asset minimum returns zero for that slot and
    emits `RedemptionAssetClaimFailed`; it does not revert the share burn or successful assets in the same basket, and
    it leaves the credit available for later funding or retry.
11. The credit owner retries a failed slot with
    `claimRedemptionAsset(asset, recipient, minAmountOut)`. An asset cannot allocate the same burned shares twice.

Redemption loops are bounded by `MAX_REDEEMABLE_ASSETS`. Wind-down gates are bounded by active, rather than lifetime,
counts: `MAX_ISSUED_GRANTS`, `MAX_ISSUED_DISTRIBUTIONS`, and `MAX_LOCKED_LIQUIDITY_POSITIONS`. Successful lifecycle
calls prune newly closed items immediately, and anyone may call `pruneClosedObligations()` for items closed through
their own public lifecycle.

## Invariants

- Only the Boardroom can mint its share token.
- Only the Boardroom can burn its share token.
- Only the Boardroom owner can mint shares before launch; after launch, minting must be a queued self-call.
- Shares cannot be minted after wind-down starts.
- Direct owner execution is disabled after launch.
- Only the current executor can queue actions after launch; any caller can execute a ready action or batch.
- Queued actions cannot execute before their ETA.
- Governance delay is nonzero and no greater than 30 days.
- Any current share holder can cancel a queued action and can start wind-down after launch.
- New policy-backed Boardroom execution requires a policy allowed by the central registry.
- Policy-backed Boardroom execution requires the selected policy to allow the target, value, and calldata.
- Registered module identity is permanent across `Active`, `LifecycleOnly`, and `Disabled` status.
- Calls to registered module targets must use that module as the policy even after it is disabled.
- Every recorded obligation permanently binds to one canonical policy; raw and wrong-policy lifecycle calls fail.
- Canonical lifecycle cleanup remains available after central disable, and `isPolicyLifecycleAllowed` reflects this
  permanent cleanup capability for registered modules.
- Obligation-creation and lifecycle hooks fail closed; plain asset-policy calls do not invoke them.
- Boardroom execution cannot create new obligations after wind-down starts.
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
- Closed obligations are removed from active capacity without erasing their canonical-policy history.
- Raw native HYPE is never redeemed directly.
- Canonical WHYPE is a redeemable asset from initialization onward.
- `startWindDown()` wraps native HYPE before `status` changes to `WindingDown`.
- `openRedemptions()` and `redeem()` wrap any late native HYPE balance before redemption pricing.
- Treasury-held shares are burned before redemptions open.
- Shares sent to the Boardroom after redemptions open are burned before the next redemption is priced.
- Share redemption burns shares into caller-owned per-asset credits before attempting transfers.
- One failing redeemable asset cannot block successful assets, and its allocation remains retryable.
- Redemption multiplication is full precision and each asset's burned-share allocation is single-use.
- Fee-on-transfer and sender-surcharge redeemable assets fail safely through exact Boardroom and recipient balance-delta
  checks without discarding their failed claims.

## Deterministic Proof

```sh
bun --cwd packages/contracts build
bun --cwd packages/contracts test
cd packages/contracts && forge fmt --check
```
