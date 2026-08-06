#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

CONTRACTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPO_DIR="$(cd "$CONTRACTS_DIR/../.." && pwd)"
MANIFEST="$CONTRACTS_DIR/config/networks.json"
readonly LOCAL_CHAIN_ID=31337
readonly ANVIL_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
readonly ANVIL_DEPLOYER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

fail() {
  echo "Network fork deployment failed: $*" >&2
  exit 1
}

if [[ "$#" -ne 1 || ! "$1" =~ ^[0-9]+$ ]]; then
  echo "usage: network-fork/deploy.sh <chain-id>" >&2
  exit 64
fi

for command in anvil bun cast forge git jq; do
  command -v "$command" >/dev/null || fail "missing required command: $command"
done

chain_id="$1"
cd "$CONTRACTS_DIR"
bun script/network-profiles.ts >/dev/null
profile="$(jq -cer --argjson chainId "$chain_id" '.profiles[] | select(.chainId == $chainId)' "$MANIFEST")" \
  || fail "chain $chain_id is outside the approved support policy"
network_name="$(jq -r '.name' <<<"$profile")"
rpc_env_name="$(jq -r '.rpcEnv' <<<"$profile")"
default_rpc_url="$(jq -r '.defaultRpcUrl' <<<"$profile")"
rpc_url="${PLEDGE_CASH_RPC_URL:-${RPC_URL:-}}"
if [[ -z "$rpc_url" ]]; then
  rpc_url="${!rpc_env_name:-}"
fi
rpc_url="${rpc_url:-$default_rpc_url}"

fork_port="${NETWORK_FORK_PORT:-8551}"
fork_block_env="${rpc_env_name%_RPC_URL}_FORK_BLOCK"
fork_block="${NETWORK_FORK_BLOCK:-${!fork_block_env:-}}"
evidence_dir="$(mktemp -d)"
anvil_pid=""
artifact_path=""
rerun_artifact_path=""

cleanup() {
  local status=$?
  trap - EXIT
  if [[ -n "$anvil_pid" ]]; then
    kill "$anvil_pid" 2>/dev/null || true
    wait "$anvil_pid" 2>/dev/null || true
  fi
  if [[ -n "$artifact_path" && -f "$artifact_path" ]]; then
    mv "$artifact_path" "$evidence_dir/deployment-unfinalized.json"
  fi
  if [[ -n "$rerun_artifact_path" && -f "$rerun_artifact_path" ]]; then
    mv "$rerun_artifact_path" "$evidence_dir/deployment-rerun-unfinalized.json"
  fi
  if [[ "$status" -ne 0 ]]; then
    echo "Fork evidence retained at $evidence_dir" >&2
  fi
  exit "$status"
}
trap cleanup EXIT

[[ "$fork_port" =~ ^[0-9]+$ ]] || fail "NETWORK_FORK_PORT must be numeric"
[[ "$fork_port" -ge 1 && "$fork_port" -le 65535 ]] \
  || fail "NETWORK_FORK_PORT must be between 1 and 65535"

forge_version="$(forge --version | sed -n '1p')"
[[ "$forge_version" == "forge Version: 1.7.1" ]] \
  || fail "Foundry v1.7.1 is required, got: $forge_version"
anvil_version="$(anvil --version | sed -n '1p')"
[[ "$anvil_version" == "anvil Version: 1.7.1" ]] \
  || fail "Foundry v1.7.1 Anvil is required, got: $anvil_version"

source_commit="$(git -C "$REPO_DIR" rev-parse HEAD)"
[[ "$source_commit" =~ ^[0-9a-f]{40}$ ]] || fail "could not resolve an exact source commit"
dirty_worktree="$(git -C "$REPO_DIR" status --porcelain --untracked-files=normal)"
if [[ -n "$dirty_worktree" && "${ALLOW_DIRTY_FORK_PROOF:-0}" != "1" ]]; then
  fail "refusing to attest a dirty worktree; set ALLOW_DIRTY_FORK_PROOF=1 only for an interim development run"
fi

PLEDGE_CASH_RPC_URL="$rpc_url" script/verify-network-profile-live.sh "$chain_id" \
  >"$evidence_dir/profile-preflight.log"
if [[ -z "$fork_block" ]]; then
  fork_block="$(cast block-number --rpc-url "$rpc_url")"
