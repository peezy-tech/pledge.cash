// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {BoardroomToken} from "../../src/boardroom/BoardroomToken.sol";
import {PledgeV4Hook} from "../../src/uniswap/PledgeV4Hook.sol";
import {PledgeV4LiquidityFactory} from "../../src/uniswap/PledgeV4LiquidityFactory.sol";
import {V4PoolManagerMock} from "../helpers/V4PoolManagerMock.sol";

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
    address public pendingVault;
    bytes32 public pendingPoolId;
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
        address expectedVault,
        bytes32 expectedPoolId,
        address quoteAsset,
        address curve,
        bytes32 salt,
        uint64
    ) external {
        require(expectedFacetSetHash == facetSetHash);
        if (permanentQuoteAsset != address(0) || pendingCurve != address(0)) {
            revert PrimaryMarketAlreadyCommitted();
        }
        permanentQuoteAsset = quoteAsset;
        pendingCurve = curve;
        pendingVault = expectedVault;
        pendingPoolId = expectedPoolId;
        pendingSalt = salt;
    }

    function releaseProtocolLiquidityReservation(
        bytes32 expectedFacetSetHash,
        address curve,
        bytes32 poolId,
        bytes32 salt
    ) external {
        require(expectedFacetSetHash == facetSetHash);
        if (curve != pendingCurve || poolId != pendingPoolId || salt != pendingSalt) revert ReservationMismatch();
        pendingCurve = address(0);
        pendingVault = address(0);
        pendingPoolId = bytes32(0);
        pendingSalt = bytes32(0);
    }

    function activateProtocolLiquidity(bytes32 expectedFacetSetHash, address, bytes32, address, address, bytes32)
        external
        pure
    {
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

    function release(PledgeV4LiquidityFactory liquidityFactory) external {
        liquidityFactory.releaseMigrationReservation(
            ReservationBoardroom(boardroom).facetSetHash(), boardroom, shareToken, quoteToken, migrationSalt
        );
    }
}

contract ReservationDistributionFactory {
    function createAndReserve(
        PledgeV4LiquidityFactory liquidityFactory,
        address boardroom,
        address shareToken,
        address quoteToken,
        bytes32 salt
    ) external returns (ReservationDistribution distribution) {
        distribution = new ReservationDistribution(boardroom, shareToken, quoteToken, salt);
        liquidityFactory.reserveMigration(
            ReservationBoardroom(boardroom).facetSetHash(),
            boardroom,
            address(distribution),
            shareToken,
            quoteToken,
            salt
        );
    }
}

contract ReservationQuote {
    function balanceOf(address) external pure returns (uint256) {
        return 0;
    }
}

contract ReservationFeeRecipient {}

contract MigrationReservationBoundaryTest is Test {
    V4PoolManagerMock internal poolManager;
    PledgeV4LiquidityFactory internal liquidityFactory;
    ReservationPolicyRegistry internal registry;
    ReservationBoardroomFactory internal boardroomFactory;
    ReservationBoardroom internal boardroom;
    ReservationDistributionFactory internal distributionFactory;
    address internal shareToken;

    function setUp() public {
        boardroomFactory = new ReservationBoardroomFactory();
        poolManager = new V4PoolManagerMock();
        ReservationFeeRecipient feeRecipient = new ReservationFeeRecipient();
        liquidityFactory = new PledgeV4LiquidityFactory(
            IPoolManager(address(poolManager)), address(boardroomFactory), address(feeRecipient), address(this)
        );
        liquidityFactory.deployHook(_mineHookSalt());

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
            abi.encodeWithSelector(PledgeV4LiquidityFactory.PositionAlreadyConfigured.selector, address(boardroom))
        );
        _reserve(secondQuote, keccak256("different-pair-and-salt"));

        (address curve, address expectedVault,, address reservedShareToken, address quoteAsset, bytes32 salt) =
            liquidityFactory.migrationReservationOf(address(boardroom));
        assertEq(curve, address(first));
        assertNotEq(expectedVault, address(0));
        assertEq(reservedShareToken, shareToken);
        assertEq(quoteAsset, firstQuote);
        assertEq(salt, firstSalt);
    }

    function testReleaseClearsOnlyPendingReservationAndPreservesPermanentQuoteTombstone() public {
        address quote = address(new ReservationQuote());
        bytes32 salt = keccak256("release-preserves-tombstone");
        ReservationDistribution first = _reserve(quote, salt);
        boardroom.setIssuedDistribution(address(first), true);

        first.release(liquidityFactory);
        (address curve,,,,,) = liquidityFactory.migrationReservationOf(address(boardroom));
        assertEq(curve, address(0));
        assertEq(boardroom.permanentQuoteAsset(), quote);
        assertEq(boardroom.pendingCurve(), address(0));

        vm.expectRevert(ReservationBoardroom.PrimaryMarketAlreadyCommitted.selector);
        _reserve(quote, keccak256("replacement-forbidden"));
        assertEq(boardroom.permanentQuoteAsset(), quote);
    }

    function testUnregisteredBoardroomCannotAcquireReservationAuthority() public {
        ReservationBoardroom unregistered = new ReservationBoardroom(address(registry));
        address unregisteredShare = unregistered.shareToken();
        address quote = address(new ReservationQuote());
        vm.expectRevert(
            abi.encodeWithSelector(PledgeV4LiquidityFactory.InvalidBoardroom.selector, address(unregistered))
        );
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

    function testPredictedVaultAndPoolIdAreBoundToCurve() public {
        address quote = address(new ReservationQuote());
        bytes32 salt = keccak256("prediction-boundary");
        ReservationDistribution distribution = _reserve(quote, salt);
        (address curve, address expectedVault, bytes32 expectedPoolId,,,) =
            liquidityFactory.migrationReservationOf(address(boardroom));

        assertEq(curve, address(distribution));
        assertEq(expectedVault, liquidityFactory.predictLiquidityVaultAddress(address(boardroom), salt));
        assertEq(expectedPoolId, liquidityFactory.poolIdFor(boardroom.shareToken(), quote));
    }

    function testReservationDoesNotGiveThirdPartyPoolInitializationAuthority() public {
        address quote = address(new ReservationQuote());
        _reserve(quote, keccak256("hook-auth-boundary"));
        bytes32 poolId = liquidityFactory.poolIdFor(shareToken, quote);
        PoolKey memory key = liquidityFactory.poolKeyFor(shareToken, quote);

        vm.expectRevert(abi.encodeWithSelector(PledgeV4Hook.PoolInitializationNotAuthorized.selector, poolId));
        poolManager.initialize(key, 1 << 96);
    }

    function _reserve(address quote, bytes32 salt) internal returns (ReservationDistribution distribution) {
        distribution =
            distributionFactory.createAndReserve(liquidityFactory, address(boardroom), shareToken, quote, salt);
    }

    function _mineHookSalt() internal view returns (bytes32 salt) {
        for (uint256 candidate; candidate < 100_000; ++candidate) {
            salt = bytes32(candidate);
            if (uint160(liquidityFactory.predictHookAddress(salt)) & ((1 << 14) - 1) == (1 << 13)) return salt;
        }
        revert("hook salt");
    }
}
