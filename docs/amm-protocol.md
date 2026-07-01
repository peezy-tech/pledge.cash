# AMM And Locked Liquidity Protocol

This document describes the AMM and Boardroom-owned locked liquidity primitives in:

- `packages/contracts/src/AmmFactory.sol`
- `packages/contracts/src/AmmPool.sol`
- `packages/contracts/src/PoolFees.sol`
- `packages/contracts/src/AmmRouter.sol`
- `packages/contracts/src/LockedLiquidityFactory.sol`
- `packages/contracts/src/LockedLiquidity.sol`

## Actors

- Liquidity provider: transfers ERC20 tokens into a pool and receives ERC20 LP tokens.
- Trader: sends exact-input swaps through the router or directly to a pool.
- Boardroom: can seed one locked LP position per pool through `LockedLiquidityFactory`.
- Locked liquidity locker: holds a Boardroom-owned LP position, forwards LP fees to the Boardroom, and exits principal only during Boardroom wind-down.

## Assets

- Pool reserves: the two ERC20 tokens held by `AmmPool`.
- LP swap fees: the LP share of the `30 bps` swap input fee, segregated into the pool's `PoolFees` vault and indexed to LP token holders.
- Protocol swap fees: optional protocol share of the swap fee, paid directly to the factory's one-way protocol fee recipient.
- LP principal: ERC20 LP tokens minted by the pool. Boardroom-owned principal sits inside a `LockedLiquidity` clone.
- Native gas token: supported only through `AmmRouter` and its immutable wrapped-native token.

`AmmFactory.setProtocolFeeRecipient` can be called once by the deploying fee manager. When unset, all swap fees accrue
to LPs. When set, `PROTOCOL_FEE_SHARE_BPS` of each nominal swap fee is transferred directly to the protocol recipient,
and the remainder is transferred to `PoolFees` for LP claims.

## State Machines

### Pool

1. Uninitialized clone.
2. Initialized with sorted token pair, fee vault, empty reserves, and initial TWAP observation.
3. Active pool where liquidity can be added, removed, swapped, and fee claims can be pulled by LP holders.

The factory creates exactly one pool for each sorted pair.

### Locked Liquidity

1. Uninitialized clone.
2. Initialized for one Boardroom, router, and token pair.
3. Seeded once through the factory. LP tokens are held by the locker.
4. Active fee-claiming phase. Principal remains locked.
5. Boardroom wind-down exit. The locker claims fees, removes all LP it owns, and sends underlying tokens to the Boardroom.

### Boardroom

The Boardroom records lockers created while active. During wind-down, it may call `claimFees` through the locker policy or call `exitLockedLiquidity` directly. Redemptions cannot open while any recorded locker still reports locked LP principal.

## Public Flows

### Create Pool

Preconditions:

- token addresses are nonzero and distinct,
- no pool exists for the sorted pair.

Effects:

- factory deploys a deterministic pool clone,
- pool initializes token ordering, fee vault, reserves, and first observation,
- factory records both token order mappings and pool validation state.

### Add Liquidity

Preconditions:

- caller approved the router,
- desired amounts satisfy min amount checks,
- token transfers arrive exactly.

Effects:

- router creates the pool if needed,
- tokens move into the pool,
- pool mints LP tokens to the recipient,
- first mint permanently locks `MINIMUM_LIQUIDITY` to `address(1)`.

Fee-on-transfer seed tokens are rejected by exact balance-delta checks.

### Swap

Preconditions:

- output amount is nonzero,
- output amount is less than reserves,
- exact input has arrived before the pool invariant check.

Effects:

- pool optimistically transfers output,
- optional callback runs,
- pool measures input by balance delta,
- `30 bps` fee is removed from reserves,
- the protocol share, if configured, is transferred to the protocol fee recipient,
- the LP share is moved to `PoolFees`,
- LP fee index for the input token advances by the actual amount received by `PoolFees`,
- adjusted reserves must preserve or increase `x*y`,
- reserve and cumulative price state update.

### Create Boardroom Locked Liquidity

The Boardroom owner executes a batch:

1. approve `LockedLiquidityFactory` for the Boardroom share token,
2. approve `LockedLiquidityFactory` for the quote token,
3. call `createLockedLiquidity`.

The factory policy only permits creation where one side is the Boardroom share token. The factory pulls exact seed amounts from the Boardroom to the locker, then asks the locker to add liquidity through the router. The Boardroom records the returned locker.

### Claim Locked LP Fees

The Boardroom may call `LockedLiquidity.claimFees` through policy while active or winding down. The locker claims its LP fees from the pool and forwards token balances to the Boardroom.

### Exit Locked LP

During `WindingDown`, the Boardroom owner calls `exitLockedLiquidity`. The Boardroom:

1. verifies the locker was recorded,
2. asks the locker to claim fees and remove all LP it owns,
3. registers non-share token sides as redeemable assets,
4. burns Boardroom-held share tokens,
5. emits the exit event.

Redemptions can open only after all recorded lockers report zero locked LP. First-liquidity dust can remain in the pool because `MINIMUM_LIQUIDITY` is permanently locked.

## Bounds

- `AmmRouter.MAX_SWAP_PATH_LENGTH` bounds swap path loops.
- `AmmPool.MAX_SAMPLE_POINTS` bounds TWAP sample output size.
- `LockedLiquidityFactory.MAX_LOCKERS_PER_BOARDROOM` bounds lockers recorded by the factory.
- `Boardroom.MAX_LOCKED_LIQUIDITY_POSITIONS` bounds wind-down locker checks.
- Boardroom batch execution remains bounded by `Boardroom.MAX_BATCH_CALLS`.

`AmmPool.sample` still scans the pool observation history to find prior cumulative prices. It is a view helper and should not be used as an unbounded on-chain oracle dependency.

## Invariants

- one pool exists per sorted token pair,
- pool reserves equal pool token balances after fees are moved to `PoolFees` and the protocol recipient,
- LP fee claims cannot exceed `PoolFees` balances,
- protocol fee routing can only be configured once by the factory fee manager,
- LP transfers update sender and recipient fee indexes before balances move,
- locked Boardroom LP principal remains in the locker while the Boardroom is active,
- Boardroom redemptions cannot open while any recorded locker still holds LP,
- token inputs must arrive exactly, rejecting fee-on-transfer behavior,
- native flows unwrap only the router's immutable wrapped-native token.

## Local Proof

```sh
bun --cwd packages/contracts test --match-contract 'AmmTest|AmmInvariantTest|LockedLiquidityTest'
```
