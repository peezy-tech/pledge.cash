# Boardroom redesign implementation evidence

Date: 2026-07-21

Release decision: **mainnet NO-GO**. This document records local implementation and proof for blockers 02 and 05. It does not clear the independent-review, public-testnet, production-authority, or release-candidate requirements.

## Baseline and preservation

- Branch: `github`; baseline HEAD and `origin/main`: `aa774c5291d8ce655bcd34182c35ec02fffbcc7e`.
- Initial status contained only the five intentional untracked assessment documents under `docs/mainnet-readiness/`.
- Those five documents remain untracked and byte-for-byte preserved:
  - `01-release-candidate-deployment.md`: `15b8413dc49faabcc7e5b18eb391d50bedc28ce93743826d5bee8ba0cee5c991`
  - `02-secure-governance-launch.md`: `99ca3b5e6792e789857baab31bf7c512f8f196a7a38f220c69c5525a47002d71`
  - `03-production-authority-ceremony.md`: `ffd89f8a9d9794363347cf22af7dce72fe0124e80b12f49a062ae96c0e059b12`
  - `04-independent-security-assurance.md`: `9d903656b80554db9aa58aa22a2aa06511349e8b4c761c79ba5336fae00f038c`
  - `05-boardroom-lifecycle-data-model.md`: `568c9bcdbfddf5c28fa5ed4c3e5885585f496a21eabe9a6a3537ca27cae2c7cb`

## Implemented state machines and authority boundaries

### Governance

`Unlaunched -> Active(controller generation n) -> WindingDown -> Snapshotting -> RedemptionsOpen`.

- A controller address is predictable but no controller is deployed before launch. Launch deploys generation 1 atomically through the Boardroom-bound controller factory, verifies every supplied security value, and transfers ownership.
- Only the current proposer schedules. Any account executes a ready operation, while the scheduled proposer remains the policy authority passed into the Boardroom gateway.
- Operation identity binds Boardroom, calldata, salt, governance epoch, controller generation, and configuration epoch. Proposer/security changes are delayed self-governance; replacement deploys the next controller only during the delayed Boardroom self-call.
- Boardroom holder veto is the immutable cancellation path. Wind-down advances the governance epoch and invalidates all queued work in constant time. Generic ownership transfer and renunciation are disabled after launch.
- The controller cannot move treasury assets or call third parties for the Boardroom. Its only execution edge is the policy-checked Boardroom governance gateway; onchain ownership remains `msg.sender == owner/controller`.

### Offchain control proof

`Issued challenge -> exact SIWE serialization -> EIP-191 hash -> pinned-finalized ERC-1271 validation -> atomic nonce consumption + claim`.

- The controller validates EOAs by signature recovery and contract proposers recursively through ERC-1271. This signature surface never schedules or executes governance.
- Challenges bind audience/domain, destination user or organization, scope, chain, Boardroom, controller, controller generation, controller configuration epoch, nonce, issued time, and expiry.
- Canonical topology reads and `isValidSignature` use one pinned finalized block. Unknown/legacy releases, stale relationships, reorg uncertainty, malformed return data, and RPC failure fail closed.
- Better Auth establishes user identity only. A claim is not durable authority: every privileged Boardroom write requires a fresh nonce and current proof.

### Obligations and redemptions

- ERC-7201 namespaces hold canonical membership, scalar total/per-kind counts, permanent provenance tombstones, dependency counts, asset registry state, primary-market state, and liquidity state.
- Parent-to-child transitions are atomic and reentrancy-safe. Closed obligations can be pruned permissionlessly in bounded pages without erasing provenance. Grant-slot reservations and concurrent obligation ceilings are gone.
- Discovery is event-driven and append-only paginated; protocol liveness does not depend on index arrays.
- Snapshotting freezes asset registration, liquidity mutation, redemption supply, and treasury-share treatment; assets are processed through bounded permissionless pages, unreadable assets are marked explicitly, and redemptions open only after the frozen registry is complete.

### Primary market

`Unset -> BondingCurve -> GeneralAvailability`, with one lifetime curve. Curve phases are `Selling -> Graduated -> Migrated -> Settled`, or `Selling/Graduated -> Unwinding -> Settled`, with `Quarantined` as a recoverable nonterminal branch.

