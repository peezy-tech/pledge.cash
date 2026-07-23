// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

library BoardroomCoreStorage {
    /// @custom:storage-location erc7201:pledge.cash.boardroom.core
    bytes32 internal constant SLOT = 0xd9850db12a8b5764753c6c3beed9659d48e81b4839f6d7a8f0518d2758e48000;

    enum Status {
        Active,
        WindingDown,
        Snapshotting,
        RedemptionsOpen
    }

    struct Layout {
        Status status;
        bool launched;
        bool executionActive;
        uint64 governanceEpoch;
        uint64 controllerGeneration;
        uint64 windDownStartedAt;
        uint64 windDownDelay;
        address controller;
        address protectionStaker;
        address executionAuthority;
        address executionPolicy;
        address executionTarget;
        bytes32 controllerDeploymentAuthorization;
    }

    function layout() internal pure returns (Layout storage result) {
        bytes32 slot = SLOT;
        assembly ("memory-safe") {
            result.slot := slot
        }
    }
}
