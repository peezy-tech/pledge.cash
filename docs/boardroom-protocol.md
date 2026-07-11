# Boardroom Protocol

This document describes the first Boardroom primitive in `packages/contracts/src/boardroom/Boardroom.sol`,
`BoardroomFactory.sol`, and `BoardroomToken.sol`.

A Boardroom is an owned on-chain treasury and issuer account with its own ERC20 share token. Before launch, its owner
can mint shares and execute policy-checked calls directly. After launch, the Boardroom moves to delayed push-forward
governance: the current executor queues delayed actions, historically checkpointed share holders can veto or start
wind-down at explicit thresholds, and anyone may execute a live action after its delay. `AssetPolicy` covers supported
external assets and spender approvals, while obligation-creating protocol modules such as `TokenGrantFactory`,
`DistributionFactory`, and `LockedLiquidityFactory` act as their own call policies so the Boardroom can record created
obligations.

## Actors

- Boardroom owner: controls share minting and policy-authorized treasury execution before launch.
- Executor: queues delayed governance actions after launch. This can be an EOA, multisig, or governance contract;
  execution becomes permissionless when an action is ready.
- Boardroom: owns assets, creates its share token, and acts as grant issuer.
- Policy registry: protocol-governance-controlled registry of call status plus permanent module identity. Disabling a
  module blocks new obligations without erasing the cleanup authority of obligations it already created.
- Module policies: pledge.cash factories that authorize their own Boardroom calls and report created obligations.
- Asset policy: protocol-governance-managed allowlist of supported assets and approval spenders. A Boardroom owner uses
  the policy but does not administer the canonical root policy merely by owning a Boardroom.
- Share holder: receives Boardroom share tokens directly or through grants. A holder with at least 1% of both the
  previous-block and current governance-eligible supply can cancel an action; 10% can start wind-down. Same-transaction
  flash balances, already-transferred stale balances, treasury shares, and shares inside authenticated protocol custody
  are ineligible.
- Grant holder: receives settlement authority over a Boardroom-issued grant.
- Distribution buyer: buys Boardroom shares through a Boardroom-created distribution.

## Assets

- Boardroom share token: ERC20 minted only by its Boardroom.
- Grant token escrow: ERC20 tokens held by the Boardroom and transferred into a `TokenGrant`.
- Payment token: optional ERC20 paid to the Boardroom when settling a paid grant.
- Distribution payment token: ERC20 paid to the Boardroom when buyers purchase shares from a distribution.
- Redeemable asset: ERC20 registered by Boardroom governance for pro-rata redemption after wind-down.
- Native gas token: never redeemable directly. Any native balance held by the Boardroom is deposited into the
  deployment's canonical wrapped-native contract when wind-down starts.
- Wrapped native: canonical ERC20 representation of the chain's native gas token for treasury accounting and
  redemptions. Every Boardroom registers its factory's configured wrapped-native token as the first redeemable asset
  during initialization. Examples are HYPE/WHYPE on HyperEVM and MON/WMON on Monad; the protocol logic is chain-agnostic.

## State Machines

### BoardroomFactory

`BoardroomFactory` creates deterministic Boardroom clones and records them. The clone salt is bound to the Boardroom
owner, share token name, share token symbol, and caller-provided salt.

State:

- `policyRegistry`: policy registry used by every Boardroom clone.
- `boardroomLogic`: implementation cloned by the factory.
- `redemptionPayoutLogic`: immutable delegate helper used by every clone for isolated redemption accounting, exact
  transfers, native wrapping, treasury-share burning, and active-obligation pruning. Callers cannot select this target.
- `governanceLogic`: immutable delegate helper for action context, historical-holder checks, bounded asset admission,
  obligation bookkeeping, and wind-down finalization. Both helpers are injected into the factory, must contain code,
  and can be deployed and attested independently before the factory.
- `allBoardrooms`: created Boardroom list.
- `isBoardroom`: created Boardroom membership check.

### Boardroom

`Boardroom` has one owner, one policy registry, one canonical wrapped-native token, one share token, and a wind-down
status.

State:

- `policyRegistry`: protocol-governance-controlled registry of allowed call policies.
- `wrappedNative`: chain-specific canonical wrapped-native contract used to normalize raw native value before
  redemptions.
