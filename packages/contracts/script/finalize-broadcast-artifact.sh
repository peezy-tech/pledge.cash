#!/usr/bin/env bash
set -euo pipefail

: "${CHAIN_ID:?Set CHAIN_ID}"
: "${ARTIFACT:?Set ARTIFACT}"
: "${RECEIPTS:?Set RECEIPTS}"
: "${BROADCAST_FILE:?Set BROADCAST_FILE}"
: "${SOURCE_COMMIT:?Set SOURCE_COMMIT}"

fail() {
  echo "Broadcast finalization failed: $*" >&2
  exit 1
}

[[ "$CHAIN_ID" =~ ^[0-9]+$ ]] || fail "CHAIN_ID must be decimal"
[[ "$SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || fail "SOURCE_COMMIT must be an exact lowercase Git commit"
[[ -f "$ARTIFACT" ]] || fail "missing candidate artifact $ARTIFACT"
[[ -f "$BROADCAST_FILE" ]] || fail "missing Foundry broadcast record $BROADCAST_FILE"

jq -e '
  .receipts
  | type == "array"
    and length > 0
    and all(
      (.transactionHash | type == "string" and test("^0x[0-9a-fA-F]{64}$"))
      and (.blockNumber | type == "string" and test("^0x[0-9a-fA-F]+$"))
      and (.status | ascii_downcase == "0x1")
    )
' "$BROADCAST_FILE" >/dev/null || fail "Foundry broadcast record has missing or unsuccessful receipts"

deployment_block=""
while IFS= read -r block_hex; do
  block_decimal="$(printf '%d' "$block_hex")"
  if [[ -z "$deployment_block" || "$block_decimal" -lt "$deployment_block" ]]; then
    deployment_block="$block_decimal"
  fi
done < <(jq -r '.receipts[].blockNumber' "$BROADCAST_FILE")

[[ -n "$deployment_block" ]] || fail "could not derive a deployment block from receipts"

artifact_tmp="$(mktemp "${ARTIFACT}.XXXXXX")"
receipts_tmp="$(mktemp "${RECEIPTS}.XXXXXX")"
cleanup() {
  rm -f "$artifact_tmp" "$receipts_tmp"
}
trap cleanup EXIT

jq \
  --arg sourceCommit "$SOURCE_COMMIT" \
  --argjson deploymentBlock "$deployment_block" \
  '.sourceCommit = $sourceCommit | .deploymentBlock = $deploymentBlock' \
  "$ARTIFACT" >"$artifact_tmp"

jq \
  --argjson chainId "$CHAIN_ID" \
  --arg sourceCommit "$SOURCE_COMMIT" \
  '{
    schemaVersion: 1,
    chainId: $chainId,
    sourceCommit: $sourceCommit,
    transactions: [
      .receipts[] | {
        transactionHash,
        blockNumber,
        status,
        gasUsed,
        contractAddress
      }
    ]
  }' \
  "$BROADCAST_FILE" >"$receipts_tmp"

mv "$artifact_tmp" "$ARTIFACT"
mv "$receipts_tmp" "$RECEIPTS"
trap - EXIT

echo "Recorded deployment block $deployment_block and $(jq '.transactions | length' "$RECEIPTS") successful receipts."
