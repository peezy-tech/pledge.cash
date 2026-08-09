---
title: Troubleshooting
description: Diagnose deployment, identity, wallet, approval, swap, grant, locker, and redemption failures without unsafe retries.
---

# Troubleshooting

Start with the exact chain, deployment status, contract address, connected account, and
transaction hash.

## Contract actions are unavailable

The selected artifact may be pending. Both canonical pledge.cash testnet artifacts are
currently pending, so this is expected on public networks. Local simulation does not
make an artifact live.

## A project or grant is not recognized

Check chain and address formatting, then verify the factory mapping. An event, saved
shortcut, or hosted identity cannot replace current factory provenance.

## A grant will not settle

Confirm the connected wallet owns the grant right, the amount is vested and unsettled,
expiry has not passed, and any payment-token approval targets the grant contract for
enough cost. Wait for the approval receipt before settling.

## A locker rejects a position

Compare PositionManager owner, token ID, currency order, fee, tick spacing, hook address,
subscriber flag, tick range, and liquidity. A direct mint must still be registered by the
Boardroom. A safe transfer must be prepared for that exact token ID.

## A swap fails

Refresh the quote, confirm Permit2 and Universal Router approvals, inspect deadline and
minimum output, and ensure native value matches the encoded route. Simulation is only a
preflight against the state it observed.

## Wind-down cannot advance

Read the open escrow count. Exit or cancel the locker, close grants, and prune each
closed escrow. After the delay, process every snapshot page before opening
redemptions. An asset claim requires prior share redemption and can fail its minimum
output independently of other assets.

## The receipt succeeded but the page did not refresh

Preserve the hash and verify it on the same chain. Reload the route and re-read state;
do not send a duplicate solely because a later RPC read failed.
