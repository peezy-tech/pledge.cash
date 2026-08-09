#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

readonly CONTRACTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly REPO_DIR="$(cd "$CONTRACTS_DIR/../.." && pwd)"
readonly MANIFEST="$CONTRACTS_DIR/config/networks.json"
readonly SIMULATION_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

fail() {
  echo "Network deployment refused: $*" >&2
  exit 1
}

if [[ "$#" -lt 1 || ! "$1" =~ ^[0-9]+$ ]]; then
  echo "usage: deploy-network.sh <chain-id> [--broadcast <chain-id:source-commit>] [--allow-mainnet]" >&2
  exit 64
fi

chain_id="$1"
shift
broadcast=0
broadcast_confirmation=""
allow_mainnet_broadcast=0
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --broadcast)
      [[ "$broadcast" == "0" ]] || fail "--broadcast may be provided only once"
      [[ "$#" -ge 2 ]] || fail "--broadcast requires <chain-id:source-commit>"
      broadcast=1
      broadcast_confirmation="$2"
      shift 2
      ;;
    --allow-mainnet)
      [[ "$allow_mainnet_broadcast" == "0" ]] || fail "--allow-mainnet may be provided only once"
      allow_mainnet_broadcast=1
      shift
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done
readonly chain_id broadcast broadcast_confirmation allow_mainnet_broadcast

for command in bun cast forge git jq; do
  command -v "$command" >/dev/null || fail "missing required command: $command"
done

# Process-level configuration takes precedence over dotenv files. Broadcast
# authority is accepted only through the parsed command-line arguments above.
readonly -a invocation_override_names=(
  PLEDGE_CASH_DEPLOYER_PRIVATE_KEY
  PRIVATE_KEY
  PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER
  PLEDGE_CASH_PROTOCOL_OWNER
  PLEDGE_CASH_PROTOCOL_TREASURY
  PLEDGE_CASH_RPC_URL
  RPC_URL
  SEPOLIA_RPC_URL
  BASE_SEPOLIA_RPC_URL
  ETHEREUM_RPC_URL
  BASE_RPC_URL
  ARBITRUM_RPC_URL
  ROBINHOOD_CHAIN_RPC_URL
  TOKEN_GRANT_CREATION_FEE_WEI
  GAS_ESTIMATE_MULTIPLIER
  CONFIRMATION_TIMEOUT_SECONDS
)
declare -A invocation_override_present=()
declare -A invocation_override_values=()
for variable_name in "${invocation_override_names[@]}"; do
  if [[ -v "$variable_name" ]]; then
    invocation_override_present["$variable_name"]=1
    invocation_override_values["$variable_name"]="${!variable_name}"
  fi
done

for env_file in "$HOME/.env" "$HOME/.env.local" "$REPO_DIR/.env" "$CONTRACTS_DIR/.env"; do
  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck source=/dev/null
    source "$env_file"
    set +a
  fi
done
for variable_name in "${invocation_override_names[@]}"; do
  if [[ "${invocation_override_present[$variable_name]:-0}" == "1" ]]; then
    printf -v "$variable_name" '%s' "${invocation_override_values[$variable_name]}"
    export "$variable_name"
  fi
done

cd "$CONTRACTS_DIR"
bun script/network-profiles.ts >/dev/null
profile="$(jq -cer --argjson chainId "$chain_id" '.profiles[] | select(.chainId == $chainId)' "$MANIFEST")" \
  || fail "chain $chain_id is outside the approved support policy"

network_name="$(jq -r '.name' <<<"$profile")"
environment="$(jq -r '.environment' <<<"$profile")"
required_confirmations="$(jq -r '.confirmations' <<<"$profile")"
rpc_env_name="$(jq -r '.rpcEnv' <<<"$profile")"
default_rpc_url="$(jq -r '.defaultRpcUrl' <<<"$profile")"
explicit_rpc_url="${PLEDGE_CASH_RPC_URL:-${RPC_URL:-}}"
if [[ -z "$explicit_rpc_url" ]]; then
  explicit_rpc_url="${!rpc_env_name:-}"
fi
rpc_url="${explicit_rpc_url:-$default_rpc_url}"

if [[ "$broadcast" == "1" && -z "$explicit_rpc_url" ]]; then
  fail "broadcasting requires PLEDGE_CASH_RPC_URL, RPC_URL, or $rpc_env_name; the public fallback is simulation-only"
fi
if [[ "$allow_mainnet_broadcast" == "1" && "$broadcast" == "0" ]]; then
  fail "--allow-mainnet is valid only with --broadcast"
fi
if [[ "$allow_mainnet_broadcast" == "1" && "$environment" != "mainnet" ]]; then
  fail "--allow-mainnet is valid only for a mainnet profile"
fi
if [[ "$broadcast" == "1" && "$environment" == "mainnet" && "$allow_mainnet_broadcast" != "1" ]]; then
  fail "mainnet broadcasting additionally requires --allow-mainnet"
fi

