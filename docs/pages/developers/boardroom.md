---
title: Boardroom integration
description: Developer bridge for v5 controller governance, canonical obligations, snapshotting, singleton markets, and redemptions.
---

# Boardroom integration

Use the [Boardroom protocol specification](https://github.com/peezy-tech/pledge.cash/blob/main/docs/boardroom-protocol.md)
for the complete candidate state machine. Source lives in `packages/contracts/src/boardroom/`. The candidate is a
mainnet NO-GO until every readiness blocker and gated curve policy is resolved.

## Canonical reads

Before enabling an action:

- require a supported v5 deployment identity and matching runtime code hashes;
- verify `BoardroomFactory.isBoardroom(boardroom)`;
- verify the Boardroom's factory, controller factory, share token, policy registry, and wrapped native;
- read status, launch state, owner/controller, controller generation, Boardroom governance epoch, protection staker,
  wind-down delay, reward pool, and redemption-excess recipient;
- for a controller, verify Boardroom, factory, proposer, delay, grace period, generation, configuration epoch, and
  configuration hash;
- read scalar obligation counts, per-kind counts, canonical membership, permanent policy provenance, and bounded
  factory/event pages;
- read primary-market mode, permanent curve and quote identities, global curve liability, liquidity state, locker,
  pool, and reservation;
- during Snapshotting, read the frozen asset count, cursor, per-asset status, and frozen redemption supply.

A current-state read cannot prove complete lifetime history when log or pagination reads are incomplete. Surface partial
history explicitly.

## Write model

Before launch, only the owner enters policy-checked `execute` or `executeBatch`. After launch, only the current
controller can enter `executeGovernance`; only its proposer schedules, while any caller may execute ready operations.
The Boardroom policy gateway must receive the scheduled proposer as authority, never the permissionless executor.

Every operation binds the complete call batch, salt, Boardroom epoch, controller generation, controller configuration
epoch, proposer, and configuration hash. Proposer or timing changes are delayed controller self-operations. Controller
replacement is a delayed Boardroom self-call that deploys the next generation during execution.

Legacy Boardrooms may be read, but writes and Boardroom-control claims must fail closed. Do not translate an old
`launch(uint256)` or internal queue into the v5 interface.

## Wind-down and snapshotting

Treat `Active -> WindingDown -> Snapshotting -> RedemptionsOpen` as monotonic. Starting wind-down advances the
Boardroom epoch in O(1). Redemptions require zero active obligations, a terminal reward pool, closed singleton
liquidity, completed treasury-share handling, and the elapsed wind-down delay.

`beginSnapshot` freezes registry length and redemption supply. Anyone may process bounded pages with
`snapshotAssets(maximum)`; unreadable assets get an explicit status. Only a fully processed frozen registry can enter
`RedemptionsOpen`.

Never use share-token `balanceOf` as governance power. Use current and previous-block active stake from the canonical
reward pool against the corresponding current and prior governance-eligible supply.

## Offchain controller proof

Use the separate Sentinel Boardroom-control challenge and claim API. Hash the exact serialized SIWE message with
EIP-191, perform topology and ERC-1271 reads at one pinned finalized block, atomically consume the nonce with claim
creation, and require a fresh proof for every privileged write. A user session is identity only.

## Deterministic proof

```sh
bun --cwd packages/contracts build
bun --cwd packages/contracts test
bun --cwd packages/sdk build
bun --cwd apps/web test
bun --cwd services/sentinel test
bun run format:check
```

Also record Foundry v1.7.1, runtime sizes, maximum-gas cases, and invariant results.
