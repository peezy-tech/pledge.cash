// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Shared ABI types for native Boardroom facets.
library BoardroomFacetTypes {
    enum BoardroomStatus {
        Active,
        WindingDown,
        Snapshotting,
        RedemptionsOpen
    }

    struct Call {
        address policy;
        address target;
        uint256 value;
        bytes data;
    }

    struct LaunchConfig {
        address proposer;
        address predictedController;
        address protectionStaker;
        address expectedRewardPool;
        address expectedRedemptionExcessRecipient;
        uint64 controllerDelay;
        uint64 windDownDelay;
        uint64 gracePeriod;
        uint64 generation;
    }
}
