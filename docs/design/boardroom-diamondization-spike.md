# Boardroom diamond protocol: design and evidence

> **Status: Boardroom architecture record; liquidity and deployment evidence predates the Uniswap v4 generation.**
>
> The kernel/facet and policy conclusions remain relevant. Custom-AMM,
> locked-liquidity, x402, chain-998, byte-size, and test-count details below are
> historical. Use `docs/amm-protocol.md`, `docs/deployment.md`, and the release-A/B
> manifests for the current implementation. Ethereum Sepolia `11155111` and
> Base Sepolia `84532` remain pending, no public-chain transaction has been
> broadcast, and all four planned mainnets remain a NO-GO.

## Outcome

The implementation demonstrates that a Boardroom can remain the permanent asset-holding address while all routed
behavior is selected by one protocol-owned registry. New Boardrooms are deterministic minimal clones of a kernel.
Their fallback asks the global `ProtocolFacetRegistry` for the active route and delegates into the selected facet while
preserving `msg.sender`, `msg.value`, `address(this)`, returndata, and revert data.

The release rehearsal also demonstrates an intentionally disruptive storage
release:

1. Release A creates and operates Boardrooms with the canonical Boardroom storage namespaces and core semantics.
2. Registry activation of release B changes routing and the required hash globally.
3. Reads remain available, but ordinary writes on each Boardroom fail until that Boardroom migrates.
4. Any account can run the release-pinned migration.
5. The migration performs a real additive state transformation and applies the exact release-B storage commitment.
6. Normal writes and terminal redemption resume independently on each migrated Boardroom.

The canonical suites now exercise the complete Boardroom behavior,
controller, callback-driven module, and wind-down invariant surfaces through
the registry and kernel. Release-A facets implement Boardroom behavior
natively, every module family uses hash-bound callbacks, and the integrated
proof covers ordinary and terminal lifecycles. This is feature-parity
implementation evidence, not production-audit or target-chain evidence. The
final repository-wide acceptance run and independent security review remain
open.

## Authority model

`ProtocolFacetRegistry.owner()` is the only Boardroom release authority:

- only the owner may publish an immutable, complete release;
- only the owner may atomically activate a published release;
- activation must advance to a higher release whose predecessor is the currently active facet-set hash;
- an older release cannot be reactivated;
- a rollback is a newly published, higher-numbered compatible release;
- Boardroom owners and controllers cannot install, pin, or remove facets;
- wind-down, snapshotting, and open redemptions do not freeze protocol routing.

The local deployment scenario creates the registry under a bootstrap authority, performs the release rehearsal, then
transfers ownership to `PLEDGE_CASH_PROTOCOL_GOVERNANCE` when that address differs from the bootstrap account. The
intended initial value is the existing `protocolGovernance` address. Replacing that owner with staking governance or a
timelock does not require changing any Boardroom.
The deployment artifact's `protocolFacetRegistryOwner` is evidence of that
genesis ceremony only; it is not a permanent equality constraint against the
historical `protocolGovernance` field.

This model deliberately leaves protocol governance with ultimate authority over every Boardroom's assets and
redemption behavior. Expected-hash binding protects a transaction from semantic drift; it does not make a malicious
registry release safe.

## Registry and release rules

`ProtocolFacetRegistry` uses complete releases rather than incremental per-Boardroom diamond cuts. Publication validates
and stores metadata but changes no active behavior. Activation replaces the active selector table, hash, release,
required storage version, and required layout commitment in one transaction.

Every release commits to:

- `uint64 release`;
- `uint64 requiredStorageVersion`;
- `bytes32 predecessorFacetSetHash`;
- `bytes32 storageLayoutHash`;
- `bytes32 manifestHash`;
- canonically ordered route definitions containing selector, facet, runtime code hash, and route kind;
- a migration facet and selector, or an explicit zero/zero no-migration pair.

The canonical facet-set hash is:

```text
keccak256(
  abi.encode(
    FACET_SET_TYPEHASH,
    release,
    requiredStorageVersion,
    predecessorFacetSetHash,
    storageLayoutHash,
    manifestHash,
    keccak256(abi.encode(orderedRoutes)),
    migrationFacet,
    migrationSelector
  )
)
```

