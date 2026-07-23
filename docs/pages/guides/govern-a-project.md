---
title: Govern a project
description: Launch and operate the external Boardroom controller, review delayed operations, use holder veto, and replace controller generations.
---

# Govern a project

The candidate v5 governance model uses a dedicated controller deployed only inside Boardroom launch. It is not deployed
on mainnet and must not be treated as production-ready. Legacy Boardrooms remain readable, but the app must fail closed
for launch, scheduling, execution, control claims, and controller replacement on unsupported versions.

## Before launch

Confirm all launch inputs from one current canonical read:

- Boardroom and BoardroomFactory identity;
- predicted generation-1 controller from the factory bound to that BoardroomFactory;
- proposer address;
- named protection staker;
- canonical reward pool;
- redemption-excess recipient;
- controller delay, wind-down delay, and operation grace period;
- governance-eligible supply and the protection staker's current and previous-block active stake.

The proposer may be an EOA or a contract wallet such as a Safe. The protection staker must meet the 10% wind-down
threshold against both current and previous-block eligible supply. A predicted controller is only an address until
launch; code at that address before launch is an error.

Review all values in the launch transaction. Launch atomically deploys and initializes generation 1, verifies the
configuration, records the controller, advances the Boardroom governance epoch, and transfers Boardroom ownership. Any
mismatch reverts.

## Schedule an operation

Only the controller's current proposer can schedule. Build the complete ordered Boardroom call batch and verify:

- policy, target, value, and decoded calldata for every call;
- user salt;
- current Boardroom governance epoch;
- controller generation;
- controller configuration epoch;
- proposer and configuration hash;
- earliest execution time and expiry.

The controller stores only operation status and timing. The operation ID commits to the full context above. Scheduling
does not execute a Boardroom call and grants no authority to the later executor.

## Execute a ready operation

Anyone may execute after the delay and before expiry. The permissionless caller is the transaction executor only; the
Boardroom policy gateway receives the scheduled proposer as policy authority.

Execution fails closed if the Boardroom entered wind-down, an epoch or generation changed, the controller was replaced,
the configuration changed, the call batch differs, or a policy rejects a call. A failed policy call rolls back operation
consumption.

## Veto

A holder can veto a pending operation through the Boardroom when its active stake meets the 1% threshold against both
current and previous-block eligible supply. The Boardroom is the controller's immutable canceller. A direct proposer,
executor, or arbitrary address cannot cancel through a separate administrator path.

Verify the operation ID and current controller before submitting a veto.

## Change proposer or timing

Proposer, controller delay, and grace-period changes are delayed controller self-operations. They cannot execute through
an administrator bypass. Execution advances the controller configuration epoch, invalidating operations bound to the
old configuration.

Changing controller timing does not change the Boardroom's immutable wind-down delay.

## Replace a controller

Replacement is a delayed Boardroom self-call scheduled through the current controller. Review:

- predicted next-generation controller;
- next proposer, delay, and grace period;
- exact next generation;
- current Boardroom and controller epochs.

The new controller must not exist before execution. The Boardroom deploys, initializes, verifies, records, and adopts it
inside the replacement transaction. Replacement preserves the wind-down delay and redemption-excess recipient and
advances the Boardroom governance epoch.

## Start wind-down

The pre-launch owner or a holder meeting the 10% current-and-previous-block threshold can start wind-down. This
transition is one-way and invalidates all older controller operations in constant time. It does not iterate over the
operation history.

Wind-down is followed by bounded obligation cleanup, explicit liquidity closure, paginated asset snapshotting, and then
redemptions. See [Wind down and redeem](wind-down-and-redeem).

## Offchain Boardroom control

A Better Auth session proves the service user, not Boardroom authority. Every privileged offchain Boardroom write needs a
fresh server nonce and a current ERC-1271 proof from the controller.

The exact SIWE challenge binds the service audience/domain, destination account or organization, scope, chain,
Boardroom, controller, generation, configuration epoch, nonce, issued time, and expiry. Sentinel validates all canonical
reads and the signature at one pinned finalized block, then atomically consumes the nonce and creates the claim. Stale
relationships, reorg uncertainty, malformed RPC results, and unsupported versions fail closed.

This signature path never schedules or executes onchain governance.

## Safe review checklist

Before any governance write:

1. Confirm chain, v5 deployment identity, Boardroom, controller, generation, and epochs.
2. Confirm the connected wallet has the required role for that exact action.
3. Decode every call and verify its policy and target.
4. Confirm delay, ETA, expiry, and salt.
5. Simulate, then compare the wallet request.
6. After confirmation, re-read the operation and canonical controller state.

Do not bypass an unsupported-version warning or describe this candidate as mainnet-ready.
