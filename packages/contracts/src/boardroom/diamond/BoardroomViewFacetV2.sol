// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {BoardroomRedemptionStorage} from "../BoardroomRedemptionStorage.sol";
import {BoardroomReleaseBStorage} from "./BoardroomReleaseBStorage.sol";

/// @notice Release-B views proving that a selector can be replaced independently.
contract BoardroomViewFacetV2 {
    function redemptionCredits(address holder) external view returns (uint256) {
        return BoardroomRedemptionStorage.layout().credits[holder];
    }

    function releaseBMigrationState()
        external
        view
        returns (bytes32 migrationMarker, uint64 migratedAt, uint64 migratedFromVersion)
    {
        BoardroomReleaseBStorage.Layout storage releaseB = BoardroomReleaseBStorage.layout();
        return (releaseB.migrationMarker, releaseB.migratedAt, releaseB.migratedFromVersion);
    }
}