fi
[[ "$fork_block" =~ ^[0-9]+$ && "$fork_block" -gt 0 ]] \
  || fail "NETWORK_FORK_BLOCK or $fork_block_env must be a positive decimal block number"

local_rpc="http://127.0.0.1:$fork_port"
if cast chain-id --rpc-url "$local_rpc" >/dev/null 2>&1; then
  fail "port $fork_port already serves an RPC endpoint"
fi

anvil \
  --silent \
  --port "$fork_port" \
  --chain-id "$LOCAL_CHAIN_ID" \
  --fork-url "$rpc_url" \
  --fork-block-number "$fork_block" \
  >"$evidence_dir/anvil.log" 2>&1 &
anvil_pid=$!

for _attempt in $(seq 1 80); do
  if cast chain-id --rpc-url "$local_rpc" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done
[[ "$(cast chain-id --rpc-url "$local_rpc")" == "$LOCAL_CHAIN_ID" ]] \
  || fail "fork did not start with chain id $LOCAL_CHAIN_ID"

while IFS='|' read -r dependency_label dependency_address expected_hash; do
  dependency_code="$(cast code --rpc-url "$local_rpc" "$dependency_address")"
  [[ "$dependency_code" != "0x" ]] || fail "$dependency_label has no code at $dependency_address"
  actual_hash="$(cast keccak "$dependency_code")"
  [[ "${actual_hash,,}" == "${expected_hash,,}" ]] \
    || fail "$dependency_label code hash changed: expected $expected_hash, got $actual_hash"
done < <(
  jq -r '
    [
      ["CREATE2 factory", .create2Factory.address, .create2Factory.codeHash],
      ["wrapped native", .wrappedNative.address, .wrappedNative.codeHash],
      ["PoolManager", .uniswap.poolManager.address, .uniswap.poolManager.codeHash],
      ["Universal Router", .uniswap.universalRouter.address, .uniswap.universalRouter.codeHash],
      ["Quoter", .uniswap.quoter.address, .uniswap.quoter.codeHash],
      ["StateView", .uniswap.stateView.address, .uniswap.stateView.codeHash],
      ["PositionManager", .uniswap.positionManager.address, .uniswap.positionManager.codeHash],
      ["Permit2", .uniswap.permit2.address, .uniswap.permit2.codeHash]
    ][] | join("|")
  ' <<<"$profile"
)

artifact_relative="deployments/.network-fork-${chain_id}-${BASHPID}.json"
rerun_artifact_relative="deployments/.network-fork-${chain_id}-rerun-${BASHPID}.json"
artifact_path="$CONTRACTS_DIR/$artifact_relative"
rerun_artifact_path="$CONTRACTS_DIR/$rerun_artifact_relative"

export FOUNDRY_BROADCAST="$evidence_dir/broadcast"
export PRIVATE_KEY="$ANVIL_PRIVATE_KEY"
export PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER="$ANVIL_DEPLOYER"
export PLEDGE_CASH_PROTOCOL_OWNER="$ANVIL_DEPLOYER"
export PLEDGE_CASH_PROTOCOL_TREASURY="$ANVIL_DEPLOYER"
export CREATE2_FACTORY_ADDRESS="$(jq -r '.create2Factory.address' <<<"$profile")"
export WRAPPED_NATIVE_ADDRESS="$(jq -r '.wrappedNative.address' <<<"$profile")"
export UNISWAP_V4_POOL_MANAGER="$(jq -r '.uniswap.poolManager.address' <<<"$profile")"
export UNISWAP_UNIVERSAL_ROUTER="$(jq -r '.uniswap.universalRouter.address' <<<"$profile")"
export UNISWAP_V4_QUOTER="$(jq -r '.uniswap.quoter.address' <<<"$profile")"
export UNISWAP_V4_STATE_VIEW="$(jq -r '.uniswap.stateView.address' <<<"$profile")"
export UNISWAP_V4_POSITION_MANAGER="$(jq -r '.uniswap.positionManager.address' <<<"$profile")"
export PERMIT2_ADDRESS="$(jq -r '.uniswap.permit2.address' <<<"$profile")"
export WRITE_DEPLOYMENT_STATE=true
export DEPLOYMENT_ARTIFACT_PATH="$artifact_relative"

deploy_args=(
  forge script
  script/Deploy.s.sol:Deploy
  --rpc-url "$local_rpc"
  --chain "$LOCAL_CHAIN_ID"
  --always-use-create-2-factory
  --create2-deployer "$CREATE2_FACTORY_ADDRESS"
  --broadcast
  --slow
  -v
)

