// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {LibClone} from "solady/utils/LibClone.sol";
import {BoardroomDiamondStorage} from "../../src/boardroom/diamond/BoardroomDiamondStorage.sol";
import {BoardroomKernel} from "../../src/boardroom/diamond/BoardroomKernel.sol";
import {BoardroomKernelSelectors} from "../../src/boardroom/diamond/BoardroomKernelSelectors.sol";
import {IBoardroomFacetRegistry} from "../../src/boardroom/diamond/IBoardroomFacetRegistry.sol";

library BoardroomKernelTestStorage {
    bytes32 internal constant SLOT = keccak256("pledge.cash.boardroom.diamond.kernel.test.storage");

    struct Layout {
        address initializer;
        address sender;
        address context;
        uint256 value;
        uint256 stored;
        bool migrationMarker;
    }

    function layout() internal pure returns (Layout storage result) {
        bytes32 slot = SLOT;
        assembly ("memory-safe") {
            result.slot := slot
        }
    }
}

contract BoardroomKernelTestFacet {
    error NotInitializing();
    error FacetFailure(uint256 reason);

    function initializeBoardroom(bytes32, bytes calldata initData) external {
        if (!BoardroomDiamondStorage.initializing()) revert NotInitializing();
        BoardroomKernelTestStorage.Layout storage state = BoardroomKernelTestStorage.layout();
        uint256 initialValue = abi.decode(initData, (uint256));
        state.initializer = msg.sender;
        state.stored = initialValue;
        if (initialValue == type(uint256).max) revert FacetFailure(8);
    }

    function mutate(bytes32, uint256 stored) external payable returns (bytes32 result) {
        BoardroomKernelTestStorage.Layout storage state = BoardroomKernelTestStorage.layout();
        state.sender = msg.sender;
        state.context = address(this);
        state.value = msg.value;
        state.stored = stored;
        result = keccak256(abi.encode(msg.sender, address(this), msg.value, stored));
    }

    function mutateAndActivate(
        bytes32,
        uint256 stored,
        MockBoardroomFacetRegistry registry,
        bytes32 nextHash,
        uint64 nextVersion
    ) external {
        BoardroomKernelTestStorage.layout().stored = stored;
        registry.setActive(nextHash, nextVersion);
    }

    function mutateAndCorruptKernel(bytes32, bool initialized, bool initializing, bool migrating) external {
        BoardroomDiamondStorage.Layout storage kernel = BoardroomDiamondStorage.layout();
        kernel.initialized = initialized;
        kernel.initializing = initializing;
        kernel.migrating = migrating;
        BoardroomKernelTestStorage.layout().stored = 99;
    }

    function readContext()
        external
        view
        returns (address initializer, address sender, address context, uint256 value, uint256 stored)
    {
        BoardroomKernelTestStorage.Layout storage state = BoardroomKernelTestStorage.layout();
        return (state.initializer, state.sender, state.context, state.value, state.stored);
    }

    function fail(bytes32) external pure {
        revert FacetFailure(7);
    }

    function migrate(bytes32, uint64 targetVersion) external {
        BoardroomDiamondStorage.setAppliedStorage(targetVersion, bytes32(uint256(targetVersion)));
        BoardroomKernelTestStorage.layout().migrationMarker = true;
    }

    function finalizeGenesis(bytes32) external {
        if (
            !BoardroomDiamondStorage.initializing() || BoardroomDiamondStorage.appliedStorageVersion() != 0
                || BoardroomDiamondStorage.appliedStorageLayoutHash() != bytes32(0)
        ) revert NotInitializing();
        BoardroomDiamondStorage.setAppliedStorage(2, bytes32(uint256(2)));
        BoardroomKernelTestStorage.layout().migrationMarker = true;
    }

    function migrateWrong(bytes32, uint64 targetVersion) external {
        BoardroomDiamondStorage.setAppliedStorage(targetVersion + 1, bytes32(uint256(targetVersion + 1)));
        BoardroomKernelTestStorage.layout().migrationMarker = true;
    }

    function migrateAndCorruptKernel(bytes32, uint64 targetVersion, bool initialized, bool initializing) external {
        BoardroomDiamondStorage.setAppliedStorage(targetVersion, bytes32(uint256(targetVersion)));
        BoardroomDiamondStorage.Layout storage kernel = BoardroomDiamondStorage.layout();
        kernel.initialized = initialized;
        kernel.initializing = initializing;
        BoardroomKernelTestStorage.layout().migrationMarker = true;
    }

    function migrateReentrant(bytes32, uint64) external {
        (bool success, bytes memory output) = address(this).call(msg.data);
        if (!success) {
            assembly ("memory-safe") {
                revert(add(output, 0x20), mload(output))
            }
        }
    }

    function migrateAndReenterMutating(bytes32 expectedFacetSetHash, uint64 targetVersion) external {
        BoardroomDiamondStorage.setAppliedStorage(targetVersion, bytes32(uint256(targetVersion)));
        (bool success, bytes memory output) =
            address(this).call(abi.encodeCall(this.mutate, (expectedFacetSetHash, uint256(88))));
        if (!success) {
            assembly ("memory-safe") {
                revert(add(output, 0x20), mload(output))
            }
        }
    }

    function migrationMarker() external view returns (bool) {
        return BoardroomKernelTestStorage.layout().migrationMarker;
    }

    function mutateMisclassifiedAsView(uint256 stored) external returns (uint256) {
        BoardroomKernelTestStorage.layout().stored = stored;
        return stored;
    }

    function viewCallerAndContext() external view returns (address caller, address context) {
        return (msg.sender, address(this));
    }
}

