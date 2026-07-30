#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

fail() {
  echo "Protocol facet release operator refused: $*" >&2
  exit 1
}

usage() {
  cat >&2 <<'USAGE'
usage: operator.sh <preflight|publish|activate|verify-published|verify-active> <manifest.json>

Required environment:
  RPC_URL
  EXPECTED_CHAIN_ID
  PROTOCOL_FACET_REGISTRY
  EXPECTED_REGISTRY_CODE_HASH
  EXPECTED_REGISTRY_OWNER
  EXPECTED_CURRENT_FACET_SET_HASH
  EXPECTED_NEW_FACET_SET_HASH

Broadcast publication and activation also require REGISTRY_RELEASE_PRIVATE_KEY.
Broadcasting is disabled unless BROADCAST=1 and
CONFIRM_RELEASE_BROADCAST="<action>:<expected-new-hash>".
USAGE
  exit 64
}

[[ "$#" -eq 2 ]] || usage
ACTION="$1"
MANIFEST_PATH="$2"
case "$ACTION" in
  preflight | publish | activate | verify-published | verify-active) ;;
  *) usage ;;
esac

for command in bun cast jq; do
  command -v "$command" >/dev/null || fail "missing required command: $command"
done

: "${RPC_URL:?Set RPC_URL}"
: "${EXPECTED_CHAIN_ID:?Set EXPECTED_CHAIN_ID}"
: "${PROTOCOL_FACET_REGISTRY:?Set PROTOCOL_FACET_REGISTRY}"
: "${EXPECTED_REGISTRY_CODE_HASH:?Set EXPECTED_REGISTRY_CODE_HASH}"
: "${EXPECTED_REGISTRY_OWNER:?Set EXPECTED_REGISTRY_OWNER}"
: "${EXPECTED_CURRENT_FACET_SET_HASH:?Set EXPECTED_CURRENT_FACET_SET_HASH}"
: "${EXPECTED_NEW_FACET_SET_HASH:?Set EXPECTED_NEW_FACET_SET_HASH}"

[[ -f "$MANIFEST_PATH" ]] || fail "manifest does not exist: $MANIFEST_PATH"
[[ "$EXPECTED_CHAIN_ID" =~ ^[0-9]+$ ]] || fail "EXPECTED_CHAIN_ID must be decimal"
[[ "$PROTOCOL_FACET_REGISTRY" =~ ^0x[0-9a-fA-F]{40}$ ]] \
  || fail "PROTOCOL_FACET_REGISTRY must be an address"
[[ "$EXPECTED_REGISTRY_OWNER" =~ ^0x[0-9a-fA-F]{40}$ ]] \
  || fail "EXPECTED_REGISTRY_OWNER must be an address"
[[ "${EXPECTED_REGISTRY_OWNER,,}" != "0x0000000000000000000000000000000000000000" ]] \
  || fail "EXPECTED_REGISTRY_OWNER must be nonzero"
for value_name in \
  EXPECTED_REGISTRY_CODE_HASH \
  EXPECTED_CURRENT_FACET_SET_HASH \
  EXPECTED_NEW_FACET_SET_HASH
do
  value="${!value_name}"
  [[ "$value" =~ ^0x[0-9a-fA-F]{64}$ ]] || fail "$value_name must be bytes32"
  [[ "$value" != "0x$(printf '00%.0s' {1..32})" ]] || fail "$value_name must be nonzero"
done

BROADCAST="${BROADCAST:-0}"
[[ "$BROADCAST" == "0" || "$BROADCAST" == "1" ]] || fail "BROADCAST must be 0 or 1"
if [[ "$BROADCAST" == "1" && "$ACTION" != "publish" && "$ACTION" != "activate" ]]; then
  fail "BROADCAST=1 is valid only for publish or activate"
fi

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

rpc_call() {
  cast call "$PROTOCOL_FACET_REGISTRY" "$@" --rpc-url "$RPC_URL"
}

normalized_manifest="$(mktemp)"
cleanup() {
  rm -f "$normalized_manifest"
}
trap cleanup EXIT

