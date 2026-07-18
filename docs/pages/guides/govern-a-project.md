---
title: Govern a project
description: Understand pre-launch authority, delayed governance, active-staker vetoes, action expiry, and the current launch safety boundary.
---

# Govern a project

Boardroom governance has two distinct modes. Before launch, the owner acts directly through policy checks. After launch, the executor queues delayed actions, anyone can execute a ready action, and historically active stakers gain veto and wind-down powers.

## Prerequisites

- The canonical Boardroom address and selected network.
- A complete current-state read and, for queue history, an RPC capable of the required event-log scan.
- The correct wallet role: owner before launch, executor to queue after launch, or an eligible active staker for veto or wind-down.
- Exact target, policy, calldata, value, salt, and intended outcome for any proposed action.
- Native gas token.

## First: identify the governance mode

Open the project's **Governance** section and verify:

- Boardroom lifecycle: Active, Winding down, or Redemptions open;
- whether staker governance is launched;
- current owner and executor;
- governance delay and epoch;
- current governance-eligible supply;
- your current and previous-block active stake;
- queued action coverage and any incomplete-history warning.

**Unknown is not zero.** Missing staker power or queue history is not evidence that no action or voting power exists.

## Pre-launch owner governance

Before launch, the owner can mint shares and submit policy-checked Boardroom executions directly. Staker veto and delayed queue controls are not active. The owner can also start wind-down.

### Secure launch is currently unavailable

The app intentionally blocks governance launch for legacy Boardrooms. Their `launch(uint256)` calldata does not include the expected executor. Because the executor could change while the launch transaction is pending, the permanent transition cannot be reviewed safely.

Do not bypass this block. The safe state is pre-launch owner governance until an upgraded Boardroom binds the expected executor in calldata and reverts on mismatch. This limitation does not prevent reading or operating Boardrooms that were already launched.

## Launched delayed governance

For an already-launched Boardroom:

1. The current executor constructs an exact single call or bounded batch with a salt.
2. The executor queues its hash. The action records an ETA, governance epoch, and Boardroom status.
3. During the delay, active stakers can inspect calldata and exercise protections.
4. Once ready, **any account** can execute the unchanged action.
5. The action expires seven days after its ETA if not executed.

Governance delay is between one and 30 days. Changing executor or starting wind-down advances the governance epoch and invalidates older queued actions.

### Staker protections

- **Veto:** at least 1% of governance-eligible supply.
- **Start wind-down:** at least 10% of governance-eligible supply.

Both checks use the stricter threshold derived from current and previous-block eligible supply, and active stake must satisfy it in both snapshots. Liquid balances, cooling stake, same-transaction stake, treasury shares, and shares in authenticated protocol custody do not count as power.

## Review or execute an action

1. Open **Governance** and select the queued action.
2. Verify status, proposer/executor, ETA, expiry, epoch, policy, target, value, calldata, and decoded effect.
3. Compare the action with current Boardroom status and current obligation state.
4. If executing, confirm it is ready and unexpired. Simulation should prove that the exact hash still matches live state.
5. Review and sign with an injected browser wallet. The executor wallet is not required for execution after the delay.

If the action is unsafe and your wallet has enough verified active stake now and in the previous block, veto before execution. A veto is itself an onchain transaction.

## Wallet and transaction expectations

Queue, veto, execution, executor change, and wind-down are separate transactions with separate receipts. Wallet replacement can change the authoritative hash. A confirmed receipt may remain in **refreshing workspace data** while action history and current state are re-read.

Never interpret a slow refresh as proof that execution failed. Check the receipt, action hash, epoch, and Boardroom state before retrying.

## Success proof

- **Queued:** the exact action hash has the expected ETA, epoch, and live status.
- **Vetoed:** the action is cancelled and can no longer execute.
- **Executed:** the action is marked executed and the intended state transition or asset movement occurred.
- **Expired or invalidated:** execution now reverts and the UI labels the correct terminal reason.
- **Wind-down started:** status is Winding down, the epoch advanced, and old actions are invalid.

## Recovery

- **Queue history unavailable:** use a log-capable RPC or inspect events directly; do not assume an empty queue.
- **Action hash mismatch:** rebuild it from the exact ordered call fields and salt, then compare the separately stored action epoch and Boardroom status with current context. Do not execute a look-alike.
- **Action not ready:** wait until ETA; changing the local clock does nothing.
- **Action expired:** the executor must queue a new action with a new valid lifecycle.
- **Executor lost:** stakers cannot queue ordinary actions, but a qualified active staker can still start wind-down.
- **Policy/module disabled:** new top-level Boardroom module calls may be blocked, but this is not an emergency pause for
  existing children. Their direct buys, claims, or trades can continue while lifecycle permits, and authenticated
  reserved fulfillment and cleanup remain possible.

## Next steps

- Inspect contract and treasury evidence in **Transparency**.
- Read [Governance and staker protections](../understand/governance-and-holder-protections).
- Understand [Staking and funded rewards](../understand/staking-and-rewards).
- For terminal recovery, follow [Wind down and redeem](wind-down-and-redeem).
