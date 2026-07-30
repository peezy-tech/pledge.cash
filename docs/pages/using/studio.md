---
title: Operate a Project in Studio
description: Use the seven Studio sections across project setup, operation, governance, wind-down, and redemption.
---

# Operate a Project in Studio

`Studio` is the operator workspace. Connect the operator wallet, select the correct network, then choose an existing Boardroom or `Start project setup`. Public project pages remain separate and readable without operator access.

[Open Studio](../../studio)

## How Studio unlocks controls

Studio verifies the canonical protocol-v1 deployment, Boardroom factory,
registry/facet inventory, current facet-set hash, migration state, and
lifecycle before exposing writes.
Before governance launch, the recorded owner manages available sections. After launch, the controller proposer schedules
operator actions while permissionless execution and active-staker actions follow their own rules. A connected wallet on
the wrong chain gets `Switch wallet network`; an unauthorized wallet gets `Open public project` instead of controls.

The lifecycle shown under `Current stage` moves through `Define`, `Configure`, `Govern`, `Wind down`, and `Redeem`. Actions disappear or become blocked when the lifecycle makes them unsafe.

## Setup

Use `Setup` to create or inspect a Boardroom. `Create Boardroom` asks for `Owner`, `Name`, `Symbol`, and `Salt`. `Predict` computes the deterministic address without deploying. `Create` opens transaction review.

After loading a Boardroom, confirm its address, owner/controller, proposer, generation, epochs, project token,
governance settings, scalar obligation counts, and discovery completeness before moving on.

## Token

Use `Token` for `Boardroom Shares`. Before launch and while authority allows, `Mint Shares` issues project tokens to the entered recipient. Redemption controls live in `Close`, not in this section.

Minting changes supply. Verify the recipient and amount in `Review transaction`.

## Grants

Use `Grants` to create project-token grants and inspect `Existing grants`. Grant inputs include holder, payment, vesting, expiry, transfer timing, and a deterministic salt. The workflow can require factory approval before grant creation.

An issued grant is a contract commitment. Confirm funding, payment terms, and dates before signing; do not describe it as equity or employment unless a separate agreement says so.

## Distributions

Use `Distributions` to choose `Dutch auction`, `Fixed price`, `Bond market`, `Airdrop`, or `Bonding curve`.

- a Dutch auction sets inventory, payment token, descending start/floor prices, buyer cap, finite schedule, and salt.
- A fixed-price sale sets inventory, payment token, unit price, buyer cap, and schedule.
- a bond market sets reserve or first-party LP quote asset, pre-funded capacity, auction prices, debt buffer, vesting, cadence, and schedule. Bond positions are non-transferable.
- a Merkle airdrop sets inventory, root, claim schedule, optional grant-claim cap, and salt.
- a migrating bonding curve sets sale and migration inventory, quote token, curve terms, graduation target, liquidity share, schedule, and salts.

Existing routes remain listed. Dutch auctions can be finalized permissionlessly after expiry; Boardroom cancellation is
pre-start only and Boardroom closure is reserved for wind-down. Other lifecycle actions include closing a bond market,
closing or cancelling other distributions, and curve migration when the contract state and authority allow them.

## Liquidity

Use `Liquidity` for Boardroom-owned `Locked Liquidity` and, when a project AMM pool exists, `Add Liquidity` and `Manage LP`. Confirm token pair, desired amounts, minimums, recipient, deadlines, and whether native-asset wrapping is enabled.

If the app says `No project AMM pool is available`, create or migrate project liquidity first. Studio does not accept an unrelated pool as project liquidity.

After a Dutch auction, liquidity remains optional. Studio does not prefill a proceeds percentage. Use the auction's last
successful price only when initializing a new pool; add to an existing canonical pool at its live ratio.

## Governance

Use `Governance` to inspect controller identity, proposer, generation, configuration epoch, Boardroom epoch, active-staker
protections, reward pool, and verified operations. Only the proposer can schedule; anyone may execute a ready operation.
Proposer/timing changes are delayed controller self-operations, and controller replacement deploys the next generation
inside one delayed Boardroom self-call.

Launch and governance writes require a promoted, live-verified protocol-v1
artifact and a Boardroom with `migrationRequired() == false`. Both public
testnet artifacts are pending, so these writes are currently local-scenario
workflows only. No mainnet deployment is supported.

## Wind-down and redemptions

Use `Close` for `Wind-Down` and redemptions. The safe sequence is:

1. `Start Wind-Down` as the owner before launch or after launch when active stake meets the 10%
   current-and-previous-block eligible-supply threshold.
2. Resolve grants, distributions, and locked-liquidity blockers.
3. `Burn Treasury Shares` where applicable.
4. Verify the frozen redeemable-asset registry and every dependency count.
5. Enter `Snapshotting`, then process bounded asset pages until the frozen cursor reaches the frozen count. Treat an
   explicitly unreadable asset as a blocker requiring the configured lifecycle response.
6. Enter `RedemptionsOpen` only after the snapshot is complete.
7. Holders redeem shares and claim assets independently; retry only the per-asset credits that remain unpaid.

Lifecycle transitions and asset minimums can be irreversible. Treat every contract and recipient as exact data.

Curve quote recovery remains an explicit obligation. Wind-down forfeiture is
available only after its quarantine delay and unvetoed holder-protection
window; snapshotting cannot bypass an unresolved curve dependency.

## Recovery

- `Loading the exact project state`: wait; controls stay hidden until URL and Boardroom identity match.
- `Studio data is incomplete`: choose `Try again` before acting.
- `Studio … is locked`: follow the displayed reason—connect, switch networks, use the authorized wallet, or return to the public project.
- After a write confirms, wait for the workspace refresh before choosing the next lifecycle action.

[Read transaction and wallet behavior](transactions-and-wallet) · [Use pledge.cash safely](../start/use-safely)
