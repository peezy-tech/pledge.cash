// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {LibClone} from "solady/utils/LibClone.sol";
import {WETH} from "solady/tokens/WETH.sol";
import {Boardroom} from "../../src/boardroom/Boardroom.sol";
import {BoardroomGovernanceLogic} from "../../src/boardroom/BoardroomGovernanceLogic.sol";
import {BoardroomCall} from "../../src/boardroom/IBoardroomGovernance.sol";
import {BoardroomMarketLogic} from "../../src/boardroom/BoardroomMarketLogic.sol";
import {BoardroomPolicyRegistry} from "../../src/boardroom/BoardroomPolicyRegistry.sol";
import {BoardroomRedemptionPayout} from "../../src/boardroom/BoardroomRedemptionPayout.sol";
import {BoardroomRewards} from "../../src/rewards/BoardroomRewards.sol";
import {BoardroomRewardsFactory} from "../../src/rewards/BoardroomRewardsFactory.sol";
import {IBoardroomObligationPolicy} from "../../src/policy/IBoardroomObligationPolicy.sol";
import {BoardroomAuthorityFacet} from "../../src/boardroom/diamond/BoardroomAuthorityFacet.sol";
import {IBoardroomDiamond} from "../../src/boardroom/diamond/BoardroomDiamond.sol";
import {BoardroomExecutionFacet} from "../../src/boardroom/diamond/BoardroomExecutionFacet.sol";
import {BoardroomKernel} from "../../src/boardroom/diamond/BoardroomKernel.sol";
import {BoardroomMarketFacet} from "../../src/boardroom/diamond/BoardroomMarketFacet.sol";
import {BoardroomRedemptionFacet} from "../../src/boardroom/diamond/BoardroomRedemptionFacet.sol";
import {BoardroomReleaseBMigrationFacet} from "../../src/boardroom/diamond/BoardroomReleaseBMigrationFacet.sol";
import {BoardroomTokenVNext} from "../../src/boardroom/diamond/BoardroomTokenVNext.sol";
import {BoardroomVNextController} from "../../src/boardroom/diamond/BoardroomVNextController.sol";
import {BoardroomVNextControllerFactory} from "../../src/boardroom/diamond/BoardroomVNextControllerFactory.sol";
import {BoardroomVNextFactory} from "../../src/boardroom/diamond/BoardroomVNextFactory.sol";
import {BoardroomVNextRelease} from "../../src/boardroom/diamond/BoardroomVNextRelease.sol";
import {BoardroomViewFacet} from "../../src/boardroom/diamond/BoardroomViewFacet.sol";
import {BoardroomViewFacetV2} from "../../src/boardroom/diamond/BoardroomViewFacetV2.sol";
import {ProtocolFacetRegistry} from "../../src/boardroom/diamond/ProtocolFacetRegistry.sol";
import {ProtocolFacetTypes} from "../../src/boardroom/diamond/ProtocolFacetTypes.sol";

contract VNextTestObligation {
    address public immutable factory;
    address public immutable boardroom;
    address public immutable shareToken;
    bool public isClosed;

    constructor(address boardroom_, address shareToken_) {
        factory = msg.sender;
        boardroom = boardroom_;
        shareToken = shareToken_;
    }

    function close() external {
        isClosed = true;
    }
}

contract VNextTestModule is IBoardroomObligationPolicy {
    uint256 public selectorCollisionCalls;

    function createDistribution(address boardroom, address shareToken) external returns (address) {
        return address(new VNextTestObligation(boardroom, shareToken));
    }

    function configureCurve(
        address boardroom,
        bytes32 expectedFacetSetHash,
        address predictedCurve,
        address quoteAsset,
        uint256 fundingAmount
    ) external {
        IBoardroomDiamond(boardroom)
            .precommitBondingCurve(expectedFacetSetHash, predictedCurve, quoteAsset, fundingAmount);
    }

    function replaceController(bytes32, address, address, address, uint64, uint64, uint64) external {
        ++selectorCollisionCalls;
    }

    function canCall(address, address, address target, uint256, bytes calldata) external view returns (bool) {
        return target == address(this);
    }

    function obligationForCall(address, address, uint256, bytes calldata data, bytes calldata result)
        external
        pure
        returns (Obligation memory obligation)
    {
        if (bytes4(data[:4]) == VNextTestModule.createDistribution.selector) {
            obligation = Obligation({
                kind: ObligationKind.Distribution, account: abi.decode(result, (address)), aux: address(0)
            });
        }
    }

    function isLifecycleCallAllowed(address, address, bytes4 selector) external pure returns (bool) {
        return selector == VNextTestObligation.close.selector;
    }
}

