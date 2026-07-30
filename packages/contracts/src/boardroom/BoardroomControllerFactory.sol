// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {LibClone} from "solady/utils/LibClone.sol";
import {BoardroomController} from "./BoardroomController.sol";

interface ICanonicalBoardroomFactory {
    function isBoardroom(address boardroom) external view returns (bool);
}

interface IBoardroomControllerDeploymentAuthorizer {
    function isControllerDeploymentAuthorized(
        address expectedController,
        address proposer,
        uint64 delay,
        uint64 gracePeriod,
        uint64 generation
    ) external view returns (bool);
}

/// @notice Canonical controller factory deploying release-bound controllers.
contract BoardroomControllerFactory {
    address public immutable boardroomFactory;
    address public immutable controllerImplementation;

    mapping(address controller => bool canonical) public isController;
    mapping(address controller => address boardroom) public boardroomOfController;
    mapping(address controller => uint256 generation) public generationOfController;

    error InvalidAddress();
    error OnlyCanonicalBoardroom(address caller);
    error UnauthorizedDeploymentContext(address boardroom, address controller, uint256 generation);
    error InvalidGeneration();
    error ControllerPredictionMismatch(address expected, address actual);
    error ControllerAddressOccupied(address controller);

    event ControllerDeployed(
        address indexed boardroom,
        address indexed controller,
        uint256 indexed generation,
        address proposer,
        uint256 delay,
        uint256 gracePeriod
    );

    constructor(address boardroomFactory_) {
        if (boardroomFactory_ == address(0)) revert InvalidAddress();
        boardroomFactory = boardroomFactory_;
        controllerImplementation = address(new BoardroomController());
    }

    function deployController(
        address expectedController,
        address proposer,
        uint64 delay,
        uint64 gracePeriod,
        uint64 generation
    ) external returns (address controller) {
        if (!ICanonicalBoardroomFactory(boardroomFactory).isBoardroom(msg.sender)) {
            revert OnlyCanonicalBoardroom(msg.sender);
        }
        if (generation == 0) revert InvalidGeneration();
        controller = predictControllerAddress(msg.sender, generation);
        if (controller != expectedController) {
            revert ControllerPredictionMismatch(expectedController, controller);
        }
        if (controller.code.length != 0 || isController[controller]) revert ControllerAddressOccupied(controller);
        if (!IBoardroomControllerDeploymentAuthorizer(msg.sender)
                .isControllerDeploymentAuthorized(expectedController, proposer, delay, gracePeriod, generation)) {
            revert UnauthorizedDeploymentContext(msg.sender, expectedController, generation);
        }

        controller = LibClone.cloneDeterministic(controllerImplementation, _deploymentSalt(msg.sender, generation));
        BoardroomController(controller).initialize(msg.sender, proposer, delay, gracePeriod, generation);
        isController[controller] = true;
        boardroomOfController[controller] = msg.sender;
        generationOfController[controller] = generation;
        emit ControllerDeployed(msg.sender, controller, generation, proposer, delay, gracePeriod);
    }

    function predictControllerAddress(address boardroom, uint256 generation) public view returns (address) {
        if (boardroom == address(0)) revert InvalidAddress();
        if (generation == 0 || generation > type(uint64).max) revert InvalidGeneration();
        return LibClone.predictDeterministicAddress(
            controllerImplementation, _deploymentSalt(boardroom, uint64(generation)), address(this)
        );
    }

    function _deploymentSalt(address boardroom, uint64 generation) internal pure returns (bytes32) {
        return keccak256(abi.encode(boardroom, generation));
    }
}
