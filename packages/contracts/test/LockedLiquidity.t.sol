// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "solady/tokens/ERC20.sol";
import {WETH} from "solady/tokens/WETH.sol";
import {AmmFactory} from "../src/AmmFactory.sol";
import {AmmRouter} from "../src/AmmRouter.sol";
import {AssetPolicy} from "../src/AssetPolicy.sol";
import {Boardroom} from "../src/Boardroom.sol";
import {BoardroomFactory} from "../src/BoardroomFactory.sol";
import {BoardroomPolicyRegistry} from "../src/BoardroomPolicyRegistry.sol";
import {BoardroomToken} from "../src/BoardroomToken.sol";
import {IBoardroomCallPolicy} from "../src/IBoardroomCallPolicy.sol";
import {LockedLiquidity} from "../src/LockedLiquidity.sol";
import {LockedLiquidityFactory} from "../src/LockedLiquidityFactory.sol";

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
        policyRegistry.setPolicyAllowed(address(lockedLiquidityFactory), true);
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
        assertEq(boardroom.redeemableAssetCount(), 1);
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

    function testBoardroomRecordsLockedLiquidityCreatedThroughWrapperPolicy() public {
        LockedLiquidityTestAllowAllPolicy wrapperPolicy = new LockedLiquidityTestAllowAllPolicy();
        policyRegistry.setPolicyAllowed(address(wrapperPolicy), true);

        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("locked-wrapper");
        CreatedLocker memory created =
            _createLockedLiquidity(boardroom, shareToken, address(quoteToken), address(wrapperPolicy), "wrapper");

        assertEq(boardroom.lockedLiquidityCount(), 1);
        assertEq(boardroom.lockedLiquidityAt(0), created.locker);
        assertTrue(boardroom.isLockedLiquidity(created.locker));
    }

    function testWindDownRequiresLockedLiquidityExitBeforeRedemptions() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("locked-wind-down");
        vm.prank(owner);
        boardroom.mint(holder, HOLDER_SHARES);

        CreatedLocker memory created = _createLockedLiquidity(
            boardroom, shareToken, address(quoteToken), address(lockedLiquidityFactory), "wind-down"
        );

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

    function testBoardroomCanClaimLockedLiquidityFeesDuringWindDown() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("locked-fees");
        CreatedLocker memory created =
            _createLockedLiquidity(boardroom, shareToken, address(quoteToken), address(lockedLiquidityFactory), "fees");

        vm.prank(owner);
        boardroom.upgradeToNext("", bytes32(0));

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
        for (uint256 i; i < maxAssets; ++i) {
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
            amountAMin: 1,
            amountBMin: 1,
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
            amountAMin: 1,
            amountBMin: 1,
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
            amountAMin: 1,
            amountBMin: 1,
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
            amountAMin: 1,
            amountBMin: 1,
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
            amountAMin: 1,
            amountBMin: 1,
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