contract BoardroomDiamondVNextTest is Test {
    address internal owner = address(0xA11CE);
    address internal holder = address(0xB0B);
    address internal permissionlessMigrator = address(0xCAFE);

    WETH internal wrappedNative;
    BoardroomPolicyRegistry internal policyRegistry;
    ProtocolFacetRegistry internal registry;
    BoardroomKernel internal kernelLogic;
    BoardroomVNextFactory internal factory;
    IBoardroomDiamond internal boardroom;
    BoardroomTokenVNext internal shares;

    BoardroomVNextRelease.Facets internal facets;
    bytes32 internal releaseAHash;

    function setUp() public {
        wrappedNative = new WETH();
        policyRegistry = new BoardroomPolicyRegistry(address(this));
        registry = new ProtocolFacetRegistry(address(this), _reservedKernelSelectors());
        kernelLogic = new BoardroomKernel(address(registry));

        BoardroomRedemptionPayout redemptionPayout = new BoardroomRedemptionPayout();
        BoardroomGovernanceLogic governanceLogic = new BoardroomGovernanceLogic();
        BoardroomMarketLogic marketLogic = new BoardroomMarketLogic();
        factory = new BoardroomVNextFactory(
            address(registry),
            address(policyRegistry),
            address(wrappedNative),
            address(kernelLogic),
            address(redemptionPayout),
            address(governanceLogic),
            address(marketLogic)
        );

        address legacy = factory.legacyBoardroomLogic();
        facets.authority = address(new BoardroomAuthorityFacet(legacy));
        facets.execution = address(new BoardroomExecutionFacet(legacy));
        facets.market = address(new BoardroomMarketFacet(legacy));
        facets.redemption = address(new BoardroomRedemptionFacet(legacy));
        facets.viewFacet = address(new BoardroomViewFacet(legacy));
        facets.migration = address(new BoardroomReleaseBMigrationFacet());
        facets.viewV2 = address(new BoardroomViewFacetV2());

        ProtocolFacetTypes.FacetSetManifest memory releaseA = BoardroomVNextRelease.releaseA(facets);
        releaseAHash = registry.publishFacetSet(releaseA);
        registry.activateFacetSet(releaseAHash);

        address predicted = factory.predictBoardroomAddress(owner, "Diamond Boardroom", "DBR", bytes32("one"));
        address created = factory.createBoardroom(releaseAHash, owner, "Diamond Boardroom", "DBR", bytes32("one"));
        assertEq(created, predicted);
        boardroom = IBoardroomDiamond(created);
        shares = BoardroomTokenVNext(boardroom.shareToken());
    }

    function testReleaseACreatesUsableSingleCustodyBoardroom() public {
        assertEq(registry.owner(), address(this));
        assertEq(registry.activeRelease(), 1);
        assertEq(registry.facetAddress(BoardroomAuthorityFacet.mint.selector), facets.authority);
        assertEq(address(factory.facetRegistry()), address(registry));
        assertEq(factory.boardroomKernelLogic(), address(kernelLogic));
        assertTrue(factory.isBoardroom(address(boardroom)));
        assertEq(boardroom.facetRegistry(), address(registry));
        assertEq(boardroom.facetSetHash(), releaseAHash);
        assertEq(boardroom.appliedStorageVersion(), 1);
        assertEq(boardroom.appliedStorageLayoutHash(), registry.activeStorageLayoutHash());
        assertFalse(boardroom.migrationRequired());
        assertEq(boardroom.owner(), owner);
        assertEq(boardroom.policyRegistry(), address(policyRegistry));
        assertEq(boardroom.wrappedNative(), address(wrappedNative));
        assertEq(shares.boardroom(), address(boardroom));
        assertEq(shares.name(), "Diamond Boardroom");
        assertEq(shares.symbol(), "DBR");
        assertEq(boardroom.redeemableAssetCount(), 1);
        assertEq(boardroom.redeemableAssetAt(0), address(wrappedNative));

        vm.prank(owner);
        boardroom.mint(releaseAHash, owner, 100 ether);
        assertEq(shares.balanceOf(owner), 100 ether);

        vm.prank(owner);
        shares.transfer(holder, 40 ether);
        assertEq(shares.balanceOf(holder), 40 ether);

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(BoardroomKernel.FacetSetHashMismatch.selector, bytes32("stale"), releaseAHash)
        );
        boardroom.mint(bytes32("stale"), owner, 1 ether);
    }

    function testGlobalReleaseDuringRedemptionsBlocksWritesUntilPermissionlessMigration() public {
        vm.prank(owner);
        boardroom.mint(releaseAHash, holder, 100 ether);

        vm.deal(address(this), 10 ether);
        wrappedNative.deposit{value: 10 ether}();
        wrappedNative.transfer(address(boardroom), 10 ether);

        vm.prank(owner);
        boardroom.startWindDown(releaseAHash);
        vm.warp(block.timestamp + boardroom.windDownDelay());
        boardroom.beginSnapshot(releaseAHash);
        boardroom.snapshotAssets(releaseAHash, 32);
        boardroom.openRedemptions(releaseAHash);
        assertEq(uint8(boardroom.status()), uint8(Boardroom.BoardroomStatus.RedemptionsOpen));

        ProtocolFacetTypes.FacetSetManifest memory releaseB = BoardroomVNextRelease.releaseB(facets, releaseAHash);
        bytes32 releaseBHash = registry.publishFacetSet(releaseB);
        registry.activateFacetSet(releaseBHash);

        assertEq(boardroom.facetSetHash(), releaseBHash);
        assertEq(boardroom.appliedStorageVersion(), 1);
        assertTrue(boardroom.migrationRequired());
        assertEq(uint8(boardroom.status()), uint8(Boardroom.BoardroomStatus.RedemptionsOpen));

        vm.prank(holder);
        vm.expectRevert(abi.encodeWithSelector(BoardroomKernel.StorageMigrationRequired.selector, uint64(1), uint64(2)));
        boardroom.redeem(releaseBHash, 50 ether);

        vm.prank(holder);
        vm.expectRevert(
            abi.encodeWithSelector(BoardroomKernel.FacetSetHashMismatch.selector, releaseAHash, releaseBHash)
        );
        boardroom.redeem(releaseAHash, 50 ether);

        vm.prank(permissionlessMigrator);
        boardroom.migrateBoardroom(releaseBHash);
        assertEq(boardroom.appliedStorageVersion(), 2);
        assertEq(boardroom.appliedStorageLayoutHash(), registry.activeStorageLayoutHash());
        assertFalse(boardroom.migrationRequired());
        (bytes32 migrationMarker,, uint64 fromVersion) = boardroom.releaseBMigrationState();
        assertEq(migrationMarker, keccak256("pledge.cash.boardroom.diamond.release-b"));
        assertEq(fromVersion, 1);

        vm.prank(permissionlessMigrator);
        vm.expectRevert(abi.encodeWithSelector(BoardroomKernel.AlreadyMigrated.selector, uint64(2)));
        boardroom.migrateBoardroom(releaseBHash);

        vm.prank(holder);
        boardroom.redeem(releaseBHash, 50 ether);
        vm.prank(holder);
        uint256 paid = boardroom.claimRedemptionAsset(releaseBHash, address(wrappedNative), holder, 5 ether);
        assertEq(paid, 5 ether);
        assertEq(wrappedNative.balanceOf(holder), 5 ether);
    }

    function testGlobalActivationAndMigrationAreIndependentAcrossBoardrooms() public {
        vm.prank(owner);
        boardroom.mint(releaseAHash, holder, 2 ether);
        IBoardroomDiamond second =
            IBoardroomDiamond(factory.createBoardroom(releaseAHash, holder, "Second Boardroom", "DB2", bytes32("two")));
        assertEq(second.appliedStorageVersion(), 1);

        ProtocolFacetTypes.FacetSetManifest memory releaseB = BoardroomVNextRelease.releaseB(facets, releaseAHash);
        bytes32 releaseBHash = registry.publishFacetSet(releaseB);
        registry.activateFacetSet(releaseBHash);

        assertEq(boardroom.facetSetHash(), releaseBHash);
        assertEq(second.facetSetHash(), releaseBHash);
        assertTrue(boardroom.migrationRequired());
        assertTrue(second.migrationRequired());

        vm.prank(holder);
        vm.expectRevert(abi.encodeWithSelector(BoardroomKernel.StorageMigrationRequired.selector, uint64(1), uint64(2)));
        shares.transfer(owner, 1 ether);

        boardroom.migrateBoardroom(releaseBHash);
        assertFalse(boardroom.migrationRequired());
        assertTrue(second.migrationRequired());
        vm.prank(holder);
        shares.transfer(owner, 1 ether);

        vm.prank(permissionlessMigrator);
        second.migrateBoardroom(releaseBHash);
        assertFalse(second.migrationRequired());
    }

    function testBoardroomCreatedUnderReleaseBRunsReleaseGenesisMigration() public {
        ProtocolFacetTypes.FacetSetManifest memory releaseB = BoardroomVNextRelease.releaseB(facets, releaseAHash);
        bytes32 releaseBHash = registry.publishFacetSet(releaseB);
        registry.activateFacetSet(releaseBHash);

        address releaseBOwner = address(0xBADDCAFE);
        IBoardroomDiamond releaseBBoardroom = IBoardroomDiamond(
            factory.createBoardroom(
                releaseBHash, releaseBOwner, "Release B Boardroom", "DBB", bytes32("release-b-genesis")
            )
        );

        assertEq(releaseBBoardroom.owner(), releaseBOwner);
        assertEq(releaseBBoardroom.appliedStorageVersion(), 2);
        assertEq(releaseBBoardroom.appliedStorageLayoutHash(), registry.activeStorageLayoutHash());
        assertFalse(releaseBBoardroom.migrationRequired());
        (bytes32 migrationMarker, uint64 migratedAt, uint64 fromVersion) = releaseBBoardroom.releaseBMigrationState();
        assertEq(migrationMarker, keccak256("pledge.cash.boardroom.diamond.release-b"));
        assertEq(migratedAt, uint64(block.timestamp));
        assertEq(fromVersion, 0);
    }

    function testGlobalReleaseDuringWindingDownMigratesAndResumesLifecycle() public {
        vm.prank(owner);
        boardroom.mint(releaseAHash, holder, 1 ether);
        vm.prank(owner);
        boardroom.startWindDown(releaseAHash);
        assertEq(uint8(boardroom.status()), uint8(Boardroom.BoardroomStatus.WindingDown));

        ProtocolFacetTypes.FacetSetManifest memory releaseB = BoardroomVNextRelease.releaseB(facets, releaseAHash);
        bytes32 releaseBHash = registry.publishFacetSet(releaseB);
        registry.activateFacetSet(releaseBHash);
        vm.warp(block.timestamp + boardroom.windDownDelay());

        vm.expectRevert(abi.encodeWithSelector(BoardroomKernel.StorageMigrationRequired.selector, uint64(1), uint64(2)));
        boardroom.beginSnapshot(releaseBHash);
        boardroom.migrateBoardroom(releaseBHash);
        boardroom.beginSnapshot(releaseBHash);
        assertEq(uint8(boardroom.status()), uint8(Boardroom.BoardroomStatus.Snapshotting));
    }

    function testGlobalReleaseDuringSnapshottingMigratesAndResumesSnapshot() public {
        vm.prank(owner);
        boardroom.mint(releaseAHash, holder, 1 ether);
        vm.prank(owner);
        boardroom.startWindDown(releaseAHash);
        vm.warp(block.timestamp + boardroom.windDownDelay());
        boardroom.beginSnapshot(releaseAHash);
        assertEq(uint8(boardroom.status()), uint8(Boardroom.BoardroomStatus.Snapshotting));

        ProtocolFacetTypes.FacetSetManifest memory releaseB = BoardroomVNextRelease.releaseB(facets, releaseAHash);
        bytes32 releaseBHash = registry.publishFacetSet(releaseB);
        registry.activateFacetSet(releaseBHash);

        vm.expectRevert(abi.encodeWithSelector(BoardroomKernel.StorageMigrationRequired.selector, uint64(1), uint64(2)));
        boardroom.snapshotAssets(releaseBHash, 32);
        boardroom.migrateBoardroom(releaseBHash);
        assertEq(boardroom.snapshotAssets(releaseBHash, 32), 1);
        boardroom.openRedemptions(releaseBHash);
        assertEq(uint8(boardroom.status()), uint8(Boardroom.BoardroomStatus.RedemptionsOpen));
    }

    function testExecutionObligationsAndMarketCallbacksUseReleaseBoundSurface() public {
        VNextTestModule module = new VNextTestModule();
        policyRegistry.registerModulePolicy(address(module));

        Boardroom.Call memory createCall = Boardroom.Call({
            policy: address(module),
            target: address(module),
            value: 0,
            data: abi.encodeCall(VNextTestModule.createDistribution, (address(boardroom), address(shares)))
        });
        vm.prank(owner);
        bytes memory result = boardroom.execute(releaseAHash, createCall);
        VNextTestObligation obligation = VNextTestObligation(abi.decode(result, (address)));
        assertEq(boardroom.activeObligationCount(), 1);
        (address canonicalPolicy,, bool active, bool everRegistered) = boardroom.obligationOf(address(obligation));
        assertEq(canonicalPolicy, address(module));
        assertTrue(active);
        assertTrue(everRegistered);

        obligation.close();
        assertTrue(boardroom.pruneObligation(releaseAHash, address(obligation)));
        assertEq(boardroom.activeObligationCount(), 0);

        address predictedCurve = address(0xC0FFEE);
        Boardroom.Call memory marketCall = Boardroom.Call({
            policy: address(module),
            target: address(module),
            value: 0,
            data: abi.encodeCall(
                VNextTestModule.configureCurve,
                (address(boardroom), releaseAHash, predictedCurve, address(wrappedNative), 10 ether)
            )
        });
        vm.prank(owner);
        boardroom.execute(releaseAHash, marketCall);
        assertEq(uint8(boardroom.primaryMarketMode()), 1);
        assertEq(boardroom.bondingCurve(), predictedCurve);
    }

    function testControllerOperationIdentityCommitsFacetSetHash() public {
        uint256 proposerKey = 0x5151;
        address proposer = vm.addr(proposerKey);
        BoardroomVNextController implementation = new BoardroomVNextController();
        BoardroomVNextController controller = BoardroomVNextController(LibClone.clone(address(implementation)));
        controller.initialize(address(boardroom), proposer, uint64(1 days), uint64(1 days), 1);
        BoardroomCall[] memory calls = new BoardroomCall[](1);
        calls[0] = BoardroomCall({
            policy: address(0),
            target: address(boardroom),
            value: 0,
            data: abi.encodeCall(IBoardroomDiamond.mint, (releaseAHash, holder, 1 ether))
        });
        bytes32 hashA = controller.hashBoardroomOperation(releaseAHash, calls, bytes32("salt"), 1, 1, proposer);
        bytes32 hashB =
            controller.hashBoardroomOperation(bytes32("other-release"), calls, bytes32("salt"), 1, 1, proposer);
        assertNotEq(hashA, hashB);

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(proposerKey, hashA);
        bytes memory signature = abi.encodePacked(r, s, v);
        assertEq(controller.isValidSignature(hashA, signature), controller.ERC1271_MAGIC_VALUE());
        assertEq(controller.isValidSignature(hashB, signature), bytes4(0xffffffff));
    }

    function testERC1271OperationProofCannotBeSubstitutedAcrossLiveReleaseActivation() public {
        uint256 proposerKey = 0x5151;
        address proposer = vm.addr(proposerKey);
        BoardroomVNextController controller = _newStandaloneController(proposer);
        BoardroomCall[] memory calls = new BoardroomCall[](1);
        calls[0] = BoardroomCall({
            policy: address(0),
            target: address(boardroom),
            value: 0,
            data: abi.encodeCall(IBoardroomDiamond.mint, (releaseAHash, holder, 1 ether))
        });
        bytes32 salt = keccak256("erc1271-live-release");
        bytes32 releaseAOperation = controller.hashBoardroomOperation(releaseAHash, calls, salt, 1, 1, proposer);
        bytes memory releaseASignature = _sign(proposerKey, releaseAOperation);

        bytes32 releaseBHash = _activateReleaseB();
        bytes32 releaseBOperation = controller.hashBoardroomOperation(releaseBHash, calls, salt, 1, 1, proposer);

        assertNotEq(releaseAOperation, releaseBOperation);
        assertEq(controller.isValidSignature(releaseBOperation, releaseASignature), bytes4(0xffffffff));
        // ERC-1271 remains a generic offchain proposer proof: release binding
        // comes from signing the release-committed operation digest.
        assertEq(controller.isValidSignature(releaseAOperation, releaseASignature), controller.ERC1271_MAGIC_VALUE());
    }

    function testControllerCannotScheduleWhileBoardroomMigrationIsRequired() public {
        BoardroomVNextController controller = _launchVNextBoardroom();
        ProtocolFacetTypes.FacetSetManifest memory releaseB = BoardroomVNextRelease.releaseB(facets, releaseAHash);
        bytes32 releaseBHash = registry.publishFacetSet(releaseB);
        registry.activateFacetSet(releaseBHash);

        BoardroomCall[] memory calls = new BoardroomCall[](1);
        calls[0] = BoardroomCall({
            policy: address(0),
            target: address(boardroom),
            value: 0,
            data: abi.encodeCall(IBoardroomDiamond.mint, (releaseBHash, holder, 1 ether))
        });

        vm.prank(owner);
        vm.expectRevert(BoardroomVNextController.BoardroomMigrationRequired.selector);
        controller.scheduleBoardroomOperation(releaseBHash, calls, bytes32("blocked"), 1, 1);

        boardroom.migrateBoardroom(releaseBHash);
        vm.prank(owner);
        (bytes32 operationId,) =
            controller.scheduleBoardroomOperation(releaseBHash, calls, bytes32("after-migration"), 1, 1);
        (,, BoardroomVNextController.OperationStatus status) = controller.operationState(operationId);
        assertEq(uint8(status), uint8(BoardroomVNextController.OperationStatus.Pending));
    }

    function testScheduledControllerOperationCannotCrossGlobalActivation() public {
        BoardroomVNextController controller = _launchVNextBoardroom();
        BoardroomCall[] memory calls = new BoardroomCall[](1);
        calls[0] = BoardroomCall({
            policy: address(0),
            target: address(boardroom),
            value: 0,
            data: abi.encodeCall(IBoardroomDiamond.mint, (releaseAHash, holder, 1 ether))
        });
        bytes32 salt = keccak256("release-bound-schedule");

        vm.prank(owner);
        (, uint256 eta) = controller.scheduleBoardroomOperation(releaseAHash, calls, salt, 1, 1);

        ProtocolFacetTypes.FacetSetManifest memory releaseB = BoardroomVNextRelease.releaseB(facets, releaseAHash);
        bytes32 releaseBHash = registry.publishFacetSet(releaseB);
        registry.activateFacetSet(releaseBHash);
        vm.warp(eta);

        vm.expectRevert(
            abi.encodeWithSelector(BoardroomVNextController.FacetSetMismatch.selector, releaseAHash, releaseBHash)
        );
        controller.executeBoardroomOperation(releaseAHash, calls, salt, 1, 1, owner);

        bytes32 substitutedId = controller.hashBoardroomOperation(releaseBHash, calls, salt, 1, 1, owner);
        vm.expectRevert(BoardroomVNextController.BoardroomMigrationRequired.selector);
        controller.executeBoardroomOperation(releaseBHash, calls, salt, 1, 1, owner);

        boardroom.migrateBoardroom(releaseBHash);
        vm.expectRevert(abi.encodeWithSelector(BoardroomVNextController.OperationNotPending.selector, substitutedId));
        controller.executeBoardroomOperation(releaseBHash, calls, salt, 1, 1, owner);
    }

    function testControllerReplacementUsesHashBoundSelectorAndCanonicalVNextFactory() public {
        BoardroomVNextController currentController = _launchVNextBoardroom();
        BoardroomVNextControllerFactory controllerFactory =
            BoardroomVNextControllerFactory(boardroom.controllerFactory());
        address nextProposer = address(0xBEEF);
        uint64 nextGeneration = 2;
        address predictedNext = controllerFactory.predictControllerAddress(address(boardroom), nextGeneration);

        BoardroomCall[] memory calls = new BoardroomCall[](1);
        calls[0] = BoardroomCall({
            policy: address(0),
            target: address(boardroom),
            value: 0,
            data: abi.encodeCall(
                IBoardroomDiamond.replaceController,
                (
                    releaseAHash,
                    address(currentController),
                    predictedNext,
                    nextProposer,
                    uint64(2 days),
                    uint64(3 days),
                    nextGeneration
                )
            )
        });
        bytes32 salt = keccak256("vnext-controller-replacement");
        uint256 expectedEpoch = boardroom.governanceEpoch();
        uint256 expectedConfigurationEpoch = currentController.configurationEpoch();

        vm.prank(owner);
        (, uint256 eta) = currentController.scheduleBoardroomOperation(
            releaseAHash, calls, salt, expectedEpoch, expectedConfigurationEpoch
        );
        vm.warp(eta);
        currentController.executeBoardroomOperation(
            releaseAHash, calls, salt, expectedEpoch, expectedConfigurationEpoch, owner
        );

        BoardroomVNextController nextController = BoardroomVNextController(predictedNext);
        assertEq(boardroom.controller(), predictedNext);
        assertEq(boardroom.owner(), predictedNext);
        assertEq(boardroom.controllerGeneration(), nextGeneration);
        assertEq(boardroom.governanceEpoch(), expectedEpoch + 1);
        assertEq(nextController.factory(), address(controllerFactory));
        assertEq(nextController.boardroom(), address(boardroom));
        assertEq(nextController.proposer(), nextProposer);
        assertEq(nextController.delay(), 2 days);
        assertEq(nextController.gracePeriod(), 3 days);
        assertEq(nextController.generation(), nextGeneration);
        assertTrue(controllerFactory.isController(predictedNext));
    }

    function testExternalSelectorCollisionDoesNotTriggerControllerReplacementBatchRule() public {
        BoardroomVNextController controller = _launchVNextBoardroom();
        VNextTestModule module = new VNextTestModule();
        policyRegistry.registerModulePolicy(address(module));

        bytes memory collisionCall = abi.encodeCall(
            VNextTestModule.replaceController,
            (releaseAHash, address(1), address(2), address(3), uint64(1), uint64(2), uint64(3))
        );
        BoardroomCall[] memory calls = new BoardroomCall[](2);
        calls[0] = BoardroomCall({policy: address(module), target: address(module), value: 0, data: collisionCall});
        calls[1] = BoardroomCall({policy: address(module), target: address(module), value: 0, data: collisionCall});

        bytes32 salt = keccak256("external-selector-collision");
        vm.prank(owner);
        (, uint256 eta) = controller.scheduleBoardroomOperation(releaseAHash, calls, salt, 1, 1);
        vm.warp(eta);
        controller.executeBoardroomOperation(releaseAHash, calls, salt, 1, 1, owner);

        assertEq(module.selectorCollisionCalls(), 2);
    }

    function _launchVNextBoardroom() internal returns (BoardroomVNextController controller) {
        address protection = address(0x5157);
        BoardroomRewardsFactory rewardsFactory = new BoardroomRewardsFactory(address(factory));
        policyRegistry.registerModulePolicy(address(rewardsFactory));

        Boardroom.Call memory createRewards = Boardroom.Call({
            policy: address(rewardsFactory),
            target: address(rewardsFactory),
            value: 0,
            data: abi.encodeCall(BoardroomRewardsFactory.createRewards, (uint64(1 days), bytes32("vnext-rewards")))
        });
        vm.prank(owner);
        BoardroomRewards rewards =
            BoardroomRewards(abi.decode(boardroom.execute(releaseAHash, createRewards), (address)));

        vm.prank(owner);
        boardroom.mint(releaseAHash, protection, 100 ether);
        vm.prank(protection);
        shares.approve(address(rewards), 100 ether);
        vm.prank(protection);
        rewards.stake(100 ether);
        vm.roll(block.number + 1);

        BoardroomVNextControllerFactory controllerFactory =
            BoardroomVNextControllerFactory(boardroom.controllerFactory());
        address predictedController = controllerFactory.predictControllerAddress(address(boardroom), 1);
        Boardroom.LaunchConfig memory config = Boardroom.LaunchConfig({
            proposer: owner,
            predictedController: predictedController,
            protectionStaker: protection,
            expectedRewardPool: address(rewards),
            expectedRedemptionExcessRecipient: owner,
            controllerDelay: 1 days,
            windDownDelay: 1 days,
            gracePeriod: 1 days,
            generation: 1
        });
        vm.prank(owner);
        boardroom.launch(releaseAHash, config);
        controller = BoardroomVNextController(predictedController);
    }

    function _newStandaloneController(address proposer) internal returns (BoardroomVNextController controller) {
        BoardroomVNextController implementation = new BoardroomVNextController();
        controller = BoardroomVNextController(LibClone.clone(address(implementation)));
        controller.initialize(address(boardroom), proposer, uint64(1 days), uint64(1 days), 1);
    }

    function _activateReleaseB() internal returns (bytes32 releaseBHash) {
        ProtocolFacetTypes.FacetSetManifest memory releaseB = BoardroomVNextRelease.releaseB(facets, releaseAHash);
        releaseBHash = registry.publishFacetSet(releaseB);
        registry.activateFacetSet(releaseBHash);
    }

    function _sign(uint256 signerKey, bytes32 digest) internal pure returns (bytes memory signature) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        signature = abi.encodePacked(r, s, v);
    }

    function _reservedKernelSelectors() internal pure returns (bytes4[] memory reserved) {
        reserved = new bytes4[](7);
        reserved[0] = bytes4(keccak256("facetRegistry()"));
        reserved[1] = bytes4(keccak256("facetSetHash()"));
        reserved[2] = BoardroomKernel.initialize.selector;
        reserved[3] = BoardroomKernel.appliedStorageVersion.selector;
        reserved[4] = BoardroomKernel.migrationRequired.selector;
        reserved[5] = BoardroomKernel.dispatchViewAndRollback.selector;
        reserved[6] = BoardroomKernel.appliedStorageLayoutHash.selector;
        for (uint256 i = 1; i < reserved.length; ++i) {
            bytes4 current = reserved[i];
            uint256 j = i;
            while (j != 0 && reserved[j - 1] > current) {
                reserved[j] = reserved[j - 1];
                --j;
            }
            reserved[j] = current;
        }
    }
}
