// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Minimal registry surface consumed by the Boardroom kernel.
interface IBoardroomFacetRegistry {
    function activeFacetSetHash() external view returns (bytes32);

    function activeStorageVersion() external view returns (uint64);

    function activeStorageLayoutHash() external view returns (bytes32);

    function activeMigration() external view returns (address facet, bytes4 selector);

    function route(bytes4 selector) external view returns (address facet, uint8 kind, uint64 requiredStorageVersion);
}