contract MockBoardroomFacetRegistry is IBoardroomFacetRegistry {
    struct Route {
        address facet;
        bytes32 codeHash;
        uint8 kind;
        uint64 requiredStorageVersion;
    }

    bytes32 internal activeHash;
    uint64 internal activeVersion;
    bytes32 internal activeLayoutHash;
    address internal activeMigrationFacet;
    bytes4 internal activeMigrationSelector;
    mapping(bytes4 selector => Route) internal routeOf;
    bytes32 internal selectorSetHash = BoardroomKernelSelectors.selectorSetHash();
    bool internal failActiveReads;
    bool internal failRouteReads;

    function setKernelSelectorSetHash(bytes32 value) external {
        selectorSetHash = value;
    }

    function kernelSelectorSetHash() external view returns (bytes32) {
        return selectorSetHash;
    }

    function setActive(bytes32 hash, uint64 version) external {
        activeHash = hash;
        activeVersion = version;
        activeLayoutHash = bytes32(uint256(version));
    }

    function setRoute(bytes4 selector, address facet, uint8 kind, uint64 requiredStorageVersion) external {
        routeOf[selector] = Route(facet, facet.codehash, kind, requiredStorageVersion);
    }

    function setActiveMigration(address facet, bytes4 selector) external {
        activeMigrationFacet = facet;
        activeMigrationSelector = selector;
    }

    function setFailures(bool activeReads, bool routeReads) external {
        failActiveReads = activeReads;
        failRouteReads = routeReads;
    }

    function activeFacetSetHash() external view returns (bytes32) {
        if (failActiveReads) revert("ACTIVE_READ_FAILED");
        return activeHash;
    }

    function activeStorageVersion() external view returns (uint64) {
        if (failActiveReads) revert("VERSION_READ_FAILED");
        return activeVersion;
    }

    function activeStorageLayoutHash() external view returns (bytes32) {
        if (failActiveReads) revert("LAYOUT_READ_FAILED");
        return activeLayoutHash;
    }

    function activeMigration() external view returns (address facet, bytes4 selector) {
        if (failActiveReads) revert("MIGRATION_READ_FAILED");
        return (activeMigrationFacet, activeMigrationSelector);
    }

    function route(bytes4 selector)
        external
        view
        returns (address facet, bytes32 codeHash, uint8 kind, uint64 requiredStorageVersion)
    {
        if (failRouteReads) revert("ROUTE_READ_FAILED");
        Route storage selected = routeOf[selector];
        return (selected.facet, selected.codeHash, selected.kind, selected.requiredStorageVersion);
    }
}

