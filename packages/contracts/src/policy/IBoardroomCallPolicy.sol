// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IBoardroomCallPolicy {
    function canCall(address boardroom, address caller, address target, uint256 value, bytes calldata data)
        external
        view
        returns (bool);
}
