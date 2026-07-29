# Boardroom diamondization design spike

> **Status: implemented, local-only prototype; production NO-GO.**
>
> This spike introduces a separate vNext product line. It does not migrate v5 Boardrooms, alter v5 deployment salts,
> update chain `998` or `10143` artifacts, broadcast a target-chain transaction, extract custody, or add a redemption
> sidecar. Its only broadcasts are an ignored, local Anvil lifecycle proof.

## Outcome

The prototype demonstrates that a vNext Boardroom can remain the permanent asset-holding address while all routed
behavior is selected by one protocol-owned registry. New Boardrooms are deterministic minimal clones of a kernel.
Their fallback asks the global `ProtocolFacetRegistry` for the active route and delegates into the selected facet while
preserving `msg.sender`, `msg.value`, `address(this)`, returndata, and revert data.

The spike also demonstrates an intentionally disruptive storage release:

1. Release A creates and operates vNext Boardrooms with the current Boardroom storage namespaces and core semantics.
2. Registry activation of release B changes routing and the required hash globally.
3. Reads remain available, but ordinary writes on each Boardroom fail until that Boardroom migrates.
4. Any account can run the release-pinned migration.
5. The migration performs a real additive state transformation and applies the exact release-B storage commitment.
6. Normal writes and terminal redemption resume independently on each migrated Boardroom.

The prototype now reaches executable feature parity for the current Boardroom and callback-driven module surface.
Release-A facets reuse the same Boardroom business implementation, every module family has a hash-bound vNext adapter,
and the integrated proof covers both ordinary and terminal lifecycles. A real registry/kernel invariant harness also
ports wind-down conservation and hostile-payout retry across release migration. This is not production-audit parity:
the individual v5 adversarial cases have not all been parameterized one-for-one through vNext, and no target-chain
deployment ceremony has been performed.

## Authority model

`ProtocolFacetRegistry.owner()` is the only release authority in the spike:

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

This model deliberately leaves protocol governance with ultimate authority over every vNext Boardroom's assets and
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

The kernel selector list is canonical rather than an arbitrary deployment input. Its exact hash is checked when the
registry is constructed, when the kernel binds to the registry, and again when the vNext factory binds both contracts.
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

The executable manifest builder is `BoardroomVNextRelease.sol`. It sorts complete selector tables before publication.
The human-readable release specifications are:

- `docs/design/boardroom-diamond-release-a.md`
- `docs/design/boardroom-diamond-release-b.md`

Their exact file bytes are committed onchain through:

| Release | Human manifest hash |
| --- | --- |
| A | `0x42f9307e89ac60cc7fd7c2d98ec0064876f13c0ebfa64aee8fb272f03d600deb` |
| B | `0x480533d1aec981866c51057fe59217f34407bc3b3a2cd963921fcda33f43a5ff` |

Release A has 97 routes:

| Facet | Route kind | Selector count | Responsibility |
| --- | --- | ---: | --- |
| `BoardroomAuthorityFacet` | Mutating | 12 | initialization, ownership, launch/controller, veto, minting, wind-down |
| `BoardroomExecutionFacet` | Mutating | 13 | execution, assets, obligations, callbacks |
| `BoardroomMarketFacet` | Mutating | 10 | primary market and protocol-liquidity reservations |
| `BoardroomRedemptionFacet` | Mutating | 7 | snapshotting, redemption, claims, native wrapping |
| `BoardroomViewFacet` | View | 55 | aggregate legacy-compatible reads |

Release B has 99 routes. It replaces `redemptionCredits(address)` with `BoardroomViewFacetV2`, adds
`releaseBMigrationState()`, and adds `migrateBoardroom(bytes32)` as the sole Migration route. Selector replacement and
removal semantics are covered by registry unit tests; omitting a selector from a later complete table removes it
atomically.

`bun --cwd packages/contracts check:diamond-vnext-manifests` recomputes the two document hashes and fails if either
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
ERC-1271 authorizations that were built for the previous hash. `BoardroomTokenVNext` reads the Boardroom's current hash
and echoes it into its primary-market callback within the same transaction. The vNext controller commits the hash to
operation IDs, schedules, execution checks, and signatures; it never substitutes the current hash for the scheduled
one.

SDK builders require an explicit 32-byte hash. They do not fetch it while constructing an authorization. SDK readers
pin all component reads to one block so a release activation cannot produce a mixed registry/Boardroom report.

