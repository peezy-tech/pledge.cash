// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "solady/tokens/ERC20.sol";
import {WETH} from "solady/tokens/WETH.sol";
import {AmmFactory} from "../../src/amm/AmmFactory.sol";
import {AmmRouter} from "../../src/amm/AmmRouter.sol";
import {AssetPolicy} from "../../src/policy/AssetPolicy.sol";
import {Boardroom} from "../../src/boardroom/Boardroom.sol";
import {BoardroomFactory} from "../../src/boardroom/BoardroomFactory.sol";
import {BoardroomPolicyRegistry} from "../../src/boardroom/BoardroomPolicyRegistry.sol";
import {BoardroomToken} from "../../src/boardroom/BoardroomToken.sol";
import {IBoardroomCallPolicy} from "../../src/policy/IBoardroomCallPolicy.sol";
import {LockedLiquidity} from "../../src/liquidity/LockedLiquidity.sol";
import {LockedLiquidityFactory} from "../../src/liquidity/LockedLiquidityFactory.sol";

contract LockedLiquidityTestERC20 is ERC20 {
    string internal tokenName;
    string internal tokenSymbol;
    uint8 internal tokenDecimals;

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

contract LockedLiquidityFeeToken {
    string public name = "Fee Token";
    string public symbol = "FEE";
    uint8 public decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        uint256 fee = amount / 100;
        balanceOf[from] -= amount;
        balanceOf[to] += amount - fee;
        totalSupply -= fee;
    }
}

contract LockedLiquiditySenderSurchargeToken {
    string public name = "Sender Surcharge Token";
    string public symbol = "SST";
    uint8 public decimals = 18;
    uint256 public totalSupply;
    address public surchargedSender;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function setSurchargedSender(address sender) external {
        surchargedSender = sender;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        uint256 surcharge = from == surchargedSender ? amount / 100 : 0;
        balanceOf[from] -= amount + surcharge;
        balanceOf[to] += amount;
        totalSupply -= surcharge;
    }
}

contract LockedLiquidityPoolTransferFeeToken {
    string public name = "Pool Fee Token";
    string public symbol = "PFT";
    uint8 public decimals = 18;
    uint256 public totalSupply;
    address public taxedSender;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function setTaxedSender(address taxedSender_) external {
        taxedSender = taxedSender_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        uint256 fee = from == taxedSender ? amount / 100 : 0;
        balanceOf[from] -= amount;
        balanceOf[to] += amount - fee;
        totalSupply -= fee;
    }
}

contract LockedLiquidityTestAllowAllPolicy is IBoardroomCallPolicy {
    function canCall(address, address, address, uint256, bytes calldata) external pure returns (bool) {
        return true;
    }
}

contract LockedLiquidityTestBoardroom {
    address public immutable shareToken;
    bool public lockedLiquidityExitAllowed;

    constructor(address shareToken_) {
        shareToken = shareToken_;
    }

    function isIssuedDistribution(address) external pure returns (bool) {
        return false;
    }

    function approveToken(address token, address spender, uint256 amount) external {
        ERC20(token).approve(spender, amount);
    }

    function createLockedLiquidity(LockedLiquidityFactory factory, LockedLiquidityFactory.CreateParams calldata params)
        external
        returns (address locker, address pool, uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        return factory.createLockedLiquidity(params);
    }

    function exitLockedLiquidity(address locker) external {
        lockedLiquidityExitAllowed = true;
        LockedLiquidity(locker).exitToBoardroom(1, 1, block.timestamp);
    }
}

