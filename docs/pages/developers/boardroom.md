---
title: Boardroom integration
description: Developer bridge for canonical Boardroom discovery, policy execution, governance, obligations, wind-down, and redemptions.
---

# Boardroom integration

Use the [Boardroom protocol specification](https://github.com/peezy-tech/pledge.cash/blob/main/docs/boardroom-protocol.md) for the complete state machine and invariants. The source of truth is `packages/contracts/src/boardroom/`.

## Read before enabling actions

- verify `BoardroomFactory.isBoardroom(address)` on the selected deployment;
- read owner, policy registry, wrapped native, share token, canonical reward pool, lifecycle status, launch state, executor, delay, epoch, and eligible supply;
- verify the share token's Boardroom authority;
- read current obligation arrays and surface partial failures individually;
- scan creation and governance events when lifetime history is required.

SDK readers and discovery helpers live in `packages/sdk/src/helpers/`. A current-state read cannot prove complete lifetime history when the RPC log scan failed.

## Write model

Before launch, the owner uses policy-checked `execute` or `executeBatch`. After launch, the executor queues an action and
any caller executes it after delay. Every external target requires the correct policy. Calls to recorded obligations
retain their permanent module-policy identity for cleanup and reserved downstream fulfillment even if new top-level
Boardroom module calls are disabled. Registry disable is not a pause for direct interaction with existing child
contracts; enforce each child's and the Boardroom's lifecycle independently.

Do not expose governance launch for the legacy `launch(uint256)` interface. It does not bind expected executor calldata and cannot support a race-safe permanent transition. Require a future interface that includes expected executor and reverts on mismatch.

## Wind-down and redemption

Treat `Active -> WindingDown -> RedemptionsOpen` as monotonic. New obligations stop in wind-down. Redemptions open only after bounded active grants, distributions, and lockers close and prune and the canonical reward pool is terminalized.

Never use share-token `balanceOf` as governance power. Use current and previous-block active stake from the canonical reward pool against the stricter current/prior governance-eligible supply threshold. See [Staking and rewards integration](staking-and-rewards).

`redeem` can pay only a subset of snapshot assets. Persist and render per-asset credits; use `claimRedemptionAsset` for retries. Never infer completion from burned share balance alone.

## Deterministic proof

```sh
bun --cwd packages/contracts test
bun --cwd packages/contracts build
forge fmt --check --root packages/contracts
```

For UI work, also run the SDK and web test suites and verify canonical project routes in a seeded local scenario.
