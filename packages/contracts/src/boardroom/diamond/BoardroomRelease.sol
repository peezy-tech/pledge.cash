// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {BoardroomAuthorityFacet} from "./BoardroomAuthorityFacet.sol";
import {BoardroomExecutionFacet} from "./BoardroomExecutionFacet.sol";
import {BoardroomMarketFacet} from "./BoardroomMarketFacet.sol";
import {BoardroomRedemptionFacet} from "./BoardroomRedemptionFacet.sol";
import {BoardroomStorageLayouts} from "./BoardroomStorageLayouts.sol";
import {IBoardroom} from "../IBoardroom.sol";
import {BoardroomManifestHashes} from "./BoardroomManifestHashes.sol";
import {ProtocolFacetTypes} from "./ProtocolFacetTypes.sol";

/// @notice Canonical release manifests used by local deployment and tests.
library BoardroomRelease {
    uint256 internal constant MAX_RELEASE_SELECTORS = 128;

    struct Facets {
        address authority;
        address execution;
        address market;
        address redemption;
        address viewFacet;
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
            storageLayoutHash: BoardroomStorageLayouts.RELEASE_A,
            manifestHash: BoardroomManifestHashes.RELEASE_A,
            routes: routes,
            migrationFacet: address(0),
            migrationSelector: bytes4(0)
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
        count = _addViews(routes, count, facets.viewFacet);
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
        return _add(
            routes,
            count,
            BoardroomExecutionFacet.pruneObligations.selector,
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
            BoardroomMarketFacet.validatePrimaryMarketTransfer.selector,
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
            BoardroomMarketFacet.returnProtocolLiquidityClaims.selector,
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

    function _addViews(ProtocolFacetTypes.RouteDefinition[] memory routes, uint256 count, address facet)
        private
        view
        returns (uint256)
    {
        count = _addView(routes, count, facet, IBoardroom.MAX_BATCH_CALLS.selector);
        count = _addView(routes, count, facet, IBoardroom.MAX_SNAPSHOT_PAGE.selector);
        count = _addView(routes, count, facet, IBoardroom.MAX_WIND_DOWN_DELAY.selector);
        count = _addView(routes, count, facet, IBoardroom.MIN_WIND_DOWN_DELAY.selector);
        count = _addView(routes, count, facet, IBoardroom.activeObligationCount.selector);
        count = _addView(routes, count, facet, IBoardroom.activeObligationCountByKind.selector);
        count = _addView(routes, count, facet, IBoardroom.allocatedRedemptionShares.selector);
        count = _addView(routes, count, facet, IBoardroom.assetDependencyCount.selector);
        count = _addView(routes, count, facet, IBoardroom.assetSnapshotProgress.selector);
        count = _addView(routes, count, facet, IBoardroom.bondingCurve.selector);
        count = _addView(routes, count, facet, IBoardroom.controller.selector);
        count = _addView(routes, count, facet, IBoardroom.controllerFactory.selector);
        count = _addView(routes, count, facet, IBoardroom.controllerGeneration.selector);
        count = _addView(routes, count, facet, IBoardroom.governanceEpoch.selector);
        count = _addView(routes, count, facet, IBoardroom.governanceLogic.selector);
        count = _addView(routes, count, facet, IBoardroom.isControllerDeploymentAuthorized.selector);
        count = _addView(routes, count, facet, IBoardroom.isIssuedDistribution.selector);
        count = _addView(routes, count, facet, IBoardroom.isIssuedGrant.selector);
        count = _addView(routes, count, facet, IBoardroom.isLockedLiquidity.selector);
        count = _addView(routes, count, facet, IBoardroom.isRedeemableAsset.selector);
        count = _addView(routes, count, facet, IBoardroom.launched.selector);
        count = _addView(routes, count, facet, IBoardroom.liquidityVault.selector);
        count = _addView(routes, count, facet, IBoardroom.liquidityMutationAllowed.selector);
        count = _addView(routes, count, facet, IBoardroom.liquidityPoolId.selector);
        count = _addView(routes, count, facet, IBoardroom.liquidityQuoteAsset.selector);
        count = _addView(routes, count, facet, IBoardroom.liquidityStatus.selector);
        count = _addView(routes, count, facet, IBoardroom.lockedLiquidityExitAllowed.selector);
        count = _addView(routes, count, facet, IBoardroom.marketLogic.selector);
        count = _addView(routes, count, facet, IBoardroom.obligationDependencyAt.selector);
        count = _addView(routes, count, facet, IBoardroom.obligationDependencyCount.selector);
        count = _addView(routes, count, facet, IBoardroom.obligationOf.selector);
        count = _addView(routes, count, facet, IBoardroom.obligationPolicyOf.selector);
        count = _addView(routes, count, facet, IBoardroom.owner.selector);
        count = _addView(routes, count, facet, IBoardroom.ownershipHandoverExpiresAt.selector);
        count = _addView(routes, count, facet, IBoardroom.policyRegistry.selector);
        count = _addView(routes, count, facet, IBoardroom.primaryMarketMode.selector);
        count = _addView(routes, count, facet, IBoardroom.primaryMarketQuoteAsset.selector);
        count = _addView(routes, count, facet, IBoardroom.protectionStaker.selector);
        count = _addView(routes, count, facet, IBoardroom.redeemableAssetAt.selector);
        count = _addView(routes, count, facet, IBoardroom.redeemableAssetCount.selector);
        count = _addView(routes, count, facet, IBoardroom.redeemableAssetPage.selector);
        count = _addView(routes, count, facet, IBoardroom.redeemableAssetSnapshotStatus.selector);
        count = _addView(routes, count, facet, IBoardroom.redemptionAssetState.selector);
        count = _addView(routes, count, facet, IBoardroom.redemptionCredits.selector);
        count = _addView(routes, count, facet, IBoardroom.redemptionExcessRecipient.selector);
        count = _addView(routes, count, facet, IBoardroom.redemptionPayoutLogic.selector);
        count = _addView(routes, count, facet, IBoardroom.redemptionSupplyState.selector);
        count = _addView(routes, count, facet, IBoardroom.requireBondingCurveForfeitureVetoPower.selector);
        count = _addView(routes, count, facet, IBoardroom.rewardPool.selector);
        count = _addView(routes, count, facet, IBoardroom.shareToken.selector);
        count = _addView(routes, count, facet, IBoardroom.status.selector);
        count = _addView(routes, count, facet, IBoardroom.windDownDelay.selector);
        count = _addView(routes, count, facet, IBoardroom.windDownStartedAt.selector);
        return _addView(routes, count, facet, IBoardroom.wrappedNative.selector);
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