contract LockedLiquidityTest is Test {
    struct CreatedLocker {
        address locker;
        address pool;
        uint256 amountA;
        uint256 amountB;
        uint256 liquidity;
    }

    BoardroomPolicyRegistry internal policyRegistry;
    AssetPolicy internal assetPolicy;
    BoardroomFactory internal boardroomFactory;
    AmmFactory internal ammFactory;
    WETH internal wrappedNative;
    AmmRouter internal router;
    LockedLiquidityFactory internal lockedLiquidityFactory;
    LockedLiquidityTestERC20 internal quoteToken;

    address internal owner = address(0xA11CE);
    address internal holder = address(0xB0B);
    address internal trader = address(0xCAFE);

    uint256 internal constant SHARE_SEED = 1_000 ether;
    uint256 internal constant QUOTE_SEED = 1_000 ether;
    uint256 internal constant SEED_MINIMUM = 950 ether;
    uint256 internal constant HOLDER_SHARES = 100 ether;

    function setUp() public {
        ammFactory = new AmmFactory(address(this));
        wrappedNative = new WETH();
        policyRegistry = new BoardroomPolicyRegistry(address(this));
        assetPolicy = new AssetPolicy(address(this), address(wrappedNative));
        boardroomFactory = new BoardroomFactory(address(policyRegistry), address(wrappedNative));
        router = new AmmRouter(address(ammFactory), address(wrappedNative));
        lockedLiquidityFactory = new LockedLiquidityFactory(address(router));
        quoteToken = new LockedLiquidityTestERC20("Quote", "QUOTE", 18);

        assetPolicy.setAssetAllowed(address(quoteToken), true);
        assetPolicy.setApprovalSpenderAllowed(address(lockedLiquidityFactory), true);
        policyRegistry.setPolicyAllowed(address(assetPolicy), true);
        policyRegistry.registerModulePolicy(address(lockedLiquidityFactory));
    }

    function testBoardroomCreatesAndRecordsLockedLiquidity() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("locked-create");
        CreatedLocker memory created = _createLockedLiquidity(
            boardroom, shareToken, address(quoteToken), address(lockedLiquidityFactory), "create"
        );

        assertTrue(lockedLiquidityFactory.isLocker(created.locker));
        assertEq(lockedLiquidityFactory.lockerBoardroom(created.locker), address(boardroom));
        assertEq(lockedLiquidityFactory.lockerCountForBoardroom(address(boardroom)), 1);
        assertEq(lockedLiquidityFactory.lockerForBoardroomAt(address(boardroom), 0), created.locker);
        assertEq(lockedLiquidityFactory.lockerForBoardroomPool(address(boardroom), created.pool), created.locker);

        assertEq(boardroom.lockedLiquidityCount(), 1);
        assertEq(boardroom.lockedLiquidityAt(0), created.locker);
        assertTrue(boardroom.isLockedLiquidity(created.locker));
        assertEq(boardroom.redeemableAssetCount(), 2);
        assertTrue(boardroom.isRedeemableAsset(address(wrappedNative)));
        assertTrue(boardroom.isRedeemableAsset(address(quoteToken)));

        LockedLiquidity locker = LockedLiquidity(created.locker);
        assertEq(locker.boardroom(), address(boardroom));
        assertEq(locker.factory(), address(lockedLiquidityFactory));
        assertEq(locker.router(), address(router));
        assertEq(locker.pool(), created.pool);
        assertEq(locker.lockedLiquidity(), created.liquidity);
        assertGt(created.liquidity, 0);
        assertEq(shareToken.allowance(address(boardroom), address(lockedLiquidityFactory)), 0);
        assertEq(quoteToken.allowance(address(boardroom), address(lockedLiquidityFactory)), 0);
    }

    function testBoardroomRejectsWrapperPolicyForLockedLiquidityCreation() public {
        LockedLiquidityTestAllowAllPolicy wrapperPolicy = new LockedLiquidityTestAllowAllPolicy();
        policyRegistry.setPolicyAllowed(address(wrapperPolicy), true);

        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("locked-wrapper");

        vm.prank(owner);
        boardroom.mint(address(boardroom), SHARE_SEED);
        quoteToken.mint(address(boardroom), QUOTE_SEED);

        LockedLiquidityFactory.CreateParams memory params = LockedLiquidityFactory.CreateParams({
            tokenA: address(shareToken),
            tokenB: address(quoteToken),
            amountADesired: SHARE_SEED,
            amountBDesired: QUOTE_SEED,
            amountAMin: SEED_MINIMUM,
            amountBMin: SEED_MINIMUM,
            deadline: block.timestamp,
            salt: keccak256("wrapper")
        });

        Boardroom.Call[] memory calls = new Boardroom.Call[](3);
        calls[0] = _approvalCall(address(shareToken), SHARE_SEED);
        calls[1] = _approvalCall(address(quoteToken), QUOTE_SEED);
        calls[2] = _policyCall(
            address(wrapperPolicy),
            address(lockedLiquidityFactory),
            abi.encodeCall(LockedLiquidityFactory.createLockedLiquidity, (params))
        );

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(Boardroom.ModulePolicyRequired.selector, address(lockedLiquidityFactory))
        );
        boardroom.executeBatch(calls);
    }

    function testFactoryEnforcesFivePercentMaximumSeedSlippageOnBothTokens() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("locked-slippage-bound");
        LockedLiquidityFactory.CreateParams memory params = LockedLiquidityFactory.CreateParams({
            tokenA: address(shareToken),
            tokenB: address(quoteToken),
            amountADesired: SHARE_SEED,
            amountBDesired: QUOTE_SEED,
            amountAMin: SEED_MINIMUM - 1,
            amountBMin: SEED_MINIMUM,
            deadline: block.timestamp,
            salt: keccak256("unsafe-seed-minimum")
        });

        bytes memory data = abi.encodeCall(LockedLiquidityFactory.createLockedLiquidity, (params));
        assertFalse(lockedLiquidityFactory.canCall(address(boardroom), owner, address(lockedLiquidityFactory), 0, data));

        vm.prank(address(boardroom));
        vm.expectRevert(
            abi.encodeWithSelector(
                LockedLiquidityFactory.UnsafeLiquidityMinimums.selector,
                SEED_MINIMUM - 1,
                SEED_MINIMUM,
                SEED_MINIMUM,
                SEED_MINIMUM
            )
        );
        lockedLiquidityFactory.createLockedLiquidity(params);
    }

    function testHostilePreseededPoolRatioCannotExtractBoardroomMigrationValue() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("locked-hostile-preseed");

        vm.prank(owner);
        boardroom.mint(trader, SHARE_SEED);
        quoteToken.mint(trader, 10 ether);
        vm.startPrank(trader);
        shareToken.approve(address(router), SHARE_SEED);
        quoteToken.approve(address(router), 10 ether);
        router.addLiquidity(
            address(shareToken),
            address(quoteToken),
            SHARE_SEED,
            10 ether,
            SHARE_SEED,
            10 ether,
            trader,
            block.timestamp
        );
        vm.stopPrank();

        vm.prank(owner);
        boardroom.mint(address(boardroom), SHARE_SEED);
        quoteToken.mint(address(boardroom), QUOTE_SEED);

        LockedLiquidityFactory.CreateParams memory params = LockedLiquidityFactory.CreateParams({
            tokenA: address(shareToken),
            tokenB: address(quoteToken),
            amountADesired: SHARE_SEED,
            amountBDesired: QUOTE_SEED,
            amountAMin: SEED_MINIMUM,
            amountBMin: SEED_MINIMUM,
            deadline: block.timestamp,
            salt: keccak256("hostile-preseed-migration")
        });
        Boardroom.Call[] memory calls = new Boardroom.Call[](3);
        calls[0] = _approvalCall(address(shareToken), SHARE_SEED);
        calls[1] = _approvalCall(address(quoteToken), QUOTE_SEED);
        calls[2] = _policyCall(
            address(lockedLiquidityFactory),
            address(lockedLiquidityFactory),
            abi.encodeCall(LockedLiquidityFactory.createLockedLiquidity, (params))
        );

        vm.prank(owner);
        vm.expectRevert(AmmRouter.InsufficientAmount.selector);
        boardroom.executeBatch(calls);

        assertEq(lockedLiquidityFactory.lockerCountForBoardroom(address(boardroom)), 0);
        assertEq(shareToken.balanceOf(address(boardroom)), SHARE_SEED);
        assertEq(quoteToken.balanceOf(address(boardroom)), QUOTE_SEED);
    }

    function testWindDownRequiresLockedLiquidityExitBeforeRedemptions() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("locked-wind-down");
        CreatedLocker memory created = _createLockedLiquidity(
            boardroom, shareToken, address(quoteToken), address(lockedLiquidityFactory), "wind-down"
        );

        vm.prank(owner);
        boardroom.mint(holder, HOLDER_SHARES);

        vm.prank(owner);
        boardroom.startWindDown();

        assertTrue(boardroom.lockedLiquidityExitAllowed());

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Boardroom.LockedLiquidityStillOpen.selector, created.locker));
        boardroom.openRedemptions();

        vm.prank(owner);
        (uint256 amountA, uint256 amountB, uint256 liquidity) =
            boardroom.exitLockedLiquidity(created.locker, 1, 1, block.timestamp);

        assertGt(amountA, 0);
        assertGt(amountB, 0);
        assertEq(liquidity, created.liquidity);
        assertEq(LockedLiquidity(created.locker).lockedLiquidity(), 0);
        assertTrue(boardroom.isRedeemableAsset(address(quoteToken)));
        assertFalse(boardroom.isRedeemableAsset(address(shareToken)));
        assertEq(shareToken.balanceOf(address(boardroom)), 0);
        assertGt(quoteToken.balanceOf(address(boardroom)), 0);

        vm.prank(owner);
        boardroom.openRedemptions();

        assertEq(uint8(boardroom.status()), uint8(Boardroom.BoardroomStatus.RedemptionsOpen));
    }

    function testAnyoneCanPruneClosedLockerWithoutErasingFactoryIdentity() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("locked-permissionless-prune");
        CreatedLocker memory created = _createLockedLiquidity(
            boardroom, shareToken, address(quoteToken), address(lockedLiquidityFactory), "permissionless-prune"
        );

        vm.prank(owner);
        boardroom.startWindDown();
        vm.prank(owner);
        boardroom.exitLockedLiquidity(created.locker, 1, 1, block.timestamp);
        assertEq(lockedLiquidityFactory.lockerCountForBoardroom(address(boardroom)), 1);

        vm.prank(trader);
        uint256 pruned = lockedLiquidityFactory.pruneClosedLockers(address(boardroom));
        assertEq(pruned, 1);
        assertEq(lockedLiquidityFactory.lockerCountForBoardroom(address(boardroom)), 0);
        assertTrue(lockedLiquidityFactory.isLocker(created.locker));
        assertEq(lockedLiquidityFactory.lockerBoardroom(created.locker), address(boardroom));
        assertEq(lockedLiquidityFactory.lockerForBoardroomPool(address(boardroom), created.pool), created.locker);
    }

    function testCreationPrunesClosedLockerAndRestoresFactoryCapacity() public {
        LockedLiquidityTestERC20 mockShare = new LockedLiquidityTestERC20("Mock Share", "MSHARE", 18);
        LockedLiquidityTestBoardroom mockBoardroom = new LockedLiquidityTestBoardroom(address(mockShare));
        mockShare.mint(address(mockBoardroom), 100 ether);
        mockBoardroom.approveToken(address(mockShare), address(lockedLiquidityFactory), type(uint256).max);

        uint256 capacity = lockedLiquidityFactory.MAX_LOCKERS_PER_BOARDROOM();
        address firstLocker;
        address firstPool;
        for (uint256 i; i < capacity; ++i) {
            (address locker, address pool) = _createMockLockedLiquidity(mockBoardroom, mockShare, i);
            if (i == 0) {
                firstLocker = locker;
                firstPool = pool;
            }
        }
        assertEq(lockedLiquidityFactory.lockerCountForBoardroom(address(mockBoardroom)), capacity);

        mockBoardroom.exitLockedLiquidity(firstLocker);
        assertEq(LockedLiquidity(firstLocker).lockedLiquidity(), 0);
        assertEq(lockedLiquidityFactory.lockerCountForBoardroom(address(mockBoardroom)), capacity);

        _createMockLockedLiquidity(mockBoardroom, mockShare, capacity);
        assertEq(lockedLiquidityFactory.lockerCountForBoardroom(address(mockBoardroom)), capacity);
        assertTrue(lockedLiquidityFactory.isLocker(firstLocker));
        assertEq(lockedLiquidityFactory.lockerBoardroom(firstLocker), address(mockBoardroom));
        assertEq(lockedLiquidityFactory.lockerForBoardroomPool(address(mockBoardroom), firstPool), firstLocker);
        for (uint256 i; i < capacity; ++i) {
            assertNotEq(lockedLiquidityFactory.lockerForBoardroomAt(address(mockBoardroom), i), firstLocker);
        }
    }

    function testLaunchedWindDownCanExecuteQueuedLockedLiquidityExitSelfCall() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("locked-launched-exit");
        CreatedLocker memory created = _createLockedLiquidity(
            boardroom, shareToken, address(quoteToken), address(lockedLiquidityFactory), "launched-exit"
        );

        vm.startPrank(owner);
        boardroom.mint(holder, HOLDER_SHARES);
        boardroom.launch(1 days);
        vm.stopPrank();

        vm.prank(holder);
        boardroom.startWindDown();

        Boardroom.Call memory call_ = _policyCall(
            address(0),
            address(boardroom),
            abi.encodeCall(Boardroom.exitLockedLiquidity, (created.locker, 1, 1, block.timestamp + 2 days))
        );
        bytes32 salt = keccak256("queued-exit-locked-liquidity");

        vm.prank(owner);
        (, uint256 eta) = boardroom.queueAction(call_, salt);

        vm.warp(eta);
        vm.prank(owner);
        boardroom.executeQueuedAction(call_, salt);

        assertEq(LockedLiquidity(created.locker).lockedLiquidity(), 0);
    }

    function testBoardroomCanClaimLockedLiquidityFeesDuringWindDown() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("locked-fees");
        CreatedLocker memory created =
            _createLockedLiquidity(boardroom, shareToken, address(quoteToken), address(lockedLiquidityFactory), "fees");
        vm.roll(block.number + 1);

        quoteToken.mint(trader, 100 ether);
        vm.startPrank(trader);
        quoteToken.approve(address(router), 100 ether);
        address[] memory path = new address[](2);
        path[0] = address(quoteToken);
        path[1] = address(shareToken);
        router.swapExactTokensForTokens(100 ether, 1, path, trader, block.timestamp);
        vm.stopPrank();

        vm.prank(owner);
        boardroom.startWindDown();

        uint256 boardroomQuoteBefore = quoteToken.balanceOf(address(boardroom));
        vm.prank(owner);
        boardroom.execute(
            _policyCall(address(lockedLiquidityFactory), created.locker, abi.encodeCall(LockedLiquidity.claimFees, ()))
        );

        assertGt(quoteToken.balanceOf(address(boardroom)), boardroomQuoteBefore);
    }

    function testLockedLiquidityCreationRequiresRedeemableAssetCapacity() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("locked-capacity");

        vm.startPrank(owner);
        uint256 maxAssets = boardroom.MAX_REDEEMABLE_ASSETS();
        uint256 existingAssets = boardroom.redeemableAssetCount();
        for (uint256 i; i < maxAssets - existingAssets; ++i) {
            boardroom.registerRedeemableAsset(vm.addr(0x1000 + i));
        }
        boardroom.mint(address(boardroom), SHARE_SEED);
        vm.stopPrank();
        quoteToken.mint(address(boardroom), QUOTE_SEED);

        LockedLiquidityFactory.CreateParams memory params = LockedLiquidityFactory.CreateParams({
            tokenA: address(shareToken),
            tokenB: address(quoteToken),
            amountADesired: SHARE_SEED,
            amountBDesired: QUOTE_SEED,
            amountAMin: SEED_MINIMUM,
            amountBMin: SEED_MINIMUM,
            deadline: block.timestamp,
            salt: keccak256("capacity")
        });

        Boardroom.Call[] memory calls = new Boardroom.Call[](3);
        calls[0] = _approvalCall(address(shareToken), SHARE_SEED);
        calls[1] = _approvalCall(address(quoteToken), QUOTE_SEED);
        calls[2] = _policyCall(
            address(lockedLiquidityFactory),
            address(lockedLiquidityFactory),
            abi.encodeCall(LockedLiquidityFactory.createLockedLiquidity, (params))
        );

        vm.prank(owner);
        vm.expectRevert(Boardroom.TooManyRedeemableAssets.selector);
        boardroom.executeBatch(calls);
    }

    function testLockedLiquidityExitEnforcesActualReceivedMinAmounts() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("locked-exit-actual");
        LockedLiquidityPoolTransferFeeToken taxedQuote = new LockedLiquidityPoolTransferFeeToken();

        vm.prank(owner);
        boardroom.mint(address(boardroom), SHARE_SEED);
        taxedQuote.mint(address(boardroom), QUOTE_SEED);

        CreatedLocker memory created = _createLockedLiquidityFromBoardroomBalances(
            boardroom, shareToken, address(taxedQuote), address(lockedLiquidityFactory), "exit-actual"
        );
        taxedQuote.setTaxedSender(created.pool);

        vm.prank(owner);
        boardroom.startWindDown();

        vm.prank(owner);
        vm.expectRevert(AmmRouter.InsufficientAmount.selector);
        boardroom.exitLockedLiquidity(created.locker, 1, 999 ether, block.timestamp);

        uint256 quoteBefore = taxedQuote.balanceOf(address(boardroom));
        vm.prank(owner);
        (uint256 amountA, uint256 amountB, uint256 liquidity) =
            boardroom.exitLockedLiquidity(created.locker, 1, 989 ether, block.timestamp);

        assertGt(amountA, 0);
        assertGt(amountB, 989 ether);
        assertLt(amountB, 999 ether);
        assertEq(liquidity, created.liquidity);
        assertEq(taxedQuote.balanceOf(address(boardroom)) - quoteBefore, amountB);
        assertEq(LockedLiquidity(created.locker).lockedLiquidity(), 0);
    }

    function testLockedLiquidityPolicyRejectsPairWithoutShareToken() public {
        (Boardroom boardroom,) = _createBoardroom("locked-policy-share");
        LockedLiquidityTestERC20 otherToken = new LockedLiquidityTestERC20("Other", "OTHER", 18);

        LockedLiquidityFactory.CreateParams memory params = LockedLiquidityFactory.CreateParams({
            tokenA: address(quoteToken),
            tokenB: address(otherToken),
            amountADesired: QUOTE_SEED,
            amountBDesired: QUOTE_SEED,
            amountAMin: SEED_MINIMUM,
            amountBMin: SEED_MINIMUM,
            deadline: block.timestamp,
            salt: keccak256("without-share-token")
        });

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                Boardroom.CallNotAllowed.selector,
                address(lockedLiquidityFactory),
                address(lockedLiquidityFactory),
                LockedLiquidityFactory.createLockedLiquidity.selector
            )
        );
        boardroom.execute(
            _policyCall(
                address(lockedLiquidityFactory),
                address(lockedLiquidityFactory),
                abi.encodeCall(LockedLiquidityFactory.createLockedLiquidity, (params))
            )
        );
    }

    function testLockedLiquidityFactoryRejectsNonBoardroomCaller() public {
        (, BoardroomToken shareToken) = _createBoardroom("locked-direct-non-boardroom");

        LockedLiquidityFactory.CreateParams memory params = LockedLiquidityFactory.CreateParams({
            tokenA: address(shareToken),
            tokenB: address(quoteToken),
            amountADesired: SHARE_SEED,
            amountBDesired: QUOTE_SEED,
            amountAMin: SEED_MINIMUM,
            amountBMin: SEED_MINIMUM,
            deadline: block.timestamp,
            salt: keccak256("direct-non-boardroom")
        });

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(LockedLiquidityFactory.InvalidBoardroom.selector, owner));
        lockedLiquidityFactory.createLockedLiquidity(params);
    }

    function testLockedLiquidityFactoryRejectsFeeOnTransferSeedToken() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("locked-fee-token");
        LockedLiquidityFeeToken feeToken = new LockedLiquidityFeeToken();

        vm.prank(owner);
        boardroom.mint(address(boardroom), SHARE_SEED);
        feeToken.mint(address(boardroom), QUOTE_SEED);

        LockedLiquidityFactory.CreateParams memory params = LockedLiquidityFactory.CreateParams({
            tokenA: address(shareToken),
            tokenB: address(feeToken),
            amountADesired: SHARE_SEED,
            amountBDesired: QUOTE_SEED,
            amountAMin: SEED_MINIMUM,
            amountBMin: SEED_MINIMUM,
            deadline: block.timestamp,
            salt: keccak256("fee-token")
        });

        Boardroom.Call[] memory calls = new Boardroom.Call[](3);
        assetPolicy.setAssetAllowed(address(feeToken), true);
        calls[0] = _approvalCall(address(shareToken), SHARE_SEED);
        calls[1] = _approvalCall(address(feeToken), QUOTE_SEED);
        calls[2] = _policyCall(
            address(lockedLiquidityFactory),
            address(lockedLiquidityFactory),
            abi.encodeCall(LockedLiquidityFactory.createLockedLiquidity, (params))
        );

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                LockedLiquidityFactory.TransferAmountMismatch.selector,
                address(feeToken),
                QUOTE_SEED,
                QUOTE_SEED - (QUOTE_SEED / 100)
            )
        );
        boardroom.executeBatch(calls);
    }

    function testLockedLiquidityFactoryRejectsSenderSurchargeSeedToken() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("locked-surcharge-token");
        LockedLiquiditySenderSurchargeToken surchargeToken = new LockedLiquiditySenderSurchargeToken();

        vm.prank(owner);
        boardroom.mint(address(boardroom), SHARE_SEED);
        surchargeToken.mint(address(boardroom), 1_010 ether);
        surchargeToken.setSurchargedSender(address(boardroom));
        assetPolicy.setAssetAllowed(address(surchargeToken), true);

        LockedLiquidityFactory.CreateParams memory params = LockedLiquidityFactory.CreateParams({
            tokenA: address(shareToken),
            tokenB: address(surchargeToken),
            amountADesired: SHARE_SEED,
            amountBDesired: QUOTE_SEED,
            amountAMin: SEED_MINIMUM,
            amountBMin: SEED_MINIMUM,
            deadline: block.timestamp,
            salt: keccak256("sender-surcharge-token")
        });
        Boardroom.Call[] memory calls = new Boardroom.Call[](3);
        calls[0] = _approvalCall(address(shareToken), SHARE_SEED);
        calls[1] = _approvalCall(address(surchargeToken), QUOTE_SEED);
        calls[2] = _policyCall(
            address(lockedLiquidityFactory),
            address(lockedLiquidityFactory),
            abi.encodeCall(LockedLiquidityFactory.createLockedLiquidity, (params))
        );

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                LockedLiquidityFactory.TransferAmountMismatch.selector, address(surchargeToken), QUOTE_SEED, 1_010 ether
            )
        );
        boardroom.executeBatch(calls);

        assertEq(surchargeToken.balanceOf(address(boardroom)), 1_010 ether);
        assertEq(lockedLiquidityFactory.lockerCountForBoardroom(address(boardroom)), 0);
    }

    function _createBoardroom(string memory saltLabel)
        internal
        returns (Boardroom boardroom, BoardroomToken shareToken)
    {
        address boardroomAddress =
            boardroomFactory.createBoardroom(owner, "Locked Common", "LOCK", keccak256(bytes(saltLabel)));
        boardroom = Boardroom(payable(boardroomAddress));
        shareToken = BoardroomToken(boardroom.shareToken());
        assetPolicy.setAssetAllowed(address(shareToken), true);
    }

    function _createLockedLiquidity(
        Boardroom boardroom,
        BoardroomToken shareToken,
        address quote,
        address policy,
        string memory saltLabel
    ) internal returns (CreatedLocker memory created) {
        vm.prank(owner);
        boardroom.mint(address(boardroom), SHARE_SEED);
        quoteToken.mint(address(boardroom), QUOTE_SEED);

        created = _createLockedLiquidityFromBoardroomBalances(boardroom, shareToken, quote, policy, saltLabel);
    }

    function _createLockedLiquidityFromBoardroomBalances(
        Boardroom boardroom,
        BoardroomToken shareToken,
        address quote,
        address policy,
        string memory saltLabel
    ) internal returns (CreatedLocker memory created) {
        bytes32 salt = keccak256(bytes(saltLabel));
        address predictedLocker = lockedLiquidityFactory.predictLockedLiquidityAddress(address(boardroom), salt);
        assetPolicy.setAssetAllowed(quote, true);
        LockedLiquidityFactory.CreateParams memory params = LockedLiquidityFactory.CreateParams({
            tokenA: address(shareToken),
            tokenB: quote,
            amountADesired: SHARE_SEED,
            amountBDesired: QUOTE_SEED,
            amountAMin: SEED_MINIMUM,
            amountBMin: SEED_MINIMUM,
            deadline: block.timestamp,
            salt: salt
        });

        Boardroom.Call[] memory calls = new Boardroom.Call[](3);
        calls[0] = _approvalCall(address(shareToken), SHARE_SEED);
        calls[1] = _approvalCall(quote, QUOTE_SEED);
        calls[2] = _policyCall(
            policy,
            address(lockedLiquidityFactory),
            abi.encodeCall(LockedLiquidityFactory.createLockedLiquidity, (params))
        );

        vm.prank(owner);
        bytes[] memory results = boardroom.executeBatch(calls);
        (created.locker, created.pool, created.amountA, created.amountB, created.liquidity) =
            abi.decode(results[2], (address, address, uint256, uint256, uint256));

        assertEq(created.locker, predictedLocker);
    }

    function _createMockLockedLiquidity(
        LockedLiquidityTestBoardroom mockBoardroom,
        LockedLiquidityTestERC20 mockShare,
        uint256 index
    ) internal returns (address locker, address pool) {
        LockedLiquidityTestERC20 mockQuote = new LockedLiquidityTestERC20("Mock Quote", "MQUOTE", 18);
        mockQuote.mint(address(mockBoardroom), 2 ether);
        mockBoardroom.approveToken(address(mockQuote), address(lockedLiquidityFactory), type(uint256).max);

        LockedLiquidityFactory.CreateParams memory params = LockedLiquidityFactory.CreateParams({
            tokenA: address(mockShare),
            tokenB: address(mockQuote),
            amountADesired: 1 ether,
            amountBDesired: 1 ether,
            amountAMin: 0.95 ether,
            amountBMin: 0.95 ether,
            deadline: block.timestamp,
            salt: keccak256(abi.encode("mock-active-locker", index))
        });
        (locker, pool,,,) = mockBoardroom.createLockedLiquidity(lockedLiquidityFactory, params);
    }

    function _approvalCall(address token, uint256 amount) internal view returns (Boardroom.Call memory) {
        return _policyCall(
            address(assetPolicy),
            token,
            abi.encodeWithSignature("approve(address,uint256)", address(lockedLiquidityFactory), amount)
        );
    }

    function _policyCall(address policy, address target, bytes memory data)
        internal
        pure
        returns (Boardroom.Call memory call_)
    {
        call_ = Boardroom.Call({policy: policy, target: target, value: 0, data: data});
    }
}
