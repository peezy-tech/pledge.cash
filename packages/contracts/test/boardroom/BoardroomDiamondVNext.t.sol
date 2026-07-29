// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {LibClone} from "solady/utils/LibClone.sol";
import {SignatureCheckerLib} from "solady/utils/SignatureCheckerLib.sol";
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

contract VNextMismatchedKernel {
    address public immutable facetRegistry;
    bytes32 public immutable kernelSelectorSetHash;

    constructor(address facetRegistry_, bytes32 kernelSelectorSetHash_) {
        facetRegistry = facetRegistry_;
        kernelSelectorSetHash = kernelSelectorSetHash_;
    }
}

contract VNextRecursive1271Authority {
    bytes4 internal constant MAGIC_VALUE = 0x1626ba7e;

    address public immutable authority;

    constructor(address authority_) {
        authority = authority_;
    }

    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        return
            SignatureCheckerLib.isValidSignatureNowCalldata(authority, hash, signature)
                ? MAGIC_VALUE
                : bytes4(0xffffffff);
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

    function testFactoryRejectsKernelSelectorSetMismatch() public {
        bytes32 expectedHash = registry.kernelSelectorSetHash();
        bytes32 actualHash = keccak256("different-kernel-selectors");
        VNextMismatchedKernel mismatchedKernel = new VNextMismatchedKernel(address(registry), actualHash);
        address redemptionPayout = factory.redemptionPayoutLogic();
        address governance = factory.governanceLogic();
        address market = factory.marketLogic();

        vm.expectRevert(
            abi.encodeWithSelector(
                BoardroomVNextFactory.InvalidKernelSelectorSetHash.selector, expectedHash, actualHash
            )
        );
        new BoardroomVNextFactory(
            address(registry),
            address(policyRegistry),
            address(wrappedNative),
            address(mismatchedKernel),
            redemptionPayout,
            governance,
            market
        );
    }

    function testReleaseAInitializationPreservesV5EventOrder() public {
        bytes32 salt = bytes32("event-order");
        address predicted = factory.predictBoardroomAddress(owner, "Event Boardroom", "EVT", salt);
        bytes32 assetRegisteredTopic = keccak256("RedeemableAssetRegistered(address)");
        bytes32 initializedTopic = keccak256("BoardroomInitialized(address,address,address,address,string,string)");
        bytes32 excessRecipientTopic = keccak256("RedemptionExcessRecipientSet(address)");

        vm.recordLogs();
        factory.createBoardroom(releaseAHash, owner, "Event Boardroom", "EVT", salt);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        bytes32[3] memory observedTopics;
        uint256 observedCount;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != predicted || logs[i].topics.length == 0) continue;
            bytes32 topic = logs[i].topics[0];
            if (topic != assetRegisteredTopic && topic != initializedTopic && topic != excessRecipientTopic) continue;
            assertLt(observedCount, observedTopics.length);
            observedTopics[observedCount++] = topic;
        }

        assertEq(observedCount, observedTopics.length);
        assertEq(observedTopics[0], assetRegisteredTopic);
        assertEq(observedTopics[1], initializedTopic);
        assertEq(observedTopics[2], excessRecipientTopic);
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
        address proposer = vm.addr(0x5151);
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
    }

    function testERC1271ReleaseAEnvelopeBecomesInvalidAfterLiveReleaseBActivation() public {
        uint256 proposerKey = 0x5151;
        address proposer = vm.addr(proposerKey);
        BoardroomVNextController controller = _launchVNextBoardroom(proposer);
        BoardroomCall[] memory calls = new BoardroomCall[](1);
        calls[0] = BoardroomCall({
            policy: address(0),
            target: address(boardroom),
            value: 0,
            data: abi.encodeCall(IBoardroomDiamond.mint, (releaseAHash, holder, 1 ether))
        });
        bytes32 salt = keccak256("erc1271-live-release");
        bytes32 releaseAOperation = controller.hashBoardroomOperation(releaseAHash, calls, salt, 1, 1, proposer);
        bytes memory releaseAEnvelope = _erc1271Envelope(controller, releaseAOperation, releaseAHash, proposerKey);
        assertEq(controller.isValidSignature(releaseAOperation, releaseAEnvelope), controller.ERC1271_MAGIC_VALUE());

        bytes32 releaseBHash = _activateReleaseB();
        bytes32 releaseBOperation = controller.hashBoardroomOperation(releaseBHash, calls, salt, 1, 1, proposer);
        assertNotEq(releaseAOperation, releaseBOperation);
        assertEq(controller.isValidSignature(releaseAOperation, releaseAEnvelope), controller.ERC1271_INVALID_VALUE());

        bytes memory releaseBEnvelope = _erc1271Envelope(controller, releaseBOperation, releaseBHash, proposerKey);
        assertEq(controller.isValidSignature(releaseBOperation, releaseBEnvelope), controller.ERC1271_INVALID_VALUE());

        boardroom.migrateBoardroom(releaseBHash);
        assertEq(controller.isValidSignature(releaseBOperation, releaseBEnvelope), controller.ERC1271_MAGIC_VALUE());
    }

    function testERC1271EnvelopeFailsClosedForMalformedWrongSignerAndInactiveLifecycle() public {
        uint256 proposerKey = 0x5151;
        BoardroomVNextController controller = _launchVNextBoardroom(vm.addr(proposerKey));
        bytes32 messageHash = keccak256("release-bound-message");
        bytes32 digest = _erc1271Digest(controller, messageHash, releaseAHash);

        assertEq(controller.isValidSignature(messageHash, hex"1234"), controller.ERC1271_INVALID_VALUE());
        assertEq(
            controller.isValidSignature(
                messageHash, _erc1271EnvelopeForSignature(controller, releaseAHash, _sign(0xBAD, digest))
            ),
            controller.ERC1271_INVALID_VALUE()
        );

        bytes memory envelope = _erc1271EnvelopeForSignature(controller, releaseAHash, _sign(proposerKey, digest));
        vm.prank(address(0x5157));
        boardroom.startWindDown(releaseAHash);
        assertEq(controller.isValidSignature(messageHash, envelope), controller.ERC1271_INVALID_VALUE());
    }

    function testERC1271EnvelopeRejectsWrongSchemeAndEveryExplicitContextChange() public {
        uint256 proposerKey = 0x5151;
        BoardroomVNextController controller = _launchVNextBoardroom(vm.addr(proposerKey));
        bytes32 messageHash = keccak256("explicit-context");
        uint256 boardroomEpoch = boardroom.governanceEpoch();
        uint256 controllerGeneration = controller.generation();
        uint256 configurationEpoch = controller.configurationEpoch();
        bytes32 configurationHash = controller.configurationHash();
        bytes32 digest = controller.hashERC1271Digest(
            messageHash,
            address(boardroom),
            releaseAHash,
            boardroomEpoch,
            controllerGeneration,
            configurationEpoch,
            configurationHash
        );
        bytes memory proposerSignature = _sign(proposerKey, digest);
        bytes4 scheme = controller.ERC1271_ENVELOPE_SCHEME();
        bytes memory validEnvelope = abi.encode(
            scheme,
            releaseAHash,
            boardroomEpoch,
            controllerGeneration,
            configurationEpoch,
            configurationHash,
            proposerSignature
        );
        assertEq(controller.isValidSignature(messageHash, validEnvelope), controller.ERC1271_MAGIC_VALUE());

        assertEq(
            controller.isValidSignature(
                messageHash,
                abi.encode(
                    bytes4(0),
                    releaseAHash,
                    boardroomEpoch,
                    controllerGeneration,
                    configurationEpoch,
                    configurationHash,
                    proposerSignature
                )
            ),
            controller.ERC1271_INVALID_VALUE()
        );
        assertEq(
            controller.isValidSignature(
                messageHash,
                abi.encode(
                    scheme,
                    bytes32("wrong-release"),
                    boardroomEpoch,
                    controllerGeneration,
                    configurationEpoch,
                    configurationHash,
                    proposerSignature
                )
            ),
            controller.ERC1271_INVALID_VALUE()
        );
        assertEq(
            controller.isValidSignature(
                messageHash,
                abi.encode(
                    scheme,
                    releaseAHash,
                    boardroomEpoch + 1,
                    controllerGeneration,
                    configurationEpoch,
                    configurationHash,
                    proposerSignature
                )
            ),
            controller.ERC1271_INVALID_VALUE()
        );
        assertEq(
            controller.isValidSignature(
                messageHash,
                abi.encode(
                    scheme,
                    releaseAHash,
                    boardroomEpoch,
                    controllerGeneration + 1,
                    configurationEpoch,
                    configurationHash,
                    proposerSignature
                )
            ),
            controller.ERC1271_INVALID_VALUE()
        );
        assertEq(
            controller.isValidSignature(
                messageHash,
                abi.encode(
                    scheme,
                    releaseAHash,
                    boardroomEpoch,
                    controllerGeneration,
                    configurationEpoch + 1,
                    configurationHash,
                    proposerSignature
                )
            ),
            controller.ERC1271_INVALID_VALUE()
        );
        assertEq(
            controller.isValidSignature(
                messageHash,
                abi.encode(
                    scheme,
                    releaseAHash,
                    boardroomEpoch,
                    controllerGeneration,
                    configurationEpoch,
                    bytes32("wrong-configuration"),
                    proposerSignature
                )
            ),
            controller.ERC1271_INVALID_VALUE()
        );
        assertEq(
            controller.isValidSignature(messageHash, bytes.concat(validEnvelope, hex"00")),
            controller.ERC1271_INVALID_VALUE()
        );
    }

    function testERC1271ReleaseBoundEnvelopeRecursesThroughContractProposer() public {
        uint256 signerKey = 0x5151;
        VNextRecursive1271Authority recursive = new VNextRecursive1271Authority(vm.addr(signerKey));
        BoardroomVNextController controller = _launchVNextBoardroom(address(recursive));
        bytes32 messageHash = keccak256("recursive-release-bound-message");
        bytes memory envelope = _erc1271Envelope(controller, messageHash, releaseAHash, signerKey);

        assertEq(controller.isValidSignature(messageHash, envelope), controller.ERC1271_MAGIC_VALUE());
    }

    function testERC1271FailsClosedWhenControllerIsNotActiveForBoardroom() public {
        uint256 proposerKey = 0x5151;
        BoardroomVNextController controller = _newStandaloneController(vm.addr(proposerKey));
        bytes32 messageHash = keccak256("inactive-controller");
        bytes memory envelope = _erc1271Envelope(controller, messageHash, releaseAHash, proposerKey);

        assertEq(controller.isValidSignature(messageHash, envelope), controller.ERC1271_INVALID_VALUE());
    }

    function testERC1271FailsClosedWhenBoardroomContextReadsRevert() public {
        uint256 proposerKey = 0x5151;
        address nonexistentBoardroom = address(0xBEEF);
        BoardroomVNextController implementation = new BoardroomVNextController();
        BoardroomVNextController controller = BoardroomVNextController(LibClone.clone(address(implementation)));
        controller.initialize(nonexistentBoardroom, vm.addr(proposerKey), uint64(1 days), uint64(1 days), 1);
        bytes32 messageHash = keccak256("failed-boardroom-read");
        bytes32 configurationHash = controller.configurationHash();
        bytes32 digest =
            controller.hashERC1271Digest(messageHash, nonexistentBoardroom, releaseAHash, 1, 1, 1, configurationHash);
        bytes memory envelope = abi.encode(
            controller.ERC1271_ENVELOPE_SCHEME(),
            releaseAHash,
            uint256(1),
            uint256(1),
            uint256(1),
            configurationHash,
            _sign(proposerKey, digest)
        );

        assertEq(controller.isValidSignature(messageHash, envelope), controller.ERC1271_INVALID_VALUE());
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
        return _launchVNextBoardroom(owner);
    }

    function _launchVNextBoardroom(address proposer) internal returns (BoardroomVNextController controller) {
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
            proposer: proposer,
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

    function _erc1271Digest(BoardroomVNextController controller, bytes32 messageHash, bytes32 facetSetHash)
        internal
        view
        returns (bytes32)
    {
        return controller.hashERC1271Digest(
            messageHash,
            address(boardroom),
            facetSetHash,
            boardroom.governanceEpoch(),
            controller.generation(),
            controller.configurationEpoch(),
            controller.configurationHash()
        );
    }

    function _erc1271Envelope(
        BoardroomVNextController controller,
        bytes32 messageHash,
        bytes32 facetSetHash,
        uint256 signerKey
    ) internal view returns (bytes memory) {
        return _erc1271EnvelopeForSignature(
            controller, facetSetHash, _sign(signerKey, _erc1271Digest(controller, messageHash, facetSetHash))
        );
    }

    function _erc1271EnvelopeForSignature(
        BoardroomVNextController controller,
        bytes32 facetSetHash,
        bytes memory proposerSignature
    ) internal view returns (bytes memory) {
        return abi.encode(
            controller.ERC1271_ENVELOPE_SCHEME(),
            facetSetHash,
            boardroom.governanceEpoch(),
            controller.generation(),
            controller.configurationEpoch(),
            controller.configurationHash(),
            proposerSignature
        );
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
        reserved = new bytes4[](8);
        reserved[0] = bytes4(keccak256("facetRegistry()"));
        reserved[1] = bytes4(keccak256("facetSetHash()"));
        reserved[2] = BoardroomKernel.initialize.selector;
        reserved[3] = BoardroomKernel.appliedStorageVersion.selector;
        reserved[4] = BoardroomKernel.migrationRequired.selector;
        reserved[5] = BoardroomKernel.dispatchViewAndRollback.selector;
        reserved[6] = BoardroomKernel.appliedStorageLayoutHash.selector;
        reserved[7] = BoardroomKernel.kernelSelectorSetHash.selector;
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
