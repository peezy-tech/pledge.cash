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

Use `Governance` to inspect the decision system, holder protections, and verified queue. Existing launched Boardrooms can expose queue, veto, and execution actions when the wallet and state qualify.

For current pre-launch Boardrooms, the app shows `Secure governance launch is unavailable for this Boardroom version`. The deployed `launch(uint256)` call does not bind the expected executor, so there is no safe in-app launch action. Leave owner governance unchanged; do not bypass the block.

## Close

Use `Close` for `Wind-Down` and redemptions. The safe sequence is:

1. `Start Wind-Down` when authorized or holder-threshold eligible.
2. Resolve grants, distributions, and locked-liquidity blockers.
3. `Burn Treasury Shares` where applicable.
4. `Register Redeemable Asset` for each asset included in redemption.
5. `Open Redemptions` only when the app reports no blockers.
6. Holders enter `Redeem shares` and a recipient, then redeem.
7. Use the retry claim fields only when an asset transfer from a prior redemption needs recovery.

Lifecycle transitions and asset minimums can be irreversible. Treat every contract and recipient as exact data.

## Recovery

- `Loading the exact project state`: wait; controls stay hidden until URL and Boardroom identity match.
- `Studio data is incomplete`: choose `Try again` before acting.
- `Studio … is locked`: follow the displayed reason—connect, switch networks, use the authorized wallet, or return to the public project.
- After a write confirms, wait for the workspace refresh before choosing the next lifecycle action.

[Read transaction and wallet behavior](transactions-and-wallet) · [Use pledge.cash safely](../start/use-safely)