Publication rejects zero releases, empty manifest/layout commitments, invalid predecessors, more than 256 selectors,
non-ascending or duplicate selectors, kernel-reserved selectors, zero/no-code facets, runtime code-hash mismatches, and
inconsistent migration metadata. Activation rechecks every runtime code hash before changing the table. Releases and
release numbers are immutable once published. Active routes retain the committed code hash, and the kernel compares it
with the facet's live `EXTCODEHASH` before every initialization, view, mutation, and migration delegatecall.
An empty ordered route array is intentionally valid before the release lineage
has introduced a migration route. Activating such a complete release removes
every facet selector and makes routed Boardroom behavior unavailable until a
higher-numbered recovery release is activated; kernel introspection and native
receipt remain. After any migration-bearing release, every successor must
retain one migration route so an older, not-yet-migrated Boardroom can still
reach the active storage schema. An emergency shutdown in that lineage is
therefore migration-only rather than empty.

The kernel selector list is canonical rather than an arbitrary deployment input. Its exact hash is checked when the
registry is constructed, when the kernel binds to the registry, and again when the Boardroom factory binds both
contracts.
This keeps registry loupe metadata from claiming selectors that Solidity dispatch resolves inside the kernel.

Activation additionally requires:

- a strictly increasing release number;
- the exact active facet set as predecessor;
- a nondecreasing storage version;
- an unchanged storage-layout commitment when the version is unchanged;
- a pinned migration route when the storage version increases.

The registry implements `route`, `facetAddress`, `facetAddresses`, `facetFunctionSelectors`, and `facets`, plus
historical release metadata, selector, and route reads. `FacetSetPublished`, one `FacetRoutePublished` per route, and
`FacetSetActivated` contain enough onchain data to audit publication and activation.

## Selector manifests

The executable manifest builder is `BoardroomRelease.sol`. It sorts complete selector tables before publication.
The human-readable release specifications are:

- `docs/design/boardroom-diamond-release-a.md`
- `docs/design/boardroom-diamond-release-b.md`

Their exact file bytes are committed onchain through:

| Release | Human manifest hash |
| --- | --- |
| A | `0x49203191b8b3958946efa6e4da2562dc1a9af4c7a75855751c8abd05505025ab` |
| B | `0xe50a0e6d677c939d5767190157bb3955f3da8fe3ebb86400077e3a99ff659934` |

Release A has 97 routes:

| Facet | Route kind | Selector count | Responsibility |
| --- | --- | ---: | --- |
| `BoardroomAuthorityFacet` | Mutating | 12 | initialization, ownership, launch/controller, veto, minting, wind-down |
| `BoardroomExecutionFacet` | Mutating | 13 | execution, assets, obligations, callbacks |
| `BoardroomMarketFacet` | Mutating | 10 | primary market and protocol-liquidity reservations |
| `BoardroomRedemptionFacet` | Mutating | 7 | snapshotting, redemption, claims, native wrapping |
| `BoardroomViewFacet` | View | 55 | aggregate native reads |

Release B has 99 routes. It replaces `redemptionCredits(address)` with `BoardroomViewFacetV2`, adds
`releaseBMigrationState()`, and adds `migrateBoardroom(bytes32)` as the sole Migration route. Selector replacement and
removal semantics are covered by registry unit tests; omitting a selector from a later complete table removes it
atomically.

`bun --cwd packages/contracts check:boardroom-manifests` recomputes the two document hashes and fails if either
human manifest drifts from its Solidity commitment.

## Kernel routing and transaction binding

The deployed Boardroom clone runtime is the standard 45-byte minimal proxy. Its implementation is `BoardroomKernel`,
whose persistent surface is limited to:

- one-time `initialize(bytes32,bytes)`;
- native-token receipt;
- `facetRegistry()`;
- `facetSetHash()`;
- `appliedStorageVersion()`;
- `appliedStorageLayoutHash()`;
- `migrationRequired()`;
- `kernelSelectorSetHash()`;
- fallback routing;
- the rollback-only view dispatcher used internally by fallback.

Those selectors are reserved in the registry and cannot be shadowed by a facet.