source_commit="$(git -C "$REPO_DIR" rev-parse HEAD)"
[[ "$source_commit" =~ ^[0-9a-f]{40}$ ]] || fail "could not resolve an exact source commit"
if [[ "$broadcast" == "1" ]]; then
  [[ -z "$(git -C "$REPO_DIR" status --porcelain --untracked-files=normal)" ]] \
    || fail "broadcasting requires a clean worktree"
  expected_confirmation="${chain_id}:${source_commit}"
  [[ "$broadcast_confirmation" == "$expected_confirmation" ]] \
    || fail "--broadcast confirmation must equal $expected_confirmation"
fi

require_address() {
  local name="$1"
  local value="$2"
  [[ "$value" =~ ^0x[0-9a-fA-F]{40}$ ]] || fail "$name must be a 20-byte EVM address"
  [[ "${value,,}" != "0x0000000000000000000000000000000000000000" ]] || fail "$name must be nonzero"
}

private_key="${PLEDGE_CASH_DEPLOYER_PRIVATE_KEY:-${PRIVATE_KEY:-}}"
simulation_key_defaulted=0
if [[ -z "$private_key" ]]; then
  [[ "$broadcast" == "0" ]] || fail "set PLEDGE_CASH_DEPLOYER_PRIVATE_KEY or PRIVATE_KEY"
  private_key="$SIMULATION_PRIVATE_KEY"
  simulation_key_defaulted=1
fi

actual_deployer="$(cast wallet address --private-key "$private_key")"
if [[ "$broadcast" == "1" ]]; then
  : "${PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER:?Set PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER}"
  : "${PLEDGE_CASH_PROTOCOL_OWNER:?Set PLEDGE_CASH_PROTOCOL_OWNER}"
  : "${PLEDGE_CASH_PROTOCOL_TREASURY:?Set PLEDGE_CASH_PROTOCOL_TREASURY}"
else
  if [[ "$simulation_key_defaulted" == "1" ]]; then
    PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER="$actual_deployer"
    PLEDGE_CASH_PROTOCOL_OWNER="$actual_deployer"
    PLEDGE_CASH_PROTOCOL_TREASURY="$actual_deployer"
  else
    PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER="${PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER:-$actual_deployer}"
    PLEDGE_CASH_PROTOCOL_OWNER="${PLEDGE_CASH_PROTOCOL_OWNER:-$actual_deployer}"
    PLEDGE_CASH_PROTOCOL_TREASURY="${PLEDGE_CASH_PROTOCOL_TREASURY:-$actual_deployer}"
  fi
  export PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER PLEDGE_CASH_PROTOCOL_OWNER PLEDGE_CASH_PROTOCOL_TREASURY
fi
require_address PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER "$PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER"
require_address PLEDGE_CASH_PROTOCOL_OWNER "$PLEDGE_CASH_PROTOCOL_OWNER"
require_address PLEDGE_CASH_PROTOCOL_TREASURY "$PLEDGE_CASH_PROTOCOL_TREASURY"

if [[ "${actual_deployer,,}" != "${PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER,,}" ]]; then
  fail "PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER must match deployment key address $actual_deployer"
fi

PLEDGE_CASH_RPC_URL="$rpc_url" script/verify-network-profile-live.sh "$chain_id"

export PRIVATE_KEY="$private_key"
export WRAPPED_NATIVE_ADDRESS="$(jq -r '.wrappedNative.address' <<<"$profile")"
export CREATE2_FACTORY_ADDRESS="$(jq -r '.create2Factory.address' <<<"$profile")"
export UNISWAP_V4_POOL_MANAGER="$(jq -r '.uniswap.poolManager.address' <<<"$profile")"
export UNISWAP_UNIVERSAL_ROUTER="$(jq -r '.uniswap.universalRouter.address' <<<"$profile")"
export UNISWAP_V4_QUOTER="$(jq -r '.uniswap.quoter.address' <<<"$profile")"
export UNISWAP_V4_STATE_VIEW="$(jq -r '.uniswap.stateView.address' <<<"$profile")"
export UNISWAP_V4_POSITION_MANAGER="$(jq -r '.uniswap.positionManager.address' <<<"$profile")"
export PERMIT2_ADDRESS="$(jq -r '.uniswap.permit2.address' <<<"$profile")"

artifact="deployments/${chain_id}.candidate.json"
receipts="deployments/${chain_id}.receipts.candidate.json"
broadcast_file="broadcast/Deploy.s.sol/${chain_id}/run-latest.json"
gas_estimate_multiplier="${GAS_ESTIMATE_MULTIPLIER:-120}"
[[ "$gas_estimate_multiplier" =~ ^[0-9]+$ && "$gas_estimate_multiplier" -ge 100 ]] \
  || fail "GAS_ESTIMATE_MULTIPLIER must be an integer of at least 100"
confirmation_timeout_seconds="${CONFIRMATION_TIMEOUT_SECONDS:-1800}"
[[ "$confirmation_timeout_seconds" =~ ^[0-9]+$ \
  && "$confirmation_timeout_seconds" -ge 30 \
  && "$confirmation_timeout_seconds" -le 7200 ]] \
  || fail "CONFIRMATION_TIMEOUT_SECONDS must be an integer between 30 and 7200"

