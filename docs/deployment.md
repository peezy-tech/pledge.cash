# Deployment

This document covers the current contract deployment surface for TokenGrant, Boardroom, fixed-price distribution,
migrating bonding curve, AMM, and locked-liquidity primitives.

## HyperEVM Testnet

- Chain id: `998`
- Default RPC: `https://rpc.hyperliquid-testnet.xyz/evm`
- Deployment script: `packages/contracts/script/Deploy.s.sol`
- Wrapper: `packages/contracts/script/hyperevm-testnet/deploy.sh`
- Artifact: `packages/contracts/deployments/998.json`

The deploy script creates or reuses one `PledgeCashDeterministicDeployer`, then creates one
`BoardroomPolicyRegistry`, one `ProtocolPolicy`, one `AssetPolicy`, one
`TokenGrantFactory`, one `DistributionFactory`, one `AmmFactory`, one `AmmRouter`, one `LockedLiquidityFactory`, and one
`BoardroomFactory`. `WRAPPED_NATIVE_ADDRESS` is required because every Boardroom stores canonical WHYPE and wraps raw
native HYPE before wind-down redemptions.

Root protocol contracts are deployed through CREATE3 salts from `PledgeCashDeploymentSalts`. As long as the same
`PledgeCashDeterministicDeployer` address is used on each chain, the root protocol addresses are the same even when
constructor arguments differ by chain, such as the wrapped-native token. The deploy script can deploy the deterministic
deployer through Foundry's default Arachnid CREATE2 factory (`0x4e59b44847b379578588920cA78FbF26c0B4956C`) or reuse an
existing deployer from `PLEDGE_CASH_DETERMINISTIC_DEPLOYER`. The deterministic deployer's CREATE2 init code does not
encode the deployment key, so different funded operators can use the same deployer address on different chains. The
deployer owner is still set to the broadcaster on each chain and is checked before any root deployment runs.

The registry allows `ProtocolPolicy` for registered pledge.cash protocol targets and `AssetPolicy` for external asset
operations. The deploy script registers the token grant, distribution, locked-liquidity, and AMM factory targets in
`ProtocolPolicy`; only the token grant factory is separately allowed to receive native value for exact creation-fee
payments. `AmmRouter` is deployed for user and protocol flows but is not a Boardroom-callable protocol-policy target.
The deploy script also registers the token grant, distribution, and locked-liquidity factories as allowed approval
spenders in `AssetPolicy`. Boardroom-created share tokens and other project-specific assets still need to be registered
in `AssetPolicy` before their approvals can be executed through a Boardroom.

The checked-in HyperEVM testnet artifact may model subsystems independently while deployment history is being rebuilt.
If an existing artifact predates a current subsystem, mark that subsystem pending instead of keeping stale partial fields.
For example, a TokenGrant deployment without a current `DistributionFactory` should set `boardroomStatus: "pending"` and
omit Boardroom factory fields until a full Boardroom broadcast replaces the artifact.

## Environment

Start from `.env.example` and provide a funded deployment key when broadcasting:

```sh
cp .env.example .env
```

Required for broadcast:

```sh
HYPEREVM_TESTNET_PRIVATE_KEY=...
```

Optional:

```sh
HYPEREVM_TESTNET_RPC_URL=https://rpc.hyperliquid-testnet.xyz/evm
TOKEN_GRANT_CREATION_FEE_WEI=100000000000000000
AMM_PROTOCOL_FEE_RECIPIENT=
WRAPPED_NATIVE_ADDRESS=0x...
HYPEREVM_GAS_PRICE_WEI=
GAS_ESTIMATE_MULTIPLIER=200
CREATE2_FACTORY_ADDRESS=0x4e59b44847b379578588920cA78FbF26c0B4956C
PLEDGE_CASH_DETERMINISTIC_DEPLOYER=
```

`TOKEN_GRANT_CREATION_FEE_WEI` is the preferred variable. `GRANT_CREATION_FEE_WEI` remains supported by the Foundry
script as a legacy fallback.

