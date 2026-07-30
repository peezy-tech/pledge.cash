#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPO_DIR="$(cd "$ROOT_DIR/../.." && pwd)"

for env_file in "$HOME/.env" "$HOME/.env.local" "$REPO_DIR/.env" "$ROOT_DIR/.env"; do
  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck source=/dev/null
    source "$env_file"
    set +a
  fi
done

if [[ -z "${HYPEREVM_TESTNET_PRIVATE_KEY:-}" && -n "${PRIVATE_KEY:-}" ]]; then
  export HYPEREVM_TESTNET_PRIVATE_KEY="$PRIVATE_KEY"
fi

if [[ -n "${HYPEREVM_WRAPPED_NATIVE_ADDRESS:-}" ]]; then
  export WRAPPED_NATIVE_ADDRESS="$HYPEREVM_WRAPPED_NATIVE_ADDRESS"
fi

require_address() {
  local name="$1"
  local value="$2"
  if [[ ! "$value" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
    echo "$name must be a 20-byte EVM address." >&2
    exit 1
  fi
}

RPC_URL="${HYPEREVM_TESTNET_RPC_URL:-https://rpc.hyperliquid-testnet.xyz/evm}"
BROADCAST="${BROADCAST:-0}"
GAS_ESTIMATE_MULTIPLIER="${HYPEREVM_GAS_ESTIMATE_MULTIPLIER:-${GAS_ESTIMATE_MULTIPLIER:-100}}"
GAS_PRICE_WEI="${HYPEREVM_GAS_PRICE_WEI:-}"
CREATE2_FACTORY_ADDRESS="${CREATE2_FACTORY_ADDRESS:-0x4e59b44847b379578588920cA78FbF26c0B4956C}"
DEPLOYMENT_ARTIFACT_PATH="deployments/998.candidate.json"
DEPLOYMENT_RECEIPTS_PATH="deployments/998.receipts.candidate.json"
BROADCAST_FILE="broadcast/Deploy.s.sol/998/run-latest.json"
export CREATE2_FACTORY_ADDRESS

if [[ -z "${PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER:-}" ]]; then
  echo "Set PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER to the deployment key address shared across deterministic target chains." >&2
  exit 1
fi
require_address PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER "$PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER"

for role in PLEDGE_CASH_PROTOCOL_GOVERNANCE PLEDGE_CASH_PROTOCOL_TREASURY PLEDGE_CASH_AMM_FEE_MANAGER; do
  if [[ -z "${!role:-}" ]]; then
    echo "Set $role before dry-running or broadcasting." >&2
    exit 1
  fi
  require_address "$role" "${!role}"
done

if [[ -n "${PLEDGE_CASH_DETERMINISTIC_DEPLOYER:-}" ]]; then
  require_address PLEDGE_CASH_DETERMINISTIC_DEPLOYER "$PLEDGE_CASH_DETERMINISTIC_DEPLOYER"
fi

if [[ -z "${WRAPPED_NATIVE_ADDRESS:-}" ]]; then
  echo "Set HYPEREVM_WRAPPED_NATIVE_ADDRESS or WRAPPED_NATIVE_ADDRESS to the canonical WHYPE address." >&2
  exit 1
fi
require_address WRAPPED_NATIVE_ADDRESS "$WRAPPED_NATIVE_ADDRESS"

if [[ -z "${HYPEREVM_TESTNET_PRIVATE_KEY:-}" ]]; then
  echo "Set HYPEREVM_TESTNET_PRIVATE_KEY or PRIVATE_KEY before dry-running or broadcasting." >&2
  exit 1
fi

SOURCE_COMMIT="$(git -C "$REPO_DIR" rev-parse HEAD)"
if [[ ! "$SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Could not resolve an exact source commit." >&2
  exit 1
fi
if [[ -n "$(git -C "$REPO_DIR" status --porcelain --untracked-files=normal)" ]]; then
  echo "Refusing to deploy from a dirty worktree." >&2
  exit 1
fi

actual_deployer="$(cast wallet address --private-key "$HYPEREVM_TESTNET_PRIVATE_KEY")"
if [[ "${actual_deployer,,}" != "${PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER,,}" ]]; then
  echo "PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER must match HYPEREVM_TESTNET_PRIVATE_KEY address $actual_deployer." >&2
  exit 1
fi

CHAIN_ID="$(cast chain-id --rpc-url "$RPC_URL")"
if [[ "$CHAIN_ID" != "998" ]]; then
  echo "Refusing to deploy: RPC $RPC_URL reported chain id $CHAIN_ID, expected 998." >&2
  exit 1
fi

export PRIVATE_KEY="$HYPEREVM_TESTNET_PRIVATE_KEY"

if [[ -z "$GAS_PRICE_WEI" ]]; then
  GAS_PRICE_WEI="$(cast gas-price --rpc-url "$RPC_URL")"
fi

args=(
  forge script
  script/Deploy.s.sol:Deploy
  --rpc-url "$RPC_URL"
  --chain 998
  --legacy
  --always-use-create-2-factory
  --create2-deployer "$CREATE2_FACTORY_ADDRESS"
  --gas-estimate-multiplier "$GAS_ESTIMATE_MULTIPLIER"
  --with-gas-price "$GAS_PRICE_WEI"
)

if [[ "$BROADCAST" == "1" ]]; then
  export WRITE_DEPLOYMENT_STATE=true
  export DEPLOYMENT_ARTIFACT_PATH
  args+=(--broadcast --slow)
else
  export WRITE_DEPLOYMENT_STATE=false
  echo "Running HyperEVM dry-run simulation. Set BROADCAST=1 to send transactions."
fi

cd "$ROOT_DIR"
if [[ "$BROADCAST" == "1" ]]; then
  rm -f "$DEPLOYMENT_ARTIFACT_PATH" "$DEPLOYMENT_RECEIPTS_PATH"
fi
"${args[@]}"

if [[ "$BROADCAST" == "1" ]]; then
  CHAIN_ID="$CHAIN_ID" \
    ARTIFACT="$DEPLOYMENT_ARTIFACT_PATH" \
    RECEIPTS="$DEPLOYMENT_RECEIPTS_PATH" \
    BROADCAST_FILE="$BROADCAST_FILE" \
    SOURCE_COMMIT="$SOURCE_COMMIT" \
    PREVIOUS_ARTIFACT="deployments/998.json" \
    script/finalize-broadcast-artifact.sh
  ARTIFACT="$DEPLOYMENT_ARTIFACT_PATH" RECEIPTS="$DEPLOYMENT_RECEIPTS_PATH" \
    RPC_URL="$RPC_URL" REQUIRE_DEPLOYMENT=1 \
    script/hyperevm-testnet/verify-artifact.sh
  echo "Verified candidate retained at $DEPLOYMENT_ARTIFACT_PATH"
  echo "Receipt evidence retained at $DEPLOYMENT_RECEIPTS_PATH"
  echo "Promotion to deployments/998.json is a separate, explicit release decision."
else
  script/hyperevm-testnet/verify-artifact.sh
fi
