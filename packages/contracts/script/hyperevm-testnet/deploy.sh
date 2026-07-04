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

RPC_URL="${HYPEREVM_TESTNET_RPC_URL:-https://rpc.hyperliquid-testnet.xyz/evm}"
BROADCAST="${BROADCAST:-0}"
GAS_ESTIMATE_MULTIPLIER="${GAS_ESTIMATE_MULTIPLIER:-200}"
GAS_PRICE_WEI="${HYPEREVM_GAS_PRICE_WEI:-}"
CREATE2_FACTORY_ADDRESS="${CREATE2_FACTORY_ADDRESS:-0x4e59b44847b379578588920cA78FbF26c0B4956C}"
export CREATE2_FACTORY_ADDRESS

CHAIN_ID="$(cast chain-id --rpc-url "$RPC_URL")"
if [[ "$CHAIN_ID" != "998" ]]; then
  echo "Refusing to deploy: RPC $RPC_URL reported chain id $CHAIN_ID, expected 998." >&2
  exit 1
fi

if [[ "$BROADCAST" == "1" && -z "${HYPEREVM_TESTNET_PRIVATE_KEY:-}" ]]; then
  echo "Set HYPEREVM_TESTNET_PRIVATE_KEY or PRIVATE_KEY before broadcasting." >&2
  exit 1
fi

if [[ -n "${HYPEREVM_TESTNET_PRIVATE_KEY:-}" ]]; then
  export PRIVATE_KEY="$HYPEREVM_TESTNET_PRIVATE_KEY"
fi

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
  args+=(--broadcast --slow)
else
  export WRITE_DEPLOYMENT_STATE=false
  echo "Running HyperEVM dry-run simulation. Set BROADCAST=1 to send transactions."
fi

cd "$ROOT_DIR"
"${args[@]}"
