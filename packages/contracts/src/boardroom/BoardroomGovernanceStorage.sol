// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

library BoardroomGovernanceStorage {
    bytes32 internal constant SLOT = keccak256("pledge.cash.boardroom.governance.v1");

    struct ActionContext {
        uint64 eta;
        uint64 expiresAt;
        uint64 epoch;
        uint8 status;
    }

    struct Layout {
        uint64 epoch;
        uint64 windDownStartedAt;
        mapping(bytes32 actionHash => ActionContext context) actions;
        mapping(address asset => uint256 count) redeemableAssetPins;
    }

    function layout() internal pure returns (Layout storage result) {
        bytes32 slot = SLOT;
        assembly {
            result.slot := slot
        }
    }
}
