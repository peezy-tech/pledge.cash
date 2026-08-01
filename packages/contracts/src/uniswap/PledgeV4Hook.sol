// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.30;

import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {BeforeSwapDelta} from "v4-core/types/BeforeSwapDelta.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";

interface IPledgeV4PoolInitializer {
    function isPoolInitializationAuthorized(address sender, PoolKey calldata key) external view returns (bool);
}

/// @notice Immutable provenance hook for pledge.cash project pools.
/// @dev Only the before-initialize bit is enabled. Swaps, donations, and liquidity changes retain
/// ordinary Uniswap v4 semantics; the hook prevents a third party from claiming the canonical
/// pledge.cash PoolKey before its policy-authenticated factory transition executes.
contract PledgeV4Hook is IHooks {
    uint160 public constant REQUIRED_FLAGS = 1 << 13;

    address public immutable factory;
    IPoolManager public immutable poolManager;

    error InvalidAddress();
    error OnlyPoolManager(address caller);
    error PoolInitializationNotAuthorized(bytes32 poolId);
    error UnsupportedHookCallback(bytes4 selector);

    constructor(IPoolManager poolManager_, address factory_) {
        if (address(poolManager_) == address(0) || address(poolManager_).code.length == 0 || factory_ == address(0)) {
            revert InvalidAddress();
        }
        poolManager = poolManager_;
        factory = factory_;
        Hooks.validateHookPermissions(IHooks(address(this)), permissions());
    }

    function permissions() public pure returns (Hooks.Permissions memory result) {
        result.beforeInitialize = true;
    }

    function beforeInitialize(address sender, PoolKey calldata key, uint160) external view returns (bytes4) {
        _requirePoolManager();
        if (!IPledgeV4PoolInitializer(factory).isPoolInitializationAuthorized(sender, key)) {
            revert PoolInitializationNotAuthorized(keccak256(abi.encode(key)));
        }
        return IHooks.beforeInitialize.selector;
    }

    function afterInitialize(address, PoolKey calldata, uint160, int24) external view returns (bytes4) {
        _unsupported();
    }

    function beforeAddLiquidity(address, PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, bytes calldata)
        external
        view
        returns (bytes4)
    {
        _unsupported();
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external view returns (bytes4, BalanceDelta) {
        _unsupported();
    }

    function beforeRemoveLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        bytes calldata
    ) external view returns (bytes4) {
        _unsupported();
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external view returns (bytes4, BalanceDelta) {
        _unsupported();
    }

    function beforeSwap(address, PoolKey calldata, IPoolManager.SwapParams calldata, bytes calldata)
        external
        view
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        _unsupported();
    }

    function afterSwap(address, PoolKey calldata, IPoolManager.SwapParams calldata, BalanceDelta, bytes calldata)
        external
        view
        returns (bytes4, int128)
    {
        _unsupported();
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external view returns (bytes4) {
        _unsupported();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external view returns (bytes4) {
        _unsupported();
    }

    function _requirePoolManager() private view {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager(msg.sender);
    }

    function _unsupported() private view {
        _requirePoolManager();
        revert UnsupportedHookCallback(msg.sig);
    }
}
