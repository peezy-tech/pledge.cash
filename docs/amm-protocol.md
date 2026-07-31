# Uniswap v4 And Protocol-Owned Liquidity

This document describes the pledge.cash liquidity layer implemented by:

- `packages/contracts/src/uniswap/PledgeV4Hook.sol`
- `packages/contracts/src/uniswap/PledgeV4LiquidityFactory.sol`
- `packages/contracts/src/uniswap/PledgeV4LiquidityVault.sol`
- `packages/contracts/src/uniswap/PledgeV4LiquidityMath.sol`
- the canonical Uniswap v4 `PoolManager`

Uniswap v4 is the exchange engine. Boardroom policy remains the control plane. pledge.cash does not own a parallel AMM,
router, reserve ledger, or TWAP implementation.

## Deployment boundary

Every deployment pins these external contracts and records their code hashes:

- Uniswap v4 `PoolManager`;
- Universal Router;
- v4 Quoter;
- v4 StateView;
- v4 PositionManager;
- Permit2.

The pledge.cash deployment creates one hook, one liquidity-vault implementation, and one liquidity factory against those
addresses. A deployment is incomplete if any external address is missing, has no code, or does not match the promoted
artifact. Upgrading or replacing Uniswap infrastructure is a new protocol release, not an owner setting.

The current application supports ERC20 currencies only. Native input, wrapping, and unwrapping are deliberately disabled
until the Universal Router action plan explicitly covers them.

## Canonical identity

For each Boardroom, `PledgeV4LiquidityFactory` permits at most one permanent protocol-liquidity identity:

- one quote asset;
- one full Uniswap v4 `PoolKey` and `PoolId`;
- one deterministic P4LP vault;
- one full-range position owned by that vault.

Exactly one currency must be the Boardroom's canonical share token. The factory, vault, Boardroom, hook, PoolManager,
currencies, fee, tick spacing, and PoolId must agree. A v4 pool has no pair-contract address; product routes use the vault
address as their stable project-scoped handle and the PoolId as exchange identity.

Third parties may create other v4 pools or positions. They are ordinary Uniswap liquidity and do not become pledge.cash
obligations, P4LP backing, or Boardroom-owned liquidity.

## Hook

`PledgeV4Hook` enables only `beforeInitialize`. It accepts initialization only from the canonical pledge.cash liquidity
factory and only for the exact PoolKey currently authorized by that factory. This prevents an unrelated caller from
initializing a reserved pledge.cash PoolId with a conflicting starting price.

The hook does not implement swap math, dynamic fees, access-controlled trading, fee siphoning, or lifecycle governance.
Those concerns remain respectively in Uniswap v4, the fixed PoolKey, and the Boardroom/vault state machines.

The hook address encodes its permission bitmap, so deployment mines a CREATE2 salt only after the factory address is
known. The supported bitmap is `beforeInitialize` only.

## P4LP claims

The vault owns one full-range v4 liquidity position and issues ERC20 P4LP claims. One P4LP unit represents one unit of
position liquidity, so these invariants hold after every successful mutation:

```text
totalSupply(P4LP) == positionLiquidity
vault-held P4LP == protocol-owned portion
externally held P4LP == user claim portion
```

P4LP is not a Uniswap PositionManager NFT and is not a claim on third-party v4 positions. It is a lifecycle-bound claim
on one pledge.cash vault position.

## State machine

```text
Uninitialized -> Active -> Claims -> Closed
```

- `Uninitialized`: clone has no identity or position.
- `Active`: the canonical position exists; external deposits may add proportional liquidity and receive P4LP. Boardroom
  governance may remove only vault-held protocol claims and may collect fees.
- `Claims`: Boardroom wind-down can now finalize and prune the active-obligation gate. P4LP holders may burn claims for
  their proportional underlying assets. No new deposits are accepted.
- `Closed`: supply and position liquidity are zero. Identity remains permanent and cannot be replaced.

The Boardroom records the vault as its single liquidity obligation while it is Active and pre-registers the vault token
as a dependency. It also registers both the vault and the shared PoolManager as encumbered accounts in that Boardroom's
project-token contract. Project tokens held as v4 principal are therefore excluded from governance-eligible circulating
supply even though the PoolManager is a singleton. Redemptions cannot advance past the liquidity obligation. During
wind-down, exact exit or the no-underlying-call Claims transition makes the vault terminal for lifecycle purposes; a
separate close/finalize call synchronizes factory and Boardroom status and prunes the obligation.

## Create protocol liquidity

Boardroom governance executes approvals and `createProtocolLiquidity` through the liquidity-factory policy. The factory:

1. authenticates the calling Boardroom through `BoardroomFactory`;
2. verifies the share/quote pair and permanent singleton reservation;
3. sorts the ERC20 currencies and constructs the fixed 0.30% fee, tick-spacing-60 PoolKey;
4. authorizes and initializes the PoolId through the hook if needed;
5. deploys the deterministic vault;
6. transfers both assets exactly into the vault;
7. mints a full-range v4 position at the caller-bound initial `sqrtPriceX96`;
8. records the vault and PoolId in both the factory and Boardroom.

