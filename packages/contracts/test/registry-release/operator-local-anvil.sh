#!/usr/bin/env bash
set -euo pipefail

CONTRACTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RPC_PORT="${REGISTRY_RELEASE_TEST_PORT:-18547}"
RPC_URL="http://127.0.0.1:$RPC_PORT"
ANVIL_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
TEST_DIR="$(mktemp -d "$CONTRACTS_DIR/deployments/.registry-release-test.XXXXXX")"
MANIFEST_PATH="$TEST_DIR/release-b.json"
EMPTY_MANIFEST_PATH="$TEST_DIR/release-c-empty.json"
STATE_PATH="$TEST_DIR/state.json"
INVENTORY_PATH="$TEST_DIR/inventory.json"
EMPTY_INVENTORY_PATH="$TEST_DIR/empty-inventory.json"
ANVIL_LOG="$TEST_DIR/anvil.log"
ANVIL_PID=""
CLEANED_UP=0

cleanup() {
  if [[ "$CLEANED_UP" == "1" ]]; then
    return
  fi
  CLEANED_UP=1
  if [[ -n "$ANVIL_PID" ]]; then
    kill "$ANVIL_PID" 2>/dev/null || true
    wait "$ANVIL_PID" 2>/dev/null || true
  fi
  if [[ -d "$TEST_DIR" && "$TEST_DIR" == "$CONTRACTS_DIR/deployments/.registry-release-test."* ]]; then
    rm -r -- "$TEST_DIR"
  fi
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

if cast chain-id --rpc-url "$RPC_URL" >/dev/null 2>&1; then
  echo "Refusing to replace an existing RPC on $RPC_URL; set REGISTRY_RELEASE_TEST_PORT." >&2
  exit 1
fi

anvil --silent --port "$RPC_PORT" >"$ANVIL_LOG" 2>&1 &
ANVIL_PID="$!"
for _ in {1..50}; do
  if cast chain-id --rpc-url "$RPC_URL" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done
[[ "$(cast chain-id --rpc-url "$RPC_URL")" == "31337" ]]

cd "$CONTRACTS_DIR"
REGISTRY_RELEASE_FIXTURE_PRIVATE_KEY="$ANVIL_KEY" \
  REGISTRY_RELEASE_FIXTURE_MANIFEST_PATH="$MANIFEST_PATH" \
  REGISTRY_RELEASE_FIXTURE_EMPTY_MANIFEST_PATH="$EMPTY_MANIFEST_PATH" \
  REGISTRY_RELEASE_FIXTURE_STATE_PATH="$STATE_PATH" \
  forge script \
    test/registry-release/RegistryReleaseOperatorFixture.s.sol:RegistryReleaseOperatorFixture \
    --rpc-url "$RPC_URL" \
    --broadcast \
    --slow >/dev/null

export RPC_URL
export EXPECTED_CHAIN_ID=31337
export PROTOCOL_FACET_REGISTRY="$(jq -er '.registry' "$STATE_PATH")"
export EXPECTED_REGISTRY_CODE_HASH="$(jq -er '.registryCodeHash' "$STATE_PATH")"
export EXPECTED_REGISTRY_OWNER="$(jq -er '.owner' "$STATE_PATH")"
export EXPECTED_CURRENT_FACET_SET_HASH="$(jq -er '.releaseAHash' "$STATE_PATH")"
export EXPECTED_NEW_FACET_SET_HASH="$(jq -er '.releaseBHash' "$STATE_PATH")"

if EXPECTED_REGISTRY_OWNER=0x0000000000000000000000000000000000000000 \
  script/registry-release/operator.sh preflight "$MANIFEST_PATH" >/dev/null 2>&1
then
  echo "Operator accepted a zero expected registry owner" >&2
  exit 1
fi
if EXPECTED_REGISTRY_OWNER=0x0000000000000000000000000000000000000000 \
  EXPECTED_ACTIVE_FACET_SET_HASH="$EXPECTED_CURRENT_FACET_SET_HASH" \
  script/registry-release/export-active.sh verify >/dev/null 2>&1
then
  echo "Exporter accepted a zero expected registry owner" >&2
  exit 1
fi

script/registry-release/operator.sh preflight "$MANIFEST_PATH"
script/registry-release/operator.sh publish "$MANIFEST_PATH"
[[ "$(cast call \
  "$PROTOCOL_FACET_REGISTRY" \
  "isFacetSetPublished(bytes32)(bool)" \
  "$EXPECTED_NEW_FACET_SET_HASH" \
  --rpc-url "$RPC_URL")" == "false" ]]

BROADCAST=1 \
  REGISTRY_RELEASE_PRIVATE_KEY="$ANVIL_KEY" \
  CONFIRM_RELEASE_BROADCAST="publish:${EXPECTED_NEW_FACET_SET_HASH,,}" \
  script/registry-release/operator.sh publish "$MANIFEST_PATH" >/dev/null
script/registry-release/operator.sh verify-published "$MANIFEST_PATH"
script/registry-release/operator.sh activate "$MANIFEST_PATH"
[[ "$(cast call \
  "$PROTOCOL_FACET_REGISTRY" \
  "activeFacetSetHash()(bytes32)" \
  --rpc-url "$RPC_URL")" == "$EXPECTED_CURRENT_FACET_SET_HASH" ]]

BROADCAST=1 \
  REGISTRY_RELEASE_PRIVATE_KEY="$ANVIL_KEY" \
  CONFIRM_RELEASE_BROADCAST="activate:${EXPECTED_NEW_FACET_SET_HASH,,}" \
  script/registry-release/operator.sh activate "$MANIFEST_PATH" >/dev/null
script/registry-release/operator.sh verify-active "$MANIFEST_PATH"

EXPECTED_ACTIVE_FACET_SET_HASH="$EXPECTED_NEW_FACET_SET_HASH" \
  script/registry-release/export-active.sh verify >"$INVENTORY_PATH"
jq -e '
  .chainId == 31337
  and (.blockHash | test("^0x[0-9a-f]{64}$"))
  and .release == 2
  and .selectorCount == 2
  and (.routes | length) == 2
  and all(.routes[]; .codeHash == .liveCodeHash)
' "$INVENTORY_PATH" >/dev/null

export EXPECTED_CURRENT_FACET_SET_HASH="$EXPECTED_NEW_FACET_SET_HASH"
export EXPECTED_NEW_FACET_SET_HASH="$(jq -er '.releaseCHash' "$STATE_PATH")"
script/registry-release/operator.sh preflight "$EMPTY_MANIFEST_PATH"
script/registry-release/operator.sh publish "$EMPTY_MANIFEST_PATH"
[[ "$(cast call \
  "$PROTOCOL_FACET_REGISTRY" \
  "isFacetSetPublished(bytes32)(bool)" \
  "$EXPECTED_NEW_FACET_SET_HASH" \
  --rpc-url "$RPC_URL")" == "false" ]]

BROADCAST=1 \
  REGISTRY_RELEASE_PRIVATE_KEY="$ANVIL_KEY" \
  CONFIRM_RELEASE_BROADCAST="publish:${EXPECTED_NEW_FACET_SET_HASH,,}" \
  script/registry-release/operator.sh publish "$EMPTY_MANIFEST_PATH" >/dev/null
BROADCAST=1 \
  REGISTRY_RELEASE_PRIVATE_KEY="$ANVIL_KEY" \
  CONFIRM_RELEASE_BROADCAST="activate:${EXPECTED_NEW_FACET_SET_HASH,,}" \
  script/registry-release/operator.sh activate "$EMPTY_MANIFEST_PATH" >/dev/null
script/registry-release/operator.sh verify-active "$EMPTY_MANIFEST_PATH"

EXPECTED_ACTIVE_FACET_SET_HASH="$EXPECTED_NEW_FACET_SET_HASH" \
  script/registry-release/export-active.sh verify >"$EMPTY_INVENTORY_PATH"
jq -e '
  .release == 3
  and .selectorCount == 0
  and .routes == []
' "$EMPTY_INVENTORY_PATH" >/dev/null

echo "Protocol facet release operator local Anvil proof passed"
