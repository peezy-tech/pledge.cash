#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

readonly CONTRACTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly REPO_DIR="$(cd "$CONTRACTS_DIR/../.." && pwd)"
readonly MANIFEST="$CONTRACTS_DIR/config/networks.json"
readonly PROTOCOL_VERSION="pledge.cash.protocol.v1"

fail() {
  echo "Deployment artifact verification failed: $*" >&2
  exit 1
}

for command in bun cast forge git jq; do
  command -v "$command" >/dev/null || fail "missing required command: $command"
done

cd "$CONTRACTS_DIR"
bun script/network-profiles.ts >/dev/null

artifact="${ARTIFACT:-}"
[[ -n "$artifact" ]] || fail "set ARTIFACT"
[[ -f "$artifact" ]] || fail "missing artifact $artifact"

artifact_chain_id="$(jq -er '.chainId | select(type == "number" and . > 0 and floor == .)' "$artifact")" \
  || fail "artifact chainId must be a positive integer"
profile_chain_id="${PROFILE_CHAIN_ID:-$artifact_chain_id}"
[[ "$profile_chain_id" =~ ^[0-9]+$ ]] || fail "PROFILE_CHAIN_ID must be decimal"
profile="$(jq -cer --argjson chainId "$profile_chain_id" '.profiles[] | select(.chainId == $chainId)' "$MANIFEST")" \
  || fail "profile chain $profile_chain_id is outside the approved support policy"

if jq -e '.status == "pending"' "$artifact" >/dev/null; then
  [[ "${REQUIRE_DEPLOYMENT:-0}" != "1" ]] || fail "deployment proof requires a live artifact, not pending status"
  jq -e --argjson chainId "$artifact_chain_id" --arg version "$PROTOCOL_VERSION" '
    (keys | sort) == (["chainId", "protocolVersion", "reason", "status"] | sort)
    and .chainId == $chainId
    and .status == "pending"
    and .protocolVersion == $version
    and (.reason | type == "string" and length > 0)
  ' "$artifact" >/dev/null || fail "pending artifact schema is invalid"
  echo "Verified pending pledge.cash status for profile chain $profile_chain_id."
  exit 0
fi

readonly -a live_fields=(
  boardroomArchitectureCodeHash boardroomFactory boardroomFactoryCodeHash
  boardroomImplementation boardroomImplementationCodeHash chainId create2Factory creationFee
  deployer deploymentBlock deterministicDeployer deterministicDeployerCodeHash
  deterministicDeployerOwner deterministicDeployment deterministicDeploymentVersion
  deterministicReleaseCodeHash liquidityLockerFactory liquidityLockerFactoryCodeHash manifestHash
  moduleArchitectureCodeHash permit2 permit2CodeHash protocolFeeRouter protocolFeeRouterCodeHash
  protocolFeeRouterOwner protocolFeeRouterRecipient protocolReleaseCodeHash protocolTreasury
  protocolVersion sourceCommit tokenGrantFactory tokenGrantFactoryCodeHash tokenGrantFactoryOwner
  tokenGrantFeeRecipient tokenGrantLogic tokenGrantLogicCodeHash uniswapUniversalRouter
  uniswapUniversalRouterCodeHash uniswapV4PoolManager uniswapV4PoolManagerCodeHash
  uniswapV4PositionManager uniswapV4PositionManagerCodeHash uniswapV4Quoter
  uniswapV4QuoterCodeHash uniswapV4StateView uniswapV4StateViewCodeHash wrappedNative
  wrappedNativeCodeHash
)

required_fields_json="$(printf '%s\n' "${live_fields[@]}" | jq -R . | jq -s .)"
jq -e --argjson fields "$required_fields_json" '
  (keys | sort) == ($fields | sort)
  and (.chainId | type == "number" and . > 0 and floor == .)
  and .deterministicDeployment == true
  and (.creationFee | type == "number" and . >= 0 and floor == .)
  and (.deploymentBlock | type == "number" and . > 0 and floor == .)
  and all(to_entries[] | select(.key | endswith("CodeHash") or . == "manifestHash");
    .value | type == "string" and test("^0x[0-9a-fA-F]{64}$"))
  and all(to_entries[] | select(
    (.key | endswith("Factory"))
    or (.key | endswith("Implementation"))
    or (.key | endswith("Owner"))
    or (.key | endswith("Recipient"))
    or (.key | IN(
      "create2Factory", "deployer", "deterministicDeployer", "permit2", "protocolFeeRouter",
      "protocolTreasury", "tokenGrantLogic", "uniswapUniversalRouter", "uniswapV4PoolManager",
      "uniswapV4PositionManager", "uniswapV4Quoter", "uniswapV4StateView", "wrappedNative"
    ))
  ); .value | type == "string" and test("^0x[0-9a-fA-F]{40}$"))
