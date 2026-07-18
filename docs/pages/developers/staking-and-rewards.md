---
title: Staking and rewards integration
description: Developer guide for canonical reward-pool discovery, funded periods, account state, governance checkpoints, and wind-down.
---

# Staking and rewards integration

Use the [staking and rewards protocol specification](https://github.com/peezy-tech/pledge.cash/blob/main/docs/rewards-protocol.md) for the complete state machine and invariants.

## Canonical reads

Read `Boardroom.rewardPool()`. A nonzero pool is canonical only when its factory is the configured `BoardroomRewardsFactory`, its `boardroom()` is the selected Boardroom, and its `shareToken()` matches the Boardroom share token.

The SDK exposes `readBoardroomRewardsState`, `readBoardroomRewardsAccountState`, and active-stake-aware `readBoardroomStakerPower`. Account state includes active stake, total locked stake, transferable token balance, pending cooldown slots, and earned amounts by reward asset. The former holder-power names remain deprecated aliases for compatibility.

## Writes

- Create the pool with `buildBoardroomRewardsCreationCall`; execute directly before launch or pass it through `planBoardroomCallExecution` after launch.
- Fund a period with `buildBoardroomRewardFundingCalls`. The first call approves the factory through `AssetPolicy`; the second calls `fundReward` through the reward factory policy.
- Use direct pool transactions for `stake`, `requestUnstake`, permissionless `completeUnstake`, and `claim`.
- During wind-down, call permissionless `terminalize` before attempting to open redemptions.

Do not treat project-token `balanceOf` as governance power. Governance requires active stake in both the current and previous-block checkpoints, while its denominator remains governance-eligible circulating supply.

## Validation

```sh
forge test --match-path test/rewards/BoardroomRewards.t.sol -vv
bun --cwd packages/sdk test
bun --cwd apps/web test
```
