// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {StagedBoardroomSlots} from "./StagedBoardroomSlots.sol";

contract StagedBoardroomProxy {
    error AlreadyInitialized();
    error InvalidImplementation();
    error InitializationFailed();

    event ProxyInitialized(address indexed implementation);

    function initializeProxy(address implementation_, bytes calldata initializationData) external payable {
        if (StagedBoardroomSlots.implementation() != address(0)) revert AlreadyInitialized();
        if (implementation_ == address(0) || implementation_.code.length == 0) revert InvalidImplementation();

        StagedBoardroomSlots.setImplementation(implementation_);
        (bool success, bytes memory result) = implementation_.delegatecall(initializationData);
        if (!success) _revertInitialization(result);

        emit ProxyInitialized(implementation_);
    }

    function implementation() external view returns (address) {
        return StagedBoardroomSlots.implementation();
    }

    fallback() external payable {
        _fallback();
    }

    receive() external payable {
        _fallback();
    }

    function _fallback() internal {
        address implementation_ = StagedBoardroomSlots.implementation();
        if (implementation_ == address(0)) revert InvalidImplementation();

        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), implementation_, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }

    function _revertInitialization(bytes memory result) internal pure {
        if (result.length == 0) revert InitializationFailed();

        assembly {
            revert(add(result, 0x20), mload(result))
        }
    }
}