' "$artifact" >/dev/null || fail "live artifact has missing, stale, or malformed fields"

field() {
  jq -er --arg field "$1" '.[$field]' "$artifact"
}

assert_address() {
  local label="$1" expected="$2" actual="$3"
  [[ "${expected,,}" == "${actual,,}" ]] || fail "$label mismatch: expected $expected, got $actual"
}

assert_hash() {
  local label="$1" expected="$2" actual="$3"
  [[ "${expected,,}" == "${actual,,}" ]] || fail "$label mismatch: expected $expected, got $actual"
}

rpc_url="${RPC_URL:-}"
[[ -n "$rpc_url" ]] || fail "set RPC_URL for a live artifact"
rpc_chain_id="$(cast chain-id --rpc-url "$rpc_url")" || fail "could not read RPC chain id"
[[ "$rpc_chain_id" == "$artifact_chain_id" ]] \
  || fail "RPC chain $rpc_chain_id does not match artifact chain $artifact_chain_id"

[[ "$(field protocolVersion)" == "$PROTOCOL_VERSION" ]] || fail "protocolVersion mismatch"
[[ "$(field deterministicDeploymentVersion)" == "$PROTOCOL_VERSION" ]] \
  || fail "deterministicDeploymentVersion mismatch"
source_commit="$(field sourceCommit)"
[[ "$source_commit" =~ ^[0-9a-f]{40}$ ]] || fail "sourceCommit must be an exact lowercase Git commit"
[[ "$source_commit" == "$(git -C "$REPO_DIR" rev-parse HEAD)" ]] \
  || fail "artifact sourceCommit does not match local HEAD"

profile_address() {
  jq -r "$1.address" <<<"$profile"
}

profile_hash() {
  jq -r "$1.codeHash" <<<"$profile"
}

while IFS='|' read -r label artifact_address_field artifact_hash_field profile_path; do
  expected_address="$(profile_address "$profile_path")"
  expected_hash="$(profile_hash "$profile_path")"
  assert_address "$label address" "$expected_address" "$(field "$artifact_address_field")"
  assert_hash "$label profile hash" "$expected_hash" "$(field "$artifact_hash_field")"
done <<'PROFILE_FIELDS'
wrapped native|wrappedNative|wrappedNativeCodeHash|.wrappedNative
PoolManager|uniswapV4PoolManager|uniswapV4PoolManagerCodeHash|.uniswap.poolManager
Universal Router|uniswapUniversalRouter|uniswapUniversalRouterCodeHash|.uniswap.universalRouter
Quoter|uniswapV4Quoter|uniswapV4QuoterCodeHash|.uniswap.quoter
StateView|uniswapV4StateView|uniswapV4StateViewCodeHash|.uniswap.stateView
PositionManager|uniswapV4PositionManager|uniswapV4PositionManagerCodeHash|.uniswap.positionManager
Permit2|permit2|permit2CodeHash|.uniswap.permit2
PROFILE_FIELDS

assert_hash "CREATE2 factory live hash" "$(profile_hash '.create2Factory')" \
  "$(cast keccak "$(cast code "$(field create2Factory)" --rpc-url "$rpc_url")")"

verify_code_hash() {
  local label="$1" address="$2" expected_hash="$3"
  local code actual_hash
  code="$(cast code "$address" --rpc-url "$rpc_url")" || fail "could not read $label code"
  [[ "$code" != "0x" ]] || fail "$label has no code at $address"
  actual_hash="$(cast keccak "$code")"
  assert_hash "$label live code hash" "$expected_hash" "$actual_hash"
}