### Release-bound ERC-1271 proofs

The vNext controller does not accept a legacy raw proposer signature. Its opaque ERC-1271 signature is a canonical,
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
requires a migration route. The release-B migration:

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

Release A is a compatibility bridge, not the final native facet decomposition. Each semantic facet is a
selector-specific adapter into one isolated legacy `Boardroom` implementation. Nested delegatecall keeps custody and
business storage at the Boardroom clone address while reusing the currently tested Boardroom state machine and ERC-7201
layouts.

Facets expose no independently usable owner, initializer, upgrade, registry-mutation, or destruction surface. The
authority facet's public `initializeBoardroom` route is usable only while the kernel has entered its one-time
initialization context; direct calls revert. That route deploys `BoardroomTokenVNext`. Existing Boardroom reentrancy
storage remains shared across compatibility facets; the kernel supplies a separate migration lock.

This approach makes the global routing, authority, transaction-binding, and migration design executable without
rewriting all Boardroom business logic in one spike. Before production, the compatibility bridge should either be
replaced by native shared libraries/facets or receive an explicit audit of its nested-delegatecall assumptions.

## vNext module compatibility

The callback-ABI gap is resolved in the prototype through a separate vNext module line rather than by weakening the
kernel's expected-hash requirement:

- `BoardroomVNextCallbackLib` reads the Boardroom's current `facetSetHash()` immediately before each mutating callback
  and passes it as `expectedFacetSetHash`;
- `BoardroomRewardsFactoryVNext`, `BondMarketFactoryVNext`, `DistributionFactoryVNext`,
  `TokenGrantFactoryVNext`, and `LockedLiquidityFactoryVNext` adapt factory-originated callbacks;
- `MerkleAirdropVNext` and `MigratingBondingCurveVNext` adapt callbacks that originate from a long-lived child;
- each factory accepts only canonical Boardrooms from the configured `BoardroomVNextFactory`, while the existing
  policy and obligation checks still constrain which factory or child may call each callback.

The integrated scenario exercises creation, participation, terminalization, and wind-down cleanup for rewards, fixed
sales, Dutch auctions, direct and Merkle-created grants, direct Merkle claims, reserve bonds, locked liquidity, and a
cancelled migrating curve. A third Boardroom buys a complete curve inventory, latches graduation, migrates into the
reserved vNext locker/pool, replaces the curve obligation with the locked-liquidity obligation, and later exits that
liquidity during wind-down. Release activation between module creation and cleanup proves that autonomous callbacks
use the live hash, while direct Boardroom transactions and queued governance operations remain pinned to their caller's
expected hash.

Production remains a NO-GO because the adapter line still needs complete invariant and malicious-token equivalence
testing, an audit of factory/child provenance and same-transaction hash reads, deterministic target-chain deployment
evidence, and an approved release-governance ceremony.

## Deployment, ABI, and SDK boundary

`PledgeCashBoardroomDiamondSalts.sol` defines a disjoint
`pledge.cash.boardroom-diamond.vnext.*` CREATE2 namespace for the registry, kernel, factory, dependencies, release-A
facets, release-B facets, fee router, asset policy, and every module root. The local scenario deploys those roots,
publishes and activates release A, creates sample Boardrooms, rehearses release B, and verifies owners, fee routing,
hashes, routes, facet code, registry/kernel/factory bindings, and applied storage state.

The local graph mirrors the production fee boundary without charging the scenario's grant calls: the token-grant
creation fee remains zero, its fee recipient is `ProtocolFeeRouter`, the AMM protocol-fee recipient is the same router,
the AMM fee manager is independent, and the router forwards to the configured protocol treasury. When
`PLEDGE_CASH_PROTOCOL_GOVERNANCE` differs from the bootstrap account, the registry, policy registry, asset policy, fee
router, token-grant factory, and AMM factory are handed off only after the lifecycle proof has completed.

Because the compatibility implementation embeds a controller factory that must know the vNext factory, the executable
prototype deploys registry, kernel, a separate deterministic market-logic root, the factory/remaining compatibility
logic, and facets before publishing release A. Externalizing the market logic keeps the factory's real constructor
initcode below EIP-3860 on an unmodified Anvil node. No Boardroom can be created until release A is active. A production
deployment ceremony should preserve the same trust boundary and record all predicted/deployed addresses before
activation.

