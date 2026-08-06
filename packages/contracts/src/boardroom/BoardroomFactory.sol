// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {LibClone} from "solady/utils/LibClone.sol";
import {Boardroom} from "./Boardroom.sol";
import {IBoardroom} from "./IBoardroom.sol";

/// @notice Canonical factory for immutable pledge.cash Boardrooms.
contract BoardroomFactory {
    address public immutable wrappedNative;
    address public immutable boardroomImplementation;

    address[] public allBoardrooms;
    mapping(address boardroom => bool canonical) public isBoardroom;
    mapping(address shareToken => bool canonical) public isShareToken;

    error InvalidAddress(address account);

    event BoardroomCreated(
        address indexed boardroom,
        address indexed owner,
        address indexed shareToken,
        address wrappedNative,
        string name,
        string symbol,
        bytes32 salt
    );

    constructor(address wrappedNative_) {
        if (wrappedNative_ == address(0) || wrappedNative_.code.length == 0) {
            revert InvalidAddress(wrappedNative_);
        }
        wrappedNative = wrappedNative_;
        boardroomImplementation = address(new Boardroom(address(this), wrappedNative_));
    }

    function createBoardroom(address owner, string calldata name, string calldata symbol, bytes32 salt)
        external
        returns (address boardroom)
    {
        if (owner == address(0)) revert InvalidAddress(owner);
        boardroom = LibClone.cloneDeterministic(boardroomImplementation, _deploymentSalt(owner, name, symbol, salt));

        // The initializer verifies its caller against this factory. Marking the clone
        // before initialization lets module constructors recognize it as canonical.
        isBoardroom[boardroom] = true;
        IBoardroom(boardroom).initialize(owner, name, symbol);
        address token = IBoardroom(boardroom).shareToken();
        isShareToken[token] = true;
        allBoardrooms.push(boardroom);

        emit BoardroomCreated(boardroom, owner, token, wrappedNative, name, symbol, salt);
    }

    function predictBoardroomAddress(address owner, string calldata name, string calldata symbol, bytes32 salt)
        external
        view
        returns (address)
    {
        return LibClone.predictDeterministicAddress(
            boardroomImplementation, _deploymentSalt(owner, name, symbol, salt), address(this)
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
