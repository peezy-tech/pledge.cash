---
title: Operate a Project in Studio
description: Use the seven Studio sections across project setup, operation, governance, wind-down, and redemption.
---

# Operate a Project in Studio

`Studio` is the operator workspace. Connect the operator wallet, select the correct network, then choose an existing Boardroom or `Start project setup`. Public project pages remain separate and readable without operator access.

[Open Studio](../../studio)

## How Studio unlocks controls

Studio verifies the canonical Boardroom and current lifecycle before exposing writes. Before governance launch, the recorded owner manages available sections. After launch, the executor manages operator sections while holder-specific actions follow their own thresholds. A connected wallet on the wrong chain gets `Switch wallet network`; an unauthorized wallet gets `Open public project` instead of controls.

The lifecycle shown under `Current stage` moves through `Define`, `Configure`, `Govern`, `Wind down`, and `Redeem`. Actions disappear or become blocked when the lifecycle makes them unsafe.

## Setup

Use `Setup` to create or inspect a Boardroom. `Create Boardroom` asks for `Owner`, `Name`, `Symbol`, and `Salt`. `Predict` computes the deterministic address without deploying. `Create` opens transaction review.

After loading a Boardroom, confirm its address, owner, project token, executor, governance settings, and current obligations before moving on.

## Token

Use `Token` for `Boardroom Shares`. Before launch and while authority allows, `Mint Shares` issues project tokens to the entered recipient. Redemption controls live in `Close`, not in this section.

Minting changes supply. Verify the recipient and amount in `Review transaction`.

## Grants

Use `Grants` to create project-token grants and inspect `Existing grants`. Grant inputs include holder, payment, vesting, expiry, transfer timing, and a deterministic salt. The workflow can require factory approval before grant creation.

An issued grant is a contract commitment. Confirm funding, payment terms, and dates before signing; do not describe it as equity or employment unless a separate agreement says so.

## Distributions

Use `Distributions` to choose `Fixed price`, `Airdrop`, or `Bonding curve`.

- A fixed-price sale sets inventory, payment token, unit price, buyer cap, and schedule.
- a Merkle airdrop sets inventory, root, claim schedule, optional grant-claim cap, and salt.
- a migrating bonding curve sets sale and migration inventory, quote token, curve terms, graduation target, liquidity share, schedule, and salts.

Existing routes remain listed. Available lifecycle actions include close, cancel, or curve migration when the contract state and authority allow them.

## Liquidity

Use `Liquidity` for Boardroom-owned `Locked Liquidity` and, when a project AMM pool exists, `Add Liquidity` and `Manage LP`. Confirm token pair, desired amounts, minimums, recipient, deadlines, and whether native-asset wrapping is enabled.

If the app says `No project AMM pool is available`, create or migrate project liquidity first. Studio does not accept an unrelated pool as project liquidity.

## Governance

After launch, the executor can prepare an executor-rotation proposal without pasting calldata. Enter the proposed executor, review the exact decoded `setExecutor(address)` self-call and its earliest execution time, then choose `Review proposal`. The wallet transaction only queues the decision; authority changes after the holder review window and a separate permissionless execution.

Use `Governance` to inspect the decision system, holder protections, and verified queue. Existing launched Boardrooms can expose queue, veto, and execution actions when the wallet and state qualify.

For current pre-launch Boardrooms, the app shows `Secure governance launch is unavailable for this Boardroom version`. The deployed `launch(uint256)` call does not bind the expected executor, so there is no safe in-app launch action. Leave owner governance unchanged; do not bypass the block.

## Wind-down and redemptions

Use `Close` for `Wind-Down` and redemptions. The safe sequence is:

1. `Start Wind-Down` as the owner before launch or after launch when the wallet meets the 10% current-and-previous-block
   holder threshold.
2. Resolve grants, distributions, and locked-liquidity blockers.
3. `Burn Treasury Shares` where applicable.
4. Verify the full admitted redemption basket. Wrapped native is admitted at initialization, and canonical module
   lifecycle actions admit assets they return while those obligations are recorded. A late recovery from a closed,
   pruned curve does not re-admit a quote asset that was removed while empty. Use `Register Asset` only for a missing
   supported asset with a positive Boardroom balance, as the prelaunch owner or—after launch—a wallet meeting the 10%
   threshold in both current and previous-block snapshots. Registering an existing asset reverts.
5. `Open Redemptions` only when the app reports no loaded blockers and the wind-down delay has elapsed. The current app
   does not precompute that time gate; an early attempt is rejected during simulation.
6. Holders enter `Redeem shares` and a recipient, then redeem.
7. Use the retry claim fields only when an asset transfer from a prior redemption needs recovery.

Lifecycle transitions and asset minimums can be irreversible. Treat every contract and recipient as exact data.

Studio does not yet expose curve quote recovery, Boardroom-grant quarantine, redeemable-asset quarantine/removal, or
redemption-excess sweeping. Those protocol liveness and terminal-recovery functions currently require a verified direct
contract or developer integration; see [Wind down and redeem](../guides/wind-down-and-redeem) for the exact boundary.

## Recovery

- `Loading the exact project state`: wait; controls stay hidden until URL and Boardroom identity match.
- `Studio data is incomplete`: choose `Try again` before acting.
- `Studio … is locked`: follow the displayed reason—connect, switch networks, use the authorized wallet, or return to the public project.
- After a write confirms, wait for the workspace refresh before choosing the next lifecycle action.

[Read transaction and wallet behavior](transactions-and-wallet) · [Use pledge.cash safely](../start/use-safely)
