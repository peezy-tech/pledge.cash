// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {LibClone} from "solady/utils/LibClone.sol";
import {Boardroom} from "./Boardroom.sol";
import {BoardroomFinal} from "./BoardroomFinal.sol";
import {BoardroomLaunchFinalization} from "./BoardroomLaunchFinalization.sol";
import {BoardroomPostLaunchGovernance} from "./BoardroomPostLaunchGovernance.sol";
import {StagedBoardroomProxy} from "./StagedBoardroomProxy.sol";

contract BoardroomFactory {
    address public immutable policyRegistry;
    address public immutable wrappedNative;
    address public immutable boardroomProxyLogic;
    address public immutable boardroomLogic;
    address public immutable launchFinalizationLogic;
    address public immutable postLaunchGovernanceLogic;
    address public immutable finalLogic;

    address[] public allBoardrooms;
    mapping(address => bool) public isBoardroom;

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

    constructor(address policyRegistry_, address wrappedNative_) {
        if (policyRegistry_ == address(0) || wrappedNative_ == address(0)) revert InvalidAddress();

        policyRegistry = policyRegistry_;
        wrappedNative = wrappedNative_;
        finalLogic = address(new BoardroomFinal());
        postLaunchGovernanceLogic = address(new BoardroomPostLaunchGovernance(finalLogic));
        launchFinalizationLogic = address(new BoardroomLaunchFinalization(postLaunchGovernanceLogic));
        boardroomLogic =
            address(new Boardroom(launchFinalizationLogic, 0, keccak256("pledge.cash.boardroom.stage.preLaunch")));
        Boardroom(payable(launchFinalizationLogic)).linkPreviousImplementation(boardroomLogic);
        Boardroom(payable(postLaunchGovernanceLogic)).linkPreviousImplementation(launchFinalizationLogic);
        Boardroom(payable(finalLogic)).linkPreviousImplementation(postLaunchGovernanceLogic);
        boardroomProxyLogic = address(new StagedBoardroomProxy());
    }

    function createBoardroom(address owner, string calldata name, string calldata symbol, bytes32 salt)
        external
        returns (address boardroom)
    {
        if (owner == address(0)) revert InvalidAddress();

        boardroom = LibClone.cloneDeterministic(boardroomProxyLogic, _deploymentSalt(owner, name, symbol, salt));
        StagedBoardroomProxy(payable(boardroom))
            .initializeProxy(
                boardroomLogic,
                abi.encodeCall(Boardroom.initialize, (owner, policyRegistry, wrappedNative, name, symbol))
            );
        Boardroom createdBoardroom = Boardroom(payable(boardroom));

        allBoardrooms.push(boardroom);
        isBoardroom[boardroom] = true;

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
            boardroomProxyLogic, _deploymentSalt(owner, name, symbol, salt), address(this)
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
