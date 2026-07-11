---
title: Governance and holder protections
description: Understand direct owner authority, delayed actions, historical holder checks, vetoes, and permissionless execution.
---

# Governance and holder protections

Boardroom governance deliberately separates proposing, waiting, reviewing, and executing.

## Before launch

The owner can mint shares and execute policy-checked calls directly. The delayed queue and holder veto are not active. The owner can start wind-down.

Governance launch is permanent. The current app refuses to launch legacy Boardrooms because their launch calldata does not bind the expected executor. Leaving them pre-launch is the safe behavior until an upgraded contract closes that race.

## After launch

- The current executor queues a single action or bounded batch.
- The action becomes executable after a delay of one to 30 days.
- Any account can execute it once ready.
- It expires seven days after its ETA.
- Executor changes and wind-down invalidate actions from the previous governance epoch.

The action hash binds the ordered call fields and salt. Queue storage separately records ETA, expiry, governance epoch, and Boardroom status for that hash. Verify both the hash inputs and its current action context; a decoded description alone is not authority.

## Historical holder protections

Veto requires 1% and wind-down requires 10% of governance-eligible supply. The contract uses both current and previous-block supply and requires the holder to pass the stricter threshold in both balance snapshots.

This design excludes same-transaction flash balances and balances transferred away after the prior checkpoint. It also excludes shares held by the Boardroom treasury or authenticated grants, distributions, pools, and fee vaults from governance-eligible supply. A locked-liquidity locker normally holds LP tokens; the pool and its fee vault are the classified project-share custody accounts.

## What holders cannot do

Holding shares does not let a wallet queue arbitrary actions, spend the treasury directly, or change a grant. Holder protections are bounded to veto and wind-down thresholds. Ordinary proposal authority remains with the current executor after launch.

## Reading the UI

An empty queue is trustworthy only when the RPC event scan completed. If the app reports incomplete or unavailable queue history, **Unknown is not zero** and “no action shown” is not proof that none exists.

Follow [Govern a project](../guides/govern-a-project) for operational steps.
