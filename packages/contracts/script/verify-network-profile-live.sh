#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

CONTRACTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$CONTRACTS_DIR/config/networks.json"

fail() {
  echo "Network profile verification failed: $*" >&2
  exit 1
}

if [[ "$#" -ne 1 || ! "$1" =~ ^[0-9]+$ ]]; then
  echo "usage: verify-network-profile-live.sh <chain-id>" >&2
  exit 64
fi

for command in bun cast jq; do
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

cast_retry() {
  local output status
  for attempt in 1 2 3; do
    set +e
    output="$("$@" 2>&1)"
    status=$?
    set -e
    if [[ "$status" -eq 0 ]]; then
      printf '%s\n' "$output"
      return 0
    fi
    sleep "$attempt"
  done
  printf '%s\n' "$output" >&2
  return "$status"
}

actual_chain_id="$(cast_retry cast chain-id --rpc-url "$rpc_url")" \
  || fail "could not read chain id from the selected RPC"
[[ "$actual_chain_id" == "$chain_id" ]] \
  || fail "RPC reported chain $actual_chain_id, expected $chain_id ($network_name)"

head_block="$(cast_retry cast block-number --rpc-url "$rpc_url")" \
  || fail "could not read the current block"
observed_block="$(jq -r '.observedAt.blockNumber' <<<"$profile")"
[[ "$head_block" -ge "$observed_block" ]] \
  || fail "RPC head $head_block predates pinned observation block $observed_block"

while IFS='|' read -r label address expected_hash; do
  code="$(cast_retry cast code "$address" --rpc-url "$rpc_url")" \
    || fail "could not read $label code at $address"
  [[ "$code" != "0x" ]] || fail "$label has no code at $address"
  actual_hash="$(cast keccak "$code")"
  if [[ "${actual_hash,,}" != "${expected_hash,,}" ]]; then
    fail "$label code hash changed at $address: expected $expected_hash, got $actual_hash"
  fi
  echo "Verified $label at $address"
done < <(
  jq -r '
    [
      ["CREATE2 factory", .create2Factory.address, .create2Factory.codeHash],
      ["wrapped native", .wrappedNative.address, .wrappedNative.codeHash],
      ["Uniswap v4 PoolManager", .uniswap.poolManager.address, .uniswap.poolManager.codeHash],
      ["Uniswap Universal Router", .uniswap.universalRouter.address, .uniswap.universalRouter.codeHash],
      ["Uniswap v4 Quoter", .uniswap.quoter.address, .uniswap.quoter.codeHash],
      ["Uniswap v4 StateView", .uniswap.stateView.address, .uniswap.stateView.codeHash],
      ["Uniswap v4 PositionManager", .uniswap.positionManager.address, .uniswap.positionManager.codeHash],
      ["Permit2", .uniswap.permit2.address, .uniswap.permit2.codeHash]
    ][] | join("|")
  ' <<<"$profile"
)

echo "Verified $network_name profile on chain $chain_id at head $head_block."
