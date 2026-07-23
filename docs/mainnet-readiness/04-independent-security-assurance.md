# Hard release blocker 4: independent security assurance is incomplete

Status: **Blocked**

Scope: the frozen contract release, deployment and verification tooling, generated SDK contract surface, artifact
parsing and promotion, and critical product assumptions that can select or misrepresent asset-moving contracts.

## Release decision

Do not publish a mainnet release until the exact frozen release has completed independent review, remediation, and
re-review. Passing the current local suite and automated PR review is necessary evidence, but it is not sufficient
assurance for immutable software that can hold or move user assets.

This document does not require a claim that security is absolute. It requires a documented assurance process, explicit
residual-risk acceptance, and evidence tied to the exact deployed revision.

## Current strengths

The current repository has a stronger-than-average internal foundation:

- 320 normal Foundry tests pass, including stateful invariant suites;
- contract sizes fit EIP-170;
- SDK, web, Sentinel, docs, formatting, and production builds pass;
- asset movement generally uses exact balance-delta checks;
- hostile-token paths use bounded calls, explicit quarantine, or isolated per-asset failures;
- gas-sensitive Boardroom obligation and redemption loops are currently bounded; the accepted redesign must preserve
  transaction bounds without retaining arbitrary lifetime quotas;
- deterministic deployment records salts, init-code hashes, predicted addresses, and runtime hashes;
- the SDK and web application contain strong canonical-provenance and transaction-identity checks;
- documentation clearly describes many authority, custody, unknown-state, and recovery boundaries.

These properties reduce risk and make independent review more effective. They do not replace it.

## Current assurance gaps

### No protocol audit evidence

The repository contains audit artifacts for the Solady dependency, but no independent pledge.cash protocol audit report,
remediation report, or release-specific signoff was found. No public bug-bounty terms or launch bounty are defined.

Recent development cycles added the bond market, staking and rewards, and a broad product integration surface. Those
features materially expand custody, obligation, governance, pricing, and wind-down behavior and should not inherit
assurance from earlier, smaller revisions.

### No trustworthy current coverage report

The normal suite passes, but the current coverage command does not yield trustworthy numbers:

- `forge coverage --report summary` fails with `Stack too deep`;
- the Foundry-recommended `--ir-minimum` workaround compiles, but coverage instrumentation causes
  `testShareTokenCheckpointsTrackPastBalancesAndSupply()` to revert with `FutureCheckpointLookup(2, 2)`.

Coverage percentage is not a security proof, but the instrumentation failure prevents it from being used as reliable
release evidence and may conceal unmeasured branches.

### Conditional fork tests can silently do no work

The WETH/USDC/USDT grant fork tests return early when canonical Ethereum token code is unavailable. A green ordinary
Foundry run therefore does not prove those token lifecycles were exercised against a fork. Target-chain and supported
asset tests need an explicit required environment and must fail or report an unmistakable skip in release CI.

### Static and formal tooling is not a release gate

No pledge.cash release job currently requires a result from tools such as Slither, Aderyn, Echidna, Medusa, Halmos, or
an equivalent selected suite. Tool choice is secondary; the gate must cover the accepted threat model and produce
reviewable, triaged output.

### Tight governance bytecode margin

`BoardroomGovernanceLogic` is 23,407 bytes, leaving 1,169 bytes below the EIP-170 limit. This is currently deployable,
but it gives governance remediation and future lifecycle evolution little margin on EIP-170-constrained chains. Moving
scheduling into the external controller proposed by hard release blocker 2 should reduce this pressure, but the final
bytecode must be measured rather than assumed.

### Offchain Merkle safety remains operator-defined

Merkle distribution root uniqueness, allocation totals, encoding, timing, capacity, and manifest provenance remain
offchain responsibilities. The protocol documentation identifies end-to-end distribution cases that are not yet
covered. A mainnet release needs a canonical manifest builder and verifier tied to an exact root and artifact.

### Dependency and supply-chain gates are incomplete

At the time this blocker was written, `bun audit --production` failed with:

- a high-severity `ws` memory-exhaustion advisory through `viem`;
- a moderate `esbuild` development-server advisory through tooling.

The repository also uses mutable major-version GitHub Action references and does not currently produce a signed release
artifact, SBOM, or container provenance record. GitHub secret scanning and push protection are not enabled.

## Mandatory review scope

The independent review must cover the whole deployed system rather than only isolated source files.

### Contract state machines

- Boardroom initialization, issuance, atomic launch-time controller deployment, delayed external governance, veto,
  controller rotation, ERC-1271 offchain control proofs, wind-down, and redemption;
- Boardroom token custody exclusions, checkpoints, reward locks, minting, burning, and transfer behavior;
- reward funding, accrual, unstake cooldown, terminalization, and hostile reward assets;
- grants, paid settlement, holder rights, expiry, halt, quarantine, and Boardroom obligation accounting;
- fixed sales, Merkle airdrops, permanent singleton bonding curve, primary-market exclusivity, migration, cancellation,
  late recovery, and reservation cleanup;
- reserve and LP bond markets, price tuning, debt decay, vesting, redemption, closing, and wind-down interaction;
- AMM creation, swaps, fees, donations, hostile-token behavior, flash interaction, and locked liquidity;
- redemption snapshot, credits, partial payouts, retries, forfeiture, excess, and maximum-basket gas;
- module and obligation policy registration, disabling, lifecycle-only behavior, and asset/spender admission;
- deterministic deployment, salt ownership, root configuration, and authority handoff.

### Authority and economic properties

Review must explicitly challenge:

