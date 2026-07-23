// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

library BoardroomAssetStorage {
    /// @custom:storage-location erc7201:pledge.cash.boardroom.assets
    bytes32 internal constant SLOT = 0x0f593284fae247bb62b16a5f194a1eb59aae7a37807af650a38f5f02cc371a00;

    enum SnapshotStatus {
        Unprocessed,
        Included,
        Unreadable,
        Excluded
    }

    struct Layout {
        address[] registry;
        mapping(address asset => bool registered) isRegistered;
        mapping(address asset => bool seen) everRegistered;
        mapping(address asset => SnapshotStatus status) snapshotStatus;
        uint256 frozenCount;
        uint256 snapshotCursor;
        bool frozen;
    }

    function layout() internal pure returns (Layout storage result) {
        bytes32 slot = SLOT;
        assembly ("memory-safe") {
            result.slot := slot
        }
    }
}
