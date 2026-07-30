// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "solady/auth/Ownable.sol";
import {BoardroomKernelSelectors} from "./BoardroomKernelSelectors.sol";
import {IProtocolFacetRegistry} from "./IProtocolFacetRegistry.sol";
import {ProtocolFacetTypes} from "./ProtocolFacetTypes.sol";

/// @notice Publishes immutable, complete facet releases and selects one protocol-wide active release.
/// @dev Releases are complete selector tables rather than incremental cuts. Activation replaces the
/// previous active table atomically, so omission is the canonical removal operation.
contract ProtocolFacetRegistry is Ownable, IProtocolFacetRegistry {
    /// @notice Maximum selectors in one complete release.
    /// @dev Bounds publication, activation, replacement, and loupe enumeration work.
    uint256 public constant MAX_SELECTORS = 256;
    /// @notice Maximum kernel selectors permanently reserved when the registry is constructed.
    uint256 public constant MAX_RESERVED_KERNEL_SELECTORS = 128;

    bytes32 internal constant FACET_SET_TYPEHASH = keccak256(
        "ProtocolFacetSet(uint64 release,uint64 requiredStorageVersion,bytes32 predecessorFacetSetHash,bytes32 storageLayoutHash,bytes32 manifestHash,bytes32 routesHash,address migrationFacet,bytes4 migrationSelector)"
    );

    struct StoredRoute {
        address facet;
        bytes32 codeHash;
        ProtocolFacetTypes.RouteKind kind;
    }

    struct StoredFacetSet {
        bool published;
        uint64 release;
        uint64 requiredStorageVersion;
        bytes32 predecessorFacetSetHash;
        bytes32 storageLayoutHash;
        bytes32 manifestHash;
        address migrationFacet;
        bytes4 migrationSelector;
        bytes4[] selectors;
        mapping(bytes4 selector => StoredRoute route) routeOf;
    }

    struct ActiveRoute {
        address facet;
        bytes32 codeHash;
        ProtocolFacetTypes.RouteKind kind;
    }

    mapping(bytes32 facetSetHash => StoredFacetSet facetSet) internal _facetSets;
    mapping(uint64 release => bytes32 facetSetHash) public facetSetHashForRelease;

    bytes4[] internal _reservedKernelSelectors;
    mapping(bytes4 selector => bool reserved) public isReservedKernelSelector;
    bytes32 public immutable kernelSelectorSetHash;

    bytes32 internal _activeFacetSetHash;
    uint64 internal _activeRelease;
    uint64 internal _activeStorageVersion;
    bytes32 internal _activeStorageLayoutHash;
    bytes4[] internal _activeSelectors;
    mapping(bytes4 selector => ActiveRoute route_) internal _activeRouteOf;
    address[] internal _activeFacetAddresses;
    mapping(address facet => bytes4[] selectors) internal _activeSelectorsOfFacet;

    error InvalidAddress();
    error InvalidRelease();
    error InvalidManifestHash();
    error InvalidStorageLayoutHash();
    error InvalidPredecessorFacetSet(bytes32 predecessorFacetSetHash, uint64 release);
    error MigrationRouteContinuityRequired(bytes32 predecessorFacetSetHash, uint64 requiredStorageVersion);
    error TooManySelectors(uint256 requested, uint256 maximum);
    error SelectorsNotStrictlyAscending(bytes4 previous, bytes4 current);
    error InvalidKernelSelectorSetHash(bytes32 expected, bytes32 actual);
    error ReservedKernelSelector(bytes4 selector);
    error InvalidFacet(bytes4 selector, address facet);
    error FacetCodeHashMismatch(address facet, bytes32 expected, bytes32 actual);
    error InvalidMigrationRoute(address facet, bytes4 selector);
    error FacetSetAlreadyPublished(bytes32 facetSetHash);
    error ReleaseAlreadyPublished(uint64 release, bytes32 facetSetHash);
    error FacetSetNotPublished(bytes32 facetSetHash);
    error ReleaseNotIncreasing(uint64 currentRelease, uint64 requestedRelease);
    error StorageVersionDecreased(uint64 currentVersion, uint64 requestedVersion);
    error StorageLayoutChangeRequiresMigration(bytes32 currentLayoutHash, bytes32 requestedLayoutHash);
    error MigrationRequired(uint64 currentVersion, uint64 requestedVersion);

    event FacetSetPublished(
        bytes32 indexed facetSetHash,
        uint64 indexed release,
        uint64 indexed requiredStorageVersion,
        bytes32 predecessorFacetSetHash,
        bytes32 storageLayoutHash,
        bytes32 manifestHash,
        uint256 selectorCount,
        address migrationFacet,
        bytes4 migrationSelector
    );
    event FacetRoutePublished(
        bytes32 indexed facetSetHash,
        uint64 indexed release,
        bytes4 indexed selector,
        address facet,
        bytes32 codeHash,
        ProtocolFacetTypes.RouteKind kind
    );
    event FacetSetActivated(
        bytes32 indexed previousFacetSetHash,
        bytes32 indexed facetSetHash,
        uint64 indexed release,
        uint64 requiredStorageVersion,
        bytes32 storageLayoutHash,
        bytes32 manifestHash,
        address migrationFacet,
        bytes4 migrationSelector
    );

    constructor(address protocolGovernance, bytes4[] memory reservedKernelSelectors_) {
        if (protocolGovernance == address(0)) revert InvalidAddress();
        uint256 length = reservedKernelSelectors_.length;
        if (length > MAX_RESERVED_KERNEL_SELECTORS) {
            revert TooManySelectors(length, MAX_RESERVED_KERNEL_SELECTORS);
        }
        bytes4 previous;
        for (uint256 i; i < length; ++i) {
            bytes4 selector = reservedKernelSelectors_[i];
            if (i != 0 && selector <= previous) revert SelectorsNotStrictlyAscending(previous, selector);
            previous = selector;
            _reservedKernelSelectors.push(selector);
            isReservedKernelSelector[selector] = true;
        }
        bytes32 expectedSelectorSetHash = BoardroomKernelSelectors.selectorSetHash();
        bytes32 actualSelectorSetHash = keccak256(abi.encode(reservedKernelSelectors_));
        if (actualSelectorSetHash != expectedSelectorSetHash) {
            revert InvalidKernelSelectorSetHash(expectedSelectorSetHash, actualSelectorSetHash);
        }
        kernelSelectorSetHash = actualSelectorSetHash;
        _initializeOwner(protocolGovernance);
    }

    function publishFacetSet(ProtocolFacetTypes.FacetSetManifest calldata manifest)
        external
        onlyOwner
        returns (bytes32 facetSetHash)
    {
        if (manifest.release == 0) revert InvalidRelease();
        if (manifest.manifestHash == bytes32(0)) revert InvalidManifestHash();
        if (manifest.storageLayoutHash == bytes32(0)) revert InvalidStorageLayoutHash();
        if (manifest.release == 1) {
            if (manifest.predecessorFacetSetHash != bytes32(0)) {
                revert InvalidPredecessorFacetSet(manifest.predecessorFacetSetHash, manifest.release);
            }
        } else {
            StoredFacetSet storage predecessor = _facetSets[manifest.predecessorFacetSetHash];
            if (
                manifest.predecessorFacetSetHash == bytes32(0) || !predecessor.published
                    || predecessor.release >= manifest.release
            ) {
                revert InvalidPredecessorFacetSet(manifest.predecessorFacetSetHash, manifest.release);
            }
            if (predecessor.migrationFacet != address(0) && manifest.migrationFacet == address(0)) {
                revert MigrationRouteContinuityRequired(
                    manifest.predecessorFacetSetHash, manifest.requiredStorageVersion
                );
            }
        }
        uint256 length = manifest.routes.length;
        if (length > MAX_SELECTORS) revert TooManySelectors(length, MAX_SELECTORS);

        _validateMigrationShape(manifest);
        bytes4 previous;
        bool foundMigration;
        for (uint256 i; i < length; ++i) {
            ProtocolFacetTypes.RouteDefinition calldata definition = manifest.routes[i];
            if (i != 0 && definition.selector <= previous) {
                revert SelectorsNotStrictlyAscending(previous, definition.selector);
            }
            previous = definition.selector;
            if (isReservedKernelSelector[definition.selector]) {
                revert ReservedKernelSelector(definition.selector);
            }
            _validateFacet(definition.selector, definition.facet, definition.codeHash);
            if (definition.kind == ProtocolFacetTypes.RouteKind.Migration) {
                if (
                    foundMigration || definition.facet != manifest.migrationFacet
                        || definition.selector != manifest.migrationSelector
                ) {
                    revert InvalidMigrationRoute(manifest.migrationFacet, manifest.migrationSelector);
                }
                foundMigration = true;
            }
        }
        if (manifest.migrationFacet != address(0) && !foundMigration) {
            revert InvalidMigrationRoute(manifest.migrationFacet, manifest.migrationSelector);
        }

        facetSetHash = computeFacetSetHash(manifest);
        if (_facetSets[facetSetHash].published) revert FacetSetAlreadyPublished(facetSetHash);
        bytes32 existingHash = facetSetHashForRelease[manifest.release];
        if (existingHash != bytes32(0)) revert ReleaseAlreadyPublished(manifest.release, existingHash);

        StoredFacetSet storage stored = _facetSets[facetSetHash];
        stored.published = true;
        stored.release = manifest.release;
        stored.requiredStorageVersion = manifest.requiredStorageVersion;
        stored.predecessorFacetSetHash = manifest.predecessorFacetSetHash;
        stored.storageLayoutHash = manifest.storageLayoutHash;
        stored.manifestHash = manifest.manifestHash;
        stored.migrationFacet = manifest.migrationFacet;
        stored.migrationSelector = manifest.migrationSelector;
        for (uint256 i; i < length; ++i) {
            ProtocolFacetTypes.RouteDefinition calldata definition = manifest.routes[i];
            stored.selectors.push(definition.selector);
            stored.routeOf[definition.selector] =
                StoredRoute({facet: definition.facet, codeHash: definition.codeHash, kind: definition.kind});
        }
        facetSetHashForRelease[manifest.release] = facetSetHash;

        emit FacetSetPublished(
            facetSetHash,
            manifest.release,
            manifest.requiredStorageVersion,
            manifest.predecessorFacetSetHash,
            manifest.storageLayoutHash,
            manifest.manifestHash,
            length,
            manifest.migrationFacet,
            manifest.migrationSelector
        );
        for (uint256 i; i < length; ++i) {
            ProtocolFacetTypes.RouteDefinition calldata definition = manifest.routes[i];
            emit FacetRoutePublished(
                facetSetHash,
                manifest.release,
                definition.selector,
                definition.facet,
                definition.codeHash,
                definition.kind
            );
        }
    }

    function activateFacetSet(bytes32 facetSetHash) external onlyOwner {
        StoredFacetSet storage next = _facetSets[facetSetHash];
        if (!next.published) revert FacetSetNotPublished(facetSetHash);
        if (next.release <= _activeRelease) revert ReleaseNotIncreasing(_activeRelease, next.release);
        if (next.predecessorFacetSetHash != _activeFacetSetHash) {
            revert InvalidPredecessorFacetSet(next.predecessorFacetSetHash, next.release);
        }
        if (next.requiredStorageVersion < _activeStorageVersion) {
            revert StorageVersionDecreased(_activeStorageVersion, next.requiredStorageVersion);
        }
        if (
            _activeRelease != 0 && next.requiredStorageVersion == _activeStorageVersion
                && next.storageLayoutHash != _activeStorageLayoutHash
        ) {
            revert StorageLayoutChangeRequiresMigration(_activeStorageLayoutHash, next.storageLayoutHash);
        }
        if (
            _activeRelease != 0 && next.requiredStorageVersion > _activeStorageVersion
                && next.migrationFacet == address(0)
        ) {
            revert MigrationRequired(_activeStorageVersion, next.requiredStorageVersion);
        }

        uint256 nextLength = next.selectors.length;
        for (uint256 i; i < nextLength; ++i) {
            bytes4 selector = next.selectors[i];
            StoredRoute storage storedRoute = next.routeOf[selector];
            _validateFacet(selector, storedRoute.facet, storedRoute.codeHash);
        }

        uint256 oldSelectorLength = _activeSelectors.length;
        for (uint256 i; i < oldSelectorLength; ++i) {
            delete _activeRouteOf[_activeSelectors[i]];
        }
        uint256 oldFacetLength = _activeFacetAddresses.length;
        for (uint256 i; i < oldFacetLength; ++i) {
            delete _activeSelectorsOfFacet[_activeFacetAddresses[i]];
        }
        delete _activeSelectors;
        delete _activeFacetAddresses;

        for (uint256 i; i < nextLength; ++i) {
            bytes4 selector = next.selectors[i];
            StoredRoute storage storedRoute = next.routeOf[selector];
            _activeSelectors.push(selector);
            _activeRouteOf[selector] =
                ActiveRoute({facet: storedRoute.facet, codeHash: storedRoute.codeHash, kind: storedRoute.kind});
            if (_activeSelectorsOfFacet[storedRoute.facet].length == 0) {
                _activeFacetAddresses.push(storedRoute.facet);
            }
            _activeSelectorsOfFacet[storedRoute.facet].push(selector);
        }

        bytes32 previousFacetSetHash = _activeFacetSetHash;
        _activeFacetSetHash = facetSetHash;
        _activeRelease = next.release;
        _activeStorageVersion = next.requiredStorageVersion;
        _activeStorageLayoutHash = next.storageLayoutHash;
        emit FacetSetActivated(
            previousFacetSetHash,
            facetSetHash,
            next.release,
            next.requiredStorageVersion,
            next.storageLayoutHash,
            next.manifestHash,
            next.migrationFacet,
            next.migrationSelector
        );
    }

    function computeFacetSetHash(ProtocolFacetTypes.FacetSetManifest calldata manifest) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                FACET_SET_TYPEHASH,
                manifest.release,
                manifest.requiredStorageVersion,
                manifest.predecessorFacetSetHash,
                manifest.storageLayoutHash,
                manifest.manifestHash,
                keccak256(abi.encode(manifest.routes)),
                manifest.migrationFacet,
                manifest.migrationSelector
            )
        );
    }

    function activeFacetSetHash() external view returns (bytes32) {
        return _activeFacetSetHash;
    }

    function activeRelease() external view returns (uint64) {
        return _activeRelease;
    }

    function activeStorageVersion() external view returns (uint64) {
        return _activeStorageVersion;
    }

    function activeStorageLayoutHash() external view returns (bytes32) {
        return _activeStorageLayoutHash;
    }

    function activeMigration() external view returns (address facet, bytes4 selector) {
        StoredFacetSet storage active = _facetSets[_activeFacetSetHash];
        return (active.migrationFacet, active.migrationSelector);
    }

    function route(bytes4 selector)
        external
        view
        returns (address facet, bytes32 codeHash, uint8 kind, uint64 requiredStorageVersion)
    {
        ActiveRoute storage active = _activeRouteOf[selector];
        return (active.facet, active.codeHash, uint8(active.kind), _activeStorageVersion);
    }

    function facetAddress(bytes4 selector) external view returns (address) {
        return _activeRouteOf[selector].facet;
    }

    function facetAddresses() external view returns (address[] memory) {
        return _activeFacetAddresses;
    }

    function facetFunctionSelectors(address facet) external view returns (bytes4[] memory) {
        return _activeSelectorsOfFacet[facet];
    }

    function facets() external view returns (ProtocolFacetTypes.Facet[] memory result) {
        uint256 length = _activeFacetAddresses.length;
        result = new ProtocolFacetTypes.Facet[](length);
        for (uint256 i; i < length; ++i) {
            address facet = _activeFacetAddresses[i];
            result[i] =
                ProtocolFacetTypes.Facet({facetAddress: facet, functionSelectors: _activeSelectorsOfFacet[facet]});
        }
    }

    function reservedKernelSelectors() external view returns (bytes4[] memory) {
        return _reservedKernelSelectors;
    }

    function isFacetSetPublished(bytes32 facetSetHash) external view returns (bool) {
        return _facetSets[facetSetHash].published;
    }

    function facetSetMetadata(bytes32 facetSetHash)
        external
        view
        returns (
            bool published,
            uint64 release,
            uint64 requiredStorageVersion,
            bytes32 predecessorFacetSetHash,
            bytes32 storageLayoutHash,
            bytes32 manifestHash,
            address migrationFacet,
            bytes4 migrationSelector,
            uint256 selectorCount
        )
    {
        StoredFacetSet storage stored = _facetSets[facetSetHash];
        return (
            stored.published,
            stored.release,
            stored.requiredStorageVersion,
            stored.predecessorFacetSetHash,
            stored.storageLayoutHash,
            stored.manifestHash,
            stored.migrationFacet,
            stored.migrationSelector,
            stored.selectors.length
        );
    }

    function facetSetSelectors(bytes32 facetSetHash) external view returns (bytes4[] memory) {
        return _facetSets[facetSetHash].selectors;
    }

    function facetSetRoute(bytes32 facetSetHash, bytes4 selector)
        external
        view
        returns (address facet, bytes32 codeHash, uint8 kind)
    {
        StoredRoute storage stored = _facetSets[facetSetHash].routeOf[selector];
        return (stored.facet, stored.codeHash, uint8(stored.kind));
    }

    function _validateMigrationShape(ProtocolFacetTypes.FacetSetManifest calldata manifest) internal pure {
        bool hasFacet = manifest.migrationFacet != address(0);
        bool hasSelector = manifest.migrationSelector != bytes4(0);
        if (
            hasFacet != hasSelector
                || (hasSelector && manifest.migrationSelector != ProtocolFacetTypes.CANONICAL_MIGRATION_SELECTOR)
        ) {
            revert InvalidMigrationRoute(manifest.migrationFacet, manifest.migrationSelector);
        }
    }

    function _validateFacet(bytes4 selector, address facet, bytes32 expectedCodeHash) internal view {
        if (facet == address(0) || facet == address(this) || facet.code.length == 0) {
            revert InvalidFacet(selector, facet);
        }
        bytes32 actualCodeHash = facet.codehash;
        if (expectedCodeHash == bytes32(0) || actualCodeHash != expectedCodeHash) {
            revert FacetCodeHashMismatch(facet, expectedCodeHash, actualCodeHash);
        }
    }
}
