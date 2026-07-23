// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {ERC20} from "solady/tokens/ERC20.sol";
import {WETH} from "solady/tokens/WETH.sol";
import {AmmFactory} from "../../src/amm/AmmFactory.sol";
import {AmmPool} from "../../src/amm/AmmPool.sol";
import {AmmRouter} from "../../src/amm/AmmRouter.sol";
import {Boardroom} from "../../src/boardroom/Boardroom.sol";
import {BoardroomController} from "../../src/boardroom/BoardroomController.sol";
import {BoardroomControllerFactory} from "../../src/boardroom/BoardroomControllerFactory.sol";
import {BoardroomFactory} from "../../src/boardroom/BoardroomFactory.sol";
import {BoardroomGovernanceLogic} from "../../src/boardroom/BoardroomGovernanceLogic.sol";
import {BoardroomCall} from "../../src/boardroom/IBoardroomGovernance.sol";
import {BoardroomPolicyRegistry} from "../../src/boardroom/BoardroomPolicyRegistry.sol";
import {BoardroomRedemptionPayout} from "../../src/boardroom/BoardroomRedemptionPayout.sol";
import {BoardroomToken} from "../../src/boardroom/BoardroomToken.sol";
import {BoardroomAssetStorage} from "../../src/boardroom/storage/BoardroomAssetStorage.sol";
import {BoardroomLiquidityStorage} from "../../src/boardroom/storage/BoardroomLiquidityStorage.sol";
import {AssetPolicy} from "../../src/policy/AssetPolicy.sol";
import {LockedLiquidity} from "../../src/liquidity/LockedLiquidity.sol";
import {LockedLiquidityFactory} from "../../src/liquidity/LockedLiquidityFactory.sol";
import {BoardroomRewards} from "../../src/rewards/BoardroomRewards.sol";
import {BoardroomRewardsFactory} from "../../src/rewards/BoardroomRewardsFactory.sol";