The default scenario is a dry run and deliberately writes no chain deployment artifact. A separate phased harness can
broadcast the same lifecycle to a fresh local Anvil chain and writes only the ignored
`31337.diamond-vnext.local.json` checkpoint. Existing `998.json`, `998.receipts.json`, `10143.json`, v5 salts, and
production configuration remain untouched.

The default local rehearsal produced deterministic metadata:

| Field | Value |
| --- | --- |
| Registry | `0xF2940FF81f8C665ee291D460ce6ecf7FD07A335E` |
| vNext factory | `0x50Ef110D3FB3d3B11A305E9C8BC41309374Dc7cE` |
| Sample Boardroom | `0x9E7fF86BAA64E5F6982389440B03c6b4a1817B92` |
| Release-A facet-set hash | `0x1eabee240f60e93a8d526c6bd87207d620a08343f17ed70e36994574a0a96288` |
| Release-B facet-set hash | `0xc818bbe647f20b56af4eabb0bc9971e5816e51db6ba9055149dd44dd3d0af91e` |

These addresses are evidence for the default local keys and script environment only. They are not target-chain
deployment addresses.

The separate phased broadcast used the standard Anvil deployer on an unmodified chain-id-31337 node. Its ignored
`complete` checkpoint records registry `0x50924E13C718E7C78a31Bcd7d44d35088DFe7D76`, factory
`0x639c241A588cE08b0948DA0a642eEaEFce901CC1`, primary Boardroom
`0x4041C2156D12A9E3380c1Ae423845b0aab631624`, and active release-B hash
`0xb48306473ab6b009dc064a50b27566653ed199f94aaaca69fc6cad9e64b94bb3`. Direct post-run reads at block 115
reported release `2`, storage version `2`, `migrationRequired == false`, and zero active obligations on the primary,
cancelled-curve, and successfully graduated-curve Boardrooms.

The aggregate ABI source is `IBoardroomDiamond`. SDK generation keeps `boardroomAbi` unchanged and separately exports:

- `boardroomDiamondAbi`;
- `protocolFacetRegistryAbi`;
- `boardroomVNextFactoryAbi`;
- `boardroomVNextControllerAbi`;
- vNext reward, bond, distribution, token-grant, locked-liquidity, Merkle-airdrop, and migrating-curve ABIs.

SDK readers return the pinned block, active release/hash, historical release routes and runtime code hashes, applied and
required storage versions/layouts, and migration requirement. Mutation builders require an explicit expected facet-set
hash, and the wind-down builder rejects native value exactly as the contract does. Discovery decodes the complete
`BoardroomVNextCreated` identity separately from v5 creation events. The vNext release helper pins one block while
checking registry, factory, kernel, controller, compatibility Boardroom, governance, market, redemption, facet,
storage, and reciprocal canonical identity.

The SDK also exposes the exact vNext controller EIP-712 typed-data/hash construction and strict v1 envelope
encoder/decoder. These helpers require explicit context and never fetch or substitute a release hash during
authorization construction.

## Local scenario coverage

`bun --cwd packages/contracts scenario:diamond-vnext:dry-run` covers:

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
- launch and canonical vNext controller deployment;
- release-A-bound controller scheduling and execution;
- staker-authorized wind-down with eight independently tracked obligations;
- release-B publication and global activation;
- pre-migration write failure and backward-safe reads;
- permissionless deterministic migration;
- resumed cleanup, snapshot, open redemptions, and WETH payout;
- final registry ownership and binding/code-hash checks.

`bun --cwd packages/contracts scenario:diamond-vnext:local` runs the same proof as four real broadcasts against a fresh
chain-id-31337 Anvil instance. The wrapper mines the stake checkpoint, advances the governance delay, probes the exact
release-B `StorageMigrationRequired` revert, advances the curve unwind grace, and verifies all three Boardrooms have
zero active obligations before accepting the `complete` checkpoint.

The Solidity integration suite separately activates release B while Boardrooms are WindingDown, Snapshotting, and
RedemptionsOpen, and proves independent migration across multiple Boardrooms.

`BoardroomDiamondVNextWindDownInvariant.t.sol` runs a canonical factory/registry/kernel Boardroom through release
activation, permissionless migration, wind-down, paged snapshotting, redemption, a reverting asset payout, and
successful retry. Six stateful properties each execute 256 runs and 128,000 handler calls with zero handler reverts;
the deterministic companion test proves a healthy payout remains available while the hostile asset fails.

## Size evidence

