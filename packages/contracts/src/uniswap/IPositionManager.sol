// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {PoolKey} from "v4-core/types/PoolKey.sol";

/// @notice Narrow ABI used by the pledge.cash liquidity locker.
/// @dev Matches the canonical Uniswap v4 PositionManager ABI without importing
///      the full v4-periphery and Permit2 dependency trees.
///      Compatibility source: Uniswap/v4-periphery commit 545a5d2a87228167edde48f3b9eda122d1e3c4d6.
interface IPositionManager {
    function ownerOf(uint256 tokenId) external view returns (address owner);

    function safeTransferFrom(address from, address to, uint256 tokenId) external;

    function getPoolAndPositionInfo(uint256 tokenId)
        external
        view
        returns (PoolKey memory poolKey, uint256 positionInfo);

    function getPositionLiquidity(uint256 tokenId) external view returns (uint128 liquidity);

    function modifyLiquidities(bytes calldata unlockData, uint256 deadline) external payable;
}
