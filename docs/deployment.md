# Deployment

This document covers the current contract deployment surface for TokenGrant, Boardroom, fixed-price sale, bond market,
Merkle airdrop, migrating bonding curve, AMM, and locked-liquidity primitives.

## Testnet Targets

| Network | Chain id | Default RPC | Wrapped native | Wrapper | Artifact status |
| --- | ---: | --- | --- | --- | --- |
| HyperEVM Testnet | `998` | `https://rpc.hyperliquid-testnet.xyz/evm` | `0x5555555555555555555555555555555555555555` | `packages/contracts/script/hyperevm-testnet/deploy.sh` | `998.json`: `pending` |
| Monad Testnet | `10143` | `https://testnet-rpc.monad.xyz` | `0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541` | `packages/contracts/script/monad-testnet/deploy.sh` | `10143.json`: `pending` |

Target support is not deployment evidence. Both checked-in artifacts currently say
`Authority-hardened deterministic v4 deployment has not been broadcast yet`; each contains a chain id, `status`, and
`reason`, but no protocol addresses. Treat HyperEVM and Monad as supported broadcast targets, not live pledge.cash
deployments, until a wrapper has promoted a fully verified candidate artifact.

The deploy script creates or reuses one `PledgeCashDeterministicDeployer`, then creates one
`BoardroomPolicyRegistry`, one `AssetPolicy`, one `BoardroomGovernanceLogic`, one `BoardroomRedemptionPayout`, one
`ProtocolFeeRouter`, one `BoardroomFactory`, one `TokenGrantFactory`, one `AmmFactory`, one `AmmRouter`, one
`LockedLiquidityFactory`, one `DistributionFactory`, one `BoardroomRewardsFactory`, and one `BondMarketFactory`. The two Boardroom helpers are deterministic roots deployed
before the factory and injected into its internally created `boardroomLogic` implementation. The Boardroom factory is
deployed before the token-grant and locked-liquidity factories because its address is an immutable provenance
constructor argument for both. A wrapped-native address is required because every Boardroom stores the canonical
wrapped native token and wraps raw native funds before wind-down redemptions.

Root protocol contracts are deployed through CREATE3 salts from `PledgeCashDeploymentSalts`. As long as the same
`PledgeCashDeterministicDeployer` address is used on each chain, the root protocol addresses are the same even when
constructor arguments differ by chain, such as the wrapped-native token. The deploy script can deploy the deterministic
deployer through Foundry's default Arachnid CREATE2 factory (`0x4e59b44847b379578588920cA78FbF26c0B4956C`) or reuse an
existing deployer from `PLEDGE_CASH_DETERMINISTIC_DEPLOYER`. The deterministic deployer owner is encoded in constructor
arguments, so it cannot be captured by the first account to deploy the public salt. Use the same
`PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER` on every chain that should share deterministic root addresses.

The security-remediated root stack uses the `pledge.cash.deterministic.v4` namespace. The deterministic deployer itself
keeps its original v1 salt because its bytecode and cross-chain address are unchanged. Each v4 root salt includes the
hash of that root's creation bytecode, including any embedded implementation bytecode. A bytecode change therefore
changes the salt mechanically rather than depending on an operator to remember a manual version bump. The artifact also
records one aggregate `deterministicReleaseCodeHash` and each deployed runtime code hash. Constructor arguments remain
outside the release salt and continue to affect the CREATE3 initialization transaction rather than the root address.
The factory-created Boardroom implementation is not a separate CREATE3 root, but its address and runtime code hash are
serialized and verified together with both helper roots and their immutable wiring.

## Authority And Revenue Roles

The broadcaster is a bootstrap operator, not the default long-term authority. `Deploy.s.sol` configures the complete
stack and then transfers the registry, asset policy, protocol fee router, token-grant factory, and AMM factory to
`PLEDGE_CASH_PROTOCOL_GOVERNANCE`. It independently configures:

