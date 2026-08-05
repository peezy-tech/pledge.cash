# Hard release blocker 1: no release candidate deployment

Status: **Blocked**

Scope: target-testnet promotion, every mainnet broadcast, and real-value
product launch.

## Release decision

The sole contract line is canonical `pledge.cash.protocol.v1`. Its Boardroom is
the permanent asset-holding kernel routed through
`ProtocolFacetRegistry`; there is no supported alternative deployment line.

The target testnets do not have a protocol-v1 broadcast:

- Ethereum Sepolia `11155111.json` is `pending`;
- Base Sepolia `84532.json` is `pending`;
- Ethereum, Base, Arbitrum, and Robinhood Chain have canonical profiles and
  pending status artifacts, but mainnet deployment is not authorized.

Testnet deployment is the next operational stage after final local acceptance
and the pull-request review cycle. This document does not authorize that
broadcast. Mainnet remains a NO-GO until every exit criterion below is
satisfied.

## Current evidence

- Deterministic deployment uses bytecode-bound
  `pledge.cash.protocol.v1` salts and first-use init-code commitments.
- `Deploy.s.sol` deploys the 21 protocol roots, publishes and activates the
  complete 97-route release A, configures policies and fee routes, hands
  governed roots to protocol governance, and attests the graph.
- A fresh local Anvil deployment, idempotent rerun, and standalone verifier
  have checked deterministic provenance, runtime code hashes, the complete
  release table and recomputed facet-set hash, ownership, wiring, policies,
  and fee routes.
- The integrated local Boardroom scenario has exercised release activation,
  write downtime, permissionless migration, lifecycle cleanup, and redemption.
- Focused Boardroom, controller, module, registry, kernel, and invariant suites
  are recorded in the
  [canonical design/evidence report](../design/boardroom-diamondization-spike.md).
- Final exact-head full-suite, SDK/application/service, fresh-Anvil, hosted CI,
  and independent-review gates are still pending.
- No target-chain receipt, source verification, or promoted artifact exists
  for this release.

## Why this is a hard blocker

Local execution cannot prove:

- that all deployment and maximum-cost transactions fit the target chain's
  intended execution lane;
- that target RPC, finality, log-range, historical-data, and wallet behavior
  support discovery and recovery;
- that the final authority accounts can perform the exact bootstrap and
  ownership handoff;
- that the supported SDK, web, and Sentinel paths use the promoted
  registry/facet identity and fail closed on migration;
- that the deployed compiler inputs, bytecode, source, receipts, and artifact
  can be independently reproduced;
- that a complete lifecycle works against the exact public deployment.

A mainnet broadcast before those proofs would create an immutable public asset
surface whose release authority can change all Boardroom behavior without a
validated ceremony or recovery plan.

## Decisions already fixed

- Release identity: `pledge.cash.protocol.v1`.
- Boardroom architecture: global complete-release registry plus permanent
  asset-holding kernels.
- Initial registry authority: existing protocol governance.
- Release activation: atomic and global, including terminal lifecycles.
- Rollback: publish a higher-numbered compatible release; never reactivate old
  metadata.
- Storage upgrades: permissionless per-Boardroom migration with accepted write
  downtime.
- Transaction binding: every mutation and controller authorization commits an
  explicit expected facet-set hash.
- Artifact promotion: verified candidates are retained separately; promotion
  is an explicit release decision.

## Decisions still required

1. Choose the first mainnet chain; do not launch multiple mainnets
   simultaneously.
2. Approve the exact protocol-v1 commit and audited compiler/dependency
   inputs.
3. Choose the production registry governor, quorum, timelock, veto, and
   emergency process.
4. Approve governance, treasury, deterministic deployer owner, broadcaster, and the exact external Uniswap v4/Permit2
   deployments for each rehearsal and target.
5. Approve target-chain selector-count, release-activation gas, migration gas,
   and downtime limits.
6. Define who may promote a verified candidate and which independent evidence
   is mandatory.
7. Decide the supported modules/assets and whether any surface is deliberately
   disabled at first launch.

## Required testnet remediation

### 1. Freeze the exact candidate

- Finish the final local acceptance ledger.
- Complete the pull-request review cycle with no remaining actionable finding.
- Record the exact 40-character reviewed commit and clean generated diff.
- Freeze compiler settings, dependency lockfiles, release manifests, storage
  layout commitments, and deployment calldata.
- Complete independent security and economic review before treating that
  commit as a mainnet candidate.

### 2. Rehearse target-chain operations

For the selected testnet:

- run the dry-run wrapper against the intended RPC and execution lane;
- confirm deployment and release-activation gas bounds;
- rehearse the exact authority and ownership-handoff transaction shape;
- broadcast from the frozen clean revision;
- retain candidate artifact and minimized receipt evidence;
- independently run the live verifier;
- reproduce contract source verification and compiler inputs;
- exercise creation, launch, controller operations, modules, wind-down,
  snapshotting, redemption, release activation, migration, and resumed
  operation through supported product paths;
- verify indexer discovery and reorg/finality behavior from the inclusive
  deployment block.

### 3. Promote deliberately

Promotion must reject any candidate missing:

- exact source commit, chain, deployment block/timestamp, and successful
  receipts;
- deterministic deployer provenance and init-code commitments;
- all root, helper, module, child-implementation, kernel, and facet addresses
  and runtime code hashes;
- complete release metadata, 97 canonical routes, manifest hash, kernel
  selector-set hash, required storage version/layout, and active facet-set
  hash;
- ownership, immutable reciprocal wiring, policies, wrapped-native identity,
  treasury, and fee routes;
- independent live verification output.

The product remains unwritable until the promoted artifact is checked in and
the released SDK/application builds consume exactly that identity.

## Exit criteria

- [ ] One first mainnet and one exact audited release commit are approved.
- [ ] Canonical protocol v1 is deployed to the corresponding public testnet.
- [ ] The candidate artifact and receipt ledger are independently verified and
      explicitly promoted.
- [ ] Full lifecycle, release activation, migration downtime, and resumed
      operation pass through the supported SDK and product paths.
- [ ] Maximum deployment, activation, migration, and user transaction costs fit
      the intended target-chain lanes.
- [ ] The production authority ceremony is rehearsed with the same transaction
      shapes and controls.
- [ ] Mainnet wrappers refuse the wrong chain, dirty source, incomplete roles,
      partial artifact, and release mismatch.
- [ ] Release CI requires live code-hash, selector-table, ownership, and
      immutable-wiring verification.
- [ ] A protected promotion step controls when clients become writable.
- [ ] A signed release evidence packet identifies source, compiler inputs,
      manifests, storage layouts, deployed code, governance calldata, audit,
      known limitations, and incident boundaries.

Documentation or screenshots without source-reproducible onchain evidence do
not clear this blocker.