verify_code_hash "deterministic deployer" "$(field deterministicDeployer)" "$(field deterministicDeployerCodeHash)"
verify_code_hash "BoardroomFactory" "$(field boardroomFactory)" "$(field boardroomFactoryCodeHash)"
verify_code_hash "Boardroom implementation" "$(field boardroomImplementation)" "$(field boardroomImplementationCodeHash)"
verify_code_hash "ProtocolFeeRouter" "$(field protocolFeeRouter)" "$(field protocolFeeRouterCodeHash)"
verify_code_hash "TokenGrantFactory" "$(field tokenGrantFactory)" "$(field tokenGrantFactoryCodeHash)"
verify_code_hash "TokenGrant logic" "$(field tokenGrantLogic)" "$(field tokenGrantLogicCodeHash)"
verify_code_hash "LiquidityLockerFactory" "$(field liquidityLockerFactory)" "$(field liquidityLockerFactoryCodeHash)"
verify_code_hash "wrapped native" "$(field wrappedNative)" "$(field wrappedNativeCodeHash)"
verify_code_hash "PoolManager" "$(field uniswapV4PoolManager)" "$(field uniswapV4PoolManagerCodeHash)"
verify_code_hash "Universal Router" "$(field uniswapUniversalRouter)" "$(field uniswapUniversalRouterCodeHash)"
verify_code_hash "Quoter" "$(field uniswapV4Quoter)" "$(field uniswapV4QuoterCodeHash)"
verify_code_hash "StateView" "$(field uniswapV4StateView)" "$(field uniswapV4StateViewCodeHash)"
verify_code_hash "PositionManager" "$(field uniswapV4PositionManager)" "$(field uniswapV4PositionManagerCodeHash)"
verify_code_hash "Permit2" "$(field permit2)" "$(field permit2CodeHash)"

call_value() {
  cast call "$1" "$2" "${@:3}" --rpc-url "$rpc_url"
}

assert_address "deterministic deployer owner" "$(field deterministicDeployerOwner)" \
  "$(call_value "$(field deterministicDeployer)" 'owner()(address)')"
assert_address "BoardroomFactory wrapped native" "$(field wrappedNative)" \
  "$(call_value "$(field boardroomFactory)" 'wrappedNative()(address)')"
assert_address "Boardroom implementation" "$(field boardroomImplementation)" \
  "$(call_value "$(field boardroomFactory)" 'boardroomImplementation()(address)')"
assert_address "ProtocolFeeRouter owner" "$(field protocolFeeRouterOwner)" \
  "$(call_value "$(field protocolFeeRouter)" 'owner()(address)')"
assert_address "ProtocolFeeRouter recipient" "$(field protocolFeeRouterRecipient)" \
  "$(call_value "$(field protocolFeeRouter)" 'feeRecipient()(address)')"
assert_address "TokenGrantFactory owner" "$(field tokenGrantFactoryOwner)" \
  "$(call_value "$(field tokenGrantFactory)" 'owner()(address)')"
assert_address "TokenGrantFactory BoardroomFactory" "$(field boardroomFactory)" \
  "$(call_value "$(field tokenGrantFactory)" 'boardroomFactory()(address)')"
assert_address "TokenGrant logic" "$(field tokenGrantLogic)" \
  "$(call_value "$(field tokenGrantFactory)" 'tokenGrantLogic()(address)')"
assert_address "TokenGrant fee recipient" "$(field tokenGrantFeeRecipient)" \
  "$(call_value "$(field tokenGrantFactory)" 'feeRecipient()(address)')"
[[ "$(field creationFee)" == "$(call_value "$(field tokenGrantFactory)" 'creationFee()(uint256)')" ]] \
  || fail "TokenGrant creation fee mismatch"
assert_address "LiquidityLockerFactory BoardroomFactory" "$(field boardroomFactory)" \
  "$(call_value "$(field liquidityLockerFactory)" 'boardroomFactory()(address)')"
assert_address "LiquidityLockerFactory PositionManager" "$(field uniswapV4PositionManager)" \
  "$(call_value "$(field liquidityLockerFactory)" 'positionManager()(address)')"
assert_address "LiquidityLockerFactory fee router" "$(field protocolFeeRouter)" \
  "$(call_value "$(field liquidityLockerFactory)" 'protocolFeeRouter()(address)')"
