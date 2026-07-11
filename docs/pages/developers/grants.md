---
title: Grant integration
description: Developer bridge for TokenGrant provenance, settlement quotes, grant-right ownership, issuer lifecycle, and Boardroom obligations.
---

# Grant integration

Use the [Token grant protocol specification](https://github.com/peezy-tech/pledge.cash/blob/main/docs/token-grant-protocol.md) and `packages/contracts/src/grants/` for exact behavior.

## Canonical reads

Verify the selected TokenGrantFactory before accepting a grant route. Read issuer, holder, token, payment token, grant size, claimable, settled amount, price, cliff, vesting end, expiry, halted/closed state, settleable amount, and grant-right ownership.

Permanent grant identity comes from the configured TokenGrantFactory's token-id mapping and the grant's reciprocal
factory field. When a grant is presented as Boardroom-issued, also verify that its issuer is the canonical Boardroom.
While the grant is active, require the Boardroom's live obligation record as a lifecycle check; after close and prune,
that record is intentionally cleared and its absence does not erase factory provenance. Do not infer a canonical grant
from ABI compatibility alone.

## Quote settlement, do not display only price

Call `getSettlementCost(amount)` for the exact chosen token amount. The contract computes upward-rounded payment from grant-token decimals. Also read payment balance and allowance for paid grants.

The SDK exposes `readGrantSettlementQuote`. A UI that shows only `price` leaves the user without total-cost proof.

## Transactions

- direct creation requires escrow approval and the exact current native creation fee;
- distribution-created grants use a distinct nonpayable, zero-fee path with canonical Boardroom/distribution provenance;
- paid settlement may require an approval transaction before `settle`;
- halt and expiry withdrawal are issuer-only;
- grant-right transfers must satisfy live, transferable, and unlock checks.

Exact-transfer checks reject partial, taxed, or no-op token movements. Surface the actual revert instead of retrying with a larger amount.

## Deterministic proof

```sh
bun --cwd packages/contracts test
bun --cwd packages/sdk test
bun --cwd apps/web test
```

Include free, paid, partial, transferred, halted, expired, and Boardroom-issued grants in end-to-end fixtures.
