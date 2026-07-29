// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Boardroom} from "../Boardroom.sol";
import {BoardroomAuthorityFacet} from "./BoardroomAuthorityFacet.sol";
import {BoardroomExecutionFacet} from "./BoardroomExecutionFacet.sol";
import {BoardroomMarketFacet} from "./BoardroomMarketFacet.sol";
import {BoardroomRedemptionFacet} from "./BoardroomRedemptionFacet.sol";
import {BoardroomReleaseBMigrationFacet} from "./BoardroomReleaseBMigrationFacet.sol";
import {BoardroomViewFacetV2} from "./BoardroomViewFacetV2.sol";
import {BoardroomVNextStorageLayouts} from "./BoardroomVNextStorageLayouts.sol";
import {IBoardroomDiamond} from "./BoardroomDiamond.sol";
import {BoardroomVNextManifestHashes} from "./BoardroomVNextManifestHashes.sol";
import {ProtocolFacetTypes} from "./ProtocolFacetTypes.sol";

/// @notice Canonical release manifests used by local deployment and tests.
library BoardroomVNextRelease {
    uint256 internal constant MAX_RELEASE_SELECTORS = 128;

    struct Facets {
        address authority;
        address execution;
        address market;
        address redemption;
        address viewFacet;
        address migration;
        address viewV2;
    }

    function releaseA(Facets memory facets)
        internal
        view
        returns (ProtocolFacetTypes.FacetSetManifest memory manifest)
    {
        (ProtocolFacetTypes.RouteDefinition[] memory routes, uint256 count) = _baseRoutes(facets);
        _truncateAndSort(routes, count);
        manifest = ProtocolFacetTypes.FacetSetManifest({
            release: 1,
            requiredStorageVersion: 1,
            predecessorFacetSetHash: bytes32(0),
            storageLayoutHash: BoardroomVNextStorageLayouts.RELEASE_A,
            manifestHash: BoardroomVNextManifestHashes.RELEASE_A,
            routes: routes,
            migrationFacet: address(0),
            migrationSelector: bytes4(0)
        });
    }

    function releaseB(Facets memory facets, bytes32 predecessorFacetSetHash)
        internal
        view
        returns (ProtocolFacetTypes.FacetSetManifest memory manifest)
    {
        (ProtocolFacetTypes.RouteDefinition[] memory routes, uint256 count) = _baseRoutes(facets);
        count = _replaceFacet(
            routes,
            count,
            BoardroomViewFacetV2.redemptionCredits.selector,
            facets.viewV2,
            ProtocolFacetTypes.RouteKind.View
        );
        count = _add(
            routes,
            count,
            BoardroomViewFacetV2.releaseBMigrationState.selector,
            facets.viewV2,
            ProtocolFacetTypes.RouteKind.View
        );
        count = _add(
            routes,
            count,
            BoardroomReleaseBMigrationFacet.migrateBoardroom.selector,
            facets.migration,
            ProtocolFacetTypes.RouteKind.Migration
        );
        _truncateAndSort(routes, count);
        manifest = ProtocolFacetTypes.FacetSetManifest({
            release: 2,
            requiredStorageVersion: 2,
            predecessorFacetSetHash: predecessorFacetSetHash,
            storageLayoutHash: BoardroomVNextStorageLayouts.RELEASE_B,
            manifestHash: BoardroomVNextManifestHashes.RELEASE_B,
            routes: routes,
            migrationFacet: facets.migration,
            migrationSelector: BoardroomReleaseBMigrationFacet.migrateBoardroom.selector
        });
    }

    function _baseRoutes(Facets memory facets)
        private
        view
        returns (ProtocolFacetTypes.RouteDefinition[] memory routes, uint256 count)
    {
        routes = new ProtocolFacetTypes.RouteDefinition[](MAX_RELEASE_SELECTORS);

        count = _add(
            routes,
            count,
            BoardroomAuthorityFacet.initializeBoardroom.selector,
            facets.authority,
            ProtocolFacetTypes.RouteKind.Mutating
        );
        count = _addMutatingAuthority(routes, count, facets.authority);
        count = _addMutatingExecution(routes, count, facets.execution);
        count = _addMutatingMarket(routes, count, facets.market);
        count = _addMutatingRedemption(routes, count, facets.redemption);
        count = _addLegacyViews(routes, count, facets.viewFacet);
    }

    function _addMutatingAuthority(ProtocolFacetTypes.RouteDefinition[] memory routes, uint256 count, address facet)
        private
        view
        returns (uint256)
    {
        count = _add(
            routes,
            count,
            BoardroomAuthorityFacet.transferOwnership.selector,
            facet,
            ProtocolFacetTypes.RouteKind.Mutating
        );
        count = _add(
            routes,
            count,
            BoardroomAuthorityFacet.completeOwnershipHandover.selector,
            facet,
            ProtocolFacetTypes.RouteKind.Mutating
        );
        count = _add(
            routes,
            count,
            BoardroomAuthorityFacet.requestOwnershipHandover.selector,
            facet,
            ProtocolFacetTypes.RouteKind.Mutating
        );
        count = _add(
            routes,
            count,
            BoardroomAuthorityFacet.cancelOwnershipHandover.selector,
            facet,
            ProtocolFacetTypes.RouteKind.Mutating
        );
        count = _add(
            routes,
            count,
            BoardroomAuthorityFacet.renounceOwnership.selector,
            facet,
            ProtocolFacetTypes.RouteKind.Mutating
        );
        count =
            _add(routes, count, BoardroomAuthorityFacet.launch.selector, facet, ProtocolFacetTypes.RouteKind.Mutating);
        count = _add(
            routes,
            count,
            BoardroomAuthorityFacet.replaceController.selector,
            facet,
            ProtocolFacetTypes.RouteKind.Mutating
        );
        count = _add(routes, count, BoardroomAuthorityFacet.veto.selector, facet, ProtocolFacetTypes.RouteKind.Mutating);
        count = _add(routes, count, BoardroomAuthorityFacet.mint.selector, facet, ProtocolFacetTypes.RouteKind.Mutating);
        count = _add(
            routes,
            count,
            BoardroomAuthorityFacet.setRedemptionExcessRecipient.selector,
            facet,
            ProtocolFacetTypes.RouteKind.Mutating
        );
        return _add(
            routes, count, BoardroomAuthorityFacet.startWindDown.selector, facet, ProtocolFacetTypes.RouteKind.Mutating
        );
    }

    function _addMutatingExecution(ProtocolFacetTypes.RouteDefinition[] memory routes, uint256 count, address facet)
        private
        view
        returns (uint256)
    {
        count =
            _add(routes, count, BoardroomExecutionFacet.execute.selector, facet, ProtocolFacetTypes.RouteKind.Mutating);
        count = _add(
            routes, count, BoardroomExecutionFacet.executeBatch.selector, facet, ProtocolFacetTypes.RouteKind.Mutating
        );
        count = _add(
            routes,
            count,
            BoardroomExecutionFacet.executeGovernance.selector,
            facet,
            ProtocolFacetTypes.RouteKind.Mutating
        );
        count = _add(
            routes,
            count,
            BoardroomExecutionFacet.executeWindDownCall.selector,
            facet,
            ProtocolFacetTypes.RouteKind.Mutating
        );
        count = _add(
            routes,
            count,
            BoardroomExecutionFacet.wrapNativeBalance.selector,
            facet,
            ProtocolFacetTypes.RouteKind.Mutating
        );
        count = _add(
            routes,
            count,
            BoardroomExecutionFacet.reserveRedeemableAsset.selector,
            facet,
            ProtocolFacetTypes.RouteKind.Mutating
        );
        count = _add(
            routes,
            count,
            BoardroomExecutionFacet.registerRedeemableAsset.selector,
            facet,
            ProtocolFacetTypes.RouteKind.Mutating
        );
        count = _add(
            routes,
            count,
            BoardroomExecutionFacet.contributeTreasuryAsset.selector,
            facet,
            ProtocolFacetTypes.RouteKind.Mutating
        );
        count = _add(
            routes,
            count,
            BoardroomExecutionFacet.removeRedeemableAsset.selector,
            facet,
            ProtocolFacetTypes.RouteKind.Mutating
        );
        count = _add(
            routes,
            count,
            BoardroomExecutionFacet.pruneObligation.selector,
            facet,
            ProtocolFacetTypes.RouteKind.Mutating
        );
        count = _add(
            routes,
            count,
            BoardroomExecutionFacet.pruneObligations.selector,
            facet,
            ProtocolFacetTypes.RouteKind.Mutating
        );
        count = _add(
            routes,
            count,
            BoardroomExecutionFacet.recordGrantFromDistribution.selector,
            facet,
            ProtocolFacetTypes.RouteKind.Mutating
        );
        return _add(
            routes,
            count,
            BoardroomExecutionFacet.recordLockedLiquidityFromDistribution.selector,
            facet,
            ProtocolFacetTypes.RouteKind.Mutating
        );
    }

    function _addMutatingMarket(ProtocolFacetTypes.RouteDefinition[] memory routes, uint256 count, address facet)
        private
        view
        returns (uint256)
    {
        count = _add(
            routes,
            count,
            BoardroomMarketFacet.precommitBondingCurve.selector,
            facet,
            ProtocolFacetTypes.RouteKind.Mutating
        );
        count = _add(
            routes,
            count,
            BoardroomMarketFacet.validatePrimaryMarketTransfer.selector,
            facet,
            ProtocolFacetTypes.RouteKind.Mutating
        );
        count = _add(
            routes,
            count,
            BoardroomMarketFacet.precommitProtocolLiquidity.selector,
            facet,
            ProtocolFacetTypes.RouteKind.Mutating
        );
        count = _add(
            routes,
            count,
            BoardroomMarketFacet.activateProtocolLiquidity.selector,
            facet,
            ProtocolFacetTypes.RouteKind.Mutating
        );
        count = _add(
            routes,
            count,
            BoardroomMarketFacet.releaseProtocolLiquidityReservation.selector,
            facet,
            ProtocolFacetTypes.RouteKind.Mutating
        );
        count = _add(
            routes,
            count,
            BoardroomMarketFacet.settleBondingCurve.selector,
            facet,
            ProtocolFacetTypes.RouteKind.Mutating
        );
        count = _add(
            routes,
            count,
            BoardroomMarketFacet.closeProtocolLiquidityFromFactory.selector,
            facet,
            ProtocolFacetTypes.RouteKind.Mutating
        );
        count = _add(
            routes,
            count,
            BoardroomMarketFacet.exitProtocolLiquidity.selector,
            facet,
            ProtocolFacetTypes.RouteKind.Mutating
        );
        count = _add(
            routes,
            count,
            BoardroomMarketFacet.returnProtocolLiquidityAsLp.selector,
            facet,
            ProtocolFacetTypes.RouteKind.Mutating
        );
        return _add(
            routes,
            count,
            BoardroomMarketFacet.closeProtocolLiquidityAfterWindDown.selector,
            facet,
            ProtocolFacetTypes.RouteKind.Mutating
        );
    }

    function _addMutatingRedemption(ProtocolFacetTypes.RouteDefinition[] memory routes, uint256 count, address facet)
        private
        view
        returns (uint256)
    {
        count = _add(
            routes, count, BoardroomRedemptionFacet.beginSnapshot.selector, facet, ProtocolFacetTypes.RouteKind.Mutating
        );
        count = _add(
            routes,
            count,
            BoardroomRedemptionFacet.snapshotAssets.selector,
            facet,
            ProtocolFacetTypes.RouteKind.Mutating
        );
        count = _add(
            routes,
            count,
            BoardroomRedemptionFacet.openRedemptions.selector,
            facet,
            ProtocolFacetTypes.RouteKind.Mutating
        );
        count =
            _add(routes, count, BoardroomRedemptionFacet.redeem.selector, facet, ProtocolFacetTypes.RouteKind.Mutating);
        count = _add(
            routes,
            count,
            BoardroomRedemptionFacet.claimRedemptionAsset.selector,
            facet,
            ProtocolFacetTypes.RouteKind.Mutating
        );
        count = _add(
            routes,
            count,
            BoardroomRedemptionFacet.sweepRedemptionExcess.selector,
            facet,
            ProtocolFacetTypes.RouteKind.Mutating
        );
        return _add(
            routes,
            count,
            BoardroomRedemptionFacet.burnTreasuryShares.selector,
            facet,
            ProtocolFacetTypes.RouteKind.Mutating
        );
    }

    function _addLegacyViews(ProtocolFacetTypes.RouteDefinition[] memory routes, uint256 count, address facet)
        private
        view
        returns (uint256)
    {
        count = _addView(routes, count, facet, IBoardroomDiamond.MAX_BATCH_CALLS.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.MAX_SNAPSHOT_PAGE.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.MAX_WIND_DOWN_DELAY.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.MIN_WIND_DOWN_DELAY.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.activeObligationCount.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.activeObligationCountByKind.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.allocatedRedemptionShares.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.assetDependencyCount.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.assetSnapshotProgress.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.bondingCurve.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.controller.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.controllerFactory.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.controllerGeneration.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.governanceEpoch.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.governanceLogic.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.isControllerDeploymentAuthorized.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.isIssuedDistribution.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.isIssuedGrant.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.isLockedLiquidity.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.isRedeemableAsset.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.launched.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.liquidityLocker.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.liquidityMutationAllowed.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.liquidityPool.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.liquidityQuoteAsset.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.liquidityReservation.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.liquidityStatus.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.lockedLiquidityExitAllowed.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.marketLogic.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.obligationDependencyAt.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.obligationDependencyCount.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.obligationOf.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.obligationPolicyOf.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.owner.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.ownershipHandoverExpiresAt.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.policyRegistry.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.primaryMarketMode.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.primaryMarketQuoteAsset.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.protectionStaker.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.redeemableAssetAt.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.redeemableAssetCount.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.redeemableAssetPage.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.redeemableAssetSnapshotStatus.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.redemptionAssetState.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.redemptionCredits.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.redemptionExcessRecipient.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.redemptionPayoutLogic.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.redemptionSupplyState.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.requireBondingCurveForfeitureVetoPower.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.rewardPool.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.shareToken.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.status.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.windDownDelay.selector);
        count = _addView(routes, count, facet, IBoardroomDiamond.windDownStartedAt.selector);
        return _addView(routes, count, facet, IBoardroomDiamond.wrappedNative.selector);
    }

    function _addView(ProtocolFacetTypes.RouteDefinition[] memory routes, uint256 count, address facet, bytes4 selector)
        private
        view
        returns (uint256)
    {
        return _add(routes, count, selector, facet, ProtocolFacetTypes.RouteKind.View);
    }

    function _add(
        ProtocolFacetTypes.RouteDefinition[] memory routes,
        uint256 count,
        bytes4 selector,
        address facet,
        ProtocolFacetTypes.RouteKind kind
    ) private view returns (uint256) {
        routes[count] = ProtocolFacetTypes.RouteDefinition({
            selector: selector, facet: facet, codeHash: facet.codehash, kind: kind
        });
        return count + 1;
    }

    function _replaceFacet(
        ProtocolFacetTypes.RouteDefinition[] memory routes,
        uint256 count,
        bytes4 selector,
        address facet,
        ProtocolFacetTypes.RouteKind kind
    ) private view returns (uint256) {
        for (uint256 i; i < count; ++i) {
            if (routes[i].selector == selector) {
                routes[i].facet = facet;
                routes[i].codeHash = facet.codehash;
                routes[i].kind = kind;
                return count;
            }
        }
        return _add(routes, count, selector, facet, kind);
    }

    function _truncateAndSort(ProtocolFacetTypes.RouteDefinition[] memory routes, uint256 count) private pure {
        assembly ("memory-safe") {
            mstore(routes, count)
        }
        for (uint256 i = 1; i < count; ++i) {
            ProtocolFacetTypes.RouteDefinition memory current = routes[i];
            uint256 j = i;
            while (j != 0 && routes[j - 1].selector > current.selector) {
                routes[j] = routes[j - 1];
                --j;
            }
            routes[j] = current;
        }
    }
}