if ! "${deploy_args[@]}" >"$evidence_dir/deploy.log" 2>&1; then
  tail -100 "$evidence_dir/deploy.log" >&2
  fail "genesis broadcast failed"
fi
[[ -f "$artifact_path" ]] || fail "Deploy.s.sol did not write its candidate artifact"

receipts_path="$evidence_dir/deployment.receipts.json"
broadcast_file="$evidence_dir/broadcast/Deploy.s.sol/$LOCAL_CHAIN_ID/run-latest.json"
if ! env \
  CHAIN_ID="$LOCAL_CHAIN_ID" \
  ARTIFACT="$artifact_path" \
  RECEIPTS="$receipts_path" \
  BROADCAST_FILE="$broadcast_file" \
  SOURCE_COMMIT="$source_commit" \
  PREVIOUS_ARTIFACT="$evidence_dir/no-previous.json" \
  script/finalize-broadcast-artifact.sh >"$evidence_dir/finalize.log" 2>&1; then
  tail -100 "$evidence_dir/finalize.log" >&2
  fail "receipt finalization failed"
fi

verify_artifact() {
  local log_path="$1"
  if ! env \
    ARTIFACT="$artifact_path" \
    RECEIPTS="$receipts_path" \
    RPC_URL="$local_rpc" \
    PROFILE_CHAIN_ID="$chain_id" \
    REQUIRE_DEPLOYMENT=1 \
    script/verify-testnet-artifact.sh >"$log_path" 2>&1; then
    tail -140 "$log_path" >&2
    fail "live artifact verification failed"
  fi
}

verify_artifact "$evidence_dir/verify.log"

export DEPLOYMENT_ARTIFACT_PATH="$rerun_artifact_relative"
if ! "${deploy_args[@]}" >"$evidence_dir/rerun.log" 2>&1; then
  tail -100 "$evidence_dir/rerun.log" >&2
  fail "idempotence broadcast failed"
fi
[[ -f "$rerun_artifact_path" ]] || fail "idempotence run did not write its candidate artifact"

jq -e --slurpfile rerun "$rerun_artifact_path" '
  $rerun[0] as $rerun
  | .deterministicDeployer == $rerun.deterministicDeployer
    and .boardroomFactory == $rerun.boardroomFactory
    and .protocolFeeRouter == $rerun.protocolFeeRouter
    and .tokenGrantFactory == $rerun.tokenGrantFactory
    and .liquidityLockerFactory == $rerun.liquidityLockerFactory
    and .manifestHash == $rerun.manifestHash
    and .deterministicReleaseCodeHash == $rerun.deterministicReleaseCodeHash
' "$artifact_path" >/dev/null || fail "idempotence run changed canonical deployment identity"

verify_artifact "$evidence_dir/verify-after-rerun.log"

mv "$artifact_path" "$evidence_dir/deployment.json"
artifact_path=""
mv "$rerun_artifact_path" "$evidence_dir/deployment-rerun.json"
rerun_artifact_path=""

total_gas=0
while IFS= read -r gas_hex; do
  gas_decimal="$(cast to-dec "$gas_hex")"
  total_gas=$((total_gas + gas_decimal))
done < <(jq -r '.transactions[].gasUsed' "$receipts_path")

echo "$network_name fork deployment proof passed"
echo "Target chain: $chain_id"
echo "Source commit: $source_commit"
if [[ -n "$dirty_worktree" ]]; then
  echo "Authority: interim dirty-worktree development proof"
else
  echo "Authority: clean exact-source proof"
fi
echo "Fork block: $fork_block"
echo "Deployment receipts: $(jq '.transactions | length' "$receipts_path")"
echo "Deployment gas: $total_gas"
echo "Idempotence transactions: $(jq '.transactions | length' "$broadcast_file")"
echo "BoardroomFactory: $(jq -r '.boardroomFactory' "$evidence_dir/deployment.json")"
echo "TokenGrantFactory: $(jq -r '.tokenGrantFactory' "$evidence_dir/deployment.json")"
echo "LiquidityLockerFactory: $(jq -r '.liquidityLockerFactory' "$evidence_dir/deployment.json")"
echo "ProtocolFeeRouter: $(jq -r '.protocolFeeRouter' "$evidence_dir/deployment.json")"
echo "Evidence retained at $evidence_dir"