- A curve is created once, only pre-launch and before any other canonical release. Its predicted address is committed before atomic reservation/funding. Launch from Unset moves permanently to GeneralAvailability; launch during Selling preserves curve exclusivity.
- BoardroomToken enforces the transfer boundary, including old allowances: Boardroom-originated mint/transfer/transferFrom can fund only the exact curve or authorized atomic migration custody while the curve is active. Holder transfers and third-party markets remain possible.
- Sell rights follow transferred shares and use one global outstanding curve-share liability.
- Approved bounds are immutable: 90-day maximum lifetime, 7-day migration grace, 30-day settlement/unwind grace, 30-day quarantine delay, and a 7-day forfeiture-veto window.
- Cancellation and expiry enter a 30-day sell-only unwind. Any holder may sell; anyone finalizes afterward; residual quote and unused inventory return to the Boardroom; remaining holders keep shares; the primary sale completes without automatic liquidity.
- Migration uses terminal marginal price `basePrice + floor(slope * soldShares / 1e18)`, allocates quote first, derives shares as `floor(quote * 1e18 / terminalPrice)`, returns excess shares, and enforces a 50 bps maximum AMM deviation. Permissionless deterministic migration and economic simulations cover rounding and price continuity.
- Quote forfeiture is impossible before wind-down. After 30 days quarantined, a 7-day window opens; an eligible staker with at least 1% at current and previous blocks may veto. Without veto anyone finalizes. Quote recovered after the redemption snapshot goes to the immutable excess recipient.

### Protocol-owned liquidity

`Unconfigured -> Active -> Closed`, with one permanent quote identity, pool, and locker.

- Pre-launch owner setup is immediate. Repeated adds target the same position. Zero LP is not closure; closure is explicit, empty-only, reservation-free, and irreversible.
- After launch, partial/full removal while Active requires delayed controller governance and returns assets only to the Boardroom. During WindingDown, full exit is permissionless with hostile-token LP fallback. Snapshotting and RedemptionsOpen reject mutation.
- Curve migration consumes the singleton reservation and creates the first canonical position atomically. Releasing a reservation never clears the permanent quote identity.

## Validation evidence

- `forge --version`: Foundry `1.7.1`, commit `4072e48705af9d93e3c0f6e29e93b5e9a40caed8`.
- `bun --cwd packages/contracts build`: pass; expected Foundry lint warnings reported.
- `bun --cwd packages/contracts test`: pass, 324 tests, 0 failures.
- `bun run test`: pass; contracts 324, SDK 40, web 447, all zero failures.
- `bun --cwd services/sentinel test`: pass; 122 passed, 8 optional Postgres integration tests skipped, 0 failed; TypeScript passed.
- `bun run build`: pass for contracts, generated SDK, web, and embedded docs.
- `bun run docs:check`: pass; 36 pages/navigation entries, links, titles, product claims, and deployment status checked.
- `bun run docs:build`: pass; 36 routes built and validated.
- `bun run format:check`: pass.
- `git diff --check`: pass.
- `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres bun run sentinel:integration:anvil`: pass against disposable Postgres and fresh Anvil. It deployed/seeded v5, proved EOA controller control at a pinned finalized block, rejected replay, and exercised scheduled, vetoed, cancelled, policy-admin, and watcher paths.
- Final `forge test --gas-report`: every suite passed on the exact final tree, including 256 runs × 128,000 calls for each wind-down invariant with zero handler reverts.

## Contract size and maximum-gas evidence

| Contract | Runtime bytes | Runtime margin | Init bytes | Init margin |
| --- | ---: | ---: | ---: | ---: |
| Boardroom | 24,215 | 361 | 24,763 | 24,389 |
| BoardroomController | 7,438 | 17,138 | 7,575 | 41,577 |
| BoardroomControllerFactory | 2,030 | 22,546 | 9,870 | 39,282 |
| BoardroomFactory | 2,448 | 22,128 | 47,617 | 1,535 |
| BoardroomMarketLogic | 9,774 | 14,802 | 9,802 | 39,350 |
| DistributionFactory | 10,594 | 13,982 | 39,023 | 10,129 |
| LockedLiquidityFactory | 15,962 | 8,614 | 22,996 | 26,156 |
| MigratingBondingCurve | 16,192 | 8,384 | 16,329 | 32,823 |