contract SingletonLiquidityToken is ERC20 {
    string internal tokenName;
    string internal tokenSymbol;
    uint8 internal immutable tokenDecimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) {
        tokenName = name_;
        tokenSymbol = symbol_;
        tokenDecimals = decimals_;
    }

    function name() public view override returns (string memory) {
        return tokenName;
    }

    function symbol() public view override returns (string memory) {
        return tokenSymbol;
    }

    function decimals() public view override returns (uint8) {
        return tokenDecimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract HostileSingletonLiquidityToken is SingletonLiquidityToken {
    address public blockedSender;

    constructor() SingletonLiquidityToken("Hostile Quote", "HOSTILE", 18) {}

    function setBlockedSender(address blockedSender_) external {
        blockedSender = blockedSender_;
    }

    function _beforeTokenTransfer(address from, address, uint256) internal view override {
        if (blockedSender != address(0) && from == blockedSender) revert("hostile transfer");
    }
}

contract LockedLiquiditySingletonTest is Test {
    struct Position {
        address locker;
        address pool;
        uint256 liquidity;
    }

    BoardroomPolicyRegistry internal policyRegistry;
    AssetPolicy internal assetPolicy;
    BoardroomFactory internal boardroomFactory;
    AmmFactory internal ammFactory;
    AmmRouter internal router;
    LockedLiquidityFactory internal liquidityFactory;
    BoardroomRewardsFactory internal rewardsFactory;
    WETH internal wrappedNative;
    SingletonLiquidityToken internal quote;

    address internal owner = address(0xA11CE);
    address internal holder = address(0xB0B);
    address internal executor = address(0xCAFE);

    uint256 internal constant SHARE_SEED = 1_000 ether;
    uint256 internal constant QUOTE_SEED = 1_000 ether;
    uint256 internal constant MIN_SEED = 950 ether;

    function setUp() public {
        wrappedNative = new WETH();
        policyRegistry = new BoardroomPolicyRegistry(address(this));
        assetPolicy = new AssetPolicy(address(this), address(wrappedNative));
        boardroomFactory = new BoardroomFactory(
            address(policyRegistry),
            address(wrappedNative),
            address(new BoardroomRedemptionPayout()),
            address(new BoardroomGovernanceLogic())
        );
        ammFactory = new AmmFactory(address(this), address(boardroomFactory));
        router = new AmmRouter(address(ammFactory), address(wrappedNative));
        liquidityFactory = new LockedLiquidityFactory(address(router), address(boardroomFactory));
        rewardsFactory = new BoardroomRewardsFactory(address(boardroomFactory));
        ammFactory.setLiquidityRouter(address(router));
        ammFactory.setReservationManager(address(liquidityFactory));
        quote = new SingletonLiquidityToken("Quote", "QUOTE", 18);

        assetPolicy.setAssetAllowed(address(quote), true);
        assetPolicy.setApprovalSpenderAllowed(address(liquidityFactory), true);
        assetPolicy.setApprovalSpenderAllowed(address(rewardsFactory), true);
        policyRegistry.setPolicyAllowed(address(assetPolicy), true);
        policyRegistry.registerModulePolicy(address(liquidityFactory));
        policyRegistry.registerModulePolicy(address(rewardsFactory));
    }

    function testCreatesOneCanonicalPositionAndPermanentIdentity() public {
        (Boardroom boardroom, BoardroomToken shares) = _createBoardroom("singleton-create");
        Position memory created = _createPosition(boardroom, shares, address(quote), "singleton-create-position");

        (address locker, address pool, address quoteAsset, LockedLiquidityFactory.PositionStatus factoryStatus) =
            liquidityFactory.positionOfBoardroom(address(boardroom));
        assertEq(locker, created.locker);
        assertEq(pool, created.pool);
        assertEq(quoteAsset, address(quote));
        assertEq(uint8(factoryStatus), uint8(LockedLiquidityFactory.PositionStatus.Active));
        assertTrue(liquidityFactory.isLocker(locker));
        assertEq(liquidityFactory.lockerBoardroom(locker), address(boardroom));

        assertEq(boardroom.liquidityLocker(), locker);
        assertEq(boardroom.liquidityPool(), pool);
        assertEq(boardroom.liquidityQuoteAsset(), address(quote));
        assertEq(uint8(boardroom.liquidityStatus()), uint8(BoardroomLiquidityStorage.Status.Active));
        assertTrue(boardroom.isLockedLiquidity(locker));
        assertTrue(boardroom.isRedeemableAsset(address(quote)));
        assertTrue(boardroom.isRedeemableAsset(pool));
        assertEq(LockedLiquidity(locker).lockedLiquidity(), created.liquidity);
        assertEq(AmmPool(pool).balanceOf(locker), created.liquidity);
        assertEq(shares.allowance(address(boardroom), address(liquidityFactory)), 0);
        assertEq(quote.allowance(address(boardroom), address(liquidityFactory)), 0);
    }

    function testRepeatedAddsUseSameLockerAndPool() public {
        (Boardroom boardroom, BoardroomToken shares) = _createBoardroom("singleton-add");
        Position memory created = _createPosition(boardroom, shares, address(quote), "singleton-add-position");
        uint256 beforeLiquidity = LockedLiquidity(created.locker).lockedLiquidity();

        vm.prank(owner);
        boardroom.mint(address(boardroom), 200 ether);
        quote.mint(address(boardroom), 200 ether);
        LockedLiquidityFactory.AddParams memory params = LockedLiquidityFactory.AddParams({
            tokenA: address(shares),
            tokenB: address(quote),
            amountADesired: 200 ether,
            amountBDesired: 200 ether,
            amountAMin: 190 ether,
            amountBMin: 190 ether,
            deadline: block.timestamp
        });
        Boardroom.Call[] memory calls = new Boardroom.Call[](3);
        calls[0] = _approvalCall(address(shares), 200 ether);
        calls[1] = _approvalCall(address(quote), 200 ether);
        calls[2] = _factoryCall(abi.encodeCall(LockedLiquidityFactory.addLockedLiquidity, (params)));
        vm.prank(owner);
        boardroom.executeBatch(calls);

        assertEq(boardroom.liquidityLocker(), created.locker);
        assertEq(boardroom.liquidityPool(), created.pool);
        assertGt(LockedLiquidity(created.locker).lockedLiquidity(), beforeLiquidity);
    }

    function testZeroLpIsNotClosedAndExplicitCloseIsIrreversible() public {
        (Boardroom boardroom, BoardroomToken shares) = _createBoardroom("singleton-close");
        Position memory created = _createPosition(boardroom, shares, address(quote), "singleton-close-position");

        _removePrelaunch(boardroom, created.liquidity);
        assertEq(LockedLiquidity(created.locker).lockedLiquidity(), 0);
        assertFalse(LockedLiquidity(created.locker).isClosed());
        assertEq(uint8(boardroom.liquidityStatus()), uint8(BoardroomLiquidityStorage.Status.Active));
        assertTrue(boardroom.isLockedLiquidity(created.locker));

        vm.prank(owner);
        boardroom.execute(_factoryCall(abi.encodeCall(LockedLiquidityFactory.closeLockedLiquidity, ())));
        assertTrue(LockedLiquidity(created.locker).isClosed());
        assertEq(uint8(boardroom.liquidityStatus()), uint8(BoardroomLiquidityStorage.Status.Closed));
        assertFalse(boardroom.isLockedLiquidity(created.locker));
        assertEq(boardroom.liquidityQuoteAsset(), address(quote));
        assertEq(boardroom.liquidityLocker(), created.locker);
        assertEq(boardroom.liquidityPool(), created.pool);

        vm.prank(owner);
        boardroom.mint(address(boardroom), SHARE_SEED);
        quote.mint(address(boardroom), QUOTE_SEED);
        vm.prank(owner);
        vm.expectRevert();
        boardroom.executeBatch(_createCalls(shares, address(quote), keccak256("replacement-forbidden")));
    }

    function testCloseRequiresEmptyPositionAndNoImplicitZeroClose() public {
        (Boardroom boardroom, BoardroomToken shares) = _createBoardroom("empty-close");
        Position memory created = _createPosition(boardroom, shares, address(quote), "empty-close-position");

        vm.prank(owner);
        vm.expectRevert();
        boardroom.execute(_factoryCall(abi.encodeCall(LockedLiquidityFactory.closeLockedLiquidity, ())));
        assertEq(uint8(boardroom.liquidityStatus()), uint8(BoardroomLiquidityStorage.Status.Active));
        assertGt(LockedLiquidity(created.locker).lockedLiquidity(), 0);
    }

    function testPartialRemovalReturnsOnlyToBoardroom() public {
        (Boardroom boardroom, BoardroomToken shares) = _createBoardroom("partial-remove");
        Position memory created = _createPosition(boardroom, shares, address(quote), "partial-remove-position");
        uint256 shareBefore = shares.balanceOf(address(boardroom));
        uint256 quoteBefore = quote.balanceOf(address(boardroom));

        _removePrelaunch(boardroom, created.liquidity / 2);

        assertGt(shares.balanceOf(address(boardroom)), shareBefore);
        assertGt(quote.balanceOf(address(boardroom)), quoteBefore);
        assertEq(shares.balanceOf(owner), 0);
        assertEq(quote.balanceOf(owner), 0);
        assertGt(LockedLiquidity(created.locker).lockedLiquidity(), 0);
        assertEq(uint8(boardroom.liquidityStatus()), uint8(BoardroomLiquidityStorage.Status.Active));
    }

    function testAfterLaunchRemovalRequiresDelayedControllerGovernance() public {
        (Boardroom boardroom, BoardroomToken shares) = _createBoardroom("launched-remove");
        Position memory created = _createPosition(boardroom, shares, address(quote), "launched-remove-position");
        BoardroomController controller = _launch(boardroom, shares, owner, holder);

        LockedLiquidityFactory.RemoveParams memory params = LockedLiquidityFactory.RemoveParams({
            liquidity: created.liquidity / 2, amountAMin: 1, amountBMin: 1, deadline: block.timestamp + 2 days
        });
        BoardroomCall[] memory calls = new BoardroomCall[](1);
        calls[0] = BoardroomCall({
            policy: address(liquidityFactory),
            target: address(liquidityFactory),
            value: 0,
            data: abi.encodeCall(LockedLiquidityFactory.removeLockedLiquidity, (params))
        });

        vm.prank(owner);
        vm.expectRevert(Boardroom.BoardroomAlreadyLaunched.selector);
        boardroom.execute(_factoryCall(calls[0].data));

        vm.prank(owner);
        (bytes32 operationId, uint256 eta) =
            controller.scheduleBoardroomOperation(calls, keccak256("vetoed-remove"), 1, 1);
        vm.expectRevert();
        controller.executeBoardroomOperation(calls, keccak256("vetoed-remove"), 1, 1, owner);

        vm.prank(holder);
        boardroom.veto(operationId);
        vm.warp(eta);
        vm.expectRevert(abi.encodeWithSelector(BoardroomController.OperationNotPending.selector, operationId));
        controller.executeBoardroomOperation(calls, keccak256("vetoed-remove"), 1, 1, owner);

        vm.prank(owner);
        (, uint256 replacementEta) = controller.scheduleBoardroomOperation(calls, keccak256("delayed-remove"), 1, 1);
        vm.warp(replacementEta);
        vm.prank(executor);
        controller.executeBoardroomOperation(calls, keccak256("delayed-remove"), 1, 1, owner);
        assertEq(LockedLiquidity(created.locker).lockedLiquidity(), created.liquidity - created.liquidity / 2);
        assertGt(shares.balanceOf(address(boardroom)), 0);
        assertGt(quote.balanceOf(address(boardroom)), 0);
    }

    function testWindDownExitIsPermissionlessButSnapshotWaitsForExplicitClose() public {
        (Boardroom boardroom, BoardroomToken shares) = _createBoardroom("winddown-exit");
        Position memory created = _createPosition(boardroom, shares, address(quote), "winddown-exit-position");
        vm.prank(owner);
        boardroom.startWindDown();

        vm.warp(boardroom.windDownStartedAt() + boardroom.windDownDelay());
        vm.expectRevert(BoardroomRedemptionPayout.SnapshotNotReady.selector);
        boardroom.beginSnapshot();

        vm.prank(executor);
        (uint256 amountA, uint256 amountB, uint256 liquidity) = boardroom.exitProtocolLiquidity(1, 1, block.timestamp);
        assertGt(amountA, 0);
        assertGt(amountB, 0);
        assertEq(liquidity, created.liquidity);
        assertEq(LockedLiquidity(created.locker).lockedLiquidity(), 0);
        assertEq(uint8(boardroom.liquidityStatus()), uint8(BoardroomLiquidityStorage.Status.Active));

        vm.prank(executor);
        vm.recordLogs();
        boardroom.closeProtocolLiquidityAfterWindDown();
        Vm.Log[] memory closureLogs = vm.getRecordedLogs();
        bytes32 closureTopic = keccak256("ProtocolLiquidityPositionClosed(address,address,address)");
        bool factoryClosureEmitted;
        for (uint256 i; i < closureLogs.length; ++i) {
            if (
                closureLogs[i].emitter == address(liquidityFactory) && closureLogs[i].topics.length != 0
                    && closureLogs[i].topics[0] == closureTopic
            ) {
                factoryClosureEmitted = true;
                break;
            }
        }
        assertTrue(factoryClosureEmitted);
        assertEq(uint8(boardroom.liquidityStatus()), uint8(BoardroomLiquidityStorage.Status.Closed));
        (,,, LockedLiquidityFactory.PositionStatus factoryStatus) =
            liquidityFactory.positionOfBoardroom(address(boardroom));
        assertEq(uint8(factoryStatus), uint8(LockedLiquidityFactory.PositionStatus.Closed));
        boardroom.beginSnapshot();
        _snapshotAll(boardroom);
        boardroom.openRedemptions();
        assertEq(uint8(boardroom.status()), uint8(Boardroom.BoardroomStatus.RedemptionsOpen));
    }

    function testHostileUnderlyingPreservesLpForPermissionlessFallback() public {
        HostileSingletonLiquidityToken hostile = new HostileSingletonLiquidityToken();
        assetPolicy.setAssetAllowed(address(hostile), true);
        (Boardroom boardroom, BoardroomToken shares) = _createBoardroom("hostile-exit");
        Position memory created = _createPosition(boardroom, shares, address(hostile), "hostile-exit-position");
        hostile.setBlockedSender(created.pool);

        vm.prank(owner);
        boardroom.startWindDown();
        vm.prank(executor);
        vm.expectRevert();
        boardroom.exitProtocolLiquidity(0, 0, block.timestamp);
        assertEq(LockedLiquidity(created.locker).lockedLiquidity(), created.liquidity);
        assertEq(ERC20(created.pool).balanceOf(address(boardroom)), 0);

        vm.prank(executor);
        assertEq(boardroom.returnProtocolLiquidityAsLp(), created.liquidity);
        assertEq(ERC20(created.pool).balanceOf(address(boardroom)), created.liquidity);
        vm.prank(executor);
        boardroom.closeProtocolLiquidityAfterWindDown();

        vm.warp(boardroom.windDownStartedAt() + boardroom.windDownDelay());
        boardroom.beginSnapshot();
        _snapshotAll(boardroom);
        assertEq(
            uint8(boardroom.redeemableAssetSnapshotStatus(created.pool)),
            uint8(BoardroomAssetStorage.SnapshotStatus.Included)
        );
        boardroom.openRedemptions();
    }

    function testDirectFactoryCallAndPairWithoutShareAreRejected() public {
        (Boardroom boardroom, BoardroomToken shares) = _createBoardroom("factory-auth");
        quote.mint(address(this), QUOTE_SEED);
        SingletonLiquidityToken other = new SingletonLiquidityToken("Other", "OTHER", 18);
        other.mint(address(this), SHARE_SEED);

        LockedLiquidityFactory.CreateParams memory params =
            _params(address(shares), address(quote), keccak256("direct-factory-call"));
        shares.approve(address(liquidityFactory), SHARE_SEED);
        quote.approve(address(liquidityFactory), QUOTE_SEED);
        vm.expectRevert(abi.encodeWithSelector(LockedLiquidityFactory.InvalidBoardroom.selector, address(this)));
        liquidityFactory.createLockedLiquidity(params);

        vm.prank(owner);
        boardroom.mint(address(boardroom), SHARE_SEED);
        quote.mint(address(boardroom), QUOTE_SEED);
        other.mint(address(boardroom), SHARE_SEED);
        LockedLiquidityFactory.CreateParams memory bad =
            _params(address(quote), address(other), keccak256("pair-without-share"));
        Boardroom.Call[] memory calls = new Boardroom.Call[](3);
        calls[0] = _approvalCall(address(quote), QUOTE_SEED);
        calls[1] = _approvalCall(address(other), SHARE_SEED);
        calls[2] = _factoryCall(abi.encodeCall(LockedLiquidityFactory.createLockedLiquidity, (bad)));
        vm.prank(owner);
        vm.expectRevert();
        boardroom.executeBatch(calls);
    }

    function testFactoryRejectsInvalidBoardroomFactory() public {
        vm.expectRevert(abi.encodeWithSelector(LockedLiquidityFactory.InvalidBoardroomFactory.selector, address(0)));
        new LockedLiquidityFactory(address(router), address(0));
        vm.expectRevert(
            abi.encodeWithSelector(LockedLiquidityFactory.InvalidBoardroomFactory.selector, address(0xBEEF))
        );
        new LockedLiquidityFactory(address(router), address(0xBEEF));
    }

    function _createBoardroom(string memory label) internal returns (Boardroom boardroom, BoardroomToken shares) {
        boardroom = Boardroom(
            payable(boardroomFactory.createBoardroom(owner, "Liquidity Common", "LIQ", keccak256(bytes(label))))
        );
        shares = BoardroomToken(boardroom.shareToken());
        assetPolicy.setAssetAllowed(address(shares), true);
    }

    function _createPosition(Boardroom boardroom, BoardroomToken shares, address quoteAsset, string memory label)
        internal
        returns (Position memory position)
    {
        vm.prank(owner);
        boardroom.mint(address(boardroom), SHARE_SEED);
        SingletonLiquidityToken(quoteAsset).mint(address(boardroom), QUOTE_SEED);
        assetPolicy.setAssetAllowed(quoteAsset, true);
        bytes32 salt = keccak256(bytes(label));
        address predicted = liquidityFactory.predictLockedLiquidityAddress(address(boardroom), salt);
        vm.prank(owner);
        bytes[] memory results = boardroom.executeBatch(_createCalls(shares, quoteAsset, salt));
        (position.locker, position.pool,,, position.liquidity) =
            abi.decode(results[2], (address, address, uint256, uint256, uint256));
        assertEq(position.locker, predicted);
    }

    function _createCalls(BoardroomToken shares, address quoteAsset, bytes32 salt)
        internal
        view
        returns (Boardroom.Call[] memory calls)
    {
        calls = new Boardroom.Call[](3);
        calls[0] = _approvalCall(address(shares), SHARE_SEED);
        calls[1] = _approvalCall(quoteAsset, QUOTE_SEED);
        calls[2] = _factoryCall(
            abi.encodeCall(LockedLiquidityFactory.createLockedLiquidity, (_params(address(shares), quoteAsset, salt)))
        );
    }

    function _params(address tokenA, address tokenB, bytes32 salt)
        internal
        view
        returns (LockedLiquidityFactory.CreateParams memory params)
    {
        params = LockedLiquidityFactory.CreateParams({
            tokenA: tokenA,
            tokenB: tokenB,
            amountADesired: SHARE_SEED,
            amountBDesired: QUOTE_SEED,
            amountAMin: MIN_SEED,
            amountBMin: MIN_SEED,
            deadline: block.timestamp,
            salt: salt
        });
    }

    function _removePrelaunch(Boardroom boardroom, uint256 liquidity) internal {
        LockedLiquidityFactory.RemoveParams memory params = LockedLiquidityFactory.RemoveParams({
            liquidity: liquidity, amountAMin: 1, amountBMin: 1, deadline: block.timestamp
        });
        vm.prank(owner);
        boardroom.execute(_factoryCall(abi.encodeCall(LockedLiquidityFactory.removeLockedLiquidity, (params))));
    }

    function _launch(Boardroom boardroom, BoardroomToken shares, address proposer, address protection)
        internal
        returns (BoardroomController controller)
    {
        vm.prank(owner);
        boardroom.mint(protection, 100 ether);
        vm.prank(owner);
        bytes memory output = boardroom.execute(
            Boardroom.Call({
                policy: address(rewardsFactory),
                target: address(rewardsFactory),
                value: 0,
                data: abi.encodeCall(rewardsFactory.createRewards, (uint64(1 days), keccak256("liquidity-rewards")))
            })
        );
        BoardroomRewards rewards = BoardroomRewards(abi.decode(output, (address)));
        vm.prank(protection);
        rewards.stake(100 ether);
        vm.roll(block.number + 1);

        BoardroomControllerFactory controllerFactory = BoardroomControllerFactory(boardroomFactory.controllerFactory());
        address predicted = controllerFactory.predictControllerAddress(address(boardroom), 1);
        Boardroom.LaunchConfig memory config = Boardroom.LaunchConfig({
            proposer: proposer,
            predictedController: predicted,
            protectionStaker: protection,
            expectedRewardPool: address(rewards),
            expectedRedemptionExcessRecipient: owner,
            controllerDelay: 1 days,
            windDownDelay: 1 days,
            gracePeriod: 1 days,
            generation: 1
        });
        vm.prank(owner);
        boardroom.launch(config);
        assertEq(shares.balanceOf(protection), 100 ether);
        controller = BoardroomController(predicted);
    }

    function _snapshotAll(Boardroom boardroom) internal {
        uint256 count = boardroom.redeemableAssetCount();
        for (uint256 cursor; cursor < count; cursor += boardroom.MAX_SNAPSHOT_PAGE()) {
            uint256 remaining = count - cursor;
            boardroom.snapshotAssets(
                remaining > boardroom.MAX_SNAPSHOT_PAGE() ? boardroom.MAX_SNAPSHOT_PAGE() : remaining
            );
        }
    }

    function _approvalCall(address token, uint256 amount) internal view returns (Boardroom.Call memory call_) {
        call_ = Boardroom.Call({
            policy: address(assetPolicy),
            target: token,
            value: 0,
            data: abi.encodeWithSignature("approve(address,uint256)", address(liquidityFactory), amount)
        });
    }

    function _factoryCall(bytes memory data) internal view returns (Boardroom.Call memory call_) {
        call_ = Boardroom.Call({
            policy: address(liquidityFactory), target: address(liquidityFactory), value: 0, data: data
        });
    }
}
