// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {BoardroomGovernanceLogic} from "../../src/boardroom/BoardroomGovernanceLogic.sol";
import {BoardroomMarketLogic} from "../../src/boardroom/BoardroomMarketLogic.sol";
import {BoardroomPolicyRegistry} from "../../src/boardroom/BoardroomPolicyRegistry.sol";
import {BoardroomRedemptionPayout} from "../../src/boardroom/BoardroomRedemptionPayout.sol";
import {BoardroomFactory} from "../../src/boardroom/BoardroomFactory.sol";
import {IBoardroom} from "../../src/boardroom/IBoardroom.sol";
import {BoardroomAuthorityFacet} from "../../src/boardroom/diamond/BoardroomAuthorityFacet.sol";
import {BoardroomExecutionFacet} from "../../src/boardroom/diamond/BoardroomExecutionFacet.sol";
import {BoardroomKernel} from "../../src/boardroom/diamond/BoardroomKernel.sol";
import {BoardroomMarketFacet} from "../../src/boardroom/diamond/BoardroomMarketFacet.sol";
import {BoardroomRedemptionFacet} from "../../src/boardroom/diamond/BoardroomRedemptionFacet.sol";
import {BoardroomRelease} from "../../src/boardroom/diamond/BoardroomRelease.sol";
import {BoardroomReleaseBMigrationFacet} from "../../src/boardroom/diamond/BoardroomReleaseBMigrationFacet.sol";
import {BoardroomViewFacet} from "../../src/boardroom/diamond/BoardroomViewFacet.sol";
import {BoardroomViewFacetV2} from "../../src/boardroom/diamond/BoardroomViewFacetV2.sol";
import {ProtocolFacetRegistry} from "../../src/boardroom/diamond/ProtocolFacetRegistry.sol";
import {ProtocolFacetTypes} from "../../src/boardroom/diamond/ProtocolFacetTypes.sol";

/// @notice Shared release-A deployment fixture for tests that exercise a real canonical Boardroom.
abstract contract CanonicalBoardroomTestSetup is Test {
    mapping(address factory => bytes32 facetSetHash) internal canonicalFacetSetHash;
    mapping(address boardroom => bytes32 facetSetHash) internal canonicalBoardroomFacetSetHash;
    bytes32 internal canonicalDefaultFacetSetHash;

    function _deployCanonicalBoardroomFactory(BoardroomPolicyRegistry policyRegistry, address wrappedNative)
        internal
        returns (BoardroomFactory factory)
    {
        ProtocolFacetRegistry facetRegistry = new ProtocolFacetRegistry(address(this), _canonicalKernelSelectors());
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

        bytes32 releaseAHash = facetRegistry.publishFacetSet(BoardroomRelease.releaseA(facets));
        facetRegistry.activateFacetSet(releaseAHash);
        canonicalFacetSetHash[address(factory)] = releaseAHash;
        canonicalDefaultFacetSetHash = releaseAHash;
    }

    function _createCanonicalBoardroom(
        BoardroomFactory factory,
        address owner,
        string memory name,
        string memory symbol,
        bytes32 salt
    ) internal returns (IBoardroom boardroom) {
        boardroom = IBoardroom(
            payable(factory.createBoardroom(canonicalFacetSetHash[address(factory)], owner, name, symbol, salt))
        );
        canonicalBoardroomFacetSetHash[address(boardroom)] = canonicalFacetSetHash[address(factory)];
    }

    function _expectedFacetSetHash(IBoardroom boardroom) internal view returns (bytes32 facetSetHash) {
        facetSetHash = canonicalBoardroomFacetSetHash[address(boardroom)];
        if (facetSetHash == bytes32(0)) facetSetHash = canonicalDefaultFacetSetHash;
        assertNotEq(facetSetHash, bytes32(0), "unknown canonical Boardroom");
    }

    function _canonicalKernelSelectors() private pure returns (bytes4[] memory selectors) {
        selectors = new bytes4[](8);
        selectors[0] = bytes4(keccak256("facetRegistry()"));
        selectors[1] = bytes4(keccak256("facetSetHash()"));
        selectors[2] = BoardroomKernel.initialize.selector;
        selectors[3] = BoardroomKernel.appliedStorageVersion.selector;
        selectors[4] = BoardroomKernel.migrationRequired.selector;
        selectors[5] = BoardroomKernel.dispatchViewAndRollback.selector;
        selectors[6] = BoardroomKernel.appliedStorageLayoutHash.selector;
        selectors[7] = BoardroomKernel.kernelSelectorSetHash.selector;
        _sortSelectors(selectors);
    }

    function _sortSelectors(bytes4[] memory selectors) private pure {
        uint256 length = selectors.length;
        for (uint256 i = 1; i < length; ++i) {
            bytes4 key = selectors[i];
            uint256 j = i;
            while (j != 0 && selectors[j - 1] > key) {
                selectors[j] = selectors[j - 1];
                --j;
            }
            selectors[j] = key;
        }
    }
}