Measured with Foundry 1.7.1 using `forge build --sizes`:

| Contract | Runtime bytes | Initcode bytes |
| --- | ---: | ---: |
| `BoardroomKernel` | 6,924 | 8,290 |
| `ProtocolFacetRegistry` | 9,067 | 10,807 |
| `BoardroomAuthorityFacet` | 10,304 | 10,519 |
| `BoardroomExecutionFacet` | 3,760 | 3,983 |
| `BoardroomMarketFacet` | 1,407 | 1,622 |
| `BoardroomRedemptionFacet` | 901 | 1,116 |
| `BoardroomViewFacet` | 178 | 390 |
| `BoardroomReleaseBMigrationFacet` | 741 | 769 |
| `BoardroomViewFacetV2` | 324 | 352 |
| `BoardroomVNextController` | 10,166 | 10,303 |
| `BoardroomVNextFactory` | 3,092 | 41,899 |
| `BoardroomVNextControllerFactory` | 2,030 | 12,598 |
| `BoardroomRewardsFactoryVNext` | 5,110 | 15,261 |
| `BondMarketFactoryVNext` | 7,033 | 18,216 |
| `DistributionFactoryVNext` | 12,534 | 47,698 |
| `LockedLiquidityFactoryVNext` | 16,354 | 23,771 |
| `TokenGrantFactoryVNext` | 13,416 | 21,138 |
| v5 compatibility `Boardroom` | 24,418 | 24,966 |

The kernel is 1,268 bytes below the spike's 8 KiB target. The registry, every facet, and every vNext factory runtime are
below 20 KiB. Each deployed Boardroom clone has a 45-byte runtime. The Boardroom factory's seven static constructor
arguments leave 7,029 bytes under the EIP-3860 transaction-initcode limit. `DistributionFactoryVNext` has the narrowest
creation margin: its two static constructor arguments leave 1,390 bytes. The normal-limit Anvil broadcast proves both
complete constructors deploy without a node override.

The compatibility `Boardroom` runtime remains only 158 bytes below the 24,576-byte EIP-170 limit and should not be
treated as a comfortable production margin.

No new unbounded user-controlled loop was introduced. Registry publication/activation are bounded to 256 selectors;
Boardroom batch/snapshot bounds remain inherited from v5; the release builders cap themselves at 128 selectors.

## Gas evidence

Measured with:

```sh
forge test --gas-report \
  --match-contract '^(ProtocolFacetRegistryTest|BoardroomKernelTest|BoardroomDiamondVNextTest)$' -vv
```

| Operation | Representative gas | Notes |
| --- | ---: | --- |
| Publish complete release | 7,103,451 max | 97/99 selector manifests plus validation/revert cases |
| Activate complete release | 7,342,654 max | release B replaces the complete active table |
| `route(bytes4)` registry lookup | 7,217 integration median; 9,217 max | returns and loads the release-pinned runtime code hash |
| Create and initialize vNext Boardroom | 1,917,604 median | includes share-token deployment |
| Release-B storage migration facet | 48,159 median; 65,262 max | normal migration plus release-B genesis paths |
| Kernel fallback | 27,138 integration median; 542,125 max | spans small views through full routed mutations |
| `facetSetHash()` kernel read | 5,523 median | registry-backed |
| ERC-1271 release-bound validation | 8,623 median; 118,839 max | malformed, stale, EOA, and recursive-contract paths |
| ERC-1271 EIP-712 digest helper | 1,593 median/max | explicit proof context |

Within the same routed traces, the outer compatibility facets versus the inner v5 Boardroom behavior cost:

| Representative mutation | Inner v5-compatible behavior | Routed facet | Routing/adaptation delta |
| --- | ---: | ---: | ---: |
| `mint` | 202,621 | 205,848 | +3,227 |
| `startWindDown` | 69,614 | 72,701 | +3,087 |
| `execute` minimum | 227,000 | 231,695 | +4,695 |

These are local test-VM measurements, not chain fee predictions. Registry activation is intentionally expensive and
rare. The compatibility runtime margin and complete-table activation cost should be addressed before any production
proposal.

## Verification evidence

Comparison baseline before the vNext spike:

```text
55f2ebf138ce078e7790a475e358d1ffe2a6c64b
```

Focused evidence on the formatted tree:

