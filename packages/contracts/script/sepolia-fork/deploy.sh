#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPO_DIR="$(cd "$ROOT_DIR/../.." && pwd)"

# Current canonical Sepolia deployments from
# https://developers.uniswap.org/docs/protocols/v4/deployments
readonly SEPOLIA_CHAIN_ID=11155111
readonly LOCAL_CHAIN_ID=31337
readonly DEFAULT_SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
readonly CREATE2_FACTORY=0x4e59b44847b379578588920cA78FbF26c0B4956C
readonly WRAPPED_NATIVE=0xfff9976782d46cc05630d1f6ebab18b2324d6b14
readonly POOL_MANAGER=0xE03A1074c86CFeDd5C142C4F04F1a1536e203543
readonly UNIVERSAL_ROUTER=0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b
readonly QUOTER=0x61b3f2011a92d183c7dbadbda940a7555ccf9227
readonly STATE_VIEW=0xe1dd9c3fa50edb962e442f60dfbc432e24537e4c
readonly POSITION_MANAGER=0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4
readonly PERMIT2=0x000000000022D473030F116dDEE9F6B43aC78BA3
readonly ANVIL_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
readonly ANVIL_DEPLOYER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

SEPOLIA_RPC_URL="${SEPOLIA_RPC_URL:-$DEFAULT_SEPOLIA_RPC_URL}"
SEPOLIA_FORK_PORT="${SEPOLIA_FORK_PORT:-8551}"
EVIDENCE_DIR="$(mktemp -d)"
ANVIL_PID=""
ARTIFACT_PATH=""
RERUN_ARTIFACT_PATH=""

fail() {
  echo "Sepolia fork deployment failed: $*" >&2
  exit 1
}

cleanup() {
  local status=$?
  trap - EXIT
  if [[ -n "$ANVIL_PID" ]]; then
    kill "$ANVIL_PID" 2>/dev/null || true
    wait "$ANVIL_PID" 2>/dev/null || true
  fi
  if [[ -n "$ARTIFACT_PATH" && -f "$ARTIFACT_PATH" ]]; then
    mv "$ARTIFACT_PATH" "$EVIDENCE_DIR/deployment-unfinalized.json"
  fi
  if [[ -n "$RERUN_ARTIFACT_PATH" && -f "$RERUN_ARTIFACT_PATH" ]]; then
    mv "$RERUN_ARTIFACT_PATH" "$EVIDENCE_DIR/deployment-rerun-unfinalized.json"
  fi
  if [[ "$status" -ne 0 ]]; then
    echo "Fork evidence retained at $EVIDENCE_DIR" >&2
  fi
  exit "$status"
}
trap cleanup EXIT

[[ "$SEPOLIA_FORK_PORT" =~ ^[0-9]+$ ]] || fail "SEPOLIA_FORK_PORT must be numeric"
[[ "$SEPOLIA_FORK_PORT" -ge 1 && "$SEPOLIA_FORK_PORT" -le 65535 ]] \
  || fail "SEPOLIA_FORK_PORT must be between 1 and 65535"

forge_version="$(forge --version | sed -n '1p')"
[[ "$forge_version" == "forge Version: 1.7.1" ]] \
  || fail "Foundry v1.7.1 is required, got: $forge_version"
anvil_version="$(anvil --version | sed -n '1p')"
[[ "$anvil_version" == "anvil Version: 1.7.1" ]] \
  || fail "Foundry v1.7.1 Anvil is required, got: $anvil_version"

source_commit="$(git -C "$REPO_DIR" rev-parse HEAD)"
[[ "$source_commit" =~ ^[0-9a-f]{40}$ ]] || fail "could not resolve an exact source commit"
[[ -z "$(git -C "$REPO_DIR" status --porcelain --untracked-files=normal)" ]] \
  || fail "refusing to attest a dirty worktree"

upstream_chain_id="$(cast chain-id --rpc-url "$SEPOLIA_RPC_URL")"
[[ "$upstream_chain_id" == "$SEPOLIA_CHAIN_ID" ]] \
  || fail "upstream RPC reported chain id $upstream_chain_id, expected $SEPOLIA_CHAIN_ID"
