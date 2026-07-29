// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";
import {ERC20} from "solady/tokens/ERC20.sol";
import {WETH} from "solady/tokens/WETH.sol";
import {Boardroom} from "../../src/boardroom/Boardroom.sol";
import {BoardroomGovernanceLogic} from "../../src/boardroom/BoardroomGovernanceLogic.sol";
import {BoardroomMarketLogic} from "../../src/boardroom/BoardroomMarketLogic.sol";
import {BoardroomPolicyRegistry} from "../../src/boardroom/BoardroomPolicyRegistry.sol";
import {BoardroomRedemptionPayout} from "../../src/boardroom/BoardroomRedemptionPayout.sol";
import {BoardroomAuthorityFacet} from "../../src/boardroom/diamond/BoardroomAuthorityFacet.sol";
import {IBoardroomDiamond} from "../../src/boardroom/diamond/BoardroomDiamond.sol";
import {BoardroomExecutionFacet} from "../../src/boardroom/diamond/BoardroomExecutionFacet.sol";
import {BoardroomKernel} from "../../src/boardroom/diamond/BoardroomKernel.sol";
import {BoardroomMarketFacet} from "../../src/boardroom/diamond/BoardroomMarketFacet.sol";
import {BoardroomRedemptionFacet} from "../../src/boardroom/diamond/BoardroomRedemptionFacet.sol";
import {BoardroomReleaseBMigrationFacet} from "../../src/boardroom/diamond/BoardroomReleaseBMigrationFacet.sol";
import {BoardroomTokenVNext} from "../../src/boardroom/diamond/BoardroomTokenVNext.sol";
import {BoardroomVNextFactory} from "../../src/boardroom/diamond/BoardroomVNextFactory.sol";
import {BoardroomVNextRelease} from "../../src/boardroom/diamond/BoardroomVNextRelease.sol";
import {BoardroomViewFacet} from "../../src/boardroom/diamond/BoardroomViewFacet.sol";
import {BoardroomViewFacetV2} from "../../src/boardroom/diamond/BoardroomViewFacetV2.sol";
import {ProtocolFacetRegistry} from "../../src/boardroom/diamond/ProtocolFacetRegistry.sol";
import {ProtocolFacetTypes} from "../../src/boardroom/diamond/ProtocolFacetTypes.sol";

