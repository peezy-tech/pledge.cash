# AMM And Locked Liquidity Protocol

This document describes the AMM and Boardroom-owned locked liquidity primitives in:

- `packages/contracts/src/amm/AmmFactory.sol`
- `packages/contracts/src/amm/AmmPool.sol`
- `packages/contracts/src/amm/PoolFees.sol`
- `packages/contracts/src/amm/AmmRouter.sol`
- `packages/contracts/src/fees/ProtocolFeeRouter.sol`
- `packages/contracts/src/liquidity/LockedLiquidityFactory.sol`
- `packages/contracts/src/liquidity/LockedLiquidity.sol`

## Actors

- Liquidity provider: transfers ERC20 tokens into a pool and receives ERC20 LP tokens.
- Trader: sends exact-input swaps through the router or directly to a pool.
- Boardroom: can seed one locked LP position per pool through `LockedLiquidityFactory`.
- Locked liquidity locker: holds a Boardroom-owned LP position, forwards LP fees to the Boardroom, and exits principal only during Boardroom wind-down.

## Assets

- Pool reserves: the two ERC20 tokens held by `AmmPool`.
- LP swap fees: the LP share of the `30 bps` swap input fee, segregated into the pool's `PoolFees` vault and indexed to LP token holders.
- Protocol swap fees: optional protocol share of the swap fee, paid to the factory's governance-controlled recipient. The
  canonical deployment uses `ProtocolFeeRouter`, whose treasury destination remains rotatable across Boardroom
  wind-downs.
- LP principal: ERC20 LP tokens minted by the pool. Boardroom-owned principal sits inside a `LockedLiquidity` clone.
- Native gas token: supported only through `AmmRouter` and its immutable wrapped-native token.

Pools support standard, non-rebasing ERC20 tokens whose transfers debit and credit the requested amount exactly. Tokens
with transfer taxes, sender surcharges, rebases, balance-changing hooks, or mutable transfer behavior are outside the
supported set. Router inputs and locked-liquidity funding enforce exact receipt, and fee-manager excess recovery also
requires exact sender and recipient deltas. A negative rebase is rejected with `BalanceBelowReserve`; it cannot be
silently synchronized into LP accounting.

`AmmFactory.owner()` is protocol governance. Governance may rotate the protocol fee recipient and the operational fee
manager independently. The fee manager can reconcile untracked pool balances but cannot redirect protocol revenue.
When the recipient is unset, all swap fees accrue to LPs. Canonical deployments set it to `ProtocolFeeRouter`, and
`PROTOCOL_FEE_SHARE_BPS` of each nominal swap fee is transferred there. Anyone may forward a router-held token or native
balance to its current treasury; only router governance may rotate that treasury.

The nominal swap fee rounds up. Consequently, splitting one input across smaller swaps cannot reduce the total nominal
fee. The pool carries both protocol-share division remainders and LP-index numerator remainders forward so repeated
small swaps cannot systematically escape either allocation.

## State Machines

### Pool

1. Uninitialized clone.
2. Initialized with sorted token pair, fee vault, empty reserves, and initial TWAP observation.
3. Active pool where liquidity can be added, removed, swapped, and fee claims can be pulled by LP holders.

The factory creates exactly one pool for each sorted pair.

Before a Boardroom locker funds an empty pool, `LockedLiquidityFactory` reserves that pair's initial mint in
`AmmFactory`. The reservation binds the expected initializer and LP recipient to the predicted locker. Only the
canonical `AmmRouter` may consume a reservation, and consumption occurs inside the pool's first mint so any later
failure restores it atomically.

### Locked Liquidity

1. Uninitialized clone.
2. Initialized for one Boardroom, router, and token pair.
3. Seeded once through the factory. LP tokens are held by the locker.
4. Active fee-claiming phase. Principal remains locked.
5. Boardroom wind-down exit. The locker claims fees, removes all LP it owns, and sends underlying tokens to the Boardroom.
6. Closed locker may be pruned from the factory's bounded active list. Its permanent locker, Boardroom, and pool identity
   mappings remain intact.

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
- for Boardroom-owned locked liquidity, each minimum is at least `95%` of its corresponding desired amount,
- token transfers arrive exactly.

Effects:

- router creates the pool if needed,
- tokens move into the pool,
- pool mints LP tokens to the recipient,
- first mint permanently locks `MINIMUM_LIQUIDITY` to `address(1)`.

If an initial-liquidity reservation exists, the router also proves the real token payer to the pool. Direct pool mints,
router calls funded by another account, and mints to another recipient all revert. Unreserved pools retain the public
first-liquidity flow.

Fee-on-transfer seed tokens are rejected by exact balance-delta checks.

The locked-liquidity factory reserves an empty pool before pulling seed assets and enforces the two-sided `5%` maximum
seed slippage in contract, including migrations from a bonding curve. A permissionless caller may pre-create the
canonical pair, but cannot take the first mint after reservation. If a pool is already initialized, a hostile reserve
ratio cannot reduce either Boardroom contribution below the configured bounds; the transaction reverts atomically
instead. Token donations can still delay a reserved initialization until the fee manager recovers them, so the
reservation is an ownership-integrity guarantee rather than an availability guarantee.

### Swap

Preconditions:

- output amount is nonzero,
- output amount is less than reserves,
- exact input has arrived before the pool invariant check.

Effects:

- pool optimistically transfers output,
- optional callback runs,
- pool measures input by balance delta,
- the `30 bps` nominal fee, rounded up, is removed from reserves,
- the protocol share, if configured, is transferred to the protocol fee recipient,
- the LP share is moved to `PoolFees`,
- LP fee index for the input token advances by the actual amount received by `PoolFees`,
- adjusted reserves must preserve or increase `x*y`,
- reserve and cumulative price state update.

