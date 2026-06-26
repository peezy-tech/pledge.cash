// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {LibClone} from "solady/utils/LibClone.sol";
import {Boardroom} from "./Boardroom.sol";

contract BoardroomFactory {
    address public immutable tokenGrantFactory;
    address public immutable boardroomLogic;

    address[] public allBoardrooms;
    mapping(address => bool) public isBoardroom;

    error InvalidAddress();

    event BoardroomCreated(
        address indexed boardroom,
        address indexed owner,
        address indexed tokenGrantFactory,
        address shareToken,
        string name,
        string symbol,
        bytes32 salt
    );

    constructor(address tokenGrantFactory_) {
        if (tokenGrantFactory_ == address(0)) revert InvalidAddress();

        tokenGrantFactory = tokenGrantFactory_;
        boardroomLogic = address(new Boardroom());
    }

    function createBoardroom(address owner, string calldata name, string calldata symbol, bytes32 salt)
        external
        returns (address boardroom)
    {
        boardroom = LibClone.cloneDeterministic(boardroomLogic, salt);
        Boardroom createdBoardroom = Boardroom(payable(boardroom));
        createdBoardroom.initialize(owner, tokenGrantFactory, name, symbol);

        allBoardrooms.push(boardroom);
        isBoardroom[boardroom] = true;

        emit BoardroomCreated(boardroom, owner, tokenGrantFactory, createdBoardroom.shareToken(), name, symbol, salt);
    }

    function predictBoardroomAddress(bytes32 salt) external view returns (address) {
        return LibClone.predictDeterministicAddress(boardroomLogic, salt, address(this));
    }

    function allBoardroomsLength() external view returns (uint256) {
        return allBoardrooms.length;
    }
}