| Function | Observed maximum gas |
| --- | ---: |
| Boardroom.executeBatch | 2,730,190 |
| Boardroom.snapshotAssets | 1,176,149 |
| Boardroom.launch | 404,811 |
| BoardroomController.executeBoardroomOperation | 723,467 |
| Boardroom.startWindDown | 128,590 |
| MigratingBondingCurve.migrate | 1,707,635 |
| MigratingBondingCurve.finalizeUnwind | 351,470 |
| MigratingBondingCurve.finalizeQuoteForfeiture | 243,617 |
| MigratingBondingCurve.recoverForfeitedQuote | 71,192 |
| MigratingBondingCurve.recoverQuarantinedQuote | 24,560 |
| MigratingBondingCurve.expire | 25,024 |

The many-operation wind-down test measured 22,012 gas for epoch invalidation, demonstrating constant-time cancellation. No lifecycle transition iterates over unbounded history.

## Blocker 02 exit-criterion mapping

| Criterion | Evidence/status |
| --- | --- |
| Decisions approved and recorded | Met; user approved all four remaining gates. |
| Dedicated controller and reciprocal binding | Implemented and adversarially tested. |
| Internal Boardroom action storage removed | Implemented; controller owns scheduling state. |
| Atomic launch binds all security values | Implemented; mismatch matrix rolls back without a controller. |
| Named 10% current/previous protection staker | Implemented with eligible-supply and encumbrance checks. |
| No pre-launch/pre-replacement controller | Implemented with deterministic prediction and atomic deployment. |
| EOA/Safe ERC-1271 | Implemented and tested recursively. |
| Canonical generation-bound offchain challenge | Implemented with pinned finalized reads and atomic consumption. |
| Chain-scoped identity and revocation | Implemented; proposer/epoch/generation/configuration drift fails closed. |
| Fresh proof for every privileged write | Implemented; sessions and prior claims cannot substitute. |
| Veto and constant-time wind-down | Implemented; 22,012-gas many-operation invalidation evidence. |
| Independent Active/epoch enforcement | Implemented in Boardroom and controller. |
| Replacement blocked outside Active | Implemented and tested against direct and wrapped calls. |
| Wind-down delay/excess recipient preserved | Implemented across launch and replacement. |
| Contract/SDK/web/docs coverage | Implemented and green locally. |
| New deterministic release identity | v5 salts, deployment artifacts, release helpers, and fail-closed discovery implemented. |
| Legacy/unknown blocked | Implemented in launch, SDK, web, watcher, and control proof. |
| Independent security review | **Open external requirement.** |
| Public-testnet product rehearsal | One funded fixed-price x402 path passed on HyperEVM testnet; the complete lifecycle remains open. |

## Blocker 05 exit-criterion mapping

| Criterion | Evidence/status |
| --- | --- |
| Architecture directions approved | Met in blocker 05. |
| Four remaining economic/lifecycle gates approved | Met and encoded exactly as listed above. |
| Mapping/count obligation model | Implemented with ERC-7201 storage. |
| Tombstones and reentrancy-safe transitions | Implemented and adversarially tested. |
| Capacity reservations/constants removed | Grant slots and concurrent obligation ceilings removed; transaction/reward/pending-unstake bounds retained. |
| Event/paginated discovery | Implemented without protocol liveness dependency. |
| Explicit-state liquidity singleton | Implemented with repeated add, conditional removal, hostile fallback, and irreversible close tests. |
| Lifetime curve and monotonic mode | Implemented in Boardroom and factory. |
| Token-boundary exclusivity/old allowances | Implemented and tested. |
| Transferee sells/global liability/forced progress | Implemented and tested. |
| Price continuity/deviation | Implemented and covered by deterministic and fuzz economic simulation. |
| Terminal paths/reservation/permanent quote | Implemented, including quarantine and wind-down-only forfeiture. |
| Dependency-count paginated snapshotting | Implemented with unreadable-asset handling and no unbounded loop. |
| Named namespaced storage | Implemented; exact ERC-7201 namespaces are tested distinct. |
| Cross-package surfaces | Contracts, deployment, SDK, web, Sentinel, and docs updated and green locally. |
| Selected release-chain max gas | The funded fixed-price execution used 321,805 gas on HyperEVM testnet; **complete selected-chain maximum-gas proof remains open.** |
| Independent security/economic review | **Open external requirement.** |

## Unresolved risks and release blockers

