// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {BoardroomDiamondStorage} from "./BoardroomDiamondStorage.sol";
import {IBoardroomFacetRegistry} from "./IBoardroomFacetRegistry.sol";

/// @notice Minimal, clone-safe Boardroom selector kernel.
contract BoardroomKernel {
    uint8 internal constant ROUTE_KIND_VIEW = 0;
    uint8 internal constant ROUTE_KIND_MUTATING = 1;
    uint8 internal constant ROUTE_KIND_MIGRATION = 2;

    bytes4 internal constant INITIALIZE_BOARDROOM_SELECTOR = bytes4(keccak256("initializeBoardroom(bytes32,bytes)"));

    IBoardroomFacetRegistry public immutable facetRegistry;

    error AlreadyInitialized();
    error NotInitialized();
    error InvalidRegistry(address registry);
    error RegistryCallFailed();
    error UnknownSelector(bytes4 selector);
    error InvalidFacet(bytes4 selector, address facet);
    error InvalidRouteKind(bytes4 selector, uint8 kind);
    error MissingExpectedFacetSetHash(bytes4 selector);
    error FacetSetHashMismatch(bytes32 expected, bytes32 actual);
    error RouteStorageVersionMismatch(bytes4 selector, uint64 routeVersion, uint64 activeVersion);
    error StorageMigrationRequired(uint64 appliedVersion, uint64 requiredVersion);
    error AppliedStorageLayoutMismatch(bytes32 appliedLayoutHash, bytes32 requiredLayoutHash);
    error ActiveReleaseChanged(
        bytes32 expectedFacetSetHash,
        bytes32 actualFacetSetHash,
        uint64 expectedStorageVersion,
        uint64 actualStorageVersion,
        bytes32 expectedStorageLayoutHash,
        bytes32 actualStorageLayoutHash
    );
    error AlreadyMigrated(uint64 appliedVersion);
    error MigrationReentrancy();
    error KernelMetadataCorrupted(bool initialized, bool initializing, bool migrating);
    error MigrationPostconditionFailed(
        uint64 expectedVersion, uint64 actualVersion, bytes32 expectedLayoutHash, bytes32 actualLayoutHash
    );
    error InvalidInitializationRoute(address facet, uint8 kind, uint64 routeVersion, uint64 activeVersion);
    error InvalidInitializationMigrationRoute(
        address expectedFacet,
        address routeFacet,
        bytes4 selector,
        uint8 kind,
        uint64 routeVersion,
        uint64 activeVersion
    );
    error InvalidInitializationState();
    error ViewDispatchDidNotRollback();
    error InvalidViewRollbackEnvelope();

    constructor(address facetRegistry_) {
        if (facetRegistry_ == address(0) || facetRegistry_.code.length == 0) {
            revert InvalidRegistry(facetRegistry_);
        }
        facetRegistry = IBoardroomFacetRegistry(facetRegistry_);
        // Disable initialization of the implementation while leaving clone storage untouched.
        BoardroomDiamondStorage.layout().initialized = true;
    }

    receive() external payable {}

    /// @notice Atomically binds clone metadata and runs the active release initializer facet.
    function initialize(bytes32 expectedFacetSetHash, bytes calldata initData) external {
        BoardroomDiamondStorage.Layout storage kernel = BoardroomDiamondStorage.layout();
        if (kernel.initialized) revert AlreadyInitialized();

        bytes32 activeHash = _activeFacetSetHash();
        if (expectedFacetSetHash != activeHash) {
            revert FacetSetHashMismatch(expectedFacetSetHash, activeHash);
        }
        uint64 activeVersion = _activeStorageVersion();
        bytes32 activeLayoutHash = _activeStorageLayoutHash();
        (address facet, uint8 kind, uint64 routeVersion) = _route(INITIALIZE_BOARDROOM_SELECTOR);
        if (facet.code.length == 0 || kind != ROUTE_KIND_MUTATING || routeVersion != activeVersion) {
            revert InvalidInitializationRoute(facet, kind, routeVersion, activeVersion);
        }

        kernel.initialized = true;
        kernel.initializing = true;
        bytes memory input = abi.encodeWithSelector(INITIALIZE_BOARDROOM_SELECTOR, expectedFacetSetHash, initData);
        (bool success, bytes memory output) = facet.delegatecall(input);
        if (!success) _revert(output);

        _initializeActiveStorage(expectedFacetSetHash, activeVersion, activeLayoutHash);

        kernel.initializing = false;
        if (
            !kernel.initialized || kernel.appliedStorageVersion != activeVersion
                || kernel.appliedStorageLayoutHash != activeLayoutHash || _activeFacetSetHash() != expectedFacetSetHash
                || _activeStorageVersion() != activeVersion || _activeStorageLayoutHash() != activeLayoutHash
        ) revert InvalidInitializationState();
    }

    function _initializeActiveStorage(bytes32 expectedFacetSetHash, uint64 activeVersion, bytes32 activeLayoutHash)
        internal
    {
        BoardroomDiamondStorage.Layout storage kernel = BoardroomDiamondStorage.layout();
        (address migrationFacet, bytes4 migrationSelector) = _activeMigration();
        if (
            !kernel.initialized || !kernel.initializing || kernel.appliedStorageVersion != 0
                || kernel.appliedStorageLayoutHash != bytes32(0) || kernel.migrating
        ) {
            revert InvalidInitializationState();
        }
        if (migrationFacet == address(0) && migrationSelector == bytes4(0)) {
            BoardroomDiamondStorage.setAppliedStorage(activeVersion, activeLayoutHash);
            return;
        }
        (address routeFacet, uint8 migrationKind, uint64 migrationVersion) = _route(migrationSelector);
        if (
            migrationFacet.code.length == 0 || routeFacet != migrationFacet || migrationKind != ROUTE_KIND_MIGRATION
                || migrationVersion != activeVersion
        ) {
            revert InvalidInitializationMigrationRoute(
                migrationFacet, routeFacet, migrationSelector, migrationKind, migrationVersion, activeVersion
            );
        }
        kernel.migrating = true;
        (bool success, bytes memory output) =
            migrationFacet.delegatecall(abi.encodeWithSelector(migrationSelector, expectedFacetSetHash));
        if (!success) _revert(output);
        kernel.migrating = false;
    }

    function facetSetHash() external view returns (bytes32) {
        return _activeFacetSetHash();
    }

    function appliedStorageVersion() external view returns (uint64) {
        return BoardroomDiamondStorage.appliedStorageVersion();
    }

    function appliedStorageLayoutHash() external view returns (bytes32) {
        return BoardroomDiamondStorage.appliedStorageLayoutHash();
    }

    function migrationRequired() external view returns (bool) {
        return BoardroomDiamondStorage.appliedStorageVersion() != _activeStorageVersion()
            || BoardroomDiamondStorage.appliedStorageLayoutHash() != _activeStorageLayoutHash();
    }

    /// @dev Delegatecalls a view facet and always reverts with an encoded
    /// `(success, returndata)` envelope. Fallback catches this frame so every
    /// storage write and external side effect is rolled back while the original
    /// caller and Boardroom context are preserved.
    function dispatchViewAndRollback(address facet, bytes calldata input) external {
        (bool success, bytes memory output) = facet.delegatecall(input);
        bytes memory envelope = abi.encode(success, output);
        assembly ("memory-safe") {
            revert(add(envelope, 0x20), mload(envelope))
        }
    }

    fallback() external payable {
        if (!BoardroomDiamondStorage.initialized()) revert NotInitialized();

        (address facet, uint8 kind, uint64 routeVersion) = _route(msg.sig);
        if (facet == address(0)) revert UnknownSelector(msg.sig);
        if (facet.code.length == 0) revert InvalidFacet(msg.sig, facet);
        if (kind > ROUTE_KIND_MIGRATION) revert InvalidRouteKind(msg.sig, kind);

        if (kind == ROUTE_KIND_VIEW) {
            (bool didNotRollback, bytes memory envelope) =
                address(this).delegatecall(abi.encodeCall(this.dispatchViewAndRollback, (facet, msg.data)));
            if (didNotRollback) revert ViewDispatchDidNotRollback();
            if (envelope.length < 96) revert InvalidViewRollbackEnvelope();
            (bool facetSuccess, bytes memory viewOutput) = abi.decode(envelope, (bool, bytes));
            if (!facetSuccess) _revert(viewOutput);
            _return(viewOutput);
        }

        bytes32 expectedHash = _expectedFacetSetHash();
        bytes32 activeHash = _activeFacetSetHash();
        if (expectedHash != activeHash) revert FacetSetHashMismatch(expectedHash, activeHash);
        uint64 activeVersion = _activeStorageVersion();
        bytes32 activeLayoutHash = _activeStorageLayoutHash();
        if (routeVersion != activeVersion) {
            revert RouteStorageVersionMismatch(msg.sig, routeVersion, activeVersion);
        }

        uint64 appliedVersion = BoardroomDiamondStorage.appliedStorageVersion();
        bytes32 appliedLayoutHash = BoardroomDiamondStorage.appliedStorageLayoutHash();
        if (kind == ROUTE_KIND_MUTATING) {
            if (BoardroomDiamondStorage.layout().migrating) revert MigrationReentrancy();
            if (appliedVersion != activeVersion) {
                revert StorageMigrationRequired(appliedVersion, activeVersion);
            }
            if (appliedLayoutHash != activeLayoutHash) {
                revert AppliedStorageLayoutMismatch(appliedLayoutHash, activeLayoutHash);
            }
            _delegateAndReturn(facet, expectedHash, activeVersion, activeLayoutHash);
        }

        if (appliedVersion >= activeVersion) {
            revert AlreadyMigrated(appliedVersion);
        }
        BoardroomDiamondStorage.Layout storage kernel = BoardroomDiamondStorage.layout();
        if (kernel.migrating) revert MigrationReentrancy();
        kernel.migrating = true;
        (bool success, bytes memory output) = facet.delegatecall(msg.data);
        if (!success) _revert(output);
        kernel.migrating = false;
        _requireStableKernelMetadata();

        uint64 resultingVersion = BoardroomDiamondStorage.appliedStorageVersion();
        bytes32 resultingLayoutHash = BoardroomDiamondStorage.appliedStorageLayoutHash();
        if (
            resultingVersion != activeVersion || resultingLayoutHash != activeLayoutHash
                || _activeFacetSetHash() != expectedHash || _activeStorageVersion() != activeVersion
                || _activeStorageLayoutHash() != activeLayoutHash
        ) {
            revert MigrationPostconditionFailed(activeVersion, resultingVersion, activeLayoutHash, resultingLayoutHash);
        }
        _return(output);
    }

    function _activeFacetSetHash() internal view returns (bytes32 result) {
        try facetRegistry.activeFacetSetHash() returns (bytes32 value) {
            return value;
        } catch {
            revert RegistryCallFailed();
        }
    }

    function _activeStorageVersion() internal view returns (uint64 result) {
        try facetRegistry.activeStorageVersion() returns (uint64 value) {
            return value;
        } catch {
            revert RegistryCallFailed();
        }
    }

    function _activeStorageLayoutHash() internal view returns (bytes32 result) {
        try facetRegistry.activeStorageLayoutHash() returns (bytes32 value) {
            return value;
        } catch {
            revert RegistryCallFailed();
        }
    }

    function _activeMigration() internal view returns (address facet, bytes4 selector) {
        try facetRegistry.activeMigration() returns (address migrationFacet, bytes4 migrationSelector) {
            return (migrationFacet, migrationSelector);
        } catch {
            revert RegistryCallFailed();
        }
    }

    function _route(bytes4 selector) internal view returns (address facet, uint8 kind, uint64 version) {
        try facetRegistry.route(selector) returns (address routeFacet, uint8 routeKind, uint64 requiredVersion) {
            return (routeFacet, routeKind, requiredVersion);
        } catch {
            revert RegistryCallFailed();
        }
    }

    function _expectedFacetSetHash() internal pure returns (bytes32 expectedHash) {
        if (msg.data.length < 36) revert MissingExpectedFacetSetHash(msg.sig);
        assembly ("memory-safe") {
            expectedHash := calldataload(4)
        }
    }

    function _delegateAndReturn(
        address facet,
        bytes32 expectedFacetSetHash,
        uint64 expectedStorageVersion,
        bytes32 expectedStorageLayoutHash
    ) internal {
        (bool success, bytes memory output) = facet.delegatecall(msg.data);
        if (!success) _revert(output);
        _requireStableKernelMetadata();

        bytes32 actualFacetSetHash = _activeFacetSetHash();
        uint64 actualStorageVersion = _activeStorageVersion();
        bytes32 actualStorageLayoutHash = _activeStorageLayoutHash();
        if (
            actualFacetSetHash != expectedFacetSetHash || actualStorageVersion != expectedStorageVersion
                || actualStorageLayoutHash != expectedStorageLayoutHash
        ) {
            revert ActiveReleaseChanged(
                expectedFacetSetHash,
                actualFacetSetHash,
                expectedStorageVersion,
                actualStorageVersion,
                expectedStorageLayoutHash,
                actualStorageLayoutHash
            );
        }

        uint64 appliedVersion = BoardroomDiamondStorage.appliedStorageVersion();
        if (appliedVersion != expectedStorageVersion) {
            revert StorageMigrationRequired(appliedVersion, expectedStorageVersion);
        }
        bytes32 appliedLayoutHash = BoardroomDiamondStorage.appliedStorageLayoutHash();
        if (appliedLayoutHash != expectedStorageLayoutHash) {
            revert AppliedStorageLayoutMismatch(appliedLayoutHash, expectedStorageLayoutHash);
        }
        _return(output);
    }

    function _requireStableKernelMetadata() internal view {
        BoardroomDiamondStorage.Layout storage kernel = BoardroomDiamondStorage.layout();
        if (!kernel.initialized || kernel.initializing || kernel.migrating) {
            revert KernelMetadataCorrupted(kernel.initialized, kernel.initializing, kernel.migrating);
        }
    }

    function _revert(bytes memory output) internal pure {
        assembly ("memory-safe") {
            revert(add(output, 0x20), mload(output))
        }
    }

    function _return(bytes memory output) internal pure {
        assembly ("memory-safe") {
            return(add(output, 0x20), mload(output))
        }
    }
}
