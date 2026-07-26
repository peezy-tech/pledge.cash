#!/usr/bin/env bash
set -euo pipefail

: "${CHAIN_ID:?Set CHAIN_ID}"
: "${ARTIFACT:?Set ARTIFACT}"
: "${RECEIPTS:?Set RECEIPTS}"
: "${BROADCAST_FILE:?Set BROADCAST_FILE}"
: "${SOURCE_COMMIT:?Set SOURCE_COMMIT}"
: "${PREVIOUS_ARTIFACT:?Set PREVIOUS_ARTIFACT}"

fail() {
  echo "Broadcast finalization failed: $*" >&2
  exit 1
}

[[ "$CHAIN_ID" =~ ^[0-9]+$ ]] || fail "CHAIN_ID must be decimal"
[[ "$SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || fail "SOURCE_COMMIT must be an exact lowercase Git commit"
[[ -f "$ARTIFACT" ]] || fail "missing candidate artifact $ARTIFACT"
[[ -f "$BROADCAST_FILE" ]] || fail "missing Foundry broadcast record $BROADCAST_FILE"

jq -e '
  (.receipts | type == "array" and length > 0)
  and (.transactions | type == "array")
  and ((.transactions | length) == (.receipts | length))
  and all(
    .receipts[];
    (.transactionHash | type == "string" and test("^0x[0-9a-fA-F]{64}$"))
    and (.blockNumber | type == "string" and test("^0x[0-9a-fA-F]+$"))
    and (.status | type == "string" and ascii_downcase == "0x1")
    and (.gasUsed | type == "string" and test("^0x[0-9a-fA-F]+$"))
    and (
      .contractAddress == null
      or (.contractAddress | type == "string" and test("^0x[0-9a-fA-F]{40}$"))
    )
  )
  and all(
    .transactions[];
    (.hash | type == "string" and test("^0x[0-9a-fA-F]{64}$"))
    and (.transaction | type == "object")
    and (.transaction.from | type == "string" and test("^0x[0-9a-fA-F]{40}$"))
    and (
      .transaction.to == null
      or (.transaction.to | type == "string" and test("^0x[0-9a-fA-F]{40}$"))
    )
    and (.transaction.input | type == "string" and test("^0x([0-9a-fA-F]{2})*$"))
    and (.transaction.value | type == "string" and test("^0x[0-9a-fA-F]+$"))
  )
  and (
    . as $broadcast
    | all(
      $broadcast.receipts[];
      .transactionHash as $receiptHash
      | ([
          $broadcast.transactions[]
          | select((.hash | ascii_downcase) == ($receiptHash | ascii_downcase))
        ] | length) == 1
    )
  )
  and (
    . as $broadcast
    | all(
      $broadcast.transactions[];
      .hash as $transactionHash
      | ([
          $broadcast.receipts[]
          | select((.transactionHash | ascii_downcase) == ($transactionHash | ascii_downcase))
        ] | length) == 1
    )
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
deployment_timestamp="$(
  jq -er '.deploymentTimestamp | select(type == "number" and . > 0 and floor == .)' "$ARTIFACT"
)" || fail "candidate deploymentTimestamp must be a positive integer"

# A deterministic no-op rerun has only new receipts. Keep the original
# discovery boundary and browser cache identity when the checked-in artifact
# describes the same release.
if [[ -f "$PREVIOUS_ARTIFACT" ]] && ! jq -e '.status == "pending"' "$PREVIOUS_ARTIFACT" >/dev/null; then
  jq -e --argjson chainId "$CHAIN_ID" '
    .chainId == $chainId
    and (.deploymentBlock | type == "number" and . > 0 and floor == .)
    and (.deploymentTimestamp | type == "number" and . > 0 and floor == .)
    and (
      .deterministicDeploymentVersion
      | type == "string" and length > 0
    )
    and (
      .deterministicReleaseCodeHash
      | type == "string" and test("^0x[0-9a-fA-F]{64}$")
    )
    and (
      .deterministicDeployer
      | type == "string" and test("^0x[0-9a-fA-F]{40}$")
    )
    and (
      .boardroomFactory
      | type == "string" and test("^0x[0-9a-fA-F]{40}$")
    )
  ' "$PREVIOUS_ARTIFACT" >/dev/null || fail "existing deployment artifact is malformed"

  if jq -e --slurpfile candidate "$ARTIFACT" '
    $candidate[0] as $candidate
    | .chainId == $candidate.chainId
      and .deterministicDeploymentVersion == $candidate.deterministicDeploymentVersion
      and (
        (.deterministicReleaseCodeHash | ascii_downcase)
        == ($candidate.deterministicReleaseCodeHash | ascii_downcase)
      )
      and (
        (.deterministicDeployer | ascii_downcase)
        == ($candidate.deterministicDeployer | ascii_downcase)
      )
      and (
        (.boardroomFactory | ascii_downcase)
        == ($candidate.boardroomFactory | ascii_downcase)
      )
  ' "$PREVIOUS_ARTIFACT" >/dev/null; then
    previous_deployment_block="$(jq -r '.deploymentBlock' "$PREVIOUS_ARTIFACT")"
    if [[ "$previous_deployment_block" -lt "$deployment_block" ]]; then
      previous_deployment_timestamp="$(jq -r '.deploymentTimestamp' "$PREVIOUS_ARTIFACT")"
      if [[ "$previous_deployment_timestamp" -gt "$deployment_timestamp" ]]; then
        fail "existing deploymentTimestamp is later than the rerun candidate"
      fi
      deployment_block="$previous_deployment_block"
      deployment_timestamp="$previous_deployment_timestamp"
    fi
  fi
fi

artifact_tmp="$(mktemp "${ARTIFACT}.XXXXXX")"
receipts_tmp="$(mktemp "${RECEIPTS}.XXXXXX")"
transactions_tmp="$(mktemp "${RECEIPTS}.transactions.XXXXXX")"
cleanup() {
  rm -f "$artifact_tmp" "$receipts_tmp" "$transactions_tmp"
}
trap cleanup EXIT

jq \
  --arg sourceCommit "$SOURCE_COMMIT" \
  --argjson deploymentBlock "$deployment_block" \
  --argjson deploymentTimestamp "$deployment_timestamp" \
  '.sourceCommit = $sourceCommit
    | .deploymentBlock = $deploymentBlock
    | .deploymentTimestamp = $deploymentTimestamp
  ' \
  "$ARTIFACT" >"$artifact_tmp"

: >"$transactions_tmp"
while IFS= read -r transaction; do
  input="$(printf '%s' "$transaction" | jq -r '.input')"
  input_hash="$(cast keccak "$input")" || fail "could not hash broadcast transaction calldata"
  printf '%s' "$transaction" \
    | jq -c --arg inputHash "$input_hash" 'del(.input) | .inputHash = $inputHash' \
    >>"$transactions_tmp"
done < <(
  jq -c '
    . as $broadcast
    | $broadcast.receipts[] as $receipt
    | (
        $broadcast.transactions[]
        | select((.hash | ascii_downcase) == ($receipt.transactionHash | ascii_downcase))
      ) as $transaction
    | {
        transactionHash: $receipt.transactionHash,
        blockNumber: $receipt.blockNumber,
        status: $receipt.status,
        gasUsed: $receipt.gasUsed,
        contractAddress: $receipt.contractAddress,
        from: $transaction.transaction.from,
        to: $transaction.transaction.to,
        input: $transaction.transaction.input,
        value: $transaction.transaction.value
      }
  ' "$BROADCAST_FILE"
)

jq -s \
  --argjson chainId "$CHAIN_ID" \
  --arg sourceCommit "$SOURCE_COMMIT" \
  '{
    schemaVersion: 2,
    chainId: $chainId,
    sourceCommit: $sourceCommit,
    transactions: .
  }' \
  "$transactions_tmp" >"$receipts_tmp"

mv "$artifact_tmp" "$ARTIFACT"
mv "$receipts_tmp" "$RECEIPTS"
rm -f "$transactions_tmp"
trap - EXIT

echo "Recorded deployment block $deployment_block and $(jq '.transactions | length' "$RECEIPTS") successful receipts."