fork_block="${SEPOLIA_FORK_BLOCK:-$(cast block-number --rpc-url "$SEPOLIA_RPC_URL")}"
[[ "$fork_block" =~ ^[0-9]+$ && "$fork_block" -gt 0 ]] \
  || fail "SEPOLIA_FORK_BLOCK must be a positive decimal block number"

local_rpc="http://127.0.0.1:$SEPOLIA_FORK_PORT"
if cast chain-id --rpc-url "$local_rpc" >/dev/null 2>&1; then
  fail "port $SEPOLIA_FORK_PORT already serves an RPC endpoint"
fi

anvil \
  --silent \
  --port "$SEPOLIA_FORK_PORT" \
  --chain-id "$LOCAL_CHAIN_ID" \
  --fork-url "$SEPOLIA_RPC_URL" \
  --fork-block-number "$fork_block" \
  >"$EVIDENCE_DIR/anvil.log" 2>&1 &
ANVIL_PID=$!

for attempt in $(seq 1 80); do
  if cast chain-id --rpc-url "$local_rpc" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done
[[ "$(cast chain-id --rpc-url "$local_rpc")" == "$LOCAL_CHAIN_ID" ]] \
  || fail "fork did not start with chain id $LOCAL_CHAIN_ID"

dependency_specs=(
  "CREATE2 factory|$CREATE2_FACTORY"
  "wrapped native|$WRAPPED_NATIVE"
  "PoolManager|$POOL_MANAGER"
  "Universal Router|$UNIVERSAL_ROUTER"
  "Quoter|$QUOTER"
  "StateView|$STATE_VIEW"
  "PositionManager|$POSITION_MANAGER"
  "Permit2|$PERMIT2"
)
for dependency_spec in "${dependency_specs[@]}"; do
  IFS='|' read -r dependency_label dependency_address <<<"$dependency_spec"
  dependency_code="$(cast code --rpc-url "$local_rpc" "$dependency_address")"
  [[ "$dependency_code" != "0x" ]] || fail "$dependency_label has no code at $dependency_address"
done

cd "$ROOT_DIR"
artifact_relative="deployments/.sepolia-fork-${BASHPID}.json"
rerun_artifact_relative="deployments/.sepolia-fork-rerun-${BASHPID}.json"
ARTIFACT_PATH="$ROOT_DIR/$artifact_relative"
RERUN_ARTIFACT_PATH="$ROOT_DIR/$rerun_artifact_relative"

export FOUNDRY_BROADCAST="$EVIDENCE_DIR/broadcast"
export PRIVATE_KEY="$ANVIL_PRIVATE_KEY"
export PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER="$ANVIL_DEPLOYER"
export PLEDGE_CASH_PROTOCOL_GOVERNANCE="$ANVIL_DEPLOYER"
export PLEDGE_CASH_PROTOCOL_TREASURY="$ANVIL_DEPLOYER"
export WRAPPED_NATIVE_ADDRESS="$WRAPPED_NATIVE"
export UNISWAP_V4_POOL_MANAGER="$POOL_MANAGER"
export UNISWAP_UNIVERSAL_ROUTER="$UNIVERSAL_ROUTER"
export UNISWAP_V4_QUOTER="$QUOTER"
export UNISWAP_V4_STATE_VIEW="$STATE_VIEW"
export UNISWAP_V4_POSITION_MANAGER="$POSITION_MANAGER"
export PERMIT2_ADDRESS="$PERMIT2"
export WRITE_DEPLOYMENT_STATE=true
export DEPLOYMENT_ARTIFACT_PATH="$artifact_relative"

deploy_args=(
  forge script
  script/Deploy.s.sol:Deploy
  --rpc-url "$local_rpc"
  --chain "$LOCAL_CHAIN_ID"
  --always-use-create-2-factory
  --create2-deployer "$CREATE2_FACTORY"
  --broadcast
  --slow
  -v
)

if ! "${deploy_args[@]}" >"$EVIDENCE_DIR/deploy.log" 2>&1; then
  tail -100 "$EVIDENCE_DIR/deploy.log" >&2
  fail "genesis broadcast failed"
