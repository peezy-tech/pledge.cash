// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "solady/auth/Ownable.sol";
import {ERC20} from "solady/tokens/ERC20.sol";
import {WETH} from "solady/tokens/WETH.sol";
import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";
import {AmmFactory} from "../../src/amm/AmmFactory.sol";
import {AmmPool} from "../../src/amm/AmmPool.sol";
import {AmmRouter} from "../../src/amm/AmmRouter.sol";

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

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
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

contract AmmTestSenderSurchargeToken {
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
    mapping(address => bool) public isShareToken;

    function setUp() public {
        factory = new AmmFactory(address(this), address(this));
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

    function testCanonicalBoardroomShareCannotBeInitializedWithoutReservation() public {
        isShareToken[address(tokenA)] = true;
        address pool = factory.createPool(address(tokenA), address(tokenB));

        vm.startPrank(lp);
        tokenA.approve(address(router), 1_000 ether);
        tokenB.approve(address(router), 1_000 ether);
        vm.expectRevert(abi.encodeWithSelector(AmmFactory.InitialLiquidityReservationRequired.selector, pool));
        router.addLiquidity(
            address(tokenA), address(tokenB), 1_000 ether, 1_000 ether, 1_000 ether, 1_000 ether, lp, block.timestamp
        );
        vm.stopPrank();

        assertEq(AmmPool(pool).totalSupply(), 0);
        assertEq(tokenA.balanceOf(pool), 0);
        assertEq(tokenB.balanceOf(pool), 0);
    }

    function testFactoryGovernanceRotatesProtocolFeeRecipient() public {
        assertEq(factory.feeManager(), address(this));
        assertEq(factory.owner(), address(this));

        vm.expectRevert(AmmFactory.ZeroAddress.selector);
        new AmmFactory(address(0), address(this));

        vm.expectRevert(abi.encodeWithSelector(AmmFactory.InvalidBoardroomFactory.selector, address(0)));
        new AmmFactory(address(this), address(0));

        address nonContract = address(0xBEEF);
        vm.expectRevert(abi.encodeWithSelector(AmmFactory.InvalidBoardroomFactory.selector, nonContract));
        new AmmFactory(address(this), nonContract);

        vm.prank(trader);
        vm.expectRevert(Ownable.Unauthorized.selector);
        factory.setProtocolFeeRecipient(protocolFeeRecipient);

        vm.expectRevert(AmmFactory.ZeroAddress.selector);
        factory.setProtocolFeeRecipient(address(0));

        factory.setProtocolFeeRecipient(protocolFeeRecipient);
        assertEq(factory.protocolFeeRecipient(), protocolFeeRecipient);

        factory.setProtocolFeeRecipient(receiver);
        assertEq(factory.protocolFeeRecipient(), receiver);
    }

    function testFactoryGovernanceCanRotateFeeManager() public {
        factory.setFeeManager(receiver);
        assertEq(factory.feeManager(), receiver);

        vm.prank(trader);
        vm.expectRevert(Ownable.Unauthorized.selector);
        factory.setFeeManager(trader);

        factory.transferOwnership(protocolFeeRecipient);
        vm.prank(protocolFeeRecipient);
        factory.setFeeManager(trader);
        assertEq(factory.feeManager(), trader);
    }

    function testFactoryGovernanceConfiguresInitialLiquidityAuthorities() public {
        vm.expectRevert(AmmFactory.ZeroAddress.selector);
        factory.setLiquidityRouter(address(0));
        vm.expectRevert(AmmFactory.ZeroAddress.selector);
        factory.setReservationManager(address(0));

        vm.startPrank(trader);
        vm.expectRevert(Ownable.Unauthorized.selector);
        factory.setLiquidityRouter(address(router));
        vm.expectRevert(Ownable.Unauthorized.selector);
        factory.setReservationManager(receiver);
        vm.stopPrank();

        factory.setLiquidityRouter(address(router));
        factory.setReservationManager(receiver);
        assertEq(factory.liquidityRouter(), address(router));
        assertEq(factory.reservationManager(), receiver);
    }

    function testInitialLiquidityReservationRejectsFrontRunningAndConsumesExpectedRouterMint() public {
        factory.setLiquidityRouter(address(router));
        factory.setReservationManager(address(this));

        address pool = factory.reserveInitialLiquidity(address(tokenA), address(tokenB), lp, lp, receiver);
        assertEq(pool, factory.predictPoolAddress(address(tokenA), address(tokenB)));
        (address initializer, address recipient, address reservationOwner, address manager) =
            factory.initialLiquidityReservationFor(address(tokenA), address(tokenB));
        assertEq(initializer, lp);
        assertEq(recipient, lp);
        assertEq(reservationOwner, receiver);
        assertEq(manager, address(this));

        vm.prank(trader);
        vm.expectRevert(AmmFactory.OnlyLiquidityRouter.selector);
        AmmPool(pool).mint(lp);

        vm.startPrank(trader);
        tokenA.approve(address(router), 1_000 ether);
        tokenB.approve(address(router), 1_000 ether);
        vm.expectRevert(abi.encodeWithSelector(AmmFactory.InitialLiquidityReservationMismatch.selector, lp, trader));
        router.addLiquidity(
            address(tokenA), address(tokenB), 1_000 ether, 1_000 ether, 1_000 ether, 1_000 ether, lp, block.timestamp
        );
        vm.stopPrank();
        assertEq(tokenA.balanceOf(pool), 0);
        assertEq(tokenB.balanceOf(pool), 0);

        vm.startPrank(lp);
        tokenA.approve(address(router), 1_000 ether);
        tokenB.approve(address(router), 1_000 ether);
        (,, uint256 liquidity) = router.addLiquidity(
            address(tokenA), address(tokenB), 1_000 ether, 1_000 ether, 1_000 ether, 1_000 ether, lp, block.timestamp
        );
        vm.stopPrank();

        uint256 expectedLiquidity = (uint256(1_000 ether) * 1_000 ether).sqrt();
        assertEq(liquidity, expectedLiquidity);
        assertEq(AmmPool(pool).balanceOf(lp), expectedLiquidity);
        assertEq(AmmPool(pool).balanceOf(address(1)), 0);
        assertEq(AmmPool(pool).totalSupply(), expectedLiquidity);
        (initializer, recipient, reservationOwner, manager) =
            factory.initialLiquidityReservationFor(address(tokenA), address(tokenB));
        assertEq(initializer, address(0));
        assertEq(recipient, address(0));
        assertEq(reservationOwner, address(0));
        assertEq(manager, address(0));
    }

    function testReservedInitialMintSweepsOneSidedPreloadToReservationOwner() public {
        factory.setLiquidityRouter(address(router));
        factory.setReservationManager(address(this));

        address pool = factory.reserveInitialLiquidity(address(tokenA), address(tokenB), lp, lp, receiver);
        uint256 hostilePreload = 77 ether;
        tokenA.mint(pool, hostilePreload);
        uint256 receiverBefore = tokenA.balanceOf(receiver);

        uint256 amountA = 1_000 ether;
        uint256 amountB = 2_000 ether;
        vm.startPrank(lp);
        tokenA.approve(address(router), amountA);
        tokenB.approve(address(router), amountB);
        (,, uint256 liquidity) = router.addLiquidity(
            address(tokenA), address(tokenB), amountA, amountB, amountA, amountB, lp, block.timestamp
        );
        vm.stopPrank();

        assertEq(tokenA.balanceOf(receiver) - receiverBefore, hostilePreload);
        assertEq(tokenA.balanceOf(pool), amountA);
        assertEq(tokenB.balanceOf(pool), amountB);
        assertEq(liquidity, (amountA * amountB).sqrt());
        assertEq(AmmPool(pool).balanceOf(address(1)), 0);
    }

    function testReservedInitialMintSweepsPreloadAboveUint112BeforeReserveCheck() public {
        factory.setLiquidityRouter(address(router));
        factory.setReservationManager(address(this));

        address pool = factory.reserveInitialLiquidity(address(tokenA), address(tokenB), lp, lp, receiver);
        uint256 hostilePreload = uint256(type(uint112).max) + 1;
        tokenA.mint(pool, hostilePreload);
        uint256 receiverBefore = tokenA.balanceOf(receiver);

        uint256 amountA = 1_000 ether;
        uint256 amountB = 2_000 ether;
        vm.startPrank(lp);
        tokenA.approve(address(router), amountA);
        tokenB.approve(address(router), amountB);
        (,, uint256 liquidity) = router.addLiquidity(
            address(tokenA), address(tokenB), amountA, amountB, amountA, amountB, lp, block.timestamp
        );
        vm.stopPrank();

        assertGt(liquidity, 0);
        assertEq(tokenA.balanceOf(receiver) - receiverBefore, hostilePreload);
        assertEq(tokenA.balanceOf(pool), amountA);
        assertEq(tokenB.balanceOf(pool), amountB);
    }

    function testReservationCreatorCanReleaseAfterGlobalManagerRotation() public {
        factory.setReservationManager(address(this));
        factory.reserveInitialLiquidity(address(tokenA), address(tokenB), lp, lp, receiver);
        factory.setReservationManager(trader);

        vm.prank(trader);
        vm.expectRevert(
            abi.encodeWithSelector(
                AmmFactory.InitialLiquidityReservationManagerMismatch.selector, address(this), trader
            )
        );
        factory.releaseInitialLiquidityReservation(address(tokenA), address(tokenB), receiver);

        factory.releaseInitialLiquidityReservation(address(tokenA), address(tokenB), receiver);
        (address initializer, address recipient, address reservationOwner, address manager) =
            factory.initialLiquidityReservationFor(address(tokenA), address(tokenB));
        assertEq(initializer, address(0));
        assertEq(recipient, address(0));
        assertEq(reservationOwner, address(0));
        assertEq(manager, address(0));

        AmmTestERC20 tokenC = new AmmTestERC20("Token C", "TKNC", 18);
        vm.expectRevert(AmmFactory.OnlyReservationManager.selector);
        factory.reserveInitialLiquidity(address(tokenA), address(tokenC), lp, lp, receiver);

        vm.prank(trader);
        factory.reserveInitialLiquidity(address(tokenA), address(tokenC), lp, lp, receiver);
        (,,, manager) = factory.initialLiquidityReservationFor(address(tokenA), address(tokenC));
        assertEq(manager, trader);
    }

    function testReservationReleaseRequiresOwnerAndInitializedPoolsCannotBeReserved() public {
        factory.setLiquidityRouter(address(router));
        factory.setReservationManager(address(this));

        address pool = factory.reserveInitialLiquidity(address(tokenA), address(tokenB), lp, lp, receiver);
        vm.expectRevert(
            abi.encodeWithSelector(AmmFactory.InitialLiquidityReservationMismatch.selector, receiver, trader)
        );
        factory.releaseInitialLiquidityReservation(address(tokenA), address(tokenB), trader);

        factory.releaseInitialLiquidityReservation(address(tokenA), address(tokenB), receiver);
        (address initializer, address recipient, address reservationOwner, address manager) =
            factory.initialLiquidityReservationFor(address(tokenA), address(tokenB));
        assertEq(initializer, address(0));
        assertEq(recipient, address(0));
        assertEq(reservationOwner, address(0));
        assertEq(manager, address(0));

        vm.startPrank(lp);
        tokenA.approve(address(router), 1_000 ether);
        tokenB.approve(address(router), 1_000 ether);
        router.addLiquidity(
            address(tokenA), address(tokenB), 1_000 ether, 1_000 ether, 1_000 ether, 1_000 ether, lp, block.timestamp
        );
        vm.stopPrank();
        assertGt(AmmPool(pool).totalSupply(), 0);

        vm.expectRevert(abi.encodeWithSelector(AmmFactory.PoolAlreadyInitialized.selector, pool));
        factory.reserveInitialLiquidity(address(tokenA), address(tokenB), lp, lp, receiver);
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
        vm.roll(block.number + 1);
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
        vm.roll(block.number + 1);
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
        vm.roll(block.number + 1);
        _swapTokenAToTokenB(100 ether, trader);

        uint256 lpBalance = AmmPool(pool).balanceOf(lp);
        vm.prank(lp);
        assertTrue(AmmPool(pool).transfer(receiver, lpBalance / 2));

        _swapTokenAToTokenB(100 ether, trader);
        vm.roll(block.number + 1);

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

    function testLpFeeEntitlementTravelsWithFlashTransferredLiquidity() public {
        (address pool,) = _seedTokenPool(1_000 ether, 1_000 ether);
        vm.roll(block.number + 1);
        uint256 liquidity = AmmPool(pool).balanceOf(lp);

        vm.prank(lp);
        assertTrue(AmmPool(pool).transfer(trader, liquidity));
        _swapTokenAToTokenB(100 ether, trader);
        vm.prank(trader);
        assertTrue(AmmPool(pool).transfer(lp, liquidity));

        uint256 traderBefore = tokenA.balanceOf(trader);
        vm.prank(trader);
        AmmPool(pool).claimFees();
        assertEq(tokenA.balanceOf(trader), traderBefore);

        vm.roll(block.number + 1);
        uint256 lpBefore = tokenA.balanceOf(lp);
        vm.prank(lp);
        AmmPool(pool).claimFees();
        assertGt(tokenA.balanceOf(lp), lpBefore);
    }

    function testFlashBorrowerCannotClaimLendersHistoricalFeeEntitlement() public {
        (address pool,) = _seedTokenPool(1_000 ether, 1_000 ether);
        vm.roll(block.number + 1);
        _swapTokenAToTokenB(100 ether, trader);
        uint256 liquidity = AmmPool(pool).balanceOf(lp);

        vm.prank(lp);
        assertTrue(AmmPool(pool).transfer(trader, liquidity));
        uint256 traderBefore = tokenA.balanceOf(trader);
        vm.prank(trader);
        (uint256 claimed0, uint256 claimed1) = AmmPool(pool).claimFees();
        assertEq(claimed0 + claimed1, 0);
        assertEq(tokenA.balanceOf(trader), traderBefore);

        vm.prank(trader);
        assertTrue(AmmPool(pool).transfer(lp, liquidity));
        vm.roll(block.number + 1);

        uint256 lenderBefore = tokenA.balanceOf(lp);
        vm.prank(lp);
        AmmPool(pool).claimFees();
        assertGt(tokenA.balanceOf(lp), lenderBefore);
    }

    function testDustLpReceiptDoesNotBlockMatureFeeClaim() public {
        (address pool,) = _seedTokenPool(1_000 ether, 1_000 ether);
        vm.prank(lp);
        assertTrue(AmmPool(pool).transfer(trader, 1));
        vm.roll(block.number + 1);

        _swapTokenAToTokenB(100 ether, trader);
        vm.prank(trader);
        assertTrue(AmmPool(pool).transfer(lp, 1));

        uint256 lpBefore = tokenA.balanceOf(lp);
        vm.prank(lp);
        (uint256 claimed0, uint256 claimed1) = AmmPool(pool).claimFees();
        assertGt(claimed0 + claimed1, 0);
        assertGt(tokenA.balanceOf(lp), lpBefore);
    }

    function testSameBlockMintSwapBurnCannotRetainPendingFees() public {
        (address pool,) = _seedTokenPool(1_000 ether, 1_000 ether);
        vm.roll(block.number + 1);

        vm.startPrank(trader);
        tokenA.approve(address(router), 500 ether);
        tokenB.approve(address(router), 500 ether);
        (,, uint256 liquidity) = router.addLiquidity(
            address(tokenA), address(tokenB), 500 ether, 500 ether, 500 ether, 500 ether, trader, block.timestamp
        );
        tokenA.approve(address(router), 100 ether);
        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);
        router.swapExactTokensForTokens(100 ether, 1, path, receiver, block.timestamp);
        AmmPool(pool).approve(address(router), liquidity);
        router.removeLiquidity(address(tokenA), address(tokenB), liquidity, 1, 1, trader, block.timestamp);
        vm.stopPrank();

        vm.roll(block.number + 1);
        uint256 traderBefore = tokenA.balanceOf(trader);
        vm.prank(trader);
        (uint256 traderClaimed0, uint256 traderClaimed1) = AmmPool(pool).claimFees();
        assertEq(traderClaimed0 + traderClaimed1, 0);
        assertEq(tokenA.balanceOf(trader), traderBefore);

        uint256 lpBefore = tokenA.balanceOf(lp);
        vm.prank(lp);
        AmmPool(pool).claimFees();
        assertGt(tokenA.balanceOf(lp), lpBefore);
    }

    function testBurnCrystallizesAccruedFeesToLiquidityOwner() public {
        (address pool,) = _seedTokenPool(1_000 ether, 1_000 ether);
        vm.roll(block.number + 1);
        _swapTokenAToTokenB(100 ether, trader);
        uint256 liquidity = AmmPool(pool).balanceOf(lp);

        vm.startPrank(lp);
        AmmPool(pool).approve(address(router), liquidity);
        router.removeLiquidity(address(tokenA), address(tokenB), liquidity, 1, 1, lp, block.timestamp);
        uint256 beforeClaim = tokenA.balanceOf(lp);
        AmmPool(pool).claimFees();
        vm.stopPrank();

        assertGt(tokenA.balanceOf(lp), beforeClaim);
    }

    function testSwapFeeRoundsUpConsistentlyAndCannotBeAvoidedBySplitting() public {
        (address pool,) = _seedTokenPool(1_000 ether, 1_000 ether);
        address fees = AmmPool(pool).poolFees();

        uint256 quoted = AmmPool(pool).getAmountOut(1_667, address(tokenA));
        (uint112 reserveIn, uint112 reserveOut) = _orderedReserves(pool, address(tokenA));
        uint256 expectedAfterFee = 1_661;
        assertEq(quoted, expectedAfterFee * reserveOut / (reserveIn + expectedAfterFee));

        _swapTokenAToTokenB(1_667, trader);
        _swapTokenAToTokenB(1_667, trader);

        uint256 splitFee = tokenA.balanceOf(fees);
        uint256 unsplitFee = 11;
        assertEq(splitFee, 12);
        assertGt(splitFee, unsplitFee);
    }

    function testProtocolFeeRoundingCarriesAcrossSmallSwaps() public {
        factory.setProtocolFeeRecipient(protocolFeeRecipient);
        (address pool,) = _seedTokenPool(1_000 ether, 1_000 ether);

        for (uint256 i; i < 10; ++i) {
            _swapTokenAToTokenB(334, trader);
        }

        assertEq(tokenA.balanceOf(protocolFeeRecipient), 1);
        assertEq(tokenA.balanceOf(AmmPool(pool).poolFees()), 19);
        if (AmmPool(pool).token0() == address(tokenA)) assertEq(AmmPool(pool).protocolFeeRemainder0(), 0);
        else assertEq(AmmPool(pool).protocolFeeRemainder1(), 0);
    }

    function testLpFeeIndexCarriesSubIndexRemainders() public {
        (address pool,) = _seedTokenPool(1_000 ether, 1_000 ether);
        _swapTokenAToTokenB(334, trader);

        uint256 expectedRemainder = 2 * 1e18;
        if (AmmPool(pool).token0() == address(tokenA)) {
            assertEq(AmmPool(pool).index0(), 0);
            assertEq(AmmPool(pool).lpFeeIndexRemainder0(), expectedRemainder);
        } else {
            assertEq(AmmPool(pool).index1(), 0);
            assertEq(AmmPool(pool).lpFeeIndexRemainder1(), expectedRemainder);
        }
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

    function testTwapRejectsRequestsOlderThanRecordedHistory() public {
        (address pool,) = _seedTokenPool(1_000 ether, 1_000 ether);
        vm.warp(block.timestamp + 1 hours);

        vm.expectPartialRevert(AmmPool.InsufficientObservationHistory.selector);
        AmmPool(pool).sample(address(tokenA), 1 ether, 2, 1 hours);
    }

    function testInitialMintOverwritesSameTimestampZeroReserveObservation() public {
        (address pool,) = _seedTokenPool(1_000 ether, 1_000 ether);
        assertEq(AmmPool(pool).observationLength(), 1);
        vm.warp(block.timestamp + 1 hours);

        uint256[] memory sampled = AmmPool(pool).sample(address(tokenA), 1 ether, 1, 10 minutes);
        assertEq(sampled[0], 1 ether);
    }

    function testMultipleSameBlockUpdatesOverwriteLatestObservationReserves() public {
        (address pool,) = _seedTokenPool(1_000 ether, 1_000 ether);
        vm.warp(block.timestamp + 1 hours);

        tokenA.mint(pool, 1_000 ether);
        AmmPool(pool).syncExcess();
        uint256 observationLength = AmmPool(pool).observationLength();

        tokenB.mint(pool, 500 ether);
        AmmPool(pool).syncExcess();
        assertEq(AmmPool(pool).observationLength(), observationLength);

        (,,, uint112 observedReserve0, uint112 observedReserve1) = AmmPool(pool).observations(observationLength - 1);
        (uint112 reserve0, uint112 reserve1,) = AmmPool(pool).getReserves();
        assertEq(observedReserve0, reserve0);
        assertEq(observedReserve1, reserve1);

        vm.warp(block.timestamp + 10 minutes);
        uint256[] memory sampled = AmmPool(pool).sample(address(tokenA), 1 ether, 1, 10 minutes);
        assertEq(sampled[0], 0.75 ether);
    }

    function testTwapUsesOrderedHistoryAcrossUint32Rollover() public {
        vm.warp(uint256(type(uint32).max) - 10);
        (address pool,) = _seedTokenPool(1_000 ether, 1_000 ether);
        vm.warp(uint256(type(uint32).max) + 10);

        _swapTokenAToTokenB(10 ether, trader);

        (,, uint32 truncatedTimestamp) = AmmPool(pool).getReserves();
        assertEq(truncatedTimestamp, 9);
        uint64 observationTimestamp = AmmPool(pool).observationTimestampAt(AmmPool(pool).observationLength() - 1);
        assertGt(observationTimestamp, type(uint32).max);

        uint256[] memory sampled = AmmPool(pool).sample(address(tokenA), 1 ether, 1, 20);
        assertEq(sampled[0], 1 ether);
    }

    function testFeeManagerCanRecoverOrSyncOnlyBoundedExcessBalances() public {
        (address pool,) = _seedTokenPool(1_000 ether, 1_000 ether);
        (uint112 reserve0Before, uint112 reserve1Before,) = AmmPool(pool).getReserves();
        tokenA.mint(pool, 10 ether);
        tokenB.mint(pool, 20 ether);

        vm.prank(trader);
        vm.expectRevert(AmmPool.OnlyFeeManager.selector);
        AmmPool(pool).recoverExcess(receiver);

        uint256 receiverABefore = tokenA.balanceOf(receiver);
        uint256 receiverBBefore = tokenB.balanceOf(receiver);
        (uint256 recovered0, uint256 recovered1) = AmmPool(pool).recoverExcess(receiver);
        assertEq(recovered0 + recovered1, 30 ether);
        assertEq(tokenA.balanceOf(receiver) - receiverABefore, 10 ether);
        assertEq(tokenB.balanceOf(receiver) - receiverBBefore, 20 ether);
        (uint112 reserve0AfterRecovery, uint112 reserve1AfterRecovery,) = AmmPool(pool).getReserves();
        assertEq(reserve0AfterRecovery, reserve0Before);
        assertEq(reserve1AfterRecovery, reserve1Before);

        tokenA.mint(pool, 3 ether);
        tokenB.mint(pool, 4 ether);
        AmmPool(pool).syncExcess();
        (uint112 reserve0AfterSync, uint112 reserve1AfterSync,) = AmmPool(pool).getReserves();
        assertEq(uint256(reserve0AfterSync) + reserve1AfterSync, uint256(reserve0Before) + reserve1Before + 7 ether);

        vm.expectRevert(AmmPool.NoExcessBalance.selector);
        AmmPool(pool).syncExcess();
    }

    function testUninitializedPoolCannotSyncOneSidedDonation() public {
        address pool = factory.createPool(address(tokenA), address(tokenB));
        tokenA.mint(pool, 10 ether);

        vm.expectRevert(AmmPool.PoolNotInitialized.selector);
        AmmPool(pool).syncExcess();

        (uint256 recovered0, uint256 recovered1) = AmmPool(pool).recoverExcess(receiver);
        assertEq(recovered0 + recovered1, 10 ether);
        assertEq(tokenA.balanceOf(receiver), 10 ether);
    }

    function testUntrackedDonationIsPublicSwapInputBeforeManagerRecovery() public {
        (address pool,) = _seedTokenPool(1_000 ether, 1_000 ether);
        uint256 donated = 10 ether;
        tokenA.mint(pool, donated);

        uint256 amountOut = AmmPool(pool).getAmountOut(donated, address(tokenA));
        (uint256 amount0Out, uint256 amount1Out) =
            AmmPool(pool).token0() == address(tokenA) ? (uint256(0), amountOut) : (amountOut, uint256(0));

        uint256 receiverBefore = tokenB.balanceOf(receiver);
        vm.prank(trader);
        AmmPool(pool).swap(amount0Out, amount1Out, receiver, "");

        assertEq(tokenB.balanceOf(receiver) - receiverBefore, amountOut);
        vm.expectRevert(AmmPool.NoExcessBalance.selector);
        AmmPool(pool).recoverExcess(receiver);
    }

    function testRotatedFeeManagerControlsExcessOperations() public {
        (address pool,) = _seedTokenPool(1_000 ether, 1_000 ether);
        tokenA.mint(pool, 1 ether);
        factory.setFeeManager(receiver);

        vm.expectRevert(AmmPool.OnlyFeeManager.selector);
        AmmPool(pool).recoverExcess(receiver);

        vm.prank(receiver);
        (uint256 recovered0, uint256 recovered1) = AmmPool(pool).recoverExcess(receiver);
        assertEq(recovered0 + recovered1, 1 ether);
    }

    function testExcessOperationsRejectNegativeRebaseWithClearError() public {
        (address pool,) = _seedTokenPool(1_000 ether, 1_000 ether);
        (uint112 reserve0, uint112 reserve1,) = AmmPool(pool).getReserves();
        tokenA.burn(pool, 1 ether);

        address sorted0 = AmmPool(pool).token0();
        uint256 expectedReserve = sorted0 == address(tokenA) ? reserve0 : reserve1;
        vm.expectRevert(
            abi.encodeWithSelector(AmmPool.BalanceBelowReserve.selector, address(tokenA), 999 ether, expectedReserve)
        );
        AmmPool(pool).syncExcess();

        vm.expectPartialRevert(AmmPool.BalanceBelowReserve.selector);
        AmmPool(pool).mint(receiver);
    }

    function testRouterQuoteUsesFullPrecisionMath() public view {
        assertEq(router.quote(type(uint256).max, 2, 2), type(uint256).max);
    }

    function testInitialMintChecksReserveCapsBeforeProductMath() public {
        AmmTestERC20 hugeA = new AmmTestERC20("Huge A", "HUGEA", 18);
        AmmTestERC20 hugeB = new AmmTestERC20("Huge B", "HUGEB", 18);
        address provider = address(0xB16);
        uint256 amount = uint256(type(uint112).max) + 1;
        hugeA.mint(provider, amount);
        hugeB.mint(provider, amount);

        vm.startPrank(provider);
        hugeA.approve(address(router), amount);
        hugeB.approve(address(router), amount);
        vm.expectRevert(AmmPool.ReserveOverflow.selector);
        router.addLiquidity(address(hugeA), address(hugeB), amount, amount, amount, amount, provider, block.timestamp);
        vm.stopPrank();

        assertEq(factory.getPool(address(hugeA), address(hugeB)), address(0));
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

    function testNativeFlowsRejectZeroRecipients() public {
        vm.startPrank(lp);
        tokenA.approve(address(router), 1_000 ether);
        (,, uint256 liquidity) = router.addLiquidityNative{value: 10 ether}(
            address(tokenA), 1_000 ether, 1_000 ether, 10 ether, lp, block.timestamp
        );
        address pool = factory.getPool(address(tokenA), address(wrappedNative));
        AmmPool(pool).approve(address(router), liquidity);
        vm.expectRevert(AmmRouter.InvalidAddress.selector);
        router.removeLiquidityNative(address(tokenA), liquidity, 1, 1, address(0), block.timestamp);
        vm.stopPrank();

        address[] memory tokenToNative = new address[](2);
        tokenToNative[0] = address(tokenA);
        tokenToNative[1] = address(wrappedNative);
        vm.startPrank(trader);
        tokenA.approve(address(router), 1 ether);
        vm.expectRevert(AmmRouter.InvalidAddress.selector);
        router.swapExactTokensForNative(1 ether, 1, tokenToNative, address(0), block.timestamp);
        vm.stopPrank();
    }

    function testCyclicRouteMeasuresGrossSameTokenOutputAfterInputTransfer() public {
        AmmTestERC20 tokenC = new AmmTestERC20("Token C", "TKNC", 18);
        tokenC.mint(lp, 10_000 ether);
        tokenC.mint(trader, 10_000 ether);
        _seedTokenPool(1_000 ether, 1_000 ether);

        vm.startPrank(lp);
        tokenB.approve(address(router), 1_000 ether);
        tokenC.approve(address(router), 2_000 ether);
        router.addLiquidity(
            address(tokenB), address(tokenC), 1_000 ether, 1_000 ether, 1_000 ether, 1_000 ether, lp, block.timestamp
        );
        tokenA.approve(address(router), 1_000 ether);
        router.addLiquidity(
            address(tokenC), address(tokenA), 1_000 ether, 1_000 ether, 1_000 ether, 1_000 ether, lp, block.timestamp
        );
        vm.stopPrank();

        address[] memory path = new address[](4);
        path[0] = address(tokenA);
        path[1] = address(tokenB);
        path[2] = address(tokenC);
        path[3] = address(tokenA);
        uint256 amountIn = 10 ether;
        uint256 beforeBalance = tokenA.balanceOf(trader);
        vm.startPrank(trader);
        tokenA.approve(address(router), amountIn);
        uint256[] memory amounts = router.swapExactTokensForTokens(amountIn, 1, path, trader, block.timestamp);
        vm.stopPrank();

        assertEq(tokenA.balanceOf(trader), beforeBalance - amountIn + amounts[3]);
        assertGt(amounts[3], 0);
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

        address[] memory repeatedPoolPath = new address[](3);
        repeatedPoolPath[0] = address(tokenA);
        repeatedPoolPath[1] = address(tokenB);
        repeatedPoolPath[2] = address(tokenA);
        vm.expectRevert(AmmRouter.InvalidPath.selector);
        router.getAmountsOut(100 ether, repeatedPoolPath);
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

    function testRouterRejectsSenderSurchargeOnLiquidityInput() public {
        AmmTestSenderSurchargeToken surchargeToken = new AmmTestSenderSurchargeToken();
        AmmTestERC20 otherToken = new AmmTestERC20("Other", "OTHR", 18);
        surchargeToken.mint(lp, 1_010 ether);
        otherToken.mint(lp, 1_000 ether);
        surchargeToken.setSurchargedSender(lp);

        vm.startPrank(lp);
        surchargeToken.approve(address(router), 1_000 ether);
        otherToken.approve(address(router), 1_000 ether);
        vm.expectRevert(
            abi.encodeWithSelector(
                AmmRouter.TransferAmountMismatch.selector, address(surchargeToken), 1_000 ether, 1_010 ether
            )
        );
        router.addLiquidity(
            address(surchargeToken),
            address(otherToken),
            1_000 ether,
            1_000 ether,
            1_000 ether,
            1_000 ether,
            lp,
            block.timestamp
        );
        vm.stopPrank();

        assertEq(surchargeToken.balanceOf(lp), 1_010 ether);
        assertEq(factory.getPool(address(surchargeToken), address(otherToken)), address(0));
    }

    function testRouterRejectsSenderSurchargeWhenForwardingNativeLiquidityOutput() public {
        AmmTestSenderSurchargeToken surchargeToken = new AmmTestSenderSurchargeToken();
        surchargeToken.mint(lp, 1_000 ether);

        vm.startPrank(lp);
        surchargeToken.approve(address(router), 1_000 ether);
        (,, uint256 liquidity) = router.addLiquidityNative{value: 10 ether}(
            address(surchargeToken), 1_000 ether, 1_000 ether, 10 ether, lp, block.timestamp
        );
        address pool = factory.getPool(address(surchargeToken), address(wrappedNative));
        AmmPool(pool).approve(address(router), liquidity);
        vm.stopPrank();

        surchargeToken.setSurchargedSender(address(router));
        surchargeToken.mint(address(router), 100 ether);

        vm.prank(lp);
        vm.expectPartialRevert(AmmRouter.TransferAmountMismatch.selector);
        router.removeLiquidityNative(address(surchargeToken), liquidity, 1, 1, lp, block.timestamp);

        assertEq(AmmPool(pool).balanceOf(lp), liquidity);
        assertEq(surchargeToken.balanceOf(address(router)), 100 ether);
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
        vm.roll(block.number + 1);

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

    function _orderedReserves(address pool, address input)
        internal
        view
        returns (uint112 reserveIn, uint112 reserveOut)
    {
        (uint112 reserve0, uint112 reserve1,) = AmmPool(pool).getReserves();
        return AmmPool(pool).token0() == input ? (reserve0, reserve1) : (reserve1, reserve0);
    }
}
