// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "solady/tokens/ERC20.sol";
import {WETH} from "solady/tokens/WETH.sol";
import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";
import {AmmFactory} from "../src/AmmFactory.sol";
import {AmmPool} from "../src/AmmPool.sol";
import {AmmRouter} from "../src/AmmRouter.sol";

contract AmmTestERC20 is ERC20 {
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

contract AmmTestFeeOnTransferToken {
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

contract AmmTestPoolTransferFeeToken {
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

contract AmmTest is Test {
    using FixedPointMathLib for uint256;

    AmmFactory internal factory;
    WETH internal wrappedNative;
    AmmRouter internal router;
    AmmTestERC20 internal tokenA;
    AmmTestERC20 internal tokenB;

    address internal lp = address(0xA11CE);
    address internal trader = address(0xB0B);
    address internal receiver = address(0xCAFE);
    address internal protocolFeeRecipient = address(0xFEE);

    function setUp() public {
        factory = new AmmFactory(address(this));
        wrappedNative = new WETH();
        router = new AmmRouter(address(factory), address(wrappedNative));
        tokenA = new AmmTestERC20("Token A", "TKNA", 18);
        tokenB = new AmmTestERC20("Token B", "TKNB", 18);

        tokenA.mint(lp, 10_000 ether);
        tokenB.mint(lp, 10_000 ether);
        tokenA.mint(trader, 10_000 ether);
        tokenB.mint(trader, 10_000 ether);
        vm.deal(lp, 100 ether);
        vm.deal(trader, 100 ether);
    }

    function testFactoryCreatesDeterministicPoolAndRejectsInvalidPairs() public {
        address predicted = factory.predictPoolAddress(address(tokenA), address(tokenB));
        address pool = factory.createPool(address(tokenA), address(tokenB));

        assertEq(pool, predicted);
        assertEq(factory.getPool(address(tokenA), address(tokenB)), pool);
        assertEq(factory.getPool(address(tokenB), address(tokenA)), pool);
        assertTrue(factory.isPool(pool));
        assertEq(factory.allPoolsLength(), 1);

        vm.expectRevert(abi.encodeWithSelector(AmmFactory.PoolAlreadyExists.selector, pool));
        factory.createPool(address(tokenB), address(tokenA));

        vm.expectRevert(AmmFactory.IdenticalTokens.selector);
        factory.createPool(address(tokenA), address(tokenA));

        vm.expectRevert(AmmFactory.ZeroAddress.selector);
        factory.createPool(address(0), address(tokenA));
    }

    function testFactorySetsProtocolFeeRecipientOnce() public {
        assertEq(factory.feeManager(), address(this));

        vm.expectRevert(AmmFactory.ZeroAddress.selector);
        new AmmFactory(address(0));

        vm.prank(trader);
        vm.expectRevert(AmmFactory.OnlyFeeManager.selector);
        factory.setProtocolFeeRecipient(protocolFeeRecipient);

        vm.expectRevert(AmmFactory.ZeroAddress.selector);
        factory.setProtocolFeeRecipient(address(0));

        factory.setProtocolFeeRecipient(protocolFeeRecipient);
        assertEq(factory.protocolFeeRecipient(), protocolFeeRecipient);

        vm.expectRevert(
            abi.encodeWithSelector(AmmFactory.ProtocolFeeRecipientAlreadySet.selector, protocolFeeRecipient)
        );
        factory.setProtocolFeeRecipient(receiver);
    }

    function testRouterRejectsNonContractDependencies() public {
        vm.expectRevert(AmmRouter.InvalidAddress.selector);
        new AmmRouter(address(0), address(wrappedNative));

        vm.expectRevert(AmmRouter.InvalidAddress.selector);
        new AmmRouter(address(0xFACADE), address(wrappedNative));

        vm.expectRevert(AmmRouter.InvalidAddress.selector);
        new AmmRouter(address(factory), address(0xBEEF));
    }

    function testInitialLiquidityMintsLpAndLocksMinimumLiquidity() public {
        (address pool, uint256 liquidity) = _seedTokenPool(1_000 ether, 1_000 ether);

        uint256 expected = (uint256(1_000 ether) * 1_000 ether).sqrt() - AmmPool(pool).MINIMUM_LIQUIDITY();
        assertEq(liquidity, expected);
        assertEq(AmmPool(pool).balanceOf(lp), expected);
        assertEq(AmmPool(pool).balanceOf(address(1)), AmmPool(pool).MINIMUM_LIQUIDITY());

        (uint112 reserve0, uint112 reserve1,) = AmmPool(pool).getReserves();
        assertEq(reserve0, 1_000 ether);
        assertEq(reserve1, 1_000 ether);
    }

    function testAddAndRemoveLiquidityThroughRouter() public {
        (address pool,) = _seedTokenPool(1_000 ether, 1_000 ether);

        vm.startPrank(trader);
        tokenA.approve(address(router), 500 ether);
        tokenB.approve(address(router), 500 ether);
        (,, uint256 liquidity) = router.addLiquidity(
            address(tokenA), address(tokenB), 500 ether, 500 ether, 500 ether, 500 ether, trader, block.timestamp
        );
        assertGt(liquidity, 0);

        AmmPool(pool).approve(address(router), liquidity);
        uint256 beforeA = tokenA.balanceOf(trader);
        uint256 beforeB = tokenB.balanceOf(trader);
        (uint256 amountA, uint256 amountB) =
            router.removeLiquidity(address(tokenA), address(tokenB), liquidity, 1, 1, trader, block.timestamp);
        vm.stopPrank();

        assertGt(amountA, 0);
        assertGt(amountB, 0);
        assertEq(tokenA.balanceOf(trader), beforeA + amountA);
        assertEq(tokenB.balanceOf(trader), beforeB + amountB);
    }

    function testSwapPreservesKAndAccruesClaimableFees() public {
        (address pool,) = _seedTokenPool(1_000 ether, 1_000 ether);
        (uint112 reserve0Before, uint112 reserve1Before,) = AmmPool(pool).getReserves();
        uint256 kBefore = uint256(reserve0Before) * reserve1Before;
        address fees = AmmPool(pool).poolFees();

        _swapTokenAToTokenB(100 ether, trader);

        (uint112 reserve0After, uint112 reserve1After,) = AmmPool(pool).getReserves();
        assertGe(uint256(reserve0After) * reserve1After, kBefore);
        assertGt(tokenA.balanceOf(fees), 0);
        assertEq(tokenA.balanceOf(pool), reserve0After);
        assertEq(tokenB.balanceOf(pool), reserve1After);

        uint256 beforeClaim = tokenA.balanceOf(lp);
        vm.prank(lp);
        AmmPool(pool).claimFees();
        assertGt(tokenA.balanceOf(lp), beforeClaim);
    }

    function testSwapSplitsProtocolFeesFromLpFees() public {
        factory.setProtocolFeeRecipient(protocolFeeRecipient);
        (address pool,) = _seedTokenPool(1_000 ether, 1_000 ether);
        address fees = AmmPool(pool).poolFees();

        uint256 nominalFee = 100 ether * factory.SWAP_FEE_BPS() / factory.FEE_DENOMINATOR();
        uint256 protocolFee = nominalFee * factory.PROTOCOL_FEE_SHARE_BPS() / factory.FEE_DENOMINATOR();
        uint256 lpFee = nominalFee - protocolFee;

        _swapTokenAToTokenB(100 ether, trader);

        assertEq(tokenA.balanceOf(protocolFeeRecipient), protocolFee);
        assertEq(tokenA.balanceOf(fees), lpFee);
        assertEq(tokenA.balanceOf(pool), 1_100 ether - nominalFee);

        uint256 beforeClaim = tokenA.balanceOf(lp);
        vm.prank(lp);
        AmmPool(pool).claimFees();
        assertGt(tokenA.balanceOf(lp), beforeClaim);
        assertLt(tokenA.balanceOf(fees), lpFee);
    }

    function testLpTransferUpdatesFeeIndexes() public {
        (address pool,) = _seedTokenPool(1_000 ether, 1_000 ether);
        _swapTokenAToTokenB(100 ether, trader);

        uint256 lpBalance = AmmPool(pool).balanceOf(lp);
        vm.prank(lp);
        assertTrue(AmmPool(pool).transfer(receiver, lpBalance / 2));

        _swapTokenAToTokenB(100 ether, trader);

        uint256 lpBefore = tokenA.balanceOf(lp);
        uint256 receiverBefore = tokenA.balanceOf(receiver);
        vm.prank(lp);
        AmmPool(pool).claimFees();
        vm.prank(receiver);
        AmmPool(pool).claimFees();

        assertGt(tokenA.balanceOf(lp), lpBefore);
        assertGt(tokenA.balanceOf(receiver), receiverBefore);
        assertLt(AmmPool(pool).claimable0(lp), tokenA.balanceOf(AmmPool(pool).poolFees()));
    }

    function testCurrentCumulativePricesAndObservationsUpdateAcrossTime() public {
        (address pool,) = _seedTokenPool(1_000 ether, 1_000 ether);
        uint256 initialObservations = AmmPool(pool).observationLength();

        vm.warp(block.timestamp + 1 hours);
        (uint256 price0Cumulative, uint256 price1Cumulative,) = AmmPool(pool).currentCumulativePrices();
        assertGt(price0Cumulative, 0);
        assertGt(price1Cumulative, 0);

        _swapTokenAToTokenB(10 ether, trader);
        assertGt(AmmPool(pool).observationLength(), initialObservations);
    }

    function testNativeAddRemoveAndSwapPaths() public {
        vm.startPrank(lp);
        tokenA.approve(address(router), 1_000 ether);
        (,, uint256 liquidity) = router.addLiquidityNative{value: 10 ether}(
            address(tokenA), 1_000 ether, 1_000 ether, 10 ether, lp, block.timestamp
        );
        vm.stopPrank();
        assertGt(liquidity, 0);

        address pool = factory.getPool(address(tokenA), address(wrappedNative));
        assertTrue(factory.isPool(pool));

        address[] memory nativeToToken = new address[](2);
        nativeToToken[0] = address(wrappedNative);
        nativeToToken[1] = address(tokenA);

        uint256 beforeToken = tokenA.balanceOf(receiver);
        vm.prank(trader);
        router.swapExactNativeForTokens{value: 1 ether}(1, nativeToToken, receiver, block.timestamp);
        assertGt(tokenA.balanceOf(receiver), beforeToken);

        uint256 nativeBefore = receiver.balance;
        vm.startPrank(lp);
        AmmPool(pool).approve(address(router), liquidity / 2);
        router.removeLiquidityNative(address(tokenA), liquidity / 2, 1, 1, receiver, block.timestamp);
        vm.stopPrank();
        assertGt(receiver.balance, nativeBefore);
    }

    function testRouterRejectsExpiredDeadlineInsufficientOutputAndLongPath() public {
        _seedTokenPool(1_000 ether, 1_000 ether);

        vm.startPrank(trader);
        tokenA.approve(address(router), 100 ether);
        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        vm.expectRevert(AmmRouter.Expired.selector);
        router.swapExactTokensForTokens(100 ether, 1, path, receiver, block.timestamp - 1);

        vm.expectRevert(AmmRouter.InsufficientOutputAmount.selector);
        router.swapExactTokensForTokens(100 ether, type(uint256).max, path, receiver, block.timestamp);

        address[] memory longPath = new address[](router.MAX_SWAP_PATH_LENGTH() + 1);
        vm.expectRevert(AmmRouter.InvalidPath.selector);
        router.getAmountsOut(100 ether, longPath);
        vm.stopPrank();
    }

    function testRouterRejectsFeeOnTransferTokens() public {
        AmmTestFeeOnTransferToken feeToken = new AmmTestFeeOnTransferToken();
        AmmTestERC20 otherToken = new AmmTestERC20("Other", "OTHR", 18);
        feeToken.mint(lp, 1_000 ether);
        otherToken.mint(lp, 1_000 ether);

        vm.startPrank(lp);
        feeToken.approve(address(router), 1_000 ether);
        otherToken.approve(address(router), 1_000 ether);
        vm.expectRevert(
            abi.encodeWithSelector(AmmRouter.TransferAmountMismatch.selector, address(feeToken), 1_000 ether, 990 ether)
        );
        router.addLiquidity(address(feeToken), address(otherToken), 1_000 ether, 1_000 ether, 1, 1, lp, block.timestamp);
        vm.stopPrank();
    }

    function testPoolFeeIndexUsesActualFeeVaultReceipts() public {
        AmmTestPoolTransferFeeToken taxedToken = new AmmTestPoolTransferFeeToken();
        AmmTestERC20 otherToken = new AmmTestERC20("Other", "OTHR", 18);
        taxedToken.mint(lp, 1_000 ether);
        otherToken.mint(lp, 1_000 ether);
        taxedToken.mint(trader, 100 ether);

        vm.startPrank(lp);
        taxedToken.approve(address(router), 1_000 ether);
        otherToken.approve(address(router), 1_000 ether);
        router.addLiquidity(
            address(taxedToken),
            address(otherToken),
            1_000 ether,
            1_000 ether,
            1_000 ether,
            1_000 ether,
            lp,
            block.timestamp
        );
        vm.stopPrank();

        address pool = factory.getPool(address(taxedToken), address(otherToken));
        taxedToken.setTaxedSender(pool);

        vm.startPrank(trader);
        taxedToken.approve(address(router), 100 ether);
        address[] memory path = new address[](2);
        path[0] = address(taxedToken);
        path[1] = address(otherToken);
        router.swapExactTokensForTokens(100 ether, 1, path, trader, block.timestamp);
        vm.stopPrank();

        uint256 nominalFee = 100 ether * factory.SWAP_FEE_BPS() / factory.FEE_DENOMINATOR();
        uint256 receivedFee = nominalFee - nominalFee / 100;
        address fees = AmmPool(pool).poolFees();
        assertEq(taxedToken.balanceOf(fees), receivedFee);

        uint256 lpBefore = taxedToken.balanceOf(lp);
        vm.prank(lp);
        AmmPool(pool).claimFees();
        assertGt(taxedToken.balanceOf(lp), lpBefore);
        assertLe(taxedToken.balanceOf(fees), receivedFee);
    }

    function testRouterEnforcesSwapMinOutAgainstActualReceiverBalance() public {
        AmmTestPoolTransferFeeToken taxedToken = new AmmTestPoolTransferFeeToken();
        taxedToken.mint(lp, 1_000 ether);

        vm.startPrank(lp);
        tokenA.approve(address(router), 1_000 ether);
        taxedToken.approve(address(router), 1_000 ether);
        router.addLiquidity(
            address(tokenA),
            address(taxedToken),
            1_000 ether,
            1_000 ether,
            1_000 ether,
            1_000 ether,
            lp,
            block.timestamp
        );
        vm.stopPrank();

        address pool = factory.getPool(address(tokenA), address(taxedToken));
        taxedToken.setTaxedSender(pool);

        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(taxedToken);
        uint256[] memory quoted = router.getAmountsOut(100 ether, path);
        uint256 expectedActualOut = quoted[1] - quoted[1] / 100;

        vm.startPrank(trader);
        tokenA.approve(address(router), 200 ether);
        vm.expectRevert(AmmRouter.InsufficientOutputAmount.selector);
        router.swapExactTokensForTokens(100 ether, quoted[1], path, receiver, block.timestamp);

        uint256 beforeReceiver = taxedToken.balanceOf(receiver);
        uint256[] memory amounts =
            router.swapExactTokensForTokens(100 ether, expectedActualOut, path, receiver, block.timestamp);
        vm.stopPrank();

        assertEq(amounts[1], expectedActualOut);
        assertEq(taxedToken.balanceOf(receiver) - beforeReceiver, expectedActualOut);
    }

    function testRouterEnforcesNativeSwapMinOutAgainstActualReceiverBalance() public {
        AmmTestPoolTransferFeeToken taxedToken = new AmmTestPoolTransferFeeToken();
        taxedToken.mint(lp, 1_000 ether);

        vm.startPrank(lp);
        taxedToken.approve(address(router), 1_000 ether);
        router.addLiquidityNative{value: 10 ether}(
            address(taxedToken), 1_000 ether, 1_000 ether, 10 ether, lp, block.timestamp
        );
        vm.stopPrank();

        address pool = factory.getPool(address(taxedToken), address(wrappedNative));
        taxedToken.setTaxedSender(pool);

        address[] memory path = new address[](2);
        path[0] = address(wrappedNative);
        path[1] = address(taxedToken);
        uint256[] memory quoted = router.getAmountsOut(1 ether, path);
        uint256 expectedActualOut = quoted[1] - quoted[1] / 100;

        vm.prank(trader);
        vm.expectRevert(AmmRouter.InsufficientOutputAmount.selector);
        router.swapExactNativeForTokens{value: 1 ether}(quoted[1], path, receiver, block.timestamp);

        uint256 beforeReceiver = taxedToken.balanceOf(receiver);
        vm.prank(trader);
        uint256[] memory amounts =
            router.swapExactNativeForTokens{value: 1 ether}(expectedActualOut, path, receiver, block.timestamp);

        assertEq(amounts[1], expectedActualOut);
        assertEq(taxedToken.balanceOf(receiver) - beforeReceiver, expectedActualOut);
    }

    function testRouterEnforcesRemoveLiquidityMinOutAgainstActualReceiverBalance() public {
        AmmTestPoolTransferFeeToken taxedToken = new AmmTestPoolTransferFeeToken();
        taxedToken.mint(lp, 1_000 ether);

        vm.startPrank(lp);
        tokenA.approve(address(router), 1_000 ether);
        taxedToken.approve(address(router), 1_000 ether);
        router.addLiquidity(
            address(tokenA),
            address(taxedToken),
            1_000 ether,
            1_000 ether,
            1_000 ether,
            1_000 ether,
            lp,
            block.timestamp
        );
        vm.stopPrank();

        address pool = factory.getPool(address(tokenA), address(taxedToken));
        taxedToken.setTaxedSender(pool);
        uint256 liquidity = AmmPool(pool).balanceOf(lp);

        vm.startPrank(lp);
        AmmPool(pool).approve(address(router), liquidity);
        vm.expectRevert(AmmRouter.InsufficientAmount.selector);
        router.removeLiquidity(address(tokenA), address(taxedToken), liquidity, 1, 999 ether, lp, block.timestamp);

        uint256 beforeTaxed = taxedToken.balanceOf(lp);
        (uint256 amountA, uint256 amountB) =
            router.removeLiquidity(address(tokenA), address(taxedToken), liquidity, 1, 989 ether, lp, block.timestamp);
        vm.stopPrank();

        assertGt(amountA, 0);
        assertGt(amountB, 989 ether);
        assertLt(amountB, 999 ether);
        assertEq(taxedToken.balanceOf(lp) - beforeTaxed, amountB);
    }

    function testRouterEnforcesNativeRemoveLiquidityMinOutAgainstActualReceiverBalance() public {
        AmmTestPoolTransferFeeToken taxedToken = new AmmTestPoolTransferFeeToken();
        taxedToken.mint(lp, 1_000 ether);

        vm.startPrank(lp);
        taxedToken.approve(address(router), 1_000 ether);
        router.addLiquidityNative{value: 10 ether}(
            address(taxedToken), 1_000 ether, 1_000 ether, 10 ether, lp, block.timestamp
        );
        vm.stopPrank();

        address pool = factory.getPool(address(taxedToken), address(wrappedNative));
        taxedToken.setTaxedSender(pool);
        uint256 liquidity = AmmPool(pool).balanceOf(lp);

        vm.startPrank(lp);
        AmmPool(pool).approve(address(router), liquidity);
        vm.expectRevert(AmmRouter.InsufficientAmount.selector);
        router.removeLiquidityNative(address(taxedToken), liquidity, 999 ether, 1, lp, block.timestamp);

        uint256 beforeTaxed = taxedToken.balanceOf(lp);
        uint256 beforeNative = lp.balance;
        (uint256 amountToken, uint256 amountNative) =
            router.removeLiquidityNative(address(taxedToken), liquidity, 989 ether, 1, lp, block.timestamp);
        vm.stopPrank();

        assertGt(amountToken, 989 ether);
        assertLt(amountToken, 999 ether);
        assertGt(amountNative, 0);
        assertEq(taxedToken.balanceOf(lp) - beforeTaxed, amountToken);
        assertEq(lp.balance - beforeNative, amountNative);
    }

    function testFuzzSwapMaintainsReserveBalanceAccounting(uint96 rawAmountIn) public {
        (address pool,) = _seedTokenPool(1_000 ether, 1_000 ether);
        uint256 amountIn = bound(uint256(rawAmountIn), 1e12, 100 ether);
        _swapTokenAToTokenB(amountIn, trader);

        (uint112 reserve0, uint112 reserve1,) = AmmPool(pool).getReserves();
        assertEq(tokenA.balanceOf(pool), reserve0);
        assertEq(tokenB.balanceOf(pool), reserve1);
        assertLe(AmmPool(pool).claimable0(lp), tokenA.balanceOf(AmmPool(pool).poolFees()));
    }

    function _seedTokenPool(uint256 amountA, uint256 amountB) internal returns (address pool, uint256 liquidity) {
        vm.startPrank(lp);
        tokenA.approve(address(router), amountA);
        tokenB.approve(address(router), amountB);
        (,, liquidity) = router.addLiquidity(
            address(tokenA), address(tokenB), amountA, amountB, amountA, amountB, lp, block.timestamp
        );
        vm.stopPrank();
        pool = factory.getPool(address(tokenA), address(tokenB));
    }

    function _swapTokenAToTokenB(uint256 amountIn, address sender) internal {
        vm.startPrank(sender);
        tokenA.approve(address(router), amountIn);
        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);
        router.swapExactTokensForTokens(amountIn, 1, path, receiver, block.timestamp);
        vm.stopPrank();
    }
}
