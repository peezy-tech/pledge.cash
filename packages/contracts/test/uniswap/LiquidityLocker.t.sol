// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "solady/tokens/ERC20.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Boardroom} from "../../src/boardroom/Boardroom.sol";
import {BoardroomFactory} from "../../src/boardroom/BoardroomFactory.sol";
import {IBoardroom} from "../../src/boardroom/IBoardroom.sol";
import {ProtocolFeeRouter} from "../../src/fees/ProtocolFeeRouter.sol";
import {LiquidityLocker} from "../../src/uniswap/LiquidityLocker.sol";
import {LiquidityLockerFactory} from "../../src/uniswap/LiquidityLockerFactory.sol";
import {PositionManagerActions} from "../../src/uniswap/PositionManagerActions.sol";
import {PositionManagerMock} from "../helpers/PositionManagerMock.sol";
import {
    OnePercentFeeTestERC20 as LockerFeeToken,
    SoladyTestERC20 as LockerTestToken,
    DepositOnlyTestWrappedNative as LockerWrappedNative
} from "../helpers/TestTokens.sol";

contract LiquidityLockerTest is Test {
    uint256 internal constant TOKEN_ID = 41;
    bytes32 internal constant BOARDROOM_SALT = keccak256("locker-boardroom");
    bytes32 internal constant LOCKER_SALT = keccak256("locker");

    LockerWrappedNative internal wrappedNative;
    LockerTestToken internal quote;
    BoardroomFactory internal boardroomFactory;
    Boardroom internal boardroom;
    PositionManagerMock internal positionManager;
    ProtocolFeeRouter internal protocolFeeRouter;
    LiquidityLockerFactory internal lockerFactory;
    LiquidityLocker internal locker;

    address internal protocolRecipient = makeAddr("protocol-recipient");
    address internal alice = makeAddr("alice");

    function setUp() public {
        wrappedNative = new LockerWrappedNative();
        quote = new LockerTestToken("Quote", "QUOTE");
        boardroomFactory = new BoardroomFactory(address(wrappedNative));
        boardroom =
            Boardroom(payable(boardroomFactory.createBoardroom(address(this), "Pledge", "PLDG", BOARDROOM_SALT)));
        positionManager = new PositionManagerMock();
        protocolFeeRouter = new ProtocolFeeRouter(address(this), protocolRecipient);
        lockerFactory =
            new LiquidityLockerFactory(address(boardroomFactory), positionManager, address(protocolFeeRouter));
        locker = _createLocker(boardroom, address(quote), LOCKER_SALT);
    }

    function testFactoryRegistersCanonicalLockerAndEscrowAtomically() public view {
        assertEq(lockerFactory.lockerOfBoardroom(address(boardroom)), address(locker));
        assertEq(locker.boardroom(), address(boardroom));
        assertEq(locker.shareToken(), boardroom.shareToken());
        assertEq(locker.quoteAsset(), address(quote));
        assertEq(address(locker.positionManager()), address(positionManager));
        assertEq(locker.protocolFeeRouter(), address(protocolFeeRouter));

        assertEq(uint256(boardroom.escrowState(address(locker))), uint256(IBoardroom.EscrowState.Open));
        assertEq(boardroom.openEscrowCount(), 1);
        assertTrue(boardroom.isRedeemableAsset(address(quote)));
        assertTrue(boardroom.isRedeemableAsset(address(quote)));
    }

    function testFactoryRejectsEveryCanonicalBoardroomShareTokenAsQuote() public {
        Boardroom other = Boardroom(
            payable(boardroomFactory.createBoardroom(address(this), "Other", "OTHR", keccak256("other-board")))
        );
        address otherShareToken = other.shareToken();
        vm.expectRevert(abi.encodeWithSelector(LiquidityLockerFactory.InvalidAddress.selector, otherShareToken));
        boardroom.execute(
            IBoardroom.Call({
                target: address(lockerFactory),
                value: 0,
                data: abi.encodeCall(
                    lockerFactory.createLocker,
                    (otherShareToken, uint24(3_000), int24(60), keccak256("invalid-share-quote"))
                )
            })
        );
    }

    function testConstructorRejectsNonCanonicalPoolParameters() public {
        address shares = boardroom.shareToken();
        vm.expectRevert(
            abi.encodeWithSelector(LiquidityLocker.InvalidPoolConfiguration.selector, uint24(1_000_001), int24(60))
        );
        new LiquidityLocker(
            address(boardroom), positionManager, address(protocolFeeRouter), shares, address(quote), 1_000_001, 60
        );

        vm.expectRevert(
            abi.encodeWithSelector(LiquidityLocker.InvalidPoolConfiguration.selector, uint24(3_000), int24(32_768))
        );
        new LiquidityLocker(
            address(boardroom), positionManager, address(protocolFeeRouter), shares, address(quote), 3_000, 32_768
        );
    }

    function testDirectCcaMintRequiresBoardroomRegistration() public {
        _mintPosition(locker, TOKEN_ID, address(0), 100, 200, 1_000);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(LiquidityLocker.OnlyBoardroom.selector, alice));
        locker.registerPosition(TOKEN_ID);

        _executeLocker(locker, abi.encodeCall(locker.registerPosition, (TOKEN_ID)));
        assertTrue(locker.positionRegistered());
        assertEq(locker.tokenId(), TOKEN_ID);
        assertEq(positionManager.ownerOf(TOKEN_ID), address(locker));
    }

    function testTokenIdZeroHasUnambiguousLifecycle() public {
        _mintAndRegister(0, 100, 200, 1_000);
        assertEq(locker.tokenId(), 0);
        assertTrue(locker.positionRegistered());
        assertFalse(locker.isClosed());

        _fundManager(locker, 100, 200);
        boardroom.startWindDown();
        _executeEscrow(locker, abi.encodeCall(locker.exit, (uint128(100), uint128(200), block.timestamp + 1)));

        assertEq(locker.tokenId(), 0);
        assertFalse(locker.positionRegistered());
        assertTrue(locker.isClosed());
    }

    function testRejectsHookedWrongPairEmptyAndMalformedPositions() public {
        PoolKey memory hooked = _poolKey(locker, address(0xBEEF));
        _mintPositionTo(address(locker), 1, hooked, 100, 200, 1_000);
        vm.expectRevert(abi.encodeWithSelector(LiquidityLocker.HookedPool.selector, address(0xBEEF)));
        _executeLocker(locker, abi.encodeCall(locker.registerPosition, (1)));

        LockerTestToken wrong = new LockerTestToken("Wrong", "WRONG");
        PoolKey memory wrongPair = PoolKey({
            currency0: Currency.wrap(address(wrong) < address(quote) ? address(wrong) : address(quote)),
            currency1: Currency.wrap(address(wrong) < address(quote) ? address(quote) : address(wrong)),
            fee: 3_000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        _mintPositionTo(address(locker), 2, wrongPair, 100, 200, 1_000);
        vm.expectPartialRevert(LiquidityLocker.InvalidPositionPair.selector);
        _executeLocker(locker, abi.encodeCall(locker.registerPosition, (2)));

        _mintPositionTo(address(locker), 3, _poolKey(locker, address(0)), 100, 200, 0);
        vm.expectRevert(abi.encodeWithSelector(LiquidityLocker.EmptyPosition.selector, 3));
        _executeLocker(locker, abi.encodeCall(locker.registerPosition, (3)));

        positionManager.mintDirect(address(locker), 4, _poolKey(locker, address(0)), 100, 100, 1_000, 100, 100);
        vm.expectPartialRevert(LiquidityLocker.InvalidPositionInfo.selector);
        _executeLocker(locker, abi.encodeCall(locker.registerPosition, (4)));

        PoolKey memory wrongFee = _poolKey(locker, address(0));
        wrongFee.fee = 500;
        _mintPositionTo(address(locker), 5, wrongFee, 100, 200, 1_000);
        vm.expectPartialRevert(LiquidityLocker.InvalidPositionInfo.selector);
        _executeLocker(locker, abi.encodeCall(locker.registerPosition, (5)));

        PoolKey memory wrongTickSpacing = _poolKey(locker, address(0));
        wrongTickSpacing.tickSpacing = 10;
        _mintPositionTo(address(locker), 6, wrongTickSpacing, 100, 200, 1_000);
        vm.expectPartialRevert(LiquidityLocker.InvalidPositionInfo.selector);
        _executeLocker(locker, abi.encodeCall(locker.registerPosition, (6)));

        _mintPositionTo(address(locker), 7, _poolKey(locker, address(0)), 100, 200, 1_000);
        positionManager.setSubscriberFlag(7, true);
        vm.expectRevert(abi.encodeWithSelector(LiquidityLocker.SubscribedPosition.selector, 7));
        _executeLocker(locker, abi.encodeCall(locker.registerPosition, (7)));
    }

    function testOnePositionOnly() public {
        _mintAndRegister(TOKEN_ID, 100, 200, 1_000);
        _mintPositionTo(address(locker), TOKEN_ID + 1, _poolKey(locker, address(0)), 100, 200, 1_000);
        vm.expectRevert(abi.encodeWithSelector(LiquidityLocker.PositionAlreadyRegistered.selector, TOKEN_ID));
        _executeLocker(locker, abi.encodeCall(locker.registerPosition, (TOKEN_ID + 1)));
    }

    function testCollectFeesUsesCanonicalActionsExactDeltasAndFloorRounding() public {
        _mintAndRegister(TOKEN_ID, 100, 200, 1_000);
        _fundManager(locker, 1_019, 2_039);
        positionManager.accrueFees(TOKEN_ID, 1_019, 2_039);

        vm.prank(alice);
        (uint256 boardroom0, uint256 boardroom1, uint256 protocol0, uint256 protocol1) = locker.collectFees();
        assertEq(protocol0, 50);
        assertEq(protocol1, 101);
        assertEq(boardroom0, 969);
        assertEq(boardroom1, 1_938);
        _assertCurrencyBalance(locker.currency0(), address(protocolFeeRouter), protocol0);
        _assertCurrencyBalance(locker.currency1(), address(protocolFeeRouter), protocol1);
        _assertCurrencyBalance(locker.currency0(), address(boardroom), boardroom0);
        _assertCurrencyBalance(locker.currency1(), address(boardroom), boardroom1);

        bytes memory actions = positionManager.lastActions();
        assertEq(uint8(actions[0]), PositionManagerActions.DECREASE_LIQUIDITY);
        assertEq(uint8(actions[1]), PositionManagerActions.TAKE_PAIR);
    }

    function testFeeSplitHandlesZeroAndSubTwentyFees() public {
        _mintAndRegister(TOKEN_ID, 100, 200, 1_000);

        (uint256 boardroom0, uint256 boardroom1, uint256 protocol0, uint256 protocol1) = locker.collectFees();
        assertEq(boardroom0, 0);
        assertEq(boardroom1, 0);
        assertEq(protocol0, 0);
        assertEq(protocol1, 0);

        _fundManager(locker, 19, 20);
        positionManager.accrueFees(TOKEN_ID, 19, 20);
        (boardroom0, boardroom1, protocol0, protocol1) = locker.collectFees();
        assertEq(boardroom0, 19);
        assertEq(boardroom1, 19);
        assertEq(protocol0, 0);
        assertEq(protocol1, 1);
    }

    function testFeeSplitHandlesMaximumAccruedFeesWithoutOverflow() public {
        uint128 maximumFee = type(uint128).max;
        _mintAndRegister(TOKEN_ID, 100, 200, 1_000);
        _fundManager(locker, maximumFee, maximumFee);
        positionManager.accrueFees(TOKEN_ID, maximumFee, maximumFee);

        (uint256 boardroom0, uint256 boardroom1, uint256 protocol0, uint256 protocol1) = locker.collectFees();
        uint256 expectedProtocol = uint256(maximumFee) / 20;
        assertEq(protocol0, expectedProtocol);
        assertEq(protocol1, expectedProtocol);
        assertEq(boardroom0 + protocol0, maximumFee);
        assertEq(boardroom1 + protocol1, maximumFee);
    }

    function testFuzzFeeSplitRounding(uint128 rawFee0, uint128 rawFee1) public {
        uint128 fee0 = uint128(bound(rawFee0, 1, 1e24));
        uint128 fee1 = uint128(bound(rawFee1, 1, 1e24));
        _mintAndRegister(TOKEN_ID, 100, 200, 1_000);
        _fundManager(locker, fee0, fee1);
        positionManager.accrueFees(TOKEN_ID, fee0, fee1);

        (uint256 boardroom0, uint256 boardroom1, uint256 protocol0, uint256 protocol1) = locker.collectFees();
        assertEq(protocol0, uint256(fee0) / 20);
        assertEq(protocol1, uint256(fee1) / 20);
        assertEq(boardroom0 + protocol0, fee0);
        assertEq(boardroom1 + protocol1, fee1);
    }

    function testReentrantPositionManagerCallbackIsRejected() public {
        _mintAndRegister(TOKEN_ID, 100, 200, 1_000);
        _fundManager(locker, 100, 200);
        positionManager.accrueFees(TOKEN_ID, 100, 200);
        positionManager.configureReentry(address(locker));

        locker.collectFees();
        assertTrue(positionManager.reentryAttempted());
        assertFalse(positionManager.reentrySucceeded());
    }

    function testFeeOnTransferCurrencyRevertsAtomically() public {
        LockerFeeToken feeToken = new LockerFeeToken();
        Boardroom feeBoardroom = Boardroom(
            payable(boardroomFactory.createBoardroom(address(this), "Fee Pledge", "FPLG", keccak256("fee-board")))
        );
        LiquidityLocker feeLocker = _createLocker(feeBoardroom, address(feeToken), keccak256("fee-locker"));
        _mintPosition(feeLocker, 77, address(0), 100, 200, 1_000);
        _executeLocker(feeBoardroom, feeLocker, abi.encodeCall(feeLocker.registerPosition, (77)));

        _fundManager(feeBoardroom, feeLocker, address(feeToken), 1_000, 1_000);
        positionManager.accrueFees(77, 1_000, 1_000);
        vm.expectPartialRevert(LiquidityLocker.UnexpectedTokenTransfer.selector);
        feeLocker.collectFees();
        (,,,, uint128 fees0, uint128 fees1) = positionManager.positionState(77);
        assertEq(fees0, 1_000);
        assertEq(fees1, 1_000);
    }

    function testLifecycleGatesCollectionRegistrationAndExit() public {
        _mintAndRegister(TOKEN_ID, 500, 700, 1_000);
        _fundManager(locker, 550, 770);
        positionManager.accrueFees(TOKEN_ID, 50, 70);

        vm.expectRevert(LiquidityLocker.BoardroomExitForbidden.selector);
        _executeLocker(locker, abi.encodeCall(locker.exit, (uint128(0), uint128(0), block.timestamp)));

        boardroom.startWindDown();
        // Fee collection remains permitted during the wind-down mutation window.
        locker.collectFees();
        vm.expectRevert(LiquidityLocker.BoardroomMutationForbidden.selector);
        _executeEscrow(locker, abi.encodeCall(locker.registerPosition, (TOKEN_ID)));

        bytes memory actionsBeforeExit = positionManager.lastActions();
        assertEq(uint8(actionsBeforeExit[0]), PositionManagerActions.DECREASE_LIQUIDITY);
        _executeEscrow(locker, abi.encodeCall(locker.exit, (uint128(500), uint128(700), block.timestamp + 1)));
        assertTrue(locker.isClosed());
        assertEq(uint256(boardroom.escrowState(address(locker))), uint256(IBoardroom.EscrowState.Closed));
        assertEq(boardroom.openEscrowCount(), 0);
        bytes memory actions = positionManager.lastActions();
        assertEq(uint8(actions[0]), PositionManagerActions.BURN_POSITION);
        assertEq(uint8(actions[1]), PositionManagerActions.TAKE_PAIR);
        _assertCurrencyBalance(locker.currency0(), address(locker), 0);
        _assertCurrencyBalance(locker.currency1(), address(locker), 0);
    }

    function testExitHonorsMinimumsAndTransfersPrincipalAndUnsolicitedBalances() public {
        _mintAndRegister(TOKEN_ID, 500, 700, 1_000);
        _fundManager(locker, 500, 700);
        _fundLocker(locker, 7, 11);
        boardroom.startWindDown();

        vm.expectPartialRevert(PositionManagerMock.SlippageExceeded.selector);
        _executeEscrow(locker, abi.encodeCall(locker.exit, (uint128(501), uint128(700), block.timestamp + 1)));
        _executeEscrow(locker, abi.encodeCall(locker.exit, (uint128(500), uint128(700), block.timestamp + 1)));
        _assertCurrencyBalance(locker.currency0(), address(boardroom), 507);
        _assertCurrencyBalance(locker.currency1(), address(boardroom), 711);
    }

    function testEmptyLockerCanCloseInActiveOrWindDownAndBeReplacedAfterPrune() public {
        _executeLocker(locker, abi.encodeCall(locker.cancel, ()));
        assertTrue(locker.isClosed());
        vm.expectRevert(LiquidityLocker.LockerAlreadyClosed.selector);
        _executeLocker(locker, abi.encodeCall(locker.registerPosition, (TOKEN_ID)));
        boardroom.pruneEscrow(address(locker));

        LiquidityLocker replacement = _createLocker(boardroom, address(quote), keccak256("replacement"));
        assertEq(uint256(boardroom.escrowState(address(replacement))), uint256(IBoardroom.EscrowState.Open));
        boardroom.startWindDown();
        _executeEscrow(replacement, abi.encodeCall(replacement.cancel, ()));
        assertTrue(replacement.isClosed());
        assertEq(boardroom.openEscrowCount(), 0);
    }

    function _createLocker(Boardroom boardroom_, address quoteAsset, bytes32 salt)
        internal
        returns (LiquidityLocker created)
    {
        bytes memory result = boardroom_.execute(
            IBoardroom.Call({
                target: address(lockerFactory),
                value: 0,
                data: abi.encodeCall(lockerFactory.createLocker, (quoteAsset, uint24(3_000), int24(60), salt))
            })
        );
        created = LiquidityLocker(abi.decode(result, (address)));
    }

    function _executeLocker(LiquidityLocker locker_, bytes memory data) internal returns (bytes memory) {
        return _executeLocker(boardroom, locker_, data);
    }

    function _executeLocker(Boardroom boardroom_, LiquidityLocker locker_, bytes memory data)
        internal
        returns (bytes memory)
    {
        return boardroom_.execute(IBoardroom.Call({target: address(locker_), value: 0, data: data}));
    }

    function _executeEscrow(LiquidityLocker locker_, bytes memory data) internal returns (bytes memory) {
        return boardroom.executeEscrow(address(locker_), data);
    }

    function _mintAndRegister(uint256 tokenId_, uint128 principal0, uint128 principal1, uint128 liquidity) internal {
        _mintPosition(locker, tokenId_, address(0), principal0, principal1, liquidity);
        _executeLocker(locker, abi.encodeCall(locker.registerPosition, (tokenId_)));
    }

    function _mintPosition(
        LiquidityLocker locker_,
        uint256 tokenId_,
        address hook,
        uint128 principal0,
        uint128 principal1,
        uint128 liquidity
    ) internal {
        _mintPositionTo(address(locker_), tokenId_, _poolKey(locker_, hook), principal0, principal1, liquidity);
    }

    function _mintPositionTo(
        address owner,
        uint256 tokenId_,
        PoolKey memory key,
        uint128 principal0,
        uint128 principal1,
        uint128 liquidity
    ) internal {
        positionManager.mintDirect(owner, tokenId_, key, -120, 120, liquidity, principal0, principal1);
    }

    function _poolKey(LiquidityLocker locker_, address hook) internal view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(locker_.currency0()),
            currency1: Currency.wrap(locker_.currency1()),
            fee: 3_000,
            tickSpacing: 60,
            hooks: IHooks(hook)
        });
    }

    function _fundManager(LiquidityLocker locker_, uint256 amount0, uint256 amount1) internal {
        _fundManager(boardroom, locker_, address(quote), amount0, amount1);
    }

    function _fundManager(
        Boardroom boardroom_,
        LiquidityLocker locker_,
        address quote_,
        uint256 amount0,
        uint256 amount1
    ) internal {
        uint256 shareAmount = locker_.currency0() == boardroom_.shareToken() ? amount0 : amount1;
        uint256 quoteAmount = locker_.currency0() == quote_ ? amount0 : amount1;
        if (shareAmount != 0) boardroom_.mint(address(positionManager), shareAmount);
        if (quoteAmount != 0) LockerTestToken(quote_).mint(address(positionManager), quoteAmount);
    }

    function _fundLocker(LiquidityLocker locker_, uint256 amount0, uint256 amount1) internal {
        uint256 shareAmount = locker_.currency0() == boardroom.shareToken() ? amount0 : amount1;
        uint256 quoteAmount = locker_.currency0() == address(quote) ? amount0 : amount1;
        if (shareAmount != 0) boardroom.mint(address(locker_), shareAmount);
        if (quoteAmount != 0) quote.mint(address(locker_), quoteAmount);
    }

    function _assertCurrencyBalance(address currency, address account, uint256 expected) internal view {
        assertEq(ERC20(currency).balanceOf(account), expected);
    }
}
