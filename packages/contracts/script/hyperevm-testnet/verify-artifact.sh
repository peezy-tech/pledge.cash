#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARTIFACT="${ARTIFACT:-deployments/998.json}"
RECEIPTS="${RECEIPTS:-${ARTIFACT%.json}.receipts.json}"
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
  local code actual
  require_field "$artifact_field"
  code="$(cast_retry cast code --rpc-url "$RPC_URL" "$address")"
  [[ "$code" != "0x" ]] || fail "$label has no code at $address"
  actual="$(cast keccak "$code")"
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

creation_code_hash() {
  local bytecode
  bytecode="$(forge inspect "$1" bytecode)" || fail "could not reproduce creation bytecode for $1"
  cast keccak "$bytecode"
}

encoded_hash() {
  local encoded
  encoded="$(cast abi-encode "$@")" || fail "could not ABI-encode local release identity"
  cast keccak "$encoded"
}

local_release_code_hash() {
  local boardroom_policy_registry asset_policy boardroom_governance boardroom_redemption
  local protocol_fee_router token_grant_factory amm_factory amm_router locked_liquidity_factory
  local distribution_factory boardroom_rewards_factory bond_market_factory boardroom_factory
  local boardroom_controller_factory boardroom_controller boardroom_market boardroom
  local boardroom_architecture

  boardroom_policy_registry="$(creation_code_hash BoardroomPolicyRegistry)"
  asset_policy="$(creation_code_hash AssetPolicy)"
  boardroom_governance="$(creation_code_hash BoardroomGovernanceLogic)"
  boardroom_redemption="$(creation_code_hash BoardroomRedemptionPayout)"
  protocol_fee_router="$(creation_code_hash ProtocolFeeRouter)"
  token_grant_factory="$(creation_code_hash TokenGrantFactory)"
  amm_factory="$(creation_code_hash AmmFactory)"
  amm_router="$(creation_code_hash AmmRouter)"
  locked_liquidity_factory="$(creation_code_hash LockedLiquidityFactory)"
  distribution_factory="$(creation_code_hash DistributionFactory)"
  boardroom_rewards_factory="$(creation_code_hash BoardroomRewardsFactory)"
  bond_market_factory="$(creation_code_hash BondMarketFactory)"
  boardroom_factory="$(creation_code_hash BoardroomFactory)"
  boardroom_controller_factory="$(creation_code_hash BoardroomControllerFactory)"
  boardroom_controller="$(creation_code_hash BoardroomController)"
  boardroom_market="$(creation_code_hash BoardroomMarketLogic)"
  boardroom="$(creation_code_hash Boardroom)"

  boardroom_architecture="$(
    encoded_hash \
      "f(bytes32,bytes32,bytes32,bytes32,bytes32)" \
      "$boardroom_factory" \
      "$boardroom_controller_factory" \
      "$boardroom_controller" \
      "$boardroom_market" \
      "$boardroom"
  )"

  encoded_hash \
    "f(bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32)" \
    "$boardroom_policy_registry" \
    "$asset_policy" \
    "$boardroom_governance" \
    "$boardroom_redemption" \
    "$protocol_fee_router" \
    "$token_grant_factory" \
    "$amm_factory" \
    "$amm_router" \
    "$locked_liquidity_factory" \
    "$distribution_factory" \
    "$boardroom_rewards_factory" \
    "$bond_market_factory" \
    "$boardroom_architecture"
}

normalized_receipt() {
  jq -c '{
    transactionHash: (.transactionHash | ascii_downcase),
    blockNumber: (.blockNumber | ascii_downcase),
    status: (.status | ascii_downcase),
    contractAddress: (
      if .contractAddress == null then null else (.contractAddress | ascii_downcase) end
    )
  }'
}

