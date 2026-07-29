// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Harmless additive state used to prove a release-pinned migration.
library BoardroomReleaseBStorage {
    /// @custom:storage-location erc7201:pledge.cash.boardroom.diamond.release-b
    bytes32 internal constant SLOT = 0x45aad03148d63fe1bba5aff232f7f8e070792feb8f1d2b0690530b9584175900;

    struct Layout {
        bytes32 migrationMarker;
        uint64 migratedAt;
        uint64 migratedFromVersion;
    }

    function layout() internal pure returns (Layout storage result) {
        bytes32 slot = SLOT;
        assembly ("memory-safe") {
            result.slot := slot
        }
    }
}
