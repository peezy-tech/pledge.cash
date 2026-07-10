// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IBoardroomPolicyRegistry {
    function authorizeCall(
        address boardroom,
        address caller,
        address policy,
        address target,
        uint256 value,
        bytes calldata data,
        address canonicalPolicy
    ) external view;

    function isModulePolicy(address policy) external view returns (bool);

    function isPolicyAllowed(address policy) external view returns (bool);

    function isPolicyLifecycleAllowed(address policy) external view returns (bool);
}
