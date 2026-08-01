#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export ARTIFACT="${ARTIFACT:-deployments/10143.json}"
export RPC_URL="${RPC_URL:-${MONAD_TESTNET_RPC_URL:-https://testnet-rpc.monad.xyz}}"

exec "$SCRIPT_DIR/../verify-testnet-artifact.sh"
