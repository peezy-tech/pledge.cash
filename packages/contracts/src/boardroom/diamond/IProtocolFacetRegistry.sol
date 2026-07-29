// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ProtocolFacetTypes} from "./ProtocolFacetTypes.sol";

interface IProtocolFacetRegistry {
    function activeFacetSetHash() external view returns (bytes32);

    function activeRelease() external view returns (uint64);

    function activeStorageVersion() external view returns (uint64);

    function activeStorageLayoutHash() external view returns (bytes32);

    function activeMigration() external view returns (address facet, bytes4 selector);

    function route(bytes4 selector) external view returns (address facet, uint8 kind, uint64 requiredStorageVersion);

    function facetAddress(bytes4 selector) external view returns (address);

    function facetAddresses() external view returns (address[] memory);

    function facetFunctionSelectors(address facet) external view returns (bytes4[] memory);

    function facets() external view returns (ProtocolFacetTypes.Facet[] memory);
}
