# Hard release blocker 2: Boardroom governance has the wrong contract boundary

Status: **Architecture accepted; blocked on implementation and proof**

Scope: Boardroom ownership, delayed execution, proposer authority, holder veto, controller replacement, wind-down, and
every product path that presents a Boardroom as launched or governed.

## Release decision

Do not deploy the current Boardroom as a supported mainnet release. The immediate `launch(uint256)` intent-binding bug
is real, but changing that selector is no longer a sufficient remedy. Delayed governance should be moved out of the
asset-holding Boardroom and into one dedicated external controller or timelock per Boardroom.

The Boardroom should remain the custody, policy, accounting, veto, and terminal-state boundary. It should not also be
the scheduler and operation store.

## Current behavior

The current [Boardroom](../../packages/contracts/src/boardroom/Boardroom.sol) combines two state machines:

1. the project treasury and obligation lifecycle; and
2. an internal executor-queued timelock.

Before launch, the owner can execute allowed calls immediately. `launch(uint256)` then permanently enables the stored
executor and delay. The executor queues an action, anyone may execute it after the delay, qualifying stakers may cancel
it, and wind-down advances a governance epoch that invalidates queued actions.

There are two problems with retaining this design:

- `launch(uint256)` does not name or verify the executor whose authority becomes permanent; and
- scheduling, operation storage, expiry, cancellation, and execution materially enlarge the Boardroom's custody
  implementation and its already tight governance-logic bytecode budget.

Fixing only the first item would preserve the less desirable contract boundary.

## Accepted architecture direction

Each Boardroom exists without a controller while it is pre-launch. Its one launch transaction asks a canonical
controller factory to deploy or clone the first dedicated `BoardroomController` (name not final), binds the complete
expected configuration, and transfers Boardroom ownership to that controller atomically. Its deterministic address can
be predicted before launch, but that address has no code, is not adopted, and cannot queue operations until the launch
transaction deploys it.

```text
pre-launch owner --> Boardroom.launch(config)
                            |
                            | deploy and adopt generation 1
                            v
                   BoardroomController <--- schedule --- proposer EOA or Safe
                            |
                            | after delay; anyone executes
                            v
                  Boardroom governance gateway
                       policy checks and custody

qualifying staker --> Boardroom.veto(operationId) --> Controller.cancel(operationId)
qualifying staker --> Boardroom.startWindDown() --> epoch changes; old operations fail
```

The recommended default controller configuration is:

- one active canonical controller generation per Boardroom;
- one explicitly configured proposer, normally a project Safe or other deliberate authority;
- permissionless execution after the delay;
- the Boardroom itself as an immutable holder-veto canceller for every operation kind;
- no privileged controller administrator able to bypass the delay;
- proposer rotation and controller configuration changes only through delayed self-governance;
- no controller custody beyond accidental balances; and
- a permanent Boardroom binding established during launch-time controller initialization.

