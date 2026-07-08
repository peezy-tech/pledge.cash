// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "solady/auth/Ownable.sol";
import {IBoardroomPolicyRegistry} from "./IBoardroomPolicyRegistry.sol";

contract BoardroomPolicyRegistry is Ownable, IBoardroomPolicyRegistry {
    mapping(address => bool) public isPolicyAllowed;

    error InvalidAddress();

    event PolicyAllowedSet(address indexed policy, bool allowed);

    constructor(address owner_) {
        if (owner_ == address(0)) revert InvalidAddress();
        _initializeOwner(owner_);
    }

    function setPolicyAllowed(address policy, bool allowed) external onlyOwner {
        if (policy == address(0)) revert InvalidAddress();

        isPolicyAllowed[policy] = allowed;
        emit PolicyAllowedSet(policy, allowed);
    }
}
