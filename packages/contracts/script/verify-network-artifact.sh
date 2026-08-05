#!/usr/bin/env bash
set -euo pipefail

CONTRACTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$CONTRACTS_DIR/config/networks.json"

if [[ "$#" -ne 1 || ! "$1" =~ ^[0-9]+$ ]]; then
  echo "usage: verify-network-artifact.sh <chain-id>" >&2
  exit 64
fi

chain_id="$1"
profile="$(jq -cer --argjson chainId "$chain_id" '.profiles[] | select(.chainId == $chainId)' "$MANIFEST")" \
  || { echo "Chain $chain_id is outside the approved support policy." >&2; exit 1; }
rpc_env_name="$(jq -r '.rpcEnv' <<<"$profile")"
rpc_url="${PLEDGE_CASH_RPC_URL:-${RPC_URL:-}}"
if [[ -z "$rpc_url" ]]; then
  rpc_url="${!rpc_env_name:-}"
fi
rpc_url="${rpc_url:-$(jq -r '.defaultRpcUrl' <<<"$profile")}"

cd "$CONTRACTS_DIR"
export ARTIFACT="${ARTIFACT:-deployments/${chain_id}.json}"
export RPC_URL="$rpc_url"
exec script/verify-testnet-artifact.sh
