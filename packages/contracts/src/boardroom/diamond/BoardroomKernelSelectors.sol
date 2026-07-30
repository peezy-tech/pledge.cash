// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Canonical selector set permanently owned by the Boardroom kernel.
library BoardroomKernelSelectors {
    function selectors() internal pure returns (bytes4[] memory reserved) {
        reserved = new bytes4[](8);
        reserved[0] = bytes4(keccak256("facetRegistry()"));
        reserved[1] = bytes4(keccak256("appliedStorageLayoutHash()"));
        reserved[2] = bytes4(keccak256("facetSetHash()"));
        reserved[3] = bytes4(keccak256("initialize(bytes32,bytes)"));
        reserved[4] = bytes4(keccak256("viewDispatcher()"));
        reserved[5] = bytes4(keccak256("appliedStorageVersion()"));
        reserved[6] = bytes4(keccak256("migrationRequired()"));
        reserved[7] = bytes4(keccak256("kernelSelectorSetHash()"));
    }

    function selectorSetHash() internal pure returns (bytes32) {
        return keccak256(abi.encode(selectors()));
    }
}
