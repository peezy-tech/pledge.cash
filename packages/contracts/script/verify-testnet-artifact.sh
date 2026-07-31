#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARTIFACT="${ARTIFACT:?Set ARTIFACT to the deployment JSON path}"
RECEIPTS="${RECEIPTS:-${ARTIFACT%.json}.receipts.json}"
RPC_URL="${RPC_URL:?Set RPC_URL to the target chain RPC URL}"
REQUIRE_DEPLOYMENT="${REQUIRE_DEPLOYMENT:-0}"

cd "$ROOT_DIR"

fail() {
  echo "Artifact verification failed: $*" >&2
  exit 1
}

[[ "$REQUIRE_DEPLOYMENT" == "0" || "$REQUIRE_DEPLOYMENT" == "1" ]] \
  || fail "REQUIRE_DEPLOYMENT must be 0 or 1"

field_exists() {
  jq -e --arg key "$1" 'has($key) and .[$key] != null and .[$key] != ""' "$ARTIFACT" >/dev/null
}

field() {
  jq -r --arg key "$1" '.[$key] | if . == null then empty else . end' "$ARTIFACT"
}

require_field() {
  local key="$1"
  field_exists "$key" || fail "$ARTIFACT is missing .$key"
}

lower() {
  tr '[:upper:]' '[:lower:]'
}

first_token() {
  awk 'NR == 1 { print $1 }'
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
  expect_equal "$1" "$(printf '%s' "$2" | lower)" "$(printf '%s' "$3" | lower)"
}

expect_hash_equal() {
  expect_equal "$1" "$(printf '%s' "$2" | lower)" "$(printf '%s' "$3" | lower)"
}

expect_json_equal() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  if [[ "$expected" != "$actual" ]]; then
    fail "$label mismatch: expected $expected, got $actual"
  fi
  echo "Verified $label."
}

call_value() {
  cast_retry cast call --rpc-url "$RPC_URL" "$1" "$2" "${@:3}" | first_token
}

call_json() {
  cast_retry cast call --json --rpc-url "$RPC_URL" "$1" "$2" "${@:3}"
}

call_value_at() {
  local block_number="$1"
  local target="$2"
  local signature="$3"
  shift 3
  cast_retry cast call --rpc-url "$RPC_URL" --block "$block_number" "$target" "$signature" "$@" \
    | first_token
}

call_json_at() {
  local block_number="$1"
  local target="$2"
  local signature="$3"
  shift 3
  cast_retry cast call --json --rpc-url "$RPC_URL" --block "$block_number" "$target" "$signature" "$@"
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

contract_creation_code() {
  local bytecode
  bytecode="$(forge inspect "$1" bytecode)" || fail "could not reproduce creation bytecode for $1"
  [[ "$bytecode" =~ ^0x([0-9a-fA-F]{2})+$ ]] || fail "invalid creation bytecode for $1"
  printf '%s\n' "$bytecode"
}

creation_code_hash() {
  cast keccak "$(contract_creation_code "$1")"
}

runtime_code_hash() {
  local bytecode
  bytecode="$(forge inspect "$1" deployedBytecode)" || fail "could not reproduce runtime bytecode for $1"
  [[ "$bytecode" =~ ^0x([0-9a-fA-F]{2})+$ ]] || fail "invalid runtime bytecode for $1"
  cast keccak "$bytecode"
}

encoded_hash() {
  local encoded
  encoded="$(cast abi-encode "$@")" || fail "could not ABI-encode release identity"
  cast keccak "$encoded"
}

kernel_selectors_array() {
  local selectors
  selectors="$(
    for signature in \
      "facetRegistry()" \
      "appliedStorageLayoutHash()" \
      "facetSetHash()" \
      "initialize(bytes32,bytes)" \
      "appliedStorageVersion()" \
      "migrationRequired()" \
      "kernelSelectorSetHash()" \
      "viewDispatcher()"; do
      cast sig "$signature"
    done | sort
  )"
  printf '[%s]\n' "$(printf '%s\n' "$selectors" | paste -sd, -)"
}

local_release_code_hash() {
  local deterministic boardroom_architecture module_architecture
  deterministic="$(creation_code_hash PledgeCashDeterministicDeployer)"
  boardroom_architecture="$(
    encoded_hash \
      "f(bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32)" \
      "$(creation_code_hash ProtocolFacetRegistry)" \
      "$(creation_code_hash BoardroomKernel)" \
      "$(creation_code_hash src/boardroom/BoardroomFactory.sol:BoardroomFactory)" \
      "$(creation_code_hash src/boardroom/BoardroomControllerFactory.sol:BoardroomControllerFactory)" \
      "$(creation_code_hash src/boardroom/BoardroomController.sol:BoardroomController)" \
      "$(creation_code_hash BoardroomGovernanceLogic)" \
      "$(creation_code_hash BoardroomMarketLogic)" \
      "$(creation_code_hash BoardroomRedemptionPayout)" \
      "$(creation_code_hash BoardroomAuthorityFacet)" \
      "$(creation_code_hash BoardroomExecutionFacet)" \
      "$(creation_code_hash BoardroomMarketFacet)" \
      "$(creation_code_hash BoardroomRedemptionFacet)" \
      "$(creation_code_hash BoardroomViewFacet)"
  )"
  module_architecture="$(
    encoded_hash \
      "f(bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32)" \
      "$(creation_code_hash BoardroomPolicyRegistry)" \
      "$(creation_code_hash AssetPolicy)" \
      "$(creation_code_hash ProtocolFeeRouter)" \
      "$(creation_code_hash TokenGrantFactory)" \
      "$(creation_code_hash AmmFactory)" \
      "$(creation_code_hash AmmRouter)" \
      "$(creation_code_hash LockedLiquidityFactory)" \
      "$(creation_code_hash DistributionFactory)" \
      "$(creation_code_hash BoardroomRewardsFactory)" \
      "$(creation_code_hash BondMarketFactory)"
  )"
  encoded_hash "f(bytes32,bytes32,bytes32)" "$deterministic" "$boardroom_architecture" "$module_architecture"
}

verify_deterministic_deployer_provenance() {
  local broadcaster owner create2_factory deterministic_deployer
  local creation_code constructor_args init_code init_code_hash creation_hash salt expected_deployer
  local expected_runtime_hash live_code live_runtime_hash

  broadcaster="$(field deployer)"
  owner="$(field deterministicDeployerOwner)"
  create2_factory="$(field create2Factory)"
  deterministic_deployer="$(field deterministicDeployer)"
  expect_address_equal "deterministic deployer broadcaster" "$owner" "$broadcaster"

  creation_code="$(contract_creation_code PledgeCashDeterministicDeployer)"
  creation_hash="$(cast keccak "$creation_code")"
  constructor_args="$(cast abi-encode "f(address)" "$owner")"
  init_code="${creation_code}${constructor_args#0x}"
  init_code_hash="$(cast keccak "$init_code")"
  salt="$(
    encoded_hash \
      "f(string,string,bytes32)" \
      "pledge.cash.protocol.v1" \
      "PledgeCashDeterministicDeployer" \
      "$creation_hash"
  )"
  expected_deployer="$(
    cast create2 \
      --deployer "$create2_factory" \
      --salt "$salt" \
      --init-code-hash "$init_code_hash"
  )"
  expect_address_equal "PledgeCashDeterministicDeployer CREATE2 address" "$expected_deployer" "$deterministic_deployer"

  expected_runtime_hash="$(runtime_code_hash PledgeCashDeterministicDeployer)"
  expect_hash_equal \
    "PledgeCashDeterministicDeployer artifact code hash" \
    "$expected_runtime_hash" \
    "$(field deterministicDeployerCodeHash)"
  live_code="$(cast_retry cast code --rpc-url "$RPC_URL" "$deterministic_deployer")"
  [[ "$live_code" != "0x" ]] || fail "PledgeCashDeterministicDeployer has no code"
  live_runtime_hash="$(cast keccak "$live_code")"
  expect_hash_equal "PledgeCashDeterministicDeployer live code hash" "$expected_runtime_hash" "$live_runtime_hash"
  expect_address_equal \
    "PledgeCashDeterministicDeployer owner" \
    "$owner" \
    "$(call_value "$deterministic_deployer" "owner()(address)")"
}

