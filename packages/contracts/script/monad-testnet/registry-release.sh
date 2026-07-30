#!/usr/bin/env bash
set -euo pipefail

CONTRACTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPO_DIR="$(cd "$CONTRACTS_DIR/../.." && pwd)"

if [[ "$#" -ne 2 ]]; then
  echo "usage: registry-release.sh <preflight|publish|activate|verify-published|verify-active> <manifest.json>" >&2
  exit 64
fi

for env_file in "$HOME/.env" "$HOME/.env.local" "$REPO_DIR/.env" "$CONTRACTS_DIR/.env"; do
  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck source=/dev/null
    source "$env_file"
    set +a
  fi
done

if [[ -n "$(git -C "$REPO_DIR" status --porcelain --untracked-files=all)" ]]; then
  echo "Refusing a protocol facet release operation from a dirty worktree." >&2
  exit 1
fi

export RPC_URL="${MONAD_TESTNET_RPC_URL:-https://testnet-rpc.monad.xyz}"
export EXPECTED_CHAIN_ID=10143
export PROTOCOL_FACET_REGISTRY="${MONAD_TESTNET_PROTOCOL_FACET_REGISTRY:-${PROTOCOL_FACET_REGISTRY:-}}"
export EXPECTED_REGISTRY_CODE_HASH="${MONAD_TESTNET_REGISTRY_CODE_HASH:-${EXPECTED_REGISTRY_CODE_HASH:-}}"
export EXPECTED_REGISTRY_OWNER="${MONAD_TESTNET_REGISTRY_OWNER:-${EXPECTED_REGISTRY_OWNER:-}}"
export EXPECTED_CURRENT_FACET_SET_HASH="${MONAD_TESTNET_CURRENT_FACET_SET_HASH:-${EXPECTED_CURRENT_FACET_SET_HASH:-}}"
export EXPECTED_NEW_FACET_SET_HASH="${MONAD_TESTNET_NEW_FACET_SET_HASH:-${EXPECTED_NEW_FACET_SET_HASH:-}}"
export REGISTRY_RELEASE_PRIVATE_KEY="${MONAD_TESTNET_REGISTRY_RELEASE_PRIVATE_KEY:-${REGISTRY_RELEASE_PRIVATE_KEY:-}}"
export RELEASE_USE_LEGACY_TRANSACTIONS=0
export BROADCAST="${BROADCAST:-0}"

exec "$CONTRACTS_DIR/script/registry-release/operator.sh" "$@"
