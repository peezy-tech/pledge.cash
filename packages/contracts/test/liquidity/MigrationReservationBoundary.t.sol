// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {WETH} from "solady/tokens/WETH.sol";
import {AmmFactory} from "../../src/amm/AmmFactory.sol";
import {AmmRouter} from "../../src/amm/AmmRouter.sol";
import {BoardroomToken} from "../../src/boardroom/BoardroomToken.sol";
import {LockedLiquidityFactory} from "../../src/liquidity/LockedLiquidityFactory.sol";

interface IReservationAmmFactory {
    function initialLiquidityReservationFor(address tokenA, address tokenB)
        external
        view
        returns (address initializer, address recipient, address reservationOwner, address manager);
}

contract ReservationPolicyRegistry {
    mapping(address => bool) public isModulePolicy;

    function setModule(address module, bool enabled) external {
        isModulePolicy[module] = enabled;
    }
}

contract ReservationBoardroomFactory {
    mapping(address => bool) public isBoardroom;
    mapping(address => bool) public isShareToken;

    function setBoardroom(address boardroom, bool canonical) external {
        isBoardroom[boardroom] = canonical;
    }

    function setShareToken(address shareToken, bool canonical) external {
        isShareToken[shareToken] = canonical;
    }
}

contract ReservationBoardroom {
    address public immutable policyRegistry;
    address public immutable shareToken;
    bytes32 public constant facetSetHash = keccak256("migration-reservation-boardroom-release");
    mapping(address => bool) public isIssuedDistribution;

    address public permanentQuoteAsset;
    address public pendingCurve;
    address public pendingLocker;
    bytes32 public pendingPairKey;
    bytes32 public pendingSalt;

    error PrimaryMarketAlreadyCommitted();
    error ReservationMismatch();

    constructor(address registry) {
        policyRegistry = registry;
        shareToken = address(new BoardroomToken(address(this), "Reservation Share", "RSHARE"));
    }

    function setIssuedDistribution(address distribution, bool issued) external {
        isIssuedDistribution[distribution] = issued;
    }

    function precommitProtocolLiquidity(
        bytes32 expectedFacetSetHash,
        address expectedLocker,
        address quoteAsset,
        address curve,
        bytes32 pairKey,
        bytes32 salt,
        uint64
    ) external {
        require(expectedFacetSetHash == facetSetHash);
        if (permanentQuoteAsset != address(0) || pendingCurve != address(0)) {
            revert PrimaryMarketAlreadyCommitted();
        }
        permanentQuoteAsset = quoteAsset;
        pendingCurve = curve;
        pendingLocker = expectedLocker;
        pendingPairKey = pairKey;
        pendingSalt = salt;
    }

    function releaseProtocolLiquidityReservation(
        bytes32 expectedFacetSetHash,
        address curve,
        bytes32 pairKey,
        bytes32 salt
    ) external {
        require(expectedFacetSetHash == facetSetHash);
        if (curve != pendingCurve || pairKey != pendingPairKey || salt != pendingSalt) revert ReservationMismatch();
        pendingCurve = address(0);
        pendingLocker = address(0);
        pendingPairKey = bytes32(0);
        pendingSalt = bytes32(0);
    }

    function activateProtocolLiquidity(
        bytes32 expectedFacetSetHash,
        address,
        address,
        address,
        address,
        bytes32,
        bytes32
    ) external pure {
        require(expectedFacetSetHash == facetSetHash);
    }

    function closeProtocolLiquidityFromFactory(bytes32 expectedFacetSetHash, address) external pure {
        require(expectedFacetSetHash == facetSetHash);
    }

    function liquidityMutationAllowed() external pure returns (bool) {
        return true;
    }

    function lockedLiquidityExitAllowed() external pure returns (bool) {
        return false;
    }
}

contract ReservationDistribution {
    address public immutable factory;
    address public immutable boardroom;
    address public immutable shareToken;
    address public immutable quoteToken;
    bytes32 public immutable migrationSalt;

    constructor(address boardroom_, address shareToken_, address quoteToken_, bytes32 salt_) {
        factory = msg.sender;
        boardroom = boardroom_;
        shareToken = shareToken_;
        quoteToken = quoteToken_;
        migrationSalt = salt_;
    }

    function reservationExpiresAt() external pure returns (uint64) {
        return type(uint64).max;
    }

    function release(LockedLiquidityFactory liquidityFactory) external {
        liquidityFactory.releaseMigrationReservation(boardroom, shareToken, quoteToken, migrationSalt);
    }
}

contract ReservationDistributionFactory {
    function createAndReserve(
        LockedLiquidityFactory liquidityFactory,
        address boardroom,
        address shareToken,
        address quoteToken,
        bytes32 salt
    ) external returns (ReservationDistribution distribution) {
        distribution = new ReservationDistribution(boardroom, shareToken, quoteToken, salt);
        liquidityFactory.reserveMigration(boardroom, address(distribution), shareToken, quoteToken, salt);
    }
}

contract ReservationQuote {
    function balanceOf(address) external pure returns (uint256) {
        return 0;
    }
}

