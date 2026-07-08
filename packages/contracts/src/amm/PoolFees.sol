// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";

contract PoolFees {
    using SafeTransferLib for address;

    address public immutable pool;
    address public immutable token0;
    address public immutable token1;

    error InvalidAddress();
    error OnlyPool();

    constructor(address pool_, address token0_, address token1_) {
        if (pool_ == address(0) || token0_ == address(0) || token1_ == address(0)) revert InvalidAddress();

        pool = pool_;
        token0 = token0_;
        token1 = token1_;
    }

    function claimFeesFor(address recipient, uint256 amount0, uint256 amount1) external {
        if (msg.sender != pool) revert OnlyPool();

        if (amount0 != 0) token0.safeTransfer(recipient, amount0);
        if (amount1 != 0) token1.safeTransfer(recipient, amount1);
    }
}
