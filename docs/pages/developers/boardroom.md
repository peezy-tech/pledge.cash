---
title: Boardroom integration
description: Developer bridge for registry-routed Boardrooms, controller governance, obligations, migration, snapshotting, singleton markets, and redemptions.
---

# Boardroom integration

Use the [Boardroom protocol specification](https://github.com/peezy-tech/pledge.cash/blob/main/docs/boardroom-protocol.md)
for the complete state machine. Source lives in
`packages/contracts/src/boardroom/`. Both target-testnet artifacts are pending,
and mainnet remains a NO-GO.

## Canonical reads

Before enabling an action:

- require a promoted protocol-v1 deployment identity and matching registry,
  kernel, facet, helper, factory, and module runtime code hashes;
- verify `BoardroomFactory.isBoardroom(boardroom)`;
- at one pinned block, verify the Boardroom registry, active facet-set hash,
  required storage version/layout, applied storage version/layout, and
  migration requirement;
- verify the Boardroom's factory, controller factory, share token, policy registry, and wrapped native;
- read status, launch state, owner/controller, controller generation, Boardroom governance epoch, protection staker,
  wind-down delay, reward pool, and redemption-excess recipient;
- for a controller, verify Boardroom, factory, proposer, delay, grace period, generation, configuration epoch, and
  configuration hash;
- read scalar obligation counts, per-kind counts, canonical membership, permanent policy provenance, and bounded
  factory/event pages;
- read primary-market mode, permanent curve and quote identities, global curve liability, liquidity state, P4LP vault,
  PoolId, and reservation;
- during Snapshotting, read the frozen asset count, cursor, per-asset status, and frozen redemption supply.

A current-state read cannot prove complete lifetime history when log or pagination reads are incomplete. Surface partial
history explicitly.

## Write model

Before launch, only the owner enters policy-checked `execute` or `executeBatch`. After launch, only the current
controller can enter `executeGovernance`; only its proposer schedules, while any caller may execute ready operations.
The Boardroom policy gateway must receive the scheduled proposer as authority, never the permissionless executor.

Every state-changing Boardroom ABI begins with an explicit
`expectedFacetSetHash`. Every controller operation and signature binds that
hash along with the complete call batch, salt, Boardroom epoch, controller
generation, controller configuration epoch, proposer, and configuration hash.
Builders must not fetch or substitute a hash while constructing an
authorization.

Proposer or timing changes are delayed controller self-operations. Controller
replacement is a delayed Boardroom self-call that deploys the next generation
during execution. A stale hash or a Boardroom requiring migration must fail
closed.

## Wind-down and snapshotting

Treat `Active -> WindingDown -> Snapshotting -> RedemptionsOpen` as monotonic. Starting wind-down advances the
Boardroom epoch in O(1). Redemptions require zero active obligations, a terminal reward pool, resolved singleton
liquidity, completed treasury-share handling, and the elapsed wind-down delay. Exact v4 exit can empty the vault;
hostile-token fallback instead registers protocol-held P4LP and closes the Boardroom obligation while the vault remains
in Claims for independent holder redemption.

`beginSnapshot` freezes registry length and redemption supply. Anyone may
process bounded pages with `snapshotAssets(expectedFacetSetHash, maximum)`;
unreadable assets get an explicit status. Only a fully processed frozen
registry can enter `RedemptionsOpen`.

A storage-version release immediately changes global routing and then blocks
ordinary writes on each Boardroom until anyone runs its release-pinned,
atomic migration. Reads must either decode the older layout safely or report
that migration is required.

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