assert_address "protocol owner agreement" "$(field tokenGrantFactoryOwner)" "$(field protocolFeeRouterOwner)"
assert_address "protocol treasury agreement" "$(field protocolTreasury)" "$(field protocolFeeRouterRecipient)"
assert_address "grant fee routing" "$(field protocolFeeRouter)" "$(field tokenGrantFeeRecipient)"

creation_code() {
  forge inspect "$1" bytecode
}

creation_hash() {
  cast keccak "$(creation_code "$1")"
}

release_salt() {
  local name="$1" code_hash="$2"
  cast keccak "$(cast abi-encode 'f(string,string,bytes32)' "$PROTOCOL_VERSION" "$name" "$code_hash")"
}

init_code() {
  local contract="$1" constructor_signature="$2"
  shift 2
  local bytecode arguments
  bytecode="$(creation_code "$contract")"
  arguments="$(cast abi-encode "$constructor_signature" "$@")"
  printf '0x%s%s\n' "${bytecode#0x}" "${arguments#0x}"
}

assert_root() {
  local name="$1" contract="$2" artifact_field="$3" constructor_signature="$4"
  shift 4
  local code_hash salt encoded_init init_hash predicted committed_hash
  code_hash="$(creation_hash "$contract")"
  salt="$(release_salt "$name" "$code_hash")"
  encoded_init="$(init_code "$contract" "$constructor_signature" "$@")"
  init_hash="$(cast keccak "$encoded_init")"
  predicted="$(call_value "$(field deterministicDeployer)" 'predict(bytes32)(address)' "$salt")"
  assert_address "$name deterministic address" "$(field "$artifact_field")" "$predicted"
  committed_hash="$(call_value "$(field deterministicDeployer)" 'initCodeHashForSalt(bytes32)(bytes32)' "$salt")"
  assert_hash "$name init-code commitment" "$init_hash" "$committed_hash"
}

deterministic_creation_hash="$(creation_hash 'src/deployment/PledgeCashDeterministicDeployer.sol:PledgeCashDeterministicDeployer')"
deterministic_salt="$(release_salt PledgeCashDeterministicDeployer "$deterministic_creation_hash")"
deterministic_init="$(init_code 'src/deployment/PledgeCashDeterministicDeployer.sol:PledgeCashDeterministicDeployer' \
  'constructor(address)' "$(field deterministicDeployerOwner)")"
expected_deterministic_deployer="$(cast create2 --deployer "$(field create2Factory)" \
  --salt "$deterministic_salt" --init-code-hash "$(cast keccak "$deterministic_init")")"
assert_address "CREATE2 deterministic deployer" "$(field deterministicDeployer)" "$expected_deterministic_deployer"

assert_root BoardroomFactory 'src/boardroom/BoardroomFactory.sol:BoardroomFactory' boardroomFactory \
  'constructor(address)' "$(field wrappedNative)"
assert_root ProtocolFeeRouter 'src/fees/ProtocolFeeRouter.sol:ProtocolFeeRouter' protocolFeeRouter \
  'constructor(address,address)' "$(field deployer)" "$(field protocolTreasury)"
assert_root TokenGrantFactory 'src/grants/TokenGrantFactory.sol:TokenGrantFactory' tokenGrantFactory \
  'constructor(address,address)' "$(field deployer)" "$(field boardroomFactory)"
assert_root LiquidityLockerFactory 'src/uniswap/LiquidityLockerFactory.sol:LiquidityLockerFactory' \
  liquidityLockerFactory 'constructor(address,address,address)' "$(field boardroomFactory)" \
  "$(field uniswapV4PositionManager)" "$(field protocolFeeRouter)"

boardroom_architecture_hash="$(cast keccak "$(cast abi-encode 'f(bytes32,bytes32,bytes32)' \
  "$(creation_hash 'src/boardroom/Boardroom.sol:Boardroom')" \
  "$(creation_hash 'src/boardroom/BoardroomFactory.sol:BoardroomFactory')" \
  "$(creation_hash 'src/boardroom/BoardroomToken.sol:BoardroomToken')")")"
module_architecture_hash="$(cast keccak "$(cast abi-encode 'f(bytes32,bytes32,bytes32,bytes32)' \
  "$(creation_hash 'src/fees/ProtocolFeeRouter.sol:ProtocolFeeRouter')" \
  "$(creation_hash 'src/grants/TokenGrantFactory.sol:TokenGrantFactory')" \
  "$(creation_hash 'src/uniswap/LiquidityLockerFactory.sol:LiquidityLockerFactory')" \
  "$(creation_hash 'src/uniswap/LiquidityLocker.sol:LiquidityLocker')")")"