- `shareToken`: ERC20 minted only by this Boardroom.
- `launched`: one-way flag that disables direct owner execution and enables queued governance.
- `executor`: account allowed to queue delayed actions after launch.
- `governanceDelay`: delay applied to every queued action after launch.
- governance action context: ETA, seven-day execution grace period, governance epoch, and Boardroom status captured for
  every queued single-call or batch hash.
- `status`: `Active`, `WindingDown`, or `RedemptionsOpen`.
- `redeemableAssets`: bounded list of ERC20 assets redeemed pro-rata by share holders.
- `issuedGrants`: bounded active list of Boardroom-issued token grants created through `TokenGrantFactory`.
- `issuedGrantSlotReservations`: grant slots reserved by recorded distributions that can create Boardroom-issued grants.
- `issuedDistributions`: bounded active list of Boardroom-created distributions created through `DistributionFactory`.
- `lockedLiquidityPositions`: bounded active list of Boardroom-owned locked AMM liquidity positions.
- `obligationPolicyOf`: permanent canonical-policy identity for every obligation ever recorded. Active-array pruning
  never erases this binding.
- redemption snapshot: fixed per-asset balances and total share supply captured after treasury shares burn when
  redemptions open. Governance-only custody exclusions do not change economic redemption supply.
- redemption credits: burned shares retained per holder until each snapshot asset has allocated and paid that holder's
  corresponding entitlement.
- `redemptionExcessRecipient`: fixed recipient for post-snapshot deposits and terminally unowed snapshot balances. It
  defaults to the prelaunch owner, follows prelaunch ownership transfers, can be governed while active, and freezes
  once redemptions open.

The owner can mint shares through `Boardroom.mint` before launch. The owner can also call `Boardroom.execute` or
`Boardroom.executeBatch` before launch. Each call names a policy, target, native value, and calldata. Raw calls may omit
the policy only when the target is the Boardroom itself. Every external target requires an explicit registered policy;
calls to a registered pledge.cash module must use that module even when its current status is disabled.
Module identity is one-way and independent of `Active`, `LifecycleOnly`, or `Disabled` status, so disabling a module
cannot reopen a raw-call bypass. New module calls require active status. Calls to a recorded obligation must use its
permanent canonical policy, and only selectors approved by that policy's lifecycle hook may run. This cleanup route
continues to work after the central registry disables the module.

Obligation hooks are fail-closed: a registered module must successfully report the obligation created by a call, and a
lifecycle hook must successfully classify cleanup and reservation release. A reverting or malformed hook reverts the
entire call. Plain policies such as `AssetPolicy` do not implement or invoke obligation hooks.

After launch, owner-only functions that affect treasury or shares must be called by the Boardroom itself through a
queued action. Launch requires at least one whole governance-eligible share outside the Boardroom treasury and
authenticated protocol custody. The current executor queues a
single call or batch with a salt. The action becomes executable by any caller after `governanceDelay`, which is between
one and 30 days, and expires seven days after its ETA. Executor changes and wind-down advance the governance epoch, so
pre-existing actions fail even if their calldata and salt are replayed. Threshold checks require both current and
previous-block holder balances to meet the stricter threshold computed from current and previous-block
governance-eligible supply.

Wind-down transitions are one-way:

1. `Active`: before launch, the owner can mint shares, create grants, create distributions, and register redeemable
   assets. After launch, those actions must go through queued self-governance.
2. `WindingDown`: entered only after `startWindDown()` wraps the Boardroom's full native balance. The
   Boardroom cannot mint shares or create new grants/distributions. Canonical zero-value lifecycle calls, locked
   liquidity exits, native wrapping, closed-obligation pruning, and treasury-share burns are permissionless. Qualified
   holders can admit final assets only when the Boardroom already has a positive balance, and anyone can quarantine an
   admitted asset whose bounded `balanceOf` probe has become unreadable. Empty-asset removal is permissionless during
   wind-down only after every grant, distribution, and locked-liquidity obligation has closed and been pruned, so an
   obligation cannot later return value into an omitted asset.
   Active fixed-price sales and migrating bonding curves stop accepting trades as soon as their Boardroom enters this
   state.
3. `RedemptionsOpen`: share holders burn shares against the fixed opening snapshot. Each asset pays independently and
   failed snapshot claims remain retryable. Late deposits never change redemption economics and are permissionlessly
   swept to the frozen excess recipient. Owner execution is closed.

### BoardroomToken

