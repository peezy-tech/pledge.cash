// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

library BoardroomLiquidityStorage {
    /// @custom:storage-location erc7201:pledge.cash.boardroom.liquidity
    bytes32 internal constant SLOT = 0x40f6d0bbd6c367f2533636fbb7a52e6f6dded433361d650706b88b12b02a4700;

    enum Status {
        Unconfigured,
        Active,
        Closed
    }

    struct MigrationReservation {
        address curve;
        address expectedLocker;
        bytes32 pairKey;
        bytes32 salt;
        uint64 expiresAt;
    }

    struct Layout {
        Status status;
        address locker;
        address pool;
        address quoteAsset;
        MigrationReservation pendingMigration;
    }

    function layout() internal pure returns (Layout storage result) {
        bytes32 slot = SLOT;
        assembly ("memory-safe") {
            result.slot := slot
        }
    }
}
