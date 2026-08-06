# Deployment

## Status

pledge.cash is unreleased. Ethereum Sepolia (`11155111`) and Base Sepolia (`84532`) are
the canonical testnet candidates. Their checked-in artifacts are pending and contain no
live pledge.cash addresses. Mainnet profiles are planning inputs only.

The repository's acceptance work may simulate deployments and broadcast into disposable
local forks. It must not broadcast to a public network without a separate authorization.

## Lean artifact

A release artifact identifies:

- the pledge.cash deterministic deployer;
- `BoardroomFactory`;
- `ProtocolFeeRouter`;
- `TokenGrantFactory`;
- `LiquidityLockerFactory`;
- external wrapped-native, Uniswap v4 `PoolManager`, `PositionManager`, Universal Router,
  Quoter, StateView, and Permit2 addresses from the network profile;
- release commit, chain ID, release and manifest hashes, runtime code hashes, owners,
  fee recipient, and pending or finalized state.

Removed governance, diamond, distribution, rewards, bond, hook, and position-vault
contracts are not valid artifact fields.

## Local proof

From the repository root:

```sh
bun run validate:networks
bun run simulate:sepolia
bun run simulate:base-sepolia
bun run test:testnet-forks:deployment
bun run scenario:project-token:local
```

Simulation computes and verifies the complete lean stack without broadcasting. Fork
tests start local Anvil chains pinned to public testnet state, deploy only into those
disposable processes, and verify code, wiring, ownership, and idempotence. The scenario
then proves retained project behavior locally.

## Broadcast boundary

The public-network wrapper requires an explicit RPC, funded deployment key, chain and
commit confirmation, clean source, and an authorized release ceremony. A successful
simulation or fork does not grant that authority. Candidate artifacts must remain
pending until a real receipt is independently verified, source code is published, and
the exact deployed runtime hashes match the release artifact.

After separate authorization, the remaining testnet operation is the guarded generic
wrapper (there are no chain-specific broadcast shortcuts). With the operator values
already loaded into the named shell variables:

```sh
PLEDGE_CASH_RPC_URL="$OPERATOR_RPC_URL" \
PLEDGE_CASH_DEPLOYER_PRIVATE_KEY="$FUNDED_TESTNET_PRIVATE_KEY" \
PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER="$DEPLOYER_ADDRESS" \
PLEDGE_CASH_PROTOCOL_OWNER="$PROTOCOL_OWNER_ADDRESS" \
PLEDGE_CASH_PROTOCOL_TREASURY="$PROTOCOL_TREASURY_ADDRESS" \
bun run deploy:network -- "$CHAIN_ID" --broadcast "$CHAIN_ID:$REVIEWED_HEAD"
```

The wrapper refuses a dirty worktree, an implicit public RPC, an owner/key mismatch,
or an incorrect chain-and-commit confirmation. It retains the candidate and receipt
evidence for an explicit promotion decision; it does not silently replace the checked-in
pending artifact.

See the [readiness checklist](mainnet-readiness/README.md) before considering any
broadcast.
