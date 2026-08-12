// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Pinned subset of canonical v4-periphery action identifiers.
/// @dev Compatibility source: Uniswap/v4-periphery commit 545a5d2a87228167edde48f3b9eda122d1e3c4d6.
library PositionManagerActions {
    uint8 internal constant DECREASE_LIQUIDITY = 0x01;
    uint8 internal constant BURN_POSITION = 0x03;
    uint8 internal constant TAKE_PAIR = 0x11;
}
