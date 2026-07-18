// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "solady/tokens/ERC20.sol";
import {WETH} from "solady/tokens/WETH.sol";
import {AmmFactory} from "../../src/amm/AmmFactory.sol";
import {AmmPool} from "../../src/amm/AmmPool.sol";
import {AmmRouter} from "../../src/amm/AmmRouter.sol";
import {AssetPolicy} from "../../src/policy/AssetPolicy.sol";
import {Boardroom} from "../../src/boardroom/Boardroom.sol";
import {BoardroomFactory} from "../../src/boardroom/BoardroomFactory.sol";
import {BoardroomGovernanceLogic} from "../../src/boardroom/BoardroomGovernanceLogic.sol";
import {BoardroomPolicyRegistry} from "../../src/boardroom/BoardroomPolicyRegistry.sol";
import {BoardroomRedemptionPayout} from "../../src/boardroom/BoardroomRedemptionPayout.sol";
import {BoardroomToken} from "../../src/boardroom/BoardroomToken.sol";
import {IBoardroomCallPolicy} from "../../src/policy/IBoardroomCallPolicy.sol";
import {LockedLiquidity} from "../../src/liquidity/LockedLiquidity.sol";
import {LockedLiquidityFactory} from "../../src/liquidity/LockedLiquidityFactory.sol";
import {BoardroomRewards} from "../../src/rewards/BoardroomRewards.sol";
import {BoardroomRewardsFactory} from "../../src/rewards/BoardroomRewardsFactory.sol";

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

