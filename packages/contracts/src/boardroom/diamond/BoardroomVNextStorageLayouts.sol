// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Auditable commitments for the complete Boardroom storage schemas
/// supported by the prototype releases.
library BoardroomVNextStorageLayouts {
    bytes32 internal constant RELEASE_A = keccak256("pledge.cash.boardroom.diamond.storage.release-a.v1");
    bytes32 internal constant RELEASE_B = keccak256("pledge.cash.boardroom.diamond.storage.release-b.v2");
}
