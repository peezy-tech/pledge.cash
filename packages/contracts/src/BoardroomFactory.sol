// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {LibClone} from "solady/utils/LibClone.sol";
import {Boardroom} from "./Boardroom.sol";

contract BoardroomFactory {
    address public immutable policyRegistry;
    address public immutable boardroomLogic;

    address[] public allBoardrooms;
    mapping(address => bool) public isBoardroom;

    error InvalidAddress();

    event BoardroomCreated(
        address indexed boardroom,
        address indexed owner,
        address indexed policyRegistry,
        address shareToken,
        string name,
        string symbol,
        bytes32 salt
    );

    constructor(address policyRegistry_) {
        if (policyRegistry_ == address(0)) revert InvalidAddress();

        policyRegistry = policyRegistry_;
        boardroomLogic = address(new Boardroom());
    }

    function createBoardroom(address owner, string calldata name, string calldata symbol, bytes32 salt)
        external
        returns (address boardroom)
    {
        if (owner == address(0)) revert InvalidAddress();

        boardroom = LibClone.cloneDeterministic(boardroomLogic, _deploymentSalt(owner, name, symbol, salt));
        Boardroom createdBoardroom = Boardroom(payable(boardroom));
        createdBoardroom.initialize(owner, policyRegistry, name, symbol);

        allBoardrooms.push(boardroom);
        isBoardroom[boardroom] = true;

        emit BoardroomCreated(boardroom, owner, policyRegistry, createdBoardroom.shareToken(), name, symbol, salt);
    }

    function predictBoardroomAddress(address owner, string calldata name, string calldata symbol, bytes32 salt)
        external
        view
        returns (address)
    {
        return LibClone.predictDeterministicAddress(
            boardroomLogic, _deploymentSalt(owner, name, symbol, salt), address(this)
        );
    }

    function allBoardroomsLength() external view returns (uint256) {
        return allBoardrooms.length;
    }

    function _deploymentSalt(address owner, string calldata name, string calldata symbol, bytes32 salt)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(owner, name, symbol, salt));
    }
}
