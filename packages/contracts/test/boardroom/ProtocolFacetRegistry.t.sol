// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "solady/auth/Ownable.sol";
import {ProtocolFacetRegistry} from "../../src/boardroom/diamond/ProtocolFacetRegistry.sol";
import {ProtocolFacetTypes} from "../../src/boardroom/diamond/ProtocolFacetTypes.sol";

contract RegistryTestFacetA {
    function markerA() external pure returns (uint256) {
        return 1;
    }
}

contract RegistryTestFacetB {
    function markerB() external pure returns (uint256) {
        return 2;
    }
}

contract RegistryTestMigrationFacet {
    function migrateV2() external {}
}

contract ProtocolFacetRegistryTest is Test {
    bytes4 internal constant RESERVED_A = 0x01020304;
    bytes4 internal constant RESERVED_B = 0x05060708;
    bytes4 internal constant SELECTOR_A = 0x10000001;
    bytes4 internal constant SELECTOR_B = 0x10000002;
    bytes4 internal constant SELECTOR_C = 0x10000003;
    bytes4 internal constant SELECTOR_D = 0x10000004;
    bytes4 internal constant MIGRATION_SELECTOR = RegistryTestMigrationFacet.migrateV2.selector;

    address internal stranger = address(0xBAD);
    RegistryTestFacetA internal facetA;
    RegistryTestFacetB internal facetB;
    RegistryTestMigrationFacet internal migrationFacet;
    ProtocolFacetRegistry internal registry;

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
    event FacetRoutePublished(
        bytes32 indexed facetSetHash,
        uint64 indexed release,
        bytes4 indexed selector,
        address facet,
        bytes32 codeHash,
        ProtocolFacetTypes.RouteKind kind
    );

    function setUp() public {
        facetA = new RegistryTestFacetA();
        facetB = new RegistryTestFacetB();
        migrationFacet = new RegistryTestMigrationFacet();

        bytes4[] memory reserved = new bytes4[](2);
        reserved[0] = RESERVED_A;
        reserved[1] = RESERVED_B;
        registry = new ProtocolFacetRegistry(address(this), reserved);
    }

    function testConstructorBindsGovernanceAndPermanentReservedSelectors() public view {
        assertEq(registry.owner(), address(this));
        assertTrue(registry.isReservedKernelSelector(RESERVED_A));
        assertTrue(registry.isReservedKernelSelector(RESERVED_B));
        assertFalse(registry.isReservedKernelSelector(SELECTOR_A));

        bytes4[] memory reserved = registry.reservedKernelSelectors();
        assertEq(reserved.length, 2);
        assertEq(reserved[0], RESERVED_A);
        assertEq(reserved[1], RESERVED_B);
        assertEq(registry.MAX_SELECTORS(), 256);
        assertEq(registry.MAX_RESERVED_KERNEL_SELECTORS(), 128);
    }

    function testConstructorRejectsInvalidGovernanceAndNonCanonicalReservedSelectors() public {
        bytes4[] memory none = new bytes4[](0);
        vm.expectRevert(ProtocolFacetRegistry.InvalidAddress.selector);
        new ProtocolFacetRegistry(address(0), none);

        bytes4[] memory duplicate = new bytes4[](2);
        duplicate[0] = RESERVED_A;
        duplicate[1] = RESERVED_A;
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolFacetRegistry.SelectorsNotStrictlyAscending.selector, RESERVED_A, RESERVED_A)
        );
        new ProtocolFacetRegistry(address(this), duplicate);

        bytes4[] memory descending = new bytes4[](2);
        descending[0] = RESERVED_B;
        descending[1] = RESERVED_A;
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolFacetRegistry.SelectorsNotStrictlyAscending.selector, RESERVED_B, RESERVED_A)
        );
        new ProtocolFacetRegistry(address(this), descending);

        bytes4[] memory excessive = new bytes4[](129);
        for (uint256 i; i < excessive.length; ++i) {
            // Safe because the loop is bounded to 129.
            // forge-lint: disable-next-line(unsafe-typecast)
            excessive[i] = bytes4(uint32(i + 1));
        }
        vm.expectRevert(abi.encodeWithSelector(ProtocolFacetRegistry.TooManySelectors.selector, 129, 128));
        new ProtocolFacetRegistry(address(this), excessive);
    }

    function testOnlyProtocolGovernanceMayPublishOrActivate() public {
        ProtocolFacetTypes.FacetSetManifest memory manifest = _singleRouteManifest(1, 1, SELECTOR_A, address(facetA));
        bytes32 facetSetHash = registry.computeFacetSetHash(manifest);

        vm.prank(stranger);
        vm.expectRevert(Ownable.Unauthorized.selector);
        registry.publishFacetSet(manifest);

        registry.publishFacetSet(manifest);
        vm.prank(stranger);
        vm.expectRevert(Ownable.Unauthorized.selector);
        registry.activateFacetSet(facetSetHash);
    }

    function testPublicationStoresImmutableCompleteReleaseAndEmitsCommitment() public {
        ProtocolFacetTypes.RouteDefinition[] memory routes = new ProtocolFacetTypes.RouteDefinition[](2);
        routes[0] = _route(SELECTOR_A, address(facetA), ProtocolFacetTypes.RouteKind.View);
        routes[1] = _route(SELECTOR_B, address(facetB), ProtocolFacetTypes.RouteKind.Mutating);
        bytes32 manifestHash = keccak256("release-one-manifest");
        ProtocolFacetTypes.FacetSetManifest memory manifest =
            _manifest(1, 7, manifestHash, routes, address(0), bytes4(0));
        bytes32 expectedHash = registry.computeFacetSetHash(manifest);

        vm.expectEmit(true, true, true, true, address(registry));
        emit FacetSetPublished(
            expectedHash, 1, 7, bytes32(0), manifest.storageLayoutHash, manifestHash, 2, address(0), bytes4(0)
        );
        vm.expectEmit(true, true, true, true, address(registry));
        emit FacetRoutePublished(
            expectedHash, 1, SELECTOR_A, address(facetA), address(facetA).codehash, ProtocolFacetTypes.RouteKind.View
        );
        vm.expectEmit(true, true, true, true, address(registry));
        emit FacetRoutePublished(
            expectedHash,
            1,
            SELECTOR_B,
            address(facetB),
            address(facetB).codehash,
            ProtocolFacetTypes.RouteKind.Mutating
        );
        assertEq(registry.publishFacetSet(manifest), expectedHash);

        _assertPublishedMetadata(expectedHash, manifest.storageLayoutHash, manifestHash);
        _assertPublishedRoutes(expectedHash);

        vm.expectRevert(abi.encodeWithSelector(ProtocolFacetRegistry.FacetSetAlreadyPublished.selector, expectedHash));
        registry.publishFacetSet(manifest);

        manifest.manifestHash = keccak256("attempted-release-replacement");
        vm.expectRevert(abi.encodeWithSelector(ProtocolFacetRegistry.ReleaseAlreadyPublished.selector, 1, expectedHash));
        registry.publishFacetSet(manifest);
    }

    function _assertPublishedMetadata(
        bytes32 expectedHash,
        bytes32 expectedStorageLayoutHash,
        bytes32 expectedManifestHash
    ) internal view {
        assertTrue(registry.isFacetSetPublished(expectedHash));
        assertEq(registry.facetSetHashForRelease(1), expectedHash);
        (
            bool published,
            uint64 release,
            uint64 storageVersion,
            bytes32 predecessorFacetSetHash,
            bytes32 storageLayoutHash,
            bytes32 storedManifestHash,
            address storedMigrationFacet,
            bytes4 storedMigrationSelector,
            uint256 selectorCount
        ) = registry.facetSetMetadata(expectedHash);
        assertTrue(published);
        assertEq(release, 1);
        assertEq(storageVersion, 7);
        assertEq(predecessorFacetSetHash, bytes32(0));
        assertEq(storageLayoutHash, expectedStorageLayoutHash);
        assertEq(storedManifestHash, expectedManifestHash);
        assertEq(storedMigrationFacet, address(0));
        assertEq(storedMigrationSelector, bytes4(0));
        assertEq(selectorCount, 2);
    }

    function _assertPublishedRoutes(bytes32 expectedHash) internal view {
        bytes4[] memory selectors = registry.facetSetSelectors(expectedHash);
        assertEq(selectors.length, 2);
        assertEq(selectors[0], SELECTOR_A);
        assertEq(selectors[1], SELECTOR_B);
        (address storedFacet, bytes32 codeHash, uint8 kind) = registry.facetSetRoute(expectedHash, SELECTOR_B);
        assertEq(storedFacet, address(facetB));
        assertEq(codeHash, address(facetB).codehash);
        assertEq(kind, uint8(ProtocolFacetTypes.RouteKind.Mutating));
    }

    function testFacetSetHashCommitsEveryManifestFieldAndOrderedRouteField() public view {
        ProtocolFacetTypes.RouteDefinition[] memory routes = new ProtocolFacetTypes.RouteDefinition[](1);
        routes[0] = _route(SELECTOR_A, address(facetA), ProtocolFacetTypes.RouteKind.View);
        ProtocolFacetTypes.FacetSetManifest memory base =
            _manifest(1, 1, keccak256("manifest"), routes, address(0), bytes4(0));
        bytes32 expected = registry.computeFacetSetHash(base);

        ProtocolFacetTypes.FacetSetManifest memory changed = base;
        changed.release = 2;
        assertNotEq(registry.computeFacetSetHash(changed), expected);
        changed = base;
        changed.requiredStorageVersion = 2;
        assertNotEq(registry.computeFacetSetHash(changed), expected);
        changed = base;
        changed.predecessorFacetSetHash = keccak256("other-predecessor");
        assertNotEq(registry.computeFacetSetHash(changed), expected);
        changed = base;
        changed.storageLayoutHash = keccak256("other-layout");
        assertNotEq(registry.computeFacetSetHash(changed), expected);
        changed = base;
        changed.manifestHash = keccak256("other-manifest");
        assertNotEq(registry.computeFacetSetHash(changed), expected);
        changed = base;
        changed.routes[0].selector = SELECTOR_B;
        assertNotEq(registry.computeFacetSetHash(changed), expected);
        changed = base;
        changed.routes[0].facet = address(facetB);
        assertNotEq(registry.computeFacetSetHash(changed), expected);
        changed = base;
        changed.routes[0].codeHash = keccak256("other-code");
        assertNotEq(registry.computeFacetSetHash(changed), expected);
        changed = base;
        changed.routes[0].kind = ProtocolFacetTypes.RouteKind.Mutating;
        assertNotEq(registry.computeFacetSetHash(changed), expected);
        changed = base;
        changed.migrationFacet = address(migrationFacet);
        assertNotEq(registry.computeFacetSetHash(changed), expected);
        changed = base;
        changed.migrationSelector = MIGRATION_SELECTOR;
        assertNotEq(registry.computeFacetSetHash(changed), expected);
    }

    function testPublicationRejectsInvalidReleaseManifestAndSelectorShape() public {
        ProtocolFacetTypes.FacetSetManifest memory manifest = _singleRouteManifest(0, 1, SELECTOR_A, address(facetA));
        vm.expectRevert(ProtocolFacetRegistry.InvalidRelease.selector);
        registry.publishFacetSet(manifest);

        manifest.release = 1;
        manifest.manifestHash = bytes32(0);
        vm.expectRevert(ProtocolFacetRegistry.InvalidManifestHash.selector);
        registry.publishFacetSet(manifest);

        manifest.manifestHash = keccak256("manifest");
        manifest.storageLayoutHash = bytes32(0);
        vm.expectRevert(ProtocolFacetRegistry.InvalidStorageLayoutHash.selector);
        registry.publishFacetSet(manifest);

        manifest.storageLayoutHash = keccak256("layout");
        manifest.predecessorFacetSetHash = keccak256("invalid-predecessor");
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolFacetRegistry.InvalidPredecessorFacetSet.selector, manifest.predecessorFacetSetHash, uint64(1)
            )
        );
        registry.publishFacetSet(manifest);

        manifest = _singleRouteManifest(1, 1, RESERVED_A, address(facetA));
        vm.expectRevert(abi.encodeWithSelector(ProtocolFacetRegistry.ReservedKernelSelector.selector, RESERVED_A));
        registry.publishFacetSet(manifest);

        ProtocolFacetTypes.RouteDefinition[] memory duplicate = new ProtocolFacetTypes.RouteDefinition[](2);
        duplicate[0] = _route(SELECTOR_A, address(facetA), ProtocolFacetTypes.RouteKind.View);
        duplicate[1] = _route(SELECTOR_A, address(facetB), ProtocolFacetTypes.RouteKind.Mutating);
        manifest = _manifest(1, 1, keccak256("duplicate"), duplicate, address(0), bytes4(0));
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolFacetRegistry.SelectorsNotStrictlyAscending.selector, SELECTOR_A, SELECTOR_A)
        );
        registry.publishFacetSet(manifest);

        ProtocolFacetTypes.RouteDefinition[] memory descending = new ProtocolFacetTypes.RouteDefinition[](2);
        descending[0] = _route(SELECTOR_B, address(facetA), ProtocolFacetTypes.RouteKind.View);
        descending[1] = _route(SELECTOR_A, address(facetB), ProtocolFacetTypes.RouteKind.Mutating);
        manifest = _manifest(1, 1, keccak256("descending"), descending, address(0), bytes4(0));
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolFacetRegistry.SelectorsNotStrictlyAscending.selector, SELECTOR_B, SELECTOR_A)
        );
        registry.publishFacetSet(manifest);

        ProtocolFacetTypes.RouteDefinition[] memory excessive = new ProtocolFacetTypes.RouteDefinition[](257);
        for (uint256 i; i < excessive.length; ++i) {
            // Safe because the loop is bounded to 257.
            // forge-lint: disable-next-line(unsafe-typecast)
            excessive[i] = _route(bytes4(uint32(i + 1)), address(facetA), ProtocolFacetTypes.RouteKind.View);
        }
        manifest = _manifest(1, 1, keccak256("excessive"), excessive, address(0), bytes4(0));
        vm.expectRevert(abi.encodeWithSelector(ProtocolFacetRegistry.TooManySelectors.selector, 257, 256));
        registry.publishFacetSet(manifest);
    }

    function testPublicationRejectsInvalidFacetAndCodeHash() public {
        ProtocolFacetTypes.FacetSetManifest memory manifest = _singleRouteManifest(1, 1, SELECTOR_A, address(0));
        vm.expectRevert(abi.encodeWithSelector(ProtocolFacetRegistry.InvalidFacet.selector, SELECTOR_A, address(0)));
        registry.publishFacetSet(manifest);

        manifest = _singleRouteManifest(1, 1, SELECTOR_A, stranger);
        vm.expectRevert(abi.encodeWithSelector(ProtocolFacetRegistry.InvalidFacet.selector, SELECTOR_A, stranger));
        registry.publishFacetSet(manifest);

        manifest = _singleRouteManifest(1, 1, SELECTOR_A, address(registry));
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolFacetRegistry.InvalidFacet.selector, SELECTOR_A, address(registry))
        );
        registry.publishFacetSet(manifest);

        manifest = _singleRouteManifest(1, 1, SELECTOR_A, address(facetA));
        manifest.routes[0].codeHash = keccak256("incorrect");
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolFacetRegistry.FacetCodeHashMismatch.selector,
                address(facetA),
                keccak256("incorrect"),
                address(facetA).codehash
            )
        );
        registry.publishFacetSet(manifest);
    }

    function testPublicationRequiresExactlyPinnedMigrationRoute() public {
        ProtocolFacetTypes.FacetSetManifest memory manifest = _singleRouteManifest(1, 2, SELECTOR_A, address(facetA));
        manifest.migrationFacet = address(migrationFacet);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolFacetRegistry.InvalidMigrationRoute.selector, address(migrationFacet), bytes4(0)
            )
        );
        registry.publishFacetSet(manifest);

        manifest = _singleRouteManifest(1, 2, SELECTOR_A, address(facetA));
        manifest.migrationSelector = MIGRATION_SELECTOR;
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolFacetRegistry.InvalidMigrationRoute.selector, address(0), MIGRATION_SELECTOR)
        );
        registry.publishFacetSet(manifest);

        manifest = _singleRouteManifest(1, 2, SELECTOR_A, address(facetA));
        manifest.migrationFacet = address(migrationFacet);
        manifest.migrationSelector = MIGRATION_SELECTOR;
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolFacetRegistry.InvalidMigrationRoute.selector, address(migrationFacet), MIGRATION_SELECTOR
            )
        );
        registry.publishFacetSet(manifest);

        ProtocolFacetTypes.RouteDefinition[] memory routes = new ProtocolFacetTypes.RouteDefinition[](1);
        routes[0] = _route(SELECTOR_A, address(facetA), ProtocolFacetTypes.RouteKind.Migration);
        manifest = _manifest(1, 2, keccak256("wrong-migration"), routes, address(migrationFacet), MIGRATION_SELECTOR);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolFacetRegistry.InvalidMigrationRoute.selector, address(migrationFacet), MIGRATION_SELECTOR
            )
        );
        registry.publishFacetSet(manifest);

        routes = new ProtocolFacetTypes.RouteDefinition[](2);
        routes[0] = _route(SELECTOR_A, address(facetA), ProtocolFacetTypes.RouteKind.Migration);
        routes[1] = _route(SELECTOR_B, address(facetB), ProtocolFacetTypes.RouteKind.Migration);
        manifest = _manifest(1, 2, keccak256("multiple-migration"), routes, address(facetA), SELECTOR_A);
        vm.expectRevert(
            abi.encodeWithSelector(ProtocolFacetRegistry.InvalidMigrationRoute.selector, address(facetA), SELECTOR_A)
        );
        registry.publishFacetSet(manifest);
    }

    function testActivationRejectsUnpublishedNonIncreasingAndStorageRegression() public {
        bytes32 missingHash = keccak256("missing");
        vm.expectRevert(abi.encodeWithSelector(ProtocolFacetRegistry.FacetSetNotPublished.selector, missingHash));
        registry.activateFacetSet(missingHash);

        ProtocolFacetTypes.FacetSetManifest memory releaseOne = _singleRouteManifest(1, 4, SELECTOR_A, address(facetA));
        bytes32 hashOne = registry.publishFacetSet(releaseOne);
        registry.activateFacetSet(hashOne);

        vm.expectRevert(abi.encodeWithSelector(ProtocolFacetRegistry.ReleaseNotIncreasing.selector, 1, 1));
        registry.activateFacetSet(hashOne);

        ProtocolFacetTypes.FacetSetManifest memory releaseTwo = _singleRouteManifest(2, 3, SELECTOR_A, address(facetA));
        bytes32 hashTwo = registry.publishFacetSet(releaseTwo);
        vm.expectRevert(abi.encodeWithSelector(ProtocolFacetRegistry.StorageVersionDecreased.selector, 4, 3));
        registry.activateFacetSet(hashTwo);
    }

    function testActivationRequiresExactPublishedPredecessor() public {
        ProtocolFacetTypes.FacetSetManifest memory releaseOne = _singleRouteManifest(1, 1, SELECTOR_A, address(facetA));
        bytes32 hashOne = registry.publishFacetSet(releaseOne);
        registry.activateFacetSet(hashOne);

        ProtocolFacetTypes.FacetSetManifest memory releaseTwo = _singleRouteManifest(2, 1, SELECTOR_A, address(facetA));
        bytes32 hashTwo = registry.publishFacetSet(releaseTwo);
        ProtocolFacetTypes.FacetSetManifest memory releaseThree =
            _singleRouteManifest(3, 1, SELECTOR_A, address(facetA));
        releaseThree.predecessorFacetSetHash = hashTwo;
        bytes32 hashThree = registry.publishFacetSet(releaseThree);

        vm.expectRevert(
            abi.encodeWithSelector(ProtocolFacetRegistry.InvalidPredecessorFacetSet.selector, hashTwo, uint64(3))
        );
        registry.activateFacetSet(hashThree);
    }

    function testSameVersionActivationCannotChangeStorageLayoutCommitment() public {
        ProtocolFacetTypes.FacetSetManifest memory releaseOne = _singleRouteManifest(1, 1, SELECTOR_A, address(facetA));
        registry.activateFacetSet(registry.publishFacetSet(releaseOne));

        ProtocolFacetTypes.FacetSetManifest memory releaseTwo = _singleRouteManifest(2, 1, SELECTOR_A, address(facetB));
        bytes32 currentLayoutHash = registry.activeStorageLayoutHash();
        releaseTwo.storageLayoutHash = keccak256("incompatible-same-version-layout");
        bytes32 releaseTwoHash = registry.publishFacetSet(releaseTwo);

        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolFacetRegistry.StorageLayoutChangeRequiresMigration.selector,
                currentLayoutHash,
                releaseTwo.storageLayoutHash
            )
        );
        registry.activateFacetSet(releaseTwoHash);
    }

    function testStorageIncreaseRequiresAndAcceptsPinnedMigrationRoute() public {
        ProtocolFacetTypes.FacetSetManifest memory releaseOne = _singleRouteManifest(1, 4, SELECTOR_A, address(facetA));
        bytes32 hashOne = registry.publishFacetSet(releaseOne);
        registry.activateFacetSet(hashOne);

        ProtocolFacetTypes.FacetSetManifest memory missingMigration =
            _singleRouteManifest(2, 5, SELECTOR_A, address(facetA));
        bytes32 missingMigrationHash = registry.publishFacetSet(missingMigration);
        vm.expectRevert(abi.encodeWithSelector(ProtocolFacetRegistry.MigrationRequired.selector, 4, 5));
        registry.activateFacetSet(missingMigrationHash);

        ProtocolFacetTypes.RouteDefinition[] memory routes = new ProtocolFacetTypes.RouteDefinition[](2);
        routes[0] = _route(SELECTOR_A, address(facetA), ProtocolFacetTypes.RouteKind.Mutating);
        routes[1] = _route(MIGRATION_SELECTOR, address(migrationFacet), ProtocolFacetTypes.RouteKind.Migration);
        _sortRoutes(routes);
        ProtocolFacetTypes.FacetSetManifest memory migrated =
            _manifest(3, 5, keccak256("migrated-release"), routes, address(migrationFacet), MIGRATION_SELECTOR);
        bytes32 migratedHash = registry.publishFacetSet(migrated);
        registry.activateFacetSet(migratedHash);

        assertEq(registry.activeRelease(), 3);
        assertEq(registry.activeStorageVersion(), 5);
        (address activeMigrationFacet, bytes4 activeMigrationSelector) = registry.activeMigration();
        assertEq(activeMigrationFacet, address(migrationFacet));
        assertEq(activeMigrationSelector, MIGRATION_SELECTOR);
        (address facet, uint8 kind, uint64 storageVersion) = registry.route(MIGRATION_SELECTOR);
        assertEq(facet, address(migrationFacet));
        assertEq(kind, uint8(ProtocolFacetTypes.RouteKind.Migration));
        assertEq(storageVersion, 5);
    }

    function testSuccessorCannotDropCumulativeMigrationAndGenesisRoute() public {
        ProtocolFacetTypes.FacetSetManifest memory releaseOne = _singleRouteManifest(1, 1, SELECTOR_A, address(facetA));
        bytes32 releaseOneHash = registry.publishFacetSet(releaseOne);
        registry.activateFacetSet(releaseOneHash);

        ProtocolFacetTypes.RouteDefinition[] memory migrationRoutes = new ProtocolFacetTypes.RouteDefinition[](2);
        migrationRoutes[0] = _route(SELECTOR_A, address(facetA), ProtocolFacetTypes.RouteKind.Mutating);
        migrationRoutes[1] = _route(MIGRATION_SELECTOR, address(migrationFacet), ProtocolFacetTypes.RouteKind.Migration);
        _sortRoutes(migrationRoutes);
        ProtocolFacetTypes.FacetSetManifest memory releaseTwo =
            _manifest(2, 2, keccak256("release-two"), migrationRoutes, address(migrationFacet), MIGRATION_SELECTOR);
        bytes32 releaseTwoHash = registry.publishFacetSet(releaseTwo);
        registry.activateFacetSet(releaseTwoHash);

        ProtocolFacetTypes.FacetSetManifest memory missingContinuation =
            _singleRouteManifest(3, 2, SELECTOR_A, address(facetB));
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolFacetRegistry.MigrationRouteContinuityRequired.selector, releaseTwoHash, uint64(2)
            )
        );
        registry.publishFacetSet(missingContinuation);

        ProtocolFacetTypes.RouteDefinition[] memory successorRoutes = new ProtocolFacetTypes.RouteDefinition[](2);
        successorRoutes[0] = _route(SELECTOR_A, address(facetB), ProtocolFacetTypes.RouteKind.Mutating);
        successorRoutes[1] = _route(MIGRATION_SELECTOR, address(migrationFacet), ProtocolFacetTypes.RouteKind.Migration);
        _sortRoutes(successorRoutes);
        ProtocolFacetTypes.FacetSetManifest memory releaseThree =
            _manifest(3, 2, keccak256("release-three"), successorRoutes, address(migrationFacet), MIGRATION_SELECTOR);
        bytes32 releaseThreeHash = registry.publishFacetSet(releaseThree);
        registry.activateFacetSet(releaseThreeHash);

        assertEq(registry.activeFacetSetHash(), releaseThreeHash);
        (address activeMigrationFacet, bytes4 activeMigrationSelector) = registry.activeMigration();
        assertEq(activeMigrationFacet, address(migrationFacet));
        assertEq(activeMigrationSelector, MIGRATION_SELECTOR);
    }

    function testActivationRechecksPinnedFacetCodeHash() public {
        ProtocolFacetTypes.FacetSetManifest memory manifest = _singleRouteManifest(1, 1, SELECTOR_A, address(facetA));
        bytes32 facetSetHash = registry.publishFacetSet(manifest);
        bytes32 expectedCodeHash = address(facetA).codehash;

        vm.etch(address(facetA), hex"00");
        vm.expectRevert(
            abi.encodeWithSelector(
                ProtocolFacetRegistry.FacetCodeHashMismatch.selector,
                address(facetA),
                expectedCodeHash,
                address(facetA).codehash
            )
        );
        registry.activateFacetSet(facetSetHash);
    }

    function testActivationAtomicallyAddsReplacesRemovesAndProvidesLoupe() public {
        ProtocolFacetTypes.RouteDefinition[] memory firstRoutes = new ProtocolFacetTypes.RouteDefinition[](3);
        firstRoutes[0] = _route(SELECTOR_A, address(facetA), ProtocolFacetTypes.RouteKind.View);
        firstRoutes[1] = _route(SELECTOR_B, address(facetA), ProtocolFacetTypes.RouteKind.Mutating);
        firstRoutes[2] = _route(SELECTOR_C, address(facetB), ProtocolFacetTypes.RouteKind.View);
        ProtocolFacetTypes.FacetSetManifest memory first =
            _manifest(1, 1, keccak256("first"), firstRoutes, address(0), bytes4(0));
        bytes32 firstHash = registry.publishFacetSet(first);

        vm.expectEmit(true, true, true, true, address(registry));
        emit FacetSetActivated(
            bytes32(0), firstHash, 1, 1, first.storageLayoutHash, keccak256("first"), address(0), bytes4(0)
        );
        registry.activateFacetSet(firstHash);

        assertEq(registry.activeFacetSetHash(), firstHash);
        assertEq(registry.activeRelease(), 1);
        assertEq(registry.activeStorageVersion(), 1);
        assertEq(registry.facetAddress(SELECTOR_A), address(facetA));
        assertEq(registry.facetAddress(SELECTOR_B), address(facetA));
        assertEq(registry.facetAddress(SELECTOR_C), address(facetB));

        ProtocolFacetTypes.RouteDefinition[] memory secondRoutes = new ProtocolFacetTypes.RouteDefinition[](3);
        secondRoutes[0] = _route(SELECTOR_A, address(facetB), ProtocolFacetTypes.RouteKind.Mutating);
        secondRoutes[1] = _route(SELECTOR_C, address(facetB), ProtocolFacetTypes.RouteKind.View);
        secondRoutes[2] = _route(SELECTOR_D, address(facetA), ProtocolFacetTypes.RouteKind.View);
        ProtocolFacetTypes.FacetSetManifest memory second =
            _manifest(2, 1, keccak256("second"), secondRoutes, address(0), bytes4(0));
        bytes32 secondHash = registry.publishFacetSet(second);
        registry.activateFacetSet(secondHash);

        assertEq(registry.activeFacetSetHash(), secondHash);
        assertEq(registry.activeRelease(), 2);
        assertEq(registry.facetAddress(SELECTOR_A), address(facetB));
        assertEq(registry.facetAddress(SELECTOR_B), address(0));
        assertEq(registry.facetAddress(SELECTOR_C), address(facetB));
        assertEq(registry.facetAddress(SELECTOR_D), address(facetA));

        (address replacedFacet, uint8 replacedKind, uint64 storageVersion) = registry.route(SELECTOR_A);
        assertEq(replacedFacet, address(facetB));
        assertEq(replacedKind, uint8(ProtocolFacetTypes.RouteKind.Mutating));
        assertEq(storageVersion, 1);

        address[] memory facetAddresses = registry.facetAddresses();
        assertEq(facetAddresses.length, 2);
        assertEq(facetAddresses[0], address(facetB));
        assertEq(facetAddresses[1], address(facetA));

        bytes4[] memory facetBSelectors = registry.facetFunctionSelectors(address(facetB));
        assertEq(facetBSelectors.length, 2);
        assertEq(facetBSelectors[0], SELECTOR_A);
        assertEq(facetBSelectors[1], SELECTOR_C);
        bytes4[] memory facetASelectors = registry.facetFunctionSelectors(address(facetA));
        assertEq(facetASelectors.length, 1);
        assertEq(facetASelectors[0], SELECTOR_D);

        ProtocolFacetTypes.Facet[] memory facets = registry.facets();
        assertEq(facets.length, 2);
        assertEq(facets[0].facetAddress, address(facetB));
        assertEq(facets[0].functionSelectors.length, 2);
        assertEq(facets[0].functionSelectors[0], SELECTOR_A);
        assertEq(facets[0].functionSelectors[1], SELECTOR_C);
        assertEq(facets[1].facetAddress, address(facetA));
        assertEq(facets[1].functionSelectors.length, 1);
        assertEq(facets[1].functionSelectors[0], SELECTOR_D);
    }

    function testEmptyCompleteReleaseRemovesEveryActiveRoute() public {
        ProtocolFacetTypes.FacetSetManifest memory first = _singleRouteManifest(1, 1, SELECTOR_A, address(facetA));
        registry.activateFacetSet(registry.publishFacetSet(first));

        ProtocolFacetTypes.RouteDefinition[] memory empty = new ProtocolFacetTypes.RouteDefinition[](0);
        ProtocolFacetTypes.FacetSetManifest memory second =
            _manifest(2, 1, keccak256("empty-complete-release"), empty, address(0), bytes4(0));
        registry.activateFacetSet(registry.publishFacetSet(second));

        assertEq(registry.facetAddress(SELECTOR_A), address(0));
        assertEq(registry.facetAddresses().length, 0);
        assertEq(registry.facets().length, 0);
    }

    function _singleRouteManifest(uint64 release, uint64 storageVersion, bytes4 selector, address facet)
        internal
        view
        returns (ProtocolFacetTypes.FacetSetManifest memory)
    {
        ProtocolFacetTypes.RouteDefinition[] memory routes = new ProtocolFacetTypes.RouteDefinition[](1);
        routes[0] = _route(selector, facet, ProtocolFacetTypes.RouteKind.View);
        return
            _manifest(
                release, storageVersion, keccak256(abi.encode("manifest", release)), routes, address(0), bytes4(0)
            );
    }

    function _manifest(
        uint64 release,
        uint64 storageVersion,
        bytes32 manifestHash,
        ProtocolFacetTypes.RouteDefinition[] memory routes,
        address migrationFacet_,
        bytes4 migrationSelector
    ) internal view returns (ProtocolFacetTypes.FacetSetManifest memory) {
        bytes32 predecessorFacetSetHash = release == 1 ? bytes32(0) : registry.activeFacetSetHash();
        bytes32 storageLayoutHash;
        if (predecessorFacetSetHash != bytes32(0) && storageVersion == registry.activeStorageVersion()) {
            storageLayoutHash = registry.activeStorageLayoutHash();
        } else {
            storageLayoutHash = keccak256(abi.encode("layout", storageVersion));
        }
        return ProtocolFacetTypes.FacetSetManifest({
            release: release,
            requiredStorageVersion: storageVersion,
            predecessorFacetSetHash: predecessorFacetSetHash,
            storageLayoutHash: storageLayoutHash,
            manifestHash: manifestHash,
            routes: routes,
            migrationFacet: migrationFacet_,
            migrationSelector: migrationSelector
        });
    }

    function _route(bytes4 selector, address facet, ProtocolFacetTypes.RouteKind kind)
        internal
        view
        returns (ProtocolFacetTypes.RouteDefinition memory)
    {
        return ProtocolFacetTypes.RouteDefinition({
            selector: selector, facet: facet, codeHash: facet.codehash, kind: kind
        });
    }

    function _sortRoutes(ProtocolFacetTypes.RouteDefinition[] memory routes) internal pure {
        uint256 length = routes.length;
        for (uint256 i = 1; i < length; ++i) {
            ProtocolFacetTypes.RouteDefinition memory current = routes[i];
            uint256 j = i;
            while (j != 0 && routes[j - 1].selector > current.selector) {
                routes[j] = routes[j - 1];
                --j;
            }
            routes[j] = current;
        }
    }
}