- `PLEDGE_CASH_PROTOCOL_TREASURY` as `ProtocolFeeRouter.feeRecipient()`;
- `PLEDGE_CASH_AMM_FEE_MANAGER` as the operational authority for bounded AMM excess recovery and synchronization;
- `ProtocolFeeRouter` as both the token-grant creation-fee recipient and the AMM protocol-fee recipient;
- `AmmRouter` as the only router allowed to consume a reserved initial-liquidity mint;
- `LockedLiquidityFactory` as the only initial-liquidity reservation manager.

Governance can rotate the treasury destination, AMM fee manager, and AMM protocol recipient after deployment. Protocol
revenue is not coupled to a wind-downable project Boardroom or to factory ownership. The deterministic deployer remains
owned by `PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER`; the current script requires that role to match the broadcaster so it
can deploy or reuse roots safely.

The registry allows `AssetPolicy` for external asset operations and permanently registers the token-grant,
distribution, Boardroom-reward, bond-market, and locked-liquidity factories as module policies. Registration starts each module in `Active` status.
Protocol governance may later set a policy to `LifecycleOnly` or `Disabled`; either status blocks new active calls, but
permanent module identity and each obligation's canonical-policy binding preserve its approved cleanup calls. A disabled
module therefore cannot become an untracked raw-call target. Each factory authorizes its own calls and reports any
created Boardroom obligation for redemption accounting. `AmmRouter` is deployed for user and protocol flows but is not
a deployment-default Boardroom policy. The deploy script also registers the token-grant, distribution, Boardroom-reward,
bond-market, and locked-liquidity factories as allowed approval spenders in `AssetPolicy`. Boardroom-created share tokens and other
project-specific assets still need protocol-governance registration in `AssetPolicy` before a Boardroom can approve them
through that policy.

The checked-in testnet artifacts may model subsystems independently while deployment history is being rebuilt. If an
existing artifact predates a current subsystem, mark that subsystem pending instead of keeping stale partial fields. A
current TokenGrant deployment is no longer independent of Boardroom provenance: every artifact containing
`tokenGrantFactory` must also contain the canonical `boardroomFactory` embedded in that factory. Other missing Boardroom
or distribution fields may remain pending until a full stack broadcast replaces the artifact. A v4 artifact is current
only when it includes the authority, wiring, release-hash, and per-contract runtime-codehash attestations described
below.

## Environment

Start from `.env.example`. Each wrapper requires its matching funded deployment key for both dry-run simulation and broadcast because it derives and verifies the deployer before running Foundry:

```sh
cp .env.example .env
```

Required for dry runs and broadcasts:

```sh
PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER=0x...
PLEDGE_CASH_PROTOCOL_GOVERNANCE=0x...
PLEDGE_CASH_PROTOCOL_TREASURY=0x...
PLEDGE_CASH_AMM_FEE_MANAGER=0x...
```

Required for the HyperEVM wrapper, including dry runs:

```sh
HYPEREVM_TESTNET_PRIVATE_KEY=...
HYPEREVM_WRAPPED_NATIVE_ADDRESS=0x5555555555555555555555555555555555555555
```

Required for the Monad wrapper, including dry runs:

```sh
MONAD_TESTNET_PRIVATE_KEY=...
```

Monad uses its canonical WMON default unless `MONAD_TESTNET_WRAPPED_NATIVE_ADDRESS` is set.

Optional:

```sh
HYPEREVM_TESTNET_RPC_URL=https://rpc.hyperliquid-testnet.xyz/evm
MONAD_TESTNET_RPC_URL=https://testnet-rpc.monad.xyz
MONAD_TESTNET_WRAPPED_NATIVE_ADDRESS=0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541
TOKEN_GRANT_CREATION_FEE_WEI=100000000000000000
HYPEREVM_GAS_PRICE_WEI=
HYPEREVM_GAS_ESTIMATE_MULTIPLIER=100
MONAD_GAS_ESTIMATE_MULTIPLIER=100
CREATE2_FACTORY_ADDRESS=0x4e59b44847b379578588920cA78FbF26c0B4956C
PLEDGE_CASH_DETERMINISTIC_DEPLOYER=
```