- exact controller/configuration binding during atomic launch;
- launch without a reward pool or active stake;
- executor loss and replacement limits;
- 1% veto and 10% irreversible wind-down thresholds;
- stake-age and one-block snapshot assumptions;
- 50-year bond obligations blocking final redemption;
- quarantine and late-recovery ownership;
- centralized root policy and asset controls;
- front-running, donation, first-liquidity, and price-discontinuity behavior;
- multi-chain deterministic identity and governance independence;
- no-upgrade and new-root migration assumptions.

### External calls and non-standard assets

Test and review:

- no-return, false-return, fee-on-transfer, sender-surcharge, rebasing, callback, malformed-return, gas-burning, pausing,
  blacklisting, and mutable-code/token behavior;
- exact sender and recipient balance-delta assumptions;
- reentrancy across tokens, pools, routers, grants, distributions, rewards, and Boardroom self-calls;
- bounded-gas failure, partial progress, retry, quarantine, and recovery paths;
- approval replacement for zero-first tokens;
- unsolicited balances and accounting donations.

### Deployment and product trust boundary

Review must include:

- chain-ID and RPC substitution resistance;
- deterministic salt and init-code verification;
- mainnet artifact schema and required fields;
- live runtime-code and immutable-wiring verification;
- generated ABI freshness;
- SDK target and calldata construction;
- web deployment acceptance and fail-closed behavior;
- transaction review, simulation, stale-state detection, and exact request submission;
- protected artifact promotion and release provenance.

## Required assurance work

### 1. Freeze and model the release

- Freeze the exact release revision after the design blockers are resolved.
- Treat [the Boardroom lifecycle redesign](05-boardroom-lifecycle-data-model.md) as audit scope, including obligation
  counters, singleton liquidity, pagination, migration, and terminal-state liveness.
- Write or update state-machine, asset-flow, authority, and external-call threat models.
- List every invariant and map it to tests, analysis, or an accepted residual risk.
- Produce a call graph and authority matrix for all production contracts.

### 2. Strengthen deterministic internal proof

- Restore a reliable coverage workflow or document a reviewed alternative that exposes untested branches.
- Make release fork tests fail when their required fork is absent.
- Add target-chain deployment and maximum-gas scenarios.
- Add invariant and stateful fuzzing across rewards, bonds, Boardroom governance, cross-module obligations, and
  wind-down/redemption.
- Add differential or independent-model tests for AMM, curve, reward, and bond arithmetic where practical.
- Add canonical Merkle manifest generation, verification, and adversarial fixtures.
- Test the complete lifecycle through generated SDK calls, not only direct Solidity calls.

### 3. Run automated analysis and triage every result

- Select and pin static, fuzzing, symbolic, and dependency-analysis tools appropriate to the codebase.
- Record exact commands and tool versions.
- Treat tool output as evidence requiring human triage, not as an automatic clean bill of health.
- Block release on unexplained high-severity results or tool failures.

### 4. Commission independent review

The reviewer must receive:

- the exact frozen commit and build instructions;
- architecture and threat-model documents;
- known design decisions and intentionally accepted behaviors;
- deterministic deployment and authority design;
- target-chain constraints;
- all internal findings and test limitations;
- permission to report design/economic findings, not only conventional Solidity exploits.

At least one remediation re-review must evaluate the final proposed deployed revision. Any code change after final review
must be classified and either independently reviewed or shown to be outside the audited trust boundary.

### 5. Prepare disclosure and bounty operations

- Define the supported release scope in `SECURITY.md` only after deployment is intended to be supported.
- Establish a private reporting route with monitored ownership and response expectations.
- Decide bounty scope, severity rubric, payout authority, embargo expectations, and duplicate handling.
- Rehearse intake, reproduction, emergency communication, mitigation, and public disclosure.

### 6. Harden release provenance

- Pin GitHub Actions by immutable commit.
- Enable secret scanning and push protection where available.
- Add dependency-audit policy with documented reachability waivers.
- Produce an SBOM for shipped web and Sentinel artifacts.
- Sign or attest release artifacts and container images.
- Require protected tags and independent artifact-promotion approval.

## Finding disposition rules

Every independent finding must have one disposition:

1. **Fixed:** code, tests, and documentation changed; reviewer verifies the remediation.
2. **Design changed:** the accepted protocol behavior changes and receives full regression review.
3. **Not applicable:** supported by concrete reachability or invariant evidence and accepted by an independent reviewer.
4. **Accepted residual risk:** impact, likelihood, affected assets, operator/user mitigation, owner, and approval are
   recorded publicly where disclosure is safe.

“Tests pass,” “intended behavior,” and “unlikely” are not sufficient dispositions by themselves.

## Exit criteria

This blocker is cleared only when all of the following are true:

- [ ] The exact contract and deployment release is frozen.
- [ ] Threat models, authority maps, asset flows, and lifecycle invariants are current.
- [ ] Required fork and target-chain tests cannot silently skip.
- [ ] Coverage or an accepted branch-assurance alternative produces trustworthy release evidence.
- [ ] Selected static, fuzzing, symbolic, and dependency gates pass with triaged output.
- [ ] Maximum contract size and maximum lifecycle gas are tested on the target chain.
- [ ] A canonical Merkle manifest builder and verifier are part of the release process.
- [ ] An independent whole-system audit of the frozen release is complete.
- [ ] Every actionable finding is fixed or explicitly dispositioned.
- [ ] The independent reviewer has evaluated the final remediated revision.
- [ ] A private reporting and launch bounty process is staffed and funded.
- [ ] Release provenance, SBOM, dependency policy, and artifact attestations are available.
- [ ] The deployed revision exactly matches the reviewed and tagged revision.

Independent review reduces uncertainty; it does not transfer responsibility. The final go/no-go decision remains with
the project authorities identified in
[hard release blocker 3](03-production-authority-ceremony.md).