verify_release_deployment() {
  local label="$1"
  local contract_name="$2"
  local artifact_field="$3"
  local code_hash_field="$4"
  local constructor_signature="$5"
  shift 5

  local creation_code creation_hash constructor_args init_code init_code_hash salt
  local deterministic_deployer live_init_code_hash predicted_address expected_calldata expected_input_hash
  local broadcaster_lower deterministic_deployer_lower transaction_count

  creation_code="$(contract_creation_code "$contract_name")"
  creation_hash="$(cast keccak "$creation_code")"
  salt="$(
    encoded_hash \
      "f(string,string,bytes32)" \
      "pledge.cash.protocol.v1" \
      "$label" \
      "$creation_hash"
  )"
  constructor_args=""
  if [[ -n "$constructor_signature" ]]; then
    constructor_args="$(cast abi-encode "$constructor_signature" "$@")" \
      || fail "could not encode $label constructor"
  fi
  init_code="${creation_code}${constructor_args#0x}"
  init_code_hash="$(cast keccak "$init_code")"
  deterministic_deployer="$(field deterministicDeployer)"

  live_init_code_hash="$(
    call_value "$deterministic_deployer" "initCodeHashForSalt(bytes32)(bytes32)" "$salt"
  )"
  expect_hash_equal "$label deterministic init-code hash" "$init_code_hash" "$live_init_code_hash"
  predicted_address="$(call_value "$deterministic_deployer" "predict(bytes32)(address)" "$salt")"
  expect_address_equal "$label deterministic address" "$(field "$artifact_field")" "$predicted_address"
  require_code_hash "$label" "$predicted_address" "$code_hash_field"

  expected_calldata="$(cast calldata "deploy(bytes32,bytes)" "$salt" "$init_code")"
  expected_input_hash="$(cast keccak "$expected_calldata" | lower)"
  broadcaster_lower="$(field deployer | lower)"
  deterministic_deployer_lower="$(printf '%s' "$deterministic_deployer" | lower)"
  transaction_count="$(
    jq -r \
      --arg from "$broadcaster_lower" \
      --arg to "$deterministic_deployer_lower" \
      --arg inputHash "$expected_input_hash" \
      '[
        .transactions[]
        | select(
            (.from | ascii_downcase) == $from
            and .to != null
            and (.to | ascii_downcase) == $to
            and (.inputHash | ascii_downcase) == $inputHash
            and (.value | ascii_downcase) == "0x0"
          )
      ] | length' \
      "$RECEIPTS"
  )"
  expect_equal "$label source-bound deployment transaction count" "1" "$transaction_count"
}

verify_release_provenance() {
  local bootstrap controller_factory selectors
  bootstrap="$(field deployer)"
  controller_factory="$(field boardroomControllerFactory)"
  selectors="$(kernel_selectors_array)"

  verify_deterministic_deployer_provenance
  verify_release_deployment \
    "BoardroomPolicyRegistry" BoardroomPolicyRegistry boardroomPolicyRegistry boardroomPolicyRegistryCodeHash \
    "f(address)" "$bootstrap"
  verify_release_deployment \
    "ProtocolFacetRegistry" ProtocolFacetRegistry protocolFacetRegistry protocolFacetRegistryCodeHash \
    "f(address,bytes4[])" "$bootstrap" "$selectors"
  verify_release_deployment \
    "BoardroomKernel" BoardroomKernel boardroomKernel boardroomKernelCodeHash \
    "f(address)" "$(field protocolFacetRegistry)"
  verify_release_deployment \
    "BoardroomGovernanceLogic" BoardroomGovernanceLogic boardroomGovernanceLogic boardroomGovernanceLogicCodeHash ""
  verify_release_deployment \
    "BoardroomRedemptionPayout" BoardroomRedemptionPayout boardroomRedemptionPayout \
    boardroomRedemptionPayoutCodeHash ""
  verify_release_deployment \
    "BoardroomMarketLogic" BoardroomMarketLogic boardroomMarketLogic boardroomMarketLogicCodeHash ""
  verify_release_deployment \
    "BoardroomFactory" src/boardroom/BoardroomFactory.sol:BoardroomFactory boardroomFactory boardroomFactoryCodeHash \
    "f(address,address,address,address,address,address,address)" \
    "$(field protocolFacetRegistry)" \
    "$(field boardroomPolicyRegistry)" \
    "$(field wrappedNative)" \
    "$(field boardroomKernel)" \
    "$(field boardroomRedemptionPayout)" \
    "$(field boardroomGovernanceLogic)" \
    "$(field boardroomMarketLogic)"
  verify_release_deployment \
    "BoardroomAuthorityFacet" BoardroomAuthorityFacet authorityFacet authorityFacetCodeHash \
    "f(address,address,address,address)" \
    "$(field boardroomRedemptionPayout)" "$(field boardroomGovernanceLogic)" "$controller_factory" \
    "$(field boardroomMarketLogic)"
  verify_release_deployment \
    "BoardroomExecutionFacet" BoardroomExecutionFacet executionFacet executionFacetCodeHash \
    "f(address,address,address,address)" \
    "$(field boardroomRedemptionPayout)" "$(field boardroomGovernanceLogic)" "$controller_factory" \
    "$(field boardroomMarketLogic)"
  verify_release_deployment \
    "BoardroomMarketFacet" BoardroomMarketFacet marketFacet marketFacetCodeHash \
    "f(address,address,address,address)" \
    "$(field boardroomRedemptionPayout)" "$(field boardroomGovernanceLogic)" "$controller_factory" \
    "$(field boardroomMarketLogic)"
  verify_release_deployment \
    "BoardroomRedemptionFacet" BoardroomRedemptionFacet redemptionFacet redemptionFacetCodeHash \
    "f(address,address,address,address)" \
    "$(field boardroomRedemptionPayout)" "$(field boardroomGovernanceLogic)" "$controller_factory" \
    "$(field boardroomMarketLogic)"
  verify_release_deployment \
    "BoardroomViewFacet" BoardroomViewFacet viewFacet viewFacetCodeHash \
    "f(address,address,address,address)" \
    "$(field boardroomRedemptionPayout)" "$(field boardroomGovernanceLogic)" "$controller_factory" \
    "$(field boardroomMarketLogic)"
  verify_release_deployment \
    "AssetPolicy" AssetPolicy assetPolicy assetPolicyCodeHash \
    "f(address,address)" "$bootstrap" "$(field wrappedNative)"
  verify_release_deployment \
    "ProtocolFeeRouter" ProtocolFeeRouter protocolFeeRouter protocolFeeRouterCodeHash \
    "f(address,address)" "$bootstrap" "$(field protocolTreasury)"
  verify_release_deployment \
    "TokenGrantFactory" TokenGrantFactory tokenGrantFactory tokenGrantFactoryCodeHash \
    "f(address,address)" "$bootstrap" "$(field boardroomFactory)"
  verify_release_deployment \
    "AmmFactory" AmmFactory ammFactory ammFactoryCodeHash \
    "f(address,address)" "$bootstrap" "$(field boardroomFactory)"
  verify_release_deployment \
    "AmmRouter" AmmRouter ammRouter ammRouterCodeHash \
    "f(address,address)" "$(field ammFactory)" "$(field wrappedNative)"
  verify_release_deployment \
    "LockedLiquidityFactory" LockedLiquidityFactory lockedLiquidityFactory lockedLiquidityFactoryCodeHash \
    "f(address,address)" "$(field ammRouter)" "$(field boardroomFactory)"
  verify_release_deployment \
    "DistributionFactory" DistributionFactory distributionFactory distributionFactoryCodeHash \
    "f(address,address)" "$(field lockedLiquidityFactory)" "$(field tokenGrantFactory)"
  verify_release_deployment \
    "BoardroomRewardsFactory" BoardroomRewardsFactory boardroomRewardsFactory boardroomRewardsFactoryCodeHash \
    "f(address)" "$(field boardroomFactory)"
  verify_release_deployment \
    "BondMarketFactory" BondMarketFactory bondMarketFactory bondMarketFactoryCodeHash \
    "f(address,address)" "$(field ammFactory)" "$(field boardroomFactory)"
}

