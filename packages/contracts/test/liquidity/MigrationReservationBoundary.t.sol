// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {AmmFactory} from "../../src/amm/AmmFactory.sol";
import {AmmRouter} from "../../src/amm/AmmRouter.sol";
import {BoardroomToken} from "../../src/boardroom/BoardroomToken.sol";
import {LockedLiquidityFactory} from "../../src/liquidity/LockedLiquidityFactory.sol";
import {ERC20} from "solady/tokens/ERC20.sol";
import {WETH} from "solady/tokens/WETH.sol";

interface IMigrationReservationAmmFactory {
    function setLiquidityRouter(address router) external;
    function setReservationManager(address manager) external;

    function initialLiquidityReservationFor(address tokenA, address tokenB)
        external
        view
        returns (address initializer, address recipient, address reservationOwner);
}

interface IMigrationReservationToken {
    function approve(address spender, uint256 amount) external returns (bool);
}

contract MigrationReservationPolicyRegistry {
    mapping(address => bool) public isModulePolicy;

    function setModulePolicy(address policy, bool allowed) external {
        isModulePolicy[policy] = allowed;
    }
}

contract MigrationReservationBoardroomFactory {
    mapping(address => bool) public isBoardroom;

    function setBoardroom(address boardroom, bool canonical) external {
        isBoardroom[boardroom] = canonical;
    }
}

contract MigrationReservationBoardroom {
    address public immutable policyRegistry;
    address public immutable shareToken;
    mapping(address => bool) public isIssuedDistribution;

    constructor(address policyRegistry_) {
        policyRegistry = policyRegistry_;
        shareToken = address(new BoardroomToken(address(this), "Boundary Share", "BSHARE"));
    }

    function setIssuedDistribution(address distribution, bool issued) external {
        isIssuedDistribution[distribution] = issued;
    }

    function lockedLiquidityExitAllowed() external pure returns (bool) {
        return false;
    }

    function seedLockedLiquidity(
        LockedLiquidityFactory lockedLiquidityFactory,
        address quoteToken,
        uint256 amount,
        bytes32 salt
    ) external returns (address locker) {
        BoardroomToken(shareToken).mint(address(this), amount);
        BoardroomToken(shareToken).approve(address(lockedLiquidityFactory), amount);
        IMigrationReservationToken(quoteToken).approve(address(lockedLiquidityFactory), amount);
        uint256 minimum = amount * 9_500 / 10_000;
        (locker,,,,) = lockedLiquidityFactory.createLockedLiquidity(
            LockedLiquidityFactory.CreateParams({
                tokenA: shareToken,
                tokenB: quoteToken,
                amountADesired: amount,
                amountBDesired: amount,
                amountAMin: minimum,
                amountBMin: minimum,
                deadline: block.timestamp,
                salt: salt
            })
        );
    }
}

contract MigrationReservationDistribution {
    address public immutable factory;
    address public immutable boardroom;
    address public immutable shareToken;
    address public immutable quoteToken;
    bytes32 public immutable migrationSalt;

    constructor(address boardroom_, address shareToken_, address quoteToken_, bytes32 migrationSalt_) {
        factory = msg.sender;
        boardroom = boardroom_;
        shareToken = shareToken_;
        quoteToken = quoteToken_;
        migrationSalt = migrationSalt_;
    }

    function releaseReservation(LockedLiquidityFactory lockedLiquidityFactory) external {
        lockedLiquidityFactory.releaseMigrationReservation(boardroom, shareToken, quoteToken, migrationSalt);
    }
}

contract MigrationReservationDistributionFactory {
    function createAndReserve(
        LockedLiquidityFactory lockedLiquidityFactory,
        address boardroom,
        address shareToken,
        address quoteToken,
        bytes32 migrationSalt
    ) external returns (MigrationReservationDistribution distribution) {
        distribution = new MigrationReservationDistribution(boardroom, shareToken, quoteToken, migrationSalt);
        lockedLiquidityFactory.reserveMigration(boardroom, address(distribution), shareToken, quoteToken, migrationSalt);
    }
}

contract MigrationReservationQuoteToken {}

