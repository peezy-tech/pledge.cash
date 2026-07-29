// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Boardroom} from "../Boardroom.sol";
import {BoardroomCall} from "../IBoardroomGovernance.sol";
import {BoardroomAssetStorage} from "../storage/BoardroomAssetStorage.sol";
import {BoardroomLiquidityStorage} from "../storage/BoardroomLiquidityStorage.sol";
import {BoardroomObligationStorage} from "../storage/BoardroomObligationStorage.sol";
import {BoardroomPrimaryMarketStorage} from "../storage/BoardroomPrimaryMarketStorage.sol";

/// @notice Aggregate ABI for new release-bound Boardrooms.
/// @dev The kernel implements introspection and routes the remaining selectors
/// through the protocol facet registry.
interface IBoardroomDiamond {
    function MAX_BATCH_CALLS() external view returns (uint256);

    function MAX_SNAPSHOT_PAGE() external view returns (uint256);

    function MIN_WIND_DOWN_DELAY() external view returns (uint256);

    function MAX_WIND_DOWN_DELAY() external view returns (uint256);

    function initialize(bytes32 expectedFacetSetHash, bytes calldata initializationData) external;

    function facetRegistry() external view returns (address);

    function kernelSelectorSetHash() external view returns (bytes32);

    function facetSetHash() external view returns (bytes32);

    function appliedStorageVersion() external view returns (uint64);

    function appliedStorageLayoutHash() external view returns (bytes32);

    function migrationRequired() external view returns (bool);

    function migrateBoardroom(bytes32 expectedFacetSetHash) external;

    function releaseBMigrationState()
        external
        view
        returns (bytes32 migrationMarker, uint64 migratedAt, uint64 migratedFromVersion);

    function owner() external view returns (address);

    function policyRegistry() external view returns (address);

    function shareToken() external view returns (address);

    function wrappedNative() external view returns (address);

    function redemptionExcessRecipient() external view returns (address);

    function status() external view returns (Boardroom.BoardroomStatus);

    function launched() external view returns (bool);

    function controller() external view returns (address);

    function controllerGeneration() external view returns (uint256);

    function governanceEpoch() external view returns (uint256);

    function windDownDelay() external view returns (uint256);

    function windDownStartedAt() external view returns (uint256);

    function protectionStaker() external view returns (address);

    function rewardPool() external view returns (address);

    function governanceLogic() external view returns (address);

    function redemptionPayoutLogic() external view returns (address);

    function controllerFactory() external view returns (address);

    function marketLogic() external view returns (address);

    function ownershipHandoverExpiresAt(address pendingOwner) external view returns (uint256);

    function isControllerDeploymentAuthorized(
        address expectedController,
        address proposer,
        uint64 delay,
        uint64 gracePeriod,
        uint64 generation
    ) external view returns (bool);

    function requireBondingCurveForfeitureVetoPower(address account) external view;

    function transferOwnership(bytes32 expectedFacetSetHash, address newOwner) external payable;

    function completeOwnershipHandover(bytes32 expectedFacetSetHash, address pendingOwner) external payable;

    function requestOwnershipHandover(bytes32 expectedFacetSetHash) external payable;

    function cancelOwnershipHandover(bytes32 expectedFacetSetHash) external payable;

    function renounceOwnership(bytes32 expectedFacetSetHash) external payable;

    function launch(bytes32 expectedFacetSetHash, Boardroom.LaunchConfig calldata config) external;

    function replaceController(
        bytes32 expectedFacetSetHash,
        address expectedCurrentController,
        address expectedNextController,
        address nextProposer,
        uint64 nextDelay,
        uint64 nextGracePeriod,
        uint64 nextGeneration
    ) external;

    function veto(bytes32 expectedFacetSetHash, bytes32 operationId) external;

    function mint(bytes32 expectedFacetSetHash, address to, uint256 amount) external;

    function setRedemptionExcessRecipient(bytes32 expectedFacetSetHash, address recipient) external;

    function startWindDown(bytes32 expectedFacetSetHash) external;

    function execute(bytes32 expectedFacetSetHash, Boardroom.Call calldata call_)
        external
        payable
        returns (bytes memory result);

    function executeBatch(bytes32 expectedFacetSetHash, Boardroom.Call[] calldata calls)
        external
        payable
        returns (bytes[] memory results);

    function executeGovernance(
        bytes32 expectedFacetSetHash,
        uint256 expectedEpoch,
        address authority,
        BoardroomCall[] calldata calls
    ) external returns (bytes[] memory results);

    function executeWindDownCall(bytes32 expectedFacetSetHash, Boardroom.Call calldata call_)
        external
        returns (bytes memory result);

    function wrapNativeBalance(bytes32 expectedFacetSetHash) external;

    function reserveRedeemableAsset(bytes32 expectedFacetSetHash, address asset) external;

    function registerRedeemableAsset(bytes32 expectedFacetSetHash, address asset) external;

    function contributeTreasuryAsset(bytes32 expectedFacetSetHash, address asset, uint256 amount, uint256 deadline)
        external;

