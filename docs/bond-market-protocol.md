# Bond Market Protocol

This document describes the pre-funded Sequential Dutch Auction bond primitive in
`packages/contracts/src/bonds/BondMarket.sol` and `BondMarketFactory.sol`.

## Why this is a separate module

The existing fixed-price sale, migrating bonding curve, Merkle airdrop, and token-grant contracts cannot express the
same state machine by configuration. A bond purchase must simultaneously:

1. discover a demand-responsive auction price,
2. move a reserve or liquidity asset directly into the Boardroom,
3. reserve a fixed project-token payout for a maturity date, and
4. preserve that payout as a non-transferable position after the auction closes.

A fixed sale has no debt or control-variable decay. A bonding curve offers immediate, reversible inventory and may
migrate to an AMM. A grant has vesting and can be soulbound, but it has a fixed holder and price schedule rather than a
permissionless auction. Combining those contracts would leave pricing, capacity, and wind-down accounting split across
several independently mutable obligations. `BondMarket` therefore owns the small, explicit state machine while using
the existing Boardroom execution, asset policy, obligation, and redemption boundaries.

## Roles and assets

- The Boardroom creates and pre-funds a market with its 18-decimal project share token.
- A buyer commits the configured ERC20 quote asset.
- A reserve market accepts a readable ERC20 that is not a registered first-party pledge.cash pool.
- A liquidity market accepts only a funded pool registered by the configured `AmmFactory`, and that pool must contain
  the creating Boardroom's share token.
- Quote assets move directly from the buyer to the Boardroom. Project-token capacity stays in the market until it is
  claimed or returned.
- A keeper may finalize a concluded market or redeem a matured position, but redemption always pays the immutable
  recorded owner.

Native value is not accepted. Exact sender spend and recipient receipt are checked for every ERC20 movement, so
fee-on-transfer, sender-surcharge, no-op, and other inexact token behavior reverts atomically.

## Oracle answer

The current Olympus/Bond Protocol-style SDA does **not** use a Uniswap V2 oracle to settle purchases. Olympus describes
its SDA bond price as driven by market demand without an oracle. The auction's own debt and control variable determine
the execution price:

- [Olympus bonds documentation](https://docs.olympusdao.finance/main/legacy/bonding)
- [Olympus `IBondSDA` market-price interface](https://docs.olympusdao.finance/main/contracts/docs/src/interfaces/IBondSDA.sol/interface.IBondSDA)

Older Olympus LP bonds are a different design generation. They used a bond calculator to mark LP tokens to a
risk-adjusted value; that calculator should not be confused with the SDA's price-discovery mechanism or a generic
Uniswap V2 TWAP.

pledge.cash does already have an AMM observation primitive. `AmmPool.currentCumulativePrices` and `AmmPool.sample`
provide bounded historical time-weighted samples for a specific pledge.cash pool. That is sufficient infrastructure for
a future market type whose terms explicitly depend on a pool TWAP, subject to liquidity, window, manipulation, and
quote-routing policy. This bond market intentionally does not consume it: adding an AMM reference would change the
security model from a self-contained auction to oracle-dependent settlement.

## Price and capacity

Market prices use the same convention as the existing fixed sale and grant pricing: quote-token smallest units per one
whole 18-decimal project token. For example, a price of `2_000000` means 2 USDC per project token when USDC has six
decimals.

At creation:

- `capacity` is the exact project-token inventory moved from the Boardroom;
- `initialPrice` sets the starting control variable;
- `minimumPrice` is a hard price floor;
- `duration` bounds the auction window;
- `depositInterval` sets the target maximum payout cadence;
- debt decays over the greater of five deposit intervals or three days;
- `debtBuffer` closes the market if demand pushes debt beyond the configured circuit breaker; and
- `vesting` is the fixed delay from each purchase to its maturity.

The market uses the Bond Protocol SDA shape: debt decays with inactivity, a purchase adds debt and raises marginal
price, and periodic tuning adjusts the control variable so remaining capacity tracks remaining time. `payoutFor` is a
live view, not a guarantee. `purchase` therefore requires a deadline and minimum payout.

## Non-transferable positions

Positions are internal records:

```text
positionId -> { owner, payout, maturity, redeemed }
```

There is no ERC721 or ERC1155 receipt, no approval registry, and no transfer function. Ownership is fixed to
`msg.sender` at purchase. `redeem(positionId)` may be executed by anyone after maturity, but it always transfers the
payout to the recorded owner. The factory and SDK expose bounded owner-position indexing for wallet discovery without
creating a transferable claim right.

## Lifecycle and Boardroom accounting

The factory is a registered Boardroom module policy. Creation is one atomic Boardroom batch: approve the exact
project-token capacity, create the deterministic clone, and pre-fund it. The factory reports the new market as a
`Distribution` obligation, and it registers the quote asset as redeemable because purchases can send that asset into
the treasury.

`close` stops purchases and returns only unsold capacity. `finalize` does the same permissionlessly after conclusion.
Neither action impairs existing positions. A market reports closed to the Boardroom only when purchases have stopped
and `outstandingPayout == 0`; therefore wind-down cannot snapshot redemptions while a funded bond claim remains.
Settled markets remain in the factory's append-only discovery history. Their Boardroom obligation membership can be
pruned permissionlessly without erasing canonical identity.

## Invariants and bounds

- `market project-token balance == capacity + outstandingPayout` after every successful public transition.
- `sold == redeemed payout + outstandingPayout`.
- Quote assets never remain in the market after a successful purchase.
- Returned capacity cannot be promised to a position.
- A position is redeemed at most once and only to its immutable owner.
- Purchases require an active Boardroom and an open market window.
- Market discovery has no concurrent-capacity ceiling and is exposed through bounded pages of at most 100 entries;
  owner-position reads remain client-bounded.
- Market duration is at least one day, deposit interval at least one hour, vesting between one day and 50 years, and
  the deposit interval is bounded so its five-interval debt-decay calculation cannot overflow.

The deterministic local proof is:

```sh
bun --cwd packages/contracts test --match-path test/bonds/BondMarket.t.sol -vv
```