normalized_receipt() {
  jq -c '{
    transactionHash: (.transactionHash | ascii_downcase),
    blockNumber: (.blockNumber | ascii_downcase),
    status: (.status | ascii_downcase),
    gasUsed: (.gasUsed | ascii_downcase),
    contractAddress: (if .contractAddress == null then null else (.contractAddress | ascii_downcase) end)
  }'
}

normalized_transaction() {
  local input_hash="$1"
  jq -c --arg inputHash "$input_hash" '{
    transactionHash: ((.transactionHash // .hash) | ascii_downcase),
    from: (.from | ascii_downcase),
    to: (if .to == null then null else (.to | ascii_downcase) end),
    inputHash: ($inputHash | ascii_downcase),
    value: (.value | ascii_downcase)
  }'
}

verify_receipt_manifest() {
  local deployment_block="$1"
  local source_commit="$2"
  local manifest_chain manifest_commit manifest_deployer min_block
  local row transaction_hash block_hex block_decimal expected_receipt live_receipt actual_receipt
  local expected_input_hash expected_transaction live_transaction live_input live_input_hash actual_transaction

  [[ -f "$RECEIPTS" ]] || fail "missing deployment receipt manifest $RECEIPTS"
  jq -e '
    .schemaVersion == 2
    and (.chainId | type == "number")
    and (.sourceCommit | type == "string" and test("^[0-9a-f]{40}$"))
    and (.transactions | type == "array" and length > 0)
    and all(
      .transactions[];
      (.transactionHash | type == "string" and test("^0x[0-9a-fA-F]{64}$"))
      and (.blockNumber | type == "string" and test("^0x[0-9a-fA-F]+$"))
      and (.status | type == "string" and ascii_downcase == "0x1")
      and (.gasUsed | type == "string" and test("^0x[0-9a-fA-F]+$"))
      and (.from | type == "string" and test("^0x[0-9a-fA-F]{40}$"))
      and (.inputHash | type == "string" and test("^0x[0-9a-fA-F]{64}$"))
      and (.value | type == "string" and test("^0x[0-9a-fA-F]+$"))
    )
    and (
      [.transactions[].transactionHash | ascii_downcase] as $hashes
      | ($hashes | unique | length) == ($hashes | length)
    )
  ' "$RECEIPTS" >/dev/null || fail "deployment receipt manifest is malformed"

  manifest_chain="$(jq -r '.chainId' "$RECEIPTS")"
  manifest_commit="$(jq -r '.sourceCommit' "$RECEIPTS")"
  expect_equal "receipt manifest chain id" "$(field chainId)" "$manifest_chain"
  expect_equal "receipt manifest source commit" "$source_commit" "$manifest_commit"
  manifest_deployer="$(field deployer | lower)"
  jq -e --arg deployer "$manifest_deployer" \
    'all(.transactions[]; (.from | ascii_downcase) == $deployer)' \
    "$RECEIPTS" >/dev/null || fail "receipt manifest contains another sender"

  min_block=""
  while IFS= read -r row; do
    transaction_hash="$(printf '%s' "$row" | jq -r '.transactionHash')"
    block_hex="$(printf '%s' "$row" | jq -r '.blockNumber')"
    block_decimal="$(printf '%d' "$block_hex")"
    if [[ -z "$min_block" || "$block_decimal" -lt "$min_block" ]]; then
      min_block="$block_decimal"
    fi

    expected_receipt="$(printf '%s' "$row" | normalized_receipt)"
    live_receipt="$(cast_retry cast rpc --rpc-url "$RPC_URL" eth_getTransactionReceipt "$transaction_hash")"
    [[ "$live_receipt" != "null" ]] || fail "missing live receipt for $transaction_hash"
    actual_receipt="$(printf '%s' "$live_receipt" | normalized_receipt)"
    [[ "$expected_receipt" == "$actual_receipt" ]] || fail "live receipt mismatch for $transaction_hash"

    expected_input_hash="$(printf '%s' "$row" | jq -r '.inputHash')"
    expected_transaction="$(printf '%s' "$row" | normalized_transaction "$expected_input_hash")"
    live_transaction="$(cast_retry cast rpc --rpc-url "$RPC_URL" eth_getTransactionByHash "$transaction_hash")"
    [[ "$live_transaction" != "null" ]] || fail "missing live transaction for $transaction_hash"
    live_input="$(printf '%s' "$live_transaction" | jq -r '.input')"
    live_input_hash="$(cast keccak "$live_input")"
    actual_transaction="$(printf '%s' "$live_transaction" | normalized_transaction "$live_input_hash")"
    [[ "$expected_transaction" == "$actual_transaction" ]] \
      || fail "live sender, target, calldata, or value mismatch for $transaction_hash"
  done < <(jq -c '.transactions[]' "$RECEIPTS")

  if [[ "$deployment_block" -gt "$min_block" ]]; then
    fail "deploymentBlock $deployment_block is later than earliest receipt block $min_block"
  fi
  echo "Verified $(jq '.transactions | length' "$RECEIPTS") live deployment receipts."
}

append_facet_routes() {
  local routes_file="$1"
  local contract_name="$2"
  local facet_address="$3"
  local code_hash="$4"
  local kind="$5"
  local mode="$6"

  if [[ "$mode" == "mutating" ]]; then
    forge inspect "$contract_name" methodIdentifiers --json \
      | jq -r 'to_entries[]
          | select(.key | test("^[^(]+\\(bytes32(,|\\))"))
          | "0x" + .value' \
      | while IFS= read -r selector; do
          printf '%s|%s|%s|%s\n' "$selector" "$facet_address" "$code_hash" "$kind" >>"$routes_file"
        done
  else
    forge inspect "$contract_name" methodIdentifiers --json \
      | jq -r 'to_entries[]
          | select(
              .key != "cancelOwnershipHandover()"
              and .key != "completeOwnershipHandover(address)"
              and .key != "renounceOwnership()"
              and .key != "requestOwnershipHandover()"
              and .key != "transferOwnership(address)"
            )
          | "0x" + .value' \
      | while IFS= read -r selector; do
          printf '%s|%s|%s|%s\n' "$selector" "$facet_address" "$code_hash" "$kind" >>"$routes_file"
        done
  fi
}

# The root artifact is immutable deployment evidence. Its "active*" fields
# describe the genesis ceremony and must remain published, but need not remain
# the registry's current owner or release after promotion.
verify_genesis_release_manifest() {
  local registry kernel factory release_hash expected_manifest expected_layout layout_preimage
  local expected_kernel_hash live_kernel_hash metadata routes_file sorted_file duplicate expected_count actual_count
  local selector facet_address code_hash kind route_json
  local routes_array routes_hash type_hash expected_release_hash actual_selectors expected_selectors

  registry="$(field protocolFacetRegistry)"
  kernel="$(field boardroomKernel)"
  factory="$(field boardroomFactory)"
  release_hash="$(field activeFacetSetHash)"

  expected_manifest="$(
    sed -nE 's/.*RELEASE_A = (0x[0-9a-fA-F]{64});.*/\1/p' \
      src/boardroom/diamond/BoardroomManifestHashes.sol
  )"
  [[ "$expected_manifest" =~ ^0x[0-9a-fA-F]{64}$ ]] || fail "could not read local release-A manifest hash"
  layout_preimage="$(
    sed -nE 's/.*RELEASE_A = keccak256\("([^"]+)"\);.*/\1/p' \
      src/boardroom/diamond/BoardroomStorageLayouts.sol
  )"
  [[ -n "$layout_preimage" ]] || fail "could not read local release-A storage layout preimage"
  expected_layout="$(cast keccak "$layout_preimage")"
  expect_equal "genesis artifact release" "1" "$(field activeRelease)"
  expect_equal "genesis artifact storage version" "1" "$(field requiredStorageVersion)"
  expect_hash_equal "genesis manifest hash" "$expected_manifest" "$(field manifestHash)"
  expect_hash_equal "genesis storage layout" "$expected_layout" "$(field requiredStorageLayoutHash)"

  expected_kernel_hash="$(encoded_hash "f(bytes4[])" "$(kernel_selectors_array)")"
  expect_hash_equal "kernel selector set artifact hash" "$expected_kernel_hash" "$(field kernelSelectorSetHash)"
  live_kernel_hash="$(call_value "$registry" "kernelSelectorSetHash()(bytes32)")"
  expect_hash_equal "registry kernel selector set hash" "$expected_kernel_hash" "$live_kernel_hash"
  expect_hash_equal \
    "kernel selector set hash" \
    "$expected_kernel_hash" \
    "$(call_value "$kernel" "kernelSelectorSetHash()(bytes32)")"
  expect_address_equal \
    "kernel registry" \
    "$registry" \
    "$(call_value "$kernel" "facetRegistry()(address)")"

  metadata="$(call_json "$registry" \
    "facetSetMetadata(bytes32)(bool,uint64,uint64,bytes32,bytes32,bytes32,address,bytes4,uint256)" \
    "$release_hash")"
  expect_equal "genesis release published" "true" "$(printf '%s' "$metadata" | jq -r '.[0]')"
  expect_equal "published genesis release" "1" "$(printf '%s' "$metadata" | jq -r '.[1]')"
  expect_equal "published genesis storage version" "1" "$(printf '%s' "$metadata" | jq -r '.[2]')"
  expect_hash_equal \
    "published genesis predecessor" \
    "0x0000000000000000000000000000000000000000000000000000000000000000" \
    "$(printf '%s' "$metadata" | jq -r '.[3]')"
  expect_hash_equal \
    "published genesis storage layout" "$expected_layout" "$(printf '%s' "$metadata" | jq -r '.[4]')"
  expect_hash_equal \
    "published genesis manifest hash" "$expected_manifest" "$(printf '%s' "$metadata" | jq -r '.[5]')"
  expect_address_equal \
    "release-A migration facet" \
    "0x0000000000000000000000000000000000000000" \
    "$(printf '%s' "$metadata" | jq -r '.[6]')"
  expect_equal "release-A migration selector" "0x00000000" "$(printf '%s' "$metadata" | jq -r '.[7]')"

  routes_file="$(mktemp)"
  sorted_file="$(mktemp)"
  cleanup_routes() {
    rm -f "$routes_file" "$sorted_file"
  }
  trap cleanup_routes RETURN EXIT
  append_facet_routes \
    "$routes_file" BoardroomAuthorityFacet "$(field authorityFacet)" "$(field authorityFacetCodeHash)" 1 mutating
  append_facet_routes \
    "$routes_file" BoardroomExecutionFacet "$(field executionFacet)" "$(field executionFacetCodeHash)" 1 mutating
  append_facet_routes \
    "$routes_file" BoardroomMarketFacet "$(field marketFacet)" "$(field marketFacetCodeHash)" 1 mutating
  append_facet_routes \
    "$routes_file" BoardroomRedemptionFacet "$(field redemptionFacet)" "$(field redemptionFacetCodeHash)" 1 mutating
  append_facet_routes "$routes_file" BoardroomViewFacet "$(field viewFacet)" "$(field viewFacetCodeHash)" 0 view
  sort -t'|' -k1,1 "$routes_file" >"$sorted_file"
  duplicate="$(cut -d'|' -f1 "$sorted_file" | uniq -d | first_token || true)"
  [[ -z "$duplicate" ]] || fail "local release manifest has duplicate selector $duplicate"
  expected_count="$(wc -l <"$sorted_file" | tr -d ' ')"
  expect_equal "genesis selector count artifact" "$expected_count" "$(field selectorCount)"
  expect_equal "genesis selector count metadata" "$expected_count" "$(printf '%s' "$metadata" | jq -r '.[8]')"

  actual_selectors="$(
    call_json "$registry" "facetSetSelectors(bytes32)(bytes4[])" "$release_hash" \
      | jq -r '.[0][]' | lower
  )"
  expected_selectors="$(cut -d'|' -f1 "$sorted_file" | lower)"
  [[ "$actual_selectors" == "$expected_selectors" ]] \
    || fail "published genesis selector set differs from local release-A manifest"
  actual_count="$(printf '%s\n' "$actual_selectors" | awk 'NF { count++ } END { print count + 0 }')"
  expect_equal "published genesis selector count" "$expected_count" "$actual_count"

  while IFS='|' read -r selector facet_address code_hash kind; do
    route_json="$(call_json \
      "$registry" \
      "facetSetRoute(bytes32,bytes4)(address,bytes32,uint8)" \
      "$release_hash" \
      "$selector")"
    expect_address_equal "published route $selector facet" "$facet_address" "$(printf '%s' "$route_json" | jq -r '.[0]')"
    expect_hash_equal "published route $selector code hash" "$code_hash" "$(printf '%s' "$route_json" | jq -r '.[1]')"
    expect_equal "published route $selector kind" "$kind" "$(printf '%s' "$route_json" | jq -r '.[2]')"
  done <"$sorted_file"

  routes_array="$(
    awk -F'|' '
      BEGIN { printf "[" }
      {
        if (NR > 1) printf ","
        printf "(%s,%s,%s,%s)", $1, $2, $3, $4
      }
      END { print "]" }
    ' "$sorted_file"
  )"
  routes_hash="$(encoded_hash "f((bytes4,address,bytes32,uint8)[])" "$routes_array")"
  type_hash="$(
    cast keccak \
      "ProtocolFacetSet(uint64 release,uint64 requiredStorageVersion,bytes32 predecessorFacetSetHash,bytes32 storageLayoutHash,bytes32 manifestHash,bytes32 routesHash,address migrationFacet,bytes4 migrationSelector)"
  )"
  expected_release_hash="$(
    encoded_hash \
      "f(bytes32,uint64,uint64,bytes32,bytes32,bytes32,bytes32,address,bytes4)" \
      "$type_hash" \
      1 \
      1 \
      "0x0000000000000000000000000000000000000000000000000000000000000000" \
      "$expected_layout" \
      "$expected_manifest" \
      "$routes_hash" \
      "0x0000000000000000000000000000000000000000" \
      "0x00000000"
  )"
  expect_hash_equal "locally reproduced genesis facet-set hash" "$expected_release_hash" "$release_hash"

  expect_address_equal \
    "factory facet registry" \
    "$registry" \
    "$(call_value "$factory" "facetRegistry()(address)")"
  expect_address_equal \
    "factory Boardroom kernel" \
    "$kernel" \
    "$(call_value "$factory" "boardroomKernelLogic()(address)")"
  trap - RETURN EXIT
  cleanup_routes
}