`CREATE2_FACTORY_ADDRESS` must name the same CREATE2 factory on every deterministic target chain. If a chain does not
already have the factory deployed, bootstrap or select that factory before broadcasting. Set
`PLEDGE_CASH_DETERMINISTIC_DEPLOYER` only when a pledge.cash deterministic deployer already exists at the intended
cross-chain address and its owner is the current broadcaster.

## Dry Run

```sh
bun run simulate:hyperevm-testnet
```

The wrapper refuses any RPC that does not report chain id `998`. Dry runs set `WRITE_DEPLOYMENT_STATE=false`, so local
artifacts are not rewritten.

## Broadcast

```sh
BROADCAST=1 bun --cwd packages/contracts deploy:hyperevm-testnet
```

Broadcasts require `HYPEREVM_TESTNET_PRIVATE_KEY` or `PRIVATE_KEY`. The wrapper copies
`HYPEREVM_TESTNET_PRIVATE_KEY` into `PRIVATE_KEY` for Foundry.

## Artifact Checks

After a broadcast, verify `packages/contracts/deployments/998.json` contains:

- `chainId`
- `deployer`
- `deterministicDeployment`
- `deterministicDeploymentVersion`
- `create2Factory`
- `deterministicDeployer`
- `boardroomPolicyRegistry`
- `protocolPolicy`
- `assetPolicy`
- `boardroomFactory`
- `distributionFactory`
- `ammFactory`
- `wrappedNative`
- `ammRouter`
- `lockedLiquidityFactory`
- `policyRegistryOwner`
- `protocolPolicyOwner`
- `assetPolicyOwner`
- `protocolPolicyAllowed`
- `assetPolicyAllowed`
- `tokenGrantPolicyAllowed`
- `distributionPolicyAllowed`
- `lockedLiquidityPolicyAllowed`
- `protocolTokenGrantFactoryAllowed`
- `protocolTokenGrantFactoryValueAllowed`
- `protocolDistributionFactoryAllowed`
- `protocolLockedLiquidityFactoryAllowed`
- `protocolAmmFactoryAllowed`
- `protocolAmmRouterAllowed`
- `assetWrappedNativeAllowed`
- `assetTokenGrantSpenderAllowed`
- `assetDistributionSpenderAllowed`
- `assetLockedLiquiditySpenderAllowed`
- `factoryOwner`
- `tokenGrantFactory`
- `tokenGrantLogic`
- `creationFee`
- `deploymentTimestamp`

If `AMM_PROTOCOL_FEE_RECIPIENT` was configured, the artifact should also contain:

- `ammProtocolFeeRecipient`

For a partial artifact, keep the deployed subsystem fields and add the relevant pending status/reason fields for the
missing subsystem.

The deterministic local proof for the deployment code is:

```sh
bun --cwd packages/contracts build
bun --cwd packages/contracts test
cd packages/contracts && forge fmt --check
```

## Local Anvil Seed

For a semi-persistent local deployment, run Anvil on chain id `31337`, broadcast
`Deploy.s.sol` with a predeployed wrapped-native contract, then seed demo tokens,
direct grants, Boardroom grants, partial settlements, one transferred grant right,
and one halted grant:

```sh
cd packages/contracts
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
WRAPPED_NATIVE_ADDRESS=0x... \
WRITE_DEPLOYMENT_STATE=true \
forge script script/Deploy.s.sol:Deploy \
  --rpc-url http://127.0.0.1:8547 \
  --chain 31337 \
  --always-use-create-2-factory \
  --create2-deployer 0x4e59b44847b379578588920cA78FbF26c0B4956C \
  --broadcast

LOCAL_SEED_NONCE=1 \
forge script script/SeedLocal.s.sol:SeedLocal \
  --rpc-url http://127.0.0.1:8547 \
  --chain 31337 \
  --broadcast
```

`SeedLocal` uses Anvil's public development keys only. Change
`LOCAL_SEED_NONCE` to add another batch of scenarios to an existing local chain,
or reset the Anvil state file before replaying the same nonce. The local
artifacts `packages/contracts/deployments/31337.json` and
`packages/contracts/deployments/31337.seed.json` are intentionally ignored.