verify_receipt_manifest() {
  local deployment_block="$1"
  local source_commit="$2"
  local manifest_chain manifest_commit receipt_count min_block
  local row transaction_hash block_hex block_decimal expected live actual

  [[ -f "$RECEIPTS" ]] || fail "missing deployment receipt manifest $RECEIPTS"
  jq -e '
    .schemaVersion == 1
    and (.transactions | type == "array" and length > 0)
    and all(
      .transactions[];
      (.transactionHash | type == "string" and test("^0x[0-9a-fA-F]{64}$"))
      and (.blockNumber | type == "string" and test("^0x[0-9a-fA-F]+$"))
      and (.status | ascii_downcase == "0x1")
    )
  ' "$RECEIPTS" >/dev/null || fail "deployment receipt manifest is malformed or contains a failed transaction"

  manifest_chain="$(jq -r '.chainId' "$RECEIPTS")"
  manifest_commit="$(jq -r '.sourceCommit' "$RECEIPTS")"
  expect_equal "receipt manifest chain id" "$(field chainId)" "$manifest_chain"
  expect_equal "receipt manifest source commit" "$source_commit" "$manifest_commit"

  min_block=""
  while IFS= read -r row; do
    transaction_hash="$(printf '%s' "$row" | jq -r '.transactionHash')"
    block_hex="$(printf '%s' "$row" | jq -r '.blockNumber')"
    block_decimal="$(printf '%d' "$block_hex")"
    if [[ -z "$min_block" || "$block_decimal" -lt "$min_block" ]]; then
      min_block="$block_decimal"
    fi

    expected="$(printf '%s' "$row" | normalized_receipt)"
    live="$(cast_retry cast rpc --rpc-url "$RPC_URL" eth_getTransactionReceipt "$transaction_hash")"
    actual="$(printf '%s' "$live" | normalized_receipt)"
    if [[ "$expected" != "$actual" ]]; then
      fail "live receipt mismatch for $transaction_hash"
    fi
  done < <(jq -c '.transactions[]' "$RECEIPTS")

  expect_equal "deployment block" "$deployment_block" "$min_block"
  receipt_count="$(jq '.transactions | length' "$RECEIPTS")"
  echo "Verified $receipt_count live deployment receipts."
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
  sourceCommit deterministicDeployment deterministicDeploymentVersion deterministicReleaseCodeHash \
  create2Factory deterministicDeployer deterministicDeployerOwner \
  protocolGovernance protocolTreasury protocolFeeRouter protocolFeeRouterOwner protocolFeeRouterRecipient \
  boardroomPolicyRegistry policyRegistryOwner assetPolicy assetPolicyOwner boardroomFactory \
  boardroomGovernanceLogic boardroomRedemptionPayout boardroomLogic \
  boardroomControllerFactory boardroomControllerLogic boardroomMarketLogic \
  tokenGrantFactory factoryOwner tokenGrantFeeRecipient tokenGrantLogic creationFee \
  ammFactory ammPoolImplementation ammFactoryOwner ammFeeManager ammProtocolFeeRecipient ammLiquidityRouter \
  ammReservationManager ammRouter wrappedNative \
  lockedLiquidityFactory lockedLiquidityLogic \
  distributionFactory fixedPriceSaleLogic dutchAuctionLogic migratingBondingCurveLogic merkleAirdropLogic \
  boardroomRewardsFactory boardroomRewardsLogic bondMarketFactory bondMarketLogic \
  deploymentBlock deploymentTimestamp; do
  require_field "$required"
done

source_commit="$(field sourceCommit)"
[[ "$source_commit" =~ ^[0-9a-f]{40}$ ]] || fail "sourceCommit must be an exact lowercase Git commit"
git cat-file -e "${source_commit}^{commit}" 2>/dev/null || fail "source commit $source_commit is not present locally"
if ! git diff --quiet "$source_commit" -- . ':(exclude)deployments/**'; then
  fail "local contract sources differ from recorded source commit $source_commit"
fi

deployment_block="$(field deploymentBlock)"
[[ "$deployment_block" =~ ^[0-9]+$ ]] || fail "deploymentBlock must be an unsigned decimal integer"
chain_head="$(cast_retry cast block-number --rpc-url "$RPC_URL" | first_token)"
if [[ "$deployment_block" -gt "$chain_head" ]]; then
  fail "deploymentBlock $deployment_block is ahead of chain head $chain_head"
fi
verify_receipt_manifest "$deployment_block" "$source_commit"

expected_release_code_hash="$(local_release_code_hash)"
expect_hash_equal \
  "locally reproduced deterministic release code hash" \
  "$expected_release_code_hash" \
  "$(field deterministicReleaseCodeHash)"

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
  expect_equal "deterministic deployment version" "pledge.cash.deterministic.v5" "$(field deterministicDeploymentVersion)"
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
  require_field boardroomGovernanceLogic
  require_field boardroomRedemptionPayout
  require_field boardroomLogic
  require_field boardroomControllerFactory
  require_field boardroomControllerLogic
  require_field boardroomMarketLogic
  require_field boardroomPolicyRegistry
  require_field assetPolicy
  require_field wrappedNative
  require_field policyRegistryOwner
  require_field assetPolicyOwner
  require_field assetPolicyAllowed
  require_field tokenGrantPolicyAllowed
  require_field tokenGrantModulePolicy
  require_field distributionFactory
  require_field fixedPriceSaleLogic
  require_field dutchAuctionLogic
  require_field migratingBondingCurveLogic
  require_field merkleAirdropLogic
  require_field distributionPolicyAllowed
  require_field distributionModulePolicy
  require_field boardroomRewardsFactory
  require_field boardroomRewardsLogic
  require_field boardroomRewardsPolicyAllowed
  require_field boardroomRewardsModulePolicy
  require_field bondMarketFactory
  require_field bondMarketLogic
  require_field bondMarketPolicyAllowed
  require_field bondMarketModulePolicy
  require_field assetWrappedNativeAllowed
  require_field assetTokenGrantSpenderAllowed
  require_field assetDistributionSpenderAllowed
  require_field assetBoardroomRewardsSpenderAllowed
  require_field assetBondMarketSpenderAllowed

  expect_equal "TokenGrantFactory module artifact" "true" "$(field tokenGrantModulePolicy)"
  expect_equal "DistributionFactory module artifact" "true" "$(field distributionModulePolicy)"
  expect_equal "BoardroomRewardsFactory module artifact" "true" "$(field boardroomRewardsModulePolicy)"
  expect_equal "BondMarketFactory module artifact" "true" "$(field bondMarketModulePolicy)"

  policy_registry="$(field boardroomPolicyRegistry)"
  asset_policy="$(field assetPolicy)"
  wrapped_native="$(field wrappedNative)"
  distribution_factory="$(field distributionFactory)"
  fixed_price_sale_logic="$(field fixedPriceSaleLogic)"
  dutch_auction_logic="$(field dutchAuctionLogic)"
  migrating_bonding_curve_logic="$(field migratingBondingCurveLogic)"
  merkle_airdrop_logic="$(field merkleAirdropLogic)"
  boardroom_rewards_factory="$(field boardroomRewardsFactory)"
  boardroom_rewards_logic="$(field boardroomRewardsLogic)"
  bond_market_factory="$(field bondMarketFactory)"
  bond_market_logic="$(field bondMarketLogic)"
  boardroom_governance_logic="$(field boardroomGovernanceLogic)"
  boardroom_redemption_payout="$(field boardroomRedemptionPayout)"
  boardroom_logic="$(field boardroomLogic)"
  boardroom_controller_factory="$(field boardroomControllerFactory)"
  boardroom_controller_logic="$(field boardroomControllerLogic)"
  boardroom_market_logic="$(field boardroomMarketLogic)"
  require_code "BoardroomFactory" "$boardroom_factory"
  require_code "BoardroomGovernanceLogic" "$boardroom_governance_logic"
  require_code "BoardroomRedemptionPayout" "$boardroom_redemption_payout"
  require_code "Boardroom implementation" "$boardroom_logic"
  require_code "BoardroomControllerFactory" "$boardroom_controller_factory"
  require_code "BoardroomController implementation" "$boardroom_controller_logic"
  require_code "BoardroomMarketLogic" "$boardroom_market_logic"
  require_code "BoardroomPolicyRegistry" "$policy_registry"
  require_code "AssetPolicy" "$asset_policy"
  require_code "DistributionFactory" "$distribution_factory"
  require_code "FixedPriceSale implementation" "$fixed_price_sale_logic"
  require_code "DutchAuctionSale implementation" "$dutch_auction_logic"
  require_code "MigratingBondingCurve implementation" "$migrating_bonding_curve_logic"
  require_code "MerkleAirdrop implementation" "$merkle_airdrop_logic"
  require_code "BoardroomRewardsFactory" "$boardroom_rewards_factory"
  require_code "BoardroomRewards implementation" "$boardroom_rewards_logic"
  require_code "BondMarketFactory" "$bond_market_factory"
  require_code "BondMarket implementation" "$bond_market_logic"

  actual_boardroom_factory_registry="$(call_address "$boardroom_factory" "policyRegistry()(address)")"
  expect_address_equal "BoardroomFactory policyRegistry" "$policy_registry" "$actual_boardroom_factory_registry"

  actual_boardroom_factory_wrapped_native="$(call_address "$boardroom_factory" "wrappedNative()(address)")"
  expect_address_equal "BoardroomFactory wrappedNative" "$wrapped_native" "$actual_boardroom_factory_wrapped_native"

  actual_boardroom_factory_governance_logic="$(call_address "$boardroom_factory" "governanceLogic()(address)")"
  expect_address_equal \
    "BoardroomFactory governanceLogic" \
    "$boardroom_governance_logic" \
    "$actual_boardroom_factory_governance_logic"

  actual_boardroom_factory_redemption_payout="$(call_address "$boardroom_factory" "redemptionPayoutLogic()(address)")"
  expect_address_equal \
    "BoardroomFactory redemptionPayoutLogic" \
    "$boardroom_redemption_payout" \
    "$actual_boardroom_factory_redemption_payout"

  actual_boardroom_factory_logic="$(call_address "$boardroom_factory" "boardroomLogic()(address)")"
  expect_address_equal "BoardroomFactory boardroomLogic" "$boardroom_logic" "$actual_boardroom_factory_logic"

  actual_boardroom_factory_controller_factory="$(call_address "$boardroom_factory" "controllerFactory()(address)")"
  expect_address_equal \
    "BoardroomFactory controllerFactory" \
    "$boardroom_controller_factory" \
    "$actual_boardroom_factory_controller_factory"

  actual_boardroom_factory_market_logic="$(call_address "$boardroom_factory" "marketLogic()(address)")"
  expect_address_equal \
    "BoardroomFactory marketLogic" \
    "$boardroom_market_logic" \
    "$actual_boardroom_factory_market_logic"

  actual_controller_factory_boardroom_factory="$(call_address "$boardroom_controller_factory" "boardroomFactory()(address)")"
  expect_address_equal \
    "BoardroomControllerFactory BoardroomFactory" \
    "$boardroom_factory" \
    "$actual_controller_factory_boardroom_factory"

  actual_controller_implementation="$(call_address "$boardroom_controller_factory" "controllerImplementation()(address)")"
  expect_address_equal \
    "BoardroomControllerFactory controllerImplementation" \
    "$boardroom_controller_logic" \
    "$actual_controller_implementation"

  actual_boardroom_governance_logic="$(call_address "$boardroom_logic" "governanceLogic()(address)")"
  expect_address_equal \
    "Boardroom implementation governanceLogic" \
    "$boardroom_governance_logic" \
    "$actual_boardroom_governance_logic"

  actual_boardroom_redemption_payout="$(call_address "$boardroom_logic" "redemptionPayoutLogic()(address)")"
  expect_address_equal \
    "Boardroom implementation redemptionPayoutLogic" \
    "$boardroom_redemption_payout" \
    "$actual_boardroom_redemption_payout"

  actual_boardroom_controller_factory="$(call_address "$boardroom_logic" "controllerFactory()(address)")"
  expect_address_equal \
    "Boardroom implementation controllerFactory" \
    "$boardroom_controller_factory" \
    "$actual_boardroom_controller_factory"

  actual_boardroom_market_logic="$(call_address "$boardroom_logic" "marketLogic()(address)")"
  expect_address_equal \
    "Boardroom implementation marketLogic" \
    "$boardroom_market_logic" \
    "$actual_boardroom_market_logic"

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

  actual_distribution_locker="$(call_address "$distribution_factory" "lockedLiquidityFactory()(address)")"
  expect_address_equal \
    "DistributionFactory LockedLiquidityFactory wiring" \
    "$(field lockedLiquidityFactory)" \
    "$actual_distribution_locker"

  actual_distribution_grants="$(call_address "$distribution_factory" "tokenGrantFactory()(address)")"
  expect_address_equal \
    "DistributionFactory TokenGrantFactory wiring" \
    "$token_grant_factory" \
    "$actual_distribution_grants"

  for logic_field in fixedPriceSaleLogic dutchAuctionLogic migratingBondingCurveLogic merkleAirdropLogic; do
    actual_logic="$(call_address "$distribution_factory" "$logic_field()(address)")"
    expect_address_equal "DistributionFactory $logic_field wiring" "$(field "$logic_field")" "$actual_logic"
  done

  actual_boardroom_rewards_boardroom_factory="$(call_address "$boardroom_rewards_factory" "boardroomFactory()(address)")"
  expect_address_equal \
    "BoardroomRewardsFactory BoardroomFactory wiring" \
    "$boardroom_factory" \
    "$actual_boardroom_rewards_boardroom_factory"

  actual_boardroom_rewards_logic="$(call_address "$boardroom_rewards_factory" "rewardsLogic()(address)")"
  expect_address_equal \
    "BoardroomRewardsFactory implementation wiring" \
    "$boardroom_rewards_logic" \
    "$actual_boardroom_rewards_logic"

  actual_boardroom_rewards_policy_allowed="$(call_bool "$policy_registry" "isPolicyAllowed(address)(bool)" "$boardroom_rewards_factory")"
  expect_equal "BoardroomRewards policy allowance" "$(field boardroomRewardsPolicyAllowed)" "$actual_boardroom_rewards_policy_allowed"

  actual_boardroom_rewards_module_policy="$(call_bool "$policy_registry" "isModulePolicy(address)(bool)" "$boardroom_rewards_factory")"
  expect_equal "BoardroomRewardsFactory permanent module identity" "$(field boardroomRewardsModulePolicy)" "$actual_boardroom_rewards_module_policy"

  actual_bond_market_amm_factory="$(call_address "$bond_market_factory" "ammFactory()(address)")"
  expect_address_equal \
    "BondMarketFactory AmmFactory wiring" \
    "$(field ammFactory)" \
    "$actual_bond_market_amm_factory"

  actual_bond_market_boardroom_factory="$(call_address "$bond_market_factory" "boardroomFactory()(address)")"
  expect_address_equal \
    "BondMarketFactory BoardroomFactory wiring" \
    "$boardroom_factory" \
    "$actual_bond_market_boardroom_factory"

  actual_bond_market_logic="$(call_address "$bond_market_factory" "bondMarketLogic()(address)")"
  expect_address_equal \
    "BondMarketFactory implementation wiring" \
    "$bond_market_logic" \
    "$actual_bond_market_logic"

  actual_bond_market_policy_allowed="$(call_bool "$policy_registry" "isPolicyAllowed(address)(bool)" "$bond_market_factory")"
  expect_equal "BondMarket policy allowance" "$(field bondMarketPolicyAllowed)" "$actual_bond_market_policy_allowed"

  actual_bond_market_module_policy="$(call_bool "$policy_registry" "isModulePolicy(address)(bool)" "$bond_market_factory")"
  expect_equal "BondMarketFactory permanent module identity" "$(field bondMarketModulePolicy)" "$actual_bond_market_module_policy"

  actual_asset_wrapped_native_allowed="$(call_bool "$asset_policy" "isAssetAllowed(address)(bool)" "$wrapped_native")"
  expect_equal "AssetPolicy wrapped native allowance" "$(field assetWrappedNativeAllowed)" "$actual_asset_wrapped_native_allowed"

  actual_asset_token_grant_spender_allowed="$(call_bool "$asset_policy" "isApprovalSpenderAllowed(address)(bool)" "$token_grant_factory")"
  expect_equal "AssetPolicy TokenGrantFactory spender allowance" "$(field assetTokenGrantSpenderAllowed)" "$actual_asset_token_grant_spender_allowed"

  actual_asset_distribution_spender_allowed="$(call_bool "$asset_policy" "isApprovalSpenderAllowed(address)(bool)" "$distribution_factory")"
  expect_equal "AssetPolicy DistributionFactory spender allowance" "$(field assetDistributionSpenderAllowed)" "$actual_asset_distribution_spender_allowed"

  actual_asset_boardroom_rewards_spender_allowed="$(call_bool "$asset_policy" "isApprovalSpenderAllowed(address)(bool)" "$boardroom_rewards_factory")"
  expect_equal "AssetPolicy BoardroomRewardsFactory spender allowance" "$(field assetBoardroomRewardsSpenderAllowed)" "$actual_asset_boardroom_rewards_spender_allowed"

  actual_asset_bond_market_spender_allowed="$(call_bool "$asset_policy" "isApprovalSpenderAllowed(address)(bool)" "$bond_market_factory")"
  expect_equal "AssetPolicy BondMarketFactory spender allowance" "$(field assetBondMarketSpenderAllowed)" "$actual_asset_bond_market_spender_allowed"
elif [[ "$REQUIRE_BOARDROOM_DEPLOYMENT" == "1" ]]; then
  fail "Boardroom deployment fields are required but missing"
else
  echo "Skipping Boardroom verification: no Boardroom deployment fields in artifact"
fi

if field_exists ammFactory; then
  amm_factory="$(field ammFactory)"
  amm_pool_implementation="$(field ammPoolImplementation)"
  require_code "AmmFactory" "$amm_factory"
  require_code "AmmPool implementation" "$amm_pool_implementation"

  actual_amm_owner="$(call_address "$amm_factory" "owner()(address)")"
  actual_amm_fee_manager="$(call_address "$amm_factory" "feeManager()(address)")"
  actual_amm_protocol_fee_recipient="$(call_address "$amm_factory" "protocolFeeRecipient()(address)")"
  actual_amm_liquidity_router="$(call_address "$amm_factory" "liquidityRouter()(address)")"
  actual_amm_reservation_manager="$(call_address "$amm_factory" "reservationManager()(address)")"
  actual_amm_boardroom_factory="$(call_address "$amm_factory" "boardroomFactory()(address)")"
  actual_amm_pool_implementation="$(call_address "$amm_factory" "poolImplementation()(address)")"
  expect_address_equal "AmmFactory owner" "$(field ammFactoryOwner)" "$actual_amm_owner"
  expect_address_equal "Protocol governance owns AmmFactory" "$(field protocolGovernance)" "$actual_amm_owner"
  expect_address_equal "AmmFactory feeManager" "$(field ammFeeManager)" "$actual_amm_fee_manager"
  expect_address_equal "AmmFactory protocolFeeRecipient" "$(field ammProtocolFeeRecipient)" "$actual_amm_protocol_fee_recipient"
  expect_address_equal "AmmFactory routes through ProtocolFeeRouter" "$protocol_fee_router" "$actual_amm_protocol_fee_recipient"
  expect_address_equal "AmmFactory liquidityRouter" "$(field ammLiquidityRouter)" "$actual_amm_liquidity_router"
  expect_address_equal "AmmFactory liquidityRouter wiring" "$(field ammRouter)" "$actual_amm_liquidity_router"
  expect_address_equal "AmmFactory BoardroomFactory wiring" "$(field boardroomFactory)" "$actual_amm_boardroom_factory"
  expect_address_equal \
    "AmmFactory pool implementation wiring" \
    "$amm_pool_implementation" \
    "$actual_amm_pool_implementation"
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
  require_field lockedLiquidityLogic
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
  locked_liquidity_logic="$(field lockedLiquidityLogic)"
  policy_registry="$(field boardroomPolicyRegistry)"
  asset_policy="$(field assetPolicy)"

  require_code "AmmFactory" "$amm_factory"
  require_code "AmmRouter" "$amm_router"
  require_code "LockedLiquidityFactory" "$locked_liquidity_factory"
  require_code "LockedLiquidity implementation" "$locked_liquidity_logic"

  actual_router_factory="$(call_address "$amm_router" "factory()(address)")"
  expect_address_equal "AmmRouter factory" "$amm_factory" "$actual_router_factory"

  actual_wrapped_native="$(call_address "$amm_router" "wrappedNative()(address)")"
  expect_address_equal "AmmRouter wrappedNative" "$wrapped_native" "$actual_wrapped_native"

  actual_locker_router="$(call_address "$locked_liquidity_factory" "ammRouter()(address)")"
  expect_address_equal "LockedLiquidityFactory ammRouter" "$amm_router" "$actual_locker_router"

  actual_locker_boardroom_factory="$(call_address "$locked_liquidity_factory" "boardroomFactory()(address)")"
  expect_address_equal \
    "LockedLiquidityFactory BoardroomFactory" \
    "$boardroom_factory" \
    "$actual_locker_boardroom_factory"

  actual_locked_liquidity_logic="$(call_address "$locked_liquidity_factory" "lockedLiquidityLogic()(address)")"
  expect_address_equal \
    "LockedLiquidityFactory implementation wiring" \
    "$locked_liquidity_logic" \
    "$actual_locked_liquidity_logic"

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
require_code_hash "BoardroomGovernanceLogic" "$(field boardroomGovernanceLogic)" boardroomGovernanceLogicCodeHash
require_code_hash "BoardroomRedemptionPayout" "$(field boardroomRedemptionPayout)" boardroomRedemptionPayoutCodeHash
require_code_hash "Boardroom implementation" "$(field boardroomLogic)" boardroomLogicCodeHash
require_code_hash "BoardroomControllerFactory" "$(field boardroomControllerFactory)" boardroomControllerFactoryCodeHash
require_code_hash "BoardroomController implementation" "$(field boardroomControllerLogic)" boardroomControllerCodeHash
require_code_hash "BoardroomMarketLogic" "$(field boardroomMarketLogic)" boardroomMarketLogicCodeHash
require_code_hash "TokenGrantFactory" "$(field tokenGrantFactory)" tokenGrantFactoryCodeHash
require_code_hash "TokenGrant implementation" "$(field tokenGrantLogic)" tokenGrantLogicCodeHash
require_code_hash "AmmFactory" "$(field ammFactory)" ammFactoryCodeHash
require_code_hash "AmmPool implementation" "$(field ammPoolImplementation)" ammPoolImplementationCodeHash
require_code_hash "AmmRouter" "$(field ammRouter)" ammRouterCodeHash
require_code_hash "LockedLiquidityFactory" "$(field lockedLiquidityFactory)" lockedLiquidityFactoryCodeHash
require_code_hash "LockedLiquidity implementation" "$(field lockedLiquidityLogic)" lockedLiquidityLogicCodeHash
require_code_hash "DistributionFactory" "$(field distributionFactory)" distributionFactoryCodeHash
require_code_hash "FixedPriceSale implementation" "$(field fixedPriceSaleLogic)" fixedPriceSaleLogicCodeHash
require_code_hash "DutchAuctionSale implementation" "$(field dutchAuctionLogic)" dutchAuctionLogicCodeHash
require_code_hash \
  "MigratingBondingCurve implementation" \
  "$(field migratingBondingCurveLogic)" \
  migratingBondingCurveLogicCodeHash
require_code_hash "MerkleAirdrop implementation" "$(field merkleAirdropLogic)" merkleAirdropLogicCodeHash
require_code_hash "BoardroomRewardsFactory" "$(field boardroomRewardsFactory)" boardroomRewardsFactoryCodeHash
require_code_hash "BoardroomRewards implementation" "$(field boardroomRewardsLogic)" boardroomRewardsLogicCodeHash
require_code_hash "BondMarketFactory" "$(field bondMarketFactory)" bondMarketFactoryCodeHash
require_code_hash "BondMarket implementation" "$(field bondMarketLogic)" bondMarketLogicCodeHash
require_code_hash "Wrapped native" "$(field wrappedNative)" wrappedNativeCodeHash
