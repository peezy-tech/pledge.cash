// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

library StagedBoardroomSlots {
    bytes32 internal constant IMPLEMENTATION_SLOT =
        bytes32(uint256(keccak256("pledge.cash.stagedBoardroom.implementation")) - 1);
    bytes32 internal constant MIGRATION_SLOT = bytes32(uint256(keccak256("pledge.cash.stagedBoardroom.migration")) - 1);

    function implementation() internal view returns (address value) {
        bytes32 slot = IMPLEMENTATION_SLOT;
        assembly {
            value := sload(slot)
        }
    }

    function setImplementation(address value) internal {
        bytes32 slot = IMPLEMENTATION_SLOT;
        assembly {
            sstore(slot, value)
        }
    }

    function migrationImplementation() internal view returns (address value) {
        bytes32 slot = MIGRATION_SLOT;
        assembly {
            value := sload(slot)
        }
    }

    function setMigrationImplementation(address value) internal {
        bytes32 slot = MIGRATION_SLOT;
        assembly {
            sstore(slot, value)
        }
    }
}
