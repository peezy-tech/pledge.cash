# Hard release blocker 2: secure Boardroom governance launch

Status: **Implemented locally; blocked on final proof, audit, and public
rehearsal**

Scope: Boardroom ownership, delayed execution, proposer authority,
release-bound authorization, holder veto, controller replacement, wind-down,
and offchain controller proofs.

## Accepted architecture

A Boardroom is created without a controller. Launch atomically asks the
factory-bound `BoardroomControllerFactory` to deploy generation 1, verifies the
complete supplied configuration, records it, advances the governance epoch,
and transfers Boardroom ownership to that controller.

The controller address is predictable before launch but must have no code.
Replacement is a delayed Boardroom self-operation that deploys generation
`n + 1` only during execution. No replacement controller exists early.

The controller stores schedules and status; the Boardroom remains the
asset-holding policy, obligation, veto, and terminal-state boundary. A
controller cannot directly move Boardroom assets or call third parties on its
behalf.

## Canonical release binding

The global `ProtocolFacetRegistry` controls Boardroom logic. Every
state-changing Boardroom call takes an explicit expected facet-set hash, and
the kernel checks the active hash plus applied/required storage version and
layout before delegation.

Controller operation identity commits:

- Boardroom;
- expected facet-set hash;
- the complete ordered call batch or controller self-call;
- user salt;
- Boardroom governance epoch;
- controller generation;
- controller configuration epoch;
- proposer and configuration hash.

Scheduling, signatures, and execution never substitute a freshly fetched hash
for the caller's authorized hash. Registry activation makes old operations and
proofs stale. A storage-version activation also blocks ordinary writes until
the Boardroom's permissionless migration completes.

## Authority and lifecycle

- Before launch, the Boardroom owner may use policy-checked calls directly.
- After launch, only the current proposer schedules; anyone may execute a ready,
  unexpired operation.
- The permissionless executor is never substituted for the scheduled proposer
  at the Boardroom policy gateway.
- Proposer, delay, and grace-period changes are delayed controller
  self-operations and advance the configuration epoch.
- The Boardroom is the controller's immutable canceller.
- A current-and-previous-block 1% active staker may veto.
- A named current-and-previous-block 10% protection staker must exist at
  launch, and a qualifying holder may start wind-down.
- Starting wind-down advances the Boardroom epoch and invalidates all prior
  operations in constant time.
- Generic ownership transfer, handover, and renunciation are unavailable after
  launch.

## Offchain ERC-1271 proof

The controller's ERC-1271 surface proves current proposer authority only; it
cannot schedule or execute governance.

The canonical signature envelope and EIP-712 digest bind:

- original message hash;
- chain and controller domain;
- Boardroom;
- facet-set hash;
- Boardroom epoch;
- controller generation;
- controller configuration epoch and hash;
- proposer signature.

Validation fails closed for malformed envelopes, a pending or mismatched
deployment/release, migration downtime, non-Active lifecycle, topology or
generation drift, configuration drift, failed pinned-block reads, or an
invalid EOA/contract-proposer signature.

Hosted challenges additionally bind audience/domain, destination, scope,
nonce, issued time, and expiry. A service session establishes identity only;
every privileged Boardroom write needs a fresh challenge and current proof.

## Required invariants

1. A controller is permanently bound to one canonical Boardroom and its bound
   factory.
2. Launch adopts only the exact predicted generation-1 controller and complete
   calldata configuration.
3. Launch reverts controller deployment and every Boardroom state change if any
   relationship or security value fails.
4. The named protection staker satisfies both current and previous-block
   thresholds at launch.
5. No controller or proposer can execute before the delay.
6. Any account can execute ready work without becoming policy authority.
7. Operations and signatures cannot survive a facet-set, Boardroom epoch,
   controller generation, or configuration change.
8. A qualifying staker can veto any pending operation kind but cannot fabricate
   execution.
9. Wind-down invalidates an arbitrary operation history without iteration.
10. Controller replacement cannot bypass delay, policy, Active status,
    release binding, or expected-generation checks.
11. Release migration cannot be bypassed through the controller or ERC-1271
    path.
12. Redemption-excess recipient and wind-down delay retain their explicit
    semantics across launch and replacement.

## Focused evidence

The canonical controller suite currently records 19 passing tests. The
registry/kernel/Boardroom suites cover stale hashes, queued operations,
release-bound signatures, wrong migrations, in-flight activation, and
fail-closed routing. The integrated local scenario exercises launch,
scheduling, permissionless execution, wind-down, release-B activation,
pre-migration write rejection, migration, and resumed terminal operation.

The exact counts and commands are maintained in the
[canonical design/evidence report](../design/boardroom-diamondization-spike.md).

## Exit criteria

- [x] Dedicated controller and reciprocal Boardroom/factory binding are
      implemented.
- [x] Launch binds every security-relevant value and deploys generation 1
      atomically.
- [x] No controller exists before launch and no replacement exists before its
      delayed transition.
- [x] Operations and ERC-1271 proofs bind the expected facet-set hash.
- [x] Holder veto, wind-down, epoch invalidation, and permissionless execution
      use bounded state transitions.
- [x] EOA and recursive contract-proposer ERC-1271 paths are implemented.
- [ ] Final exact-head contract, SDK, web, and Sentinel suites are green.
- [ ] Safe-version, fallback-handler, nested contract-proposer, and RPC-limit
      compatibility matrices are independently reviewed.
- [ ] The exact release has passed independent security review.
- [ ] A promoted public-testnet deployment has completed launch, scheduling,
      veto, execution, controller rotation, facet activation, migration, and
      wind-down through supported product paths.

Until the open items close, the implemented governance model is local release
evidence, not mainnet authorization.