`BoardroomToken` is an ERC20 with immutable `boardroom` authority and direct balance, total-supply, and aggregate
encumbered-supply checkpoints. Only the Boardroom can mint, burn, or permanently classify an authenticated custody
account. Canonical share grants, distributions, locked-liquidity pools, and their fee vaults are classified when their
obligation is recorded; token transfers then update the aggregate in O(1), including transfers between two classified
accounts without double counting. Checkpoint lookup is logarithmic and only permits completed blocks. This custody
accounting affects governance power only, not redemption ownership.

## Grant Issuance Flow

1. Boardroom governance ensures the treasury holds the ERC20 token to be granted.
2. Governance builds a two-call batch. The owner executes it directly before launch; after launch the executor queues it
   and anyone may execute it once ready.
3. The first call targets the grant token and approves `TokenGrantFactory` for the grant amount through `AssetPolicy`.
4. The second call targets `TokenGrantFactory.createGrant(...)` through `TokenGrantFactory` as the policy, optionally
   forwarding the exact native creation fee.
5. `TokenGrantFactory` creates a grant where `issuer == boardroom`.
6. `TokenGrantFactory` transfers the grant tokens from the Boardroom into the grant escrow.
7. The factory mints the grant-right ERC721 token to the grant holder.

Every non-share grant token and every paid-grant settlement token is atomically, permanently admitted to the bounded
redemption basket when the grant is recorded. This covers both settlement revenue and grant assets that can return on
halt, expiry, or quarantine recovery. Distribution payment and curve quote assets are admitted the same way by their
module factories. While active, Boardroom governance can use registry-approved policies to deploy or spend proceeds:
directly by the owner before launch or through a queued action after launch.

## Fixed-Price Share Sale Flow

1. Boardroom governance mints shares to the Boardroom treasury.
2. Governance builds a two-call policy-checked batch, executed directly by the owner before launch or queued by the
   executor after launch.
3. The first call targets the share token and approves `DistributionFactory` for the sale inventory through
   `AssetPolicy`.
4. The second call targets `DistributionFactory.createFixedPriceSale(...)`.
5. `DistributionFactory` verifies the sale uses the Boardroom's own share token.
6. The factory deploys and records a `FixedPriceSale`.
7. The factory transfers sale inventory from the Boardroom into sale escrow.
8. Buyers pay the configured ERC20 payment token directly to the Boardroom and receive shares from sale escrow.
9. The Boardroom can close or cancel its own sale through `DistributionFactory` as the policy.

## Migrating Bonding Curve Flow

1. Boardroom governance mints shares to the Boardroom treasury.
2. Governance builds a batch that approves `DistributionFactory` and calls `createMigratingBondingCurve`; the owner
   executes it before launch or the executor queues it after launch.
3. Buyers buy shares from the curve while the Boardroom is active. Sellers can sell curve-issued shares back while the
   Boardroom is active.
4. Once the quote reserve reaches the graduation target or sellable inventory is gone, governance can migrate the curve
   through `Boardroom.execute` before launch or a queued action after launch.
5. Migration creates Boardroom-owned locked AMM liquidity through `LockedLiquidityFactory` and records the locker on the
   Boardroom. The Boardroom-controlled call supplies the AMM slippage bounds.
6. Any quote or share remainder returns to the Boardroom treasury.

## Wind-Down And Redemption Flow

1. The canonical wrapped-native token is admitted at initialization. Module factories atomically admit any asset that
   can later reach the Boardroom, and governance can admit additional ERC20s only after a bounded exact-size
   `balanceOf` probe succeeds;
   during wind-down the probed Boardroom balance must also be nonzero.
2. Before launch, the owner starts wind-down. After launch, a holder meeting the 10% historical/current threshold can
   start it even if the executor is lost. The transition is monotonic, wraps native value, and invalidates queued actions.
3. Anyone can execute canonical zero-value lifecycle cleanup, prune closed obligations, exit recorded liquidity, wrap
   native balance, and burn treasury shares. Empty assets can be removed once no obligation remains; unreadable admitted
   assets can be quarantined through the explicit liveness escape hatch.
4. After the governance delay from wind-down start, anyone can call `openRedemptions`. It wraps native value, prunes and
   rejects any remaining obligation, burns treasury shares, and snapshots total supply plus every admitted balance.
5. A holder calls `redeem(shares, recipient, minAmountsOut)`. Shares burn into caller-owned credits; `recipient` only
   selects the payout address.