# Authenticate mutable registry state from the immutable registry root and
# runtime code hash without treating live-derived owner/hash values as
# authorization inputs.
verify_live_active_release() {
  local registry block_number block_hash final_block_hash registry_code registry_code_hash live_owner
  local active_hash metadata published release required_storage_version predecessor_hash
  local storage_layout_hash manifest_hash migration_facet migration_selector selector_count
  local active_migration predecessor_metadata predecessor_release selector_json
  local routes_file route_records selector previous_selector route_json facet_address code_hash kind
  local active_json facet_code live_code_hash migration_route_count migration_route_facet
  local migration_route_selector routes_array routes_hash type_hash expected_release_hash
  local manifest_tuple registry_release_hash expected_facets_json expected_facet_addresses_json
  local actual_facet_addresses_json actual_facets_json expected_facet grouped_facet
  local expected_function_selectors actual_function_selectors empty_facet_selectors
  local -a selectors=()

  registry="$(field protocolFacetRegistry)"
  block_number="$(cast_retry cast block-number --rpc-url "$RPC_URL" | first_token)"
  [[ "$block_number" =~ ^[0-9]+$ ]] || fail "RPC returned a malformed verification block number"
  block_hash="$(cast_retry cast block "$block_number" --field hash --rpc-url "$RPC_URL" | first_token)"
  [[ "$block_hash" =~ ^0x[0-9a-fA-F]{64}$ ]] || fail "RPC returned a malformed verification block hash"

  registry_code="$(cast_retry cast code "$registry" --block "$block_number" --rpc-url "$RPC_URL")"
  [[ "$registry_code" != "0x" ]] || fail "ProtocolFacetRegistry has no code at pinned block $block_number"
  registry_code_hash="$(cast keccak "$registry_code")"
  expect_hash_equal \
    "pinned ProtocolFacetRegistry code hash" \
    "$(field protocolFacetRegistryCodeHash)" \
    "$registry_code_hash"

  live_owner="$(call_value_at "$block_number" "$registry" "owner()(address)")"
  [[ "$live_owner" =~ ^0x[0-9a-fA-F]{40}$ ]] || fail "live ProtocolFacetRegistry owner is malformed"
  [[ "$(printf '%s' "$live_owner" | lower)" != "0x0000000000000000000000000000000000000000" ]] \
    || fail "live ProtocolFacetRegistry owner is zero"
  echo "Verified live ProtocolFacetRegistry owner is nonzero: $live_owner"

  active_hash="$(call_value_at "$block_number" "$registry" "activeFacetSetHash()(bytes32)")"
  [[ "$active_hash" =~ ^0x[0-9a-fA-F]{64}$ ]] || fail "active facet-set hash is malformed"
  [[ "$(printf '%s' "$active_hash" | lower)" != \
    "0x0000000000000000000000000000000000000000000000000000000000000000" ]] \
    || fail "active facet-set hash is zero"

  metadata="$(call_json_at \
    "$block_number" \
    "$registry" \
    "facetSetMetadata(bytes32)(bool,uint64,uint64,bytes32,bytes32,bytes32,address,bytes4,uint256)" \
    "$active_hash")"
  published="$(printf '%s' "$metadata" | jq -er '.[0]')"
  release="$(printf '%s' "$metadata" | jq -er '.[1]')"
  required_storage_version="$(printf '%s' "$metadata" | jq -er '.[2]')"
  predecessor_hash="$(printf '%s' "$metadata" | jq -er '.[3]')"
  storage_layout_hash="$(printf '%s' "$metadata" | jq -er '.[4]')"
  manifest_hash="$(printf '%s' "$metadata" | jq -er '.[5]')"
  migration_facet="$(printf '%s' "$metadata" | jq -er '.[6]')"
  migration_selector="$(printf '%s' "$metadata" | jq -er '.[7]')"
  selector_count="$(printf '%s' "$metadata" | jq -er '.[8]')"

  expect_equal "active release published" "true" "$published"
  [[ "$release" =~ ^[0-9]+$ && "$release" -gt 0 ]] || fail "active release must be positive"
  [[ "$required_storage_version" =~ ^[0-9]+$ ]] || fail "active storage version is malformed"
  [[ "$storage_layout_hash" =~ ^0x[0-9a-fA-F]{64}$ ]] || fail "active storage layout hash is malformed"
  [[ "$(printf '%s' "$storage_layout_hash" | lower)" != \
    "0x0000000000000000000000000000000000000000000000000000000000000000" ]] \
    || fail "active storage layout hash is zero"
  [[ "$manifest_hash" =~ ^0x[0-9a-fA-F]{64}$ ]] || fail "active manifest hash is malformed"
  [[ "$(printf '%s' "$manifest_hash" | lower)" != \
    "0x0000000000000000000000000000000000000000000000000000000000000000" ]] \
    || fail "active manifest hash is zero"
  [[ "$selector_count" =~ ^[0-9]+$ && "$selector_count" -le 256 ]] \
    || fail "active selector count is malformed or exceeds 256"

  if [[ "$release" == "1" ]]; then
    expect_hash_equal \
      "release-1 predecessor" \
      "0x0000000000000000000000000000000000000000000000000000000000000000" \
      "$predecessor_hash"
  else
    [[ "$predecessor_hash" =~ ^0x[0-9a-fA-F]{64}$ ]] || fail "active predecessor hash is malformed"
    [[ "$(printf '%s' "$predecessor_hash" | lower)" != \
      "0x0000000000000000000000000000000000000000000000000000000000000000" ]] \
      || fail "post-genesis active release has a zero predecessor"
    predecessor_metadata="$(call_json_at \
      "$block_number" \
      "$registry" \
      "facetSetMetadata(bytes32)(bool,uint64,uint64,bytes32,bytes32,bytes32,address,bytes4,uint256)" \
      "$predecessor_hash")"
    expect_equal "active predecessor published" "true" "$(printf '%s' "$predecessor_metadata" | jq -er '.[0]')"
    predecessor_release="$(printf '%s' "$predecessor_metadata" | jq -er '.[1]')"
    [[ "$predecessor_release" =~ ^[0-9]+$ && "$predecessor_release" -lt "$release" ]] \
      || fail "active predecessor release is not lower than $release"
  fi

  expect_equal \
    "live active release" \
    "$release" \
    "$(call_value_at "$block_number" "$registry" "activeRelease()(uint64)")"
  expect_equal \
    "live active storage version" \
    "$required_storage_version" \
    "$(call_value_at "$block_number" "$registry" "activeStorageVersion()(uint64)")"
  expect_hash_equal \
    "live active storage layout" \
    "$storage_layout_hash" \
    "$(call_value_at "$block_number" "$registry" "activeStorageLayoutHash()(bytes32)")"
  expect_hash_equal \
    "live release-to-hash index" \
    "$active_hash" \
    "$(call_value_at "$block_number" "$registry" "facetSetHashForRelease(uint64)(bytes32)" "$release")"

  active_migration="$(call_json_at "$block_number" "$registry" "activeMigration()(address,bytes4)")"
  expect_address_equal \
    "live active migration facet" "$migration_facet" "$(printf '%s' "$active_migration" | jq -er '.[0]')"
  expect_equal \
    "live active migration selector" \
    "$(printf '%s' "$migration_selector" | lower)" \
    "$(printf '%s' "$active_migration" | jq -er '.[1]' | lower)"

  if [[ "$(printf '%s' "$migration_facet" | lower)" == \
    "0x0000000000000000000000000000000000000000" ]]; then
    expect_equal "zero migration metadata selector" "0x00000000" "$(printf '%s' "$migration_selector" | lower)"
  else
    [[ "$migration_facet" =~ ^0x[0-9a-fA-F]{40}$ ]] || fail "active migration facet is malformed"
    [[ "$(printf '%s' "$migration_selector" | lower)" != "0x00000000" ]] \
      || fail "nonzero migration facet has a zero selector"
  fi

  selector_json="$(call_json_at "$block_number" "$registry" "facetSetSelectors(bytes32)(bytes4[])" "$active_hash")"
  mapfile -t selectors < <(printf '%s' "$selector_json" | jq -r '.[0][]?' | lower)
  expect_equal "live active selector count" "$selector_count" "${#selectors[@]}"

  routes_file="$(mktemp)"
  route_records="$(mktemp)"
  cleanup_live_release() {
    rm -f "$routes_file" "$route_records"
  }
  trap cleanup_live_release RETURN EXIT

  previous_selector=""
  migration_route_count=0
  migration_route_facet=""
  migration_route_selector=""
  for selector in "${selectors[@]}"; do
    [[ "$selector" =~ ^0x[0-9a-f]{8}$ ]] || fail "malformed active selector $selector"
    if [[ -n "$previous_selector" && ! "$selector" > "$previous_selector" ]]; then
      fail "active selectors are not strictly ascending at $selector"
    fi
    previous_selector="$selector"

    route_json="$(call_json_at \
      "$block_number" \
      "$registry" \
      "facetSetRoute(bytes32,bytes4)(address,bytes32,uint8)" \
      "$active_hash" \
      "$selector")"
    facet_address="$(printf '%s' "$route_json" | jq -er '.[0]')"
    code_hash="$(printf '%s' "$route_json" | jq -er '.[1]')"
    kind="$(printf '%s' "$route_json" | jq -er '.[2]')"
    [[ "$facet_address" =~ ^0x[0-9a-fA-F]{40}$ ]] || fail "active route $selector facet is malformed"
    [[ "$(printf '%s' "$facet_address" | lower)" != \
      "0x0000000000000000000000000000000000000000" ]] \
      || fail "active route $selector has a zero facet"
    [[ "$(printf '%s' "$facet_address" | lower)" != "$(printf '%s' "$registry" | lower)" ]] \
      || fail "active route $selector targets the registry"
    [[ "$code_hash" =~ ^0x[0-9a-fA-F]{64}$ ]] || fail "active route $selector code hash is malformed"
    [[ "$(printf '%s' "$code_hash" | lower)" != \
      "0x0000000000000000000000000000000000000000000000000000000000000000" ]] \
      || fail "active route $selector has a zero code hash"
    [[ "$kind" == "0" || "$kind" == "1" || "$kind" == "2" ]] \
      || fail "active route $selector has invalid kind $kind"
    expect_equal \
      "active route $selector is not kernel-reserved" \
      "false" \
      "$(call_value_at "$block_number" "$registry" "isReservedKernelSelector(bytes4)(bool)" "$selector")"

    active_json="$(call_json_at \
      "$block_number" \
      "$registry" \
      "route(bytes4)(address,bytes32,uint8,uint64)" \
      "$selector")"
    expect_address_equal \
      "live route $selector facet" "$facet_address" "$(printf '%s' "$active_json" | jq -er '.[0]')"
    expect_hash_equal \
      "live route $selector code hash" "$code_hash" "$(printf '%s' "$active_json" | jq -er '.[1]')"
    expect_equal "live route $selector kind" "$kind" "$(printf '%s' "$active_json" | jq -er '.[2]')"
    expect_equal \
      "live route $selector storage version" \
      "$required_storage_version" \
      "$(printf '%s' "$active_json" | jq -er '.[3]')"
    expect_address_equal \
      "facetAddress loupe route $selector" \
      "$facet_address" \
      "$(call_value_at "$block_number" "$registry" "facetAddress(bytes4)(address)" "$selector")"

    facet_code="$(cast_retry cast code "$facet_address" --block "$block_number" --rpc-url "$RPC_URL")"
    [[ "$facet_code" != "0x" ]] || fail "active facet $facet_address has no code at pinned block $block_number"
    live_code_hash="$(cast keccak "$facet_code")"
    expect_hash_equal "active facet $facet_address runtime code hash" "$code_hash" "$live_code_hash"

    printf '%s|%s|%s|%s\n' \
      "$selector" \
      "$(printf '%s' "$facet_address" | lower)" \
      "$(printf '%s' "$code_hash" | lower)" \
      "$kind" >>"$routes_file"
    jq -cn \
      --arg selector "$selector" \
      --arg facet "$(printf '%s' "$facet_address" | lower)" \
      --arg code_hash "$(printf '%s' "$code_hash" | lower)" \
      --argjson kind "$kind" \
      '{selector: $selector, facet: $facet, codeHash: $code_hash, kind: $kind}' >>"$route_records"
    if [[ "$kind" == "2" ]]; then
      migration_route_count=$((migration_route_count + 1))
      migration_route_facet="$facet_address"
      migration_route_selector="$selector"
    fi
  done

  if [[ "$(printf '%s' "$migration_facet" | lower)" == \
    "0x0000000000000000000000000000000000000000" ]]; then
    [[ "$migration_route_count" == "0" ]] || fail "active Migration route lacks migration metadata"
  else
    [[ "$migration_route_count" == "1" ]] || fail "active migration metadata must identify exactly one route"
    expect_address_equal "active migration route facet" "$migration_facet" "$migration_route_facet"
    expect_equal \
      "active migration route selector" \
      "$(printf '%s' "$migration_selector" | lower)" \
      "$(printf '%s' "$migration_route_selector" | lower)"
  fi

  routes_array="$(
    awk -F'|' '
      BEGIN { printf "[" }
      {
        if (NR > 1) printf ","
        printf "(%s,%s,%s,%s)", $1, $2, $3, $4
      }
      END { print "]" }
    ' "$routes_file"
  )"
  routes_hash="$(encoded_hash "f((bytes4,address,bytes32,uint8)[])" "$routes_array")"
  type_hash="$(
    cast keccak \
      "ProtocolFacetSet(uint64 release,uint64 requiredStorageVersion,bytes32 predecessorFacetSetHash,bytes32 storageLayoutHash,bytes32 manifestHash,bytes32 routesHash,address migrationFacet,bytes4 migrationSelector)"
  )"
  expected_release_hash="$(
    encoded_hash \
      "f(bytes32,uint64,uint64,bytes32,bytes32,bytes32,bytes32,address,bytes4)" \
      "$type_hash" \
      "$release" \
      "$required_storage_version" \
      "$predecessor_hash" \
      "$storage_layout_hash" \
      "$manifest_hash" \
      "$routes_hash" \
      "$migration_facet" \
      "$migration_selector"
  )"
  expect_hash_equal "independently reconstructed live facet-set hash" "$expected_release_hash" "$active_hash"

  manifest_tuple="($release,$required_storage_version,$predecessor_hash,$storage_layout_hash,$manifest_hash,$routes_array,$migration_facet,$migration_selector)"
  registry_release_hash="$(call_value_at \
    "$block_number" \
    "$registry" \
    "computeFacetSetHash((uint64,uint64,bytes32,bytes32,bytes32,(bytes4,address,bytes32,uint8)[],address,bytes4))(bytes32)" \
    "$manifest_tuple")"
  expect_hash_equal "registry-computed live facet-set hash" "$active_hash" "$registry_release_hash"

  expected_facets_json="$(
    jq -sc '
      reduce .[] as $route ([];
        ($route.facet) as $facet
        | (map(.facetAddress) | index($facet)) as $index
        | if $index == null then
            . + [{facetAddress: $facet, functionSelectors: [$route.selector]}]
          else
            .[$index].functionSelectors += [$route.selector]
          end
      )
    ' "$route_records"
  )"
  expected_facet_addresses_json="$(printf '%s' "$expected_facets_json" | jq -c '[.[].facetAddress]')"
  actual_facet_addresses_json="$(
    call_json_at "$block_number" "$registry" "facetAddresses()(address[])" \
      | jq -ce '.[0] | map(ascii_downcase)'
  )"
  expect_json_equal \
    "live facetAddresses loupe inventory" \
    "$expected_facet_addresses_json" \
    "$actual_facet_addresses_json"

  actual_facets_json="$(
    call_json_at "$block_number" "$registry" "facets()((address,bytes4[])[])" \
      | jq -ce '
          .[0]
          | map({
              facetAddress: (.[0] | ascii_downcase),
              functionSelectors: (.[1] | map(ascii_downcase))
            })
        '
  )"
  expect_json_equal "live facets loupe inventory" "$expected_facets_json" "$actual_facets_json"

  while IFS= read -r expected_facet; do
    grouped_facet="$(printf '%s' "$expected_facet" | jq -er '.facetAddress')"
    expected_function_selectors="$(printf '%s' "$expected_facet" | jq -c '.functionSelectors')"
    actual_function_selectors="$(
      call_json_at \
        "$block_number" \
        "$registry" \
        "facetFunctionSelectors(address)(bytes4[])" \
        "$grouped_facet" \
        | jq -ce '.[0] | map(ascii_downcase)'
    )"
    expect_json_equal \
      "live facetFunctionSelectors inventory for $grouped_facet" \
      "$expected_function_selectors" \
      "$actual_function_selectors"
  done < <(printf '%s' "$expected_facets_json" | jq -c '.[]')

  if [[ "$selector_count" == "0" ]]; then
    expect_address_equal \
      "empty-release facetAddress" \
      "0x0000000000000000000000000000000000000000" \
      "$(call_value_at "$block_number" "$registry" "facetAddress(bytes4)(address)" "0x00000000")"
    empty_facet_selectors="$(
      call_json_at \
        "$block_number" \
        "$registry" \
        "facetFunctionSelectors(address)(bytes4[])" \
        "0x0000000000000000000000000000000000000000" \
        | jq -ce '.[0]'
    )"
    expect_json_equal "empty-release facetFunctionSelectors" "[]" "$empty_facet_selectors"
  fi

  if [[ "$REQUIRE_DEPLOYMENT" == "1" ]]; then
    expect_address_equal \
      "initial candidate live registry owner" \
      "$(field protocolFacetRegistryOwner)" \
      "$live_owner"
    expect_hash_equal "initial candidate active facet-set hash" "$(field activeFacetSetHash)" "$active_hash"
    expect_equal "initial candidate active release" "$(field activeRelease)" "$release"
    expect_equal \
      "initial candidate active storage version" "$(field requiredStorageVersion)" "$required_storage_version"
    expect_hash_equal \
      "initial candidate active storage layout" "$(field requiredStorageLayoutHash)" "$storage_layout_hash"
  fi

  final_block_hash="$(cast_retry cast block "$block_number" --field hash --rpc-url "$RPC_URL" | first_token)"
  expect_hash_equal "pinned live-release block hash after verification" "$block_hash" "$final_block_hash"
  echo "Verified live active Boardroom release $release at block $block_number ($block_hash)."

  trap - RETURN EXIT
  cleanup_live_release
}

