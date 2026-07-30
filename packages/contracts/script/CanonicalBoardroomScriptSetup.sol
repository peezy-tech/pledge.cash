// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {BoardroomGovernanceLogic} from "../src/boardroom/BoardroomGovernanceLogic.sol";
import {BoardroomMarketLogic} from "../src/boardroom/BoardroomMarketLogic.sol";
import {BoardroomPolicyRegistry} from "../src/boardroom/BoardroomPolicyRegistry.sol";
import {BoardroomRedemptionPayout} from "../src/boardroom/BoardroomRedemptionPayout.sol";
import {BoardroomFactory} from "../src/boardroom/BoardroomFactory.sol";
import {BoardroomAuthorityFacet} from "../src/boardroom/diamond/BoardroomAuthorityFacet.sol";
import {BoardroomExecutionFacet} from "../src/boardroom/diamond/BoardroomExecutionFacet.sol";
import {BoardroomKernel} from "../src/boardroom/diamond/BoardroomKernel.sol";
import {BoardroomMarketFacet} from "../src/boardroom/diamond/BoardroomMarketFacet.sol";
import {BoardroomRedemptionFacet} from "../src/boardroom/diamond/BoardroomRedemptionFacet.sol";
import {BoardroomRelease} from "../src/boardroom/diamond/BoardroomRelease.sol";
import {BoardroomReleaseBMigrationFacet} from "../src/boardroom/diamond/BoardroomReleaseBMigrationFacet.sol";
import {BoardroomViewFacet} from "../src/boardroom/diamond/BoardroomViewFacet.sol";
import {BoardroomViewFacetV2} from "../src/boardroom/diamond/BoardroomViewFacetV2.sol";
import {ProtocolFacetRegistry} from "../src/boardroom/diamond/ProtocolFacetRegistry.sol";

/// @notice Shared release-A bootstrap for local scripts that deploy an isolated Boardroom protocol.
abstract contract CanonicalBoardroomScriptSetup is Script {
    function _deployCanonicalBoardroomFactory(
        address registryOwner,
        BoardroomPolicyRegistry policyRegistry,
        address wrappedNative
    ) internal returns (BoardroomFactory factory, bytes32 releaseAHash) {
        ProtocolFacetRegistry facetRegistry = new ProtocolFacetRegistry(registryOwner, _canonicalKernelSelectors());
        BoardroomKernel kernel = new BoardroomKernel(address(facetRegistry));
        BoardroomRedemptionPayout redemptionPayout = new BoardroomRedemptionPayout();
        BoardroomGovernanceLogic governanceLogic = new BoardroomGovernanceLogic();
        BoardroomMarketLogic marketLogic = new BoardroomMarketLogic();

        factory = new BoardroomFactory(
            address(facetRegistry),
            address(policyRegistry),
            wrappedNative,
            address(kernel),
            address(redemptionPayout),
            address(governanceLogic),
            address(marketLogic)
        );

        address controllerFactory = factory.controllerFactory();
        BoardroomRelease.Facets memory facets;
        facets.authority = address(
            new BoardroomAuthorityFacet(
                address(redemptionPayout), address(governanceLogic), controllerFactory, address(marketLogic)
            )
        );
        facets.execution = address(
            new BoardroomExecutionFacet(
                address(redemptionPayout), address(governanceLogic), controllerFactory, address(marketLogic)
            )
        );
        facets.market = address(
            new BoardroomMarketFacet(
                address(redemptionPayout), address(governanceLogic), controllerFactory, address(marketLogic)
            )
        );
        facets.redemption = address(
            new BoardroomRedemptionFacet(
                address(redemptionPayout), address(governanceLogic), controllerFactory, address(marketLogic)
            )
        );
        facets.viewFacet = address(
            new BoardroomViewFacet(
                address(redemptionPayout), address(governanceLogic), controllerFactory, address(marketLogic)
            )
        );
        facets.migration = address(new BoardroomReleaseBMigrationFacet());
        facets.viewV2 = address(new BoardroomViewFacetV2());

        releaseAHash = facetRegistry.publishFacetSet(BoardroomRelease.releaseA(facets));
        facetRegistry.activateFacetSet(releaseAHash);
    }

    function _canonicalKernelSelectors() private pure returns (bytes4[] memory selectors) {
        selectors = new bytes4[](8);
        selectors[0] = bytes4(keccak256("facetRegistry()"));
        selectors[1] = bytes4(keccak256("facetSetHash()"));
        selectors[2] = BoardroomKernel.initialize.selector;
        selectors[3] = BoardroomKernel.appliedStorageVersion.selector;
        selectors[4] = BoardroomKernel.migrationRequired.selector;
        selectors[5] = bytes4(keccak256("viewDispatcher()"));
        selectors[6] = BoardroomKernel.appliedStorageLayoutHash.selector;
        selectors[7] = BoardroomKernel.kernelSelectorSetHash.selector;
        for (uint256 i = 1; i < selectors.length; ++i) {
            bytes4 current = selectors[i];
            uint256 j = i;
            while (j != 0 && selectors[j - 1] > current) {
                selectors[j] = selectors[j - 1];
                --j;
            }
            selectors[j] = current;
        }
    }
}
