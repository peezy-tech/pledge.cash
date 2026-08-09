// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IBoardroom} from "../boardroom/IBoardroom.sol";
import {IPositionManager} from "./IPositionManager.sol";
import {LiquidityLocker} from "./LiquidityLocker.sol";

interface ILiquidityLockerBoardroomFactory {
    function isBoardroom(address boardroom) external view returns (bool);

    function isShareToken(address token) external view returns (bool);
}

/// @notice Deterministic registry for canonical one-position Boardroom lockers.
contract LiquidityLockerFactory {
    address public immutable boardroomFactory;
    IPositionManager public immutable positionManager;
    address public immutable protocolFeeRouter;

    mapping(address boardroom => address locker) public lockerOfBoardroom;

    error InvalidAddress(address account);
    error InvalidBoardroom(address boardroom);
    error ActiveLockerExists(address boardroom, address locker);

    event LiquidityLockerCreated(
        address indexed locker,
        address indexed boardroom,
        address indexed quoteAsset,
        uint24 poolFee,
        int24 tickSpacing,
        bytes32 salt
    );

    constructor(address boardroomFactory_, IPositionManager positionManager_, address protocolFeeRouter_) {
        if (boardroomFactory_ == address(0) || boardroomFactory_.code.length == 0) {
            revert InvalidAddress(boardroomFactory_);
        }
        if (address(positionManager_) == address(0) || address(positionManager_).code.length == 0) {
            revert InvalidAddress(address(positionManager_));
        }
        if (protocolFeeRouter_ == address(0) || protocolFeeRouter_.code.length == 0) {
            revert InvalidAddress(protocolFeeRouter_);
        }
        boardroomFactory = boardroomFactory_;
        positionManager = positionManager_;
        protocolFeeRouter = protocolFeeRouter_;
    }

    /// @notice Creates and atomically registers a liquidity escrow for msg.sender.
    /// @dev Must be reached as the active target of Boardroom.execute.
    function createLocker(address quoteAsset, uint24 poolFee, int24 tickSpacing, bytes32 salt)
        external
        returns (address locker)
    {
        address boardroom = msg.sender;
        ILiquidityLockerBoardroomFactory canonicalFactory = ILiquidityLockerBoardroomFactory(boardroomFactory);
        if (!canonicalFactory.isBoardroom(boardroom)) {
            revert InvalidBoardroom(boardroom);
        }
        if (canonicalFactory.isShareToken(quoteAsset)) revert InvalidAddress(quoteAsset);
        address existing = lockerOfBoardroom[boardroom];
        if (existing != address(0) && IBoardroom(boardroom).escrowState(existing) == IBoardroom.EscrowState.Open) {
            revert ActiveLockerExists(boardroom, existing);
        }
        address shareToken = IBoardroom(boardroom).shareToken();
        bytes32 deploymentSalt = _deploymentSalt(boardroom, quoteAsset, poolFee, tickSpacing, salt);
        locker = address(
            new LiquidityLocker{salt: deploymentSalt}(
                boardroom, positionManager, protocolFeeRouter, shareToken, quoteAsset, poolFee, tickSpacing
            )
        );

        lockerOfBoardroom[boardroom] = locker;
        // Boardroom shares returned by the position are treasury shares and burn at
        // snapshot; only the external quote asset belongs in the redemption registry.
        IBoardroom(boardroom).reserveRedeemableAsset(quoteAsset);
        IBoardroom(boardroom).registerEscrow(locker);
        emit LiquidityLockerCreated(locker, boardroom, quoteAsset, poolFee, tickSpacing, salt);
    }

    function _deploymentSalt(address boardroom, address quoteAsset, uint24 poolFee, int24 tickSpacing, bytes32 salt)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(boardroom, quoteAsset, poolFee, tickSpacing, salt));
    }
}
