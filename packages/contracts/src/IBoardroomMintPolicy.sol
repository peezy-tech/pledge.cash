// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IBoardroomMintPolicy {
    function canMint(address boardroom, address operator, address to, uint256 amount) external view returns (bool);
}
