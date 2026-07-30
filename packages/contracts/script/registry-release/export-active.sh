#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

fail() {
  echo "Protocol facet inventory export refused: $*" >&2
  exit 1
}

usage() {
  cat >&2 <<'USAGE'
usage: export-active.sh <verify|export>

Required environment:
  RPC_URL
  EXPECTED_CHAIN_ID
  PROTOCOL_FACET_REGISTRY
  EXPECTED_REGISTRY_CODE_HASH
  EXPECTED_REGISTRY_OWNER
  EXPECTED_ACTIVE_FACET_SET_HASH

The verify action writes canonical live inventory JSON to stdout. The export
action additionally requires RELEASE_INVENTORY_OUTPUT, resolved relative to
packages/contracts and restricted to deployments/releases/.
USAGE
  exit 64
}

[[ "$#" -eq 1 ]] || usage
ACTION="$1"
[[ "$ACTION" == "verify" || "$ACTION" == "export" ]] || usage

for command in cast jq realpath; do
  command -v "$command" >/dev/null || fail "missing required command: $command"
done

: "${RPC_URL:?Set RPC_URL}"
: "${EXPECTED_CHAIN_ID:?Set EXPECTED_CHAIN_ID}"
: "${PROTOCOL_FACET_REGISTRY:?Set PROTOCOL_FACET_REGISTRY}"
: "${EXPECTED_REGISTRY_CODE_HASH:?Set EXPECTED_REGISTRY_CODE_HASH}"
: "${EXPECTED_REGISTRY_OWNER:?Set EXPECTED_REGISTRY_OWNER}"
: "${EXPECTED_ACTIVE_FACET_SET_HASH:?Set EXPECTED_ACTIVE_FACET_SET_HASH}"

[[ "$EXPECTED_CHAIN_ID" =~ ^[0-9]+$ ]] || fail "EXPECTED_CHAIN_ID must be decimal"
[[ "$PROTOCOL_FACET_REGISTRY" =~ ^0x[0-9a-fA-F]{40}$ ]] \
  || fail "PROTOCOL_FACET_REGISTRY must be an address"
[[ "$EXPECTED_REGISTRY_OWNER" =~ ^0x[0-9a-fA-F]{40}$ ]] \
  || fail "EXPECTED_REGISTRY_OWNER must be an address"
[[ "${EXPECTED_REGISTRY_OWNER,,}" != "0x0000000000000000000000000000000000000000" ]] \
  || fail "EXPECTED_REGISTRY_OWNER must be nonzero"
for value_name in EXPECTED_REGISTRY_CODE_HASH EXPECTED_ACTIVE_FACET_SET_HASH; do
  value="${!value_name}"
  [[ "$value" =~ ^0x[0-9a-fA-F]{64}$ ]] || fail "$value_name must be bytes32"
  [[ "${value,,}" != "0x$(printf '00%.0s' {1..32})" ]] || fail "$value_name must be nonzero"
done

normalize_hex() {
  tr "[:upper:]" "[:lower:]" <<<"$1"
}

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf "%s" "$value"
}

expect_equal() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  if [[ "$(normalize_hex "$actual")" != "$(normalize_hex "$expected")" ]]; then
    fail "$label mismatch: expected $expected, received $actual"
  fi
}

expect_json_equal() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  if [[ "$actual" != "$expected" ]]; then
    fail "$label mismatch: expected $expected, received $actual"
  fi
}

actual_chain_id="$(cast chain-id --rpc-url "$RPC_URL")"
[[ "$actual_chain_id" == "$EXPECTED_CHAIN_ID" ]] \
  || fail "RPC chain mismatch: expected $EXPECTED_CHAIN_ID, received $actual_chain_id"

block_number="$(cast block-number --rpc-url "$RPC_URL")"
block_hash="$(cast block "$block_number" --field hash --rpc-url "$RPC_URL")"
[[ "$block_hash" =~ ^0x[0-9a-fA-F]{64}$ ]] || fail "RPC returned a malformed block hash"

rpc_call() {
  cast call "$PROTOCOL_FACET_REGISTRY" "$@" --block "$block_number" --rpc-url "$RPC_URL"
}

rpc_call_json() {
  cast call "$PROTOCOL_FACET_REGISTRY" "$@" --block "$block_number" --json --rpc-url "$RPC_URL"
}

registry_code="$(cast code "$PROTOCOL_FACET_REGISTRY" --block "$block_number" --rpc-url "$RPC_URL")"
[[ "$registry_code" != "0x" ]] || fail "registry has no code"
actual_registry_code_hash="$(cast keccak "$registry_code")"
expect_equal "registry runtime code hash" "$EXPECTED_REGISTRY_CODE_HASH" "$actual_registry_code_hash"
actual_owner="$(rpc_call "owner()(address)")"
expect_equal "registry owner" "$EXPECTED_REGISTRY_OWNER" "$actual_owner"
actual_active_hash="$(rpc_call "activeFacetSetHash()(bytes32)")"
expect_equal "active facet-set hash" "$EXPECTED_ACTIVE_FACET_SET_HASH" "$actual_active_hash"