verify_protocol_wiring() {
  local governance registry policy asset fee_router grants amm router locker distribution rewards bonds factory

  governance="$(field protocolGovernance)"
  registry="$(field protocolFacetRegistry)"
  policy="$(field boardroomPolicyRegistry)"
  asset="$(field assetPolicy)"
  fee_router="$(field protocolFeeRouter)"
  grants="$(field tokenGrantFactory)"
  amm="$(field ammFactory)"
  router="$(field ammRouter)"
  locker="$(field lockedLiquidityFactory)"
  distribution="$(field distributionFactory)"
  rewards="$(field boardroomRewardsFactory)"
  bonds="$(field bondMarketFactory)"
  factory="$(field boardroomFactory)"

  expect_address_equal \
    "ProtocolFacetRegistry genesis artifact owner" \
    "$governance" \
    "$(field protocolFacetRegistryOwner)"

  for owner_spec in \
    "BoardroomPolicyRegistry|$policy|boardroomPolicyRegistryOwner" \
    "AssetPolicy|$asset|assetPolicyOwner" \
    "ProtocolFeeRouter|$fee_router|protocolFeeRouterOwner" \
    "TokenGrantFactory|$grants|tokenGrantFactoryOwner" \
    "AmmFactory|$amm|ammFactoryOwner"; do
    IFS='|' read -r label address owner_field <<<"$owner_spec"
    expect_address_equal "$label artifact owner" "$governance" "$(field "$owner_field")"
    expect_address_equal "$label live owner" "$governance" "$(call_value "$address" "owner()(address)")"
  done

  expect_address_equal \
    "BoardroomFactory policy registry" "$policy" "$(call_value "$factory" "policyRegistry()(address)")"
  expect_address_equal \
    "BoardroomFactory wrapped native" "$(field wrappedNative)" "$(call_value "$factory" "wrappedNative()(address)")"
  expect_address_equal \
    "BoardroomFactory redemption payout" \
    "$(field boardroomRedemptionPayout)" \
    "$(call_value "$factory" "redemptionPayoutLogic()(address)")"
  expect_address_equal \
    "BoardroomFactory governance helper" \
    "$(field boardroomGovernanceLogic)" \
    "$(call_value "$factory" "governanceLogic()(address)")"
  expect_address_equal \
    "BoardroomFactory market helper" \
    "$(field boardroomMarketLogic)" \
    "$(call_value "$factory" "marketLogic()(address)")"
  expect_address_equal \
    "BoardroomFactory controller factory" \
    "$(field boardroomControllerFactory)" \
    "$(call_value "$factory" "controllerFactory()(address)")"
  expect_address_equal \
    "BoardroomControllerFactory BoardroomFactory" \
    "$factory" \
    "$(call_value "$(field boardroomControllerFactory)" "boardroomFactory()(address)")"
  expect_address_equal \
    "BoardroomControllerFactory implementation" \
    "$(field boardroomControllerLogic)" \
    "$(call_value "$(field boardroomControllerFactory)" "controllerImplementation()(address)")"

  expect_address_equal \
    "ProtocolFeeRouter recipient" "$(field protocolTreasury)" "$(call_value "$fee_router" "feeRecipient()(address)")"
  expect_address_equal \
    "TokenGrantFactory fee recipient" "$fee_router" "$(call_value "$grants" "feeRecipient()(address)")"
  expect_equal "TokenGrantFactory creation fee" "$(field creationFee)" "$(call_value "$grants" "creationFee()(uint256)")"
  expect_address_equal \
    "TokenGrantFactory BoardroomFactory" "$factory" "$(call_value "$grants" "boardroomFactory()(address)")"
  expect_address_equal "AmmFactory fee manager" "$(field ammFeeManager)" "$(call_value "$amm" "feeManager()(address)")"
  expect_address_equal \
    "AmmFactory protocol fee recipient" "$fee_router" "$(call_value "$amm" "protocolFeeRecipient()(address)")"
  expect_address_equal "AmmFactory router" "$router" "$(call_value "$amm" "liquidityRouter()(address)")"
  expect_address_equal "AmmFactory reservation manager" "$locker" "$(call_value "$amm" "reservationManager()(address)")"
  expect_address_equal "AmmFactory BoardroomFactory" "$factory" "$(call_value "$amm" "boardroomFactory()(address)")"
  expect_address_equal "AmmRouter factory" "$amm" "$(call_value "$router" "factory()(address)")"
  expect_address_equal \
    "AmmRouter wrapped native" "$(field wrappedNative)" "$(call_value "$router" "wrappedNative()(address)")"
  expect_address_equal "LockedLiquidityFactory router" "$router" "$(call_value "$locker" "ammRouter()(address)")"
  expect_address_equal \
    "LockedLiquidityFactory BoardroomFactory" "$factory" "$(call_value "$locker" "boardroomFactory()(address)")"
  expect_address_equal \
    "DistributionFactory locker" "$locker" "$(call_value "$distribution" "lockedLiquidityFactory()(address)")"
  expect_address_equal \
    "DistributionFactory grants" "$grants" "$(call_value "$distribution" "tokenGrantFactory()(address)")"
  expect_address_equal \
    "DistributionFactory BoardroomFactory" "$factory" "$(call_value "$distribution" "boardroomFactory()(address)")"
  expect_address_equal \
    "BoardroomRewardsFactory BoardroomFactory" "$factory" "$(call_value "$rewards" "boardroomFactory()(address)")"
  expect_address_equal "BondMarketFactory AmmFactory" "$amm" "$(call_value "$bonds" "ammFactory()(address)")"
  expect_address_equal \
    "BondMarketFactory BoardroomFactory" "$factory" "$(call_value "$bonds" "boardroomFactory()(address)")"

  expect_equal "AssetPolicy wrapped native" "true" \
    "$(call_value "$asset" "isAssetAllowed(address)(bool)" "$(field wrappedNative)")"
  expect_equal "AssetPolicy registry allowance" "true" \
    "$(call_value "$policy" "isPolicyAllowed(address)(bool)" "$asset")"
  for module in "$grants" "$distribution" "$bonds" "$locker" "$rewards"; do
    expect_equal "module policy identity $module" "true" \
      "$(call_value "$policy" "isModulePolicy(address)(bool)" "$module")"
    expect_equal "module policy allowance $module" "true" \
      "$(call_value "$policy" "isPolicyAllowed(address)(bool)" "$module")"
    expect_equal "module approval allowance $module" "true" \
      "$(call_value "$asset" "isApprovalSpenderAllowed(address)(bool)" "$module")"
  done
}