contract BoardroomDiamondVNextInvariantERC20 is ERC20 {
    function name() public pure override returns (string memory) {
        return "vNext Redeemable";
    }

    function symbol() public pure override returns (string memory) {
        return "VRDM";
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract BoardroomDiamondVNextToggleAsset {
    bool public transfersRevert = true;
    mapping(address => uint256) public balanceOf;

    function setTransfersRevert(bool transfersRevert_) external {
        transfersRevert = transfersRevert_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (transfersRevert) revert();
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract BoardroomDiamondVNextWindDownHandler is Test {
    uint256 public constant HOLDER_A_SHARES = 100 ether;
    uint256 public constant HOLDER_B_SHARES = 200 ether;
    uint256 public constant TREASURY_SHARES = 50 ether;
    uint256 public constant INITIAL_REDEEMABLE_ASSET = 3_000_000000;
    uint256 public constant INITIAL_HOSTILE_ASSET = 6_000_000000;

    address public immutable holderA = address(0xA11CE);
    address public immutable holderB = address(0xB0B);

    ProtocolFacetRegistry public immutable registry;
    BoardroomVNextFactory public immutable factory;
    IBoardroomDiamond public immutable boardroom;
    BoardroomTokenVNext public immutable shareToken;
    BoardroomDiamondVNextInvariantERC20 public immutable redeemableAsset;
    BoardroomDiamondVNextToggleAsset public immutable hostileAsset;
    bytes32 public immutable releaseAHash;
    bytes32 public immutable releaseBHash;

    uint256 public totalRedeemed;
    uint256 public totalHostileRedeemed;

    constructor() {
        WETH wrappedNative = new WETH();
        BoardroomPolicyRegistry policyRegistry = new BoardroomPolicyRegistry(address(this));
        ProtocolFacetRegistry registry_ = new ProtocolFacetRegistry(address(this), _reservedKernelSelectors());
        BoardroomKernel kernel = new BoardroomKernel(address(registry_));
        BoardroomRedemptionPayout redemptionPayout = new BoardroomRedemptionPayout();
        BoardroomGovernanceLogic governanceLogic = new BoardroomGovernanceLogic();
        BoardroomMarketLogic marketLogic = new BoardroomMarketLogic();
        BoardroomVNextFactory factory_ = new BoardroomVNextFactory(
            address(registry_),
            address(policyRegistry),
            address(wrappedNative),
            address(kernel),
            address(redemptionPayout),
            address(governanceLogic),
            address(marketLogic)
        );

        BoardroomVNextRelease.Facets memory facets;
        address legacy = factory_.legacyBoardroomLogic();
        facets.authority = address(new BoardroomAuthorityFacet(legacy));
        facets.execution = address(new BoardroomExecutionFacet(legacy));
        facets.market = address(new BoardroomMarketFacet(legacy));
        facets.redemption = address(new BoardroomRedemptionFacet(legacy));
        facets.viewFacet = address(new BoardroomViewFacet(legacy));
        facets.migration = address(new BoardroomReleaseBMigrationFacet());
        facets.viewV2 = address(new BoardroomViewFacetV2());

        ProtocolFacetTypes.FacetSetManifest memory releaseA = BoardroomVNextRelease.releaseA(facets);
        bytes32 releaseAHash_ = registry_.publishFacetSet(releaseA);
        registry_.activateFacetSet(releaseAHash_);
        ProtocolFacetTypes.FacetSetManifest memory releaseB = BoardroomVNextRelease.releaseB(facets, releaseAHash_);
        bytes32 releaseBHash_ = registry_.publishFacetSet(releaseB);

        IBoardroomDiamond boardroom_ = IBoardroomDiamond(
            factory_.createBoardroom(
                releaseAHash_, address(this), "vNext Invariant Common", "VINV", keccak256("vnext-wind-down-invariant")
            )
        );
        BoardroomTokenVNext shareToken_ = BoardroomTokenVNext(boardroom_.shareToken());
        BoardroomDiamondVNextInvariantERC20 redeemableAsset_ = new BoardroomDiamondVNextInvariantERC20();
        BoardroomDiamondVNextToggleAsset hostileAsset_ = new BoardroomDiamondVNextToggleAsset();

        boardroom_.mint(releaseAHash_, holderA, HOLDER_A_SHARES);
        boardroom_.mint(releaseAHash_, holderB, HOLDER_B_SHARES);
        boardroom_.mint(releaseAHash_, address(boardroom_), TREASURY_SHARES);
        boardroom_.registerRedeemableAsset(releaseAHash_, address(redeemableAsset_));
        boardroom_.registerRedeemableAsset(releaseAHash_, address(hostileAsset_));
        redeemableAsset_.mint(address(boardroom_), INITIAL_REDEEMABLE_ASSET);
        hostileAsset_.mint(address(boardroom_), INITIAL_HOSTILE_ASSET);

        registry = registry_;
        factory = factory_;
        boardroom = boardroom_;
        shareToken = shareToken_;
        redeemableAsset = redeemableAsset_;
        hostileAsset = hostileAsset_;
        releaseAHash = releaseAHash_;
        releaseBHash = releaseBHash_;
    }

    function activateReleaseB() external {
        if (registry.activeRelease() != 1) return;
        try registry.activateFacetSet(releaseBHash) {} catch {}
    }

    function migrate() external {
        if (!boardroom.migrationRequired()) return;
        try boardroom.migrateBoardroom(registry.activeFacetSetHash()) {} catch {}
    }

    function startWindDown() external {
        if (boardroom.status() != Boardroom.BoardroomStatus.Active) return;
        try boardroom.startWindDown(registry.activeFacetSetHash()) {} catch {}
    }

    function burnTreasuryShares() external {
        if (boardroom.status() != Boardroom.BoardroomStatus.WindingDown) return;
        try boardroom.burnTreasuryShares(registry.activeFacetSetHash()) {} catch {}
    }

    function beginSnapshot() external {
        if (boardroom.status() != Boardroom.BoardroomStatus.WindingDown) return;
        uint256 readyAt = boardroom.windDownStartedAt() + boardroom.windDownDelay();
        if (block.timestamp < readyAt) vm.warp(readyAt);
        try boardroom.beginSnapshot(registry.activeFacetSetHash()) {} catch {}
    }

    function snapshotAssets(uint256 rawMaximum) external {
        if (boardroom.status() != Boardroom.BoardroomStatus.Snapshotting) return;
        uint256 maximum = bound(rawMaximum, 1, boardroom.MAX_SNAPSHOT_PAGE());
        try boardroom.snapshotAssets(registry.activeFacetSetHash(), maximum) {} catch {}
    }

    function openRedemptions() external {
        if (boardroom.status() != Boardroom.BoardroomStatus.Snapshotting) return;
        try boardroom.openRedemptions(registry.activeFacetSetHash()) {} catch {}
    }

    function redeem(uint256 actorSeed, uint256 sharesSeed) external {
        if (boardroom.status() != Boardroom.BoardroomStatus.RedemptionsOpen || boardroom.migrationRequired()) return;

        address actor = actorSeed % 2 == 0 ? holderA : holderB;
        uint256 balance = shareToken.balanceOf(actor);
        if (balance == 0) return;

        uint256 shares = bound(sharesSeed, 1, balance);
        uint256 supplyBefore = shareToken.totalSupply();
        uint256 assetBefore = redeemableAsset.balanceOf(address(boardroom));
        uint256 expectedAmount = assetBefore * shares / supplyBefore;
        bytes32 activeHash = registry.activeFacetSetHash();
        vm.prank(actor);
        try boardroom.redeem(activeHash, shares) {
            _claimHostile(actor, activeHash);
            vm.prank(actor);
            uint256 amount = boardroom.claimRedemptionAsset(activeHash, address(redeemableAsset), actor, 0);
            assertEq(amount, expectedAmount);
            totalRedeemed += amount;
        } catch {}
    }

    function enableHostileTransfers() external {
        hostileAsset.setTransfersRevert(false);
    }

    function claimHostile(uint256 actorSeed) external {
        if (boardroom.status() != Boardroom.BoardroomStatus.RedemptionsOpen || boardroom.migrationRequired()) return;
        _claimHostile(actorSeed % 2 == 0 ? holderA : holderB, registry.activeFacetSetHash());
    }

    function _claimHostile(address actor, bytes32 activeHash) internal {
        vm.prank(actor);
        try boardroom.claimRedemptionAsset(activeHash, address(hostileAsset), actor, 0) returns (uint256 amount) {
            totalHostileRedeemed += amount;
        } catch {}
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

contract BoardroomDiamondVNextWindDownInvariantTest is StdInvariant, Test {
    BoardroomDiamondVNextWindDownHandler internal handler;

    function setUp() public {
        handler = new BoardroomDiamondVNextWindDownHandler();
        targetContract(address(handler));
    }

    function testHostileAssetFailureDoesNotBlockHealthyPayoutAndCanRetryAcrossReleaseMigration() public {
        handler.activateReleaseB();
        assertTrue(handler.boardroom().migrationRequired());
        handler.startWindDown();
        assertEq(uint8(handler.boardroom().status()), uint8(Boardroom.BoardroomStatus.Active));

        handler.migrate();
        assertFalse(handler.boardroom().migrationRequired());
        handler.startWindDown();
        handler.beginSnapshot();
        handler.snapshotAssets(32);
        handler.openRedemptions();
        handler.redeem(0, handler.HOLDER_A_SHARES());

        assertEq(handler.totalRedeemed(), 1_000_000000);
        assertEq(handler.totalHostileRedeemed(), 0);
        assertEq(handler.hostileAsset().balanceOf(address(handler.boardroom())), handler.INITIAL_HOSTILE_ASSET());

        handler.enableHostileTransfers();
        handler.claimHostile(0);
        assertEq(handler.totalHostileRedeemed(), 2_000_000000);
        assertEq(handler.hostileAsset().balanceOf(handler.holderA()), 2_000_000000);
    }

    function invariantRedeemableAssetIsConserved() public view {
        uint256 remaining = handler.redeemableAsset().balanceOf(address(handler.boardroom()));
        assertEq(remaining + handler.totalRedeemed(), handler.INITIAL_REDEEMABLE_ASSET());
    }

    function invariantHostileAssetIsConservedAcrossFailureAndRetry() public view {
        uint256 remaining = handler.hostileAsset().balanceOf(address(handler.boardroom()));
        assertEq(remaining + handler.totalHostileRedeemed(), handler.INITIAL_HOSTILE_ASSET());
    }

    function invariantTreasurySharesAreBurnedBeforeRedemptionsOpen() public view {
        if (handler.boardroom().status() == Boardroom.BoardroomStatus.RedemptionsOpen) {
            assertEq(handler.shareToken().balanceOf(address(handler.boardroom())), 0);
        }
    }

    function invariantShareSupplyNeverIncreasesAfterSetup() public view {
        uint256 maximum = handler.HOLDER_A_SHARES() + handler.HOLDER_B_SHARES() + handler.TREASURY_SHARES();
        assertLe(handler.shareToken().totalSupply(), maximum);
    }

    function invariantNoRedemptionBeforeRedemptionsOpen() public view {
        if (handler.boardroom().status() != Boardroom.BoardroomStatus.RedemptionsOpen) {
            assertEq(handler.totalRedeemed(), 0);
            assertEq(handler.totalHostileRedeemed(), 0);
        }
    }

    function invariantCanonicalRegistryKernelAndMigrationStateStayCoherent() public view {
        assertTrue(handler.factory().isBoardroom(address(handler.boardroom())));
        assertTrue(handler.factory().isShareToken(address(handler.shareToken())));
        assertEq(handler.boardroom().facetRegistry(), address(handler.registry()));
        assertEq(handler.boardroom().facetSetHash(), handler.registry().activeFacetSetHash());

        uint64 appliedVersion = handler.boardroom().appliedStorageVersion();
        uint64 activeVersion = handler.registry().activeStorageVersion();
        assertLe(appliedVersion, activeVersion);
        assertEq(handler.boardroom().migrationRequired(), appliedVersion != activeVersion);
        if (appliedVersion == activeVersion) {
            assertEq(handler.boardroom().appliedStorageLayoutHash(), handler.registry().activeStorageLayoutHash());
        }
    }
}
