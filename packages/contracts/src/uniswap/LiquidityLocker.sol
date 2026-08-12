// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "solady/tokens/ERC20.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {IBoardroom} from "../boardroom/IBoardroom.sol";
import {ExactTransferLib} from "../lib/ExactTransferLib.sol";
import {IPositionManager} from "./IPositionManager.sol";
import {PositionManagerActions} from "./PositionManagerActions.sol";

/// @notice Immutable custodian for one hookless Uniswap v4 PositionManager NFT.
/// @dev The Boardroom registers a direct mint after PositionManager has assigned ownership.
contract LiquidityLocker is ReentrancyGuard {
    uint24 public constant MAX_STATIC_POOL_FEE = 1_000_000;
    int24 public constant MAX_TICK_SPACING = type(int16).max;
    uint8 internal constant REGISTERED = 1;
    uint8 internal constant CLOSED = 2;

    address public immutable boardroom;
    address public immutable shareToken;
    address public immutable quoteAsset;
    address public immutable currency0;
    address public immutable currency1;
    address public immutable protocolFeeRouter;
    IPositionManager public immutable positionManager;
    uint24 public immutable poolFee;
    int24 public immutable tickSpacing;

    uint256 public tokenId;
    // A separate discriminator keeps token ID zero valid without synchronizing two lifecycle flags.
    uint8 internal lifecycle;

    error InvalidAddress(address account);
    error OnlyBoardroom(address caller);
    error PositionAlreadyRegistered(uint256 tokenId);
    error PositionNotRegistered();
    error LockerAlreadyClosed();
    error PositionNotOwned(uint256 tokenId, address owner);
    error InvalidPositionPair(address actualCurrency0, address actualCurrency1);
    error HookedPool(address hook);
    error SubscribedPosition(uint256 tokenId);
    error InvalidPositionInfo(uint256 positionInfo);
    error InvalidPoolConfiguration(uint24 poolFee, int24 tickSpacing);
    error EmptyPosition(uint256 tokenId);
    error BoardroomMutationForbidden();
    error BoardroomExitForbidden();
    error DeadlineExpired(uint256 deadline);
    error UnexpectedTokenTransfer(address token, uint256 expected, uint256 senderSpent, uint256 recipientReceived);

    event PositionRegistered(uint256 indexed tokenId, int24 tickLower, int24 tickUpper);
    event FeesCollected(
        uint256 indexed tokenId,
        uint256 boardroomAmount0,
        uint256 boardroomAmount1,
        uint256 protocolAmount0,
        uint256 protocolAmount1
    );
    event LockerCancelled();
    event PositionExited(uint256 indexed tokenId, uint256 amount0, uint256 amount1);

    constructor(
        address boardroom_,
        IPositionManager positionManager_,
        address protocolFeeRouter_,
        address shareToken_,
        address quoteAsset_,
        uint24 poolFee_,
        int24 tickSpacing_
    ) {
        if (boardroom_ == address(0) || boardroom_.code.length == 0) {
            revert InvalidAddress(boardroom_);
        }
        if (address(positionManager_) == address(0) || address(positionManager_).code.length == 0) {
            revert InvalidAddress(address(positionManager_));
        }
        if (protocolFeeRouter_ == address(0) || protocolFeeRouter_.code.length == 0) {
            revert InvalidAddress(protocolFeeRouter_);
        }
        if (shareToken_ == address(0) || shareToken_.code.length == 0) revert InvalidAddress(shareToken_);
        if (quoteAsset_ == address(0) || quoteAsset_.code.length == 0 || quoteAsset_ == shareToken_) {
            revert InvalidAddress(quoteAsset_);
        }
        if (poolFee_ > MAX_STATIC_POOL_FEE || tickSpacing_ <= 0 || tickSpacing_ > MAX_TICK_SPACING) {
            revert InvalidPoolConfiguration(poolFee_, tickSpacing_);
        }
        if (IBoardroom(boardroom_).shareToken() != shareToken_) revert InvalidAddress(shareToken_);

        boardroom = boardroom_;
        positionManager = positionManager_;
        protocolFeeRouter = protocolFeeRouter_;
        shareToken = shareToken_;
        quoteAsset = quoteAsset_;
        poolFee = poolFee_;
        tickSpacing = tickSpacing_;
        (currency0, currency1) = shareToken_ < quoteAsset_ ? (shareToken_, quoteAsset_) : (quoteAsset_, shareToken_);
    }

    modifier onlyBoardroom() {
        if (msg.sender != boardroom) revert OnlyBoardroom(msg.sender);
        _;
    }

    function positionRegistered() external view returns (bool) {
        return lifecycle == REGISTERED;
    }

    function isClosed() external view returns (bool) {
        return lifecycle == CLOSED;
    }

    /// @notice Registers a position minted directly to this locker by a CCA.
    function registerPosition(uint256 positionTokenId) external onlyBoardroom nonReentrant {
        _requireRegistrationAllowed();
        _registerPosition(positionTokenId);
    }

    /// @notice Collects accrued fees without removing principal and forwards them.
    function collectFees()
        external
        nonReentrant
        returns (uint256 boardroomAmount0, uint256 boardroomAmount1, uint256 protocolAmount0, uint256 protocolAmount1)
    {
        _requireMutationAllowed();
        _requirePosition();
        (boardroomAmount0, boardroomAmount1, protocolAmount0, protocolAmount1) = _collectFees();
        _requireMutationAllowed();
    }

    /// @notice Closes an empty pre-launch locker so it cannot block Boardroom wind-down.
    /// @dev Callable by Boardroom.execute while active or executeEscrow while winding down.
    function cancel() external onlyBoardroom nonReentrant {
        if (lifecycle == CLOSED) revert LockerAlreadyClosed();
        if (lifecycle == REGISTERED) revert PositionAlreadyRegistered(tokenId);
        IBoardroom.Status boardroomStatus = IBoardroom(boardroom).status();
        if (boardroomStatus != IBoardroom.Status.Active && boardroomStatus != IBoardroom.Status.WindingDown) {
            revert BoardroomExitForbidden();
        }
        lifecycle = CLOSED;
        emit LockerCancelled();
    }

    /// @notice Collects final fees, burns the position, and transfers all currencies to the Boardroom.
    function exit(uint128 amount0Min, uint128 amount1Min, uint256 deadline)
        external
        onlyBoardroom
        nonReentrant
        returns (uint256 amount0, uint256 amount1)
    {
        if (IBoardroom(boardroom).status() != IBoardroom.Status.WindingDown) {
            revert BoardroomExitForbidden();
        }
        if (deadline < block.timestamp) revert DeadlineExpired(deadline);
        _requirePosition();

        _collectFees();
        uint256 balance0Before = ERC20(currency0).balanceOf(address(this));
        uint256 balance1Before = ERC20(currency1).balanceOf(address(this));

        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(tokenId, amount0Min, amount1Min, bytes(""));
        params[1] = abi.encode(Currency.wrap(currency0), Currency.wrap(currency1), address(this));
        bytes memory actions = abi.encodePacked(PositionManagerActions.BURN_POSITION, PositionManagerActions.TAKE_PAIR);
        positionManager.modifyLiquidities(abi.encode(actions, params), deadline);

        uint256 balance0After = ERC20(currency0).balanceOf(address(this));
        uint256 balance1After = ERC20(currency1).balanceOf(address(this));
        if (balance0After < balance0Before || balance1After < balance1Before) {
            revert UnexpectedTokenTransfer(address(0), 0, 0, 0);
        }
        amount0 = balance0After - balance0Before;
        amount1 = balance1After - balance1Before;

        lifecycle = CLOSED;
        _transferExact(currency0, boardroom, balance0After);
        _transferExact(currency1, boardroom, balance1After);
        emit PositionExited(tokenId, amount0, amount1);
    }

    function _registerPosition(uint256 positionTokenId) internal {
        if (lifecycle == CLOSED) revert LockerAlreadyClosed();
        if (lifecycle == REGISTERED) revert PositionAlreadyRegistered(tokenId);

        address actualOwner;
        try positionManager.ownerOf(positionTokenId) returns (address owner_) {
            actualOwner = owner_;
        } catch {
            revert PositionNotOwned(positionTokenId, address(0));
        }
        if (actualOwner != address(this)) revert PositionNotOwned(positionTokenId, actualOwner);

        (PoolKey memory key, uint256 info) = positionManager.getPoolAndPositionInfo(positionTokenId);
        address actualCurrency0 = Currency.unwrap(key.currency0);
        address actualCurrency1 = Currency.unwrap(key.currency1);
        if (actualCurrency0 != currency0 || actualCurrency1 != currency1) {
            revert InvalidPositionPair(actualCurrency0, actualCurrency1);
        }
        if (address(key.hooks) != address(0)) revert HookedPool(address(key.hooks));
        // PositionInfo's low byte is the subscriber flag. A subscriber adds an
        // independently reverting callback to both collection and burn paths.
        if (info & 0xff != 0) revert SubscribedPosition(positionTokenId);
        (int24 tickLower, int24 tickUpper) = _ticks(info);
        if (key.fee != poolFee || key.tickSpacing != tickSpacing || tickLower >= tickUpper) {
            revert InvalidPositionInfo(info);
        }
        if (positionManager.getPositionLiquidity(positionTokenId) == 0) revert EmptyPosition(positionTokenId);

        tokenId = positionTokenId;
        lifecycle = REGISTERED;
        emit PositionRegistered(positionTokenId, tickLower, tickUpper);
    }

    function _collectFees()
        internal
        returns (uint256 boardroomAmount0, uint256 boardroomAmount1, uint256 protocolAmount0, uint256 protocolAmount1)
    {
        uint256 balance0Before = ERC20(currency0).balanceOf(address(this));
        uint256 balance1Before = ERC20(currency1).balanceOf(address(this));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(tokenId, uint256(0), uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(Currency.wrap(currency0), Currency.wrap(currency1), address(this));
        bytes memory actions =
            abi.encodePacked(PositionManagerActions.DECREASE_LIQUIDITY, PositionManagerActions.TAKE_PAIR);
        positionManager.modifyLiquidities(abi.encode(actions, params), block.timestamp);

        uint256 balance0After = ERC20(currency0).balanceOf(address(this));
        uint256 balance1After = ERC20(currency1).balanceOf(address(this));
        if (balance0After < balance0Before || balance1After < balance1Before) {
            revert UnexpectedTokenTransfer(address(0), 0, 0, 0);
        }
        uint256 fees0 = balance0After - balance0Before;
        uint256 fees1 = balance1After - balance1Before;
        protocolAmount0 = fees0 / 20;
        protocolAmount1 = fees1 / 20;
        boardroomAmount0 = fees0 - protocolAmount0;
        boardroomAmount1 = fees1 - protocolAmount1;

        _transferExact(currency0, protocolFeeRouter, protocolAmount0);
        _transferExact(currency1, protocolFeeRouter, protocolAmount1);
        _transferExact(currency0, boardroom, boardroomAmount0);
        _transferExact(currency1, boardroom, boardroomAmount1);
        emit FeesCollected(tokenId, boardroomAmount0, boardroomAmount1, protocolAmount0, protocolAmount1);
    }

    function _transferExact(address token, address recipient, uint256 amount) internal {
        if (amount == 0) return;
        ExactTransferLib.ExactDelta memory delta = ExactTransferLib.sendFromSelfTo(token, recipient, amount);
        if (
            delta.senderBalanceIncreased || delta.recipientBalanceDecreased || delta.senderSpent != amount
                || delta.recipientReceived != amount
        ) revert UnexpectedTokenTransfer(token, amount, delta.senderSpent, delta.recipientReceived);
    }

    function _requirePosition() internal view {
        if (lifecycle != REGISTERED) revert PositionNotRegistered();
    }

    function _requireMutationAllowed() internal view {
        IBoardroom.Status boardroomStatus = IBoardroom(boardroom).status();
        if (boardroomStatus != IBoardroom.Status.Active && boardroomStatus != IBoardroom.Status.WindingDown) {
            revert BoardroomMutationForbidden();
        }
    }

    function _requireRegistrationAllowed() internal view {
        if (IBoardroom(boardroom).status() != IBoardroom.Status.Active) revert BoardroomMutationForbidden();
    }

    function _ticks(uint256 info) internal pure returns (int24 tickLower, int24 tickUpper) {
        assembly ("memory-safe") {
            tickLower := signextend(2, shr(8, info))
            tickUpper := signextend(2, shr(32, info))
        }
    }
}