[[ -f "$ARTIFACT" ]] || fail "missing artifact $ARTIFACT"

if [[ "$(field status)" == "pending" ]]; then
  if [[ "$REQUIRE_DEPLOYMENT" == "1" ]]; then
    fail "deployment artifact is still marked pending"
  fi
  echo "Skipping artifact verification: $ARTIFACT is marked pending"
  exit 0
fi

for required in \
  chainId sourceCommit protocolVersion deterministicDeployment deterministicDeploymentVersion \
  deterministicReleaseCodeHash deployer create2Factory deterministicDeployer deterministicDeployerOwner \
  protocolGovernance protocolTreasury ammFeeManager wrappedNative \
  protocolFacetRegistry boardroomKernel boardroomPolicyRegistry boardroomFactory \
  boardroomControllerFactory boardroomControllerLogic boardroomGovernanceLogic boardroomRedemptionPayout \
  boardroomMarketLogic authorityFacet executionFacet marketFacet redemptionFacet viewFacet \
  activeFacetSetHash activeRelease requiredStorageVersion requiredStorageLayoutHash manifestHash \
  kernelSelectorSetHash selectorCount \
  assetPolicy protocolFeeRouter tokenGrantFactory tokenGrantLogic ammFactory ammPoolImplementation ammRouter \
  lockedLiquidityFactory lockedLiquidityLogic distributionFactory fixedPriceSaleLogic dutchAuctionLogic \
  migratingBondingCurveLogic merkleAirdropLogic boardroomRewardsFactory boardroomRewardsLogic \
  bondMarketFactory bondMarketLogic \
  protocolFacetRegistryOwner boardroomPolicyRegistryOwner assetPolicyOwner protocolFeeRouterOwner \
  tokenGrantFactoryOwner ammFactoryOwner protocolFeeRouterRecipient tokenGrantFeeRecipient \
  ammProtocolFeeRecipient ammLiquidityRouter ammReservationManager creationFee \
  deterministicDeployerCodeHash protocolFacetRegistryCodeHash boardroomKernelCodeHash \
  boardroomPolicyRegistryCodeHash boardroomFactoryCodeHash boardroomControllerFactoryCodeHash \
  boardroomControllerLogicCodeHash boardroomGovernanceLogicCodeHash boardroomRedemptionPayoutCodeHash \
  boardroomMarketLogicCodeHash authorityFacetCodeHash executionFacetCodeHash marketFacetCodeHash \
  redemptionFacetCodeHash viewFacetCodeHash assetPolicyCodeHash protocolFeeRouterCodeHash \
  tokenGrantFactoryCodeHash tokenGrantLogicCodeHash ammFactoryCodeHash ammPoolImplementationCodeHash \
  ammRouterCodeHash lockedLiquidityFactoryCodeHash lockedLiquidityLogicCodeHash distributionFactoryCodeHash \
  fixedPriceSaleLogicCodeHash dutchAuctionLogicCodeHash migratingBondingCurveLogicCodeHash \
  merkleAirdropLogicCodeHash boardroomRewardsFactoryCodeHash boardroomRewardsLogicCodeHash \
  bondMarketFactoryCodeHash bondMarketLogicCodeHash wrappedNativeCodeHash \
  deploymentBlock deploymentTimestamp; do
  require_field "$required"
