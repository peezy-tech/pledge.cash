// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Shared value types for immutable protocol facet-set releases.
library ProtocolFacetTypes {
    /// @dev Every storage migration preserves one stable protocol ABI so
    /// clients can migrate from authenticated registry state without a
    /// release-specific interface.
    bytes4 internal constant CANONICAL_MIGRATION_SELECTOR = bytes4(keccak256("migrateBoardroom(bytes32)"));

    /// @dev Numeric values are part of the registry ABI: View=0, Mutating=1, Migration=2.
    enum RouteKind {
        View,
        Mutating,
        Migration
    }

    struct RouteDefinition {
        bytes4 selector;
        address facet;
        bytes32 codeHash;
        RouteKind kind;
    }

    /// @dev `manifestHash` commits release metadata stored outside the registry.
    struct FacetSetManifest {
        uint64 release;
        uint64 requiredStorageVersion;
        bytes32 predecessorFacetSetHash;
        bytes32 storageLayoutHash;
        bytes32 manifestHash;
        RouteDefinition[] routes;
        address migrationFacet;
        bytes4 migrationSelector;
    }

    struct Facet {
        address facetAddress;
        bytes4[] functionSelectors;
    }
}