mapfile -t metadata < <(
  rpc_call \
    "facetSetMetadata(bytes32)(bool,uint64,uint64,bytes32,bytes32,bytes32,address,bytes4,uint256)" \
    "$EXPECTED_ACTIVE_FACET_SET_HASH"
)
[[ "${#metadata[@]}" -eq 9 ]] || fail "malformed active metadata response"
[[ "${metadata[0]}" == "true" ]] || fail "active facet set is not published"
release="${metadata[1]}"
required_storage_version="${metadata[2]}"
predecessor_hash="${metadata[3]}"
storage_layout_hash="${metadata[4]}"
manifest_hash="${metadata[5]}"
migration_facet="${metadata[6]}"
migration_selector="${metadata[7]}"
selector_count="${metadata[8]}"
[[ "$release" =~ ^[0-9]+$ && "$release" -gt 0 ]] || fail "active release must be positive"
[[ "$required_storage_version" =~ ^[0-9]+$ ]] || fail "active storage version is malformed"
[[ "$selector_count" =~ ^[0-9]+$ && "$selector_count" -le 256 ]] \
  || fail "active selector count is malformed or exceeds 256"
has_migration_facet=0
has_migration_selector=0
[[ "$(normalize_hex "$migration_facet")" != "0x0000000000000000000000000000000000000000" ]] \
  && has_migration_facet=1
[[ "$(normalize_hex "$migration_selector")" != "0x00000000" ]] && has_migration_selector=1
[[ "$has_migration_facet" == "$has_migration_selector" ]] \
  || fail "active migration facet and selector must both be zero or both be nonzero"

[[ "$(rpc_call "activeRelease()(uint64)")" == "$release" ]] || fail "active release mismatch"
[[ "$(rpc_call "activeStorageVersion()(uint64)")" == "$required_storage_version" ]] \
  || fail "active storage version mismatch"
expect_equal \
  "active storage layout" \
  "$storage_layout_hash" \
  "$(rpc_call "activeStorageLayoutHash()(bytes32)")"
expect_equal \
  "release-to-hash index" \
  "$EXPECTED_ACTIVE_FACET_SET_HASH" \
  "$(rpc_call "facetSetHashForRelease(uint64)(bytes32)" "$release")"

selector_output="$(rpc_call "facetSetSelectors(bytes32)(bytes4[])" "$EXPECTED_ACTIVE_FACET_SET_HASH")"
selector_output="${selector_output#\[}"
selector_output="${selector_output%\]}"
selectors=()
if [[ -n "$(trim "$selector_output")" ]]; then
  IFS="," read -ra selectors <<<"$selector_output"
fi
[[ "${#selectors[@]}" -eq "$selector_count" ]] || fail "active selector array length mismatch"

route_records="$(mktemp)"
inventory="$(mktemp)"
cleanup() {
  rm -f "$route_records" "$inventory"
}
trap cleanup EXIT

