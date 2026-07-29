// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Boardroom} from "../Boardroom.sol";
import {LegacyBoardroomFacet} from "./LegacyBoardroomFacet.sol";

contract BoardroomRedemptionFacet is LegacyBoardroomFacet {
    constructor(address legacyBoardroomLogic_) LegacyBoardroomFacet(legacyBoardroomLogic_) {}

    function beginSnapshot(bytes32) external {
        _delegateLegacy(Boardroom.beginSnapshot.selector);
    }

    function snapshotAssets(bytes32, uint256) external returns (uint256 processed) {
        processed = abi.decode(_delegateLegacy(Boardroom.snapshotAssets.selector), (uint256));
    }

    function openRedemptions(bytes32) external {
        _delegateLegacy(Boardroom.openRedemptions.selector);
    }

    function redeem(bytes32, uint256) external {
        _delegateLegacy(Boardroom.redeem.selector);
    }

    function claimRedemptionAsset(bytes32, address, address, uint256) external returns (uint256 amountOut) {
        amountOut = abi.decode(_delegateLegacy(Boardroom.claimRedemptionAsset.selector), (uint256));
    }

    function sweepRedemptionExcess(bytes32, address) external returns (uint256 amount) {
        amount = abi.decode(_delegateLegacy(Boardroom.sweepRedemptionExcess.selector), (uint256));
    }

    function burnTreasuryShares(bytes32) external returns (uint256 burned) {
        burned = abi.decode(_delegateLegacy(Boardroom.burnTreasuryShares.selector), (uint256));
    }
}
