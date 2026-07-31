#!/usr/bin/env bash
set -euo pipefail

rpc_url="${LOCAL_RPC_URL:-http://127.0.0.1:8547}"
checkpoint="${PLEDGE_CASH_BOARDROOM_DEPLOYMENT_PATH:-deployments/31337.boardroom.local.json}"
scenario="script/BoardroomLocal.s.sol:BoardroomLocal"

chain_id="$(cast chain-id --rpc-url "$rpc_url")"
if [[ "$chain_id" != "31337" ]]; then
  echo "expected a fresh local Anvil chain (31337), got $chain_id" >&2
  exit 1
fi

forge script "$scenario" \
  --sig "runDeploy()" \
  --rpc-url "$rpc_url" \
  --broadcast \
  --slow \
  -vvv

# Stake checkpoints must exist in an earlier live block than launch.
cast rpc --rpc-url "$rpc_url" evm_mine >/dev/null

forge script "$scenario" \
  --sig "runLaunch()" \
  --rpc-url "$rpc_url" \
  --broadcast \
  --slow \
  -vvv

cast rpc --rpc-url "$rpc_url" evm_increaseTime 86401 >/dev/null
cast rpc --rpc-url "$rpc_url" evm_mine >/dev/null

forge script "$scenario" \
  --sig "runWindDown()" \
  --rpc-url "$rpc_url" \
  --broadcast \
  --slow \
  -vvv

boardroom="$(jq -er '.boardroom' "$checkpoint")"
release_b_hash="$(jq -er '.releaseBHash' "$checkpoint")"
migration_selector="$(cast sig 'StorageMigrationRequired(uint64,uint64)')"
set +e
migration_probe="$(
  cast call "$boardroom" \
    "returnProtocolLiquidityClaims(bytes32)(uint256)" \
    "$release_b_hash" \
    --rpc-url "$rpc_url" 2>&1
)"
migration_probe_status=$?
set -e
if [[ "$migration_probe_status" -eq 0 ]] || ! grep -qi "${migration_selector#0x}" <<<"$migration_probe"; then
  echo "expected the release-B pre-migration write probe to revert with $migration_selector" >&2
  echo "$migration_probe" >&2
  exit 1
fi

# The cancelled migrating curve has a 30-day unwind grace. This also exceeds
# the main Boardroom's one-day wind-down delay and bond vesting term.
cast rpc --rpc-url "$rpc_url" evm_increaseTime 2678401 >/dev/null
cast rpc --rpc-url "$rpc_url" evm_mine >/dev/null

forge script "$scenario" \
  --sig "runRedeem()" \
  --rpc-url "$rpc_url" \
  --broadcast \
  --slow \
  -vvv

curve_boardroom="$(jq -er '.curveBoardroom' "$checkpoint")"
graduated_curve_boardroom="$(jq -er '.graduatedCurveBoardroom' "$checkpoint")"
[[ "$(cast call "$boardroom" 'migrationRequired()(bool)' --rpc-url "$rpc_url")" == "false" ]]
[[ "$(cast call "$boardroom" 'activeObligationCount()(uint256)' --rpc-url "$rpc_url")" == "0" ]]
[[ "$(cast call "$curve_boardroom" 'activeObligationCount()(uint256)' --rpc-url "$rpc_url")" == "0" ]]
[[ "$(cast call "$graduated_curve_boardroom" 'activeObligationCount()(uint256)' --rpc-url "$rpc_url")" == "0" ]]
[[ "$(jq -er '.phase' "$checkpoint")" == "complete" ]]

echo "Boardroom Anvil scenario complete"
echo "checkpoint: $checkpoint"
echo "boardroom: $boardroom"