previous_selector=""
migration_route_count=0
migration_route_facet=""
migration_route_selector=""
manifest_route_tuples=()
for raw_selector in "${selectors[@]}"; do
  selector="$(normalize_hex "$(trim "$raw_selector")")"
  [[ "$selector" =~ ^0x[0-9a-f]{8}$ ]] || fail "malformed active selector: $selector"
  if [[ -n "$previous_selector" && ! "$selector" > "$previous_selector" ]]; then
    fail "active selectors are not strictly ascending at $selector"
  fi
  previous_selector="$selector"

  mapfile -t stored_route < <(
    rpc_call \
      "facetSetRoute(bytes32,bytes4)(address,bytes32,uint8)" \
      "$EXPECTED_ACTIVE_FACET_SET_HASH" \
      "$selector"
  )
  [[ "${#stored_route[@]}" -eq 3 ]] || fail "malformed stored route for $selector"
  facet="${stored_route[0]}"
  committed_code_hash="${stored_route[1]}"
  kind_value="${stored_route[2]}"
  [[ "$facet" != "0x0000000000000000000000000000000000000000" ]] \
    || fail "active route $selector has a zero facet"
  [[ "$(normalize_hex "$facet")" != "$(normalize_hex "$PROTOCOL_FACET_REGISTRY")" ]] \
    || fail "active route $selector targets the registry itself"
  [[ "$(rpc_call "isReservedKernelSelector(bytes4)(bool)" "$selector")" == "false" ]] \
    || fail "active route $selector shadows a kernel selector"
  [[ "$kind_value" == "0" || "$kind_value" == "1" || "$kind_value" == "2" ]] \
    || fail "active route $selector has invalid kind $kind_value"

  mapfile -t active_route < <(rpc_call "route(bytes4)(address,bytes32,uint8,uint64)" "$selector")
  [[ "${#active_route[@]}" -eq 4 ]] || fail "malformed active route for $selector"
  expect_equal "active route facet $selector" "$facet" "${active_route[0]}"
  expect_equal "active route code hash $selector" "$committed_code_hash" "${active_route[1]}"
  [[ "${active_route[2]}" == "$kind_value" ]] || fail "active route kind mismatch for $selector"
  [[ "${active_route[3]}" == "$required_storage_version" ]] \
    || fail "active route storage version mismatch for $selector"
  expect_equal \
    "facetAddress loupe route $selector" \
    "$facet" \
    "$(rpc_call "facetAddress(bytes4)(address)" "$selector")"

  facet_code="$(cast code "$facet" --block "$block_number" --rpc-url "$RPC_URL")"
  [[ "$facet_code" != "0x" ]] || fail "active facet $facet has no code"
  live_code_hash="$(cast keccak "$facet_code")"
  expect_equal "active facet runtime code hash $facet" "$committed_code_hash" "$live_code_hash"
  manifest_route_tuples+=("($selector,$facet,$committed_code_hash,$kind_value)")

  case "$kind_value" in
    0) kind_name="View" ;;
    1) kind_name="Mutating" ;;
    2)
      kind_name="Migration"
      migration_route_count=$((migration_route_count + 1))
      migration_route_facet="$facet"
      migration_route_selector="$selector"
      ;;
  esac
  jq -cn \
    --arg selector "$selector" \
    --arg facet "$(normalize_hex "$facet")" \
    --arg code_hash "$(normalize_hex "$committed_code_hash")" \
    --arg live_code_hash "$(normalize_hex "$live_code_hash")" \
    --arg kind "$kind_name" \
    --argjson kind_value "$kind_value" \
    '{
      selector: $selector,
      facet: $facet,
      codeHash: $code_hash,
      liveCodeHash: $live_code_hash,
      kind: $kind,
      kindValue: $kind_value
    }' >>"$route_records"
done

if [[ "$has_migration_facet" == "1" ]]; then
  [[ "$migration_route_count" == "1" ]] || fail "active migration metadata must name exactly one route"
  expect_equal "active migration route facet" "$migration_facet" "$migration_route_facet"
  expect_equal "active migration route selector" "$migration_selector" "$migration_route_selector"
else
  [[ "$migration_route_count" == "0" ]] || fail "active Migration route lacks migration metadata"
fi

joined_route_tuples=""
if [[ "${#manifest_route_tuples[@]}" -ne 0 ]]; then
  joined_route_tuples="$(IFS=,; printf "%s" "${manifest_route_tuples[*]}")"
fi
manifest_tuple="($release,$required_storage_version,$predecessor_hash,$storage_layout_hash,$manifest_hash,[$joined_route_tuples],$migration_facet,$migration_selector)"
computed_facet_set_hash="$(
  rpc_call \
    "computeFacetSetHash((uint64,uint64,bytes32,bytes32,bytes32,(bytes4,address,bytes32,uint8)[],address,bytes4))(bytes32)" \
    "$manifest_tuple"
)"
expect_equal "reconstructed active facet-set hash" "$EXPECTED_ACTIVE_FACET_SET_HASH" "$computed_facet_set_hash"

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
expected_facet_addresses_json="$(jq -c '[.[].facetAddress]' <<<"$expected_facets_json")"
actual_facet_addresses_json="$(
  rpc_call_json "facetAddresses()(address[])" \
    | jq -ce '.[0] | map(ascii_downcase)'
)"
expect_json_equal \
  "facetAddresses loupe inventory" \
  "$expected_facet_addresses_json" \
  "$actual_facet_addresses_json"

actual_facets_json="$(
  rpc_call_json "facets()((address,bytes4[])[])" \
    | jq -ce '
        .[0]
        | map({
            facetAddress: (.[0] | ascii_downcase),
            functionSelectors: (.[1] | map(ascii_downcase))
          })
      '
)"
expect_json_equal "facets loupe inventory" "$expected_facets_json" "$actual_facets_json"

while IFS= read -r expected_facet; do
  grouped_facet="$(jq -er '.facetAddress' <<<"$expected_facet")"
  expected_function_selectors="$(jq -c '.functionSelectors' <<<"$expected_facet")"
  actual_function_selectors="$(
    rpc_call_json "facetFunctionSelectors(address)(bytes4[])" "$grouped_facet" \
      | jq -ce '.[0] | map(ascii_downcase)'
  )"
  expect_json_equal \
    "facetFunctionSelectors loupe inventory for $grouped_facet" \
    "$expected_function_selectors" \
    "$actual_function_selectors"