- Boardroom has only 361 runtime bytes of EIP-170 headroom; further changes need size discipline.
- Foundry reports timestamp and demonstrably-safe uint64-cast lint warnings; these should be considered during independent review.
- One limited funded fixed-price x402 rehearsal passed on HyperEVM testnet; complete lifecycle and selected-chain
  maximum-gas proof remain open. See `packages/contracts/deployments/998-lifecycle.json`.
- No independent security or economic review has occurred for this exact tree.
- Blockers 01, 03, and 04 remain open: release-candidate proof, production authority ceremony, and independent security assurance.
- A verified HyperEVM testnet deployment and limited funded canary now exist. No mainnet deployment occurred.

## Every implementation file changed

Status is relative to baseline `aa774c5291d8ce655bcd34182c35ec02fffbcc7e`. `D` is the removed legacy storage file; `A` is new; `M` is modified.

- M `apps/web/src/app/App.tsx`
- M `apps/web/src/app/pages/governance-page.tsx`
- M `apps/web/src/app/pages/project-page.tsx`
- M `apps/web/src/app/pages/studio-page.tsx`
- M `apps/web/src/app/pages/transparency-page.tsx`
- M `apps/web/src/app/views/project-context.tsx`
- M `apps/web/src/app/views/sentinel-settings.tsx`
- M `apps/web/src/app/views/workspace-helpers.ts`
- M `apps/web/src/features/boardrooms/boardroom-panel-shared.tsx`
- M `apps/web/src/features/boardrooms/boardroom-panel-types.ts`
- M `apps/web/src/features/boardrooms/boardroom-panel.tsx`
- M `apps/web/src/features/boardrooms/product-boardroom-dashboard.tsx`
- M `apps/web/src/features/capabilities/project-capabilities.ts`
- M `apps/web/src/features/governance/governance-launch-control.tsx`
- M `apps/web/src/features/governance/governance-proposal-composer.tsx`
- M `apps/web/src/features/governance/governance-queue.tsx`
- M `apps/web/src/features/governance/types.ts`
- M `apps/web/src/features/governance/view-model.ts`
- M `apps/web/src/features/notifications/delivery-activity.tsx`
- M `apps/web/src/features/notifications/governance-activity.tsx`
- M `apps/web/src/features/participation/bonding-curve-flow.tsx`
- M `apps/web/src/features/rewards/boardroom-rewards-panel.tsx`
- M `apps/web/src/lib/boardroom-snapshot.ts`
- M `apps/web/src/lib/deployment.ts`
- M `apps/web/src/lib/forms.ts`
- M `apps/web/src/lib/governance-actions.ts`
- M `apps/web/src/lib/governance-refresh.ts`
- M `apps/web/src/lib/product-boardroom.ts`
- M `apps/web/src/lib/project-position.ts`
- M `apps/web/src/lib/transaction-preview.ts`
- M `apps/web/src/lib/types.ts`
- M `apps/web/test/app.smoke.test.tsx`
- M `apps/web/test/governance-actions.test.ts`
- M `apps/web/test/governance-controls.test.tsx`
- M `apps/web/test/notification-delivery.test.tsx`
- M `apps/web/test/participate-swap-surfaces.test.tsx`
- M `apps/web/test/participation-flows.test.tsx`
- M `apps/web/test/product-boardroom.test.ts`
- M `apps/web/test/product-market-surfaces.test.tsx`
- M `apps/web/test/product-pages.test.tsx`
- M `apps/web/test/project-capabilities.test.ts`
- M `apps/web/test/project-evidence.test.ts`
- M `apps/web/test/project-position.test.ts`
- M `apps/web/test/runtime-deployment.test.ts`
- M `apps/web/test/transactions.test.ts`
- M `apps/web/test/transparency-governance-alerts-ux.test.tsx`
- M `apps/web/test/workflow-form-semantics.test.tsx`
- M `docs/amm-protocol.md`
- M `docs/boardroom-protocol.md`
- M `docs/bond-market-protocol.md`
- M `docs/deployment.md`
- M `docs/distribution-protocol.md`
- A `docs/mainnet-readiness/06-implementation-evidence.md`
- M `docs/pages/developers/boardroom.md`
- M `docs/pages/developers/deployment-and-local-scenarios.md`
- M `docs/pages/developers/distributions-and-airdrops.md`
- M `docs/pages/guides/claim-airdrop.md`
- M `docs/pages/guides/create-and-operate-project.md`
- M `docs/pages/guides/evaluate-and-join.md`
- M `docs/pages/guides/govern-a-project.md`
- M `docs/pages/guides/wind-down-and-redeem.md`
- M `docs/pages/index.md`
- M `docs/pages/reference/glossary.md`
- M `docs/pages/reference/networks-and-deployments.md`
- M `docs/pages/reference/troubleshooting.md`
- M `docs/pages/start/choose-your-path.md`
- M `docs/pages/start/networks-and-limitations.md`
- M `docs/pages/start/use-safely.md`
- M `docs/pages/understand/boardrooms-and-project-tokens.md`
- M `docs/pages/understand/distributions-and-liquidity.md`
- M `docs/pages/understand/governance-and-holder-protections.md`
- M `docs/pages/understand/staking-and-rewards.md`
- M `docs/pages/understand/treasury-obligations-and-redemptions.md`
- M `docs/pages/using/explore.md`
- M `docs/pages/using/grant-details.md`
- M `docs/pages/using/portfolio.md`
- M `docs/pages/using/project-workspace.md`
- M `docs/pages/using/studio.md`
- M `docs/pages/using/tools-and-alerts.md`
- M `docs/project-token-launch.md`
- M `docs/rewards-protocol.md`
- M `docs/token-grant-protocol.md`
- M `packages/contracts/deployments/10143.json`
- M `packages/contracts/deployments/998.json`
- M `packages/contracts/script/Deploy.s.sol`
- M `packages/contracts/script/hyperevm-testnet/verify-artifact.sh`
- M `packages/contracts/script/ProjectTokenLaunchScenario.s.sol`
- M `packages/contracts/script/SeedLocal.s.sol`
- M `packages/contracts/src/boardroom/Boardroom.sol`
- A `packages/contracts/src/boardroom/BoardroomController.sol`
- A `packages/contracts/src/boardroom/BoardroomControllerFactory.sol`
- M `packages/contracts/src/boardroom/BoardroomFactory.sol`
- M `packages/contracts/src/boardroom/BoardroomGovernanceLogic.sol`
- D `packages/contracts/src/boardroom/BoardroomGovernanceStorage.sol`
- A `packages/contracts/src/boardroom/BoardroomMarketLogic.sol`
- M `packages/contracts/src/boardroom/BoardroomRedemptionPayout.sol`
- M `packages/contracts/src/boardroom/BoardroomRedemptionStorage.sol`
- M `packages/contracts/src/boardroom/BoardroomToken.sol`
- A `packages/contracts/src/boardroom/IBoardroomGovernance.sol`
- A `packages/contracts/src/boardroom/storage/BoardroomAssetStorage.sol`
- A `packages/contracts/src/boardroom/storage/BoardroomCoreStorage.sol`
- A `packages/contracts/src/boardroom/storage/BoardroomLiquidityStorage.sol`
- A `packages/contracts/src/boardroom/storage/BoardroomObligationStorage.sol`
- A `packages/contracts/src/boardroom/storage/BoardroomPrimaryMarketStorage.sol`
- M `packages/contracts/src/bonds/BondMarketFactory.sol`
- M `packages/contracts/src/deployment/PledgeCashDeploymentSalts.sol`
- M `packages/contracts/src/distribution/DistributionFactory.sol`
- M `packages/contracts/src/distribution/MigratingBondingCurve.sol`
- M `packages/contracts/src/grants/TokenGrantFactory.sol`
- M `packages/contracts/src/liquidity/LockedLiquidity.sol`
- M `packages/contracts/src/liquidity/LockedLiquidityFactory.sol`
- M `packages/contracts/src/policy/IBoardroomObligationPolicy.sol`
- M `packages/contracts/src/rewards/BoardroomRewardsFactory.sol`
- M `packages/contracts/test/boardroom/Boardroom.t.sol`
- A `packages/contracts/test/boardroom/BoardroomController.t.sol`
- A `packages/contracts/test/boardroom/BoardroomStorageNamespace.t.sol`
- M `packages/contracts/test/boardroom/BoardroomWindDownInvariant.t.sol`
- M `packages/contracts/test/bonds/BondMarket.t.sol`
- M `packages/contracts/test/deployment/DeterministicDeployment.t.sol`
- A `packages/contracts/test/distribution/BondingCurveEconomicSimulation.t.sol`
- M `packages/contracts/test/distribution/Distribution.t.sol`
- M `packages/contracts/test/grants/TokenGrantLifecycleBoundary.t.sol`
- M `packages/contracts/test/liquidity/LockedLiquidity.t.sol`
- M `packages/contracts/test/liquidity/MigrationReservationBoundary.t.sol`
- M `packages/contracts/test/rewards/BoardroomRewards.t.sol`
- M `packages/sdk/scripts/generate.ts`
- M `packages/sdk/src/generated.ts`
- M `packages/sdk/src/helpers.ts`
- M `packages/sdk/src/helpers/discovery.ts`
- M `packages/sdk/src/helpers/governance.ts`
- M `packages/sdk/src/helpers/readers.ts`
- A `packages/sdk/src/helpers/releases.ts`
- M `packages/sdk/src/helpers/transactions.ts`
- M `packages/sdk/src/helpers/types.ts`
- M `packages/sdk/test/domain.test.ts`
- M `packages/sdk/test/generated.test.ts`
- M `packages/sdk/test/governance.test.ts`
- M `packages/sdk/test/helpers.test.ts`
- A `packages/sdk/test/releases.test.ts`
- A `services/sentinel/drizzle/0007_blushing_the_hand.sql`
- A `services/sentinel/drizzle/0008_stale_silhouette.sql`
- A `services/sentinel/drizzle/0009_slippery_bromley.sql`
- M `services/sentinel/drizzle/meta/_journal.json`
- A `services/sentinel/drizzle/meta/0007_snapshot.json`
- A `services/sentinel/drizzle/meta/0008_snapshot.json`
- A `services/sentinel/drizzle/meta/0009_snapshot.json`
- M `services/sentinel/README.md`
- M `services/sentinel/scripts/integration-anvil.ts`
- M `services/sentinel/src/analysis/analyze.ts`
- M `services/sentinel/src/analysis/prompt.ts`
- M `services/sentinel/src/analysis/templates.ts`
- M `services/sentinel/src/analysis/workspace.ts`
- M `services/sentinel/src/api/auth.ts`
- A `services/sentinel/src/api/boardroom-control-store.ts`
- M `services/sentinel/src/api/dto.ts`
- A `services/sentinel/src/api/routes/boardroom-control.ts`
- M `services/sentinel/src/api/server.ts`
- M `services/sentinel/src/api/store.ts`
- A `services/sentinel/src/chain/boardroom-control.ts`
- A `services/sentinel/src/chain/governance-events.ts`
- A `services/sentinel/src/chain/market-events.ts`
- M `services/sentinel/src/chain/watcher.ts`
- M `services/sentinel/src/db/schema.ts`
- M `services/sentinel/src/index.ts`
- M `services/sentinel/src/notify/fanout.ts`
- M `services/sentinel/src/notify/render.ts`
- M `services/sentinel/src/pipeline.ts`
- M `services/sentinel/src/risk/engine.ts`
- M `services/sentinel/src/risk/matrix.ts`
- M `services/sentinel/src/types.ts`
- M `services/sentinel/test/analysis.test.ts`
- M `services/sentinel/test/api-store.test.ts`
- M `services/sentinel/test/api.test.ts`
- A `services/sentinel/test/boardroom-control-chain.test.ts`
- A `services/sentinel/test/boardroom-control.test.ts`
- M `services/sentinel/test/dispatcher.test.ts`
- M `services/sentinel/test/fanout.test.ts`
- A `services/sentinel/test/market-events.test.ts`
- M `services/sentinel/test/render.test.ts`
- M `services/sentinel/test/risk-engine.test.ts`
- M `services/sentinel/test/telegram.test.ts`
- M `services/sentinel/test/watcher.test.ts`

## Preserved intentional assessment files

- `docs/mainnet-readiness/01-release-candidate-deployment.md`
- `docs/mainnet-readiness/02-secure-governance-launch.md`
- `docs/mainnet-readiness/03-production-authority-ceremony.md`
- `docs/mainnet-readiness/04-independent-security-assurance.md`
- `docs/mainnet-readiness/05-boardroom-lifecycle-data-model.md`

## Deployment confirmation

**No mainnet deployment occurred.** The current release remains a mainnet NO-GO.
