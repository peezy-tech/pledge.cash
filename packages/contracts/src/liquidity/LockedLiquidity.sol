// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "solady/tokens/ERC20.sol";
import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";
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
    using FixedPointMathLib for uint256;
    using SafeTransferLib for address;

    struct ExitQuote {
        uint256 liquidity;
        uint256 poolBalanceA;
        uint256 poolBalanceB;
        uint256 expectedA;
        uint256 expectedB;
    }

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
    error UnexpectedExitAmount(address token, uint256 expected, uint256 received, uint256 poolSpent);

    event LockedLiquidityInitialized(address indexed boardroom, address indexed router, address tokenA, address tokenB);
    event LiquidityLocked(address indexed pool, uint256 amountA, uint256 amountB, uint256 liquidity);
    event LiquidityExited(address indexed pool, uint256 liquidity, uint256 amountA, uint256 amountB);
    event LiquidityReturnedAsLp(address indexed pool, address indexed boardroom, uint256 liquidity);
    event FeesForwarded(address indexed boardroom, uint256 amount0, uint256 amount1);

    constructor() {
        _disableInitializers();
    }

    function initialize(address factory_, address boardroom_, address router_, address tokenA_, address tokenB_)
        external
        initializer
    {
        if (_hasInvalidInitializationAddress(factory_, boardroom_, router_, tokenA_, tokenB_)) revert InvalidAddress();

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
        _requireFactoryCaller();
        _requireUnseeded();

        seeded = true;

        _approveRouterForSeed(amountADesired, amountBDesired);
        (amountA, amountB, liquidity) = ILockedLiquidityRouter(router)
            .addLiquidity(
                tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin, address(this), deadline
            );
        _clearRouterSeedApproval();

        seededPool = ILockedLiquidityRouter(router).poolFor(tokenA, tokenB);
        pool = seededPool;

        _refundSeedDust();

        emit LiquidityLocked(seededPool, amountA, amountB, liquidity);
    }

    function exitToBoardroom(uint256 amountAMin, uint256 amountBMin, uint256 deadline)
        external
        returns (uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        _requireBoardroomCaller();
        _requireBoardroomCanExit();

        address pool_ = pool;
        if (pool_ == address(0)) revert NotSeeded();

        claimFees();

        ExitQuote memory quote = _quoteExit(pool_);
        liquidity = quote.liquidity;
        if (liquidity == 0) {
            emit LiquidityExited(pool_, 0, 0, 0);
            return (0, 0, 0);
        }

        pool_.safeApprove(router, liquidity);
        (amountA, amountB) = ILockedLiquidityRouter(router)
            .removeLiquidity(
                tokenA,
                tokenB,
                liquidity,
                amountAMin > quote.expectedA ? amountAMin : quote.expectedA,
                amountBMin > quote.expectedB ? amountBMin : quote.expectedB,
                boardroom,
                deadline
            );
        pool_.safeApprove(router, 0);

        _requireExactExit(tokenA, pool_, quote.poolBalanceA, quote.expectedA, amountA);
        _requireExactExit(tokenB, pool_, quote.poolBalanceB, quote.expectedB, amountB);

        emit LiquidityExited(pool_, liquidity, amountA, amountB);
    }

    /// @notice Terminal fallback that preserves the pool claim when an underlying token blocks a normal exit.
    function returnLpToBoardroom() external returns (uint256 liquidity) {
        _requireBoardroomCaller();
        _requireBoardroomCanExit();

        address pool_ = pool;
        if (pool_ == address(0)) revert NotSeeded();

        liquidity = ERC20(pool_).balanceOf(address(this));
        if (liquidity != 0) pool_.safeTransfer(boardroom, liquidity);

        emit LiquidityReturnedAsLp(pool_, boardroom, liquidity);
    }

    function lockedLiquidity() external view returns (uint256) {
        if (pool == address(0)) return 0;
        return ERC20(pool).balanceOf(address(this));
    }

    function claimFees() public returns (uint256 claimed0, uint256 claimed1) {
        address pool_ = pool;
        if (pool_ == address(0)) return (0, 0);

        AmmPool feePool = AmmPool(pool_);
        feePool.claimFees();

        (address token0, address token1) = feePool.tokens();
        claimed0 = _forwardTokenBalance(token0);
        claimed1 = _forwardTokenBalance(token1);

        emit FeesForwarded(boardroom, claimed0, claimed1);
    }

    function _hasInvalidInitializationAddress(
        address factory_,
        address boardroom_,
        address router_,
        address tokenA_,
        address tokenB_
    ) internal pure returns (bool) {
        if (factory_ == address(0)) return true;
        if (boardroom_ == address(0)) return true;
        if (router_ == address(0)) return true;
        if (tokenA_ == address(0)) return true;
        if (tokenB_ == address(0)) return true;
        return tokenA_ == tokenB_;
    }

    function _requireFactoryCaller() internal view {
        if (msg.sender != factory) revert OnlyFactory();
    }

    function _requireBoardroomCaller() internal view {
        if (msg.sender != boardroom) revert OnlyBoardroom();
    }

    function _requireUnseeded() internal view {
        if (seeded) revert AlreadySeeded();
    }

    function _requireBoardroomCanExit() internal view {
        if (!ILockedLiquidityBoardroom(boardroom).lockedLiquidityExitAllowed()) revert BoardroomNotWindingDown();
    }

    function _approveRouterForSeed(uint256 amountADesired, uint256 amountBDesired) internal {
        tokenA.safeApprove(router, amountADesired);
        tokenB.safeApprove(router, amountBDesired);
    }

    function _clearRouterSeedApproval() internal {
        tokenA.safeApprove(router, 0);
        tokenB.safeApprove(router, 0);
    }

    function _refundSeedDust() internal {
        _refundDust(tokenA);
        _refundDust(tokenB);
    }

    function _forwardTokenBalance(address token) internal returns (uint256 balance) {
        balance = ERC20(token).balanceOf(address(this));
        if (balance != 0) token.safeTransfer(boardroom, balance);
    }

    function _refundDust(address token) internal {
        uint256 balance = ERC20(token).balanceOf(address(this));
        if (balance != 0) token.safeTransfer(boardroom, balance);
    }

    function _quoteExit(address pool_) internal view returns (ExitQuote memory quote) {
        quote.liquidity = ERC20(pool_).balanceOf(address(this));
        if (quote.liquidity == 0) return quote;

        uint256 supply = ERC20(pool_).totalSupply();
        quote.poolBalanceA = ERC20(tokenA).balanceOf(pool_);
        quote.poolBalanceB = ERC20(tokenB).balanceOf(pool_);
        quote.expectedA = quote.poolBalanceA.fullMulDiv(quote.liquidity, supply);
        quote.expectedB = quote.poolBalanceB.fullMulDiv(quote.liquidity, supply);
    }

    function _requireExactExit(
        address token,
        address pool_,
        uint256 poolBalanceBefore,
        uint256 expected,
        uint256 received
    ) internal view {
        uint256 poolBalanceAfter = ERC20(token).balanceOf(pool_);
        uint256 poolSpent = poolBalanceAfter > poolBalanceBefore ? 0 : poolBalanceBefore - poolBalanceAfter;
        if (received != expected || poolSpent != expected) {
            revert UnexpectedExitAmount(token, expected, received, poolSpent);
        }
    }
}
