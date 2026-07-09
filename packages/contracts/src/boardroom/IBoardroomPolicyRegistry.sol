// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IBoardroomPolicyRegistry {
    function isPolicyAllowed(address policy) external view returns (bool);

    function isPolicyLifecycleAllowed(address policy) external view returns (bool);
}