6. Each asset is attempted independently with bounded gas. Its full-precision amount uses only the remaining opening
   snapshot balance and remaining entitlement shares. A failed transfer or unmet minimum leaves that asset credit
   retryable. A zero-rounded amount with a zero minimum succeeds and allocates the shares, allowing the final claimant to
   receive the indivisible remainder instead of deadlocking it.
7. The credit owner retries with `claimRedemptionAsset`. An asset cannot allocate the same burned shares twice.
8. Deposits received after opening are never owed to redeemers. Anyone can sweep only balance above the still-owed
   snapshot amount to the frozen `redemptionExcessRecipient`. When all shares for an asset are paid or forfeited, any
   remaining snapshot balance also becomes sweepable.

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
- Queued actions bind their epoch and status, cannot execute before ETA, and expire seven days after ETA.
- Governance delay is at least one day and no greater than 30 days.
- Executor changes and wind-down invalidate every action from the prior epoch.
- Veto requires 1% and wind-down requires 10% of governance-eligible shares, using the larger current/prior threshold
  and requiring the caller to hold it both now and in the previous block.
- Same-transaction borrowed balances, stale transferred balances, treasury-held shares, and shares in authenticated
  grants, distributions, pools, or fee vaults do not satisfy thresholds.
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
- Policy-free raw calls can only target the Boardroom itself; external raw-call escape is closed.
- Asset approvals are limited to allowed assets and allowed protocol spenders.
- Boardroom-created grants approve `TokenGrantFactory` as spender for the requested grant amount through `AssetPolicy`.
- A Boardroom-issued grant must have `issuer == boardroom`.
- Boardroom-issued grants escrow tokens from the Boardroom before holders can settle.
- Native grant creation fees flow to `TokenGrantFactory.feeRecipient()`, independently of factory ownership. A bespoke
  deployment may select a Boardroom recipient, in which case raw native balance is normalized into wrapped native on
  wind-down; the canonical root deployment configuration routes fees through the durable protocol fee router instead.
- Boardroom-created fixed-price sales can only sell the Boardroom's own share token.
- Boardroom-created migrating curves can only sell the Boardroom's own share token.
- Fixed-price sale payments are transferred directly to the Boardroom treasury.
- Fixed-price sale purchases stop once the creating Boardroom starts wind-down.
- Migrating curves stop buy and sell trades once the creating Boardroom starts wind-down.
- Curve migration can only record locked liquidity for a Boardroom that issued that curve.
- Only the Boardroom that created a distribution can close, cancel, or migrate it through the distribution policy.
- Redemptions cannot open while a recorded grant or distribution is still open.
- Redemptions cannot open while a recorded locked-liquidity position still holds LP principal.
- A lost executor cannot stop qualified holders from starting wind-down or stop anyone from running bounded canonical
  cleanup and finalization after the delay.
- Closed obligations are removed from active capacity without erasing their canonical-policy history.
- Raw native value is never redeemed directly.
- The configured canonical wrapped-native token is a redeemable asset from initialization onward.
- `startWindDown()` wraps native value before `status` changes to `WindingDown`.
- `openRedemptions()` fixes per-asset balances and supply. Native value arriving later is wrapped but remains excess.
- Treasury-held shares are burned before redemptions open.
- Shares sent to the Boardroom after redemptions open are burned before the next redemption is priced.
- Share redemption burns shares into caller-owned per-asset credits before attempting transfers.
- One failing redeemable asset cannot block successful assets, and its allocation remains retryable.
- Redemption multiplication is full precision, each asset's burned-share allocation is single-use, and zero-rounded
  allocations advance accounting when the caller permits zero output so indivisible dust cannot remain reserved forever.
- Post-snapshot deposits cannot dilute or enrich any redemption; only excess above outstanding snapshot obligations can
  be swept to the frozen recipient.
- Once all snapshot shares are paid or forfeited, no remaining asset balance can be trapped as a phantom obligation.
- Ownership cannot be renounced, and the excess recipient cannot be changed after redemptions open.
- Fee-on-transfer and sender-surcharge redeemable assets fail safely through exact Boardroom and recipient balance-delta
  checks without discarding their failed claims.

## Deterministic Proof

```sh
bun --cwd packages/contracts build
bun --cwd packages/contracts test
cd packages/contracts && forge fmt --check
```