wait_for_confirmations() {
  local latest_receipt_block=0 block_hex block_decimal target_head current_head
  local poll_seconds=5 max_attempts attempt

  while IFS= read -r block_hex; do
    block_decimal="$(printf '%d' "$block_hex")"
    if [[ "$block_decimal" -gt "$latest_receipt_block" ]]; then
      latest_receipt_block="$block_decimal"
    fi
  done < <(jq -r '.transactions[].blockNumber' "$receipts")
  [[ "$latest_receipt_block" -gt 0 ]] || fail "could not derive the latest receipt block"

  target_head=$((latest_receipt_block + required_confirmations - 1))
  max_attempts=$(((confirmation_timeout_seconds + poll_seconds - 1) / poll_seconds))
  echo "Waiting for $required_confirmations confirmations through block $target_head."
  for ((attempt = 1; attempt <= max_attempts; attempt++)); do
    if current_head="$(cast block-number --rpc-url "$rpc_url" 2>/dev/null)" \
      && [[ "$current_head" =~ ^[0-9]+$ ]] \
      && [[ "$current_head" -ge "$target_head" ]]; then
      echo "Confirmation policy satisfied at chain head $current_head."
      return 0
    fi
    if [[ "$attempt" -lt "$max_attempts" ]]; then
      sleep "$poll_seconds"
    fi
  done
  fail "chain did not reach confirmation block $target_head within $confirmation_timeout_seconds seconds"
}

args=(
  forge script
  script/Deploy.s.sol:Deploy
  --rpc-url "$rpc_url"
  --chain "$chain_id"
  --always-use-create-2-factory
  --create2-deployer "$CREATE2_FACTORY_ADDRESS"
  --gas-estimate-multiplier "$gas_estimate_multiplier"
)

if [[ "$broadcast" == "1" ]]; then
  export WRITE_DEPLOYMENT_STATE=true
  export DEPLOYMENT_ARTIFACT_PATH="$artifact"
  args+=(--broadcast --slow)
  rm -f "$artifact" "$receipts"
  echo "Broadcasting canonical pledge.cash genesis to $network_name ($chain_id)."
else
  export WRITE_DEPLOYMENT_STATE=false
  echo "Simulating canonical pledge.cash genesis on $network_name ($chain_id). Use --broadcast only after the release gate is authorized."
fi

"${args[@]}"

if [[ "$broadcast" == "1" ]]; then
  jq -e \
    --argjson chainId "$chain_id" \
    --arg create2 "$CREATE2_FACTORY_ADDRESS" \
    --arg wrapped "$WRAPPED_NATIVE_ADDRESS" \
    --arg poolManager "$UNISWAP_V4_POOL_MANAGER" \
    --arg router "$UNISWAP_UNIVERSAL_ROUTER" \
    --arg quoter "$UNISWAP_V4_QUOTER" \
    --arg stateView "$UNISWAP_V4_STATE_VIEW" \
    --arg positionManager "$UNISWAP_V4_POSITION_MANAGER" \
    --arg permit2 "$PERMIT2_ADDRESS" '
      .chainId == $chainId
      and ((.create2Factory | ascii_downcase) == ($create2 | ascii_downcase))
      and ((.wrappedNative | ascii_downcase) == ($wrapped | ascii_downcase))
      and ((.uniswapV4PoolManager | ascii_downcase) == ($poolManager | ascii_downcase))
      and ((.uniswapUniversalRouter | ascii_downcase) == ($router | ascii_downcase))
      and ((.uniswapV4Quoter | ascii_downcase) == ($quoter | ascii_downcase))
      and ((.uniswapV4StateView | ascii_downcase) == ($stateView | ascii_downcase))
      and ((.uniswapV4PositionManager | ascii_downcase) == ($positionManager | ascii_downcase))
      and ((.permit2 | ascii_downcase) == ($permit2 | ascii_downcase))
    ' "$artifact" >/dev/null || fail "candidate artifact does not match the selected canonical network profile"

  CHAIN_ID="$chain_id" \
    ARTIFACT="$artifact" \
    RECEIPTS="$receipts" \
    BROADCAST_FILE="$broadcast_file" \
    SOURCE_COMMIT="$source_commit" \
    PREVIOUS_ARTIFACT="deployments/${chain_id}.json" \
    script/finalize-broadcast-artifact.sh
  wait_for_confirmations
  ARTIFACT="$artifact" RECEIPTS="$receipts" RPC_URL="$rpc_url" REQUIRE_DEPLOYMENT=1 \
    script/verify-testnet-artifact.sh
  echo "Verified candidate retained at $artifact"
  echo "Receipt evidence retained at $receipts"
  echo "Promotion to deployments/${chain_id}.json is a separate, explicit release decision."
else
  RPC_URL="$rpc_url" script/verify-network-artifact.sh "$chain_id"
fi
