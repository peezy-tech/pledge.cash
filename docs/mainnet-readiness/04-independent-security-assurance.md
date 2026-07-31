# Hard release blocker 4: independent security assurance is incomplete

Status: **Blocked**

Scope: the frozen canonical contract release, global facet authority and
migrations, deployment/verification tooling, generated SDK surface, artifact
promotion, application/service release gates, and economic assumptions.

## Release decision

Do not publish a mainnet release until the exact frozen revision has completed
independent review, remediation, and re-review. Local tests, a clean pull
request review, and a successful testnet rehearsal are necessary evidence, not
a substitute for an audit of software that can hold and reroute user assets.

## Current strengths

- The protocol has one canonical Boardroom ABI and implementation line.
- Kernel, registry, and facets remain below explicit conservative runtime-size
  targets.
- Complete releases commit ordered selectors, route kinds, facet addresses,
  runtime code hashes, storage requirements, migration metadata, and human
  manifests.
- Every mutation and controller authorization binds an expected facet-set
  hash.
- Business state and kernel metadata use distinct ERC-7201 namespaces.
- Obligation, snapshot, redemption, market, and liquidity transitions are
  bounded or paginated.
- Focused behavior, controller, module, routing, migration, and stateful
  wind-down suites pass.
- A fresh local deployment and standalone verifier check deterministic
  provenance, all 97 release-A routes, code hashes, ownership, wiring, policy,
  and fee state.

The exact evidence and pending final-suite boundary are recorded in the
[canonical design/evidence report](../design/boardroom-diamondization-spike.md).

## Principal assurance gaps

### No release-specific independent audit

No independent pledge.cash report or remediation re-review covers the exact
canonical registry/kernel/facet architecture and its complete module graph.

### Global release authority

`ProtocolFacetRegistry.owner()` can change every Boardroom's behavior,
including custody and redemption semantics, in every lifecycle state.
Expected-hash binding prevents semantic surprise but not a malicious release.
The audit must treat governance, release construction, activation calldata,
facet code, storage commitments, and migration liveness as one custody
boundary.

### Migration and terminal-state risk

A higher storage version intentionally pauses writes on each Boardroom until
permissionless migration succeeds. A bug, unaffordable migration, incompatible
terminal state, or malicious facet can strand assets. Local release B is
evidence of the mechanism, not proof for future migrations.

### Complete-table activation cost

Publishing and activating a complete selector table is expensive. Final
measurements must fit each target chain's intended execution lane and include
an emergency higher-numbered rollback release.

### External and non-standard assets

Hostile-token coverage is substantial but cannot enumerate arbitrary mutable,
rebasing, callback, fee, blacklist, gas-burning, or malformed-return behavior.
Exact supported-asset assumptions and residual failure modes require audit and
target-chain fixtures.

### Offchain trust boundaries

SDK builders, web release hydration, Sentinel control proofs,
artifact parsers, and receipt discovery must pin coherent block/release
identity and fail closed on pending deployments, code-hash drift, stale hashes,
and migration downtime.

### Release and supply-chain assurance

The final dependency audit, static/symbolic analysis, required fork tests,
SBOM/provenance, protected artifact promotion, tag, and bounty process are not
yet release gates.

## Mandatory review scope

### Registry, kernel, and facets

- release publication validation and canonical hashing;
- selector add/replace/remove semantics and kernel-reserved selectors;
- activation atomicity, predecessor/release monotonicity, code-hash checks, and
  higher-numbered rollback;
- delegatecall context, native value, returndata/revert fidelity, unknown or
  removed selectors, and registry failure;
- forced rollback of View routes and malicious facet behavior;
- shared reentrancy protection and ERC-7201 slot isolation;
- expected-hash extraction and every state-changing ABI;
- migration permissionlessness, locking, rollback, exact postconditions,
  terminal lifecycle behavior, and repeated attempts.

### Boardroom and module state machines

- creation, issuance, launch, external controller, veto, replacement, and
  ERC-1271 control proofs;
- rewards, grants, distributions, curves, bonds, Uniswap v4 integration, and P4LP liquidity;
- obligation provenance, dependencies, pruning, and module disabling;
- primary-market exclusivity and curve price/unwind/quarantine economics;
- singleton liquidity reservation, migration, removal, hostile fallback, and
  closure;
- wind-down, frozen snapshot, credits, independent payouts, retries, and
  excess.

### Authority and economic review

- registry governor, timelock, quorum, veto, emergency, and signer compromise;
- release changes during active redemptions;
- migration gas and permanently unmigratable Boardrooms;
- 1% veto and 10% wind-down thresholds;
- current/previous-block stake and eligible-supply assumptions;
- donation, front-running, rounding, price continuity, and fee extraction;
- quarantine and post-snapshot ownership;
- multi-chain governance and deterministic-address assumptions.

### Deployment and product boundary

- bytecode-bound salts and first-use init-code commitments;
- chain/RPC substitution and source-commit cleanliness;
- candidate artifact and minimized receipt schema;
- independent recreation of all 97 routes and code hashes;
- ownership handoff, reciprocal wiring, policies, and fee routes;
- generated ABI freshness and explicit expected-hash builders;
- coherent pinned-block release reads in SDK, web, and Sentinel;
- protected artifact promotion and fail-closed client behavior.

## Required assurance work

1. Freeze the exact reviewed commit, compiler inputs, dependency locks,
   manifests, storage commitments, and deployment calldata.
2. Map every state machine, asset flow, authority, external call, and invariant
   to tests, analysis, or an explicitly accepted residual risk.
3. Restore reliable branch-assurance evidence and make required fork/target
   tests fail unmistakably when unavailable.
4. Run pinned static, fuzzing, symbolic, dependency, and supply-chain tooling;
   triage every result.
5. Commission a whole-system contract and economic audit that includes release
   governance and product/service identity handling.
6. Re-review the final remediation commit and repeat exact-head acceptance and
   public-testnet proof.
7. Establish reporting, bounty, signer-incident, release-withdrawal, and
   higher-numbered emergency-release procedures.

## Exit criteria

- [ ] Exact release revision and compiler/dependency inputs are frozen.
- [ ] Threat models, authority maps, asset flows, and invariant mapping are
      current.
- [ ] Required fork and target-chain tests cannot silently skip.
- [ ] Static, stateful, symbolic, dependency, and branch-assurance gates pass
      with reviewed output.
- [ ] Maximum deployment, publication, activation, migration, and lifecycle
      gas fit the selected chain.
- [ ] Independent whole-system security and economic review is complete.
- [ ] Every finding is fixed, independently dispositioned, or accepted with a
      named residual-risk owner.
- [ ] The reviewer has evaluated the final remediated revision.
- [ ] A private reporting and launch-bounty process is staffed.
- [ ] Release provenance, SBOM, protected tag, and independent artifact
      promotion are available.
- [ ] The deployed revision and active release exactly match the reviewed
      evidence.

Independent review reduces uncertainty; it does not transfer responsibility.
The final go/no-go remains with the authorities defined in
[hard release blocker 3](03-production-authority-ceremony.md).