bun "$SCRIPT_DIR/manifest-cli.ts" "$MANIFEST_PATH" >"$normalized_manifest"

release="$(jq -er '.release' "$normalized_manifest")"
required_storage_version="$(jq -er '.requiredStorageVersion' "$normalized_manifest")"
predecessor_hash="$(jq -er '.predecessorFacetSetHash' "$normalized_manifest")"
storage_layout_hash="$(jq -er '.storageLayoutHash' "$normalized_manifest")"
manifest_hash="$(jq -er '.manifestHash' "$normalized_manifest")"
migration_facet="$(jq -er '.migrationFacet' "$normalized_manifest")"
migration_selector="$(jq -er '.migrationSelector' "$normalized_manifest")"
selector_count="$(jq -er '.selectorCount' "$normalized_manifest")"
manifest_tuple="$(jq -er '.tuple' "$normalized_manifest")"

actual_chain_id="$(cast chain-id --rpc-url "$RPC_URL")"
[[ "$actual_chain_id" == "$EXPECTED_CHAIN_ID" ]] \
  || fail "RPC chain mismatch: expected $EXPECTED_CHAIN_ID, received $actual_chain_id"

registry_code="$(cast code "$PROTOCOL_FACET_REGISTRY" --rpc-url "$RPC_URL")"
[[ "$registry_code" != "0x" ]] || fail "registry has no code"
actual_registry_code_hash="$(cast codehash "$PROTOCOL_FACET_REGISTRY" --rpc-url "$RPC_URL")"
expect_equal "registry runtime code hash" "$EXPECTED_REGISTRY_CODE_HASH" "$actual_registry_code_hash"

actual_owner="$(rpc_call "owner()(address)")"
expect_equal "registry owner" "$EXPECTED_REGISTRY_OWNER" "$actual_owner"

expect_equal "manifest predecessor" "$EXPECTED_CURRENT_FACET_SET_HASH" "$predecessor_hash"

mapfile -t predecessor_metadata < <(
  rpc_call \
    "facetSetMetadata(bytes32)(bool,uint64,uint64,bytes32,bytes32,bytes32,address,bytes4,uint256)" \
    "$EXPECTED_CURRENT_FACET_SET_HASH"
)
[[ "${#predecessor_metadata[@]}" -eq 9 ]] || fail "malformed predecessor metadata response"
[[ "${predecessor_metadata[0]}" == "true" ]] || fail "expected predecessor facet set is not published"
predecessor_release="${predecessor_metadata[1]}"
predecessor_storage_version="${predecessor_metadata[2]}"
predecessor_layout_hash="${predecessor_metadata[4]}"
predecessor_migration_facet="${predecessor_metadata[6]}"

[[ "$release" -gt "$predecessor_release" ]] \
  || fail "release must increase: predecessor $predecessor_release, manifest $release"
[[ "$required_storage_version" -ge "$predecessor_storage_version" ]] \
  || fail "required storage version decreases from $predecessor_storage_version to $required_storage_version"
if [[ "$required_storage_version" -eq "$predecessor_storage_version" ]]; then
  expect_equal "same-version storage layout" "$predecessor_layout_hash" "$storage_layout_hash"
else
  [[ "$(normalize_hex "$migration_facet")" != "0x0000000000000000000000000000000000000000" ]] \
    || fail "a storage-version increase requires migration metadata"
fi
if [[ "$(normalize_hex "$predecessor_migration_facet")" != "0x0000000000000000000000000000000000000000" ]]; then
  [[ "$(normalize_hex "$migration_facet")" != "0x0000000000000000000000000000000000000000" ]] \
    || fail "registry requires migration-route continuity from the predecessor release"
fi

active_hash="$(rpc_call "activeFacetSetHash()(bytes32)")"
active_release="$(rpc_call "activeRelease()(uint64)")"
active_storage_version="$(rpc_call "activeStorageVersion()(uint64)")"
active_storage_layout_hash="$(rpc_call "activeStorageLayoutHash()(bytes32)")"
if [[ "$ACTION" == "verify-active" ]]; then
  expect_equal "active facet-set hash" "$EXPECTED_NEW_FACET_SET_HASH" "$active_hash"
