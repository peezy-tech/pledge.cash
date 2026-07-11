---
title: AMM and liquidity integration
description: Developer bridge for pools, router quotes, fee accounting, protected first liquidity, and Boardroom locker exits.
---

# AMM and liquidity integration

Use the [AMM and locked liquidity specification](https://github.com/peezy-tech/pledge.cash/blob/main/docs/amm-protocol.md) and `packages/contracts/src/amm/` plus `packages/contracts/src/liquidity/` for exact behavior.

## Pool identity and token support

Resolve the sorted token pair through the configured AmmFactory. Verify pool bytecode and factory membership before quoting or submitting. The protocol assumes standard, non-rebasing ERC20s with exact sender and recipient deltas.

Do not treat raw balance donations as deposited liquidity. Mint and swap infer input from balance changes, and untracked excess can be consumed before fee-manager recovery.

## User transactions

- Quote against current reserves and the nominal 30 bps input fee.
- Bind minimum output, deadline, recipient, and exact route.
- For liquidity, bind desired and minimum amounts.
- Track LP fee entitlement separately from LP principal.
- Re-read reserves and allowance after any approval or failed follow-up.

Pool reuse in one route is rejected. A route whose final token equals its input can be valid, but gross output is not the same as wallet net profit.

## Boardroom locked liquidity

Canonical share-token initial liquidity is reservation-protected. The expected payer, router, pool, and locker recipient must agree. Boardroom seed minima must be at least 95% of desired amounts.

Locker principal remains locked while active. During wind-down, exact underlying exit is attempted first. After the terminal delay, hostile-token failure can fall back to transferring the LP token to the Boardroom, which must remain admitted for redemption.

## Deterministic proof

```sh
bun --cwd packages/contracts test
bun --cwd packages/sdk test
bun --cwd apps/web test
```

Include fee claims, transfer/burn entitlement, reserved first mint, hostile reserve ratio, donation handling, curve migration, exact exit, delayed LP fallback, and partial redemption visibility.