The kernel fails closed if it cannot read the registry, the selector is unknown or removed, the route kind is invalid,
the selected facet has no code, the route version disagrees with the active version, or migration postconditions fail.

Every non-view aggregate Boardroom function has `bytes32 expectedFacetSetHash` as its first ABI argument. For Mutating
routes the kernel:

1. loads that hash from calldata;
2. requires it to equal the registry's active hash;
3. requires the Boardroom's applied storage version and layout hash to equal the registry requirements;
4. rejects mutation while a migration delegatecall is in progress;
5. delegates only after all checks pass;
6. post-verifies the active hash/version/layout, applied version/layout, and kernel initialization/lock metadata before
   returning.

A release change therefore invalidates direct calls, cross-contract callbacks, queued controller operations, and
ERC-1271 authorizations that were built for the previous hash. `BoardroomToken` reads the Boardroom's current hash
and echoes it into its primary-market callback within the same transaction. The Boardroom controller commits the hash to
operation IDs, schedules, execution checks, and signatures; it never substitutes the current hash for the scheduled
one.

SDK builders require an explicit 32-byte hash. They do not fetch it while constructing an authorization. SDK readers
pin all component reads to one block so a release activation cannot produce a mixed registry/Boardroom report.

### Release-bound ERC-1271 proofs

The Boardroom controller does not accept a legacy raw proposer signature. Its opaque ERC-1271 signature is a canonical,
versioned envelope containing the facet-set hash, Boardroom epoch, controller generation, configuration epoch/hash,
and the proposer signature. The proposer signs an EIP-712 `BoardroomControlProof` that commits the caller's original
message hash and every envelope field. The EIP-712 domain commits chain ID and controller address; the proof struct
also commits the Boardroom address. Relabeling an old signature with a new release hash therefore changes the signed
digest and fails.

Validation returns the invalid ERC-1271 value, rather than leaking a revert, for malformed/noncanonical envelopes,
failed Boardroom reads, a release mismatch, migration downtime, non-Active lifecycle, controller/generation mismatch,
configuration drift, or a bad EOA/recursive contract-proposer signature. The Active-only rule deliberately revokes
offchain control proofs when wind-down starts. EOAs sign the SDK's typed-data object; Safe or other contract-wallet
tooling signs or approves the same digest through its normal ERC-1271 flow.

All proof context must come from one pinned block. Challenge issuers must refuse to issue while
`migrationRequired == true`; the contract rejects validation during that interval, but a legitimate proposer can
pre-sign deterministic future context just as it can for any published release.

### Enforced view behavior

EVM `CALL` does not become static merely because a registry labels a selector `View`. The kernel therefore does not
directly return from a View delegatecall. It:

1. delegatecalls its reserved rollback dispatcher while preserving the original caller and Boardroom context;
2. the dispatcher delegatecalls the facet;
3. the dispatcher always reverts with an envelope containing the facet's success flag and returndata;
4. fallback decodes that envelope and reproduces the facet's return or revert.

The forced inner revert rolls back storage writes and external side effects even when the caller used a normal
transaction rather than `STATICCALL`. Tests route a deliberately state-writing malicious "view" facet and prove that
its write is discarded while caller, value, Boardroom address, returndata, and revert behavior remain correct.

## Storage and migration

The kernel owns the ERC-7201 namespace `pledge.cash.boardroom.diamond.kernel`, containing initialization state, the
migration lock, applied storage version, and applied layout hash. Business facets continue to use the existing
Boardroom ERC-7201 namespaces. Release B adds its own `pledge.cash.boardroom.diamond.release-b` namespace.

The registry binds both the predecessor facet-set hash and the required storage-layout commitment. A version increase
requires a migration route. Every migration-bearing release uses the permanent
`migrateBoardroom(bytes32)` entrypoint (`0x6f774fc9`); governance may replace
the pinned migration facet but cannot change that selector. The release-B
migration:

- accepts only the active expected hash through kernel dispatch;
- accepts no arbitrary caller migration data;
- checks the exact release-A version and layout commitment;
- writes `keccak256("pledge.cash.boardroom.diamond.release-b")`, the migration timestamp, and source version;
- sets the exact release-B version and layout commitment.