else
  expect_equal "active facet-set hash" "$EXPECTED_CURRENT_FACET_SET_HASH" "$active_hash"
  [[ "$active_release" == "$predecessor_release" ]] || fail "active release does not match predecessor metadata"
  [[ "$active_storage_version" == "$predecessor_storage_version" ]] \
    || fail "active storage version does not match predecessor metadata"
  expect_equal "active storage layout" "$predecessor_layout_hash" "$active_storage_layout_hash"
fi

while IFS= read -r route; do
  selector="$(jq -er '.selector' <<<"$route")"
  facet="$(jq -er '.facet' <<<"$route")"
  expected_code_hash="$(jq -er '.codeHash' <<<"$route")"
  [[ "$(normalize_hex "$facet")" != "$(normalize_hex "$PROTOCOL_FACET_REGISTRY")" ]] \
    || fail "route $selector cannot target the registry itself"
  reserved="$(rpc_call "isReservedKernelSelector(bytes4)(bool)" "$selector")"
  [[ "$reserved" == "false" ]] || fail "selector $selector is reserved by the kernel"
  facet_code="$(cast code "$facet" --rpc-url "$RPC_URL")"
  [[ "$facet_code" != "0x" ]] || fail "facet $facet has no code"
  actual_code_hash="$(cast codehash "$facet" --rpc-url "$RPC_URL")"
  expect_equal "facet $facet runtime code hash" "$expected_code_hash" "$actual_code_hash"
done < <(jq -c '.routes[]' "$normalized_manifest")

computed_hash="$(
  rpc_call \
    "computeFacetSetHash((uint64,uint64,bytes32,bytes32,bytes32,(bytes4,address,bytes32,uint8)[],address,bytes4))(bytes32)" \
    "$manifest_tuple"
)"
expect_equal "computed facet-set hash" "$EXPECTED_NEW_FACET_SET_HASH" "$computed_hash"

verify_published() {
  local published
  published="$(rpc_call "isFacetSetPublished(bytes32)(bool)" "$EXPECTED_NEW_FACET_SET_HASH")"
  [[ "$published" == "true" ]] || fail "expected facet set is not published"
  expect_equal \
    "release-to-hash index" \
    "$EXPECTED_NEW_FACET_SET_HASH" \
    "$(rpc_call "facetSetHashForRelease(uint64)(bytes32)" "$release")"

  local metadata
  mapfile -t metadata < <(
    rpc_call \
      "facetSetMetadata(bytes32)(bool,uint64,uint64,bytes32,bytes32,bytes32,address,bytes4,uint256)" \
      "$EXPECTED_NEW_FACET_SET_HASH"
  )
  [[ "${#metadata[@]}" -eq 9 ]] || fail "malformed facetSetMetadata response"
  [[ "${metadata[0]}" == "true" ]] || fail "published metadata flag is false"
  [[ "${metadata[1]}" == "$release" ]] || fail "published release mismatch"
  [[ "${metadata[2]}" == "$required_storage_version" ]] || fail "published storage version mismatch"
  expect_equal "published predecessor" "$predecessor_hash" "${metadata[3]}"
  expect_equal "published storage layout" "$storage_layout_hash" "${metadata[4]}"
  expect_equal "published human manifest" "$manifest_hash" "${metadata[5]}"
  expect_equal "published migration facet" "$migration_facet" "${metadata[6]}"
  expect_equal "published migration selector" "$migration_selector" "${metadata[7]}"
  [[ "${metadata[8]}" == "$selector_count" ]] || fail "published selector count mismatch"

  local selector_output
  selector_output="$(rpc_call "facetSetSelectors(bytes32)(bytes4[])" "$EXPECTED_NEW_FACET_SET_HASH")"
  selector_output="${selector_output#\[}"
  selector_output="${selector_output%\]}"
  local published_selectors=()
  if [[ -n "$(trim "$selector_output")" ]]; then
    IFS="," read -ra published_selectors <<<"$selector_output"
  fi
  [[ "${#published_selectors[@]}" -eq "$selector_count" ]] \
    || fail "published selector array length mismatch"

  local index=0
  while IFS= read -r route; do
    local selector facet expected_code_hash kind_value published_selector
    selector="$(jq -er '.selector' <<<"$route")"
    facet="$(jq -er '.facet' <<<"$route")"
    expected_code_hash="$(jq -er '.codeHash' <<<"$route")"
    kind_value="$(jq -er '.kindValue' <<<"$route")"
    published_selector="$(trim "${published_selectors[$index]}")"
    expect_equal "published selector[$index]" "$selector" "$published_selector"

    local stored_route
    mapfile -t stored_route < <(
      rpc_call "facetSetRoute(bytes32,bytes4)(address,bytes32,uint8)" "$EXPECTED_NEW_FACET_SET_HASH" "$selector"
    )
    [[ "${#stored_route[@]}" -eq 3 ]] || fail "malformed stored route for $selector"
    expect_equal "published route facet $selector" "$facet" "${stored_route[0]}"
    expect_equal "published route code hash $selector" "$expected_code_hash" "${stored_route[1]}"
    [[ "${stored_route[2]}" == "$kind_value" ]] || fail "published route kind mismatch for $selector"
    index=$((index + 1))
  done < <(jq -c '.routes[]' "$normalized_manifest")
}

