// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {LibClone} from "solady/utils/LibClone.sol";
import {AmmPool} from "./AmmPool.sol";

contract AmmFactory {
    uint256 public constant SWAP_FEE_BPS = 30;
    uint256 public constant PROTOCOL_FEE_SHARE_BPS = 500;
    uint256 public constant FEE_DENOMINATOR = 10_000;

    address public immutable feeManager;
    address public immutable poolImplementation;
    address public protocolFeeRecipient;
    address[] public allPools;

    mapping(address => mapping(address => address)) public getPool;
    mapping(address => bool) public isPool;

    error IdenticalTokens();
    error ZeroAddress();
    error PoolAlreadyExists(address pool);
    error OnlyFeeManager();
    error ProtocolFeeRecipientAlreadySet(address recipient);

    event PoolCreated(address indexed token0, address indexed token1, address indexed pool, uint256 poolCount);
    event ProtocolFeeRecipientSet(address indexed recipient);

    constructor(address feeManager_) {
        if (feeManager_ == address(0)) revert ZeroAddress();
        feeManager = feeManager_;
        poolImplementation = address(new AmmPool());
    }

    function setProtocolFeeRecipient(address recipient) external {
        if (msg.sender != feeManager) revert OnlyFeeManager();
        if (recipient == address(0)) revert ZeroAddress();
        if (protocolFeeRecipient != address(0)) revert ProtocolFeeRecipientAlreadySet(protocolFeeRecipient);

        protocolFeeRecipient = recipient;
        emit ProtocolFeeRecipientSet(recipient);
    }

    function createPool(address tokenA, address tokenB) external returns (address pool) {
        (address token0, address token1) = sortTokens(tokenA, tokenB);
        if (getPool[token0][token1] != address(0)) revert PoolAlreadyExists(getPool[token0][token1]);

        pool = LibClone.cloneDeterministic(poolImplementation, _salt(token0, token1));
        AmmPool(pool).initialize(token0, token1);

        getPool[token0][token1] = pool;
        getPool[token1][token0] = pool;
        isPool[pool] = true;
        allPools.push(pool);

        emit PoolCreated(token0, token1, pool, allPools.length);
    }

    function allPoolsLength() external view returns (uint256) {
        return allPools.length;
    }

    function predictPoolAddress(address tokenA, address tokenB) external view returns (address) {
        (address token0, address token1) = sortTokens(tokenA, tokenB);
        return LibClone.predictDeterministicAddress(poolImplementation, _salt(token0, token1), address(this));
    }

    function sortTokens(address tokenA, address tokenB) public pure returns (address token0, address token1) {
        if (tokenA == tokenB) revert IdenticalTokens();
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        if (token0 == address(0)) revert ZeroAddress();
    }

    function _salt(address token0, address token1) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(token0, token1));
    }
}