The kernel holds a migration reentrancy lock across delegatecall, prevents the migration facet from reentering a
Mutating route after prematurely setting the target version, and post-verifies the active hash, required version,
required layout, applied version/layout, and kernel initialization/lock metadata before returning. Mutating routes
perform equivalent release and metadata postchecks, so an in-flight registry activation or a facet write into the
kernel namespace rolls back the whole transaction. Any facet revert or failed postcondition is atomic. Migration is
permissionless and independent per Boardroom. A repeat attempt reverts `AlreadyMigrated`.

Publication causes no downtime. Activating a same-storage-version release changes behavior globally and immediately
without a migration pause. Activating a higher-storage-version release changes global routing/hash immediately, keeps
backward-safe views available, and blocks ordinary writes on each Boardroom until that Boardroom migrates. A Boardroom
can remain unavailable forever if its migration cannot complete; the protocol release ceremony must prove bounded gas
and terminal-accounting liveness before activation.

## Facet implementation strategy

Release A is a native facet decomposition. Each semantic facet executes its Boardroom wrapper behavior in the kernel's
storage context and preserves the scalar and ERC-7201 layouts. Purpose-built governance, market, and redemption helper
modules remain immutable dependencies; no facet deploys or delegates into
another Boardroom implementation.

The authority facet's public `initializeBoardroom` route is usable only while the kernel has entered its one-time
initialization context; direct calls revert. That route deploys `BoardroomToken`. The Solady ownership and
reentrancy slots remain shared across facets, while the kernel supplies a separate migration lock.

## Module callbacks

The callback ABI is hash-bound throughout the canonical module line without weakening the kernel's expected-hash
requirement:

- `BoardroomCallbackLib` reads the Boardroom's current `facetSetHash()` immediately before each mutating callback
  and passes it as `expectedFacetSetHash`;
- `BoardroomRewardsFactory`, `BondMarketFactory`, `DistributionFactory`, `TokenGrantFactory`, and
  `LockedLiquidityFactory` adapt factory-originated callbacks;
- `MerkleAirdrop` and `MigratingBondingCurve` adapt callbacks that originate from a long-lived child;
- each factory accepts only canonical Boardrooms from the configured `BoardroomFactory`, while the existing
  policy and obligation checks still constrain which factory or child may call each callback.

The integrated scenario exercises creation, participation, terminalization, and wind-down cleanup for rewards, fixed
sales, Dutch auctions, direct and Merkle-created grants, direct Merkle claims, reserve bonds, locked liquidity, and a
cancelled migrating curve. A third Boardroom buys a complete curve inventory, latches graduation, migrates into the
reserved locker/pool, replaces the curve obligation with the locked-liquidity obligation, and later exits that
liquidity during wind-down. Release activation between module creation and cleanup proves that autonomous callbacks
use the live hash, while direct Boardroom transactions and queued governance operations remain pinned to their caller's
expected hash.

Target-chain use remains pending until the pull-request review and live
testnet-deployment ceremony gates are complete. Production additionally
requires an independent audit of factory/child provenance, same-transaction
hash reads, hostile-token behavior, migration liveness, and the release
governance ceremony.

## Deployment, ABI, and SDK boundary

`PledgeCashDeploymentSalts.sol` defines the bytecode-bound
`pledge.cash.protocol.v1` namespace used by `Deploy.s.sol`.
`PledgeCashBoardroomScenarioSalts.sol` provides isolated addresses for the
local release-A/release-B lifecycle rehearsal. The deployment proof publishes
and activates release A and verifies owners, fee routing, hashes, all 97
routes, facet code, registry/kernel/factory bindings, and applied storage
state.

The local graph mirrors the production fee boundary without charging the scenario's grant calls: the token-grant
creation fee remains zero, its fee recipient is `ProtocolFeeRouter`, the AMM protocol-fee recipient is the same router,
the AMM fee manager is independent, and the router forwards to the configured protocol treasury. When
`PLEDGE_CASH_PROTOCOL_GOVERNANCE` differs from the bootstrap account, the registry, policy registry, asset policy, fee
router, token-grant factory, and AMM factory are handed off only after the lifecycle proof has completed.

