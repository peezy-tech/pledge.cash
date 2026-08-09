# Project token launch

pledge.cash provides the project custodian, escrow-backed grants, and a canonical v4
position locker. It does not ship a token sale or auction. Projects that want a public
launch can use Uniswap's [CCA Liquidity
Launchpad](https://developers.uniswap.org/docs/liquidity/liquidity-launchpad/overview)
or another external issuance path.

## CCA handoff

Create the Boardroom and its locker first. Configure the launchpad liquidity strategy
with `positionRecipient` set to the locker, not an operator wallet. The launchpad can
mint a plain Uniswap v4 `PositionManager` NFT directly to that recipient. Holding the
NFT gives the locker the standard periphery fee-collection path; the Boardroom must
still call `registerPosition(tokenId)` after mint so the locker verifies the exact
PoolKey, fee, tick spacing, hookless status, subscriber flag, and liquidity.

Uniswap documents the strategy handoff in [Liquidity
strategies](https://developers.uniswap.org/docs/liquidity/liquidity-launchpad/concepts/liquidity-strategies).
The launchpad deployment registry lists the required contracts on Ethereum Sepolia and
Base Sepolia. That means CCA rehearsal is available on both canonical pledge.cash
testnets; it does not mean pledge.cash itself has been broadcast there.

## Local dogfood flow

The deterministic local scenario proves the complete retained lifecycle:

```sh
bun run scenario:project-token:local
```

It deploys the lean protocol against local token and PositionManager doubles, creates a
Boardroom and project token, funds an escrow-backed project-share grant from an external
issuer, creates and registers a canonical locker, collects and splits simulated v4 fees,
starts wind-down, exits the position, closes and prunes the grant, snapshots the treasury,
and redeems shares. It sends no public-network transaction.

## Operator sequence

1. Choose the Boardroom owner and fee recipient deliberately.
2. Create the Boardroom and issue the intended shares while it is Active.
3. Create a locker through `Boardroom.execute` with the intended quote asset, pool fee,
   and tick spacing.
4. Run the external launch with the locker as `positionRecipient`.
5. Register the received NFT through `Boardroom.execute` and verify the emitted identity.
6. Collect fees permissionlessly while the Boardroom remains Active.
7. Before redemption, close every grant and exit the locker through the bounded
   wind-down path.

Never infer a canonical locker from an address supplied by project metadata. Verify the
factory, Boardroom, share token, PositionManager, and PoolKey on the selected chain.
