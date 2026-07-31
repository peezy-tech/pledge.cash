// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "solady/tokens/ERC20.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {SqrtPriceMath} from "v4-core/libraries/SqrtPriceMath.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {BalanceDelta, toBalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";

/// @notice Focused PoolManager test double for pledge.cash lifecycle tests.
/// @dev It preserves the v4 unlock/settle shape and amount rounding used by a full-range position.
/// It is not a swap simulator and production deployment always requires an external canonical PoolManager.
contract V4PoolManagerMock {
    using PoolIdLibrary for PoolKey;

    mapping(bytes32 slot => bytes32 value) internal storedSlots;
    address internal unlocker;
    Currency internal syncedCurrency;
    uint256 internal syncedBalance;
    int128 internal nextFee0;
    int128 internal nextFee1;
    mapping(bytes32 poolId => uint160 sqrtPriceX96) internal poolPrice;

    error AlreadyInitialized(bytes32 poolId);
    error NotUnlocked();

    function initialize(PoolKey memory key, uint160 sqrtPriceX96) external returns (int24) {
        bytes32 poolId = PoolId.unwrap(key.toId());
        bytes32 slot = keccak256(abi.encodePacked(poolId, bytes32(uint256(6))));
        if (storedSlots[slot] != bytes32(0)) revert AlreadyInitialized(poolId);
        if (address(key.hooks) != address(0)) key.hooks.beforeInitialize(msg.sender, key, sqrtPriceX96);
        storedSlots[slot] = bytes32(uint256(sqrtPriceX96));
        poolPrice[poolId] = sqrtPriceX96;
        return 0;
    }

    function unlock(bytes calldata data) external returns (bytes memory result) {
        if (unlocker != address(0)) revert NotUnlocked();
        unlocker = msg.sender;
        result = IUnlockCallback(msg.sender).unlockCallback(data);
        unlocker = address(0);
    }

    function modifyLiquidity(PoolKey memory key, IPoolManager.ModifyLiquidityParams memory params, bytes calldata)
        external
        view
        returns (BalanceDelta callerDelta, BalanceDelta feesAccrued)
    {
        if (msg.sender != unlocker) revert NotUnlocked();
        if (params.liquidityDelta != 0) {
            uint160 sqrtPriceX96 = poolPrice[PoolId.unwrap(key.toId())];
            uint160 sqrtPriceLowerX96 = TickMath.getSqrtPriceAtTick(params.tickLower);
            uint160 sqrtPriceUpperX96 = TickMath.getSqrtPriceAtTick(params.tickUpper);
            int128 liquidityDelta = int128(params.liquidityDelta);
            int128 amount0 = int128(SqrtPriceMath.getAmount0Delta(sqrtPriceX96, sqrtPriceUpperX96, liquidityDelta));
            int128 amount1 = int128(SqrtPriceMath.getAmount1Delta(sqrtPriceLowerX96, sqrtPriceX96, liquidityDelta));
            return (toBalanceDelta(amount0, amount1), toBalanceDelta(0, 0));
        }
        return (toBalanceDelta(nextFee0, nextFee1), toBalanceDelta(0, 0));
    }

    function setNextFees(int128 amount0, int128 amount1) external {
        nextFee0 = amount0;
        nextFee1 = amount1;
    }

    function clearNextFees() external {
        nextFee0 = 0;
        nextFee1 = 0;
    }

    function sync(Currency currency) external {
        if (msg.sender != unlocker) revert NotUnlocked();
        syncedCurrency = currency;
        syncedBalance = ERC20(Currency.unwrap(currency)).balanceOf(address(this));
    }

    function settle() external returns (uint256 paid) {
        if (msg.sender != unlocker) revert NotUnlocked();
        paid = ERC20(Currency.unwrap(syncedCurrency)).balanceOf(address(this)) - syncedBalance;
        syncedCurrency = Currency.wrap(address(0));
        syncedBalance = 0;
    }

    function take(Currency currency, address recipient, uint256 amount) external {
        if (msg.sender != unlocker) revert NotUnlocked();
        ERC20(Currency.unwrap(currency)).transfer(recipient, amount);
    }

    function extsload(bytes32 slot) external view returns (bytes32 value) {
        return storedSlots[slot];
    }
}