done < <(jq -c '.[]' <<<"$expected_facets_json")

if [[ "$selector_count" == "0" ]]; then
  expect_equal \
    "empty-release facetAddress" \
    "0x0000000000000000000000000000000000000000" \
    "$(rpc_call "facetAddress(bytes4)(address)" "0x00000000")"
  empty_facet_selectors="$(
    rpc_call_json \
      "facetFunctionSelectors(address)(bytes4[])" \
      "0x0000000000000000000000000000000000000000" \
      | jq -ce '.[0]'
  )"
  expect_json_equal "empty-release facetFunctionSelectors" "[]" "$empty_facet_selectors"
fi

final_block_hash="$(cast block "$block_number" --field hash --rpc-url "$RPC_URL")"
expect_equal "pinned block hash after export" "$block_hash" "$final_block_hash"

routes_json="$(jq -sc '.' "$route_records")"
jq -n \
  --argjson schema_version 1 \
  --argjson chain_id "$EXPECTED_CHAIN_ID" \
  --argjson block_number "$block_number" \
  --arg block_hash "$(normalize_hex "$block_hash")" \
  --arg registry "$(normalize_hex "$PROTOCOL_FACET_REGISTRY")" \
  --arg registry_code_hash "$(normalize_hex "$actual_registry_code_hash")" \
  --arg registry_owner "$(normalize_hex "$actual_owner")" \
  --arg facet_set_hash "$(normalize_hex "$EXPECTED_ACTIVE_FACET_SET_HASH")" \
  --argjson release "$release" \
  --argjson required_storage_version "$required_storage_version" \
  --arg predecessor_hash "$(normalize_hex "$predecessor_hash")" \
  --arg storage_layout_hash "$(normalize_hex "$storage_layout_hash")" \
  --arg manifest_hash "$(normalize_hex "$manifest_hash")" \
  --arg migration_facet "$(normalize_hex "$migration_facet")" \
  --arg migration_selector "$(normalize_hex "$migration_selector")" \
  --argjson selector_count "$selector_count" \
  --argjson routes "$routes_json" \
  '{
    schemaVersion: $schema_version,
    chainId: $chain_id,
    blockNumber: $block_number,
    blockHash: $block_hash,
    registry: $registry,
    registryCodeHash: $registry_code_hash,
    protocolFacetRegistryOwner: $registry_owner,
    activeFacetSetHash: $facet_set_hash,
    release: $release,
    requiredStorageVersion: $required_storage_version,
    predecessorFacetSetHash: $predecessor_hash,
    storageLayoutHash: $storage_layout_hash,
    manifestHash: $manifest_hash,
    migrationFacet: $migration_facet,
    migrationSelector: $migration_selector,
    selectorCount: $selector_count,
    routes: $routes
  }' >"$inventory"

if [[ "$ACTION" == "verify" ]]; then
  cat "$inventory"
  exit 0
fi

: "${RELEASE_INVENTORY_OUTPUT:?Set RELEASE_INVENTORY_OUTPUT for export}"
allowed_root="$(realpath -m "$CONTRACTS_DIR/deployments/releases")"
if [[ "$RELEASE_INVENTORY_OUTPUT" = /* ]]; then
  output_path="$(realpath -m "$RELEASE_INVENTORY_OUTPUT")"
else
  output_path="$(realpath -m "$CONTRACTS_DIR/$RELEASE_INVENTORY_OUTPUT")"
fi
[[ "$output_path" == "$allowed_root/"* ]] \
  || fail "output must be below $allowed_root; root deployment artifacts are immutable here"
if [[ -e "$output_path" ]]; then
  [[ "${OVERWRITE_RELEASE_INVENTORY:-0}" == "1" ]] \
    || fail "output exists; choose a new hash-versioned path or set OVERWRITE_RELEASE_INVENTORY=1"
  expected_confirmation="overwrite:$(normalize_hex "$EXPECTED_ACTIVE_FACET_SET_HASH")"
  [[ "$(normalize_hex "${CONFIRM_RELEASE_INVENTORY_OVERWRITE:-}")" == "$expected_confirmation" ]] \
    || fail "set CONFIRM_RELEASE_INVENTORY_OVERWRITE=$expected_confirmation"
fi

mkdir -p "$(dirname "$output_path")"
temporary_output="$(mktemp "$(dirname "$output_path")/.release-inventory.XXXXXX")"
cp "$inventory" "$temporary_output"
mv "$temporary_output" "$output_path"
echo "Verified active release inventory written to $output_path"