`TOKEN_GRANT_CREATION_FEE_WEI` is the preferred variable. `GRANT_CREATION_FEE_WEI` remains supported by the Foundry
script as a legacy fallback.
`WRAPPED_NATIVE_ADDRESS` remains supported as a legacy HyperEVM fallback. The Monad wrapper uses
`MONAD_TESTNET_WRAPPED_NATIVE_ADDRESS` or the canonical WMON default so an older HyperEVM env cannot leak into Monad.
Both testnet wrappers default their gas estimate multipliers to `100`. Monad charges the full transaction gas limit
rather than post-execution gas used, and the HyperEVM deployment has transactions that must fit large-block limits.

For Monad broadcasts, install Monad Foundry before running the wrapper:

```sh
foundryup --network monad
```

For HyperEVM broadcasts, route the deployment account to big blocks before deploying because several root-contract
transactions exceed the small-block `2M` gas limit. HyperEVM big blocks are slower, so a full broadcast can take many
minutes. Switch back to small blocks after the deployment:

```sh
npx -y @layerzerolabs/hyperliquid-composer set-block --size big --network testnet --ci --private-key "$HYPEREVM_TESTNET_PRIVATE_KEY"
bun run deploy:hyperevm-testnet
npx -y @layerzerolabs/hyperliquid-composer set-block --size small --network testnet --ci --private-key "$HYPEREVM_TESTNET_PRIVATE_KEY"
```

`CREATE2_FACTORY_ADDRESS` must name the same CREATE2 factory on every deterministic target chain. If a chain does not
already have the factory deployed, bootstrap or select that factory before broadcasting.
`PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER` must name the same owner on every chain that should share root addresses, and
the current script requires it to match the broadcaster. Set `PLEDGE_CASH_DETERMINISTIC_DEPLOYER` only when a
pledge.cash deterministic deployer already exists at the intended cross-chain address and its owner matches
`PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER`.

The three explicit protocol roles may use one development address locally, but production-like deployments should use
durable, deliberately chosen accounts. In particular, do not use a project Boardroom as the canonical governance,
treasury, or AMM operations role merely because the broadcaster controls it.

## Dry Run

```sh
bun run simulate:hyperevm-testnet
bun run simulate:monad-testnet
bun run simulate:testnets
```

Each wrapper refuses RPCs that do not report the expected chain id. Dry runs set `WRITE_DEPLOYMENT_STATE=false`, so local
artifacts are not rewritten. Dry runs still require the deployment private key so the simulated broadcaster matches
`PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER`.

## Broadcast

```sh
bun run deploy:hyperevm-testnet
bun run deploy:monad-testnet
bun run deploy:testnets
```

Broadcasts require the chain-specific private key or `PRIVATE_KEY`. The wrappers copy the chain-specific key into
`PRIVATE_KEY` for Foundry. The Foundry script first writes a chain-specific `.candidate.json` artifact. The wrapper then
verifies all live wiring, owners, policy state, and runtime code hashes through the target RPC. It promotes the candidate
to the checked-in artifact path only if every check succeeds; a failed verification never overwrites the last published
artifact.

## Artifact Checks

After a broadcast, verify each chain artifact contains:

