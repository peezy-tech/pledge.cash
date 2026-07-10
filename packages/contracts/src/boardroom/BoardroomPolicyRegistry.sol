// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "solady/auth/Ownable.sol";
import {IBoardroomPolicyRegistry} from "./IBoardroomPolicyRegistry.sol";
import {IBoardroomCallPolicy} from "../policy/IBoardroomCallPolicy.sol";
import {IBoardroomObligationPolicy} from "../policy/IBoardroomObligationPolicy.sol";

contract BoardroomPolicyRegistry is Ownable, IBoardroomPolicyRegistry {
    enum PolicyStatus {
        Disabled,
        Active,
        LifecycleOnly
    }

    mapping(address => PolicyStatus) public policyStatus;
    mapping(address => bool) public isModulePolicy;

    error InvalidAddress();
    error ModulePolicyAlreadyRegistered(address policy);
    error PolicyNotAllowed(address policy);
    error CallNotAllowed(address policy, address target, bytes4 selector);
    error ModulePolicyRequired(address target);
    error ObligationPolicyMismatch(address target, address expectedPolicy, address actualPolicy);

    event PolicyAllowedSet(address indexed policy, bool allowed);
    event PolicyStatusSet(address indexed policy, PolicyStatus indexed status);
    event ModulePolicyRegistered(address indexed policy);

    constructor(address owner_) {
        if (owner_ == address(0)) revert InvalidAddress();
        _initializeOwner(owner_);
    }

    function setPolicyAllowed(address policy, bool allowed) external onlyOwner {
        _setPolicyStatus(policy, allowed ? PolicyStatus.Active : PolicyStatus.Disabled);
        emit PolicyAllowedSet(policy, allowed);
    }

    /// @notice Permanently identifies an obligation-creating module and enables new calls to it.
    /// @dev Disabling a module later changes only its status; its identity can never be erased.
    function registerModulePolicy(address policy) external onlyOwner {
        if (policy == address(0)) revert InvalidAddress();
        if (isModulePolicy[policy]) revert ModulePolicyAlreadyRegistered(policy);

        isModulePolicy[policy] = true;
        emit ModulePolicyRegistered(policy);
        _setPolicyStatus(policy, PolicyStatus.Active);
    }

    function setPolicyStatus(address policy, PolicyStatus status) external onlyOwner {
        _setPolicyStatus(policy, status);
    }

    function isPolicyAllowed(address policy) external view returns (bool) {
        return _allowsActiveCalls(policyStatus[policy]);
    }

    function isPolicyLifecycleAllowed(address policy) external view returns (bool) {
        return isModulePolicy[policy] || _allowsLifecycleCalls(policyStatus[policy]);
    }

    function authorizeCall(
        address boardroom,
        address caller,
        address policy,
        address target,
        uint256 value,
        bytes calldata data,
        address canonicalPolicy
    ) external view {
        bytes4 selector = data.length < 4 ? bytes4(0) : bytes4(data[:4]);
        if (canonicalPolicy != address(0)) {
            if (policy != canonicalPolicy) revert ObligationPolicyMismatch(target, canonicalPolicy, policy);
            if (!IBoardroomObligationPolicy(canonicalPolicy).isLifecycleCallAllowed(boardroom, target, selector)) {
                revert CallNotAllowed(policy, target, selector);
            }
            return;
        }

        bool targetIsModule = isModulePolicy[target];
        if (policy == address(0)) {
            if (targetIsModule) revert ModulePolicyRequired(target);
            return;
        }

        if (targetIsModule && policy != target) revert ModulePolicyRequired(target);
        if (!_allowsActiveCalls(policyStatus[policy])) revert PolicyNotAllowed(policy);
        if (!IBoardroomCallPolicy(policy).canCall(boardroom, caller, target, value, data)) {
            revert CallNotAllowed(policy, target, selector);
        }
    }

    function _setPolicyStatus(address policy, PolicyStatus status) internal {
        if (policy == address(0)) revert InvalidAddress();

        policyStatus[policy] = status;
        emit PolicyStatusSet(policy, status);
    }

    function _allowsActiveCalls(PolicyStatus status) internal pure returns (bool) {
        return status == PolicyStatus.Active;
    }

    function _allowsLifecycleCalls(PolicyStatus status) internal pure returns (bool) {
        return status == PolicyStatus.Active || status == PolicyStatus.LifecycleOnly;
    }
}
