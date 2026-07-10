#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARTIFACT="${ARTIFACT:-deployments/998.json}"
RPC_URL="${RPC_URL:-${HYPEREVM_TESTNET_RPC_URL:-https://rpc.hyperliquid-testnet.xyz/evm}}"
REQUIRE_DEPLOYMENT="${REQUIRE_DEPLOYMENT:-0}"
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
  jq -r --arg key "$1" '.[$key] | if . == null then empty else . end' "$ARTIFACT"
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

expect_hash_equal() {
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

require_code_hash() {
  local label="$1"
  local address="$2"
  local artifact_field="$3"
  local actual
  require_field "$artifact_field"
  actual="$(cast_retry cast codehash --rpc-url "$RPC_URL" "$address" | first_token)"
  expect_hash_equal "$label code hash" "$(field "$artifact_field")" "$actual"
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

artifact_status="$(field status)"
if [[ "$artifact_status" == "pending" ]]; then
  if [[ "$REQUIRE_DEPLOYMENT" == "1" ]]; then
    fail "Deployment artifact is still marked pending"
  fi
  echo "Skipping artifact verification: $ARTIFACT is marked pending"
  exit 0
fi

chain_id="$(cast_retry cast chain-id --rpc-url "$RPC_URL" | first_token)"
expect_equal "chain id" "$(field chainId)" "$chain_id"

for required in \
  deterministicDeployment deterministicDeploymentVersion deterministicReleaseCodeHash \
  create2Factory deterministicDeployer deterministicDeployerOwner \
  protocolGovernance protocolTreasury protocolFeeRouter protocolFeeRouterOwner protocolFeeRouterRecipient \
  boardroomPolicyRegistry policyRegistryOwner assetPolicy assetPolicyOwner boardroomFactory \
  tokenGrantFactory factoryOwner tokenGrantFeeRecipient tokenGrantLogic creationFee \
  ammFactory ammFactoryOwner ammFeeManager ammProtocolFeeRecipient ammLiquidityRouter \
  ammReservationManager ammRouter wrappedNative \
  lockedLiquidityFactory distributionFactory deploymentTimestamp; do
  require_field "$required"
done

require_code "CREATE2 factory" "$(field create2Factory)"
require_code "Wrapped native" "$(field wrappedNative)"

require_field tokenGrantFactory
require_field boardroomFactory
token_grant_factory="$(field tokenGrantFactory)"
boardroom_factory="$(field boardroomFactory)"
require_code "TokenGrantFactory" "$token_grant_factory"
require_code "BoardroomFactory" "$boardroom_factory"

actual_token_grant_boardroom_factory="$(call_address "$token_grant_factory" "boardroomFactory()(address)")"
expect_address_equal \
  "TokenGrantFactory immutable BoardroomFactory" \
  "$boardroom_factory" \
  "$actual_token_grant_boardroom_factory"

actual_token_grant_fee_recipient="$(call_address "$token_grant_factory" "feeRecipient()(address)")"
expect_address_equal "TokenGrantFactory feeRecipient" "$(field tokenGrantFeeRecipient)" "$actual_token_grant_fee_recipient"
expect_address_equal "TokenGrantFactory fee router" "$(field protocolFeeRouter)" "$actual_token_grant_fee_recipient"

if field_exists factoryOwner; then
  actual_owner="$(call_address "$token_grant_factory" "owner()(address)")"
  expect_address_equal "TokenGrantFactory owner" "$(field factoryOwner)" "$actual_owner"
  expect_address_equal "Protocol governance owns TokenGrantFactory" "$(field protocolGovernance)" "$actual_owner"
fi

protocol_fee_router="$(field protocolFeeRouter)"
require_code "ProtocolFeeRouter" "$protocol_fee_router"
actual_protocol_fee_router_owner="$(call_address "$protocol_fee_router" "owner()(address)")"
actual_protocol_fee_router_recipient="$(call_address "$protocol_fee_router" "feeRecipient()(address)")"
expect_address_equal "ProtocolFeeRouter owner" "$(field protocolFeeRouterOwner)" "$actual_protocol_fee_router_owner"
expect_address_equal "Protocol governance owns ProtocolFeeRouter" "$(field protocolGovernance)" "$actual_protocol_fee_router_owner"
expect_address_equal \
  "ProtocolFeeRouter recipient" \
  "$(field protocolFeeRouterRecipient)" \
  "$actual_protocol_fee_router_recipient"
expect_address_equal "Protocol treasury receives fees" "$(field protocolTreasury)" "$actual_protocol_fee_router_recipient"

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

if field_exists deterministicDeployment; then
  expect_equal "deterministic deployment flag" "true" "$(field deterministicDeployment)"
  require_field deterministicDeploymentVersion
  expect_equal "deterministic deployment version" "pledge.cash.deterministic.v4" "$(field deterministicDeploymentVersion)"
  require_field deterministicDeployer
  require_field create2Factory

  deterministic_deployer="$(field deterministicDeployer)"
  require_code "PledgeCashDeterministicDeployer" "$deterministic_deployer"

  if field_exists deterministicDeployerOwner; then
    actual_deterministic_owner="$(call_address "$deterministic_deployer" "owner()(address)")"
    expect_address_equal "PledgeCashDeterministicDeployer owner" "$(field deterministicDeployerOwner)" "$actual_deterministic_owner"
  elif field_exists deployer; then
    actual_deterministic_owner="$(call_address "$deterministic_deployer" "owner()(address)")"
    expect_address_equal "PledgeCashDeterministicDeployer owner" "$(field deployer)" "$actual_deterministic_owner"
  fi
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
  require_field assetPolicy
  require_field wrappedNative
  require_field policyRegistryOwner
  require_field assetPolicyOwner
  require_field assetPolicyAllowed
  require_field tokenGrantPolicyAllowed
  require_field tokenGrantModulePolicy
  require_field distributionFactory
  require_field distributionPolicyAllowed
  require_field distributionModulePolicy
  require_field assetWrappedNativeAllowed
  require_field assetTokenGrantSpenderAllowed
  require_field assetDistributionSpenderAllowed

  expect_equal "TokenGrantFactory module artifact" "true" "$(field tokenGrantModulePolicy)"
  expect_equal "DistributionFactory module artifact" "true" "$(field distributionModulePolicy)"

  policy_registry="$(field boardroomPolicyRegistry)"
  asset_policy="$(field assetPolicy)"
  wrapped_native="$(field wrappedNative)"
  distribution_factory="$(field distributionFactory)"
  require_code "BoardroomFactory" "$boardroom_factory"
  require_code "BoardroomPolicyRegistry" "$policy_registry"
  require_code "AssetPolicy" "$asset_policy"
  require_code "DistributionFactory" "$distribution_factory"

  actual_boardroom_factory_registry="$(call_address "$boardroom_factory" "policyRegistry()(address)")"
  expect_address_equal "BoardroomFactory policyRegistry" "$policy_registry" "$actual_boardroom_factory_registry"

  actual_boardroom_factory_wrapped_native="$(call_address "$boardroom_factory" "wrappedNative()(address)")"
  expect_address_equal "BoardroomFactory wrappedNative" "$wrapped_native" "$actual_boardroom_factory_wrapped_native"

  actual_registry_owner="$(call_address "$policy_registry" "owner()(address)")"
  expect_address_equal "BoardroomPolicyRegistry owner" "$(field policyRegistryOwner)" "$actual_registry_owner"
  expect_address_equal "Protocol governance owns registry" "$(field protocolGovernance)" "$actual_registry_owner"

  actual_asset_policy_owner="$(call_address "$asset_policy" "owner()(address)")"
  expect_address_equal "AssetPolicy owner" "$(field assetPolicyOwner)" "$actual_asset_policy_owner"
  expect_address_equal "Protocol governance owns AssetPolicy" "$(field protocolGovernance)" "$actual_asset_policy_owner"

  actual_asset_policy_allowed="$(call_bool "$policy_registry" "isPolicyAllowed(address)(bool)" "$asset_policy")"
  expect_equal "Asset policy allowance" "$(field assetPolicyAllowed)" "$actual_asset_policy_allowed"

  actual_policy_allowed="$(call_bool "$policy_registry" "isPolicyAllowed(address)(bool)" "$token_grant_factory")"
  expect_equal "Boardroom policy allowance" "$(field tokenGrantPolicyAllowed)" "$actual_policy_allowed"

  actual_token_grant_module_policy="$(call_bool "$policy_registry" "isModulePolicy(address)(bool)" "$token_grant_factory")"
  expect_equal "TokenGrantFactory permanent module identity" "$(field tokenGrantModulePolicy)" "$actual_token_grant_module_policy"

  actual_distribution_policy_allowed="$(call_bool "$policy_registry" "isPolicyAllowed(address)(bool)" "$distribution_factory")"
  expect_equal "Distribution policy allowance" "$(field distributionPolicyAllowed)" "$actual_distribution_policy_allowed"

  actual_distribution_module_policy="$(call_bool "$policy_registry" "isModulePolicy(address)(bool)" "$distribution_factory")"
  expect_equal "DistributionFactory permanent module identity" "$(field distributionModulePolicy)" "$actual_distribution_module_policy"

  actual_asset_wrapped_native_allowed="$(call_bool "$asset_policy" "isAssetAllowed(address)(bool)" "$wrapped_native")"
  expect_equal "AssetPolicy wrapped native allowance" "$(field assetWrappedNativeAllowed)" "$actual_asset_wrapped_native_allowed"

  actual_asset_token_grant_spender_allowed="$(call_bool "$asset_policy" "isApprovalSpenderAllowed(address)(bool)" "$token_grant_factory")"
  expect_equal "AssetPolicy TokenGrantFactory spender allowance" "$(field assetTokenGrantSpenderAllowed)" "$actual_asset_token_grant_spender_allowed"

  actual_asset_distribution_spender_allowed="$(call_bool "$asset_policy" "isApprovalSpenderAllowed(address)(bool)" "$distribution_factory")"
  expect_equal "AssetPolicy DistributionFactory spender allowance" "$(field assetDistributionSpenderAllowed)" "$actual_asset_distribution_spender_allowed"
elif [[ "$REQUIRE_BOARDROOM_DEPLOYMENT" == "1" ]]; then
  fail "Boardroom deployment fields are required but missing"
else
  echo "Skipping Boardroom verification: no Boardroom deployment fields in artifact"
fi

if field_exists ammFactory; then
  amm_factory="$(field ammFactory)"
  require_code "AmmFactory" "$amm_factory"

  actual_amm_owner="$(call_address "$amm_factory" "owner()(address)")"
  actual_amm_fee_manager="$(call_address "$amm_factory" "feeManager()(address)")"
  actual_amm_protocol_fee_recipient="$(call_address "$amm_factory" "protocolFeeRecipient()(address)")"
  actual_amm_liquidity_router="$(call_address "$amm_factory" "liquidityRouter()(address)")"
  actual_amm_reservation_manager="$(call_address "$amm_factory" "reservationManager()(address)")"
  expect_address_equal "AmmFactory owner" "$(field ammFactoryOwner)" "$actual_amm_owner"
  expect_address_equal "Protocol governance owns AmmFactory" "$(field protocolGovernance)" "$actual_amm_owner"
  expect_address_equal "AmmFactory feeManager" "$(field ammFeeManager)" "$actual_amm_fee_manager"
  expect_address_equal "AmmFactory protocolFeeRecipient" "$(field ammProtocolFeeRecipient)" "$actual_amm_protocol_fee_recipient"
  expect_address_equal "AmmFactory routes through ProtocolFeeRouter" "$protocol_fee_router" "$actual_amm_protocol_fee_recipient"
  expect_address_equal "AmmFactory liquidityRouter" "$(field ammLiquidityRouter)" "$actual_amm_liquidity_router"
  expect_address_equal "AmmFactory liquidityRouter wiring" "$(field ammRouter)" "$actual_amm_liquidity_router"
  expect_address_equal \
    "AmmFactory reservationManager" \
    "$(field ammReservationManager)" \
    "$actual_amm_reservation_manager"
  expect_address_equal \
    "AmmFactory reservationManager wiring" \
    "$(field lockedLiquidityFactory)" \
    "$actual_amm_reservation_manager"
fi

if field_exists ammRouter || field_exists lockedLiquidityFactory; then
  require_field ammFactory
  require_field wrappedNative
  require_field ammRouter
  require_field lockedLiquidityFactory
  require_field boardroomPolicyRegistry
  require_field assetPolicy
  require_field lockedLiquidityPolicyAllowed
  require_field lockedLiquidityModulePolicy
  require_field assetLockedLiquiditySpenderAllowed

  expect_equal "LockedLiquidityFactory module artifact" "true" "$(field lockedLiquidityModulePolicy)"

  amm_factory="$(field ammFactory)"
  wrapped_native="$(field wrappedNative)"
  amm_router="$(field ammRouter)"
  locked_liquidity_factory="$(field lockedLiquidityFactory)"
  policy_registry="$(field boardroomPolicyRegistry)"
  asset_policy="$(field assetPolicy)"

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

  actual_locked_module_policy="$(call_bool "$policy_registry" "isModulePolicy(address)(bool)" "$locked_liquidity_factory")"
  expect_equal "LockedLiquidityFactory permanent module identity" "$(field lockedLiquidityModulePolicy)" "$actual_locked_module_policy"

  actual_asset_locked_liquidity_spender_allowed="$(call_bool "$asset_policy" "isApprovalSpenderAllowed(address)(bool)" "$locked_liquidity_factory")"
  expect_equal "AssetPolicy LockedLiquidityFactory spender allowance" "$(field assetLockedLiquiditySpenderAllowed)" "$actual_asset_locked_liquidity_spender_allowed"
fi

require_code_hash "PledgeCashDeterministicDeployer" "$(field deterministicDeployer)" deterministicDeployerCodeHash
require_code_hash "BoardroomPolicyRegistry" "$(field boardroomPolicyRegistry)" boardroomPolicyRegistryCodeHash
require_code_hash "AssetPolicy" "$(field assetPolicy)" assetPolicyCodeHash
require_code_hash "ProtocolFeeRouter" "$protocol_fee_router" protocolFeeRouterCodeHash
require_code_hash "BoardroomFactory" "$(field boardroomFactory)" boardroomFactoryCodeHash
require_code_hash "TokenGrantFactory" "$(field tokenGrantFactory)" tokenGrantFactoryCodeHash
require_code_hash "AmmFactory" "$(field ammFactory)" ammFactoryCodeHash
require_code_hash "AmmRouter" "$(field ammRouter)" ammRouterCodeHash
require_code_hash "LockedLiquidityFactory" "$(field lockedLiquidityFactory)" lockedLiquidityFactoryCodeHash
require_code_hash "DistributionFactory" "$(field distributionFactory)" distributionFactoryCodeHash
require_code_hash "Wrapped native" "$(field wrappedNative)" wrappedNativeCodeHash
