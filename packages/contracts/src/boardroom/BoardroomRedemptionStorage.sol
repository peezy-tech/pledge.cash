// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

library BoardroomRedemptionStorage {
    bytes32 internal constant SLOT = keccak256("pledge.cash.boardroom.redemption.v1");

    struct Layout {
        uint256 supply;
        uint256 forfeitedShares;
        mapping(address holder => uint256 shares) credits;
        mapping(address asset => uint256 shares) allocatedShares;
        mapping(address holder => mapping(address asset => uint256 shares)) holderAllocatedShares;
    }

    function layout() internal pure returns (Layout storage result) {
        bytes32 slot = SLOT;
        assembly {
            result.slot := slot
        }
    }
}
