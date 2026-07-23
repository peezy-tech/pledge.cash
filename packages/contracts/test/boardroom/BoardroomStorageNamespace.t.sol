// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {BoardroomRedemptionStorage} from "../../src/boardroom/BoardroomRedemptionStorage.sol";
import {BoardroomAssetStorage} from "../../src/boardroom/storage/BoardroomAssetStorage.sol";
import {BoardroomCoreStorage} from "../../src/boardroom/storage/BoardroomCoreStorage.sol";
import {BoardroomLiquidityStorage} from "../../src/boardroom/storage/BoardroomLiquidityStorage.sol";
import {BoardroomObligationStorage} from "../../src/boardroom/storage/BoardroomObligationStorage.sol";
import {BoardroomPrimaryMarketStorage} from "../../src/boardroom/storage/BoardroomPrimaryMarketStorage.sol";

contract BoardroomStorageNamespaceHarness {
    function slots()
        external
        pure
        returns (
            bytes32 coreSlot,
            bytes32 obligationSlot,
            bytes32 assetSlot,
            bytes32 primaryMarketSlot,
            bytes32 liquiditySlot,
            bytes32 redemptionSlot
        )
    {
        BoardroomCoreStorage.Layout storage core = BoardroomCoreStorage.layout();
        BoardroomObligationStorage.Layout storage obligations = BoardroomObligationStorage.layout();
        BoardroomAssetStorage.Layout storage assets = BoardroomAssetStorage.layout();
        BoardroomPrimaryMarketStorage.Layout storage primaryMarket = BoardroomPrimaryMarketStorage.layout();
        BoardroomLiquidityStorage.Layout storage liquidity = BoardroomLiquidityStorage.layout();
        BoardroomRedemptionStorage.Layout storage redemption = BoardroomRedemptionStorage.layout();
        assembly ("memory-safe") {
            coreSlot := core.slot
            obligationSlot := obligations.slot
            assetSlot := assets.slot
            primaryMarketSlot := primaryMarket.slot
            liquiditySlot := liquidity.slot
            redemptionSlot := redemption.slot
        }
    }

    function writeEveryConcern() external {
        BoardroomCoreStorage.layout().governanceEpoch = 11;
        BoardroomObligationStorage.layout().activeCount = 22;
        BoardroomAssetStorage.layout().frozenCount = 33;
        BoardroomPrimaryMarketStorage.layout().authorizedBoardroomFunding = 44;
        BoardroomLiquidityStorage.layout().pool = address(0x5555);
        BoardroomRedemptionStorage.layout().supply = 66;
    }

    function readEveryConcern()
        external
        view
        returns (
            uint256 governanceEpoch,
            uint256 activeObligations,
            uint256 frozenAssets,
            uint256 authorizedFunding,
            address liquidityPool,
            uint256 redemptionSupply
        )
    {
        governanceEpoch = BoardroomCoreStorage.layout().governanceEpoch;
        activeObligations = BoardroomObligationStorage.layout().activeCount;
        frozenAssets = BoardroomAssetStorage.layout().frozenCount;
        authorizedFunding = BoardroomPrimaryMarketStorage.layout().authorizedBoardroomFunding;
        liquidityPool = BoardroomLiquidityStorage.layout().pool;
        redemptionSupply = BoardroomRedemptionStorage.layout().supply;
    }
}

contract BoardroomStorageNamespaceTest is Test {
    function testDelegatedConcernsUseDistinctExactErc7201Namespaces() public {
        BoardroomStorageNamespaceHarness harness = new BoardroomStorageNamespaceHarness();
        bytes32[6] memory actual;
        (actual[0], actual[1], actual[2], actual[3], actual[4], actual[5]) = harness.slots();

        assertEq(actual[0], _erc7201("pledge.cash.boardroom.core"));
        assertEq(actual[1], _erc7201("pledge.cash.boardroom.obligations"));
        assertEq(actual[2], _erc7201("pledge.cash.boardroom.assets"));
        assertEq(actual[3], _erc7201("pledge.cash.boardroom.primary-market"));
        assertEq(actual[4], _erc7201("pledge.cash.boardroom.liquidity"));
        assertEq(actual[5], _erc7201("pledge.cash.boardroom.redemption.v2"));
        for (uint256 i; i < actual.length; ++i) {
            assertEq(uint256(actual[i]) & 0xff, 0);
            for (uint256 j = i + 1; j < actual.length; ++j) {
                assertNotEq(actual[i], actual[j]);
            }
        }

        harness.writeEveryConcern();
        (
            uint256 governanceEpoch,
            uint256 activeObligations,
            uint256 frozenAssets,
            uint256 authorizedFunding,
            address liquidityPool,
            uint256 redemptionSupply
        ) = harness.readEveryConcern();
        assertEq(governanceEpoch, 11);
        assertEq(activeObligations, 22);
        assertEq(frozenAssets, 33);
        assertEq(authorizedFunding, 44);
        assertEq(liquidityPool, address(0x5555));
        assertEq(redemptionSupply, 66);
    }

    function _erc7201(string memory namespace) internal pure returns (bytes32) {
        uint256 namespaceHash = uint256(keccak256(bytes(namespace)));
        return bytes32(uint256(keccak256(abi.encode(namespaceHash - 1))) & ~uint256(0xff));
    }
}