done

expect_equal "protocol version" "pledge.cash.protocol.v1" "$(field protocolVersion)"
expect_equal "deterministic deployment version" "pledge.cash.protocol.v1" "$(field deterministicDeploymentVersion)"
expect_equal "deterministic deployment flag" "true" "$(field deterministicDeployment)"

chain_id="$(cast_retry cast chain-id --rpc-url "$RPC_URL" | first_token)"
expect_equal "chain id" "$(field chainId)" "$chain_id"

source_commit="$(field sourceCommit)"
[[ "$source_commit" =~ ^[0-9a-f]{40}$ ]] || fail "sourceCommit must be an exact lowercase Git commit"
git cat-file -e "${source_commit}^{commit}" 2>/dev/null || fail "source commit $source_commit is not present locally"
git diff --quiet "$source_commit" -- src script/Deploy.s.sol \
  || fail "canonical deployment sources differ from recorded source commit $source_commit"

deployment_block="$(field deploymentBlock)"
[[ "$deployment_block" =~ ^[0-9]+$ ]] || fail "deploymentBlock must be an unsigned decimal integer"
chain_head="$(cast_retry cast block-number --rpc-url "$RPC_URL" | first_token)"
[[ "$deployment_block" -le "$chain_head" ]] || fail "deploymentBlock is ahead of chain head"
verify_receipt_manifest "$deployment_block" "$source_commit"

