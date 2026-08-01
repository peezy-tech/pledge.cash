# Canonical Boardroom implementation evidence

Date: 2026-07-30

Release decision: **testnet pending; mainnet NO-GO**.

The authoritative architecture and measured evidence are consolidated in the
[Boardroom diamond protocol design/evidence report](../design/boardroom-diamondization-spike.md).
This readiness page maps that work to the remaining release blockers without
duplicating volatile hashes, byte sizes, gas numbers, or test counts.

## Implemented protocol boundary

- `IBoardroom` is the one aggregate ABI. There is no supported parallel
  Boardroom implementation or compatibility deployment line.
- Every Boardroom clone keeps assets at its permanent address and routes
  through a canonical `BoardroomKernel`.
- One `ProtocolFacetRegistry` publishes immutable complete releases and
  atomically activates one release for every Boardroom.
- Release A contains 97 ordered routes across authority, execution, market,
  redemption, and view facets.
- Facet routes commit selector, route kind, facet address, and runtime code
  hash. Releases also commit predecessor, storage version/layout, migration
  metadata, and human-readable manifest hash.
- Every state-changing Boardroom function takes an explicit expected
  facet-set hash. Controller operations and signatures bind the same hash.
- ERC-7201 namespaces separate kernel metadata and Boardroom business state.
  A storage-version activation pauses ordinary writes on each Boardroom until
  anyone runs its release-pinned atomic migration.
- Views remain backward-safe or explicitly expose migration state.
- Canonical grants, distributions, rewards, bonds, curves, and P4LP-liquidity callbacks read and echo the current hash in the same
  transaction.
- Registry ownership is handed to protocol governance after bootstrap. That
  owner remains ultimately authoritative over Boardroom assets and redemption
  behavior in every lifecycle state.

## Focused local evidence

The current work has recorded:

- registry publication/activation, selector validation, loupe, routing,
  delegatecall context, malicious-view rollback, fail-closed dispatch, and
  migration tests;
- the complete Boardroom behavior and controller suites running through the
  canonical kernel/facets;
- callback-driven module integration across grants, distributions, rewards,
  bonds, curves, Uniswap v4, and P4LP liquidity;
- six stateful wind-down/redemption properties at 256 runs and 128,000 calls
  each, including hostile payout retry;
- Foundry v1.7.1 runtime measurements below the 8 KiB kernel and 20 KiB
  registry/facet targets;
- a phased local lifecycle that activates release B, proves pre-migration write
  failure, migrates three Boardrooms independently, and resumes cleanup and
  redemption;
- a fresh local `Deploy.s.sol` broadcast, idempotent rerun, and standalone
  verification of 21 roots, all 97 routes, deterministic provenance, code
  hashes, owners, wiring, policies, and fee routes.

Exact commands, counts, sizes, and the captured gas table live in the
design/evidence report. They are focused implementation evidence, not the
final exact-head release ledger.

## Acceptance still pending

- full contract suite on the final source tree;
- clean SDK regeneration, typecheck, and SDK tests;
- web and Sentinel integration suites using the canonical release
  identity and migration gates;
- fresh-Anvil deterministic deployment, idempotence, standalone verifier,
  Boardroom lifecycle, seed, and service integrations on the final reviewed
  commit;
- refreshed size and gas evidence, including an isolated pre-diamond
  comparison and target-chain execution-lane simulation;
- docs build/check, formatting, generated diff, and `git diff --check`;
- pull-request review cycle and hosted CI;
- target-testnet broadcast, source verification, artifact promotion, and full
  public lifecycle rehearsal;
- independent security and economic review;
- production release-governance and authority ceremony.

## Blocker mapping

| Blocker | Current status |
| --- | --- |
| 01 — release candidate deployment | **Open.** Both target-testnet artifacts are pending. |
| 02 — secure governance launch | Canonical controller and release-bound authorization are implemented locally; final integration/audit and public rehearsal remain open. |
| 03 — production authority ceremony | **Open.** Direct registry ownership is only the bootstrap model. |
| 04 — independent security assurance | **Open.** No audit of the exact canonical release exists. |
| 05 — lifecycle data model | Canonical obligations, singleton markets, bounded snapshotting, terminal policies, and storage migration are implemented locally; public-chain proof remains open. |

## Go/no-go statement

The repository has one coherent canonical protocol implementation and focused
local proof. It does not yet have a promoted testnet identity or final
exact-head acceptance record. Testnet deployment is the next stage only after
those local/review gates close; mainnet remains a NO-GO.
