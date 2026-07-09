# Project Token Launch

This scenario dogfoods pledge.cash as its own Boardroom-backed project token. The Boardroom share token is the project
token, the Boardroom owns locked AMM liquidity, and protocol revenue is paid back to the project Boardroom.

## Initial Economics

| Mechanism | Setting | Effect |
| --- | --- | --- |
| AMM swap fee | `30 bps` | Paid by traders on AMM input. |
| AMM protocol share | `5%` of swap fees | `1.5 bps` of swap notional goes directly to the configured protocol fee recipient. |
| Grant creation fee | `0.1 HYPE` | Paid in native HYPE by grant creators and forwarded to the project Boardroom once it owns `TokenGrantFactory`. |

The scenario seeds `1,000,000 PLEDGE` against `100 HYPE` of Boardroom-owned locked liquidity. A `5 HYPE` buy routes
through the AMM and forwards protocol fee revenue to the Boardroom as wrapped HYPE. A separate grant issuer then creates
a `25,000 PLEDGE` grant and pays the `0.1 HYPE` native creation fee to the Boardroom-owned factory. When wind-down
starts, the Boardroom wraps that raw HYPE into WHYPE before entering `WindingDown`.

## State Machine

1. Deploy `BoardroomPolicyRegistry`, `AssetPolicy`, `BoardroomFactory`, `TokenGrantFactory`, `AmmFactory`, `AmmRouter`,
   `LockedLiquidityFactory`, and wrapped HYPE.
2. Allow the token grant and locked-liquidity factories as Boardroom call policies, and use `AssetPolicy` for supported
   asset approvals.
3. Create the project Boardroom and use its share token as `PLEDGE`.
4. Set the AMM protocol fee recipient to the project Boardroom.
5. Set the native token grant creation fee to `0.1 HYPE` and transfer `TokenGrantFactory` ownership to the Boardroom.
6. Mint project tokens to the Boardroom for LP seeding and to an external grant issuer for grant escrow.
7. Fund the Boardroom with wrapped HYPE and lock PLEDGE/WETH liquidity through `Boardroom.executeBatch`.
8. Swap HYPE for PLEDGE and verify wrapped-HYPE protocol fee revenue reaches the Boardroom.
9. Create a PLEDGE grant from the external issuer and verify native creation-fee revenue reaches the Boardroom.
10. Start wind-down and verify native creation-fee revenue is normalized into wrapped HYPE.

## Assets And Authorities

- Project Boardroom: owns locked LP principal and receives protocol revenue.
- AMM factory fee manager: can set the protocol fee recipient once.
- Token grant factory owner: sets the creation fee and receives native fee revenue; after handoff this is the Boardroom.
- Boardroom owner: mints project tokens, approves Boardroom-owned assets through `AssetPolicy`, and creates locked
  liquidity through `LockedLiquidityFactory` as the Boardroom call policy.
- External trader: pays HYPE into the AMM and receives project tokens.
- External grant issuer: escrows project tokens into a grant and pays the native creation fee.

## Invariants

- AMM protocol fee recipient is configured once and equals the project Boardroom.
- Token grant creation fees are paid to `TokenGrantFactory.owner()`, which is the project Boardroom after handoff.
- Locked LP remains in the locker after the launch trade.
- The launch trade increases the Boardroom wrapped-HYPE balance by the exact configured protocol fee share.
- The grant creation increases the Boardroom native HYPE balance by exactly `0.1 HYPE`.
- `startWindDown()` wraps the Boardroom native HYPE balance into WHYPE before the Boardroom enters `WindingDown`.
- Late native HYPE received after wind-down starts is wrapped before redemptions open or before redemption pricing.
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

The script uses standard Anvil private keys by default. Override `OWNER_PRIVATE_KEY`, `TRADER_PRIVATE_KEY`,
`GRANT_ISSUER_PRIVATE_KEY`, `CONTRIBUTOR`, or `PROJECT_TOKEN_LAUNCH_NONCE` when needed. The nonce is included in
deterministic deployment salts so repeated local broadcasts can avoid clone-address collisions.
