// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "solady/tokens/ERC20.sol";
import {Initializable} from "solady/utils/Initializable.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {AmmPool} from "../amm/AmmPool.sol";

interface ILockedLiquidityRouter {
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB, uint256 liquidity);

    function poolFor(address tokenA, address tokenB) external view returns (address);

    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB);
}

interface ILockedLiquidityBoardroom {
    function lockedLiquidityExitAllowed() external view returns (bool);
}

contract LockedLiquidity is Initializable {
    using SafeTransferLib for address;

    address public factory;
    address public boardroom;
    address public router;
    address public tokenA;
    address public tokenB;
    address public pool;
    bool public seeded;

    error InvalidAddress();
    error OnlyFactory();
    error OnlyBoardroom();
    error AlreadySeeded();
    error NotSeeded();
    error BoardroomNotWindingDown();

    event LockedLiquidityInitialized(address indexed boardroom, address indexed router, address tokenA, address tokenB);
    event LiquidityLocked(address indexed pool, uint256 amountA, uint256 amountB, uint256 liquidity);
    event LiquidityExited(address indexed pool, uint256 liquidity, uint256 amountA, uint256 amountB);
    event FeesForwarded(address indexed boardroom, uint256 amount0, uint256 amount1);

    constructor() {
        _disableInitializers();
    }

    function initialize(address factory_, address boardroom_, address router_, address tokenA_, address tokenB_)
        external
        initializer
    {
        if (
            factory_ == address(0) || boardroom_ == address(0) || router_ == address(0) || tokenA_ == address(0)
                || tokenB_ == address(0) || tokenA_ == tokenB_
        ) revert InvalidAddress();

        factory = factory_;
        boardroom = boardroom_;
        router = router_;
        tokenA = tokenA_;
        tokenB = tokenB_;

        emit LockedLiquidityInitialized(boardroom_, router_, tokenA_, tokenB_);
    }

    function seedLiquidity(
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        uint256 deadline
    ) external returns (address seededPool, uint256 amountA, uint256 amountB, uint256 liquidity) {
        if (msg.sender != factory) revert OnlyFactory();
        if (seeded) revert AlreadySeeded();
        seeded = true;

        tokenA.safeApprove(router, amountADesired);
        tokenB.safeApprove(router, amountBDesired);
        (amountA, amountB, liquidity) = ILockedLiquidityRouter(router)
            .addLiquidity(
                tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin, address(this), deadline
            );
        tokenA.safeApprove(router, 0);
        tokenB.safeApprove(router, 0);

        seededPool = ILockedLiquidityRouter(router).poolFor(tokenA, tokenB);
        pool = seededPool;

        _refundDust(tokenA);
        _refundDust(tokenB);

        emit LiquidityLocked(seededPool, amountA, amountB, liquidity);
    }

    function exitToBoardroom(uint256 amountAMin, uint256 amountBMin, uint256 deadline)
        external
        returns (uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        if (msg.sender != boardroom) revert OnlyBoardroom();
        if (!ILockedLiquidityBoardroom(boardroom).lockedLiquidityExitAllowed()) revert BoardroomNotWindingDown();

        address pool_ = pool;
        if (pool_ == address(0)) revert NotSeeded();

        claimFees();

        liquidity = ERC20(pool_).balanceOf(address(this));
        if (liquidity == 0) {
            emit LiquidityExited(pool_, 0, 0, 0);
            return (0, 0, 0);
        }

        pool_.safeApprove(router, liquidity);
        (amountA, amountB) = ILockedLiquidityRouter(router)
            .removeLiquidity(tokenA, tokenB, liquidity, amountAMin, amountBMin, boardroom, deadline);
        pool_.safeApprove(router, 0);

        emit LiquidityExited(pool_, liquidity, amountA, amountB);
    }

    function lockedLiquidity() external view returns (uint256) {
        if (pool == address(0)) return 0;
        return ERC20(pool).balanceOf(address(this));
    }

    function claimFees() public returns (uint256 claimed0, uint256 claimed1) {
        address pool_ = pool;
        if (pool_ == address(0)) return (0, 0);

        AmmPool(pool_).claimFees();
        (address token0, address token1) = AmmPool(pool_).tokens();
        claimed0 = ERC20(token0).balanceOf(address(this));
        claimed1 = ERC20(token1).balanceOf(address(this));
        if (claimed0 != 0) token0.safeTransfer(boardroom, claimed0);
        if (claimed1 != 0) token1.safeTransfer(boardroom, claimed1);

        emit FeesForwarded(boardroom, claimed0, claimed1);
    }

    function _refundDust(address token) internal {
        uint256 balance = ERC20(token).balanceOf(address(this));
        if (balance != 0) token.safeTransfer(boardroom, balance);
    }
}
