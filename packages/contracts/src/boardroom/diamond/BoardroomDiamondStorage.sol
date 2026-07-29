// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Kernel-owned storage shared with release and migration facets.
/// @dev Facets must use separate namespaces for all business state.
library BoardroomDiamondStorage {
    /// @custom:storage-location erc7201:pledge.cash.boardroom.diamond.kernel
    bytes32 internal constant SLOT = 0x64012d80b9c53e1b5bf8c969b5602eb24c9b154d647cac77b452f45361d58700;

    struct Layout {
        bool initialized;
        bool initializing;
        bool migrating;
        uint64 appliedStorageVersion;
        bytes32 appliedStorageLayoutHash;
    }

    function layout() internal pure returns (Layout storage result) {
        bytes32 slot = SLOT;
        assembly ("memory-safe") {
            result.slot := slot
        }
    }

    function initialized() internal view returns (bool) {
        return layout().initialized;
    }

    function initializing() internal view returns (bool) {
        return layout().initializing;
    }

    function appliedStorageVersion() internal view returns (uint64) {
        return layout().appliedStorageVersion;
    }

    function appliedStorageLayoutHash() internal view returns (bytes32) {
        return layout().appliedStorageLayoutHash;
    }

    /// @dev Intended for a pinned migration facet executing in kernel context.
    function setAppliedStorage(uint64 version, bytes32 storageLayoutHash) internal {
        Layout storage kernel = layout();
        kernel.appliedStorageVersion = version;
        kernel.appliedStorageLayoutHash = storageLayoutHash;
    }
}
