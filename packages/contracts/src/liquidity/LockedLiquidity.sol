// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "solady/tokens/ERC20.sol";
import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";
import {Initializable} from "solady/utils/Initializable.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {AmmPool} from "../amm/AmmPool.sol";
import {ExactTransferLib} from "../lib/ExactTransferLib.sol";

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

    function liquidityMutationAllowed() external view returns (bool);
}

/// @notice The one lifetime protocol-owned liquidity custodian for a Boardroom.
contract LockedLiquidity is Initializable, ReentrancyGuard {
    using FixedPointMathLib for uint256;
    using SafeTransferLib for address;

    enum LiquidityState {
        Unconfigured,
        Active,
        Closed
    }

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
    LiquidityState public liquidityState;

    error InvalidAddress();
    error InvalidAmount();
    error OnlyFactory();
    error OnlyBoardroom();
    error InvalidLiquidityState(LiquidityState expected, LiquidityState actual);
    error BoardroomMutationForbidden();
    error BoardroomNotWindingDown();
    error CanonicalPoolMismatch(address expected, address actual);
    error PositionNotEmpty(uint256 liquidity);
    error UnexpectedExitAmount(address token, uint256 expected, uint256 received, uint256 poolSpent);
    error UnexpectedTokenTransfer(address token, uint256 expected, uint256 senderSpent, uint256 recipientReceived);

    event LockedLiquidityInitialized(address indexed boardroom, address indexed router, address tokenA, address tokenB);
    event LiquidityAdded(address indexed pool, uint256 amountA, uint256 amountB, uint256 liquidity);
    event LiquidityRemoved(address indexed pool, uint256 liquidity, uint256 amountA, uint256 amountB);
    event LiquidityReturnedAsLp(address indexed pool, address indexed boardroom, uint256 liquidity);
    event LiquidityClosed(address indexed pool);
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

    function addLiquidity(
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        uint256 deadline
    ) external nonReentrant returns (address canonicalPool, uint256 amountA, uint256 amountB, uint256 liquidity) {
        _requireFactoryCaller();
        _requireBoardroomMutation();
        if (liquidityState == LiquidityState.Closed) {
            revert InvalidLiquidityState(LiquidityState.Active, liquidityState);
        }
        if (amountADesired == 0 || amountBDesired == 0) revert InvalidAmount();

        tokenA.safeApprove(router, amountADesired);
        tokenB.safeApprove(router, amountBDesired);
        (amountA, amountB, liquidity) = ILockedLiquidityRouter(router)
            .addLiquidity(
                tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin, address(this), deadline
            );
        tokenA.safeApprove(router, 0);
        tokenB.safeApprove(router, 0);

        canonicalPool = ILockedLiquidityRouter(router).poolFor(tokenA, tokenB);
        if (canonicalPool == address(0)) revert InvalidAddress();
        if (liquidityState == LiquidityState.Unconfigured) {
            pool = canonicalPool;
            liquidityState = LiquidityState.Active;
        } else if (canonicalPool != pool) {
            revert CanonicalPoolMismatch(pool, canonicalPool);
        }

        _refundDust(tokenA);
        _refundDust(tokenB);
        emit LiquidityAdded(canonicalPool, amountA, amountB, liquidity);
    }

    function removeLiquidityToBoardroom(uint256 liquidity, uint256 amountAMin, uint256 amountBMin, uint256 deadline)
        external
        nonReentrant
        returns (uint256 amountA, uint256 amountB)
    {
        _requireFactoryCaller();
        _requireBoardroomMutation();
        return _removeLiquidity(liquidity, amountAMin, amountBMin, deadline);
    }

    function exitToBoardroom(uint256 amountAMin, uint256 amountBMin, uint256 deadline)
        external
        nonReentrant
        returns (uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        _requireBoardroomCaller();
        _requireBoardroomCanExit();
        liquidity = lockedLiquidity();
        if (liquidity == 0) return (0, 0, 0);
        (amountA, amountB) = _removeLiquidity(liquidity, amountAMin, amountBMin, deadline);
    }

    function returnLpToBoardroom() external nonReentrant returns (uint256 liquidity) {
        _requireBoardroomCaller();
        _requireBoardroomCanExit();
        _requireActive();
        liquidity = lockedLiquidity();
        if (liquidity != 0) pool.safeTransfer(boardroom, liquidity);
        emit LiquidityReturnedAsLp(pool, boardroom, liquidity);
    }

    function close() external nonReentrant {
        if (msg.sender == factory) {
            _requireBoardroomMutation();
        } else {
            _requireBoardroomCaller();
            _requireBoardroomCanExit();
        }
        _requireActive();
        uint256 liquidity = lockedLiquidity();
        if (liquidity != 0) revert PositionNotEmpty(liquidity);
        liquidityState = LiquidityState.Closed;
        emit LiquidityClosed(pool);
    }

    function claimFees() external nonReentrant returns (uint256 claimed0, uint256 claimed1) {
        _requireBoardroomMutation();
        return _claimFees();
    }

    function isClosed() external view returns (bool) {
        return liquidityState == LiquidityState.Closed;
    }

    function lockedLiquidity() public view returns (uint256) {
        address pool_ = pool;
        return pool_ == address(0) ? 0 : ERC20(pool_).balanceOf(address(this));
    }

    function _removeLiquidity(uint256 liquidity, uint256 amountAMin, uint256 amountBMin, uint256 deadline)
        internal
        returns (uint256 amountA, uint256 amountB)
    {
        _requireActive();
        uint256 available = lockedLiquidity();
        if (liquidity == 0 || liquidity > available) revert InvalidAmount();
        _claimFees();

        ExitQuote memory quote = _quoteExit(liquidity);
        pool.safeApprove(router, liquidity);
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
        pool.safeApprove(router, 0);

        _requireExactExit(tokenA, quote.poolBalanceA, quote.expectedA, amountA);
        _requireExactExit(tokenB, quote.poolBalanceB, quote.expectedB, amountB);
        emit LiquidityRemoved(pool, liquidity, amountA, amountB);
    }

    function _claimFees() internal returns (uint256 claimed0, uint256 claimed1) {
        _requireActive();
        AmmPool feePool = AmmPool(pool);
        feePool.claimFees();
        (address token0, address token1) = feePool.tokens();
        claimed0 = _forwardTokenBalance(token0);
        claimed1 = _forwardTokenBalance(token1);
        emit FeesForwarded(boardroom, claimed0, claimed1);
    }

    function _quoteExit(uint256 liquidity) internal view returns (ExitQuote memory quote) {
        quote.liquidity = liquidity;
        uint256 supply = ERC20(pool).totalSupply();
        quote.poolBalanceA = ERC20(tokenA).balanceOf(pool);
        quote.poolBalanceB = ERC20(tokenB).balanceOf(pool);
        quote.expectedA = quote.poolBalanceA.fullMulDiv(liquidity, supply);
        quote.expectedB = quote.poolBalanceB.fullMulDiv(liquidity, supply);
    }

    function _requireExactExit(address token, uint256 poolBalanceBefore, uint256 expected, uint256 received)
        internal
        view
    {
        uint256 poolBalanceAfter = ERC20(token).balanceOf(pool);
        uint256 poolSpent = poolBalanceAfter > poolBalanceBefore ? 0 : poolBalanceBefore - poolBalanceAfter;
        if (received != expected || poolSpent != expected) {
            revert UnexpectedExitAmount(token, expected, received, poolSpent);
        }
    }

    function _forwardTokenBalance(address token) internal returns (uint256 balance) {
        balance = ERC20(token).balanceOf(address(this));
        if (balance != 0) _transferExactToBoardroom(token, balance);
    }

    function _refundDust(address token) internal {
        uint256 balance = ERC20(token).balanceOf(address(this));
        if (balance != 0) _transferExactToBoardroom(token, balance);
    }

    function _transferExactToBoardroom(address token, uint256 amount) internal {
        ExactTransferLib.ExactDelta memory delta = ExactTransferLib.sendFromSelfTo(token, boardroom, amount);
        if (
            delta.senderBalanceIncreased || delta.recipientBalanceDecreased || delta.senderSpent != amount
                || delta.recipientReceived != amount
        ) revert UnexpectedTokenTransfer(token, amount, delta.senderSpent, delta.recipientReceived);
    }

    function _requireFactoryCaller() internal view {
        if (msg.sender != factory) revert OnlyFactory();
    }

    function _requireBoardroomCaller() internal view {
        if (msg.sender != boardroom) revert OnlyBoardroom();
    }

    function _requireBoardroomMutation() internal view {
        if (!ILockedLiquidityBoardroom(boardroom).liquidityMutationAllowed()) revert BoardroomMutationForbidden();
    }

    function _requireBoardroomCanExit() internal view {
        if (!ILockedLiquidityBoardroom(boardroom).lockedLiquidityExitAllowed()) revert BoardroomNotWindingDown();
    }

    function _requireActive() internal view {
        if (liquidityState != LiquidityState.Active) {
            revert InvalidLiquidityState(LiquidityState.Active, liquidityState);
        }
    }
}
