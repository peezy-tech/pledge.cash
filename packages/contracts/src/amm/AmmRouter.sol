// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "solady/tokens/ERC20.sol";
import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {AmmFactory} from "./AmmFactory.sol";
import {AmmPool} from "./AmmPool.sol";
import {ExactTransferLib} from "../lib/ExactTransferLib.sol";

interface IWrappedNative {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

contract AmmRouter is ReentrancyGuard {
    using SafeTransferLib for address;

    uint256 public constant MAX_SWAP_PATH_LENGTH = 8;

    address public immutable factory;
    address public immutable wrappedNative;

    error Expired();
    error InvalidAddress();
    error InvalidPath();
    error InvalidNativeAmount();
    error InsufficientAmount();
    error InsufficientOutputAmount();
    error InsufficientLiquidity();
    error TransferAmountMismatch(address token, uint256 expected, uint256 actual);
    error BalanceDecreased(address token, address account);

    modifier ensure(uint256 deadline) {
        if (deadline < block.timestamp) revert Expired();
        _;
    }

    constructor(address factory_, address wrappedNative_) {
        _requireNonZero(factory_);
        _requireNonZero(wrappedNative_);
        _requireContract(factory_);
        _requireContract(wrappedNative_);

        factory = factory_;
        wrappedNative = wrappedNative_;
    }

    receive() external payable {
        if (msg.sender != wrappedNative) revert InvalidAddress();
    }

    function poolFor(address tokenA, address tokenB) public view returns (address) {
        return AmmFactory(factory).getPool(tokenA, tokenB);
    }

    function quote(uint256 amountA, uint256 reserveA, uint256 reserveB) public pure returns (uint256 amountB) {
        if (amountA == 0) revert InsufficientAmount();
        if (reserveA == 0 || reserveB == 0) revert InsufficientLiquidity();
        amountB = FixedPointMathLib.fullMulDiv(amountA, reserveB, reserveA);
    }

    function getAmountsOut(uint256 amountIn, address[] memory path) public view returns (uint256[] memory amounts) {
        _requireValidPath(path);

        amounts = new uint256[](path.length);
        address[] memory pools = new address[](path.length - 1);
        amounts[0] = amountIn;
        for (uint256 i; i < path.length - 1; ++i) {
            address pool = _existingPool(path[i], path[i + 1]);
            for (uint256 j; j < i; ++j) {
                if (pools[j] == pool) revert InvalidPath();
            }
            pools[i] = pool;
            amounts[i + 1] = AmmPool(pool).getAmountOut(amounts[i], path[i]);
        }
    }

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external nonReentrant ensure(deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        _requireNonZero(to);
        address pool = _poolOrCreate(tokenA, tokenB);
        (amountA, amountB) = _liquidityAmounts(tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin);

        _checkedTransferFrom(tokenA, msg.sender, pool, amountA);
        _checkedTransferFrom(tokenB, msg.sender, pool, amountB);
        liquidity = AmmPool(pool).mintFromRouter(to, msg.sender);
    }

    function addLiquidityNative(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountNativeMin,
        address to,
        uint256 deadline
    )
        external
        payable
        nonReentrant
        ensure(deadline)
        returns (uint256 amountToken, uint256 amountNative, uint256 liquidity)
    {
        _requireNonZero(to);
        address pool = _poolOrCreate(token, wrappedNative);
        (amountToken, amountNative) =
            _liquidityAmounts(token, wrappedNative, amountTokenDesired, msg.value, amountTokenMin, amountNativeMin);

        _checkedTransferFrom(token, msg.sender, pool, amountToken);
        IWrappedNative(wrappedNative).deposit{value: amountNative}();
        wrappedNative.safeTransfer(pool, amountNative);
        liquidity = AmmPool(pool).mintFromRouter(to, msg.sender);

        _refundNative(msg.sender, msg.value, amountNative);
    }

    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external nonReentrant ensure(deadline) returns (uint256 amountA, uint256 amountB) {
        _requireNonZero(to);
        address pool = _existingPool(tokenA, tokenB);

        uint256 balanceABefore = ERC20(tokenA).balanceOf(to);
        uint256 balanceBBefore = ERC20(tokenB).balanceOf(to);
        _burnLiquidity(pool, liquidity, to);

        amountA = _received(tokenA, to, balanceABefore);
        amountB = _received(tokenB, to, balanceBBefore);
        _requireMinimumAmounts(amountA, amountB, amountAMin, amountBMin);
    }

    function removeLiquidityNative(
        address token,
        uint256 liquidity,
        uint256 amountTokenMin,
        uint256 amountNativeMin,
        address to,
        uint256 deadline
    ) external nonReentrant ensure(deadline) returns (uint256 amountToken, uint256 amountNative) {
        _requireNonZero(to);
        address pool = _existingPool(token, wrappedNative);

        uint256 tokenBalanceBefore = ERC20(token).balanceOf(address(this));
        uint256 nativeBalanceBefore = ERC20(wrappedNative).balanceOf(address(this));
        _burnLiquidity(pool, liquidity, address(this));

        amountToken = _received(token, address(this), tokenBalanceBefore);
        amountNative = _received(wrappedNative, address(this), nativeBalanceBefore);
        _requireMinimumAmounts(amountToken, amountNative, amountTokenMin, amountNativeMin);

        _checkedTransfer(token, to, amountToken);
        IWrappedNative(wrappedNative).withdraw(amountNative);
        SafeTransferLib.safeTransferETH(to, amountNative);
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external nonReentrant ensure(deadline) returns (uint256[] memory amounts) {
        _requireNonZero(to);
        amounts = getAmountsOut(amountIn, path);
        if (amounts[amounts.length - 1] < amountOutMin) revert InsufficientOutputAmount();

        address tokenOut = path[path.length - 1];
        _checkedTransferFrom(path[0], msg.sender, _firstPool(path), amounts[0]);
        uint256 balanceBefore = ERC20(tokenOut).balanceOf(to);
        _swap(amounts, path, to);
        amounts[amounts.length - 1] = _receivedAtLeast(tokenOut, to, balanceBefore, amountOutMin);
    }

    function swapExactNativeForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external
        payable
        nonReentrant
        ensure(deadline)
        returns (uint256[] memory amounts)
    {
        _requireNonZero(to);
        if (msg.value == 0) revert InvalidNativeAmount();
        if (path.length < 2 || path[0] != wrappedNative) revert InvalidPath();

        amounts = getAmountsOut(msg.value, path);
        if (amounts[amounts.length - 1] < amountOutMin) revert InsufficientOutputAmount();

        address tokenOut = path[path.length - 1];
        IWrappedNative(wrappedNative).deposit{value: amounts[0]}();
        wrappedNative.safeTransfer(_firstPool(path), amounts[0]);
        uint256 balanceBefore = ERC20(tokenOut).balanceOf(to);
        _swap(amounts, path, to);
        amounts[amounts.length - 1] = _receivedAtLeast(tokenOut, to, balanceBefore, amountOutMin);
    }

    function swapExactTokensForNative(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external nonReentrant ensure(deadline) returns (uint256[] memory amounts) {
        _requireNonZero(to);
        if (path.length < 2 || path[path.length - 1] != wrappedNative) revert InvalidPath();

        amounts = getAmountsOut(amountIn, path);
        uint256 amountOut = amounts[amounts.length - 1];
        if (amountOut < amountOutMin) revert InsufficientOutputAmount();

        _checkedTransferFrom(path[0], msg.sender, _firstPool(path), amounts[0]);
        uint256 balanceBefore = ERC20(wrappedNative).balanceOf(address(this));
        _swap(amounts, path, address(this));
        amountOut = _receivedAtLeast(wrappedNative, address(this), balanceBefore, amountOutMin);
        amounts[amounts.length - 1] = amountOut;

        IWrappedNative(wrappedNative).withdraw(amountOut);
        SafeTransferLib.safeTransferETH(to, amountOut);
    }

    function _swap(uint256[] memory amounts, address[] calldata path, address to) internal {
        AmmFactory factory_ = AmmFactory(factory);

        for (uint256 i; i < path.length - 1; ++i) {
            (address input, address output) = (path[i], path[i + 1]);
            address pool = factory_.getPool(input, output);
            (address token0,) = factory_.sortTokens(input, output);
            uint256 amountOut = amounts[i + 1];
            (uint256 amount0Out, uint256 amount1Out) =
                input == token0 ? (uint256(0), amountOut) : (amountOut, uint256(0));
            address nextTo = _swapRecipient(factory_, path, i, to);
            AmmPool(pool).swap(amount0Out, amount1Out, nextTo, "");
        }
    }

    function _poolOrCreate(address tokenA, address tokenB) internal returns (address pool) {
        pool = AmmFactory(factory).getPool(tokenA, tokenB);
        if (pool == address(0)) pool = AmmFactory(factory).createPool(tokenA, tokenB);
    }

    function _liquidityAmounts(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin
    ) internal view returns (uint256 amountA, uint256 amountB) {
        address pool = AmmFactory(factory).getPool(tokenA, tokenB);
        (uint112 reserve0, uint112 reserve1,) = AmmPool(pool).getReserves();
        (address token0,) = AmmFactory(factory).sortTokens(tokenA, tokenB);
        (uint256 reserveA, uint256 reserveB) =
            tokenA == token0 ? (uint256(reserve0), uint256(reserve1)) : (uint256(reserve1), uint256(reserve0));

        if (reserveA == 0 && reserveB == 0) {
            (amountA, amountB) = (amountADesired, amountBDesired);
        } else {
            uint256 amountBOptimal = quote(amountADesired, reserveA, reserveB);
            if (amountBOptimal <= amountBDesired) {
                if (amountBOptimal < amountBMin) revert InsufficientAmount();
                (amountA, amountB) = (amountADesired, amountBOptimal);
            } else {
                uint256 amountAOptimal = quote(amountBDesired, reserveB, reserveA);
                if (amountAOptimal < amountAMin) revert InsufficientAmount();
                (amountA, amountB) = (amountAOptimal, amountBDesired);
            }
        }

        _requireMinimumAmounts(amountA, amountB, amountAMin, amountBMin);
    }

    function _checkedTransferFrom(address token, address from, address to, uint256 expectedAmount) internal {
        _requireExactTransfer(token, expectedAmount, ExactTransferLib.pullBetween(token, from, to, expectedAmount));
    }

    function _checkedTransfer(address token, address to, uint256 expectedAmount) internal {
        _requireExactTransfer(token, expectedAmount, ExactTransferLib.sendFromSelfTo(token, to, expectedAmount));
    }

    function _received(address token, address account, uint256 balanceBefore) internal view returns (uint256) {
        ExactTransferLib.RecipientDelta memory delta = ExactTransferLib.received(token, account, balanceBefore);
        if (delta.balanceDecreased) revert BalanceDecreased(token, account);

        return delta.received;
    }

    function _receivedAtLeast(address token, address account, uint256 balanceBefore, uint256 minimumAmount)
        internal
        view
        returns (uint256 amount)
    {
        amount = _received(token, account, balanceBefore);
        if (amount < minimumAmount) revert InsufficientOutputAmount();
    }

    function _requireExactTransfer(address token, uint256 expectedAmount, ExactTransferLib.ExactDelta memory delta)
        internal
        pure
    {
        if (delta.senderBalanceIncreased) revert TransferAmountMismatch(token, expectedAmount, 0);
        if (delta.senderSpent != expectedAmount) {
            revert TransferAmountMismatch(token, expectedAmount, delta.senderSpent);
        }
        if (delta.recipientBalanceDecreased) revert TransferAmountMismatch(token, expectedAmount, 0);
        if (delta.recipientReceived != expectedAmount) {
            revert TransferAmountMismatch(token, expectedAmount, delta.recipientReceived);
        }
    }

    function _requireValidPath(address[] memory path) internal pure {
        if (path.length < 2 || path.length > MAX_SWAP_PATH_LENGTH) revert InvalidPath();
        for (uint256 i; i < path.length - 1; ++i) {
            if (path[i] == address(0) || path[i + 1] == address(0) || path[i] == path[i + 1]) {
                revert InvalidPath();
            }
        }
    }

    function _requireMinimumAmounts(uint256 amountA, uint256 amountB, uint256 amountAMin, uint256 amountBMin)
        internal
        pure
    {
        if (amountA < amountAMin || amountB < amountBMin) revert InsufficientAmount();
    }

    function _requireNonZero(address account) internal pure {
        if (account == address(0)) revert InvalidAddress();
    }

    function _requireContract(address account) internal view {
        if (account.code.length == 0) revert InvalidAddress();
    }

    function _existingPool(address tokenA, address tokenB) internal view returns (address pool) {
        pool = AmmFactory(factory).getPool(tokenA, tokenB);
        if (pool == address(0)) revert InvalidPath();
    }

    function _firstPool(address[] calldata path) internal view returns (address) {
        return _existingPool(path[0], path[1]);
    }

    function _burnLiquidity(address pool, uint256 liquidity, address recipient) internal {
        pool.safeTransferFrom(msg.sender, pool, liquidity);
        AmmPool(pool).burn(recipient);
    }

    function _refundNative(address recipient, uint256 suppliedAmount, uint256 usedAmount) internal {
        if (suppliedAmount <= usedAmount) return;

        SafeTransferLib.safeTransferETH(recipient, suppliedAmount - usedAmount);
    }

    function _swapRecipient(AmmFactory factory_, address[] calldata path, uint256 index, address finalRecipient)
        internal
        view
        returns (address)
    {
        if (index >= path.length - 2) return finalRecipient;

        return factory_.getPool(path[index + 1], path[index + 2]);
    }
}
