// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Initializable} from "solady/utils/Initializable.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {SignatureCheckerLib} from "solady/utils/SignatureCheckerLib.sol";
import {BoardroomCall, IBoardroomGovernance} from "./IBoardroomGovernance.sol";

contract BoardroomController is Initializable, ReentrancyGuard {
    bytes4 public constant ERC1271_MAGIC_VALUE = 0x1626ba7e;
    uint256 public constant MIN_DELAY = 1 days;
    uint256 public constant MAX_DELAY = 30 days;
    uint256 public constant MIN_GRACE_PERIOD = 1 days;
    uint256 public constant MAX_GRACE_PERIOD = 30 days;
    uint256 public constant MAX_BATCH_CALLS = 16;

    uint8 internal constant BOARDROOM_STATUS_ACTIVE = 0;
    bytes32 internal constant BOARDROOM_OPERATION_TYPEHASH = keccak256(
        "BoardroomOperation(address controller,address boardroom,bytes32 callsHash,bytes32 salt,uint256 boardroomEpoch,uint256 controllerGeneration,uint256 configurationEpoch,address authority,bytes32 configurationHash)"
    );
    bytes32 internal constant CONTROLLER_OPERATION_TYPEHASH = keccak256(
        "ControllerOperation(address controller,address boardroom,bytes32 dataHash,bytes32 salt,uint256 boardroomEpoch,uint256 controllerGeneration,uint256 configurationEpoch,address authority,bytes32 configurationHash)"
    );

    enum OperationStatus {
        Unset,
        Pending,
        Executed,
        Cancelled
    }

    struct OperationState {
        uint64 eta;
        uint64 expiresAt;
        OperationStatus status;
    }

    address public factory;
    address public boardroom;
    address public proposer;
    uint64 public delay;
    uint64 public gracePeriod;
    uint64 public generation;
    uint64 public configurationEpoch;

    mapping(bytes32 operationId => OperationState state) internal operations;

    error InvalidAddress();
    error InvalidConfiguration();
    error TooManyCalls(uint256 requested, uint256 maximum);
    error OnlyFactory();
    error OnlyBoardroom();
    error OnlyProposer();
    error OnlySelf();
    error BoardroomNotActive();
    error ControllerNotActive();
    error BoardroomEpochMismatch(uint256 expected, uint256 actual);
    error ConfigurationEpochMismatch(uint256 expected, uint256 actual);
    error UnsupportedSelfOperation(bytes4 selector);
    error OperationAlreadyKnown(bytes32 operationId);
    error OperationNotPending(bytes32 operationId);
    error OperationNotReady(bytes32 operationId, uint256 eta, uint256 currentTime);
    error OperationExpired(bytes32 operationId, uint256 expiresAt, uint256 currentTime);
    error OperationContextMismatch(bytes32 operationId);
    error SelfOperationFailed(bytes32 operationId);

    event ControllerInitialized(
        address indexed boardroom,
        address indexed proposer,
        uint256 indexed generation,
        uint256 delay,
        uint256 gracePeriod,
        uint256 configurationEpoch
    );
    event BoardroomOperationScheduled(
        bytes32 indexed operationId,
        address indexed proposer,
        uint256 eta,
        uint256 expiresAt,
        uint256 boardroomEpoch,
        uint256 controllerGeneration,
        uint256 configurationEpoch,
        bytes32 salt,
        bytes32 callsHash
    );
    event ControllerOperationScheduled(
        bytes32 indexed operationId,
        address indexed proposer,
        uint256 eta,
        uint256 expiresAt,
        uint256 boardroomEpoch,
        uint256 controllerGeneration,
        uint256 configurationEpoch,
        bytes32 salt,
        bytes32 dataHash
    );
    event OperationCancelled(bytes32 indexed operationId);
    event OperationExecuted(bytes32 indexed operationId, address indexed executor);
    event ConfigurationUpdated(
        address indexed oldProposer,
        address indexed newProposer,
        uint256 oldDelay,
        uint256 newDelay,
        uint256 oldGracePeriod,
        uint256 newGracePeriod,
        uint256 configurationEpoch
    );

    constructor() {
        _disableInitializers();
    }

    function initialize(address boardroom_, address proposer_, uint64 delay_, uint64 gracePeriod_, uint64 generation_)
        external
        initializer
    {
        if (boardroom_ == address(0) || proposer_ == address(0) || proposer_ == address(this)) {
            revert InvalidAddress();
        }
        _requireConfiguration(delay_, gracePeriod_);
        if (generation_ == 0) revert InvalidConfiguration();

        factory = msg.sender;
        boardroom = boardroom_;
        proposer = proposer_;
        delay = delay_;
        gracePeriod = gracePeriod_;
        generation = generation_;
        configurationEpoch = 1;

        emit ControllerInitialized(boardroom_, proposer_, generation_, delay_, gracePeriod_, 1);
    }

    function scheduleBoardroomOperation(
        BoardroomCall[] calldata calls,
        bytes32 salt,
        uint256 expectedBoardroomEpoch,
        uint256 expectedConfigurationEpoch
    ) external returns (bytes32 operationId, uint256 eta) {
        _requireProposer();
        _requireActiveContext(expectedBoardroomEpoch, expectedConfigurationEpoch);
        if (calls.length == 0) revert InvalidConfiguration();
        if (calls.length > MAX_BATCH_CALLS) revert TooManyCalls(calls.length, MAX_BATCH_CALLS);

        bytes32 callsHash = keccak256(abi.encode(calls));
        operationId =
            _hashBoardroomOperation(callsHash, salt, expectedBoardroomEpoch, expectedConfigurationEpoch, msg.sender);
        eta = _schedule(operationId);
        OperationState storage state = operations[operationId];
        emit BoardroomOperationScheduled(
            operationId,
            msg.sender,
            eta,
            state.expiresAt,
            expectedBoardroomEpoch,
            generation,
            expectedConfigurationEpoch,
            salt,
            callsHash
        );
    }

    function scheduleControllerOperation(
        bytes calldata data,
        bytes32 salt,
        uint256 expectedBoardroomEpoch,
        uint256 expectedConfigurationEpoch
    ) external returns (bytes32 operationId, uint256 eta) {
        _requireProposer();
        _requireActiveContext(expectedBoardroomEpoch, expectedConfigurationEpoch);
        _requireSupportedSelfOperation(data);

        bytes32 dataHash = keccak256(data);
        operationId =
            _hashControllerOperation(dataHash, salt, expectedBoardroomEpoch, expectedConfigurationEpoch, msg.sender);
        eta = _schedule(operationId);
        OperationState storage state = operations[operationId];
        emit ControllerOperationScheduled(
            operationId,
            msg.sender,
            eta,
            state.expiresAt,
            expectedBoardroomEpoch,
            generation,
            expectedConfigurationEpoch,
            salt,
            dataHash
        );
    }

    function executeBoardroomOperation(
        BoardroomCall[] calldata calls,
        bytes32 salt,
        uint256 expectedBoardroomEpoch,
        uint256 expectedConfigurationEpoch,
        address authority
    ) external nonReentrant returns (bytes[] memory results) {
        _requireActiveContext(expectedBoardroomEpoch, expectedConfigurationEpoch);
        if (authority != proposer) revert OperationContextMismatch(bytes32(0));

        bytes32 operationId = _hashBoardroomOperation(
            keccak256(abi.encode(calls)), salt, expectedBoardroomEpoch, expectedConfigurationEpoch, authority
        );
        _consumeReady(operationId);
        results = IBoardroomGovernance(boardroom).executeGovernance(expectedBoardroomEpoch, authority, calls);
        emit OperationExecuted(operationId, msg.sender);
    }

    function executeControllerOperation(
        bytes calldata data,
        bytes32 salt,
        uint256 expectedBoardroomEpoch,
        uint256 expectedConfigurationEpoch,
        address authority
    ) external nonReentrant {
        _requireActiveContext(expectedBoardroomEpoch, expectedConfigurationEpoch);
        if (authority != proposer) revert OperationContextMismatch(bytes32(0));
        _requireSupportedSelfOperation(data);

        bytes32 operationId = _hashControllerOperation(
            keccak256(data), salt, expectedBoardroomEpoch, expectedConfigurationEpoch, authority
        );
        _consumeReady(operationId);
        (bool success,) = address(this).call(data);
        if (!success) revert SelfOperationFailed(operationId);
        emit OperationExecuted(operationId, msg.sender);
    }

    function cancelOperation(bytes32 operationId) external {
        if (msg.sender != boardroom) revert OnlyBoardroom();
        OperationState storage state = operations[operationId];
        if (state.status != OperationStatus.Pending) revert OperationNotPending(operationId);
        state.status = OperationStatus.Cancelled;
        emit OperationCancelled(operationId);
    }

    function updateConfiguration(address proposer_, uint64 delay_, uint64 gracePeriod_) external {
        if (msg.sender != address(this)) revert OnlySelf();
        if (proposer_ == address(0) || proposer_ == address(this)) revert InvalidAddress();
        _requireConfiguration(delay_, gracePeriod_);

        address oldProposer = proposer;
        uint64 oldDelay = delay;
        uint64 oldGracePeriod = gracePeriod;
        proposer = proposer_;
        delay = delay_;
        gracePeriod = gracePeriod_;
        uint64 nextEpoch = configurationEpoch + 1;
        configurationEpoch = nextEpoch;

        emit ConfigurationUpdated(oldProposer, proposer_, oldDelay, delay_, oldGracePeriod, gracePeriod_, nextEpoch);
    }

    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        return SignatureCheckerLib.isValidSignatureNowCalldata(proposer, hash, signature)
            ? ERC1271_MAGIC_VALUE
            : bytes4(0xffffffff);
    }

    function operationState(bytes32 operationId)
        external
        view
        returns (uint256 eta, uint256 expiresAt, OperationStatus operationStatus)
    {
        OperationState storage state = operations[operationId];
        return (state.eta, state.expiresAt, state.status);
    }

    function configurationHash() public view returns (bytes32) {
        return keccak256(abi.encode(boardroom, proposer, delay, gracePeriod, generation, configurationEpoch));
    }

    function hashBoardroomOperation(
        BoardroomCall[] calldata calls,
        bytes32 salt,
        uint256 expectedBoardroomEpoch,
        uint256 expectedConfigurationEpoch,
        address authority
    ) external view returns (bytes32) {
        return _hashBoardroomOperation(
            keccak256(abi.encode(calls)), salt, expectedBoardroomEpoch, expectedConfigurationEpoch, authority
        );
    }

    function hashControllerOperation(
        bytes calldata data,
        bytes32 salt,
        uint256 expectedBoardroomEpoch,
        uint256 expectedConfigurationEpoch,
        address authority
    ) external view returns (bytes32) {
        return _hashControllerOperation(
            keccak256(data), salt, expectedBoardroomEpoch, expectedConfigurationEpoch, authority
        );
    }

    function _hashBoardroomOperation(
        bytes32 callsHash,
        bytes32 salt,
        uint256 expectedBoardroomEpoch,
        uint256 expectedConfigurationEpoch,
        address authority
    ) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                BOARDROOM_OPERATION_TYPEHASH,
                address(this),
                boardroom,
                callsHash,
                salt,
                expectedBoardroomEpoch,
                generation,
                expectedConfigurationEpoch,
                authority,
                configurationHash()
            )
        );
    }

    function _hashControllerOperation(
        bytes32 dataHash,
        bytes32 salt,
        uint256 expectedBoardroomEpoch,
        uint256 expectedConfigurationEpoch,
        address authority
    ) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                CONTROLLER_OPERATION_TYPEHASH,
                address(this),
                boardroom,
                dataHash,
                salt,
                expectedBoardroomEpoch,
                generation,
                expectedConfigurationEpoch,
                authority,
                configurationHash()
            )
        );
    }

    function _schedule(bytes32 operationId) internal returns (uint256 eta) {
        if (operations[operationId].status != OperationStatus.Unset) revert OperationAlreadyKnown(operationId);
        eta = block.timestamp + delay;
        uint256 expiresAt = eta + gracePeriod;
        if (expiresAt > type(uint64).max) revert InvalidConfiguration();
        operations[operationId] =
            OperationState({eta: uint64(eta), expiresAt: uint64(expiresAt), status: OperationStatus.Pending});
    }

    function _consumeReady(bytes32 operationId) internal {
        OperationState storage state = operations[operationId];
        if (state.status != OperationStatus.Pending) revert OperationNotPending(operationId);
        if (block.timestamp < state.eta) revert OperationNotReady(operationId, state.eta, block.timestamp);
        if (block.timestamp > state.expiresAt) {
            revert OperationExpired(operationId, state.expiresAt, block.timestamp);
        }
        state.status = OperationStatus.Executed;
    }

    function _requireActiveContext(uint256 expectedBoardroomEpoch, uint256 expectedConfigurationEpoch) internal view {
        IBoardroomGovernance governed = IBoardroomGovernance(boardroom);
        if (governed.status() != BOARDROOM_STATUS_ACTIVE) revert BoardroomNotActive();
        if (governed.controller() != address(this) || governed.controllerGeneration() != generation) {
            revert ControllerNotActive();
        }
        uint256 actualBoardroomEpoch = governed.governanceEpoch();
        if (actualBoardroomEpoch != expectedBoardroomEpoch) {
            revert BoardroomEpochMismatch(expectedBoardroomEpoch, actualBoardroomEpoch);
        }
        uint256 actualConfigurationEpoch = configurationEpoch;
        if (actualConfigurationEpoch != expectedConfigurationEpoch) {
            revert ConfigurationEpochMismatch(expectedConfigurationEpoch, actualConfigurationEpoch);
        }
    }

    function _requireSupportedSelfOperation(bytes calldata data) internal pure {
        bytes4 selector = data.length < 4 ? bytes4(0) : bytes4(data[:4]);
        if (selector != BoardroomController.updateConfiguration.selector) {
            revert UnsupportedSelfOperation(selector);
        }
    }

    function _requireProposer() internal view {
        if (msg.sender != proposer) revert OnlyProposer();
    }

    function _requireConfiguration(uint64 delay_, uint64 gracePeriod_) internal pure {
        if (
            delay_ < MIN_DELAY || delay_ > MAX_DELAY || gracePeriod_ < MIN_GRACE_PERIOD
                || gracePeriod_ > MAX_GRACE_PERIOD
        ) {
            revert InvalidConfiguration();
        }
    }
}
