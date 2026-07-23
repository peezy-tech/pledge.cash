// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {LibClone} from "solady/utils/LibClone.sol";
import {Boardroom} from "./Boardroom.sol";
import {BoardroomControllerFactory} from "./BoardroomControllerFactory.sol";
import {BoardroomMarketLogic} from "./BoardroomMarketLogic.sol";

contract BoardroomFactory {
    address public immutable policyRegistry;
    address public immutable wrappedNative;
    address public immutable boardroomLogic;
    address public immutable redemptionPayoutLogic;
    address public immutable governanceLogic;
    address public immutable controllerFactory;
    address public immutable marketLogic;

    address[] public allBoardrooms;
    mapping(address => bool) public isBoardroom;
    mapping(address => bool) public isShareToken;

    error InvalidAddress();

    event BoardroomCreated(
        address indexed boardroom,
        address indexed owner,
        address indexed policyRegistry,
        address shareToken,
        address wrappedNative,
        string name,
        string symbol,
        bytes32 salt
    );

    constructor(
        address policyRegistry_,
        address wrappedNative_,
        address redemptionPayoutLogic_,
        address governanceLogic_
    ) {
        _requireAddress(policyRegistry_);
        _requireAddress(wrappedNative_);
        _requireContract(redemptionPayoutLogic_);
        _requireContract(governanceLogic_);

        policyRegistry = policyRegistry_;
        wrappedNative = wrappedNative_;
        redemptionPayoutLogic = redemptionPayoutLogic_;
        governanceLogic = governanceLogic_;
        controllerFactory = address(new BoardroomControllerFactory(address(this)));
        marketLogic = address(new BoardroomMarketLogic());
        boardroomLogic = address(new Boardroom(redemptionPayoutLogic, governanceLogic, controllerFactory, marketLogic));
    }

    function createBoardroom(address owner, string calldata name, string calldata symbol, bytes32 salt)
        external
        returns (address boardroom)
    {
        _requireAddress(owner);

        boardroom = LibClone.cloneDeterministic(boardroomLogic, _deploymentSalt(owner, name, symbol, salt));
        Boardroom createdBoardroom = Boardroom(payable(boardroom));
        createdBoardroom.initialize(owner, policyRegistry, wrappedNative, name, symbol);

        allBoardrooms.push(boardroom);
        isBoardroom[boardroom] = true;
        isShareToken[createdBoardroom.shareToken()] = true;

        emit BoardroomCreated(
            boardroom, owner, policyRegistry, createdBoardroom.shareToken(), wrappedNative, name, symbol, salt
        );
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

    function _requireAddress(address account) internal pure {
        if (account == address(0)) revert InvalidAddress();
    }

    function _requireContract(address account) internal view {
        if (account == address(0) || account.code.length == 0) revert InvalidAddress();
    }
}