- `chainId`
- `deployer`
- `deterministicDeployment`
- `deterministicDeploymentVersion`
- `deterministicReleaseCodeHash`
- `create2Factory`
- `deterministicDeployer`
- `deterministicDeployerOwner`
- `boardroomPolicyRegistry`
- `assetPolicy`
- `protocolFeeRouter`
- `boardroomFactory`
- `boardroomGovernanceLogic`
- `boardroomRedemptionPayout`
- `boardroomLogic`
- `distributionFactory`
- `boardroomRewardsFactory`
- `bondMarketFactory`
- `bondMarketLogic`
- `ammFactory`
- `wrappedNative`
- `ammRouter`
- `lockedLiquidityFactory`
- `protocolGovernance`
- `protocolTreasury`
- `policyRegistryOwner`
- `assetPolicyOwner`
- `protocolFeeRouterOwner`
- `protocolFeeRouterRecipient`
- `ammFactoryOwner`
- `ammFeeManager`
- `ammProtocolFeeRecipient`
- `ammLiquidityRouter`
- `ammReservationManager`
- `assetPolicyAllowed`
- `tokenGrantPolicyAllowed`
- `tokenGrantModulePolicy`
- `distributionPolicyAllowed`
- `distributionModulePolicy`
- `boardroomRewardsPolicyAllowed`
- `boardroomRewardsModulePolicy`
- `bondMarketPolicyAllowed`
- `bondMarketModulePolicy`
- `lockedLiquidityPolicyAllowed`
- `lockedLiquidityModulePolicy`
- `assetWrappedNativeAllowed`
- `assetTokenGrantSpenderAllowed`
- `assetDistributionSpenderAllowed`
- `assetBoardroomRewardsSpenderAllowed`
- `assetBondMarketSpenderAllowed`
- `assetLockedLiquiditySpenderAllowed`
- `factoryOwner`
- `tokenGrantFeeRecipient`
- `tokenGrantFactory`
- `tokenGrantLogic`
- `creationFee`
- `deploymentTimestamp`
- `deterministicDeployerCodeHash`
- `boardroomPolicyRegistryCodeHash`
- `assetPolicyCodeHash`
- `protocolFeeRouterCodeHash`
- `boardroomFactoryCodeHash`
- `boardroomGovernanceLogicCodeHash`
- `boardroomRedemptionPayoutCodeHash`
- `boardroomLogicCodeHash`
- `tokenGrantFactoryCodeHash`
- `ammFactoryCodeHash`
- `ammRouterCodeHash`
- `lockedLiquidityFactoryCodeHash`
- `distributionFactoryCodeHash`
- `boardroomRewardsFactoryCodeHash`
- `bondMarketFactoryCodeHash`
- `bondMarketLogicCodeHash`
- `wrappedNativeCodeHash`

The five `*ModulePolicy` identity fields must be `true`. Unlike the corresponding mutable `*PolicyAllowed` status,
module identity is permanent and remains true if an operator later disables new calls to that module.

`TokenGrantFactory.boardroomFactory()` is an immutable provenance link and must equal the artifact's `boardroomFactory`.
The fee-exempt distribution-grant path accepts issuers only when that canonical factory reports them as deployed
Boardrooms; artifact verification checks the link directly to prevent a miswired deployment.

`BoardroomFactory` must point to the artifact's governance helper, redemption helper, and Boardroom implementation.
That implementation must point back to the same two helpers, and both `AmmFactory.boardroomFactory()` and
`LockedLiquidityFactory.boardroomFactory()` must equal the same canonical factory. The verifier checks each link against
live contract state. The AMM link makes the factory's canonical share-token registry authoritative for protected first
liquidity.

The verifier also requires `TokenGrantFactory.feeRecipient()` and `AmmFactory.protocolFeeRecipient()` to equal the
artifact's `protocolFeeRouter`, requires that router's destination to equal `protocolTreasury`, and requires the AMM
liquidity router and reservation manager to equal `AmmRouter` and `LockedLiquidityFactory` respectively. Every serialized
runtime code hash is recomputed from live bytecode.

For a partial artifact, keep the deployed subsystem fields and add the relevant pending status/reason fields for the
missing subsystem.

The deterministic local proof for the deployment code is:

```sh
bun --cwd packages/contracts build
bun --cwd packages/contracts test
cd packages/contracts && forge fmt --check
```

## Web Network Selection

The web app can switch between the checked-in HyperEVM testnet, Monad testnet, and a local Anvil profile at runtime.
The selected chain is stored in browser local storage and can also be opened directly with `?chain=998`, `?chain=10143`,
or `?chain=31337`.

A selectable network profile proves only RPC and chain metadata. With the current pending `998.json` and `10143.json`
artifacts, the app has no verified root contracts to transact with on either testnet. Local Anvil is the current complete
interactive scenario when its ignored deployment and seed artifacts have been generated.

Local Anvil uses chain id `31337` and reads ignored runtime artifacts from:

- `packages/contracts/deployments/31337.json`
- `packages/contracts/deployments/31337.seed.json`

Static builds copy those artifacts into the app's `deployments/` directory. Vite dev serves the same files through a
development middleware so local chain selection works without copying ignored artifacts into `apps/web/public`.

For root-path local browser development, run:

```sh
bun --cwd apps/web dev
```

