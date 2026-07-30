// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {LibClone} from "solady/utils/LibClone.sol";
import {BoardroomKernel} from "./diamond/BoardroomKernel.sol";
import {BoardroomControllerFactory} from "./BoardroomControllerFactory.sol";
import {IProtocolFacetRegistry} from "./diamond/IProtocolFacetRegistry.sol";

interface IBoardroomCreated {
    function initialize(bytes32 expectedFacetSetHash, bytes calldata initializationData) external;

    function shareToken() external view returns (address);
}

/// @notice Canonical factory for protocol-routed Boardrooms.
contract BoardroomFactory {
    struct CreationMetadata {
        address owner;
        string name;
        string symbol;
        bytes32 salt;
        bytes32 facetSetHash;
    }

    IProtocolFacetRegistry public immutable facetRegistry;
    address public immutable policyRegistry;
    address public immutable wrappedNative;
    address public immutable boardroomKernelLogic;
    address public immutable redemptionPayoutLogic;
    address public immutable governanceLogic;
    address public immutable controllerFactory;
    address public immutable marketLogic;

    address[] public allBoardrooms;
    mapping(address boardroom => bool canonical) public isBoardroom;
    mapping(address shareToken => bool canonical) public isShareToken;

    error InvalidAddress(address account);
    error InvalidKernelRegistry(address expected, address actual);
    error InvalidKernelSelectorSetHash(bytes32 expected, bytes32 actual);
    error FacetSetHashMismatch(bytes32 expected, bytes32 actual);

    event BoardroomCreated(
        address indexed boardroom,
        address indexed owner,
        address indexed policyRegistry,
        address shareToken,
        address wrappedNative,
        string name,
        string symbol,
        bytes32 salt,
        bytes32 facetSetHash
    );

    constructor(
        address facetRegistry_,
        address policyRegistry_,
        address wrappedNative_,
        address boardroomKernelLogic_,
        address redemptionPayoutLogic_,
        address governanceLogic_,
        address marketLogic_
    ) {
        _requireContract(facetRegistry_);
        _requireContract(policyRegistry_);
        _requireContract(wrappedNative_);
        _requireContract(boardroomKernelLogic_);
        _requireContract(redemptionPayoutLogic_);
        _requireContract(governanceLogic_);
        _requireContract(marketLogic_);

        address actualRegistry = address(BoardroomKernel(payable(boardroomKernelLogic_)).facetRegistry());
        if (actualRegistry != facetRegistry_) revert InvalidKernelRegistry(facetRegistry_, actualRegistry);
        bytes32 expectedSelectorSetHash = IProtocolFacetRegistry(facetRegistry_).kernelSelectorSetHash();
        bytes32 actualSelectorSetHash = BoardroomKernel(payable(boardroomKernelLogic_)).kernelSelectorSetHash();
        if (actualSelectorSetHash != expectedSelectorSetHash) {
            revert InvalidKernelSelectorSetHash(expectedSelectorSetHash, actualSelectorSetHash);
        }

        facetRegistry = IProtocolFacetRegistry(facetRegistry_);
        policyRegistry = policyRegistry_;
        wrappedNative = wrappedNative_;
        boardroomKernelLogic = boardroomKernelLogic_;
        redemptionPayoutLogic = redemptionPayoutLogic_;
        governanceLogic = governanceLogic_;
        marketLogic = marketLogic_;

        address controllerFactory_ = address(new BoardroomControllerFactory(address(this)));
        controllerFactory = controllerFactory_;
    }

    function createBoardroom(
        bytes32 expectedFacetSetHash,
        address owner,
        string calldata name,
        string calldata symbol,
        bytes32 salt
    ) external returns (address boardroom) {
        _requireAddress(owner);
        bytes32 activeHash = facetRegistry.activeFacetSetHash();
        if (expectedFacetSetHash != activeHash) {
            revert FacetSetHashMismatch(expectedFacetSetHash, activeHash);
        }

        boardroom = LibClone.cloneDeterministic(boardroomKernelLogic, _deploymentSalt(owner, name, symbol, salt));
        _initializeAndRecord(
            boardroom,
            CreationMetadata({owner: owner, name: name, symbol: symbol, salt: salt, facetSetHash: expectedFacetSetHash})
        );
    }

    function _initializeAndRecord(address boardroom, CreationMetadata memory metadata) internal {
        isBoardroom[boardroom] = true;
        IBoardroomCreated created = IBoardroomCreated(boardroom);
        created.initialize(
            metadata.facetSetHash,
            abi.encode(metadata.owner, policyRegistry, wrappedNative, metadata.name, metadata.symbol)
        );
        address token = created.shareToken();
        allBoardrooms.push(boardroom);
        isShareToken[token] = true;

        emit BoardroomCreated(
            boardroom,
            metadata.owner,
            policyRegistry,
            token,
            wrappedNative,
            metadata.name,
            metadata.symbol,
            metadata.salt,
            metadata.facetSetHash
        );
    }

    function predictBoardroomAddress(address owner, string calldata name, string calldata symbol, bytes32 salt)
        external
        view
        returns (address)
    {
        return LibClone.predictDeterministicAddress(
            boardroomKernelLogic, _deploymentSalt(owner, name, symbol, salt), address(this)
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
        if (account == address(0)) revert InvalidAddress(account);
    }

    function _requireContract(address account) internal view {
        if (account == address(0) || account.code.length == 0) revert InvalidAddress(account);
    }
}
