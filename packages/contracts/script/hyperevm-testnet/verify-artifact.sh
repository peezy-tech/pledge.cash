#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARTIFACT="${ARTIFACT:-deployments/998.json}"
RPC_URL="${HYPEREVM_TESTNET_RPC_URL:-https://rpc.hyperliquid-testnet.xyz/evm}"
REQUIRE_BOARDROOM_DEPLOYMENT="${REQUIRE_BOARDROOM_DEPLOYMENT:-0}"

cd "$ROOT_DIR"

fail() {
  echo "Artifact verification failed: $*" >&2
  exit 1
}

field_exists() {
  jq -e --arg key "$1" 'has($key) and .[$key] != null and .[$key] != ""' "$ARTIFACT" >/dev/null
}

field() {
  jq -r --arg key "$1" '.[$key] // empty' "$ARTIFACT"
}

lower() {
  tr '[:upper:]' '[:lower:]'
}

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

first_token() {
  awk 'NR == 1 { print $1 }'
}

expect_equal() {
  local label="$1"
  local expected="$2"
  local actual="$3"

  if [[ "$expected" != "$actual" ]]; then
    fail "$label mismatch: expected $expected, got $actual"
  fi
  echo "Verified $label: $actual"
}

expect_address_equal() {
  local label="$1"
  local expected actual
  expected="$(printf '%s' "$2" | lower)"
  actual="$(printf '%s' "$3" | lower)"
  expect_equal "$label" "$expected" "$actual"
}

require_field() {
  local key="$1"
  field_exists "$key" || fail "$ARTIFACT is missing .$key"
}

require_code() {
  local label="$1"
  local address="$2"
  local code
  code="$(cast_retry cast code --rpc-url "$RPC_URL" "$address")"
  if [[ "$code" == "0x" ]]; then
    fail "$label has no code at $address"
  fi
  echo "Verified $label code at $address"
}

call_address() {
  cast_retry cast call --rpc-url "$RPC_URL" "$1" "$2" | first_token
}

call_uint() {
  cast_retry cast call --rpc-url "$RPC_URL" "$1" "$2" | first_token
}

call_bool() {
  cast_retry cast call --rpc-url "$RPC_URL" "$1" "$2" "$3" | first_token
}

[[ -f "$ARTIFACT" ]] || fail "missing artifact $ARTIFACT"

chain_id="$(cast_retry cast chain-id --rpc-url "$RPC_URL" | first_token)"
expect_equal "chain id" "$(field chainId)" "$chain_id"

require_field tokenGrantFactory
token_grant_factory="$(field tokenGrantFactory)"
require_code "TokenGrantFactory" "$token_grant_factory"

if field_exists factoryOwner; then
  actual_owner="$(call_address "$token_grant_factory" "owner()(address)")"
  expect_address_equal "TokenGrantFactory owner" "$(field factoryOwner)" "$actual_owner"
fi

if field_exists creationFee; then
  actual_creation_fee="$(call_uint "$token_grant_factory" "creationFee()(uint256)")"
  expect_equal "TokenGrantFactory creationFee" "$(field creationFee)" "$actual_creation_fee"
fi

if field_exists tokenGrantLogic; then
  token_grant_logic="$(field tokenGrantLogic)"
  require_code "TokenGrant logic" "$token_grant_logic"
  actual_logic="$(call_address "$token_grant_factory" "tokenGrantLogic()(address)")"
  expect_address_equal "TokenGrantFactory tokenGrantLogic" "$token_grant_logic" "$actual_logic"
fi

boardroom_status="$(field boardroomStatus)"
skip_boardroom_verification=0
if [[ "$boardroom_status" == "pending" ]]; then
  if [[ "$REQUIRE_BOARDROOM_DEPLOYMENT" == "1" ]]; then
    fail "Boardroom deployment is still marked pending"
  fi
  echo "Skipping Boardroom verification: artifact marks Boardroom deployment pending"
  skip_boardroom_verification=1
fi

if [[ "$skip_boardroom_verification" == "0" ]] && { field_exists boardroomFactory || field_exists boardroomPolicyRegistry; }; then
  require_field boardroomFactory
  require_field boardroomPolicyRegistry
  require_field policyRegistryOwner
  require_field tokenGrantPolicyAllowed
  require_field distributionFactory
  require_field distributionPolicyAllowed

  boardroom_factory="$(field boardroomFactory)"
  policy_registry="$(field boardroomPolicyRegistry)"
  distribution_factory="$(field distributionFactory)"
  require_code "BoardroomFactory" "$boardroom_factory"
  require_code "BoardroomPolicyRegistry" "$policy_registry"
  require_code "DistributionFactory" "$distribution_factory"

  actual_registry_owner="$(call_address "$policy_registry" "owner()(address)")"
  expect_address_equal "BoardroomPolicyRegistry owner" "$(field policyRegistryOwner)" "$actual_registry_owner"

  actual_policy_allowed="$(call_bool "$policy_registry" "isPolicyAllowed(address)(bool)" "$token_grant_factory")"
  expect_equal "Boardroom policy allowance" "$(field tokenGrantPolicyAllowed)" "$actual_policy_allowed"

  actual_distribution_policy_allowed="$(call_bool "$policy_registry" "isPolicyAllowed(address)(bool)" "$distribution_factory")"
  expect_equal "Distribution policy allowance" "$(field distributionPolicyAllowed)" "$actual_distribution_policy_allowed"
elif [[ "$REQUIRE_BOARDROOM_DEPLOYMENT" == "1" ]]; then
  fail "Boardroom deployment fields are required but missing"
else
  echo "Skipping Boardroom verification: no Boardroom deployment fields in artifact"
fi

if field_exists ammFactory; then
  amm_factory="$(field ammFactory)"
  require_code "AmmFactory" "$amm_factory"
fi

if field_exists ammRouter || field_exists lockedLiquidityFactory; then
  require_field ammFactory
  require_field wrappedNative
  require_field ammRouter
  require_field lockedLiquidityFactory
  require_field boardroomPolicyRegistry
  require_field lockedLiquidityPolicyAllowed

  amm_factory="$(field ammFactory)"
  wrapped_native="$(field wrappedNative)"
  amm_router="$(field ammRouter)"
  locked_liquidity_factory="$(field lockedLiquidityFactory)"
  policy_registry="$(field boardroomPolicyRegistry)"

  require_code "AmmFactory" "$amm_factory"
  require_code "AmmRouter" "$amm_router"
  require_code "LockedLiquidityFactory" "$locked_liquidity_factory"

  actual_router_factory="$(call_address "$amm_router" "factory()(address)")"
  expect_address_equal "AmmRouter factory" "$amm_factory" "$actual_router_factory"

  actual_wrapped_native="$(call_address "$amm_router" "wrappedNative()(address)")"
  expect_address_equal "AmmRouter wrappedNative" "$wrapped_native" "$actual_wrapped_native"

  actual_locker_router="$(call_address "$locked_liquidity_factory" "ammRouter()(address)")"
  expect_address_equal "LockedLiquidityFactory ammRouter" "$amm_router" "$actual_locker_router"

  actual_locked_policy_allowed="$(call_bool "$policy_registry" "isPolicyAllowed(address)(bool)" "$locked_liquidity_factory")"
  expect_equal "Locked liquidity policy allowance" "$(field lockedLiquidityPolicyAllowed)" "$actual_locked_policy_allowed"
fi