contract LockedLiquidityTogglePoolToken is LockedLiquidityTestERC20 {
    address public blockedSender;
    bool public unreadable;

    error TransferBlocked();

    constructor() LockedLiquidityTestERC20("Toggle Pool Token", "TPT", 18) {}

    function setBlockedSender(address sender) external {
        blockedSender = sender;
    }

    function setUnreadable(bool unreadable_) external {
        unreadable = unreadable_;
    }

    function balanceOf(address account) public view override returns (uint256) {
        if (unreadable) revert TransferBlocked();
        return super.balanceOf(account);
    }

    function _beforeTokenTransfer(address from, address, uint256) internal view override {
        if (blockedSender != address(0) && from == blockedSender) revert TransferBlocked();
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
    bool public suppressTaxedSenderTransfer;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function setTaxedSender(address taxedSender_) external {
        taxedSender = taxedSender_;
    }

    function setSuppressTaxedSenderTransfer(bool suppress) external {
        suppressTaxedSenderTransfer = suppress;
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
        if (from == taxedSender && suppressTaxedSenderTransfer) return;
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

contract LockedLiquidityTestCanonicalFactory {
    mapping(address => bool) public isBoardroom;
    mapping(address => bool) public isShareToken;

    function setBoardroom(address boardroom, bool canonical) external {
        isBoardroom[boardroom] = canonical;
    }

    function setShareToken(address token, bool canonical) external {
        isShareToken[token] = canonical;
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

contract LockedLiquidityCanonicalTestBoardroom {
    address public immutable shareToken;
    bool public lockedLiquidityExitAllowed;

    constructor() {
        shareToken = address(new BoardroomToken(address(this), "Canonical Test Share", "CTSHARE"));
    }

    function isIssuedDistribution(address) external pure returns (bool) {
        return false;
    }

    function mintShares(uint256 amount) external {
        BoardroomToken(shareToken).mint(address(this), amount);
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
    BoardroomRewardsFactory internal rewardsFactory;
    LockedLiquidityTestERC20 internal quoteToken;

    address internal owner = address(0xA11CE);
    address internal holder = address(0xB0B);
    address internal trader = address(0xCAFE);

    uint256 internal constant SHARE_SEED = 1_000 ether;
    uint256 internal constant QUOTE_SEED = 1_000 ether;
    uint256 internal constant SEED_MINIMUM = 950 ether;
    uint256 internal constant HOLDER_SHARES = 100 ether;

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
        lockedLiquidityFactory = new LockedLiquidityFactory(address(router), address(boardroomFactory));
        rewardsFactory = new BoardroomRewardsFactory(address(boardroomFactory));
        ammFactory.setLiquidityRouter(address(router));
        ammFactory.setReservationManager(address(lockedLiquidityFactory));
        quoteToken = new LockedLiquidityTestERC20("Quote", "QUOTE", 18);

        assetPolicy.setAssetAllowed(address(quoteToken), true);
        assetPolicy.setApprovalSpenderAllowed(address(lockedLiquidityFactory), true);
        assetPolicy.setApprovalSpenderAllowed(address(rewardsFactory), true);
        policyRegistry.setPolicyAllowed(address(assetPolicy), true);
        policyRegistry.registerModulePolicy(address(lockedLiquidityFactory));
        policyRegistry.registerModulePolicy(address(rewardsFactory));
    }

    function testBoardroomCreatesAndRecordsLockedLiquidity() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("locked-create");
        CreatedLocker memory created = _createLockedLiquidity(
            boardroom, shareToken, address(quoteToken), address(lockedLiquidityFactory), "create"
        );

        assertTrue(lockedLiquidityFactory.isLocker(created.locker));
        assertTrue(boardroomFactory.isShareToken(address(shareToken)));
        assertEq(lockedLiquidityFactory.lockerBoardroom(created.locker), address(boardroom));
        assertEq(lockedLiquidityFactory.lockerCountForBoardroom(address(boardroom)), 1);
        assertEq(lockedLiquidityFactory.lockerForBoardroomAt(address(boardroom), 0), created.locker);
        assertEq(lockedLiquidityFactory.lockerForBoardroomPool(address(boardroom), created.pool), created.locker);

        assertEq(boardroom.lockedLiquidityCount(), 1);
        assertEq(boardroom.lockedLiquidityAt(0), created.locker);
        assertTrue(boardroom.isLockedLiquidity(created.locker));
        assertEq(boardroom.redeemableAssetCount(), 3);
        assertTrue(boardroom.isRedeemableAsset(address(wrappedNative)));
        assertTrue(boardroom.isRedeemableAsset(address(quoteToken)));
        assertTrue(boardroom.isRedeemableAsset(created.pool));

        LockedLiquidity locker = LockedLiquidity(created.locker);
        assertEq(locker.boardroom(), address(boardroom));
        assertEq(locker.factory(), address(lockedLiquidityFactory));
        assertEq(locker.router(), address(router));
        assertEq(locker.pool(), created.pool);
        assertEq(locker.lockedLiquidity(), created.liquidity);
        assertGt(created.liquidity, 0);
        assertEq(AmmPool(created.pool).totalSupply(), created.liquidity);
        assertEq(AmmPool(created.pool).balanceOf(address(1)), 0);
        assertEq(shareToken.allowance(address(boardroom), address(lockedLiquidityFactory)), 0);
        assertEq(quoteToken.allowance(address(boardroom), address(lockedLiquidityFactory)), 0);
        assertTrue(shareToken.isEncumberedAccount(created.pool));
        assertTrue(shareToken.isEncumberedAccount(AmmPool(created.pool).poolFees()));
        assertEq(
            shareToken.encumberedSupply(),
            shareToken.balanceOf(created.pool) + shareToken.balanceOf(AmmPool(created.pool).poolFees())
        );
        assertEq(shareToken.governanceEligibleSupply(), 0);
    }

    function testExecutorLossWindDownExcludesCanonicalLockedPoolInventory() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("locked-executor-loss");

        vm.prank(owner);
        boardroom.mint(holder, HOLDER_SHARES);
        CreatedLocker memory created = _createLockedLiquidity(
            boardroom, shareToken, address(quoteToken), address(lockedLiquidityFactory), "locked-executor-loss-create"
        );

        vm.startPrank(owner);
        BoardroomRewards rewards = _createRewardPool(boardroom);
        vm.stopPrank();
        vm.prank(holder);
        rewards.stake(HOLDER_SHARES);
        vm.startPrank(owner);
        boardroom.setExecutor(address(0xDEAD));
        boardroom.launch(1 days);
        vm.stopPrank();
        vm.roll(block.number + 1);

        assertTrue(shareToken.isEncumberedAccount(created.pool));
        assertEq(shareToken.encumberedSupply(), SHARE_SEED);
        assertEq(shareToken.governanceEligibleSupply(), HOLDER_SHARES);

        vm.prank(holder);
        boardroom.startWindDown();

        assertEq(uint8(boardroom.status()), uint8(Boardroom.BoardroomStatus.WindingDown));
    }

    function testLockedPoolTradesMoveSharesAcrossGovernanceEligibilityBoundary() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("locked-trade-accounting");
        CreatedLocker memory created = _createLockedLiquidity(
            boardroom, shareToken, address(quoteToken), address(lockedLiquidityFactory), "locked-trade-create"
        );

        quoteToken.mint(trader, 100 ether);
        address[] memory buyPath = new address[](2);
        buyPath[0] = address(quoteToken);
        buyPath[1] = address(shareToken);

        vm.startPrank(trader);
        quoteToken.approve(address(router), 100 ether);
        uint256[] memory buyAmounts = router.swapExactTokensForTokens(100 ether, 1, buyPath, trader, block.timestamp);
        vm.stopPrank();

        uint256 boughtShares = buyAmounts[1];
        assertEq(shareToken.balanceOf(trader), boughtShares);
        assertEq(shareToken.encumberedSupply(), SHARE_SEED - boughtShares);
        assertEq(shareToken.governanceEligibleSupply(), boughtShares);
        assertEq(
            shareToken.encumberedSupply(),
            shareToken.balanceOf(created.pool) + shareToken.balanceOf(AmmPool(created.pool).poolFees())
        );

        uint256 soldShares = boughtShares / 2;
        address[] memory sellPath = new address[](2);
        sellPath[0] = address(shareToken);
        sellPath[1] = address(quoteToken);

        vm.startPrank(trader);
        shareToken.approve(address(router), soldShares);
        router.swapExactTokensForTokens(soldShares, 1, sellPath, trader, block.timestamp);
        vm.stopPrank();

        assertEq(shareToken.balanceOf(trader), boughtShares - soldShares);
        assertEq(shareToken.encumberedSupply(), SHARE_SEED - boughtShares + soldShares);
        assertEq(shareToken.governanceEligibleSupply(), boughtShares - soldShares);
        assertEq(
            shareToken.encumberedSupply(),
            shareToken.balanceOf(created.pool) + shareToken.balanceOf(AmmPool(created.pool).poolFees())
        );
    }

    function testQueuedLockerCreationSeedsPubliclyPrecreatedEmptyPool() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("queued-precreated-pool");
        bytes32 lockerSalt = keccak256("queued-precreated-locker");
        address predictedLocker = lockedLiquidityFactory.predictLockedLiquidityAddress(address(boardroom), lockerSalt);

        vm.startPrank(owner);
        boardroom.mint(address(boardroom), SHARE_SEED);
        boardroom.mint(owner, 1 ether);
        boardroom.launch(1 days);
        vm.stopPrank();
        quoteToken.mint(address(boardroom), QUOTE_SEED);

        LockedLiquidityFactory.CreateParams memory params = LockedLiquidityFactory.CreateParams({
            tokenA: address(shareToken),
            tokenB: address(quoteToken),
            amountADesired: SHARE_SEED,
            amountBDesired: QUOTE_SEED,
            amountAMin: SEED_MINIMUM,
            amountBMin: SEED_MINIMUM,
            deadline: block.timestamp + 2 days,
            salt: lockerSalt
        });
        Boardroom.Call[] memory calls = new Boardroom.Call[](3);
        calls[0] = _approvalCall(address(shareToken), SHARE_SEED);
        calls[1] = _approvalCall(address(quoteToken), QUOTE_SEED);
        calls[2] = _policyCall(
            address(lockedLiquidityFactory),
            address(lockedLiquidityFactory),
            abi.encodeCall(LockedLiquidityFactory.createLockedLiquidity, (params))
        );

        bytes32 actionSalt = keccak256("queued-precreated-action");
        vm.prank(owner);
        (, uint256 eta) = boardroom.queueBatch(calls, actionSalt);

        address precreatedPool = ammFactory.createPool(address(shareToken), address(quoteToken));
        assertEq(AmmPool(precreatedPool).totalSupply(), 0);

        vm.warp(eta);
        vm.prank(trader);
        bytes[] memory results = boardroom.executeQueuedBatch(calls, actionSalt);
        (address locker, address pool,,, uint256 liquidity) =
            abi.decode(results[2], (address, address, uint256, uint256, uint256));

        assertEq(locker, predictedLocker);
        assertEq(pool, precreatedPool);
        assertGt(liquidity, 0);
        assertEq(AmmPool(pool).balanceOf(locker), liquidity);
        assertEq(AmmPool(pool).balanceOf(address(1)), 0);
        assertEq(AmmPool(pool).totalSupply(), liquidity);
        _assertNoInitialLiquidityReservation(address(shareToken), address(quoteToken));
    }

    function testLockedLiquidityFactoryRejectsInvalidBoardroomFactory() public {
        vm.expectRevert(abi.encodeWithSelector(LockedLiquidityFactory.InvalidBoardroomFactory.selector, address(0)));
        new LockedLiquidityFactory(address(router), address(0));

        address nonContract = address(0xBEEF);
        vm.expectRevert(abi.encodeWithSelector(LockedLiquidityFactory.InvalidBoardroomFactory.selector, nonContract));
        new LockedLiquidityFactory(address(router), nonContract);
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

    function testPublicCannotPreseedCanonicalBoardroomPoolBeforeLockerCreation() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("locked-hostile-preseed");
        address pool = ammFactory.createPool(address(shareToken), address(quoteToken));

        vm.prank(owner);
        boardroom.mint(trader, SHARE_SEED);
        quoteToken.mint(trader, 10 ether);
        vm.startPrank(trader);
        shareToken.approve(address(router), SHARE_SEED);
        quoteToken.approve(address(router), 10 ether);
        vm.expectRevert(abi.encodeWithSelector(AmmFactory.InitialLiquidityReservationRequired.selector, pool));
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
        bytes[] memory results = boardroom.executeBatch(calls);
        (address locker, address seededPool,,, uint256 liquidity) =
            abi.decode(results[2], (address, address, uint256, uint256, uint256));

        assertEq(seededPool, pool);
        assertEq(lockedLiquidityFactory.lockerCountForBoardroom(address(boardroom)), 1);
        assertEq(AmmPool(pool).balanceOf(locker), liquidity);
        assertEq(AmmPool(pool).balanceOf(address(1)), 0);
        assertEq(shareToken.balanceOf(address(boardroom)), 0);
        assertEq(quoteToken.balanceOf(address(boardroom)), 0);
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
        assertEq(AmmPool(created.pool).totalSupply(), 0);
        assertEq(AmmPool(created.pool).balanceOf(address(1)), 0);
        assertEq(shareToken.balanceOf(created.pool), 0);
        assertEq(quoteToken.balanceOf(created.pool), 0);
        (uint112 reserve0, uint112 reserve1,) = AmmPool(created.pool).getReserves();
        assertEq(reserve0, 0);
        assertEq(reserve1, 0);
        assertTrue(boardroom.isRedeemableAsset(address(quoteToken)));
        assertFalse(boardroom.isRedeemableAsset(address(shareToken)));
        assertFalse(boardroom.isRedeemableAsset(created.pool));
        assertEq(shareToken.balanceOf(address(boardroom)), 0);
        assertGt(quoteToken.balanceOf(address(boardroom)), 0);
        assertEq(
            shareToken.encumberedSupply(),
            shareToken.balanceOf(created.pool) + shareToken.balanceOf(AmmPool(created.pool).poolFees())
        );
        assertEq(shareToken.governanceEligibleSupply(), HOLDER_SHARES);

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
        LockedLiquidityTestCanonicalFactory testCanonicalFactory = new LockedLiquidityTestCanonicalFactory();
        ammFactory = new AmmFactory(address(this), address(testCanonicalFactory));
        router = new AmmRouter(address(ammFactory), address(wrappedNative));
        lockedLiquidityFactory = new LockedLiquidityFactory(address(router), address(testCanonicalFactory));
        ammFactory.setLiquidityRouter(address(router));
        ammFactory.setReservationManager(address(lockedLiquidityFactory));

        LockedLiquidityCanonicalTestBoardroom mockBoardroom = new LockedLiquidityCanonicalTestBoardroom();
        BoardroomToken mockShare = BoardroomToken(mockBoardroom.shareToken());
        testCanonicalFactory.setBoardroom(address(mockBoardroom), true);
        testCanonicalFactory.setShareToken(address(mockShare), true);
        mockBoardroom.mintShares(100 ether);
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

    function testLaunchedWindDownCanPermissionlesslyExitLockedLiquidity() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("locked-launched-exit");
        CreatedLocker memory created = _createLockedLiquidity(
            boardroom, shareToken, address(quoteToken), address(lockedLiquidityFactory), "launched-exit"
        );

        vm.startPrank(owner);
        boardroom.mint(holder, 2 * HOLDER_SHARES);
        BoardroomRewards rewards = _createRewardPool(boardroom);
        vm.stopPrank();
        vm.prank(holder);
        rewards.stake(2 * HOLDER_SHARES);
        vm.startPrank(owner);
        boardroom.launch(1 days);
        vm.stopPrank();
        vm.roll(block.number + 1);

        vm.prank(holder);
        boardroom.startWindDown();

        vm.prank(trader);
        boardroom.exitLockedLiquidity(created.locker, 1, 1, block.timestamp + 2 days);

        assertEq(LockedLiquidity(created.locker).lockedLiquidity(), 0);
    }

    function testTerminalExitUsesCanonicalMinimumsInsteadOfCallerSuppliedFailure() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("locked-terminal-canonical-exit");
        CreatedLocker memory created = _createLockedLiquidity(
            boardroom, shareToken, address(quoteToken), address(lockedLiquidityFactory), "terminal-canonical-exit"
        );

        vm.startPrank(owner);
        boardroom.mint(holder, 2 * HOLDER_SHARES);
        BoardroomRewards rewards = _createRewardPool(boardroom);
        vm.stopPrank();
        vm.prank(holder);
        rewards.stake(2 * HOLDER_SHARES);
        vm.startPrank(owner);
        boardroom.launch(1 days);
        vm.stopPrank();
        vm.roll(block.number + 1);
        vm.prank(holder);
        boardroom.startWindDown();
        vm.warp(block.timestamp + 1 days);

        vm.prank(trader);
        (uint256 amountA, uint256 amountB, uint256 liquidity) =
            boardroom.exitLockedLiquidity(created.locker, type(uint256).max, type(uint256).max, 0);

        assertGt(amountA, 0);
        assertGt(amountB, 0);
        assertEq(liquidity, created.liquidity);
        assertEq(LockedLiquidity(created.locker).lockedLiquidity(), 0);
        assertFalse(boardroom.isRedeemableAsset(created.pool));
    }

    function testHostileUnderlyingReturnsPinnedLpAfterGovernanceDelay() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("locked-terminal-lp-fallback");
        LockedLiquidityTogglePoolToken hostileQuote = new LockedLiquidityTogglePoolToken();

        vm.prank(owner);
        boardroom.mint(address(boardroom), SHARE_SEED);
        hostileQuote.mint(address(boardroom), QUOTE_SEED);
        CreatedLocker memory created = _createLockedLiquidityFromBoardroomBalances(
            boardroom, shareToken, address(hostileQuote), address(lockedLiquidityFactory), "terminal-lp-fallback"
        );

        vm.startPrank(owner);
        boardroom.mint(holder, 2 * HOLDER_SHARES);
        BoardroomRewards rewards = _createRewardPool(boardroom);
        vm.stopPrank();
        vm.prank(holder);
        rewards.stake(2 * HOLDER_SHARES);
        vm.startPrank(owner);
        boardroom.launch(1 days);
        vm.stopPrank();
        vm.roll(block.number + 1);
        vm.prank(holder);
        boardroom.startWindDown();
        rewards.terminalize();
        hostileQuote.setBlockedSender(created.pool);

        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(Boardroom.RedeemableAssetReserved.selector, created.pool));
        boardroom.removeRedeemableAsset(created.pool);

        vm.prank(trader);
        vm.expectRevert();
        boardroom.exitLockedLiquidity(created.locker, 0, 0, block.timestamp);
        assertEq(LockedLiquidity(created.locker).lockedLiquidity(), created.liquidity);
        assertEq(ERC20(created.pool).balanceOf(address(boardroom)), 0);

        vm.warp(block.timestamp + 1 days);
        vm.prank(trader);
        (uint256 amountA, uint256 amountB, uint256 liquidity) =
            boardroom.exitLockedLiquidity(created.locker, type(uint256).max, type(uint256).max, 0);

        assertEq(amountA, 0);
        assertEq(amountB, 0);
        assertEq(liquidity, created.liquidity);
        assertEq(LockedLiquidity(created.locker).lockedLiquidity(), 0);
        assertEq(ERC20(created.pool).balanceOf(address(boardroom)), created.liquidity);
        assertTrue(boardroom.isRedeemableAsset(created.pool));
        assertFalse(boardroom.isLockedLiquidity(created.locker));

        vm.prank(trader);
        boardroom.openRedemptions();
        assertEq(uint8(boardroom.status()), uint8(Boardroom.BoardroomStatus.RedemptionsOpen));

        address[] memory assets = boardroom.getRedeemableAssets();
        uint256 poolAssetIndex;
        for (uint256 i; i < assets.length; ++i) {
            if (assets[i] == created.pool) poolAssetIndex = i;
        }
        uint256[] memory minimums = new uint256[](assets.length);
        vm.prank(holder);
        uint256[] memory amounts = boardroom.redeem(2 * HOLDER_SHARES, holder, minimums);
        assertGt(amounts[poolAssetIndex], 0);
        assertEq(ERC20(created.pool).balanceOf(holder), amounts[poolAssetIndex]);
    }

    function testUnreadableUnderlyingIsQuarantinedDuringTerminalLpFallback() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("locked-unreadable-lp-fallback");
        LockedLiquidityTogglePoolToken unreadableQuote = new LockedLiquidityTogglePoolToken();

        vm.prank(owner);
        boardroom.mint(address(boardroom), SHARE_SEED);
        unreadableQuote.mint(address(boardroom), QUOTE_SEED);
        CreatedLocker memory created = _createLockedLiquidityFromBoardroomBalances(
            boardroom, shareToken, address(unreadableQuote), address(lockedLiquidityFactory), "unreadable-lp-fallback"
        );

        vm.prank(owner);
        boardroom.startWindDown();
        unreadableQuote.setUnreadable(true);
        vm.warp(block.timestamp + 1 days);

        vm.prank(trader);
        boardroom.exitLockedLiquidity(created.locker, 0, 0, block.timestamp);

        assertFalse(boardroom.isRedeemableAsset(address(unreadableQuote)));
        assertTrue(boardroom.isRedeemableAsset(created.pool));
        assertEq(ERC20(created.pool).balanceOf(address(boardroom)), created.liquidity);

        vm.prank(trader);
        boardroom.openRedemptions();
        assertEq(uint8(boardroom.status()), uint8(Boardroom.BoardroomStatus.RedemptionsOpen));
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
            LockedLiquidityTestERC20 filler = new LockedLiquidityTestERC20("Filler", "FILL", 18);
            boardroom.registerRedeemableAsset(address(filler));
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

    function testPartialUnderlyingTransferPreservesLpAndUsesTerminalFallback() public {
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
        boardroom.exitLockedLiquidity(created.locker, 0, 0, block.timestamp);
        assertEq(LockedLiquidity(created.locker).lockedLiquidity(), created.liquidity);
        assertEq(ERC20(created.pool).balanceOf(address(boardroom)), 0);

        vm.warp(block.timestamp + 1 days);
        vm.prank(owner);
        (uint256 amountA, uint256 amountB, uint256 liquidity) =
            boardroom.exitLockedLiquidity(created.locker, 0, 0, block.timestamp);

        assertEq(amountA, 0);
        assertEq(amountB, 0);
        assertEq(liquidity, created.liquidity);
        assertEq(LockedLiquidity(created.locker).lockedLiquidity(), 0);
        assertEq(ERC20(created.pool).balanceOf(address(boardroom)), created.liquidity);
        assertTrue(boardroom.isRedeemableAsset(created.pool));
    }

    function testNoOpUnderlyingTransferPreservesLpAndUsesTerminalFallback() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("locked-exit-no-op-transfer");
        LockedLiquidityPoolTransferFeeToken noOpQuote = new LockedLiquidityPoolTransferFeeToken();

        vm.prank(owner);
        boardroom.mint(address(boardroom), SHARE_SEED);
        noOpQuote.mint(address(boardroom), QUOTE_SEED);
        CreatedLocker memory created = _createLockedLiquidityFromBoardroomBalances(
            boardroom, shareToken, address(noOpQuote), address(lockedLiquidityFactory), "exit-no-op-transfer"
        );
        noOpQuote.setTaxedSender(created.pool);
        noOpQuote.setSuppressTaxedSenderTransfer(true);

        vm.prank(owner);
        boardroom.startWindDown();

        vm.prank(owner);
        vm.expectRevert(AmmRouter.InsufficientAmount.selector);
        boardroom.exitLockedLiquidity(created.locker, 0, 0, block.timestamp);
        assertEq(LockedLiquidity(created.locker).lockedLiquidity(), created.liquidity);
        assertEq(ERC20(created.pool).balanceOf(address(boardroom)), 0);

        vm.warp(block.timestamp + 1 days);
        vm.prank(owner);
        (uint256 amountA, uint256 amountB, uint256 liquidity) =
            boardroom.exitLockedLiquidity(created.locker, 0, 0, block.timestamp);

        assertEq(amountA, 0);
        assertEq(amountB, 0);
        assertEq(liquidity, created.liquidity);
        assertEq(LockedLiquidity(created.locker).lockedLiquidity(), 0);
        assertEq(ERC20(created.pool).balanceOf(address(boardroom)), created.liquidity);
        assertTrue(boardroom.isRedeemableAsset(created.pool));
    }

    function testInexactLockerFeeForwardPreservesEntitlementAndUsesTerminalFallback() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("locked-fee-forward-fallback");
        LockedLiquidityPoolTransferFeeToken mutableQuote = new LockedLiquidityPoolTransferFeeToken();

        vm.prank(owner);
        boardroom.mint(address(boardroom), SHARE_SEED);
        mutableQuote.mint(address(boardroom), QUOTE_SEED);
        CreatedLocker memory created = _createLockedLiquidityFromBoardroomBalances(
            boardroom, shareToken, address(mutableQuote), address(lockedLiquidityFactory), "fee-forward-fallback"
        );

        mutableQuote.mint(trader, 100 ether);
        vm.roll(block.number + 1);
        vm.startPrank(trader);
        mutableQuote.approve(address(router), 100 ether);
        address[] memory path = new address[](2);
        path[0] = address(mutableQuote);
        path[1] = address(shareToken);
        router.swapExactTokensForTokens(100 ether, 1, path, trader, block.timestamp);
        vm.stopPrank();

        address feeVault = AmmPool(created.pool).poolFees();
        uint256 feeBalance = mutableQuote.balanceOf(feeVault);
        assertGt(feeBalance, 0);
        mutableQuote.setTaxedSender(created.locker);
        mutableQuote.setSuppressTaxedSenderTransfer(true);

        vm.prank(owner);
        boardroom.startWindDown();
        vm.prank(owner);
        vm.expectPartialRevert(LockedLiquidity.UnexpectedTokenTransfer.selector);
        boardroom.exitLockedLiquidity(created.locker, 0, 0, block.timestamp);
        assertEq(mutableQuote.balanceOf(feeVault), feeBalance);
        assertEq(LockedLiquidity(created.locker).lockedLiquidity(), created.liquidity);

        vm.warp(block.timestamp + 1 days);
        vm.prank(trader);
        boardroom.exitLockedLiquidity(created.locker, 0, 0, block.timestamp);

        assertEq(mutableQuote.balanceOf(feeVault), feeBalance);
        assertEq(LockedLiquidity(created.locker).lockedLiquidity(), 0);
        assertEq(ERC20(created.pool).balanceOf(address(boardroom)), created.liquidity);
        assertGt(
            AmmPool(created.pool).pendingClaimable0(address(boardroom))
                + AmmPool(created.pool).pendingClaimable1(address(boardroom)),
            0
        );

        vm.prank(trader);
        boardroom.openRedemptions();
        address[] memory assets = boardroom.getRedeemableAssets();
        uint256 poolAssetIndex;
        bool foundPool;
        for (uint256 i; i < assets.length; ++i) {
            if (assets[i] == created.pool) {
                poolAssetIndex = i;
                foundPool = true;
            }
        }
        assertTrue(foundPool);
        uint256 traderShares = shareToken.balanceOf(trader);
        uint256[] memory minimums = new uint256[](assets.length);
        vm.prank(trader);
        uint256[] memory amounts = boardroom.redeem(traderShares, trader, minimums);
        assertGt(amounts[poolAssetIndex], 0);
        assertEq(ERC20(created.pool).balanceOf(trader), amounts[poolAssetIndex]);
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

    function testLockedLiquidityRejectsTwoCanonicalBoardroomShareTokens() public {
        (Boardroom firstBoardroom, BoardroomToken firstShare) = _createBoardroom("locked-share-pair-first");
        (, BoardroomToken secondShare) = _createBoardroom("locked-share-pair-second");

        LockedLiquidityFactory.CreateParams memory params = LockedLiquidityFactory.CreateParams({
            tokenA: address(firstShare),
            tokenB: address(secondShare),
            amountADesired: SHARE_SEED,
            amountBDesired: QUOTE_SEED,
            amountAMin: SEED_MINIMUM,
            amountBMin: SEED_MINIMUM,
            deadline: block.timestamp,
            salt: keccak256("two-canonical-shares")
        });
        bytes memory data = abi.encodeCall(LockedLiquidityFactory.createLockedLiquidity, (params));

        assertFalse(
            lockedLiquidityFactory.canCall(address(firstBoardroom), owner, address(lockedLiquidityFactory), 0, data)
        );

        vm.prank(address(firstBoardroom));
        vm.expectRevert(
            abi.encodeWithSelector(
                LockedLiquidityFactory.CanonicalSharePairNotAllowed.selector, address(firstShare), address(secondShare)
            )
        );
        lockedLiquidityFactory.createLockedLiquidity(params);
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

    function testFakeBoardroomCannotReserveCanonicalSharePool() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("fake-boardroom-canonical-share");
        LockedLiquidityTestBoardroom fakeBoardroom = new LockedLiquidityTestBoardroom(address(shareToken));

        vm.prank(owner);
        boardroom.mint(address(fakeBoardroom), SHARE_SEED);
        quoteToken.mint(address(fakeBoardroom), QUOTE_SEED);
        fakeBoardroom.approveToken(address(shareToken), address(lockedLiquidityFactory), SHARE_SEED);
        fakeBoardroom.approveToken(address(quoteToken), address(lockedLiquidityFactory), QUOTE_SEED);

        LockedLiquidityFactory.CreateParams memory params =
            _createParams(address(shareToken), address(quoteToken), keccak256("fake-boardroom-canonical-share"));
        vm.expectRevert(
            abi.encodeWithSelector(LockedLiquidityFactory.InvalidBoardroom.selector, address(fakeBoardroom))
        );
        fakeBoardroom.createLockedLiquidity(lockedLiquidityFactory, params);

        assertEq(ammFactory.getPool(address(shareToken), address(quoteToken)), address(0));
    }

    function testReciprocalShareTokenLinkRejectsRegistryApprovedImpostor() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("reciprocal-share-link");
        LockedLiquidityTestBoardroom fakeBoardroom = new LockedLiquidityTestBoardroom(address(shareToken));
        LockedLiquidityTestCanonicalFactory testCanonicalFactory = new LockedLiquidityTestCanonicalFactory();
        AmmFactory testAmmFactory = new AmmFactory(address(this), address(testCanonicalFactory));
        AmmRouter testRouter = new AmmRouter(address(testAmmFactory), address(wrappedNative));
        LockedLiquidityFactory testLockerFactory =
            new LockedLiquidityFactory(address(testRouter), address(testCanonicalFactory));
        testCanonicalFactory.setBoardroom(address(fakeBoardroom), true);
        testCanonicalFactory.setShareToken(address(shareToken), true);
        testAmmFactory.setLiquidityRouter(address(testRouter));
        testAmmFactory.setReservationManager(address(testLockerFactory));

        vm.prank(owner);
        boardroom.mint(address(fakeBoardroom), SHARE_SEED);
        quoteToken.mint(address(fakeBoardroom), QUOTE_SEED);
        fakeBoardroom.approveToken(address(shareToken), address(testLockerFactory), SHARE_SEED);
        fakeBoardroom.approveToken(address(quoteToken), address(testLockerFactory), QUOTE_SEED);

        LockedLiquidityFactory.CreateParams memory params =
            _createParams(address(shareToken), address(quoteToken), keccak256("reciprocal-share-link"));
        vm.expectRevert(
            abi.encodeWithSelector(LockedLiquidityFactory.InvalidBoardroom.selector, address(fakeBoardroom))
        );
        fakeBoardroom.createLockedLiquidity(testLockerFactory, params);

        assertEq(testAmmFactory.getPool(address(shareToken), address(quoteToken)), address(0));
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

    function _createRewardPool(Boardroom boardroom) internal returns (BoardroomRewards rewards) {
        bytes memory result = boardroom.execute(
            Boardroom.Call({
                policy: address(rewardsFactory),
                target: address(rewardsFactory),
                value: 0,
                data: abi.encodeCall(rewardsFactory.createRewards, (uint64(1 days), keccak256("test-rewards")))
            })
        );
        rewards = BoardroomRewards(abi.decode(result, (address)));
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
        LockedLiquidityCanonicalTestBoardroom mockBoardroom,
        BoardroomToken mockShare,
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

    function _createParams(address tokenA, address tokenB, bytes32 salt)
        internal
        view
        returns (LockedLiquidityFactory.CreateParams memory params)
    {
        params = LockedLiquidityFactory.CreateParams({
            tokenA: tokenA,
            tokenB: tokenB,
            amountADesired: SHARE_SEED,
            amountBDesired: QUOTE_SEED,
            amountAMin: SEED_MINIMUM,
            amountBMin: SEED_MINIMUM,
            deadline: block.timestamp,
            salt: salt
        });
    }

    function _approvalCall(address token, uint256 amount) internal view returns (Boardroom.Call memory) {
        return _policyCall(
            address(assetPolicy),
            token,
            abi.encodeWithSignature("approve(address,uint256)", address(lockedLiquidityFactory), amount)
        );
    }

    function _assertNoInitialLiquidityReservation(address tokenA, address tokenB) internal view {
        (address initializer, address recipient, address reservationOwner, address manager) =
            ammFactory.initialLiquidityReservationFor(tokenA, tokenB);
        assertEq(initializer, address(0));
        assertEq(recipient, address(0));
        assertEq(reservationOwner, address(0));
        assertEq(manager, address(0));
    }

    function _policyCall(address policy, address target, bytes memory data)
        internal
        pure
        returns (Boardroom.Call memory call_)
    {
        call_ = Boardroom.Call({policy: policy, target: target, value: 0, data: data});
    }
}