verify_active() {
  expect_equal \
    "post-action active hash" \
    "$EXPECTED_NEW_FACET_SET_HASH" \
    "$(rpc_call "activeFacetSetHash()(bytes32)")"
  [[ "$(rpc_call "activeRelease()(uint64)")" == "$release" ]] || fail "active release mismatch"
  [[ "$(rpc_call "activeStorageVersion()(uint64)")" == "$required_storage_version" ]] \
    || fail "active storage version mismatch"
  expect_equal \
    "active storage layout" \
    "$storage_layout_hash" \
    "$(rpc_call "activeStorageLayoutHash()(bytes32)")"

  while IFS= read -r route; do
    local selector facet expected_code_hash kind_value active_route
    selector="$(jq -er '.selector' <<<"$route")"
    facet="$(jq -er '.facet' <<<"$route")"
    expected_code_hash="$(jq -er '.codeHash' <<<"$route")"
    kind_value="$(jq -er '.kindValue' <<<"$route")"
    mapfile -t active_route < <(
      rpc_call "route(bytes4)(address,bytes32,uint8,uint64)" "$selector"
    )
    [[ "${#active_route[@]}" -eq 4 ]] || fail "malformed active route for $selector"
    expect_equal "active route facet $selector" "$facet" "${active_route[0]}"
    expect_equal "active route code hash $selector" "$expected_code_hash" "${active_route[1]}"
    [[ "${active_route[2]}" == "$kind_value" ]] || fail "active route kind mismatch for $selector"
    [[ "${active_route[3]}" == "$required_storage_version" ]] \
      || fail "active route storage version mismatch for $selector"
  done < <(jq -c '.routes[]' "$normalized_manifest")

  EXPECTED_ACTIVE_FACET_SET_HASH="$EXPECTED_NEW_FACET_SET_HASH" \
    "$SCRIPT_DIR/export-active.sh" verify >/dev/null
}

require_owner_key() {
  : "${REGISTRY_RELEASE_PRIVATE_KEY:?Set REGISTRY_RELEASE_PRIVATE_KEY for $ACTION}"
  local signer
  signer="$(cast wallet address --private-key "$REGISTRY_RELEASE_PRIVATE_KEY")"
  expect_equal "registry owner key" "$EXPECTED_REGISTRY_OWNER" "$signer"
}

if [[ "${RELEASE_USE_LEGACY_TRANSACTIONS:-0}" != "0" && "${RELEASE_USE_LEGACY_TRANSACTIONS:-0}" != "1" ]]; then
  fail "RELEASE_USE_LEGACY_TRANSACTIONS must be 0 or 1"
