# Deployment

This document covers the current contract deployment surface for TokenGrant and Boardroom primitives. AMM, SDK, and
website deployment flows should get their own sections when those products are reintroduced.

## HyperEVM Testnet

- Chain id: `998`
- Default RPC: `https://rpc.hyperliquid-testnet.xyz/evm`
- Deployment script: `packages/contracts/script/Deploy.s.sol`
- Wrapper: `packages/contracts/script/hyperevm-testnet/deploy.sh`
- Artifact: `packages/contracts/deployments/998.json`

The deploy script creates one `BoardroomPolicyRegistry`, one `TokenGrantFactory`, and one `BoardroomFactory`. It allows
the token grant factory as the first Boardroom policy, records the grant logic, and optionally sets the native grant
creation fee.

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
HYPEREVM_GAS_PRICE_WEI=
GAS_ESTIMATE_MULTIPLIER=200
```

`TOKEN_GRANT_CREATION_FEE_WEI` is the preferred variable. `GRANT_CREATION_FEE_WEI` remains supported by the Foundry
script as a legacy fallback.

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
- `boardroomPolicyRegistry`
- `boardroomFactory`
- `policyRegistryOwner`
- `tokenGrantPolicyAllowed`
- `factoryOwner`
- `tokenGrantFactory`
- `tokenGrantLogic`
- `creationFee`
- `deploymentTimestamp`

The deterministic local proof for the deployment code is:

```sh
bun --cwd packages/contracts build
bun --cwd packages/contracts test
cd packages/contracts && forge fmt --check
```

## Local Anvil Seed

For a semi-persistent local deployment, run Anvil on chain id `31337`, broadcast
`Deploy.s.sol`, then seed demo tokens, direct grants, Boardroom grants, partial
settlements, one transferred grant right, and one halted grant:

```sh
cd packages/contracts
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
WRITE_DEPLOYMENT_STATE=true \
forge script script/Deploy.s.sol:Deploy \
  --rpc-url http://127.0.0.1:8547 \
  --chain 31337 \
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