Desired amounts, per-token minimums, deadline, salt, and initial price are transaction-bound. Supported assets must have
exact sender and recipient balance deltas. Fee-on-transfer, rebasing, no-op, and mutable-transfer tokens are unsupported.

Curve migration supplies its terminal price explicitly. The realized position price must remain within 50 basis points
of that price; unused shares and quote return to the Boardroom.

## External deposits

While Active, anyone may deposit both currencies into the canonical vault. The vault uses current v4 state and its fixed
full-range ticks to calculate the proportional position increase, refunds unused desired amounts, and mints exactly the
added liquidity as P4LP to the chosen recipient.

Deposits cannot choose another PoolKey, tick range, hook, salt, or position owner. Both minimum amounts and a deadline
bound execution. An external deposit cannot mint or transfer the vault's protocol-owned claims.

## Swaps

Swaps use the deployed Universal Router's v4 command and Permit2:

1. approve the input ERC20 to Permit2;
2. approve the Universal Router in Permit2 with a bounded amount and expiration;
3. obtain an exact-input-single quote from the v4 Quoter for the canonical PoolKey;
4. submit the Universal Router v4 action sequence: exact-input-single, settle-all input, take-all output;
5. bind minimum output, recipient, and deadline.

The pledge.cash hook adds no swap callback. Execution price, tick crossing, protocol fees configured in Uniswap, and
third-party liquidity are therefore Uniswap behavior. The UI reads slot0 and active liquidity from StateView and never
interprets compatibility reserve fields as real reserves.

Uniswap v4 does not provide the old pledge.cash cumulative-price oracle. Current product surfaces show v4 spot and Quoter
output. Any future feature requiring manipulation-resistant historical pricing needs a separately reviewed oracle or
oracle hook; it must not infer a TWAP from spot.

## Fee policy

The PoolKey LP fee is fixed at 0.30%. When the vault collects fees from its own position:

- 5% goes to the deployment's protocol-fee recipient;
- 95% goes to the Boardroom while Active;
- after Claims begins, the non-protocol portion remains in the vault as P4LP backing.

This split applies only to fees earned by the vault's position. It is not 5% of every swap in the shared PoolId: fees
earned by third-party positions belong to those positions. Uniswap protocol fees, if enabled externally, are separate
and outside pledge.cash governance.

## Active removal

Boardroom governance may remove only liquidity represented by P4LP already held by the vault. User-owned P4LP cannot be
burned or diluted. Removed currency goes to the Boardroom, minimums and deadline are enforced, and the corresponding
vault-held claims are burned.

## Wind-down

During `WindingDown`, anyone may ask the Boardroom to resolve its canonical vault.

The normal path removes all position liquidity, sends both underlying currencies to the Boardroom, registers non-share
assets for redemption, burns returned treasury shares where required, and closes the empty vault.

The liveness fallback calls `releaseClaimsToBoardroom`. It performs no underlying-token transfer and does not collect
fees. Instead it:

- changes the vault to Claims;
- transfers the vault-held protocol P4LP to the Boardroom;
- leaves the already registered P4LP dependency available as a redeemable asset.

Anyone then calls the Boardroom close/finalize route. It marks the factory and Boardroom singleton Closed and prunes the
liquidity obligation even while external claims remain. Those external claims keep their independent vault redemption
route and do not block the Boardroom snapshot.

This means a reverting, gas-burning, taxed, or otherwise hostile underlying token cannot block the Boardroom snapshot.
P4LP holders can attempt proportional underlying redemption independently after Claims begins, while Boardroom holders
can receive the P4LP claim through the normal redemption ledger.

## External calls and reentrancy

The factory and vault call ERC20 contracts and the shared PoolManager. Exact balance-delta checks reject non-standard
asset movement. Mutating entry points are non-reentrant. PoolManager callbacks accept calls only from the configured
manager and only when a hash of the pending operation matches; unsolicited unlock callbacks fail closed.

## Bounds

- one canonical vault and PoolId per Boardroom;
- fixed full-range ticks derived from tick spacing;
- the initial square-root price must lie strictly inside those usable full-range ticks;
- positive position liquidity must fit `uint128`;
- public amount, price, minimum, and deadline inputs are checked before external effects;
- no public transition iterates over lifetime liquidity history;
- Boardroom batch execution remains bounded by its release policy;
- UI discovery and RPC hydration use explicit page and concurrency limits.

## Core invariants

- Boardroom policy controls protocol liquidity; the hook never becomes a second governance plane.
- Canonical PoolKey, PoolId, vault, Boardroom, factory, manager, and hook identities agree.
- Project tokens held by the vault or PoolManager remain excluded from governance-eligible supply.
- P4LP total supply always equals the vault position's liquidity.
- Active removal cannot consume externally held claims.
- Claims mode cannot be reopened and accepts no deposits.
- A hostile underlying cannot prevent the no-transfer wind-down fallback.
- Exact-transfer checks prevent silent accounting drift.
- v4 singleton balances or compatibility reserve fields are never treated as pair reserves.
- third-party v4 positions are not protocol-owned and receive no pledge.cash lifecycle guarantee.

## Local proof

```sh
bun --cwd packages/contracts test
bun --cwd packages/sdk test
bun --cwd apps/web test
```

The focused contract suite is `packages/contracts/test/uniswap/PledgeV4Liquidity.t.sol`.