    function removeRedeemableAsset(bytes32 expectedFacetSetHash, address asset) external;

    function pruneObligation(bytes32 expectedFacetSetHash, address obligation) external returns (bool pruned);

    function pruneObligations(bytes32 expectedFacetSetHash, address[] calldata obligations)
        external
        returns (uint256 pruned);

    function recordGrantFromDistribution(bytes32 expectedFacetSetHash, address grant) external;

    function recordLockedLiquidityFromDistribution(bytes32 expectedFacetSetHash, address locker, address pool) external;

    function obligationOf(address obligation)
        external
        view
        returns (address policy, BoardroomObligationStorage.Kind kind, bool active, bool everRegistered);

    function obligationPolicyOf(address obligation) external view returns (address);

    function isIssuedGrant(address obligation) external view returns (bool);

    function isIssuedDistribution(address obligation) external view returns (bool);

    function isLockedLiquidity(address obligation) external view returns (bool);

    function activeObligationCount() external view returns (uint256);

    function activeObligationCountByKind(BoardroomObligationStorage.Kind kind) external view returns (uint256);

    function assetDependencyCount(address asset) external view returns (uint256);

    function obligationDependencyCount(address obligation) external view returns (uint256);

    function obligationDependencyAt(address obligation, uint256 index) external view returns (address);

    function beginSnapshot(bytes32 expectedFacetSetHash) external;

    function snapshotAssets(bytes32 expectedFacetSetHash, uint256 maximum) external returns (uint256 processed);

    function openRedemptions(bytes32 expectedFacetSetHash) external;

    function redeem(bytes32 expectedFacetSetHash, uint256 shares) external;

    function claimRedemptionAsset(bytes32 expectedFacetSetHash, address asset, address recipient, uint256 minAmountOut)
        external
        returns (uint256 amountOut);

    function sweepRedemptionExcess(bytes32 expectedFacetSetHash, address asset) external returns (uint256 amount);

    function burnTreasuryShares(bytes32 expectedFacetSetHash) external returns (uint256 burned);

    function redemptionCredits(address holder) external view returns (uint256);

    function allocatedRedemptionShares(address holder, address asset) external view returns (uint256);

    function redemptionAssetState(address asset) external view returns (uint256 snapshotBalance, uint256 paid);

    function redeemableAssetCount() external view returns (uint256);

    function redeemableAssetAt(uint256 index) external view returns (address);

    function redeemableAssetPage(uint256 cursor, uint256 size)
        external
        view
        returns (address[] memory page, uint256 nextCursor);

    function isRedeemableAsset(address asset) external view returns (bool);

    function redeemableAssetSnapshotStatus(address asset) external view returns (BoardroomAssetStorage.SnapshotStatus);

    function assetSnapshotProgress() external view returns (uint256 frozenCount, uint256 cursor, bool frozen);

    function redemptionSupplyState() external view returns (uint256 supply, bool frozen);

    function primaryMarketMode() external view returns (BoardroomPrimaryMarketStorage.Mode);

    function bondingCurve() external view returns (address);

    function primaryMarketQuoteAsset() external view returns (address);

    function liquidityStatus() external view returns (BoardroomLiquidityStorage.Status);

    function liquidityLocker() external view returns (address);

    function liquidityPool() external view returns (address);

    function liquidityQuoteAsset() external view returns (address);

    function liquidityReservation()
        external
        view
        returns (address curve, address expectedLocker, bytes32 pairKey, bytes32 salt, uint256 expiresAt);

    function precommitBondingCurve(
        bytes32 expectedFacetSetHash,
        address curve,
        address quoteAsset,
        uint256 fundingAmount
    ) external;

    function validatePrimaryMarketTransfer(bytes32 expectedFacetSetHash, address from, address to, uint256 amount)
        external;

    function precommitProtocolLiquidity(
        bytes32 expectedFacetSetHash,
        address expectedLocker,
        address quoteAsset,
        address curve,
        bytes32 pairKey,
        bytes32 salt,
        uint64 expiresAt
    ) external;

    function activateProtocolLiquidity(
        bytes32 expectedFacetSetHash,
        address locker,
        address pool,
        address quoteAsset,
        address curve,
        bytes32 pairKey,
        bytes32 salt
    ) external;

    function releaseProtocolLiquidityReservation(
        bytes32 expectedFacetSetHash,
        address curve,
        bytes32 pairKey,
        bytes32 salt
    ) external;

    function settleBondingCurve(bytes32 expectedFacetSetHash) external;

    function closeProtocolLiquidityFromFactory(bytes32 expectedFacetSetHash, address locker) external;

    function lockedLiquidityExitAllowed() external view returns (bool);

    function liquidityMutationAllowed() external view returns (bool);

    function exitProtocolLiquidity(
        bytes32 expectedFacetSetHash,
        uint256 amountAMin,
        uint256 amountBMin,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB, uint256 liquidity);

    function returnProtocolLiquidityAsLp(bytes32 expectedFacetSetHash) external returns (uint256 liquidity);

    function closeProtocolLiquidityAfterWindDown(bytes32 expectedFacetSetHash) external;
}
