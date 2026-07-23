---
title: Governance and staker protections
description: Understand prelaunch ownership, external controller operations, historical active-stake checks, vetoes, and permissionless execution.
---

# Governance and staker protections

Boardroom governance separates proposing, waiting, reviewing, and executing. The external-controller architecture is a
candidate v5 design and is not deployed or certified for mainnet.

## Before launch

The owner can mint shares and execute policy-checked calls directly. No controller is deployed or adopted, although the
generation-1 address is predictable. Launch calldata names the proposer, predicted controller, delays, grace period,
generation, protection staker, reward pool, and redemption-excess recipient.

Launch requires the named protection staker to meet the 10% current-and-previous-block threshold. It deploys and verifies
generation 1 and transfers ownership atomically. Legacy Boardrooms remain readable but cannot use this launch flow.

## After launch

- Only the current controller proposer schedules a Boardroom operation or controller self-operation.
- Any account may execute after the configured delay and before expiry.
- Every operation binds the full call batch or self-call, salt, Boardroom epoch, controller generation, configuration
  epoch, proposer, and configuration hash.
- Proposer or timing changes are delayed self-governance and advance the configuration epoch.
- Starting wind-down or replacing the controller advances the Boardroom epoch and invalidates older operations in O(1).

The permissionless executor is never substituted for the scheduled proposer at the Boardroom policy gateway.

## Historical active-staker protections

Veto requires 1% active stake and wind-down requires 10%. Both checks use current and previous-block active stake against
the corresponding current and previous-block governance-eligible supply, requiring the stricter rounded-up threshold.

Liquid balances retain economic ownership and redemption rights but no veto or wind-down power. Starting an unstake
removes active power immediately. Treasury and authenticated protocol-custody shares are excluded from the governance
denominator.

The Boardroom is the controller's immutable canceller. A qualified holder calls `Boardroom.veto(operationId)`; there is
no privileged administrator or emergency-delay bypass.

## What stakers cannot do

Staking does not let a wallet schedule arbitrary operations, spend the treasury, replace a controller, or change a
grant. Staker powers are limited to veto and wind-down thresholds. Proposal authority remains with the controller's
current proposer.

## Reading the UI

Operation history is trustworthy only when controller identity, epochs, and event scans are complete. `Unknown` is not
zero. Unsupported Boardroom versions fail closed for governance writes.

Follow [Govern a project](../guides/govern-a-project) for operational steps.
