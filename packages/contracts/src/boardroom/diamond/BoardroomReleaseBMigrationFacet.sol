// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {BoardroomDiamondStorage} from "./BoardroomDiamondStorage.sol";
import {BoardroomReleaseBStorage} from "./BoardroomReleaseBStorage.sol";
import {BoardroomVNextStorageLayouts} from "./BoardroomVNextStorageLayouts.sol";

/// @notice Release-A to release-B migration used by the integrated spike.
contract BoardroomReleaseBMigrationFacet {
    uint64 internal constant FROM_VERSION = 1;
    uint64 internal constant TO_VERSION = 2;
    bytes32 internal constant RELEASE_B_MARKER = keccak256("pledge.cash.boardroom.diamond.release-b");

    error UnsupportedMigrationSource(
        uint64 actualVersion, bytes32 actualLayoutHash, uint64 expectedVersion, bytes32 expectedLayoutHash
    );

    function migrateBoardroom(bytes32) external {
        uint64 current = BoardroomDiamondStorage.appliedStorageVersion();
        bytes32 currentLayoutHash = BoardroomDiamondStorage.appliedStorageLayoutHash();
        bool genesis = BoardroomDiamondStorage.initializing() && current == 0 && currentLayoutHash == bytes32(0);
        bool releaseA = current == FROM_VERSION && currentLayoutHash == BoardroomVNextStorageLayouts.RELEASE_A;
        if (!genesis && !releaseA) {
            revert UnsupportedMigrationSource(
                current, currentLayoutHash, FROM_VERSION, BoardroomVNextStorageLayouts.RELEASE_A
            );
        }

        BoardroomReleaseBStorage.Layout storage releaseB = BoardroomReleaseBStorage.layout();
        releaseB.migrationMarker = RELEASE_B_MARKER;
        releaseB.migratedAt = uint64(block.timestamp);
        releaseB.migratedFromVersion = current;
        BoardroomDiamondStorage.setAppliedStorage(TO_VERSION, BoardroomVNextStorageLayouts.RELEASE_B);
    }
}
