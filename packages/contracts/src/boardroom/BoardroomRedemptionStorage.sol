// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

library BoardroomRedemptionStorage {
    /// @custom:storage-location erc7201:pledge.cash.boardroom.redemption.v2
    bytes32 internal constant SLOT = 0x65ab83fc5b67e9ee5441ff97d980cbe722cc41eb29d2cf1c3648298ee61cb500;

    struct Layout {
        uint256 supply;
        uint256 forfeitedShares;
        mapping(address holder => uint256 shares) credits;
        mapping(address asset => uint256 shares) allocatedShares;
        mapping(address holder => mapping(address asset => uint256 shares)) holderAllocatedShares;
        mapping(address asset => uint256 amount) snapshotBalance;
        mapping(address asset => uint256 amount) paid;
        bool supplyFrozen;
    }

    function layout() internal pure returns (Layout storage result) {
        bytes32 slot = SLOT;
        assembly ("memory-safe") {
            result.slot := slot
        }
    }
}