expect_hash_equal \
  "locally reproduced deterministic release code hash" \
  "$(local_release_code_hash)" \
  "$(field deterministicReleaseCodeHash)"
verify_release_provenance

for code_spec in \
  "Wrapped native|wrappedNative|wrappedNativeCodeHash" \
  "BoardroomControllerFactory|boardroomControllerFactory|boardroomControllerFactoryCodeHash" \
  "BoardroomController implementation|boardroomControllerLogic|boardroomControllerLogicCodeHash" \
  "TokenGrant implementation|tokenGrantLogic|tokenGrantLogicCodeHash" \
  "AMM pool implementation|ammPoolImplementation|ammPoolImplementationCodeHash" \
  "LockedLiquidity implementation|lockedLiquidityLogic|lockedLiquidityLogicCodeHash" \
  "FixedPriceSale implementation|fixedPriceSaleLogic|fixedPriceSaleLogicCodeHash" \
  "DutchAuctionSale implementation|dutchAuctionLogic|dutchAuctionLogicCodeHash" \
  "MigratingBondingCurve implementation|migratingBondingCurveLogic|migratingBondingCurveLogicCodeHash" \
  "MerkleAirdrop implementation|merkleAirdropLogic|merkleAirdropLogicCodeHash" \
  "BoardroomRewards implementation|boardroomRewardsLogic|boardroomRewardsLogicCodeHash" \
  "BondMarket implementation|bondMarketLogic|bondMarketLogicCodeHash"; do
  IFS='|' read -r label address_field hash_field <<<"$code_spec"
  require_code_hash "$label" "$(field "$address_field")" "$hash_field"
done

verify_genesis_release_manifest
verify_live_active_release
verify_protocol_wiring

if [[ "$REQUIRE_DEPLOYMENT" == "1" ]]; then
  echo "Verified canonical pledge.cash genesis candidate in $ARTIFACT"
else
  echo "Verified canonical pledge.cash protocol artifact and live Boardroom release from $ARTIFACT"
fi

