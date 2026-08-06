// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {IPositionManager} from "../../src/uniswap/IPositionManager.sol";
import {PositionManagerActions} from "../../src/uniswap/PositionManagerActions.sol";

interface IERC721ReceiverMock {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data)
        external
        returns (bytes4);
}

/// @notice Focused PositionManager double that validates the two action plans used by LiquidityLocker.
contract PositionManagerMock is IPositionManager {
    using SafeTransferLib for address;

    struct Position {
        address owner;
        address approved;
        PoolKey key;
        uint256 info;
        uint128 liquidity;
        uint128 principal0;
        uint128 principal1;
        uint128 fees0;
        uint128 fees1;
    }

    mapping(uint256 tokenId => Position position) internal positions;

    bytes public lastActions;
    address public reentryTarget;
    bool public reentryAttempted;
    bool public reentrySucceeded;

    error InvalidOwner(uint256 tokenId);
    error NotApproved(address caller, uint256 tokenId);
    error InvalidReceiver(address receiver);
    error InvalidActionPlan();
    error InvalidActionParameters();
    error DeadlinePassed(uint256 deadline);
    error SlippageExceeded(uint256 amount0, uint256 minimum0, uint256 amount1, uint256 minimum1);

    function mintDirect(
        address owner,
        uint256 tokenId_,
        PoolKey calldata key,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity,
        uint128 principal0,
        uint128 principal1
    ) external {
        if (owner == address(0) || positions[tokenId_].owner != address(0)) {
            revert InvalidOwner(tokenId_);
        }
        Position storage position = positions[tokenId_];
        position.owner = owner;
        position.key = key;
        position.info = _positionInfo(tickLower, tickUpper);
        position.liquidity = liquidity;
        position.principal0 = principal0;
        position.principal1 = principal1;
    }

    function approve(address approved, uint256 tokenId_) external {
        Position storage position = positions[tokenId_];
        if (position.owner != msg.sender) revert NotApproved(msg.sender, tokenId_);
        position.approved = approved;
    }

    function ownerOf(uint256 tokenId_) external view returns (address owner) {
        owner = positions[tokenId_].owner;
        if (owner == address(0)) revert InvalidOwner(tokenId_);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId_) external {
        _transferFrom(from, to, tokenId_, true);
    }

    function transferFrom(address from, address to, uint256 tokenId_) external {
        _transferFrom(from, to, tokenId_, false);
    }

    function _transferFrom(address from, address to, uint256 tokenId_, bool safe) internal {
        Position storage position = positions[tokenId_];
        if (position.owner != from) revert InvalidOwner(tokenId_);
        if (msg.sender != from && msg.sender != position.approved) revert NotApproved(msg.sender, tokenId_);
        position.owner = to;
        position.approved = address(0);
        if (safe && to.code.length != 0) {
            bytes4 received = IERC721ReceiverMock(to).onERC721Received(msg.sender, from, tokenId_, "");
            if (received != IERC721ReceiverMock.onERC721Received.selector) revert InvalidReceiver(to);
        }
    }

    function getPoolAndPositionInfo(uint256 tokenId_) external view returns (PoolKey memory key, uint256 positionInfo) {
        Position storage position = positions[tokenId_];
        if (position.owner == address(0)) revert InvalidOwner(tokenId_);
        return (position.key, position.info);
    }

    function getPositionLiquidity(uint256 tokenId_) external view returns (uint128 liquidity) {
        Position storage position = positions[tokenId_];
        if (position.owner == address(0)) revert InvalidOwner(tokenId_);
        return position.liquidity;
    }

    function accrueFees(uint256 tokenId_, uint128 amount0, uint128 amount1) external {
        Position storage position = positions[tokenId_];
        if (position.owner == address(0)) revert InvalidOwner(tokenId_);
        position.fees0 += amount0;
        position.fees1 += amount1;
    }

    function setSubscriberFlag(uint256 tokenId_, bool subscribed) external {
        Position storage position = positions[tokenId_];
        if (position.owner == address(0)) revert InvalidOwner(tokenId_);
        if (subscribed) {
            position.info |= 1;
        } else {
            position.info &= ~uint256(0xff);
        }
    }

    function configureReentry(address target) external {
        reentryTarget = target;
        reentryAttempted = false;
        reentrySucceeded = false;
    }

    function modifyLiquidities(bytes calldata unlockData, uint256 deadline) external payable {
        if (deadline < block.timestamp) revert DeadlinePassed(deadline);
        (bytes memory actions, bytes[] memory params) = abi.decode(unlockData, (bytes, bytes[]));
        if (actions.length != 2 || uint8(actions[1]) != PositionManagerActions.TAKE_PAIR || params.length != 2) {
            revert InvalidActionPlan();
        }
        lastActions = actions;

        if (reentryTarget != address(0)) {
            reentryAttempted = true;
            (reentrySucceeded,) = reentryTarget.call(abi.encodeWithSignature("collectFees()"));
        }

        if (uint8(actions[0]) == PositionManagerActions.DECREASE_LIQUIDITY) {
            _decrease(params[0], params[1]);
        } else if (uint8(actions[0]) == PositionManagerActions.BURN_POSITION) {
            _burn(params[0], params[1]);
        } else {
            revert InvalidActionPlan();
        }
    }

    function positionState(uint256 tokenId_)
        external
        view
        returns (address owner, uint128 liquidity, uint128 principal0, uint128 principal1, uint128 fees0, uint128 fees1)
    {
        Position storage p = positions[tokenId_];
        return (p.owner, p.liquidity, p.principal0, p.principal1, p.fees0, p.fees1);
    }

    function _decrease(bytes memory modifyParams, bytes memory takeParams) internal {
        (uint256 tokenId_, uint256 liquidity, uint128 amount0Min, uint128 amount1Min, bytes memory hookData) =
            abi.decode(modifyParams, (uint256, uint256, uint128, uint128, bytes));
        if (liquidity != 0 || amount0Min != 0 || amount1Min != 0 || hookData.length != 0) {
            revert InvalidActionParameters();
        }
        Position storage position_ = positions[tokenId_];
        _requireApproved(position_, tokenId_);
        address recipient = _validateTake(position_, takeParams);
        uint256 amount0 = position_.fees0;
        uint256 amount1 = position_.fees1;
        position_.fees0 = 0;
        position_.fees1 = 0;
        _pay(position_.key, recipient, amount0, amount1);
    }

    function _burn(bytes memory burnParams, bytes memory takeParams) internal {
        (uint256 tokenId_, uint128 amount0Min, uint128 amount1Min, bytes memory hookData) =
            abi.decode(burnParams, (uint256, uint128, uint128, bytes));
        if (hookData.length != 0) revert InvalidActionParameters();
        Position storage position_ = positions[tokenId_];
        _requireApproved(position_, tokenId_);
        address recipient = _validateTake(position_, takeParams);
        uint256 amount0 = uint256(position_.principal0) + position_.fees0;
        uint256 amount1 = uint256(position_.principal1) + position_.fees1;
        if (amount0 < amount0Min || amount1 < amount1Min) {
            revert SlippageExceeded(amount0, amount0Min, amount1, amount1Min);
        }
        PoolKey memory key = position_.key;
        position_.owner = address(0);
        position_.approved = address(0);
        position_.liquidity = 0;
        position_.principal0 = 0;
        position_.principal1 = 0;
        position_.fees0 = 0;
        position_.fees1 = 0;
        _pay(key, recipient, amount0, amount1);
    }

    function _requireApproved(Position storage position_, uint256 tokenId_) internal view {
        if (position_.owner == address(0)) revert InvalidOwner(tokenId_);
        if (msg.sender != position_.owner && msg.sender != position_.approved) {
            revert NotApproved(msg.sender, tokenId_);
        }
    }

    function _validateTake(Position storage position_, bytes memory takeParams)
        internal
        view
        returns (address recipient)
    {
        (Currency takeCurrency0, Currency takeCurrency1, address recipient_) =
            abi.decode(takeParams, (Currency, Currency, address));
        if (
            Currency.unwrap(takeCurrency0) != Currency.unwrap(position_.key.currency0)
                || Currency.unwrap(takeCurrency1) != Currency.unwrap(position_.key.currency1)
                || recipient_ == address(0)
        ) revert InvalidActionParameters();
        return recipient_;
    }

    function _pay(PoolKey memory key, address recipient, uint256 amount0, uint256 amount1) internal {
        address currency0 = Currency.unwrap(key.currency0);
        address currency1 = Currency.unwrap(key.currency1);
        if (amount0 != 0) currency0.safeTransfer(recipient, amount0);
        if (amount1 != 0) currency1.safeTransfer(recipient, amount1);
    }

    function _positionInfo(int24 tickLower, int24 tickUpper) internal pure returns (uint256 info) {
        info = uint256(uint24(tickLower)) << 8 | uint256(uint24(tickUpper)) << 32;
    }
}
