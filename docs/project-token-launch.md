# Project Token Launch (Local v4 Scenario)

`ProjectTokenLaunchScenario.s.sol` is a standalone local-Anvil scenario that dogfoods pledge.cash as its own
Boardroom-backed project token. It labels Anvil's native gas token as HYPE and treats a local Solady `WETH` instance as
wrapped HYPE. Those labels are local fixtures, not a claim about a live network deployment.

The scenario uses `V4PoolManagerMock` to prove pledge.cash lifecycle integration. It does not represent a production
Uniswap deployment and does not exercise Universal Router swaps.

## Initial economics

The Boardroom creates `1,000,000 PLEDGE` against `100 wrapped HYPE` in its canonical full-range v4 vault. The resulting
P4LP supply equals position liquidity and initially remains entirely protocol-owned inside the vault. A separate grant
issuer escrows `25,000 PLEDGE` into a contributor grant and pays a `0.1 HYPE` creation fee to the Boardroom.

## State machine

1. Deploy the canonical Boardroom release, policy roots, token-grant factory, protocol-fee router, v4 manager test
   double, `PledgeV4LiquidityFactory`, mined-permission hook, and wrapped-HYPE token.
2. Register `AssetPolicy` and the v4 liquidity factory as Boardroom policies.
3. Create the project Boardroom and use its share token as `PLEDGE`.
4. Route fees earned by the protocol vault position through `ProtocolFeeRouter` to the Boardroom.
5. Configure the `0.1 HYPE` grant creation fee and transfer `TokenGrantFactory` ownership to the Boardroom.
6. Mint project tokens to the Boardroom for liquidity and to an external issuer for grant escrow.
7. Execute two asset approvals and `createProtocolLiquidity` as one Boardroom batch.
8. Verify the deterministic vault, PoolId, full-range position, P4LP supply, and Boardroom obligation record.
9. Create the external grant and verify native creation-fee revenue reaches the Boardroom.
10. Start wind-down and verify the Boardroom normalizes its native fee balance into wrapped HYPE first.

The script does not call `Boardroom.launch()`: “launch” here means project-token liquidity creation. Governance remains
in the prelaunch owner-execution phase, so this scenario does not exercise delayed controller scheduling or holder veto.

## Assets and authorities

- The Boardroom owns the project share token inventory and its protocol P4LP claims.
- `PledgeV4LiquidityFactory` fixes PoolManager, hook, PoolKey parameters, vault implementation, Boardroom factory, and
  protocol-fee recipient at deployment.
- The hook authorizes only the factory's pending canonical pool initialization.
- The Boardroom owner approves assets through `AssetPolicy` and invokes the liquidity-factory policy.
- The external grant issuer owns its grant inventory, creates the grant, and pays the configured native fee.

## Invariants

- The vault address matches its deterministic prediction and the Boardroom's recorded liquidity vault.
- The recorded PoolId matches the factory, vault, and Boardroom.
- `P4LP.totalSupply() == positionLiquidity()` and the vault initially owns every claim.
- The grant factory pays its configured fee recipient; ownership transfer alone does not change the recipient.
- `startWindDown(expectedFacetSetHash)` wraps the Boardroom's raw HYPE before entering `WindingDown`.
- The created grant escrows the full project-token grant amount for the contributor.

## Commands

Dry-run:

```sh
bun run scenario:project-token:dry-run
```

Against local Anvil:

```sh
anvil
bun run scenario:project-token:local
```

The script uses standard Anvil private keys by default. Override `OWNER_PRIVATE_KEY`, `GRANT_ISSUER_PRIVATE_KEY`,
`CONTRIBUTOR`, or `PROJECT_TOKEN_LAUNCH_NONCE` when needed. The nonce is included in deterministic clone salts.
