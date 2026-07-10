// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {LibClone} from "solady/utils/LibClone.sol";
import {Ownable} from "solady/auth/Ownable.sol";
import {AmmPool} from "./AmmPool.sol";

contract AmmFactory is Ownable {
    uint256 public constant SWAP_FEE_BPS = 30;
    uint256 public constant PROTOCOL_FEE_SHARE_BPS = 500;
    uint256 public constant FEE_DENOMINATOR = 10_000;

    struct InitialLiquidityReservation {
        address initializer;
        address recipient;
        address reservationOwner;
    }

    address public feeManager;
    address public immutable poolImplementation;
    address public protocolFeeRecipient;
    address public liquidityRouter;
    address public reservationManager;
    address[] public allPools;

    mapping(address => mapping(address => address)) public getPool;
    mapping(address => bool) public isPool;
    mapping(address => InitialLiquidityReservation) public initialLiquidityReservation;

    error IdenticalTokens();
    error ZeroAddress();
    error PoolAlreadyExists(address pool);
    error OnlyPool();
    error OnlyReservationManager();
    error OnlyLiquidityRouter();
    error PoolAlreadyInitialized(address pool);
    error InitialLiquidityAlreadyReserved(address pool, address reservationOwner);
    error InitialLiquidityReservationMismatch(address expected, address actual);

    event PoolCreated(address indexed token0, address indexed token1, address indexed pool, uint256 poolCount);
    event FeeManagerSet(address indexed previousManager, address indexed newManager);
    event ProtocolFeeRecipientSet(address indexed previousRecipient, address indexed newRecipient);
    event LiquidityRouterSet(address indexed previousRouter, address indexed newRouter);
    event ReservationManagerSet(address indexed previousManager, address indexed newManager);
    event InitialLiquidityReserved(
        address indexed pool, address indexed initializer, address indexed recipient, address reservationOwner
    );
    event InitialLiquidityReservationReleased(address indexed pool, address indexed reservationOwner);
    event InitialLiquidityReservationConsumed(
        address indexed pool, address indexed initializer, address indexed recipient, address reservationOwner
    );

    constructor(address feeManager_) {
        _requireNonZero(feeManager_);

        _initializeOwner(feeManager_);
        feeManager = feeManager_;
        poolImplementation = address(new AmmPool());
        emit FeeManagerSet(address(0), feeManager_);
    }

    function setFeeManager(address manager) external onlyOwner {
        _requireNonZero(manager);

        address previousManager = feeManager;
        feeManager = manager;
        emit FeeManagerSet(previousManager, manager);
    }

    function setProtocolFeeRecipient(address recipient) external onlyOwner {
        _requireNonZero(recipient);

        address previousRecipient = protocolFeeRecipient;
        protocolFeeRecipient = recipient;
        emit ProtocolFeeRecipientSet(previousRecipient, recipient);
    }

    function setLiquidityRouter(address router) external onlyOwner {
        _requireNonZero(router);

        address previousRouter = liquidityRouter;
        liquidityRouter = router;
        emit LiquidityRouterSet(previousRouter, router);
    }

    function setReservationManager(address manager) external onlyOwner {
        _requireNonZero(manager);

        address previousManager = reservationManager;
        reservationManager = manager;
        emit ReservationManagerSet(previousManager, manager);
    }

    function reserveInitialLiquidity(
        address tokenA,
        address tokenB,
        address initializer,
        address recipient,
        address reservationOwner
    ) external returns (address pool) {
        _requireReservationManager();
        _requireNonZero(initializer);
        _requireNonZero(recipient);
        _requireNonZero(reservationOwner);

        pool = getPool[tokenA][tokenB];
        if (pool == address(0)) pool = _createPool(tokenA, tokenB);
        if (AmmPool(pool).totalSupply() != 0) revert PoolAlreadyInitialized(pool);

        InitialLiquidityReservation memory existing = initialLiquidityReservation[pool];
        if (existing.reservationOwner != address(0)) {
            if (
                existing.initializer == initializer && existing.recipient == recipient
                    && existing.reservationOwner == reservationOwner
            ) return pool;
            revert InitialLiquidityAlreadyReserved(pool, existing.reservationOwner);
        }

        initialLiquidityReservation[pool] = InitialLiquidityReservation(initializer, recipient, reservationOwner);
        emit InitialLiquidityReserved(pool, initializer, recipient, reservationOwner);
    }

    function releaseInitialLiquidityReservation(address tokenA, address tokenB, address reservationOwner) external {
        _requireReservationManager();
        address pool = getPool[tokenA][tokenB];
        if (pool == address(0)) return;

        InitialLiquidityReservation memory reservation = initialLiquidityReservation[pool];
        if (reservation.reservationOwner == address(0)) return;
        if (reservation.reservationOwner != reservationOwner) {
            revert InitialLiquidityReservationMismatch(reservation.reservationOwner, reservationOwner);
        }

        delete initialLiquidityReservation[pool];
        emit InitialLiquidityReservationReleased(pool, reservationOwner);
    }

    function consumeInitialLiquidityReservation(address initializer, address recipient, address liquidityCaller)
        external
    {
        if (!isPool[msg.sender]) revert OnlyPool();

        InitialLiquidityReservation memory reservation = initialLiquidityReservation[msg.sender];
        if (reservation.reservationOwner == address(0)) return;
        if (liquidityCaller != liquidityRouter) revert OnlyLiquidityRouter();
        if (initializer != reservation.initializer) {
            revert InitialLiquidityReservationMismatch(reservation.initializer, initializer);
        }
        if (recipient != reservation.recipient) {
            revert InitialLiquidityReservationMismatch(reservation.recipient, recipient);
        }

        delete initialLiquidityReservation[msg.sender];
        emit InitialLiquidityReservationConsumed(
            msg.sender, reservation.initializer, reservation.recipient, reservation.reservationOwner
        );
    }

    function initialLiquidityReservationFor(address tokenA, address tokenB)
        external
        view
        returns (address initializer, address recipient, address reservationOwner)
    {
        InitialLiquidityReservation memory reservation = initialLiquidityReservation[getPool[tokenA][tokenB]];
        return (reservation.initializer, reservation.recipient, reservation.reservationOwner);
    }

    function createPool(address tokenA, address tokenB) external returns (address pool) {
        return _createPool(tokenA, tokenB);
    }

    function _createPool(address tokenA, address tokenB) internal returns (address pool) {
        (address token0, address token1) = sortTokens(tokenA, tokenB);
        _requirePoolMissing(token0, token1);

        pool = LibClone.cloneDeterministic(poolImplementation, _salt(token0, token1));
        AmmPool(pool).initialize(token0, token1);

        _recordPool(token0, token1, pool);
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
        _requireNonZero(token0);
    }

    function _salt(address token0, address token1) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(token0, token1));
    }

    function _requireNonZero(address account) internal pure {
        if (account == address(0)) revert ZeroAddress();
    }

    function _requireReservationManager() internal view {
        if (msg.sender != reservationManager) revert OnlyReservationManager();
    }

    function _requirePoolMissing(address token0, address token1) internal view {
        address existingPool = getPool[token0][token1];
        if (existingPool != address(0)) revert PoolAlreadyExists(existingPool);
    }

    function _recordPool(address token0, address token1, address pool) internal {
        getPool[token0][token1] = pool;
        getPool[token1][token0] = pool;
        isPool[pool] = true;
        allPools.push(pool);
    }
}
