// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "solady/auth/Ownable.sol";
import {IBoardroomCallPolicy} from "./IBoardroomCallPolicy.sol";

contract ProtocolPolicy is Ownable, IBoardroomCallPolicy {
    mapping(address => bool) public isProtocolTargetAllowed;
    mapping(address => bool) public isProtocolValueTargetAllowed;

    error InvalidAddress();

    event ProtocolTargetAllowedSet(address indexed target, bool allowed);
    event ProtocolValueTargetAllowedSet(address indexed target, bool allowed);

    constructor(address owner_) {
        if (owner_ == address(0)) revert InvalidAddress();
        _initializeOwner(owner_);
    }

    function setProtocolTargetAllowed(address target, bool allowed) external onlyOwner {
        if (target == address(0)) revert InvalidAddress();

        isProtocolTargetAllowed[target] = allowed;
        emit ProtocolTargetAllowedSet(target, allowed);
    }

    function setProtocolValueTargetAllowed(address target, bool allowed) external onlyOwner {
        if (target == address(0)) revert InvalidAddress();

        isProtocolValueTargetAllowed[target] = allowed;
        emit ProtocolValueTargetAllowedSet(target, allowed);
    }

    function canCall(address, address, address target, uint256 value, bytes calldata) external view returns (bool) {
        if (!isProtocolTargetAllowed[target]) return false;
        return value == 0 || isProtocolValueTargetAllowed[target];
    }
}
