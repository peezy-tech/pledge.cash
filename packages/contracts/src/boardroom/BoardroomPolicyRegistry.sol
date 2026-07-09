// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "solady/auth/Ownable.sol";
import {IBoardroomPolicyRegistry} from "./IBoardroomPolicyRegistry.sol";

contract BoardroomPolicyRegistry is Ownable, IBoardroomPolicyRegistry {
    enum PolicyStatus {
        Disabled,
        Active,
        LifecycleOnly
    }

    mapping(address => PolicyStatus) public policyStatus;

    error InvalidAddress();

    event PolicyAllowedSet(address indexed policy, bool allowed);
    event PolicyStatusSet(address indexed policy, PolicyStatus indexed status);

    constructor(address owner_) {
        if (owner_ == address(0)) revert InvalidAddress();
        _initializeOwner(owner_);
    }

    function setPolicyAllowed(address policy, bool allowed) external onlyOwner {
        _setPolicyStatus(policy, allowed ? PolicyStatus.Active : PolicyStatus.Disabled);
        emit PolicyAllowedSet(policy, allowed);
    }

    function setPolicyStatus(address policy, PolicyStatus status) external onlyOwner {
        _setPolicyStatus(policy, status);
    }

    function isPolicyAllowed(address policy) external view returns (bool) {
        return policyStatus[policy] == PolicyStatus.Active;
    }

    function isPolicyLifecycleAllowed(address policy) external view returns (bool) {
        PolicyStatus status = policyStatus[policy];
        return status == PolicyStatus.Active || status == PolicyStatus.LifecycleOnly;
    }

    function _setPolicyStatus(address policy, PolicyStatus status) internal {
        if (policy == address(0)) revert InvalidAddress();

        policyStatus[policy] = status;
        emit PolicyStatusSet(policy, status);
    }
}