fi

case "$ACTION" in
  preflight)
    echo "Preflight passed"
    ;;
  verify-published)
    verify_published
    echo "Published release verification passed"
    ;;
  verify-active)
    verify_published
    verify_active
    echo "Active release verification passed"
    ;;
  publish)
    [[ "$(rpc_call "isFacetSetPublished(bytes32)(bool)" "$EXPECTED_NEW_FACET_SET_HASH")" == "false" ]] \
      || fail "expected new facet set is already published"
    expect_equal \
      "unused release index" \
      "0x0000000000000000000000000000000000000000000000000000000000000000" \
      "$(rpc_call "facetSetHashForRelease(uint64)(bytes32)" "$release")"
    simulated="$(
      cast call \
        "$PROTOCOL_FACET_REGISTRY" \
        "publishFacetSet((uint64,uint64,bytes32,bytes32,bytes32,(bytes4,address,bytes32,uint8)[],address,bytes4))(bytes32)" \
        "$manifest_tuple" \
        --from "$EXPECTED_REGISTRY_OWNER" \
        --rpc-url "$RPC_URL"
    )"
    expect_equal "publish simulation return" "$EXPECTED_NEW_FACET_SET_HASH" "$simulated"
    if [[ "$BROADCAST" == "1" ]]; then
      expected_confirmation="publish:$(normalize_hex "$EXPECTED_NEW_FACET_SET_HASH")"
      [[ "$(normalize_hex "${CONFIRM_RELEASE_BROADCAST:-}")" == "$expected_confirmation" ]] \
        || fail "set CONFIRM_RELEASE_BROADCAST=$expected_confirmation"
      require_owner_key
      send_args=(--rpc-url "$RPC_URL" --private-key "$REGISTRY_RELEASE_PRIVATE_KEY")
      if [[ "${RELEASE_USE_LEGACY_TRANSACTIONS:-0}" == "1" ]]; then
        send_args+=(--legacy)
      fi
      echo "Broadcasting publication only; activation remains a separate command."
      cast send \
        "$PROTOCOL_FACET_REGISTRY" \
        "publishFacetSet((uint64,uint64,bytes32,bytes32,bytes32,(bytes4,address,bytes32,uint8)[],address,bytes4))" \
        "$manifest_tuple" \
        "${send_args[@]}"
      verify_published
      echo "Publication broadcast and live verification passed"
    else
      echo "Publication simulation passed; no transaction broadcast"
    fi
    ;;
  activate)
    verify_published
    cast call \
      "$PROTOCOL_FACET_REGISTRY" \
      "activateFacetSet(bytes32)" \
      "$EXPECTED_NEW_FACET_SET_HASH" \
      --from "$EXPECTED_REGISTRY_OWNER" \
      --rpc-url "$RPC_URL" >/dev/null
    if [[ "$BROADCAST" == "1" ]]; then
      expected_confirmation="activate:$(normalize_hex "$EXPECTED_NEW_FACET_SET_HASH")"
      [[ "$(normalize_hex "${CONFIRM_RELEASE_BROADCAST:-}")" == "$expected_confirmation" ]] \
        || fail "set CONFIRM_RELEASE_BROADCAST=$expected_confirmation"
      require_owner_key
      send_args=(--rpc-url "$RPC_URL" --private-key "$REGISTRY_RELEASE_PRIVATE_KEY")
      if [[ "${RELEASE_USE_LEGACY_TRANSACTIONS:-0}" == "1" ]]; then
        send_args+=(--legacy)
      fi
      echo "Broadcasting global activation. Every Boardroom will resolve this release immediately."
      cast send \
        "$PROTOCOL_FACET_REGISTRY" \
        "activateFacetSet(bytes32)" \
        "$EXPECTED_NEW_FACET_SET_HASH" \
        "${send_args[@]}"
      verify_active
      echo "Activation broadcast and live verification passed"
    else
      echo "Activation simulation passed; no transaction broadcast"
    fi
    ;;
esac