contract MigrationReservationBoundaryTest is Test {
    AmmFactory internal ammFactory;
    AmmRouter internal router;
    LockedLiquidityFactory internal liquidityFactory;
    ReservationPolicyRegistry internal registry;
    ReservationBoardroomFactory internal boardroomFactory;
    ReservationBoardroom internal boardroom;
    ReservationDistributionFactory internal distributionFactory;
    address internal shareToken;

    function setUp() public {
        WETH wrappedNative = new WETH();
        boardroomFactory = new ReservationBoardroomFactory();
        ammFactory = new AmmFactory(address(this), address(boardroomFactory));
        router = new AmmRouter(address(ammFactory), address(wrappedNative));
        liquidityFactory = new LockedLiquidityFactory(address(router), address(boardroomFactory));
        ammFactory.setLiquidityRouter(address(router));
        ammFactory.setReservationManager(address(liquidityFactory));

        registry = new ReservationPolicyRegistry();
        boardroom = new ReservationBoardroom(address(registry));
        shareToken = boardroom.shareToken();
        boardroomFactory.setBoardroom(address(boardroom), true);
        boardroomFactory.setShareToken(shareToken, true);
        distributionFactory = new ReservationDistributionFactory();
        registry.setModule(address(distributionFactory), true);
    }

    function testOneOutstandingReservationConsumesSingletonAcrossPairsAndSalts() public {
        address firstQuote = address(new ReservationQuote());
        address secondQuote = address(new ReservationQuote());
        bytes32 firstSalt = keccak256("first-reservation");
        ReservationDistribution first = _reserve(firstQuote, firstSalt);

        vm.expectRevert(
            abi.encodeWithSelector(LockedLiquidityFactory.PositionAlreadyConfigured.selector, address(boardroom))
        );
        _reserve(secondQuote, keccak256("different-pair-and-salt"));

        (address curve, address expectedLocker,, address reservedShareToken, address quoteAsset,, bytes32 salt) =
            liquidityFactory.migrationReservationOf(address(boardroom));
        assertEq(curve, address(first));
        assertNotEq(expectedLocker, address(0));
        assertEq(reservedShareToken, shareToken);
        assertEq(quoteAsset, firstQuote);
        assertEq(salt, firstSalt);
        _assertAmmReservation(firstQuote, address(first), expectedLocker, true);
    }

    function testReleaseClearsOnlyPendingReservationAndPreservesPermanentQuoteTombstone() public {
        address quote = address(new ReservationQuote());
        bytes32 salt = keccak256("release-preserves-tombstone");
        ReservationDistribution first = _reserve(quote, salt);
        boardroom.setIssuedDistribution(address(first), true);

        first.release(liquidityFactory);
        (address curve,,,,,,) = liquidityFactory.migrationReservationOf(address(boardroom));
        assertEq(curve, address(0));
        assertEq(boardroom.permanentQuoteAsset(), quote);
        assertEq(boardroom.pendingCurve(), address(0));
        _assertAmmReservation(quote, address(0), address(0), false);

        vm.expectRevert(ReservationBoardroom.PrimaryMarketAlreadyCommitted.selector);
        _reserve(quote, keccak256("replacement-forbidden"));
        assertEq(boardroom.permanentQuoteAsset(), quote);
    }

    function testUnregisteredBoardroomCannotAcquireReservationAuthority() public {
        ReservationBoardroom unregistered = new ReservationBoardroom(address(registry));
        address unregisteredShare = unregistered.shareToken();
        address quote = address(new ReservationQuote());
        vm.expectRevert(abi.encodeWithSelector(LockedLiquidityFactory.InvalidBoardroom.selector, address(unregistered)));
        distributionFactory.createAndReserve(
            liquidityFactory, address(unregistered), unregisteredShare, quote, keccak256("unregistered")
        );
    }

    function testUnregisteredMigrationFactoryAndSpoofedRelationshipFailClosed() public {
        ReservationDistributionFactory unregisteredFactory = new ReservationDistributionFactory();
        address quote = address(new ReservationQuote());
        vm.expectRevert();
        unregisteredFactory.createAndReserve(
            liquidityFactory, address(boardroom), shareToken, quote, keccak256("unregistered-factory")
        );
    }

    function testPairOfTwoCanonicalBoardroomSharesCannotBeReserved() public {
        ReservationBoardroom second = new ReservationBoardroom(address(registry));
        address secondShare = second.shareToken();
        boardroomFactory.setShareToken(secondShare, true);
        vm.expectRevert();
        _reserve(secondShare, keccak256("two-share-pair"));
        assertEq(boardroom.permanentQuoteAsset(), address(0));
    }

    function testPredictedLockerAndAmmReservationAreBoundToCurve() public {
        address quote = address(new ReservationQuote());
        bytes32 salt = keccak256("prediction-boundary");
        ReservationDistribution distribution = _reserve(quote, salt);
        (address curve, address expectedLocker, address expectedPool,,,,) =
            liquidityFactory.migrationReservationOf(address(boardroom));

        assertEq(curve, address(distribution));
        assertEq(expectedLocker, liquidityFactory.predictLockedLiquidityAddress(address(boardroom), salt));
        assertEq(expectedPool, router.poolFor(boardroom.shareToken(), quote));
        _assertAmmReservation(quote, address(distribution), expectedLocker, true);
    }

    function _reserve(address quote, bytes32 salt) internal returns (ReservationDistribution distribution) {
        distribution =
            distributionFactory.createAndReserve(liquidityFactory, address(boardroom), shareToken, quote, salt);
    }

    function _assertAmmReservation(address quote, address expectedOwner, address expectedLocker, bool expectedPresent)
        internal
        view
    {
        (address initializer, address recipient, address reservationOwner, address manager) =
            IReservationAmmFactory(address(ammFactory)).initialLiquidityReservationFor(shareToken, quote);
        assertEq(reservationOwner, expectedOwner);
        assertEq(initializer, expectedLocker);
        assertEq(recipient, expectedLocker);
        assertEq(manager, expectedPresent ? address(liquidityFactory) : address(0));
    }
}