Because the controller factory must know the Boardroom factory, the deployment
flow deploys registry, kernel,
factory-bound controller factory, immutable helper logic, and facets before publishing release A. No Boardroom can be
created until release A is active. A production deployment ceremony should preserve the same trust boundary and record
all predicted/deployed addresses before activation.

The dry-run scenario writes no target-chain artifact. The phased Anvil harness
writes only the ignored `31337.boardroom.local.json` checkpoint. Facet-set
hashes and addresses are deployment-specific because the release commits
facet addresses and runtime code hashes; no local address in this report is a
testnet identity.

A fresh local `Deploy.s.sol` broadcast completed for all 21 deterministic
roots, and an idempotent rerun accepted the same roots and configuration.
The standalone verifier then checked receipt provenance, CREATE2/CREATE3
predictions and init-code commitments, every runtime code hash, the complete
97-selector release-A table and recomputed facet-set hash, owners, immutable
wiring, policies, and fee routes against the live Anvil RPC. This is the
current local deployment proof. It must be repeated from the final reviewed
commit before a testnet broadcast.

The aggregate ABI source is `IBoardroom`. SDK generation exports:

- `boardroomAbi`;
- `protocolFacetRegistryAbi`;
- `boardroomFactoryAbi`;
- `boardroomControllerAbi`;
- reward, bond, distribution, token-grant, locked-liquidity, Merkle-airdrop, and migrating-curve ABIs.

SDK readers return the pinned block, active release/hash, historical release routes and runtime code hashes, applied and
required storage versions/layouts, and migration requirement. Mutation builders require an explicit expected facet-set
hash, and the wind-down builder rejects native value exactly as the contract does. Discovery decodes the complete
`BoardroomCreated` identity. The release helper pins one block while checking registry, factory, kernel, controller,
governance, market, redemption, facet, storage, and reciprocal canonical identity.

The SDK also exposes the exact Boardroom controller EIP-712 typed-data/hash construction and strict v1 envelope
encoder/decoder. These helpers require explicit context and never fetch or substitute a release hash during
authorization construction.

## Local scenario coverage

`bun --cwd packages/contracts scenario:boardroom:dry-run` covers:

- deterministic root and facet deployment;
- release-A publication and activation;
- deterministic Boardroom creation and share minting;
- native/WETH treasury funding;
- real reward funding, protection staking, accrual, claim, and terminalization;
- fixed-price and Dutch-auction purchases and cleanup;
- direct-grant creation plus both direct-share and grant-backed Merkle claims;
- reserve-bond purchase, vesting redemption, and market close;
- real AMM liquidity creation, LP return, and locker close;
- a second Boardroom's migrating-curve buy, cancellation, holder unwind, grace delay, and finalization;
- a third Boardroom's complete curve purchase, successful graduation into reserved protocol liquidity, obligation
  replacement, release-B migration, LP return, and locker close;
- launch and canonical Boardroom controller deployment;
- release-A-bound controller scheduling and execution;
- staker-authorized wind-down with eight independently tracked obligations;
- release-B publication and global activation;
- pre-migration write failure and backward-safe reads;
- permissionless deterministic migration;
- resumed cleanup, snapshot, open redemptions, and WETH payout;
- final registry ownership and binding/code-hash checks.

`bun --cwd packages/contracts scenario:boardroom:local` runs the same proof as four real broadcasts against a fresh
chain-id-31337 Anvil instance. The wrapper mines the stake checkpoint, advances the governance delay, probes the exact
release-B `StorageMigrationRequired` revert, advances the curve unwind grace, and verifies all three Boardrooms have
zero active obligations before accepting the `complete` checkpoint.

The Solidity integration suite separately activates release B while Boardrooms are WindingDown, Snapshotting, and
RedemptionsOpen, and proves independent migration across multiple Boardrooms.

`BoardroomWindDownInvariant.t.sol` runs a canonical factory/registry/kernel Boardroom through release
activation, permissionless migration, wind-down, paged snapshotting, redemption, a reverting asset payout, and
successful retry. Six stateful properties each execute 256 runs and 128,000 handler calls with zero handler reverts;
the deterministic companion test proves a healthy payout remains available while the hostile asset fails.

## Size evidence

Measured with Foundry 1.7.1 using `forge build --sizes`:

