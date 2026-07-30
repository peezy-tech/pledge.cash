// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Initializable} from "solady/utils/Initializable.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {SignatureCheckerLib} from "solady/utils/SignatureCheckerLib.sol";
import {BoardroomCall} from "./IBoardroomGovernance.sol";

interface IBoardroomGovernanceTarget {
    function facetSetHash() external view returns (bytes32);

    function migrationRequired() external view returns (bool);

    function status() external view returns (uint8);

    function governanceEpoch() external view returns (uint256);

    function controller() external view returns (address);

    function controllerGeneration() external view returns (uint256);

    function executeGovernance(
        bytes32 expectedFacetSetHash,
        uint256 expectedEpoch,
        address authority,
        BoardroomCall[] calldata calls
    ) external returns (bytes[] memory results);
}

/// @notice Canonical controller whose operation identity is bound to the global Boardroom release hash.
contract BoardroomController is Initializable, ReentrancyGuard {
    bytes4 public constant ERC1271_MAGIC_VALUE = 0x1626ba7e;
    bytes4 public constant ERC1271_INVALID_VALUE = 0xffffffff;
    bytes4 public constant ERC1271_ENVELOPE_SCHEME =
        bytes4(keccak256("PledgeCash.BoardroomController.ERC1271Envelope.v1"));
    uint256 public constant MIN_DELAY = 1 days;
    uint256 public constant MAX_DELAY = 30 days;
    uint256 public constant MIN_GRACE_PERIOD = 1 days;
    uint256 public constant MAX_GRACE_PERIOD = 30 days;
    uint256 public constant MAX_BATCH_CALLS = 16;

    uint8 internal constant BOARDROOM_STATUS_ACTIVE = 0;
    bytes32 internal constant BOARDROOM_OPERATION_TYPEHASH = keccak256(
        "BoardroomOperation(address controller,address boardroom,bytes32 facetSetHash,bytes32 callsHash,bytes32 salt,uint256 boardroomEpoch,uint256 controllerGeneration,uint256 configurationEpoch,address authority,bytes32 configurationHash)"
    );
    bytes32 internal constant CONTROLLER_OPERATION_TYPEHASH = keccak256(
        "ControllerOperation(address controller,address boardroom,bytes32 facetSetHash,bytes32 dataHash,bytes32 salt,uint256 boardroomEpoch,uint256 controllerGeneration,uint256 configurationEpoch,address authority,bytes32 configurationHash)"
    );
    bytes32 public constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant EIP712_NAME_HASH = keccak256("PledgeCash Boardroom Controller");
    bytes32 public constant EIP712_VERSION_HASH = keccak256("1");
    bytes32 public constant BOARDROOM_CONTROL_PROOF_TYPEHASH = keccak256(
        "BoardroomControlProof(bytes32 messageHash,address boardroom,bytes32 facetSetHash,uint256 boardroomEpoch,uint256 controllerGeneration,uint256 configurationEpoch,bytes32 configurationHash)"
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

    struct ERC1271Envelope {
        bytes32 facetSetHash;
        uint256 boardroomEpoch;
        uint256 controllerGeneration;
        uint256 configurationEpoch;
        bytes32 configurationHash;
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
    error BoardroomMigrationRequired();
    error ControllerNotActive();
    error FacetSetMismatch(bytes32 expected, bytes32 actual);
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
        bytes32 indexed facetSetHash,
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
        bytes32 indexed facetSetHash,
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
        bytes32 expectedFacetSetHash,
        BoardroomCall[] calldata calls,
        bytes32 salt,
        uint256 expectedBoardroomEpoch,
        uint256 expectedConfigurationEpoch
    ) external returns (bytes32 operationId, uint256 eta) {
        _requireProposer();
        _requireActiveContext(expectedFacetSetHash, expectedBoardroomEpoch, expectedConfigurationEpoch);
        if (calls.length == 0) revert InvalidConfiguration();
        if (calls.length > MAX_BATCH_CALLS) revert TooManyCalls(calls.length, MAX_BATCH_CALLS);

        bytes32 callsHash = keccak256(abi.encode(calls));
        operationId = _hashBoardroomOperation(
            expectedFacetSetHash, callsHash, salt, expectedBoardroomEpoch, expectedConfigurationEpoch, msg.sender
        );
        eta = _schedule(operationId);
        OperationState storage state = operations[operationId];
        emit BoardroomOperationScheduled(
            operationId,
            msg.sender,
            expectedFacetSetHash,
            eta,
            state.expiresAt,
            expectedBoardroomEpoch,
            generation,
            expectedConfigurationEpoch,
            salt,
            callsHash
        );
    }

    function executeBoardroomOperation(
        bytes32 expectedFacetSetHash,
        BoardroomCall[] calldata calls,
        bytes32 salt,
        uint256 expectedBoardroomEpoch,
        uint256 expectedConfigurationEpoch,
        address authority
    ) external nonReentrant returns (bytes[] memory results) {
        _requireActiveContext(expectedFacetSetHash, expectedBoardroomEpoch, expectedConfigurationEpoch);
        if (authority != proposer) revert OperationContextMismatch(bytes32(0));
        bytes32 operationId = _hashBoardroomOperation(
            expectedFacetSetHash,
            keccak256(abi.encode(calls)),
            salt,
            expectedBoardroomEpoch,
            expectedConfigurationEpoch,
            authority
        );
        _consumeReady(operationId);
        results = IBoardroomGovernanceTarget(boardroom)
            .executeGovernance(expectedFacetSetHash, expectedBoardroomEpoch, authority, calls);
        emit OperationExecuted(operationId, msg.sender);
    }

    function scheduleControllerOperation(
        bytes32 expectedFacetSetHash,
        bytes calldata data,
        bytes32 salt,
        uint256 expectedBoardroomEpoch,
        uint256 expectedConfigurationEpoch
    ) external returns (bytes32 operationId, uint256 eta) {
        _requireProposer();
        _requireActiveContext(expectedFacetSetHash, expectedBoardroomEpoch, expectedConfigurationEpoch);
        _requireSupportedSelfOperation(data);
        bytes32 dataHash = keccak256(data);
        operationId = _hashControllerOperation(
            expectedFacetSetHash, dataHash, salt, expectedBoardroomEpoch, expectedConfigurationEpoch, msg.sender
        );
        eta = _schedule(operationId);
        OperationState storage state = operations[operationId];
        emit ControllerOperationScheduled(
            operationId,
            msg.sender,
            expectedFacetSetHash,
            eta,
            state.expiresAt,
            expectedBoardroomEpoch,
            generation,
            expectedConfigurationEpoch,
            salt,
            dataHash
        );
    }

    function executeControllerOperation(
        bytes32 expectedFacetSetHash,
        bytes calldata data,
        bytes32 salt,
        uint256 expectedBoardroomEpoch,
        uint256 expectedConfigurationEpoch,
        address authority
    ) external nonReentrant {
        _requireActiveContext(expectedFacetSetHash, expectedBoardroomEpoch, expectedConfigurationEpoch);
        if (authority != proposer) revert OperationContextMismatch(bytes32(0));
        _requireSupportedSelfOperation(data);
        bytes32 operationId = _hashControllerOperation(
            expectedFacetSetHash, keccak256(data), salt, expectedBoardroomEpoch, expectedConfigurationEpoch, authority
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
        configurationEpoch += 1;
        emit ConfigurationUpdated(
            oldProposer, proposer_, oldDelay, delay_, oldGracePeriod, gracePeriod_, configurationEpoch
        );
    }

    /// @notice Validates a proposer signature only in the live Boardroom release context.
    /// @dev `signature` must be the canonical ABI encoding
    /// `abi.encode(ERC1271_ENVELOPE_SCHEME, facetSetHash, boardroomEpoch,
    /// controllerGeneration, configurationEpoch, configurationHash,
    /// proposerSignature)`. The proposer signs the EIP-712
    /// `BoardroomControlProof`, not `hash` directly. Raw proposer signatures
    /// are not accepted.
    /// Malformed envelopes, failed Boardroom reads, stale releases, migration
    /// downtime, inactive lifecycle/controller state, and invalid nested
    /// EOA/ERC-1271 proposer signatures all return `ERC1271_INVALID_VALUE`.
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        (bool decoded, ERC1271Envelope memory envelope, bytes calldata proposerSignature) =
            _decodeERC1271SignatureEnvelope(signature);
        if (!decoded) return ERC1271_INVALID_VALUE;

        if (!_liveSignatureContext(envelope)) return ERC1271_INVALID_VALUE;

        bytes32 digest = _hashERC1271Digest(hash, boardroom, envelope);
        return SignatureCheckerLib.isValidSignatureNowCalldata(proposer, digest, proposerSignature)
            ? ERC1271_MAGIC_VALUE
            : ERC1271_INVALID_VALUE;
    }

    /// @notice Returns the EIP-712 digest for an explicit Boardroom control context.
    /// @dev This helper does not fetch or validate live context. EOAs should sign
    /// the corresponding typed data. Contract-wallet tooling should sign or
    /// approve this resulting digest according to that wallet's ERC-1271 flow.
    function hashERC1271Digest(
        bytes32 hash,
        address boardroom_,
        bytes32 facetSetHash,
        uint256 boardroomEpoch,
        uint256 controllerGeneration,
        uint256 expectedConfigurationEpoch,
        bytes32 expectedConfigurationHash
    ) external view returns (bytes32) {
        ERC1271Envelope memory envelope = ERC1271Envelope({
            facetSetHash: facetSetHash,
            boardroomEpoch: boardroomEpoch,
            controllerGeneration: controllerGeneration,
            configurationEpoch: expectedConfigurationEpoch,
            configurationHash: expectedConfigurationHash
        });
        return _hashERC1271Digest(hash, boardroom_, envelope);
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
        bytes32 expectedFacetSetHash,
        BoardroomCall[] calldata calls,
        bytes32 salt,
        uint256 expectedBoardroomEpoch,
        uint256 expectedConfigurationEpoch,
        address authority
    ) external view returns (bytes32) {
        return _hashBoardroomOperation(
            expectedFacetSetHash,
            keccak256(abi.encode(calls)),
            salt,
            expectedBoardroomEpoch,
            expectedConfigurationEpoch,
            authority
        );
    }

    function hashControllerOperation(
        bytes32 expectedFacetSetHash,
        bytes calldata data,
        bytes32 salt,
        uint256 expectedBoardroomEpoch,
        uint256 expectedConfigurationEpoch,
        address authority
    ) external view returns (bytes32) {
        return _hashControllerOperation(
            expectedFacetSetHash, keccak256(data), salt, expectedBoardroomEpoch, expectedConfigurationEpoch, authority
        );
    }

    function _hashBoardroomOperation(
        bytes32 expectedFacetSetHash,
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
                expectedFacetSetHash,
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
        bytes32 expectedFacetSetHash,
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
                expectedFacetSetHash,
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

    function _hashERC1271Digest(bytes32 hash, address boardroom_, ERC1271Envelope memory envelope)
        internal
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                BOARDROOM_CONTROL_PROOF_TYPEHASH,
                hash,
                boardroom_,
                envelope.facetSetHash,
                envelope.boardroomEpoch,
                envelope.controllerGeneration,
                envelope.configurationEpoch,
                envelope.configurationHash
            )
        );
        bytes32 domainSeparator = keccak256(
            abi.encode(EIP712_DOMAIN_TYPEHASH, EIP712_NAME_HASH, EIP712_VERSION_HASH, block.chainid, address(this))
        );
        return keccak256(abi.encodePacked(hex"1901", domainSeparator, structHash));
    }

    function _liveSignatureContext(ERC1271Envelope memory envelope) internal view returns (bool active) {
        if (
            envelope.controllerGeneration != generation || envelope.configurationEpoch != configurationEpoch
                || envelope.configurationHash != configurationHash()
        ) {
            return false;
        }
        if (boardroom.code.length == 0) return false;

        IBoardroomGovernanceTarget governed = IBoardroomGovernanceTarget(boardroom);
        try governed.facetSetHash() returns (bytes32 actualFacetSetHash) {
            if (actualFacetSetHash != envelope.facetSetHash) return false;
        } catch {
            return false;
        }
        try governed.migrationRequired() returns (bool required) {
            if (required) return false;
        } catch {
            return false;
        }
        try governed.status() returns (uint8 boardroomStatus) {
            if (boardroomStatus != BOARDROOM_STATUS_ACTIVE) return false;
        } catch {
            return false;
        }
        try governed.controller() returns (address activeController) {
            if (activeController != address(this)) return false;
        } catch {
            return false;
        }
        try governed.controllerGeneration() returns (uint256 activeGeneration) {
            if (activeGeneration != envelope.controllerGeneration) return false;
        } catch {
            return false;
        }
        try governed.governanceEpoch() returns (uint256 activeEpoch) {
            if (activeEpoch != envelope.boardroomEpoch) return false;
        } catch {
            return false;
        }
        return true;
    }

    function _decodeERC1271SignatureEnvelope(bytes calldata signature)
        internal
        pure
        returns (bool valid, ERC1271Envelope memory envelope, bytes calldata proposerSignature)
    {
        proposerSignature = signature[:0];
        if (signature.length < 256) return (false, envelope, proposerSignature);

        bytes32 schemeWord;
        uint256 dynamicOffset;
        uint256 proposerSignatureLength;
        assembly ("memory-safe") {
            schemeWord := calldataload(signature.offset)
            mstore(envelope, calldataload(add(signature.offset, 0x20)))
            mstore(add(envelope, 0x20), calldataload(add(signature.offset, 0x40)))
            mstore(add(envelope, 0x40), calldataload(add(signature.offset, 0x60)))
            mstore(add(envelope, 0x60), calldataload(add(signature.offset, 0x80)))
            mstore(add(envelope, 0x80), calldataload(add(signature.offset, 0xa0)))
            dynamicOffset := calldataload(add(signature.offset, 0xc0))
            proposerSignatureLength := calldataload(add(signature.offset, 0xe0))
        }
        if (
            schemeWord != bytes32(ERC1271_ENVELOPE_SCHEME) || dynamicOffset != 224
                || proposerSignatureLength > signature.length - 256
        ) {
            return (false, envelope, proposerSignature);
        }

        uint256 paddedSignatureLength = (proposerSignatureLength + 31) & ~uint256(31);
        if (signature.length != 256 + paddedSignatureLength) {
            return (false, envelope, proposerSignature);
        }
        uint256 paddingStart = 256 + proposerSignatureLength;
        for (uint256 i = paddingStart; i < signature.length; ++i) {
            if (signature[i] != bytes1(0)) return (false, envelope, proposerSignature);
        }

        proposerSignature = signature[256:256 + proposerSignatureLength];
        return (true, envelope, proposerSignature);
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

    function _requireActiveContext(
        bytes32 expectedFacetSetHash,
        uint256 expectedBoardroomEpoch,
        uint256 expectedConfigurationEpoch
    ) internal view {
        IBoardroomGovernanceTarget governed = IBoardroomGovernanceTarget(boardroom);
        bytes32 actualFacetSetHash = governed.facetSetHash();
        if (actualFacetSetHash != expectedFacetSetHash) {
            revert FacetSetMismatch(expectedFacetSetHash, actualFacetSetHash);
        }
        if (governed.migrationRequired()) revert BoardroomMigrationRequired();
        if (governed.status() != BOARDROOM_STATUS_ACTIVE) revert BoardroomNotActive();
        if (governed.controller() != address(this) || governed.controllerGeneration() != generation) {
            revert ControllerNotActive();
        }
        uint256 actualBoardroomEpoch = governed.governanceEpoch();
        if (actualBoardroomEpoch != expectedBoardroomEpoch) {
            revert BoardroomEpochMismatch(expectedBoardroomEpoch, actualBoardroomEpoch);
        }
        if (configurationEpoch != expectedConfigurationEpoch) {
            revert ConfigurationEpochMismatch(expectedConfigurationEpoch, configurationEpoch);
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
        ) revert InvalidConfiguration();
    }
}