fi
[[ -f "$ARTIFACT_PATH" ]] || fail "Deploy.s.sol did not write its candidate artifact"

receipts_path="$EVIDENCE_DIR/deployment.receipts.json"
broadcast_file="$EVIDENCE_DIR/broadcast/Deploy.s.sol/$LOCAL_CHAIN_ID/run-latest.json"
if ! env \
  CHAIN_ID="$LOCAL_CHAIN_ID" \
  ARTIFACT="$ARTIFACT_PATH" \
  RECEIPTS="$receipts_path" \
  BROADCAST_FILE="$broadcast_file" \
  SOURCE_COMMIT="$source_commit" \
  PREVIOUS_ARTIFACT="$EVIDENCE_DIR/no-previous.json" \
  script/finalize-broadcast-artifact.sh >"$EVIDENCE_DIR/finalize.log" 2>&1; then
  tail -100 "$EVIDENCE_DIR/finalize.log" >&2
  fail "receipt finalization failed"
fi

verify_artifact() {
  local log_path="$1"
  if ! env \
    ARTIFACT="$ARTIFACT_PATH" \
    RECEIPTS="$receipts_path" \
    RPC_URL="$local_rpc" \
    REQUIRE_DEPLOYMENT=1 \
    script/verify-testnet-artifact.sh >"$log_path" 2>&1; then
    tail -140 "$log_path" >&2
    fail "live artifact verification failed"
  fi
}

verify_artifact "$EVIDENCE_DIR/verify.log"

export DEPLOYMENT_ARTIFACT_PATH="$rerun_artifact_relative"
if ! "${deploy_args[@]}" >"$EVIDENCE_DIR/rerun.log" 2>&1; then
  tail -100 "$EVIDENCE_DIR/rerun.log" >&2
  fail "idempotence broadcast failed"
fi
[[ -f "$RERUN_ARTIFACT_PATH" ]] || fail "idempotence run did not write its candidate artifact"

jq -e --slurpfile rerun "$RERUN_ARTIFACT_PATH" '
  $rerun[0] as $rerun
  | .deterministicDeployer == $rerun.deterministicDeployer
    and .boardroomFactory == $rerun.boardroomFactory
    and .pledgeV4LiquidityFactory == $rerun.pledgeV4LiquidityFactory
    and .pledgeV4Hook == $rerun.pledgeV4Hook
    and .activeFacetSetHash == $rerun.activeFacetSetHash
    and .deterministicReleaseCodeHash == $rerun.deterministicReleaseCodeHash
' "$ARTIFACT_PATH" >/dev/null || fail "idempotence run changed canonical deployment identity"

verify_artifact "$EVIDENCE_DIR/verify-after-rerun.log"

mv "$ARTIFACT_PATH" "$EVIDENCE_DIR/deployment.json"
ARTIFACT_PATH=""
mv "$RERUN_ARTIFACT_PATH" "$EVIDENCE_DIR/deployment-rerun.json"
RERUN_ARTIFACT_PATH=""

total_gas=0
while IFS= read -r gas_hex; do
  gas_decimal="$(cast to-dec "$gas_hex")"
  total_gas=$((total_gas + gas_decimal))
done < <(jq -r '.transactions[].gasUsed' "$receipts_path")

echo "Sepolia fork deployment proof passed"
echo "Source commit: $source_commit"
echo "Fork block: $fork_block"
echo "Deployment receipts: $(jq '.transactions | length' "$receipts_path")"
echo "Deployment gas: $total_gas"
echo "Idempotence transactions: $(jq '.transactions | length' "$broadcast_file")"
echo "BoardroomFactory: $(jq -r '.boardroomFactory' "$EVIDENCE_DIR/deployment.json")"
echo "PledgeV4LiquidityFactory: $(jq -r '.pledgeV4LiquidityFactory' "$EVIDENCE_DIR/deployment.json")"
echo "PledgeV4Hook: $(jq -r '.pledgeV4Hook' "$EVIDENCE_DIR/deployment.json")"
echo "Evidence retained at $EVIDENCE_DIR"