release_code_hash="$(cast keccak "$(cast abi-encode 'f(bytes32,bytes32,bytes32)' \
  "$deterministic_creation_hash" "$boardroom_architecture_hash" "$module_architecture_hash")")"
assert_hash "Boardroom architecture" "$boardroom_architecture_hash" "$(field boardroomArchitectureCodeHash)"
assert_hash "module architecture" "$module_architecture_hash" "$(field moduleArchitectureCodeHash)"
assert_hash "protocol release" "$release_code_hash" "$(field protocolReleaseCodeHash)"
assert_hash "deterministic release" "$release_code_hash" "$(field deterministicReleaseCodeHash)"

external_hash="$(cast keccak "$(cast abi-encode 'f(address,address,address,address,address,address,address,address)' \
  "$(field create2Factory)" "$(field wrappedNative)" "$(field uniswapV4PoolManager)" \
  "$(field uniswapUniversalRouter)" "$(field uniswapV4Quoter)" "$(field uniswapV4StateView)" \
  "$(field uniswapV4PositionManager)" "$(field permit2)")")"
roots_hash="$(cast keccak "$(cast abi-encode 'f(address,address,address,address,address)' \
  "$(field deterministicDeployer)" "$(field boardroomFactory)" "$(field protocolFeeRouter)" \
  "$(field tokenGrantFactory)" "$(field liquidityLockerFactory)")")"
authority_hash="$(cast keccak "$(cast abi-encode 'f(address,address,address,uint256)' \
  "$(field deterministicDeployerOwner)" "$(field protocolFeeRouterOwner)" \
  "$(field protocolTreasury)" "$(field creationFee)")")"
manifest_hash="$(cast keccak "$(cast abi-encode 'f(bytes32,uint256,bytes32,bytes32,bytes32)' \
  "$release_code_hash" "$artifact_chain_id" "$external_hash" "$roots_hash" "$authority_hash")")"
assert_hash "manifest" "$manifest_hash" "$(field manifestHash)"

head_block="$(cast block-number --rpc-url "$rpc_url")"
[[ "$(field deploymentBlock)" -le "$head_block" ]] || fail "deploymentBlock is ahead of the RPC head"

if [[ "${REQUIRE_DEPLOYMENT:-0}" == "1" ]]; then
  receipts="${RECEIPTS:-}"
  [[ -n "$receipts" && -f "$receipts" ]] || fail "set RECEIPTS to finalized receipt evidence"
  jq -e --argjson chainId "$artifact_chain_id" --arg sourceCommit "$source_commit" '
    (keys | sort) == (["chainId", "schemaVersion", "sourceCommit", "transactions"] | sort)
    and .schemaVersion == 2
    and .chainId == $chainId
    and .sourceCommit == $sourceCommit
    and (.transactions | type == "array" and length > 0)
    and all(.transactions[];
      (.transactionHash | type == "string" and test("^0x[0-9a-fA-F]{64}$"))
      and (.blockNumber | type == "string" and test("^0x[0-9a-fA-F]+$"))
      and (.status | ascii_downcase == "0x1")
      and (.gasUsed | type == "string" and test("^0x[0-9a-fA-F]+$"))
      and (.from | type == "string" and test("^0x[0-9a-fA-F]{40}$"))
      and (.inputHash | type == "string" and test("^0x[0-9a-fA-F]{64}$"))
      and (.value | type == "string" and test("^0x[0-9a-fA-F]+$"))
    )
  ' "$receipts" >/dev/null || fail "receipt evidence schema is invalid"

  while IFS= read -r transaction_hash; do
    live_receipt="$(cast receipt "$transaction_hash" --rpc-url "$rpc_url" --json)" \
      || fail "missing live receipt $transaction_hash"
    jq -e '(.status == "0x1") or (.status == 1)' <<<"$live_receipt" >/dev/null \
      || fail "transaction $transaction_hash did not succeed"
  done < <(jq -r '.transactions[].transactionHash' "$receipts")
fi

echo "Verified lean pledge.cash deployment artifact for chain $artifact_chain_id against profile $profile_chain_id."