The Local Anvil network defaults to `http://127.0.0.1:8547` in that mode. For a subpath or remote-browser setup where
the app is served at `/pledge-cash/` and the RPC is reverse-proxied at `/pledge-cash/rpc`, run:

```sh
bun --cwd apps/web dev:local
```

Use `VITE_PLEDGE_CASH_LOCAL_RPC_URL` to override the Local Anvil RPC endpoint without changing the testnet profiles.
If `VITE_PLEDGE_CASH_CHAIN_ID` is set to another chain id, the app preserves the legacy single-network behavior by
adding a custom selectable profile from `VITE_PLEDGE_CASH_RPC_URL`, `VITE_PLEDGE_CASH_CHAIN_NAME`,
`VITE_PLEDGE_CASH_EXPLORER_URL`, and `VITE_PLEDGE_CASH_WRAPPED_NATIVE_SYMBOL`.

## Local Anvil Seed

For a semi-persistent local deployment, run Anvil on chain id `31337`, broadcast
`Deploy.s.sol` with a predeployed wrapped-native contract, then seed the repeatable
scenario matrix implemented by `SeedLocal.s.sol`:

- direct grant variations: free partially settled, paid transferred and settled,
  and halted before cliff;
- Seed Labs: prelaunch Boardroom-issued migrating curve, two curve buyers, migration into locked AMM liquidity, three
  post-migration AMM buys, claimable locked-liquidity fees, active reserve and LP bond markets with purchases, and
  three employee option variants (partially settled active, unvested future-cliff, and vested partially settled), plus
  a 30-day prefunded CASH reward stream with an investor actively staking 1,000 SEED shares behind a seven-day cooldown;
- Atlas Payroll: prelaunch active fixed-price sale with two buyers;
- Northstar Robotics: prelaunch active bonding curve with three buys and one sell;
- Harbor Analytics: prelaunch closed fixed-price sale with two historical buyers and treasury cash already raised;
- Beacon Contributors: live two-leaf Merkle airdrop with index `0` already claimed, index `1` still claimable, and both
  leaves and sibling proofs written to the seed manifest;
- Civic Compute: launched holder governance with a one-day delay and a queued `setExecutor` action still waiting;
- Tidelock Storage: winding down while an active fixed-price distribution remains recorded as the explicit blocker to
  opening redemptions;
- Final Harbor: redemptions open with CASH registered and snapshotted as a redeemable asset while the seeded holder
  retains the full circulating share balance.

The first four project Boardrooms remain prelaunch. The lifecycle Boardrooms are intentionally independent so airdrop,
governance, wind-down, and redemption browser checks cannot invalidate one another. The ignored
`deployments/31337.seed.json` manifest includes the actor identities, Merkle root/leaves/proofs, queued-action hash,
salt, and calldata, wind-down blocker identity, and redemption asset/snapshot values needed by browser automation.
Queued-action ETA and expiry must be read from `governanceState(actionHash)`: broadcast block timestamps intentionally are
not copied from Forge's pre-broadcast simulation into the fixture.

```sh
cd packages/contracts
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
PLEDGE_CASH_PROTOCOL_GOVERNANCE=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
PLEDGE_CASH_PROTOCOL_TREASURY=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
PLEDGE_CASH_AMM_FEE_MANAGER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
WRAPPED_NATIVE_ADDRESS=0x... \
WRITE_DEPLOYMENT_STATE=true \
forge script script/Deploy.s.sol:Deploy \
  --rpc-url http://127.0.0.1:8547 \
  --chain 31337 \
  --always-use-create-2-factory \
  --create2-deployer 0x4e59b44847b379578588920cA78FbF26c0B4956C \
  --broadcast

LOCAL_SEED_NONCE=1 \
LOCAL_RPC_URL=http://127.0.0.1:8547 \
bun run scenario:local-seed:local
```

`SeedLocal` uses Anvil's public development keys only. Change
`LOCAL_SEED_NONCE` to add another batch of scenarios to an existing local chain,
or reset the Anvil state file before replaying the same nonce. The local
artifacts `packages/contracts/deployments/31337.json` and
`packages/contracts/deployments/31337.seed.json` are intentionally ignored.