| Contract | Runtime bytes | Initcode bytes |
| --- | ---: | ---: |
| `BoardroomKernel` | 6,924 | 8,290 |
| `ProtocolFacetRegistry` | 9,121 | 10,861 |
| `BoardroomAuthorityFacet` | 16,641 | 17,096 |
| `BoardroomExecutionFacet` | 8,468 | 8,882 |
| `BoardroomMarketFacet` | 4,180 | 4,594 |
| `BoardroomRedemptionFacet` | 3,055 | 3,466 |
| `BoardroomViewFacet` | 6,825 | 7,259 |
| `BoardroomReleaseBMigrationFacet` | 741 | 769 |
| `BoardroomViewFacetV2` | 324 | 352 |
| `BoardroomController` | 10,166 | 10,303 |
| `BoardroomFactory` | 3,042 | 16,757 |
| `BoardroomControllerFactory` | 2,030 | 12,598 |
| `BoardroomRewardsFactory` | 5,110 | 15,261 |
| `BondMarketFactory` | 7,033 | 18,216 |
| `DistributionFactory` | 12,534 | 47,698 |
| `LockedLiquidityFactory` | 16,354 | 23,771 |
| `TokenGrantFactory` | 13,416 | 21,138 |

The kernel is 1,268 bytes below the 8 KiB acceptance target. The registry, every facet, and every factory runtime are
below 20 KiB. Each deployed Boardroom clone has a 45-byte runtime. The Boardroom factory's seven static constructor
arguments leave 32,395 bytes under the EIP-3860 transaction-initcode limit. The normal-limit Anvil broadcast proves
the complete constructor graph deploys without a node override.

No new unbounded user-controlled loop was introduced. Registry publication/activation are bounded to 256 selectors;
Boardroom batch/snapshot bounds remain explicit; the release builders cap themselves at 128 selectors.

## Gas evidence

The following local test-VM measurements were captured with:

```sh
forge test --gas-report \
  --match-contract '^(ProtocolFacetRegistryTest|BoardroomKernelTest|BoardroomTest)$' -vv
```

| Operation | Representative gas | Notes |
| --- | ---: | --- |
| Publish complete release | 7,103,451 max | 97/99 selector manifests plus validation/revert cases |
| Activate complete release | 7,342,654 max | release B replaces the complete active table |
| `route(bytes4)` registry lookup | 7,217 integration median; 9,217 max | returns and loads the release-pinned runtime code hash |
| Create and initialize Boardroom | 1,917,604 median | includes share-token deployment |
| Release-B storage migration facet | 48,159 median; 65,262 max | normal migration plus release-B genesis paths |
| Kernel fallback | 27,138 integration median; 542,125 max | spans small views through full routed mutations |
| `facetSetHash()` kernel read | 5,523 median | registry-backed |
| ERC-1271 release-bound validation | 8,623 median; 118,839 max | malformed, stale, EOA, and recursive-contract paths |
| ERC-1271 EIP-712 digest helper | 1,593 median/max | explicit proof context |

Within the routed traces, the representative Boardroom operations cost:

| Representative mutation | Routed facet |
| --- | ---: |
| `mint` | 205,848 |
| `startWindDown` | 72,701 |
| `execute` minimum | 231,695 |

These are local test-VM measurements, not chain fee predictions. Registry activation is intentionally expensive and
rare. They must be refreshed on the final reviewed commit and measured through
each target chain's execution and block limits before activation. A reproducible
pre-diamond comparison must use the recorded comparison commit in an isolated
checkout; the removed implementation is not retained in the canonical source
tree.

## Verification evidence

Historical comparison baseline before the diamond architecture:

```text
55f2ebf138ce078e7790a475e358d1ffe2a6c64b
```

Focused evidence recorded during canonicalization:

