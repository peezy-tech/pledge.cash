# Deployment

This document covers the current contract deployment surface for TokenGrant, Boardroom, fixed-price distribution,
migrating bonding curve, AMM, and locked-liquidity primitives.

## Testnet Targets

| Network | Chain id | Default RPC | Wrapped native | Wrapper | Artifact |
| --- | ---: | --- | --- | --- | --- |
| HyperEVM Testnet | `998` | `https://rpc.hyperliquid-testnet.xyz/evm` | `HYPEREVM_WRAPPED_NATIVE_ADDRESS` | `packages/contracts/script/hyperevm-testnet/deploy.sh` | `packages/contracts/deployments/998.json` |
| Monad Testnet | `10143` | `https://testnet-rpc.monad.xyz` | `0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541` | `packages/contracts/script/monad-testnet/deploy.sh` | `packages/contracts/deployments/10143.json` |

The deploy script creates or reuses one `PledgeCashDeterministicDeployer`, then creates one
`BoardroomPolicyRegistry`, one `ProtocolPolicy`, one `AssetPolicy`, one
`TokenGrantFactory`, one `DistributionFactory`, one `AmmFactory`, one `AmmRouter`, one `LockedLiquidityFactory`, and one
`BoardroomFactory`. A wrapped-native address is required because every Boardroom stores the canonical wrapped native
token and wraps raw native funds before wind-down redemptions.

Root protocol contracts are deployed through CREATE3 salts from `PledgeCashDeploymentSalts`. As long as the same
`PledgeCashDeterministicDeployer` address is used on each chain, the root protocol addresses are the same even when
constructor arguments differ by chain, such as the wrapped-native token. The deploy script can deploy the deterministic
deployer through Foundry's default Arachnid CREATE2 factory (`0x4e59b44847b379578588920cA78FbF26c0B4956C`) or reuse an
existing deployer from `PLEDGE_CASH_DETERMINISTIC_DEPLOYER`. The deterministic deployer owner is encoded in constructor
arguments, so it cannot be captured by the first account to deploy the public salt. Use the same
`PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER` on every chain that should share deterministic root addresses.

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

Required for dry runs and broadcasts:

```sh
PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER=0x...
HYPEREVM_WRAPPED_NATIVE_ADDRESS=0x...
```

Required for broadcast:

```sh
HYPEREVM_TESTNET_PRIVATE_KEY=...
MONAD_TESTNET_PRIVATE_KEY=...
```

Optional:

```sh
HYPEREVM_TESTNET_RPC_URL=https://rpc.hyperliquid-testnet.xyz/evm
MONAD_TESTNET_RPC_URL=https://testnet-rpc.monad.xyz
MONAD_TESTNET_WRAPPED_NATIVE_ADDRESS=0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541
TOKEN_GRANT_CREATION_FEE_WEI=100000000000000000
AMM_PROTOCOL_FEE_RECIPIENT=
HYPEREVM_GAS_PRICE_WEI=
HYPEREVM_GAS_ESTIMATE_MULTIPLIER=200
MONAD_GAS_ESTIMATE_MULTIPLIER=100
CREATE2_FACTORY_ADDRESS=0x4e59b44847b379578588920cA78FbF26c0B4956C
PLEDGE_CASH_DETERMINISTIC_DEPLOYER=
```

`TOKEN_GRANT_CREATION_FEE_WEI` is the preferred variable. `GRANT_CREATION_FEE_WEI` remains supported by the Foundry
script as a legacy fallback.
`WRAPPED_NATIVE_ADDRESS` remains supported as a legacy HyperEVM fallback. The Monad wrapper uses
`MONAD_TESTNET_WRAPPED_NATIVE_ADDRESS` or the canonical WMON default so an older HyperEVM env cannot leak into Monad.
Monad defaults `MONAD_GAS_ESTIMATE_MULTIPLIER` to `100` because Monad charges the full transaction gas limit rather
than post-execution gas used.

For Monad broadcasts, install Monad Foundry before running the wrapper:

```sh
foundryup --network monad
```

`CREATE2_FACTORY_ADDRESS` must name the same CREATE2 factory on every deterministic target chain. If a chain does not
already have the factory deployed, bootstrap or select that factory before broadcasting.
`PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER` must name the same owner on every chain that should share root addresses, and
the current script requires it to match the broadcaster. Set `PLEDGE_CASH_DETERMINISTIC_DEPLOYER` only when a
pledge.cash deterministic deployer already exists at the intended cross-chain address and its owner matches
`PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER`.

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
`PRIVATE_KEY` for Foundry.

## Artifact Checks

After a broadcast, verify each chain artifact contains:

- `chainId`
- `deployer`
- `deterministicDeployment`
- `deterministicDeploymentVersion`
- `create2Factory`
- `deterministicDeployer`
- `deterministicDeployerOwner`
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

Monad testnet is checked in as a pending artifact until the first broadcast writes
`packages/contracts/deployments/10143.json`.

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
PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
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