An [OpenZeppelin-style timelock](https://docs.openzeppelin.com/contracts/5.x/api/governance#TimelockController) may
supply useful scheduling primitives, but a thin Boardroom-specific controller or adapter is likely cleaner because the
protocol requires Boardroom-bound operations, staker cancellation, clone-safe initialization, and epoch invalidation.

## Onchain ownership and offchain proof of control

[ERC-1271](https://eips.ethereum.org/EIPS/eip-1271) is not how the Boardroom authorizes its controller onchain. It is the
accepted way for the offchain service to prove who currently controls a launched Boardroom.

Once ownership is transferred, the single Boardroom governance gateway recognizes an ordinary controller call because
`msg.sender == owner()`. That is not permission for the controller to bypass the gateway: minting, setters, asset
registration, and ownership changes should be Boardroom-self-call-only and reachable through policy-checked,
epoch-checked governance execution.

The launched Boardroom's onchain owner is the controller. The human or organization control authority is the
controller's current proposer. The controller must implement `isValidSignature(bytes32,bytes)` and validate through its
current proposer, supporting both an EOA signature and a contract proposer such as a Safe that implements ERC-1271.
This signature surface is for offchain proof of Boardroom control; it does not create a relayed path for scheduling or
executing governance operations.

The offchain verification flow uses a separate Boardroom-control challenge rather than Sentinel's ordinary wallet
sign-in or linking endpoint:

1. resolve the canonical Boardroom on the claimed chain;
2. verify it is launched and `owner()`, `controller()`, reciprocal controller binding, generation, and runtime identity
   all agree;
3. issue an exactly serialized SIWE challenge that commits to service audience, destination account or organization,
   requested scope, chain ID, Boardroom, controller, controller generation, controller-configuration epoch, nonce,
   issued time, and expiry;
4. have the current proposer authority sign the exact challenge;
5. compute the EIP-191 `hashMessage(exactSerializedSiweMessage)` digest and call the controller's ERC-1271 function
   with that digest and signature;
6. resolve every canonical relationship and make the signature call against one pinned finalized block, then compare
   every signed generation and configuration value; and
7. atomically consume the nonce and create the scoped Boardroom-control claim for the intended account or organization,
   keyed by `(chainId, boardroom, controller, controllerGeneration, configurationEpoch)`.

Controller replacement preserves the service's durable Boardroom record but revokes its prior control claim and
invalidates sessions or proofs naming an old controller, generation, configuration epoch, or proposer. RPC failure,
stale state, reorg uncertainty, malformed return data, and unsupported chains must fail closed.

A Boardroom-control proof must not create a permanent role. A contract proposer such as a Safe can change its internal
signers without changing the controller's proposer address or configuration epoch, and an old threshold signature may
remain valid after some Safe membership changes. Every privileged offchain write therefore requires a fresh server
nonce and signature checked against one current finalized-state snapshot. A Better Auth session identifies the user but
is never durable Boardroom authority. Safe-specific configuration fingerprinting may be added later but is not assumed.

If [SIWE](https://eips.ethereum.org/EIPS/eip-4361) is used as the challenge envelope, its address is the controller
contract, its chain ID is mandatory, and its session remains bound to that contract address as the standard requires.
The service must use chain-resolved contract-account verification rather than EOA recovery and must invalidate authority
when the controller's signature-validating state changes.

The current [Sentinel authentication model](../../services/sentinel/README.md) intentionally accepts only EOA signatures
and lacks this chain-scoped contract-account identity. The accepted change requires separate challenge and claim storage
keyed by the destination account or organization plus the complete onchain identity above; it does not silently turn
every controller into an ordinary wallet credential or merge same-address contract identities across chains.

## Responsibility split

### Controller

The controller should own only delayed-governance mechanics:

- proposer authorization;
- operation hashing and uniqueness;
- delay and grace period;
- schedule, cancel, and permissionless execute;
- delayed proposer or delay changes;
- an interface that lets its bound Boardroom cancel an operation after proving staker power; and
- ERC-1271 validation delegated to the current proposer strictly for offchain proof of control.

Controller operations should target only the bound Boardroom governance gateway or an explicitly allowed controller
self-operation. Asset-moving module calls must continue through the Boardroom's policy-checked execution surface rather
than letting the controller call arbitrary third-party contracts on the Boardroom's behalf.

Scheduling must require the launch-deployed active controller, an Active Boardroom, the current Boardroom governance
epoch, and the current controller-configuration epoch. Execution must consume state before external interaction, be
reentrancy-safe, and recheck both epochs and Boardroom status. Rotating the proposer or another security-critical
controller setting must advance the controller-configuration epoch so operations queued by the old authority cannot
execute later.

The Boardroom binding and Boardroom cancellation authority must be immutable. Delayed controller self-governance must
not be able to revoke staker veto, close permissionless execution, install an administrative bypass, or point the
controller at another Boardroom. `Boardroom.veto(operationId)` must be able to cancel Boardroom calls and controller
self-configuration alike.

### Boardroom

The Boardroom should retain:

- ownership by the active controller;
- project asset custody;
- module-policy authorization and post-call obligation registration;
- share issuance and other explicit project operations;
- governance epoch and lifecycle status;
- staker-power verification for veto and wind-down; and
- winding-down and redemption transitions.

Every active-state governance execution should enter through a gateway such as
`executeGovernance(expectedEpoch, authority, calls)`. Both the controller and Boardroom must independently require the
Boardroom to be Active and its epoch to match; merely including an epoch in an operation hash does not invalidate
anything. Starting wind-down must advance the epoch in constant time. This makes every pre-wind-down queued operation
stale without iterating over an unbounded external queue.

The policy registry's authority argument must remain the scheduled proposer or other explicitly chosen governance
authority. It must not accidentally become the permissionless account that happens to execute a ready operation.

Generic ownership transfer, handover, and renunciation entry points must be disabled after launch. Replacement is a
dedicated delayed Boardroom self-call that asks the canonical factory to deploy the next controller generation in that
same transaction, advances the Boardroom epoch, and atomically records the new controller and owner. A replacement
controller cannot exist or queue operations before that transition. An empty LP balance, lost proposer, or arbitrary
compatible contract is not sufficient replacement authority.

Moving scheduling out of the Boardroom must not remove the current safety delay between wind-down and final redemption
or the delay used by terminal liquidity handling. Store a separate validated `windDownDelay`, or snapshot the accepted
controller delay when wind-down starts; do not read a later mutable controller delay during finalization.

## Atomic launch and controller deployment

The factory topology should be explicit rather than inferred from an address passed at Boardroom creation:

- the release's `BoardroomFactory` constructor deploys one bound `BoardroomControllerFactory` with
  `address(BoardroomFactory)` as its immutable canonical-Boardroom registry;
- only then does `BoardroomFactory` deploy the Boardroom implementation, whose immutable controller-factory reference
  is that bound factory; and
- `BoardroomControllerFactory` accepts launch and replacement requests only from an address for which its immutable
  `BoardroomFactory.isBoardroom(address)` returns true, and binds the caller as the controller's Boardroom.

This removes a circular configuration choice, prevents a clone from selecting a spoofed controller factory, and still
leaves every individual controller undeployed until its Boardroom launches or performs a delayed replacement.

The supported launch flow is a single reviewed state transition:

1. create a Boardroom under its initial owner, with no controller deployment;
2. perform permitted pre-launch setup;
3. derive the deterministic controller address for generation 1 from the canonical controller factory;
4. have the owner call `launch(...)` with the expected controller address, proposer, `protectionStaker`, controller
   delay, immutable wind-down delay, grace period, and every launch prerequisite in reviewable calldata;
5. validate the canonical reward-pool identity, checkpoint history, controller prediction, all bounded configuration,
   and that the named `protectionStaker` meets the existing 10% wind-down threshold using both current active stake and
   previous-block active stake against the larger of the current and previous-block eligible-supply requirements,
   before any external effect;
6. have the Boardroom call the canonical factory, which atomically clones and initializes the controller for that exact
   Boardroom and generation;
7. verify the returned address, reciprocal binding, runtime code, proposer, delay, open execution, immutable Boardroom
   cancellation authority, and ERC-1271 support; and
8. record launch and controller generation, preserve the explicit redemption-excess recipient, and transfer ownership
   to the controller before the transaction completes.

Launch must be non-reentrant and revert the controller deployment and every Boardroom state change if any check fails.
It must not accept a preexisting arbitrary contract merely because it implements the right selectors. The factory must
accept creation only from the canonical Boardroom being bound, use a trusted immutable implementation with disabled
implementation initializers, initialize the clone in the deployment transaction, and prevent registry preemption.

The same factory path is used only inside an accepted delayed controller-generation replacement. The deterministic salt
must include the Boardroom and generation so launch and replacement addresses are reviewable without allowing a future
controller to exist early.

Because [BoardroomFactory](../../packages/contracts/src/boardroom/BoardroomFactory.sol) stores an immutable Boardroom
implementation, this redesign requires a new factory deployment and release identity. Existing clones cannot be
silently converted into the new implementation. That is acceptable before a supported public release and should not
be obscured by a compatibility shim.

## Accepted decisions

- The first controller is deployed only inside `launch`; Boardroom creation performs no controller deployment.
- The release uses one ControllerFactory immutably bound to its canonical BoardroomFactory; Boardrooms cannot select a
  different controller factory.
- The proposer may be an EOA or Safe, ready execution is permissionless, and there is no privileged emergency bypass.
- Launch names and verifies a `protectionStaker` that already satisfies both the current and previous-block 10%
  wind-down-power checks, so holder protection works immediately; aggregate stake without one qualifying account is
  insufficient.
- Controller-delay changes use delayed self-governance and remain inside the accepted onchain range.
- Wind-down uses a separately stored immutable delay rather than a later mutable controller value.
- Controller replacement uses a delayed atomic generation transition; a replacement does not exist beforehand.
- A lost proposer has no immediate recovery bypass. Holders retain veto over already queued operations and the accepted
  wind-down path.
- Proposer or security-configuration rotation advances a configuration epoch; operation identifiers are not reused.
- ERC-1271 is required for chain-scoped offchain proof of launched-Boardroom control, including EOA and Safe proposers.
- ERC-1271 does not authorize relayed governance scheduling in the first release.
- Legacy and unknown Boardrooms remain readable but fail closed for supported launch and ownership-proof flows.
- The current holder thresholds remain the first-release baseline and must be explicit in product review and audit.

## Required invariants

1. A controller is permanently bound to exactly one canonical Boardroom.
2. Launch deploys and transfers ownership only to the exact predicted controller and configuration named in signed
   calldata.
3. The controller factory is immutably paired with the release's canonical Boardroom factory, and no Boardroom clone
   can redirect deployment to another factory.
4. Launch cannot complete unless its named protection staker can start wind-down immediately under both current and
   previous-block power checks.
5. No controller administrator or proposer can execute before the delay.
6. Anyone can execute a ready operation, so proposer availability is not needed after scheduling.
7. Every operation commits to the Boardroom, calldata, salt, and expected governance epoch.
8. Every operation also commits to the current controller-configuration epoch; proposer rotation invalidates earlier
   queued operations.
9. A qualifying staker can cancel any pending operation kind, but cannot fabricate execution or redirect assets.
10. Starting wind-down invalidates all operations from prior epochs in constant time in both contracts.
11. No controller exists for the Boardroom before launch, and a replacement does not exist before its atomic generation
   transition.
12. Controller replacement cannot bypass the delay, policy registry, active status, or expected-controller binding.
13. Controller launch and replacement do not change the explicit redemption-excess recipient.
14. Pre-controller direct ownership is visibly distinct from launched delayed governance.
15. ERC-1271 offchain proofs are chain-scoped, single-use, time-bounded, generation-bound, configuration-epoch-bound,
    and fail closed on unknown onchain state.
16. ERC-1271 validity never schedules or executes an onchain governance action.

## Required test matrix

Tests must cover at least:

- absence of a controller before launch and deterministic generation-1 address prediction;
- canonical BoardroomFactory/ControllerFactory reciprocal binding and rejection of a spoofed or release-mismatched
  factory;
- atomic launch deployment with every invalid initialization relationship and stale or mismatched expected value;
- launch with a missing, wrong, under-threshold, or encumbered `protectionStaker`, plus current/previous-block stake and
  eligible-supply threshold mismatches;
- factory front-running, registry preemption, reentrancy, partial initialization, and deployment-address occupation;
- absence of a replacement controller before its delayed generation transition;
- attempted early execution, duplicate scheduling, expiry, cancellation, and replay;
- permissionless execution after the delay;
- proposer and delay rotation through delayed self-governance, including configuration-epoch invalidation;
- staker veto immediately before and after readiness;
- veto of controller self-configuration as well as Boardroom calls;
- wind-down invalidating an arbitrary number of queued operations without iteration;
- controller replacement, lost proposer, and forbidden emergency-bypass paths;
- wind-down finalization retaining its accepted safety delay after controller delay changes;
- redemption-excess recipient stability across launch and replacement;
- direct calls from the proposer, controller administrator, unrelated contract, and EOA;
- policy rejection and obligation registration through controller-executed Boardroom calls;
- ERC-1271 proof through an EOA proposer and through a Safe/contract proposer;
- wrong chain, Boardroom, controller, generation, configuration epoch, audience, nonce, issued time, and expiry;
- nonce replay, proposer rotation, controller replacement, stale RPC state, RPC failure, and malformed ERC-1271 return;
- same controller address on different chains remaining distinct, plus session/control-claim invalidation after every
  signature-authority change;
- Safe signer changes with an unchanged controller proposer address invalidating the prior control proof;
- proof that a valid ERC-1271 signature cannot schedule or execute governance;
- SDK encoding, transaction review, simulation, and stale-state rejection; and
- old-version detection and continued fail-closed web behavior.

## Exit criteria

This blocker is cleared only when all of the following are true:

- [x] The governance, launch-time deployment, and offchain ownership-proof decisions are approved and recorded.
- [ ] A dedicated controller contract and reciprocal Boardroom binding are implemented.
- [ ] Internal queue, consume, expiry, and action-storage mechanics are removed from the Boardroom.
- [ ] Atomic launch deployment binds every security-relevant expected value in calldata.
- [ ] Launch verifies one named protection staker against the exact current and previous-block 10% power rule.
- [ ] No controller exists before launch, and no replacement exists before its delayed atomic generation transition.
- [ ] The controller implements chain-scoped ERC-1271 proof through its current EOA or contract proposer.
- [ ] The offchain service verifies canonical live controller state and consumes a generation-bound single-use challenge.
- [ ] Offchain identity and session storage are chain-scoped and revoke Boardroom control on proposer, epoch, or
      controller-generation changes.
- [ ] Every privileged offchain write uses a fresh server nonce and current ERC-1271 proof, including when a Safe
      changes signers without changing its address.
- [ ] Staker veto and wind-down work against the external controller without an unbounded cancellation loop.
- [ ] Boardroom and controller independently enforce Active status plus Boardroom and controller configuration epochs.
- [ ] Ownership and controller replacement cannot execute outside the Active epoch.
- [ ] Wind-down delay and redemption-excess recipient semantics survive the ownership-boundary change.
- [ ] Contract, SDK, web, and documentation tests cover the accepted model.
- [ ] A new deterministic release identity and factory deployment identify the redesigned Boardroom.
- [ ] Legacy and unknown Boardrooms remain blocked from supported launch flows.
- [ ] The exact release has passed independent security review.
- [ ] A public-testnet rehearsal has completed launch, scheduling, veto, execution, controller rotation, and
      wind-down through the supported product path.

Until then, neither the current internal launch nor a UI workaround is mainnet-ready.