Multi-pool cyclic paths are supported, including routes whose final token equals their input token. The router measures
the recipient's final-token balance only after the initial input transfer, so reported output is the gross cycle output
rather than the recipient's net balance change. Each pool may appear at most once in a route, because quoting a reused
pool against its pre-swap reserves would be ambiguous.

### Transfer Or Burn LP Tokens

Unclaimed LP fee entitlement travels pro rata with ordinary LP-token transfers. A temporary LP holder therefore cannot
hold borrowed LP during its own swap, return the same LP, and retain the fees generated during the loan. A transfer of
LP into its own pool for removal is treated differently: accrued entitlement remains claimable by the liquidity owner
after the LP is burned. Incoming entitlement and fee accrual after a same-block LP receipt remain pending until a later
block. Existing mature entitlement stays claimable, so transferring one dust LP unit cannot freeze a holder's earlier
fees; a flash borrower also cannot claim the lender's historical entitlement before returning the LP.
If LP received in the current block is burned, its proportional pending entitlement is forfeited and re-indexed across
the post-burn LP supply. This prevents a just-in-time provider from minting, generating its own swap fee, removing the
liquidity, and claiming that pending fee later; mature fees on older liquidity remain claimable after a burn.

### Recover Or Synchronize Excess Balances

Only the factory's current fee manager can call the explicit positive-balance reconciliation functions:

- `recoverExcess(recipient)` transfers exactly the two excess amounts without changing reserves;
- `syncExcess()` incorporates the current positive excess into reserves, subject to the `uint112` reserve cap.

Neither function permits a balance below its recorded reserve, recovery rejects inexact token transfers, and
`syncExcess` is unavailable before the first LP supply exists. These functions are best-effort operational tools, not
custody for accidental transfers. Because mint and swap infer input from raw pool balance deltas, any untracked balance
can be consumed permissionlessly before the fee manager recovers it. Never transfer assets to a pool outside an atomic
router or pool interaction with the expectation that they remain recoverable.

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

### Prune Closed Lockers

Anyone may call `LockedLiquidityFactory.pruneClosedLockers(boardroom)` to remove zero-principal lockers from the
factory's bounded active list. Creation also performs this bounded pruning before enforcing capacity. Pruning never
clears `isLocker`, `lockerBoardroom`, or `lockerForBoardroomPool`, so historical identity and the one-locker-per-pool
rule remain permanent even though active capacity is restored.

## Bounds

- `AmmRouter.MAX_SWAP_PATH_LENGTH` bounds swap path loops.
- `AmmPool.MAX_SAMPLE_POINTS` bounds TWAP sample output size.
- `LockedLiquidityFactory.MAX_LOCKERS_PER_BOARDROOM` bounds active lockers recorded by the factory; zero-principal
  lockers can be pruned permissionlessly or during the next creation.
- `Boardroom.MAX_LOCKED_LIQUIDITY_POSITIONS` bounds wind-down locker checks.
- Boardroom batch execution remains bounded by `Boardroom.MAX_BATCH_CALLS`.

`AmmPool.sample` locates observations with binary search, so lookup cost grows logarithmically with history. It rejects
windows older than the first recorded observation rather than fabricating a partial-history average. Observation order
uses full `uint64` timestamps across the year-2106 `uint32` rollover; the legacy timestamp returned by `getReserves`
and each `observations` entry deliberately remains the low 32 bits for API compatibility. Full ordered timestamps are
available through `observationTimestampAt`. Inputs are also bounded so `points * window` fits `uint64`.

When reserves change more than once at one timestamp, the pool overwrites that timestamp's latest observation instead
of leaving the earlier reserve snapshot in place. This includes the initial mint, which replaces the initializer's
zero-reserve checkpoint and prevents a later sample from treating seeded history as zero-priced.

Each reserve is capped at `type(uint112).max` raw token units. Quote, liquidity, burn, fee, and sample arithmetic uses
full-precision multiply/divide where user-controlled multiplication could otherwise overflow before the cap is checked.

## Invariants

- one pool exists per sorted token pair,
- pool reserves equal pool token balances after fees are moved to `PoolFees` and the protocol recipient,
- LP fee claims cannot exceed `PoolFees` balances,
- protocol fee routing and the operational fee manager can be rotated only by factory governance,
- reserved initial liquidity can be minted only through the canonical router by the expected payer to the expected LP
  recipient, and reservation consumption is atomic with the mint,
- ordinary LP transfers move unclaimed fee entitlement pro rata with the LP balance,
- same-block incoming and newly accrued entitlement is pending while existing mature fees remain claimable,
- LP sent into the pool for burning leaves already accrued fees claimable by its former owner,
- nominal swap fees round up and division remainders carry forward,
- pending fees forfeited by a same-block LP burn are redistributed across the remaining supply,
- locked Boardroom LP principal remains in the locker while the Boardroom is active,
- pruning restores active locker capacity without erasing permanent locker identity,
- Boardroom redemptions cannot open while any recorded locker still holds LP,
- token inputs must arrive exactly, rejecting fee-on-transfer behavior,
- native flows unwrap only the router's immutable wrapped-native token.
- native-output flows reject the zero address as recipient.
- untracked pool balances are public swap or mint inputs until the fee manager recovers or synchronizes them.
- an uninitialized pool cannot synchronize donations into one-sided or otherwise unusable reserves.

## Local Proof

```sh
bun --cwd packages/contracts test --match-contract 'AmmTest|AmmInvariantTest|LockedLiquidityTest'
```