| Command | Result |
| --- | --- |
| `forge test --match-path test/boardroom/ProtocolFacetRegistry.t.sol -vv` | 17 passed, 0 failed |
| `forge test --match-path test/boardroom/BoardroomKernel.t.sol -vv` | 28 passed, 0 failed |
| `forge test --match-path test/boardroom/BoardroomDiamondVNext.t.sol -vv` | 20 passed, 0 failed |
| `forge test --match-path test/boardroom/BoardroomVNextModuleParity.t.sol -vv` | 14 passed, 0 failed |
| `forge test --match-path test/boardroom/BoardroomDiamondVNextWindDownInvariant.t.sol -vv` | 7 passed, 0 failed; six invariants at 128,000 calls each |
| focused registry/kernel/integration gas-report run | 65 passed, 0 failed |
| `bun --cwd packages/sdk test` | 71 passed, 0 failed; 656 assertions |
| `bunx tsc -p packages/sdk/tsconfig.json --noEmit` | passed |
| `bun --cwd packages/contracts check:diamond-vnext-manifests` | passed |
| `bun --cwd packages/contracts scenario:diamond-vnext:dry-run` | passed; aggregate script gas 104,934,370 |
| fresh normal-limit Anvil plus `bun --cwd packages/contracts scenario:diamond-vnext:local` | passed; checkpoint `complete`, three obligation counts zero, migration cleared |
| `forge build --sizes` | passed; sizes recorded above |
| `bun --cwd packages/contracts build` | passed |
| `bun --cwd packages/contracts test` | 25 suites; 417 passed, 0 failed, 0 skipped |
| `bun --cwd packages/contracts verify:testnet-artifacts` | chain 998 verified with 29 receipts; chain 10143 pending and skipped |
| `bun --cwd packages/sdk build` | passed |
| generated `packages/sdk/src/generated.ts` before/after SHA-256 | identical |
| `bun run docs:check` | passed; 36 pages and 36 navigation entries checked |
| `bun run format:check` | passed |
| `git diff --check` | passed |

These results were recorded from the review-hardened implementation tree on top of the comparison baseline above. The
final exact-head review and hosted CI gate remain separate from this local evidence ledger.

Adversarial coverage includes ownership, canonical publication, duplicate/unsorted/reserved selectors, missing code,
code-hash mismatch at activation and dispatch, canonical kernel-selector binding, add/replace/remove activation, loupe
accuracy, predecessor/layout rules, registry failure,
unknown/removed selectors, delegatecall context and ETH behavior, revert fidelity, malicious View routes, shared
reentrancy, storage-slot isolation, kernel-metadata corruption, migration-to-mutation reentrancy, in-flight release
activation, stale hashes, release-bound callbacks, queued operations, ERC-1271 signatures, wrong migration source,
failed postconditions, repeat migration, independent lifecycle migration, conservation, and hostile payout retry.

The spike reuses the existing v5 Boardroom behavioral suite through its compatibility implementation, adds full-path
vNext module tests, and routes the current wind-down conservation properties through a real vNext Boardroom. It does
not claim that every named v5 adversarial-token and boundary test has been duplicated one-for-one through the new
callback ABI. That systematic audit matrix remains production acceptance work, not a known feature-parity defect.

## Unresolved production and audit questions

1. What staking governor, quorum, timelock, veto, and emergency process replaces direct registry ownership?
2. Must protocol releases remain possible during active redemptions, or should governance add a terminal-release delay?
3. What invariant and adversarial-token matrix is required to accept the vNext factory/child adapters as equivalent to
   the v5 modules?
4. Should release activation copy a complete table, or should an immutable per-release router reduce activation gas?
5. How will release manifests, compiler inputs, storage layouts, deployed code, and governance calldata be reproduced
   and independently attested before activation?
6. Should the compatibility bridge be retired in favor of native facets before audit, especially given its 158-byte
   runtime margin?
7. How are failed or gas-infeasible migrations detected and recovered without violating atomicity?
8. What maximum supported selector count and activation gas are acceptable on each target chain?
9. What invariant harness proves asset/redemption conservation across every future terminal-state migration?
10. How will release review prove facets contain no mutable proxy, fallback-forwarder, or other implementation
    indirection that can change behavior while the facet runtime code hash stays constant?
11. Which Safe versions, fallback handlers, nested contract-proposer topologies, and RPC gas limits form the required
    production ERC-1271 compatibility matrix?

Until those questions are resolved, this spike is architecture and local lifecycle evidence, not deployment
authorization.
