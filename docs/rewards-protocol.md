# Boardroom Staking And Rewards Protocol

This document specifies `BoardroomRewards` and `BoardroomRewardsFactory` in `packages/contracts/src/rewards/` and their integration with `Boardroom`, `BoardroomToken`, governance, wind-down, the SDK, and the app.

The mechanism has no protocol emissions. A project deliberately pre-funds an ERC20 reward period from its Boardroom treasury. Token holders opt into a non-custodial lock: the project tokens remain in the holder's wallet, but the token contract prevents their transfer while they are active or cooling down.

## Authority and economic rights

- Liquid Boardroom token holders retain ownership, transfers, and pro-rata redemption rights.
- Only active stake earns funded rewards.
- Only active stake supplies the numerator for veto and wind-down governance checks.
- The governance denominator remains all current and previous-block governance-eligible circulating supply. Unstaked holders therefore dilute voting power even though they cannot exercise it themselves.
- Starting an unstake removes active stake, reward accrual, and governance power immediately. The tokens remain transfer-locked until the configured cooldown ends.
- Staking and claiming are direct holder actions. Creating or funding the canonical pool is a Boardroom policy action: direct owner execution before launch and delayed executor-queued execution after launch.

## Canonical topology

Each Boardroom can register at most one reward pool. `BoardroomRewardsFactory` verifies the caller through the canonical `BoardroomFactory`, creates a deterministic clone, and reports a `Reward` obligation. Boardroom governance validates the returned pool's factory, Boardroom, and share token, records it in `rewardPool`, permanently binds its obligation policy, and registers it as the only `BoardroomToken.rewardLocker`.

The pool never receives Boardroom shares. `stake(amount)` asks the share token to increase `lockedStakeBalance(account)` and checkpoints active stake. The share token rejects transfers or burns that exceed the holder's transferable balance while locks are enabled.

## State machines

### Stake

1. `Liquid`: shares are transferable and have no governance or reward power.
2. `Active`: shares remain in the wallet, are transfer-locked, earn funded rewards, and count in governance after the previous-block checkpoint requirement is satisfied.
3. `Cooling`: `requestUnstake` removes the amount from active stake immediately and creates one timestamped request. The amount remains locked but earns no rewards and has no governance power.
4. `Liquid`: anyone may call `completeUnstake(account, slot)` after the timestamp and release the lock. During Boardroom wind-down, completion is immediately available because governance locks are globally disabled.

Each account has at most five pending unstake slots. The cooldown is immutable per pool, greater than zero, and no more than 30 days.

### Reward period

`fundReward` is a two-call Boardroom batch: approve the factory through `AssetPolicy`, then call the factory through its module policy. The factory reserves the ERC20 as a redeemable asset, transfers the exact amount from the Boardroom to the pool, and starts or extends a one-day to 365-day stream.

The pool supports at most eight reward assets. Accounting uses reward-per-active-token indices. Existing remainder and time emitted while total active stake is zero are rolled into the next funded rate; there is no unbacked minting. Claims update accounting before making an exact ERC20 transfer. Fee-on-transfer, sender-surcharge, malformed, and non-contract reward assets fail closed at funding or claim boundaries.

### Wind-down

Starting Boardroom wind-down disables share-token reward locks so stale lock bookkeeping cannot block redemption transfers. Reward accrual is capped at `windDownStartedAt`, not the later terminalization transaction.

The reward pool remains an open Boardroom obligation until `terminalize()` succeeds. Terminalization is permissionless and idempotent. For every bounded reward asset it:

- settles the global reward index at wind-down time;
- preserves already-earned holder claims;
- stops the reward rate;
- attempts to return undistributed and unallocated funding to the Boardroom;
- emits a quarantine event instead of blocking lifecycle progress if a hostile token prevents an exact best-effort return.

Redemptions cannot open while a registered reward pool is non-terminal. Claims remain available after terminalization.

## Checkpoints and governance

Active stake is checkpointed per account and in aggregate. Veto and wind-down checks use current and previous-block active stake. The required amount is the larger rounded-up threshold computed from current and previous-block `BoardroomToken.governanceEligibleSupply()`.

This prevents same-transaction stake from acting immediately and prevents newly activated or just-deactivated stake from satisfying both snapshots. It also preserves the existing exclusion of treasury and authenticated protocol-custody shares from the denominator.

## Bounds and invariants

- One canonical reward pool and one reward locker per Boardroom.
- The pool never custodies Boardroom shares.
- Locked share balance equals active stake plus pending cooldown amounts while locks are enabled.
- An account cannot stake more than its unlocked wallet balance.
- An account cannot request more than its active stake.
- Active stake is removed before a cooldown request is recorded.
- At most eight reward assets and five pending unstake requests per account.
- Reward duration is between one and 365 days; cooldown is at most 30 days.
- Reward assets cannot be zero, the Boardroom share token, or an address without code.
- Every reward is pre-funded; the pool cannot create emissions.
- Reward funding reserves the asset for Boardroom redemption accounting.
- Governance power requires active stake now and in the previous block, against the stricter current/prior eligible-supply threshold.
- Redemptions cannot open until the canonical reward pool is terminalized.

## Deterministic proof

```sh
forge test --match-path test/rewards/BoardroomRewards.t.sol -vv
forge test -q
bun --cwd packages/sdk test
bun --cwd apps/web test
```
