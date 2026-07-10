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

if [[ -z "${MONAD_TESTNET_PRIVATE_KEY:-}" && -n "${PRIVATE_KEY:-}" ]]; then
  export MONAD_TESTNET_PRIVATE_KEY="$PRIVATE_KEY"
fi

export WRAPPED_NATIVE_ADDRESS="${MONAD_TESTNET_WRAPPED_NATIVE_ADDRESS:-0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541}"

require_address() {
  local name="$1"
  local value="$2"
  if [[ ! "$value" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
    echo "$name must be a 20-byte EVM address." >&2
    exit 1
  fi
}

RPC_URL="${MONAD_TESTNET_RPC_URL:-https://testnet-rpc.monad.xyz}"
BROADCAST="${BROADCAST:-0}"
GAS_ESTIMATE_MULTIPLIER="${MONAD_GAS_ESTIMATE_MULTIPLIER:-100}"
CREATE2_FACTORY_ADDRESS="${CREATE2_FACTORY_ADDRESS:-0x4e59b44847b379578588920cA78FbF26c0B4956C}"
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
require_address WRAPPED_NATIVE_ADDRESS "$WRAPPED_NATIVE_ADDRESS"

if [[ -z "${MONAD_TESTNET_PRIVATE_KEY:-}" ]]; then
  echo "Set MONAD_TESTNET_PRIVATE_KEY or PRIVATE_KEY before dry-running or broadcasting." >&2
  exit 1
fi

actual_deployer="$(cast wallet address --private-key "$MONAD_TESTNET_PRIVATE_KEY")"
if [[ "${actual_deployer,,}" != "${PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER,,}" ]]; then
  echo "PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER must match MONAD_TESTNET_PRIVATE_KEY address $actual_deployer." >&2
  exit 1
fi

CHAIN_ID="$(cast chain-id --rpc-url "$RPC_URL")"
if [[ "$CHAIN_ID" != "10143" ]]; then
  echo "Refusing to deploy: RPC $RPC_URL reported chain id $CHAIN_ID, expected 10143." >&2
  exit 1
fi

export PRIVATE_KEY="$MONAD_TESTNET_PRIVATE_KEY"

args=(
  forge script
  script/Deploy.s.sol:Deploy
  --rpc-url "$RPC_URL"
  --chain 10143
  --always-use-create-2-factory
  --create2-deployer "$CREATE2_FACTORY_ADDRESS"
  --gas-estimate-multiplier "$GAS_ESTIMATE_MULTIPLIER"
)

if [[ "$BROADCAST" == "1" ]]; then
  export WRITE_DEPLOYMENT_STATE=true
  export DEPLOYMENT_ARTIFACT_PATH="deployments/10143.candidate.json"
  args+=(--broadcast --slow)
else
  export WRITE_DEPLOYMENT_STATE=false
  echo "Running Monad testnet dry-run simulation. Set BROADCAST=1 to send transactions."
fi

cd "$ROOT_DIR"
if [[ "$BROADCAST" == "1" ]]; then
  rm -f "$DEPLOYMENT_ARTIFACT_PATH"
fi
"${args[@]}"

if [[ "$BROADCAST" == "1" ]]; then
  ARTIFACT="$DEPLOYMENT_ARTIFACT_PATH" RPC_URL="$RPC_URL" REQUIRE_DEPLOYMENT=1 \
    script/monad-testnet/verify-artifact.sh
  mv "$DEPLOYMENT_ARTIFACT_PATH" deployments/10143.json
fi
