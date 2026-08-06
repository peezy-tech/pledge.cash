// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {IBoardroom} from "../boardroom/IBoardroom.sol";
import {IPositionManager} from "./IPositionManager.sol";
import {LiquidityLocker} from "./LiquidityLocker.sol";

interface ILiquidityLockerBoardroomFactory {
    function isBoardroom(address boardroom) external view returns (bool);

    function isShareToken(address token) external view returns (bool);
}

/// @notice Deterministic registry for canonical one-position Boardroom lockers.
contract LiquidityLockerFactory is ReentrancyGuard {
    address public immutable boardroomFactory;
    IPositionManager public immutable positionManager;
    address public immutable protocolFeeRouter;

    address[] public allLockers;
    mapping(address locker => bool canonical) public isLocker;
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

    /// @notice Creates and atomically registers a liquidity obligation for msg.sender.
    /// @dev Must be reached as the active target of Boardroom.execute.
    function createLocker(address quoteAsset, uint24 poolFee, int24 tickSpacing, bytes32 salt)
        external
        nonReentrant
        returns (address locker)
    {
        address boardroom = msg.sender;
        ILiquidityLockerBoardroomFactory canonicalFactory = ILiquidityLockerBoardroomFactory(boardroomFactory);
        if (!canonicalFactory.isBoardroom(boardroom)) {
            revert InvalidBoardroom(boardroom);
        }
        if (canonicalFactory.isShareToken(quoteAsset)) revert InvalidAddress(quoteAsset);
        address existing = lockerOfBoardroom[boardroom];
        if (existing != address(0) && IBoardroom(boardroom).isLockedLiquidity(existing)) {
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
        isLocker[locker] = true;
        allLockers.push(locker);
        address[] memory dependencies = new address[](1);
        // Boardroom shares returned by the position are treasury shares and burn at
        // snapshot; only the external quote asset is a redeemable dependency.
        dependencies[0] = quoteAsset;
        IBoardroom(boardroom).registerObligation(locker, IBoardroom.ObligationKind.Liquidity, dependencies);
        emit LiquidityLockerCreated(locker, boardroom, quoteAsset, poolFee, tickSpacing, salt);
    }

    function predictLockerAddress(
        address boardroom,
        address quoteAsset,
        uint24 poolFee,
        int24 tickSpacing,
        bytes32 salt
    ) external view returns (address predicted) {
        address shareToken = IBoardroom(boardroom).shareToken();
        bytes32 deploymentSalt = _deploymentSalt(boardroom, quoteAsset, poolFee, tickSpacing, salt);
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(
                type(LiquidityLocker).creationCode,
                abi.encode(boardroom, positionManager, protocolFeeRouter, shareToken, quoteAsset, poolFee, tickSpacing)
            )
        );
        predicted = address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), deploymentSalt, initCodeHash))))
        );
    }

    function allLockersLength() external view returns (uint256) {
        return allLockers.length;
    }

    function _deploymentSalt(address boardroom, address quoteAsset, uint24 poolFee, int24 tickSpacing, bytes32 salt)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(boardroom, quoteAsset, poolFee, tickSpacing, salt));
    }
}
