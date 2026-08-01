---
title: Uniswap v4 and liquidity integration
description: Canonical PoolKey verification, Universal Router swaps, P4LP claims, fee treatment, and Boardroom wind-down.
---

# Uniswap v4 and liquidity integration

Use the [protocol-liquidity specification](https://github.com/peezy-tech/pledge.cash/blob/main/docs/amm-protocol.md) and
`packages/contracts/src/uniswap/` for exact behavior. Uniswap v4 is the execution engine; Boardroom policy owns the
pledge.cash liquidity lifecycle.

## Verify identity

Do not look for a pair-contract address or reserves. Resolve a pair through `PledgeV4LiquidityFactory.poolIdFor`, then
verify all of the following:

- `vaultForPoolId(poolId)` and `positionOfBoardroom(boardroom)` identify the same vault;
- the vault reports that factory and Boardroom;
- its PoolManager, hook, currencies, fee, tick spacing, PoolId, and full-range ticks match the deployment;
- exactly one currency is the verified Boardroom share token;
- StateView slot0 and active liquidity are read for that PoolId.

The Boardroom share token registers the canonical vault and shared PoolManager as encumbered accounts. This excludes
project tokens held as v4 liquidity from governance-eligible circulating supply while preserving ordinary transfers
into and out of the singleton manager.

The vault address is the project-scoped route handle. PoolId is the Uniswap exchange identity. Third-party positions in
the same PoolId are not P4LP backing.

## Swap

The SDK and app use the v4 Quoter and Universal Router exact-input-single flow. The input ERC20 needs both an allowance
to Permit2 and a Permit2 allowance to the Universal Router. Bind amount out minimum, recipient, and deadline. Native
wrapping is not currently part of the action sequence, so use wrapped ERC20 input.

Use StateView `sqrtPriceX96` for spot display and the Quoter for executable output. The v4 client model exposes active
liquidity rather than synthetic pair reserves. No pledge.cash TWAP exists in the v4 generation.

## Deposit and redeem P4LP

External deposits go directly to the canonical vault while it is Active. Approve both ERC20s to the vault, bind desired
and minimum amounts plus a deadline, and receive one P4LP per unit of added position liquidity. Unused desired amounts
are refunded.

P4LP redemption is unavailable until Claims mode. It burns the caller's claims directly, requires no LP allowance, and
returns the proportional underlying amounts subject to minimums and a deadline. Fees left in the vault after Claims
begins increase claim backing rather than becoming a separate claim transaction.

## Fees and lifecycle

The PoolKey fee is 0.30%. Of fees earned by the pledge.cash vault position, 5% routes to the protocol recipient and 95%
routes to the Boardroom while Active. The rule does not apply to fees earned by unrelated Uniswap positions, and any
Uniswap protocol fee enabled outside pledge.cash is separate from this split and outside Boardroom governance.

During wind-down, exact exit is preferred. If an underlying token blocks it, the vault can enter Claims without an
underlying call and transfer protocol-held P4LP to the Boardroom. The follow-up Boardroom close/finalize route prunes
the obligation while external claims remain independently redeemable. This keeps snapshot progress independent from
hostile token behavior.

## Deterministic proof

```sh
bun --cwd packages/contracts test --match-contract PledgeV4LiquidityTest
bun --cwd packages/sdk test
bun --cwd apps/web test
```