contract MigrationReservationSeedToken is ERC20 {
    function name() public pure override returns (string memory) {
        return "Migration Seed";
    }

    function symbol() public pure override returns (string memory) {
        return "MSEED";
    }

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }
}

contract MigrationReservationBoundaryTest is Test {
    AmmFactory internal ammFactory;
    AmmRouter internal ammRouter;
    LockedLiquidityFactory internal lockedLiquidityFactory;
    MigrationReservationPolicyRegistry internal policyRegistry;
    MigrationReservationBoardroomFactory internal boardroomFactory;
    MigrationReservationBoardroom internal boardroom;
    MigrationReservationDistributionFactory internal distributionFactory;

    address internal shareToken;

    function setUp() public {
        WETH wrappedNative = new WETH();
        ammFactory = new AmmFactory(address(this));
        ammRouter = new AmmRouter(address(ammFactory), address(wrappedNative));
        boardroomFactory = new MigrationReservationBoardroomFactory();
        lockedLiquidityFactory = new LockedLiquidityFactory(address(ammRouter), address(boardroomFactory));

        IMigrationReservationAmmFactory configurableFactory = IMigrationReservationAmmFactory(address(ammFactory));
        configurableFactory.setLiquidityRouter(address(ammRouter));
        configurableFactory.setReservationManager(address(lockedLiquidityFactory));

        policyRegistry = new MigrationReservationPolicyRegistry();
        boardroom = new MigrationReservationBoardroom(address(policyRegistry));
        boardroomFactory.setBoardroom(address(boardroom), true);
        distributionFactory = new MigrationReservationDistributionFactory();
        policyRegistry.setModulePolicy(address(distributionFactory), true);
        shareToken = boardroom.shareToken();
    }

    function testSamePairCannotBeReservedByTwoCurves() public {
        address quoteToken = address(new MigrationReservationQuoteToken());
        bytes32 firstSalt = keccak256("same-pair-first");
        MigrationReservationDistribution first = _createReservation(quoteToken, firstSalt);

        vm.expectRevert(
            abi.encodeWithSelector(
                LockedLiquidityFactory.MigrationPairReserved.selector, address(boardroom), shareToken, quoteToken
            )
        );
        _createReservation(quoteToken, keccak256("same-pair-second"));

        assertEq(
            lockedLiquidityFactory.migrationReservationForPair(address(boardroom), _pairKey(shareToken, quoteToken)),
            address(first)
        );
        assertEq(lockedLiquidityFactory.migrationReservationCount(address(boardroom)), 1);
    }

    function testUnregisteredBoardroomCannotAcquireAmmReservationAuthority() public {
        MigrationReservationBoardroom unregistered = new MigrationReservationBoardroom(address(policyRegistry));
        address quoteToken = address(new MigrationReservationQuoteToken());

        vm.expectRevert(
            abi.encodeWithSelector(
                LockedLiquidityFactory.UnauthorizedMigrationReservation.selector,
                address(unregistered),
                address(distributionFactory)
            )
        );
        distributionFactory.createAndReserve(
            lockedLiquidityFactory,
            address(unregistered),
            unregistered.shareToken(),
            quoteToken,
            keccak256("unregistered-boardroom")
        );

        assertEq(lockedLiquidityFactory.migrationReservationCount(address(unregistered)), 0);
    }

    function testSameSaltCannotBeReservedForTwoPairs() public {
        address firstQuote = address(new MigrationReservationQuoteToken());
        address secondQuote = address(new MigrationReservationQuoteToken());
        bytes32 migrationSalt = keccak256("same-salt");
        MigrationReservationDistribution first = _createReservation(firstQuote, migrationSalt);

        vm.expectRevert(
            abi.encodeWithSelector(
                LockedLiquidityFactory.MigrationSaltReserved.selector, address(boardroom), migrationSalt
            )
        );
        _createReservation(secondQuote, migrationSalt);

        assertEq(lockedLiquidityFactory.migrationReservationForSalt(address(boardroom), migrationSalt), address(first));
        assertEq(lockedLiquidityFactory.migrationReservationCount(address(boardroom)), 1);
    }

    function testCancellationReleasesLlfAndAmmReservationsAndPermitsReuse() public {
        address quoteToken = address(new MigrationReservationQuoteToken());
        bytes32 migrationSalt = keccak256("cancel-and-reuse");
        MigrationReservationDistribution first = _createReservation(quoteToken, migrationSalt);
        boardroom.setIssuedDistribution(address(first), true);

        _assertAmmReservation(quoteToken, address(first), true);
        first.releaseReservation(lockedLiquidityFactory);

        assertEq(lockedLiquidityFactory.migrationReservationForSalt(address(boardroom), migrationSalt), address(0));
        assertEq(
            lockedLiquidityFactory.migrationReservationForPair(address(boardroom), _pairKey(shareToken, quoteToken)),
            address(0)
        );
        assertEq(lockedLiquidityFactory.migrationReservationCount(address(boardroom)), 0);
        _assertAmmReservation(quoteToken, address(0), false);

        MigrationReservationDistribution replacement = _createReservation(quoteToken, migrationSalt);
        assertNotEq(address(replacement), address(first));
        assertEq(
            lockedLiquidityFactory.migrationReservationForSalt(address(boardroom), migrationSalt), address(replacement)
        );
        _assertAmmReservation(quoteToken, address(replacement), true);
    }

    function testThirtyTwoReservationsFillCapacityAndThirtyThirdReverts() public {
        uint256 capacity = lockedLiquidityFactory.MAX_LOCKERS_PER_BOARDROOM();
        assertEq(capacity, 32);

        for (uint256 i; i < capacity; ++i) {
            address quoteToken = address(new MigrationReservationQuoteToken());
            _createReservation(quoteToken, keccak256(abi.encode("capacity", i)));
        }

        assertEq(lockedLiquidityFactory.migrationReservationCount(address(boardroom)), capacity);

        address overflowQuote = address(new MigrationReservationQuoteToken());
        vm.expectRevert(
            abi.encodeWithSelector(LockedLiquidityFactory.TooManyBoardroomLockers.selector, address(boardroom))
        );
        _createReservation(overflowQuote, keccak256("capacity-overflow"));
        assertEq(lockedLiquidityFactory.migrationReservationCount(address(boardroom)), capacity);
    }

    function testPreviouslyDeployedLockerSaltCannotBeReservedForAnotherPair() public {
        bytes32 migrationSalt = keccak256("historical-locker-salt");
        MigrationReservationSeedToken seedToken = new MigrationReservationSeedToken();
        uint256 seedAmount = 1 ether;
        seedToken.mint(address(boardroom), seedAmount);
        address locker =
            boardroom.seedLockedLiquidity(lockedLiquidityFactory, address(seedToken), seedAmount, migrationSalt);
        assertTrue(lockedLiquidityFactory.isLocker(locker));

        address otherQuote = address(new MigrationReservationQuoteToken());
        vm.expectRevert(
            abi.encodeWithSelector(
                LockedLiquidityFactory.MigrationLockerSaltUsed.selector, address(boardroom), migrationSalt, locker
            )
        );
        _createReservation(otherQuote, migrationSalt);
        assertEq(lockedLiquidityFactory.migrationReservationCount(address(boardroom)), 0);
    }

    function _createReservation(address quoteToken, bytes32 migrationSalt)
        internal
        returns (MigrationReservationDistribution distribution)
    {
        distribution = distributionFactory.createAndReserve(
            lockedLiquidityFactory, address(boardroom), shareToken, quoteToken, migrationSalt
        );
    }

    function _assertAmmReservation(address quoteToken, address expectedOwner, bool expectedPresent) internal view {
        (address initializer, address recipient, address reservationOwner) =
            IMigrationReservationAmmFactory(address(ammFactory)).initialLiquidityReservationFor(shareToken, quoteToken);
        assertEq(reservationOwner, expectedOwner);
        assertEq(initializer != address(0), expectedPresent);
        assertEq(recipient, initializer);
    }

    function _pairKey(address tokenA, address tokenB) internal pure returns (bytes32) {
        return tokenA < tokenB ? keccak256(abi.encode(tokenA, tokenB)) : keccak256(abi.encode(tokenB, tokenA));
    }
}
