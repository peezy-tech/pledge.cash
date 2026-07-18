# Project Token Launch (Local HYPE Scenario)

`ProjectTokenLaunchScenario.s.sol` is a standalone local-Anvil scenario that dogfoods pledge.cash as its own
Boardroom-backed project token. It labels Anvil's native gas token as HYPE and treats a local Solady `WETH` instance as
wrapped HYPE; these labels are scenario-specific, not a claim about Monad or a live testnet deployment. The Boardroom
share token is the project token, the Boardroom owns locked AMM liquidity, and this bespoke scenario routes protocol
revenue directly to the project Boardroom.

## Initial Economics

| Mechanism | Setting | Effect |
| --- | --- | --- |
| AMM swap fee | `30 bps` | Paid by traders on AMM input. |
| AMM protocol share | `5%` of swap fees | `1.5 bps` of swap notional goes directly to the configured protocol fee recipient. |
| Grant creation fee | `0.1 HYPE` | Paid in scenario-native HYPE by grant creators and forwarded to the explicitly configured project Boardroom recipient. |

The scenario seeds `1,000,000 PLEDGE` against `100 HYPE` of Boardroom-owned locked liquidity. A `5 HYPE` buy routes
through the AMM and forwards protocol fee revenue to the Boardroom as wrapped HYPE. A separate grant issuer then creates
a `25,000 PLEDGE` grant; the Boardroom-owned factory forwards the `0.1 HYPE` native creation fee to its explicitly
configured Boardroom recipient. When wind-down starts, the Boardroom deposits that raw HYPE into the scenario's wrapped
native contract before entering `WindingDown`.

## State Machine

1. Deploy `BoardroomPolicyRegistry`, `AssetPolicy`, `BoardroomFactory`, `TokenGrantFactory`, `AmmFactory`, `AmmRouter`,
   `LockedLiquidityFactory`, and the local wrapped-HYPE test token.
2. Register the locked-liquidity factory as a Boardroom module policy, and use `AssetPolicy` for supported asset
   approvals. The scenario's external grant issuer calls `TokenGrantFactory` directly, so the factory is not registered
   as a Boardroom call policy in this script.
3. Create the project Boardroom and use its share token as `PLEDGE`.
4. Set the AMM protocol fee recipient to the project Boardroom.
5. Set the native token grant creation fee to `0.1 HYPE`, explicitly set its recipient to the project Boardroom, and
   transfer `TokenGrantFactory` ownership to the Boardroom.
6. Mint project tokens to the Boardroom for LP seeding and to an external grant issuer for grant escrow.
7. Fund the Boardroom with wrapped HYPE and lock PLEDGE/wrapped-HYPE liquidity through `Boardroom.executeBatch`.
8. Swap HYPE for PLEDGE and verify wrapped-HYPE protocol fee revenue reaches the Boardroom.
9. Create a PLEDGE grant from the external issuer and verify native creation-fee revenue reaches the Boardroom.
10. Start wind-down as the prelaunch owner and verify native creation-fee revenue is normalized into wrapped HYPE.

The script does not call `Boardroom.launch()`: “launch” here means the project-token market launch. Boardroom governance
remains in its prelaunch owner-execution phase until the owner starts wind-down, so this scenario does not exercise the
executor queue, timelock, active-staker veto, or permissionless ready-action execution.

## Assets And Authorities

- Project Boardroom: owns locked LP principal and receives protocol revenue.
- AMM factory governance: can rotate the protocol fee recipient and operational fee manager. This local scenario routes
  protocol fees directly to the project Boardroom; canonical root deployments use `ProtocolFeeRouter`.
- Token grant factory owner: sets the creation fee and independently selects its recipient; after handoff the owner is
  the Boardroom and this scenario has explicitly selected the same Boardroom as recipient.
- Boardroom owner: mints project tokens, approves Boardroom-owned assets through `AssetPolicy`, and creates locked
  liquidity through `LockedLiquidityFactory` as the Boardroom call policy. These are direct calls only because this
  scenario never launches queued governance.
- External trader: pays HYPE into the AMM and receives project tokens.
- External grant issuer: escrows project tokens into a grant and pays the native creation fee.

## Invariants

- AMM protocol fee recipient equals the project Boardroom for the duration of this scenario.
- Token grant creation fees are paid to `TokenGrantFactory.feeRecipient()`, explicitly configured as the project
  Boardroom; ownership transfer alone does not change it.
- Locked LP remains in the locker after the launch trade.
- The launch trade increases the Boardroom wrapped-HYPE balance by the exact configured protocol fee share.
- The grant creation increases the Boardroom native HYPE balance by exactly `0.1 HYPE`.
- `startWindDown()` deposits the Boardroom's scenario-native HYPE balance into the configured wrapped-native contract
  before the Boardroom enters `WindingDown`.
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
