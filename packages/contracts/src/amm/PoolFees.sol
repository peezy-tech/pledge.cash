// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ExactTransferLib} from "../lib/ExactTransferLib.sol";

contract PoolFees {
    address public immutable pool;
    address public immutable token0;
    address public immutable token1;

    error InvalidAddress();
    error OnlyPool();
    error UnexpectedFeeTransfer(address token, uint256 expected, uint256 senderSpent, uint256 recipientReceived);

    constructor(address pool_, address token0_, address token1_) {
        _requireNonZero(pool_);
        _requireNonZero(token0_);
        _requireNonZero(token1_);

        pool = pool_;
        token0 = token0_;
        token1 = token1_;
    }

    function claimFeesFor(address recipient, uint256 amount0, uint256 amount1) external {
        if (msg.sender != pool) revert OnlyPool();

        _transferIfRequested(token0, recipient, amount0);
        _transferIfRequested(token1, recipient, amount1);
    }

    function _requireNonZero(address account) internal pure {
        if (account == address(0)) revert InvalidAddress();
    }

    function _transferIfRequested(address token, address recipient, uint256 amount) internal {
        if (amount == 0) return;

        ExactTransferLib.ExactDelta memory delta = ExactTransferLib.sendFromSelfTo(token, recipient, amount);
        if (
            delta.senderBalanceIncreased || delta.recipientBalanceDecreased || delta.senderSpent != amount
                || delta.recipientReceived != amount
        ) {
            revert UnexpectedFeeTransfer(token, amount, delta.senderSpent, delta.recipientReceived);
        }
    }
}
