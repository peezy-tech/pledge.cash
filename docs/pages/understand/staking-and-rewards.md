---
title: Staking and funded rewards
description: Understand non-custodial Boardroom token locks, active-staker governance, cooldowns, and project-funded reward periods.
---

# Staking and funded rewards

A project can register one Boardroom reward pool. The pool does not mint emissions and does not take custody of project tokens. Instead, a holder activates a lock recorded by the project token contract while the tokens remain in the same wallet.

## What active stake does

Active stake has two powers:

- it earns the ERC20 rewards that the project has already funded; and
- it is the only token balance that can veto queued actions or start wind-down.

The threshold denominator still includes all governance-eligible circulating project tokens. Holding liquid tokens therefore preserves economic ownership and redemption rights, but it does not grant governance power. Unstaked supply still dilutes active stakers.

Governance checks compare active stake now and in the previous block. Newly activated stake cannot govern in the same transaction or block.

## Unstaking and cooldown

Starting an unstake immediately ends reward accrual and governance power for that amount. The tokens then enter the project's immutable cooldown, up to 30 days. They remain in the holder's wallet but cannot transfer until the cooldown request is completed.

Anyone can complete a ready request for its owner; the unlocked tokens always remain with that owner. During wind-down, token locks stop restricting transfers so staking cannot obstruct redemption.

## Where rewards come from

Projects fund rewards from assets already held by their Boardroom treasury. A funding action chooses the reward token, exact amount, and a duration between one and 365 days. There is no perpetual issuance schedule.

If nobody is staked, scheduled value is retained as unallocated funding instead of being awarded to nobody. A later funding action rolls that value forward. The pool supports a bounded set of reward assets, and each holder claims each asset directly.

## Wind-down

Reward accrual stops at the exact time wind-down begins. Before redemptions can open, anyone must terminalize the pool. Undistributed funding is returned to the Boardroom when the token permits it, while rewards already earned by stakers remain claimable.

Review the full [staking and rewards protocol](https://github.com/peezy-tech/pledge.cash/blob/main/docs/rewards-protocol.md) for contract bounds and hostile-token behavior.