| Command | Result |
| --- | --- |
| `forge test --match-path test/boardroom/ProtocolFacetRegistry.t.sol -vv` | 17 passed, 0 failed |
| `forge test --match-path test/boardroom/BoardroomKernel.t.sol -vv` | 28 passed, 0 failed |
| `forge test --match-path test/boardroom/Boardroom.t.sol -vv` | 20 passed, 0 failed |
| `forge test --match-path test/boardroom/BoardroomBehavior.t.sol -vv` | 64 passed, 0 failed |
| `forge test --match-path test/boardroom/BoardroomController.t.sol -vv` | 19 passed, 0 failed |
| `forge test --match-path test/boardroom/BoardroomModuleIntegration.t.sol -vv` | 13 passed, 0 failed |
| `forge test --match-path test/boardroom/BoardroomWindDownInvariant.t.sol -vv` | 7 passed, 0 failed; six invariants at 128,000 calls each |
| focused registry/kernel/integration gas-report run | 65 passed, 0 failed |
| `bun --cwd packages/contracts check:boardroom-manifests` | passed |
| fresh normal-limit Anvil plus `bun --cwd packages/contracts scenario:boardroom:local` | passed; checkpoint `complete`, three obligation counts zero, migration cleared |
| `forge build --sizes` | passed; sizes recorded above |
| `bun --cwd packages/contracts build` | passed |
| `bun --cwd packages/contracts test` | 414 passed, 0 failed across 24 suites |
| fresh Anvil `Deploy.s.sol`, idempotent rerun, and standalone verifier | passed; 21 roots, 97 routes, code hashes, provenance, owners, wiring, policies, and fee routes checked |
| SDK generation, build, and tests | generated output byte-identical; 71 passed, 0 failed |
| web typecheck, tests, and production/docs build | passed; 486 tests, 36 docs pages, and 51 routes |
| Sentinel tests, typecheck, and Postgres/Anvil integration | passed; 171 tests plus complete Boardroom/control proof |
| x402 router tests, typecheck, and Postgres/Anvil integration | passed; 103 tests plus AMM, sale, recurring, replay, and refund proof |
| `bun run docs:check`, `bun run format:check`, `git diff --check` | passed |

The full local ledger, fresh lifecycle rerun, and independent cutover audit are
clean. The pull-request review cycle and hosted CI gate remain pending; local
evidence is not a substitute for either gate or for an independent production
security audit.

Adversarial coverage includes ownership, canonical publication, duplicate/unsorted/reserved selectors, missing code,
code-hash mismatch at activation and dispatch, canonical kernel-selector binding, add/replace/remove activation, loupe
accuracy, predecessor/layout rules, registry failure,
unknown/removed selectors, delegatecall context and ETH behavior, revert fidelity, malicious View routes, shared
reentrancy, storage-slot isolation, kernel-metadata corruption, migration-to-mutation reentrancy, in-flight release
activation, stale hashes, release-bound callbacks, queued operations, ERC-1271 signatures, wrong migration source,
failed postconditions, repeat migration, independent lifecycle migration, conservation, and hostile payout retry.

The behavior, controller, module-integration, and invariant suites now construct
canonical registry/kernel Boardrooms directly. Independent audit must still
judge whether the adversarial matrix is sufficient for production; that is a
security-assurance boundary, not a second supported implementation.

## Unresolved production and audit questions

1. What staking governor, quorum, timelock, veto, and emergency process replaces direct registry ownership?
2. Must protocol releases remain possible during active redemptions, or should governance add a terminal-release delay?
3. What invariant and adversarial-token matrix is required for the canonical
   factory/child callbacks?
4. Should release activation copy a complete table, or should an immutable per-release router reduce activation gas?
5. How will release manifests, compiler inputs, storage layouts, deployed code, and governance calldata be reproduced
   and independently attested before activation?
6. Which additional boundary cases will an independent auditor require beyond
   the canonical parity suites?
7. How are failed or gas-infeasible migrations detected and recovered without violating atomicity?
8. What maximum supported selector count and activation gas are acceptable on each target chain?
9. What invariant harness proves asset/redemption conservation across every future terminal-state migration?
10. How will release review prove facets contain no mutable proxy, fallback-forwarder, or other implementation
    indirection that can change behavior while the facet runtime code hash stays constant?
11. Which Safe versions, fallback handlers, nested contract-proposer topologies, and RPC gas limits form the required
    production ERC-1271 compatibility matrix?

Until the pull-request, testnet-ceremony, and governance/audit gates are
resolved, this report is local architecture evidence, not testnet or production
deployment authorization.
