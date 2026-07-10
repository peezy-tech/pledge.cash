// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";
import {ERC20} from "solady/tokens/ERC20.sol";
import {WETH} from "solady/tokens/WETH.sol";
import {AmmFactory} from "../../src/amm/AmmFactory.sol";
import {AmmPool} from "../../src/amm/AmmPool.sol";
import {AmmRouter} from "../../src/amm/AmmRouter.sol";

contract AmmInvariantERC20 is ERC20 {
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

contract AmmInvariantHandler is Test {
    AmmRouter public immutable router;
    AmmPool public immutable pool;
    AmmInvariantERC20 public immutable token0;
    AmmInvariantERC20 public immutable token1;

    address[] public actors;

    constructor(AmmRouter router_, AmmPool pool_, AmmInvariantERC20 token0_, AmmInvariantERC20 token1_) {
        router = router_;
        pool = pool_;
        token0 = token0_;
        token1 = token1_;

        actors.push(address(0xA11CE));
        actors.push(address(0xB0B));
        actors.push(address(0xCAFE));
        actors.push(address(0xD00D));
    }

    function addLiquidity(uint256 actorSeed, uint256 amount0Seed, uint256 amount1Seed) external {
        address actor = _actor(actorSeed);
        uint256 amount0 = bound(amount0Seed, 1e12, 25 ether);
        uint256 amount1 = bound(amount1Seed, 1e12, 25 ether);

        token0.mint(actor, amount0);
        token1.mint(actor, amount1);

        vm.startPrank(actor);
        token0.approve(address(router), amount0);
        token1.approve(address(router), amount1);
        try router.addLiquidity(address(token0), address(token1), amount0, amount1, 1, 1, actor, block.timestamp) {}
            catch {}
        vm.stopPrank();
    }

    function removeLiquidity(uint256 actorSeed, uint256 liquiditySeed) external {
        address actor = _actor(actorSeed);
        uint256 balance = pool.balanceOf(actor);
        if (balance == 0) return;

        uint256 liquidity = bound(liquiditySeed, 1, balance);
        vm.startPrank(actor);
        pool.approve(address(router), liquidity);
        try router.removeLiquidity(address(token0), address(token1), liquidity, 1, 1, actor, block.timestamp) {}
            catch {}
        vm.stopPrank();
    }

    function swap0For1(uint256 actorSeed, uint256 amountSeed) external {
        _swap(actorSeed, amountSeed, true);
    }

    function swap1For0(uint256 actorSeed, uint256 amountSeed) external {
        _swap(actorSeed, amountSeed, false);
    }

    function transferLp(uint256 fromSeed, uint256 toSeed, uint256 amountSeed) external {
        address from = _actor(fromSeed);
        address to = _actor(toSeed);
        if (from == to) return;

        uint256 balance = pool.balanceOf(from);
        if (balance == 0) return;

        uint256 amount = bound(amountSeed, 1, balance);
        vm.prank(from);
        try pool.transfer(to, amount) {} catch {}
    }

    function claimFees(uint256 actorSeed) external {
        address actor = _actor(actorSeed);
        vm.prank(actor);
        try pool.claimFees() {} catch {}
    }

    function actorAt(uint256 index) external view returns (address) {
        return actors[index];
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function _swap(uint256 actorSeed, uint256 amountSeed, bool zeroForOne) internal {
        address actor = _actor(actorSeed);
        uint256 amount = bound(amountSeed, 1e9, 20 ether);
        AmmInvariantERC20 input = zeroForOne ? token0 : token1;
        AmmInvariantERC20 output = zeroForOne ? token1 : token0;

        input.mint(actor, amount);

        address[] memory path = new address[](2);
        path[0] = address(input);
        path[1] = address(output);

        vm.startPrank(actor);
        input.approve(address(router), amount);
        try router.swapExactTokensForTokens(amount, 1, path, actor, block.timestamp) {} catch {}
        vm.stopPrank();
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[bound(seed, 0, actors.length - 1)];
    }
}

contract AmmInvariantTest is StdInvariant, Test {
    AmmFactory internal factory;
    WETH internal wrappedNative;
    AmmRouter internal router;
    AmmPool internal pool;
    AmmInvariantERC20 internal token0;
    AmmInvariantERC20 internal token1;
    AmmInvariantHandler internal handler;

    address internal initialLp = address(0xA11CE);
    mapping(address => bool) public isShareToken;

    function setUp() public {
        factory = new AmmFactory(address(this), address(this));
        wrappedNative = new WETH();
        router = new AmmRouter(address(factory), address(wrappedNative));
        token0 = new AmmInvariantERC20("Invariant A", "INVA", 18);
        token1 = new AmmInvariantERC20("Invariant B", "INVB", 18);

        token0.mint(initialLp, 1_000 ether);
        token1.mint(initialLp, 1_000 ether);

        vm.startPrank(initialLp);
        token0.approve(address(router), 1_000 ether);
        token1.approve(address(router), 1_000 ether);
        router.addLiquidity(
            address(token0),
            address(token1),
            1_000 ether,
            1_000 ether,
            1_000 ether,
            1_000 ether,
            initialLp,
            block.timestamp
        );
        vm.stopPrank();

        pool = AmmPool(factory.getPool(address(token0), address(token1)));
        handler = new AmmInvariantHandler(router, pool, token0, token1);
        targetContract(address(handler));
    }

    function invariantReservesMatchPoolBalances() public view {
        (uint112 reserve0, uint112 reserve1,) = pool.getReserves();
        (address sorted0,) = factory.sortTokens(address(token0), address(token1));
        if (address(token0) == sorted0) {
            assertEq(token0.balanceOf(address(pool)), reserve0);
            assertEq(token1.balanceOf(address(pool)), reserve1);
            return;
        }

        assertEq(token1.balanceOf(address(pool)), reserve0);
        assertEq(token0.balanceOf(address(pool)), reserve1);
    }

    function invariantFeeClaimsAreBackedByFeeVault() public view {
        address fees = pool.poolFees();
        uint256 pending0 = pool.pendingBurnRedistribution0();
        uint256 pending1 = pool.pendingBurnRedistribution1();
        uint256 actorCount = handler.actorCount();

        for (uint256 i; i < actorCount; ++i) {
            address actor = handler.actorAt(i);
            pending0 += _pending0(actor);
            pending1 += _pending1(actor);
        }

        assertLe(pending0, ERC20(pool.token0()).balanceOf(fees));
        assertLe(pending1, ERC20(pool.token1()).balanceOf(fees));
    }

    function invariantLpSupplyIsAccounted() public view {
        uint256 accounted = pool.balanceOf(address(1));
        uint256 actorCount = handler.actorCount();
        for (uint256 i; i < actorCount; ++i) {
            accounted += pool.balanceOf(handler.actorAt(i));
        }

        assertEq(accounted, pool.totalSupply());
        assertEq(pool.balanceOf(address(1)), pool.MINIMUM_LIQUIDITY());
    }

    function _pending0(address actor) internal view returns (uint256) {
        uint256 accrued = pool.claimable0(actor) + pool.pendingClaimable0(actor);
        uint256 delta = pool.index0() - pool.supplyIndex0(actor);
        return accrued + pool.balanceOf(actor) * delta / 1e18;
    }

    function _pending1(address actor) internal view returns (uint256) {
        uint256 accrued = pool.claimable1(actor) + pool.pendingClaimable1(actor);
        uint256 delta = pool.index1() - pool.supplyIndex1(actor);
        return accrued + pool.balanceOf(actor) * delta / 1e18;
    }
}