contract BoardroomKernelTest is Test {
    bytes32 internal constant RELEASE_HASH_V1 = keccak256("release-v1");
    bytes32 internal constant RELEASE_HASH_V2 = keccak256("release-v2");
    uint8 internal constant VIEW = 0;
    uint8 internal constant MUTATING = 1;
    uint8 internal constant MIGRATION = 2;

    MockBoardroomFacetRegistry internal registry;
    BoardroomKernel internal implementation;
    BoardroomKernelTestFacet internal facet;
    BoardroomKernel internal kernel;

    function setUp() public {
        registry = new MockBoardroomFacetRegistry();
        facet = new BoardroomKernelTestFacet();
        registry.setActive(RELEASE_HASH_V1, 1);
        registry.setRoute(BoardroomKernelTestFacet.initializeBoardroom.selector, address(facet), MUTATING, 1);
        registry.setRoute(BoardroomKernelTestFacet.mutate.selector, address(facet), MUTATING, 1);
        registry.setRoute(BoardroomKernelTestFacet.mutateAndActivate.selector, address(facet), MUTATING, 1);
        registry.setRoute(BoardroomKernelTestFacet.mutateAndCorruptKernel.selector, address(facet), MUTATING, 1);
        registry.setRoute(BoardroomKernelTestFacet.readContext.selector, address(facet), VIEW, 1);
        registry.setRoute(BoardroomKernelTestFacet.fail.selector, address(facet), MUTATING, 1);
        registry.setRoute(BoardroomKernelTestFacet.migrationMarker.selector, address(facet), VIEW, 1);
        registry.setRoute(BoardroomKernelTestFacet.mutateMisclassifiedAsView.selector, address(facet), VIEW, 1);
        registry.setRoute(BoardroomKernelTestFacet.viewCallerAndContext.selector, address(facet), VIEW, 1);

        implementation = new BoardroomKernel(address(registry));
        kernel = _newKernel();
        kernel.initialize(RELEASE_HASH_V1, abi.encode(uint256(11)));
    }

    function testInitializationIsCloneSafeAtomicAndImplementationDisabled() public {
        assertEq(address(kernel.facetRegistry()), address(registry));
        assertEq(kernel.kernelSelectorSetHash(), BoardroomKernelSelectors.selectorSetHash());
        assertEq(kernel.facetSetHash(), RELEASE_HASH_V1);
        assertEq(kernel.appliedStorageVersion(), 1);
        assertEq(kernel.appliedStorageLayoutHash(), bytes32(uint256(1)));
        assertFalse(kernel.migrationRequired());

        (address initializer,,,, uint256 stored) = _readContext(kernel);
        assertEq(initializer, address(this));
        assertEq(stored, 11);

        vm.expectRevert(BoardroomKernel.AlreadyInitialized.selector);
        kernel.initialize(RELEASE_HASH_V1, abi.encode(uint256(12)));

        vm.expectRevert(BoardroomKernel.AlreadyInitialized.selector);
        implementation.initialize(RELEASE_HASH_V1, abi.encode(uint256(12)));
    }

    function testConstructorRejectsRegistryWithDifferentKernelSelectorSet() public {
        MockBoardroomFacetRegistry mismatchedRegistry = new MockBoardroomFacetRegistry();
        bytes32 expectedHash = BoardroomKernelSelectors.selectorSetHash();
        bytes32 actualHash = keccak256("different-kernel-selectors");
        mismatchedRegistry.setKernelSelectorSetHash(actualHash);

        vm.expectRevert(
            abi.encodeWithSelector(BoardroomKernel.InvalidKernelSelectorSetHash.selector, expectedHash, actualHash)
        );
        new BoardroomKernel(address(mismatchedRegistry));
    }

    function testInitializationHookFailureRollsBackKernelMetadata() public {
        BoardroomKernel candidate = _newKernel();
        vm.expectRevert(abi.encodeWithSelector(BoardroomKernelTestFacet.FacetFailure.selector, uint256(8)));
        candidate.initialize(RELEASE_HASH_V1, abi.encode(type(uint256).max));

        candidate.initialize(RELEASE_HASH_V1, abi.encode(uint256(19)));
        assertEq(candidate.appliedStorageVersion(), 1);
        (,,,, uint256 stored) = _readContext(candidate);
        assertEq(stored, 19);
    }

    function testInitializationRejectsFacetWhoseRuntimeCodeNoLongerMatchesRelease() public {
        BoardroomKernel candidate = _newKernel();
        bytes32 committedCodeHash = address(facet).codehash;
        vm.etch(address(facet), hex"00");

        vm.expectRevert(
            abi.encodeWithSelector(
                BoardroomKernel.FacetCodeHashMismatch.selector,
                BoardroomKernelTestFacet.initializeBoardroom.selector,
                address(facet),
                committedCodeHash,
                address(facet).codehash
            )
        );
        candidate.initialize(RELEASE_HASH_V1, abi.encode(uint256(19)));
    }

    function testInitializationRunsActiveReleaseGenesisMigration() public {
        registry.setActive(RELEASE_HASH_V2, 2);
        registry.setRoute(BoardroomKernelTestFacet.initializeBoardroom.selector, address(facet), MUTATING, 2);
        registry.setRoute(BoardroomKernelTestFacet.finalizeGenesis.selector, address(facet), MIGRATION, 2);
        registry.setRoute(BoardroomKernelTestFacet.migrationMarker.selector, address(facet), VIEW, 2);
        registry.setActiveMigration(address(facet), BoardroomKernelTestFacet.finalizeGenesis.selector);

        BoardroomKernel candidate = _newKernel();
        candidate.initialize(RELEASE_HASH_V2, abi.encode(uint256(23)));

        assertEq(candidate.appliedStorageVersion(), 2);
        assertEq(candidate.appliedStorageLayoutHash(), bytes32(uint256(2)));
        assertFalse(candidate.migrationRequired());
        assertTrue(_migrationMarker(candidate));
        (,,,, uint256 stored) = _readContext(candidate);
        assertEq(stored, 23);
    }

    function testInitializationRejectsGenesisMigrationFacetWhoseRuntimeCodeNoLongerMatchesRelease() public {
        BoardroomKernelTestFacet genesisMigrationFacet = new BoardroomKernelTestFacet();
        registry.setActive(RELEASE_HASH_V2, 2);
        registry.setRoute(BoardroomKernelTestFacet.initializeBoardroom.selector, address(facet), MUTATING, 2);
        registry.setRoute(
            BoardroomKernelTestFacet.finalizeGenesis.selector, address(genesisMigrationFacet), MIGRATION, 2
        );
        registry.setActiveMigration(address(genesisMigrationFacet), BoardroomKernelTestFacet.finalizeGenesis.selector);
        bytes32 committedCodeHash = address(genesisMigrationFacet).codehash;
        vm.etch(address(genesisMigrationFacet), hex"00");

        BoardroomKernel candidate = _newKernel();
        vm.expectRevert(
            abi.encodeWithSelector(
                BoardroomKernel.FacetCodeHashMismatch.selector,
                BoardroomKernelTestFacet.finalizeGenesis.selector,
                address(genesisMigrationFacet),
                committedCodeHash,
                address(genesisMigrationFacet).codehash
            )
        );
        candidate.initialize(RELEASE_HASH_V2, abi.encode(uint256(23)));
    }

    function testUninitializedCloneCannotRoute() public {
        BoardroomKernel candidate = _newKernel();
        vm.expectRevert(BoardroomKernel.NotInitialized.selector);
        _call(candidate, abi.encodeWithSelector(BoardroomKernelTestFacet.readContext.selector));
    }

    function testDelegatecallPreservesSenderValueContextStorageAndReturnData() public {
        address caller = address(0xA11CE);
        vm.deal(caller, 2 ether);
        bytes memory input = abi.encodeCall(BoardroomKernelTestFacet.mutate, (RELEASE_HASH_V1, 77));

        vm.prank(caller);
        (bool success, bytes memory output) = address(kernel).call{value: 1 ether}(input);
        assertTrue(success);
        assertEq(
            abi.decode(output, (bytes32)), keccak256(abi.encode(caller, address(kernel), uint256(1 ether), uint256(77)))
        );

        (address initializer, address sender, address context, uint256 value, uint256 stored) = _readContext(kernel);
        assertEq(initializer, address(this));
        assertEq(sender, caller);
        assertEq(context, address(kernel));
        assertEq(value, 1 ether);
        assertEq(stored, 77);
        assertEq(address(kernel).balance, 1 ether);
    }

    function testReceiveAcceptsNativeValue() public {
        (bool success,) = address(kernel).call{value: 3 wei}("");
        assertTrue(success);
        assertEq(address(kernel).balance, 3 wei);
    }

    function testViewRollbackDispatchPreservesContextAndCannotPersistWrites() public {
        address caller = address(0xC011AB1E);
        vm.prank(caller);
        (bool success, bytes memory output) =
            address(kernel).call(abi.encodeCall(BoardroomKernelTestFacet.mutateMisclassifiedAsView, (99)));
        assertTrue(success);
        assertEq(abi.decode(output, (uint256)), 99);
        (,,,, uint256 stored) = _readContext(kernel);
        assertEq(stored, 11);

        vm.prank(caller);
        (success, output) = address(kernel).call(abi.encodeCall(BoardroomKernelTestFacet.viewCallerAndContext, ()));
        assertTrue(success);
        (address observedCaller, address observedContext) = abi.decode(output, (address, address));
        assertEq(observedCaller, caller);
        assertEq(observedContext, address(kernel));
    }

    function testViewDispatchRejectsFacetWhoseRuntimeCodeNoLongerMatchesRelease() public {
        bytes32 committedCodeHash = address(facet).codehash;
        vm.etch(address(facet), hex"00");

        vm.expectRevert(
            abi.encodeWithSelector(
                BoardroomKernel.FacetCodeHashMismatch.selector,
                BoardroomKernelTestFacet.readContext.selector,
                address(facet),
                committedCodeHash,
                address(facet).codehash
            )
        );
        _call(kernel, abi.encodeWithSelector(BoardroomKernelTestFacet.readContext.selector));
    }

    function testMutatingDispatchRejectsFacetWhoseRuntimeCodeNoLongerMatchesRelease() public {
        bytes32 committedCodeHash = address(facet).codehash;
        vm.etch(address(facet), hex"00");

        vm.expectRevert(
            abi.encodeWithSelector(
                BoardroomKernel.FacetCodeHashMismatch.selector,
                BoardroomKernelTestFacet.mutate.selector,
                address(facet),
                committedCodeHash,
                address(facet).codehash
            )
        );
        _call(kernel, abi.encodeCall(BoardroomKernelTestFacet.mutate, (RELEASE_HASH_V1, uint256(77))));
    }

    function testFacetReturnAndRevertDataAreBubbled() public {
        vm.expectRevert(abi.encodeWithSelector(BoardroomKernelTestFacet.FacetFailure.selector, 7));
        _call(kernel, abi.encodeCall(BoardroomKernelTestFacet.fail, (RELEASE_HASH_V1)));
    }

    function testUnknownNoCodeAndRegistryFailureFailClosed() public {
        bytes4 unknown = bytes4(keccak256("unknown()"));
        vm.expectRevert(abi.encodeWithSelector(BoardroomKernel.UnknownSelector.selector, unknown));
        _call(kernel, abi.encodeWithSelector(unknown));

        registry.setRoute(unknown, address(0xBEEF), VIEW, 1);
        vm.expectRevert(abi.encodeWithSelector(BoardroomKernel.InvalidFacet.selector, unknown, address(0xBEEF)));
        _call(kernel, abi.encodeWithSelector(unknown));

        registry.setFailures(false, true);
        vm.expectRevert(BoardroomKernel.RegistryCallFailed.selector);
        _call(kernel, abi.encodeWithSelector(unknown));

        registry.setFailures(true, false);
        vm.expectRevert(BoardroomKernel.RegistryCallFailed.selector);
        kernel.facetSetHash();
    }

    function testMutatingRouteRejectsMissingAndStaleFacetSetHash() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                BoardroomKernel.MissingExpectedFacetSetHash.selector, BoardroomKernelTestFacet.mutate.selector
            )
        );
        _call(kernel, abi.encodeWithSelector(BoardroomKernelTestFacet.mutate.selector));

        vm.expectRevert(
            abi.encodeWithSelector(BoardroomKernel.FacetSetHashMismatch.selector, RELEASE_HASH_V2, RELEASE_HASH_V1)
        );
        _call(kernel, abi.encodeCall(BoardroomKernelTestFacet.mutate, (RELEASE_HASH_V2, uint256(9))));
    }

    function testMutatingRouteBlockedUntilMigration() public {
        _activateV2Routes();
        assertTrue(kernel.migrationRequired());

        vm.expectRevert(abi.encodeWithSelector(BoardroomKernel.StorageMigrationRequired.selector, uint64(1), uint64(2)));
        _call(kernel, abi.encodeCall(BoardroomKernelTestFacet.mutate, (RELEASE_HASH_V2, uint256(9))));
    }

    function testMutatingRouteRollsBackIfActiveReleaseChangesDuringDelegatecall() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                BoardroomKernel.ActiveReleaseChanged.selector,
                RELEASE_HASH_V1,
                RELEASE_HASH_V2,
                uint64(1),
                uint64(2),
                bytes32(uint256(1)),
                bytes32(uint256(2))
            )
        );
        _call(
            kernel,
            abi.encodeCall(
                BoardroomKernelTestFacet.mutateAndActivate,
                (RELEASE_HASH_V1, uint256(99), registry, RELEASE_HASH_V2, uint64(2))
            )
        );

        assertEq(kernel.facetSetHash(), RELEASE_HASH_V1);
        assertFalse(kernel.migrationRequired());
        (,,,, uint256 stored) = _readContext(kernel);
        assertEq(stored, 11);
    }

    function testMutatingRouteRejectsAndRollsBackKernelMetadataCorruption() public {
        vm.expectRevert(abi.encodeWithSelector(BoardroomKernel.KernelMetadataCorrupted.selector, false, false, false));
        _call(
            kernel,
            abi.encodeCall(BoardroomKernelTestFacet.mutateAndCorruptKernel, (RELEASE_HASH_V1, false, false, false))
        );

        vm.expectRevert(abi.encodeWithSelector(BoardroomKernel.KernelMetadataCorrupted.selector, true, true, true));
        _call(
            kernel, abi.encodeCall(BoardroomKernelTestFacet.mutateAndCorruptKernel, (RELEASE_HASH_V1, true, true, true))
        );

        assertFalse(kernel.migrationRequired());
        (,,,, uint256 stored) = _readContext(kernel);
        assertEq(stored, 11);
    }

    function testMigrationWrongPostconditionRollsBackAllFacetWrites() public {
        _activateV2Routes();
        registry.setRoute(BoardroomKernelTestFacet.migrateWrong.selector, address(facet), MIGRATION, 2);

        vm.expectRevert(
            abi.encodeWithSelector(
                BoardroomKernel.MigrationPostconditionFailed.selector,
                uint64(2),
                uint64(3),
                bytes32(uint256(2)),
                bytes32(uint256(3))
            )
        );
        _call(kernel, abi.encodeCall(BoardroomKernelTestFacet.migrateWrong, (RELEASE_HASH_V2, uint64(2))));

        assertEq(kernel.appliedStorageVersion(), 1);
        assertFalse(_migrationMarker(kernel));
    }

    function testMigrationRejectsAndRollsBackKernelMetadataCorruption() public {
        _activateV2Routes();
        registry.setRoute(BoardroomKernelTestFacet.migrateAndCorruptKernel.selector, address(facet), MIGRATION, 2);

        vm.expectRevert(abi.encodeWithSelector(BoardroomKernel.KernelMetadataCorrupted.selector, false, true, false));
        _call(
            kernel,
            abi.encodeCall(BoardroomKernelTestFacet.migrateAndCorruptKernel, (RELEASE_HASH_V2, uint64(2), false, true))
        );

        assertEq(kernel.appliedStorageVersion(), 1);
        assertFalse(_migrationMarker(kernel));
        assertTrue(kernel.migrationRequired());
    }

    function testMigrationRejectsStaleFacetSetHash() public {
        _activateV2Routes();
        registry.setRoute(BoardroomKernelTestFacet.migrate.selector, address(facet), MIGRATION, 2);

        vm.expectRevert(
            abi.encodeWithSelector(BoardroomKernel.FacetSetHashMismatch.selector, RELEASE_HASH_V1, RELEASE_HASH_V2)
        );
        _call(kernel, abi.encodeCall(BoardroomKernelTestFacet.migrate, (RELEASE_HASH_V1, uint64(2))));
        assertEq(kernel.appliedStorageVersion(), 1);
    }

    function testMigrationIsPermissionlessSucceedsAndCannotRepeat() public {
        _activateV2Routes();
        registry.setRoute(BoardroomKernelTestFacet.migrate.selector, address(facet), MIGRATION, 2);

        address caller = address(0xB0B);
        vm.prank(caller);
        (bool success,) =
            address(kernel).call(abi.encodeCall(BoardroomKernelTestFacet.migrate, (RELEASE_HASH_V2, uint64(2))));
        assertTrue(success);
        assertEq(kernel.appliedStorageVersion(), 2);
        assertFalse(kernel.migrationRequired());
        assertTrue(_migrationMarker(kernel));

        vm.expectRevert(abi.encodeWithSelector(BoardroomKernel.AlreadyMigrated.selector, uint64(2)));
        _call(kernel, abi.encodeCall(BoardroomKernelTestFacet.migrate, (RELEASE_HASH_V2, uint64(2))));
    }

    function testMigrationDispatchRejectsFacetWhoseRuntimeCodeNoLongerMatchesRelease() public {
        _activateV2Routes();
        registry.setRoute(BoardroomKernelTestFacet.migrate.selector, address(facet), MIGRATION, 2);
        bytes32 committedCodeHash = address(facet).codehash;
        vm.etch(address(facet), hex"00");

        vm.expectRevert(
            abi.encodeWithSelector(
                BoardroomKernel.FacetCodeHashMismatch.selector,
                BoardroomKernelTestFacet.migrate.selector,
                address(facet),
                committedCodeHash,
                address(facet).codehash
            )
        );
        _call(kernel, abi.encodeCall(BoardroomKernelTestFacet.migrate, (RELEASE_HASH_V2, uint64(2))));
        assertEq(kernel.appliedStorageVersion(), 1);
    }

    function testActiveMigrationCanUpgradeMultiVersionStragglerInOneCall() public {
        registry.setActive(RELEASE_HASH_V2, 3);
        registry.setRoute(BoardroomKernelTestFacet.mutate.selector, address(facet), MUTATING, 3);
        registry.setRoute(BoardroomKernelTestFacet.migrationMarker.selector, address(facet), VIEW, 3);
        registry.setRoute(BoardroomKernelTestFacet.migrate.selector, address(facet), MIGRATION, 3);

        assertEq(kernel.appliedStorageVersion(), 1);
        assertTrue(kernel.migrationRequired());
        _call(kernel, abi.encodeCall(BoardroomKernelTestFacet.migrate, (RELEASE_HASH_V2, uint64(3))));

        assertEq(kernel.appliedStorageVersion(), 3);
        assertEq(kernel.appliedStorageLayoutHash(), bytes32(uint256(3)));
        assertFalse(kernel.migrationRequired());
        assertTrue(_migrationMarker(kernel));
    }

    function testMigrationReentrancyIsBlockedAndRollsBack() public {
        _activateV2Routes();
        registry.setRoute(BoardroomKernelTestFacet.migrateReentrant.selector, address(facet), MIGRATION, 2);

        vm.expectRevert(BoardroomKernel.MigrationReentrancy.selector);
        _call(kernel, abi.encodeCall(BoardroomKernelTestFacet.migrateReentrant, (RELEASE_HASH_V2, uint64(2))));
        assertEq(kernel.appliedStorageVersion(), 1);
        assertFalse(_migrationMarker(kernel));
    }

    function testMigrationCannotReenterMutatingRouteAfterSettingTargetVersion() public {
        _activateV2Routes();
        registry.setRoute(BoardroomKernelTestFacet.migrateAndReenterMutating.selector, address(facet), MIGRATION, 2);

        vm.expectRevert(BoardroomKernel.MigrationReentrancy.selector);
        _call(kernel, abi.encodeCall(BoardroomKernelTestFacet.migrateAndReenterMutating, (RELEASE_HASH_V2, uint64(2))));

        assertEq(kernel.appliedStorageVersion(), 1);
        (,,,, uint256 stored) = _readContext(kernel);
        assertEq(stored, 11);
    }

    function testMigrationRouteMustBePinnedToActiveStorageVersion() public {
        _activateV2Routes();
        registry.setRoute(BoardroomKernelTestFacet.migrate.selector, address(facet), MIGRATION, 3);

        vm.expectRevert(
            abi.encodeWithSelector(
                BoardroomKernel.RouteStorageVersionMismatch.selector,
                BoardroomKernelTestFacet.migrate.selector,
                uint64(3),
                uint64(2)
            )
        );
        _call(kernel, abi.encodeCall(BoardroomKernelTestFacet.migrate, (RELEASE_HASH_V2, uint64(2))));
    }

    function testBusinessInitializerCannotRunOutsideKernelInitialization() public {
        vm.expectRevert(BoardroomKernelTestFacet.NotInitializing.selector);
        _call(
            kernel,
            abi.encodeCall(BoardroomKernelTestFacet.initializeBoardroom, (RELEASE_HASH_V1, abi.encode(uint256(99))))
        );
    }

    function _activateV2Routes() internal {
        registry.setActive(RELEASE_HASH_V2, 2);
        registry.setRoute(BoardroomKernelTestFacet.mutate.selector, address(facet), MUTATING, 2);
        registry.setRoute(BoardroomKernelTestFacet.migrationMarker.selector, address(facet), VIEW, 2);
    }

    function _newKernel() internal returns (BoardroomKernel created) {
        created = BoardroomKernel(payable(LibClone.clone(address(implementation))));
    }

    function _call(BoardroomKernel target, bytes memory input) internal returns (bool success) {
        (success,) = address(target).call(input);
    }

    function _readContext(BoardroomKernel target)
        internal
        view
        returns (address initializer, address sender, address context, uint256 value, uint256 stored)
    {
        (bool success, bytes memory output) =
            address(target).staticcall(abi.encodeWithSelector(BoardroomKernelTestFacet.readContext.selector));
        assertTrue(success);
        return abi.decode(output, (address, address, address, uint256, uint256));
    }

    function _migrationMarker(BoardroomKernel target) internal view returns (bool marker) {
        (bool success, bytes memory output) =
            address(target).staticcall(abi.encodeWithSelector(BoardroomKernelTestFacet.migrationMarker.selector));
        assertTrue(success);
        return abi.decode(output, (bool));
    }
}
