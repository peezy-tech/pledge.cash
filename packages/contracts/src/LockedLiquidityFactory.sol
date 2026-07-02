// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {LibClone} from "solady/utils/LibClone.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {ExactTransferLib} from "./ExactTransferLib.sol";
import {IBoardroomCallPolicy} from "./IBoardroomCallPolicy.sol";
import {LockedLiquidity} from "./LockedLiquidity.sol";

interface ILockedLiquidityFactoryBoardroom {
    function shareToken() external view returns (address);
    function lockedLiquidityExitAllowed() external view returns (bool);
    function isIssuedDistribution(address distribution) external view returns (bool);
}

contract LockedLiquidityFactory is IBoardroomCallPolicy, ReentrancyGuard {
    uint256 internal constant CREATE_LOCKED_LIQUIDITY_DATA_LENGTH = 4 + 32 * 8;
    uint256 public constant MAX_LOCKERS_PER_BOARDROOM = 32;

    struct CreateParams {
        address tokenA;
        address tokenB;
        uint256 amountADesired;
        uint256 amountBDesired;
        uint256 amountAMin;
        uint256 amountBMin;
        uint256 deadline;
        bytes32 salt;
    }

    address public immutable ammRouter;
    address public immutable lockedLiquidityLogic;

    mapping(address => bool) public isLocker;
    mapping(address => address) public lockerBoardroom;
    mapping(address => mapping(address => address)) public lockerForBoardroomPool;
    mapping(address => address[]) internal lockersForBoardroom;

    error InvalidAddress();
    error InvalidAmount();
    error InvalidBoardroom(address boardroom);
    error MissingBoardroomShareToken(address tokenA, address tokenB, address shareToken);
    error UnauthorizedBoardroomPayer(address boardroom, address payer);
    error LockerAlreadyExists(address boardroom, address pool);
    error TooManyBoardroomLockers(address boardroom);
    error TransferAmountMismatch(address token, uint256 expected, uint256 actual);

    event LockedLiquidityCreated(
        address indexed locker,
        address indexed boardroom,
        address indexed pool,
        address tokenA,
        address tokenB,
        uint256 amountA,
        uint256 amountB,
        uint256 liquidity,
        bytes32 salt
    );

    constructor(address ammRouter_) {
        if (ammRouter_ == address(0)) revert InvalidAddress();
        ammRouter = ammRouter_;
        lockedLiquidityLogic = address(new LockedLiquidity());
    }

    function createLockedLiquidity(CreateParams calldata params)
        external
        nonReentrant
        returns (address locker, address pool, uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        return _createLockedLiquidity(msg.sender, msg.sender, params);
    }

    function createLockedLiquidityForBoardroom(address boardroom, CreateParams calldata params)
        external
        nonReentrant
        returns (address locker, address pool, uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        _requireIssuedDistribution(boardroom, msg.sender);
        return _createLockedLiquidity(boardroom, msg.sender, params);
    }

    function canCall(address boardroom, address, address target, uint256 value, bytes calldata data)
        external
        view
        returns (bool)
    {
        if (value != 0) return false;

        bytes4 selector = _selector(data);
        if (target == address(this)) {
            return selector == LockedLiquidityFactory.createLockedLiquidity.selector
                && _canCreateLockedLiquidity(boardroom, data);
        }

        if (lockerBoardroom[target] != boardroom) return false;
        return selector == LockedLiquidity.claimFees.selector;
    }

    function lockerCountForBoardroom(address boardroom) external view returns (uint256) {
        return lockersForBoardroom[boardroom].length;
    }

    function lockerForBoardroomAt(address boardroom, uint256 index) external view returns (address) {
        return lockersForBoardroom[boardroom][index];
    }

    function getLockersForBoardroom(address boardroom) external view returns (address[] memory) {
        return lockersForBoardroom[boardroom];
    }

    function predictLockedLiquidityAddress(address boardroom, bytes32 salt) external view returns (address) {
        return LibClone.predictDeterministicAddress(lockedLiquidityLogic, _cloneSalt(boardroom, salt), address(this));
    }

    function _createLockedLiquidity(address boardroom, address payer, CreateParams calldata params)
        internal
        returns (address locker, address pool, uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        if (
            boardroom == address(0) || payer == address(0) || params.tokenA == address(0) || params.tokenB == address(0)
        ) {
            revert InvalidAddress();
        }
        if (params.tokenA == params.tokenB) revert InvalidAddress();
        if (params.amountADesired == 0 || params.amountBDesired == 0) revert InvalidAmount();

        address shareToken = _boardroomShareToken(boardroom);
        if (params.tokenA != shareToken && params.tokenB != shareToken) {
            revert MissingBoardroomShareToken(params.tokenA, params.tokenB, shareToken);
        }

        if (lockersForBoardroom[boardroom].length >= MAX_LOCKERS_PER_BOARDROOM) {
            revert TooManyBoardroomLockers(boardroom);
        }

        locker = LibClone.cloneDeterministic(lockedLiquidityLogic, _cloneSalt(boardroom, params.salt));
        LockedLiquidity(locker).initialize(address(this), boardroom, ammRouter, params.tokenA, params.tokenB);

        isLocker[locker] = true;
        lockerBoardroom[locker] = boardroom;

        _pullSeedTokens(locker, payer, params);
        (pool, amountA, amountB, liquidity) = LockedLiquidity(locker)
            .seedLiquidity(
                params.amountADesired, params.amountBDesired, params.amountAMin, params.amountBMin, params.deadline
            );

        if (lockerForBoardroomPool[boardroom][pool] != address(0)) revert LockerAlreadyExists(boardroom, pool);

        lockerForBoardroomPool[boardroom][pool] = locker;
        lockersForBoardroom[boardroom].push(locker);

        emit LockedLiquidityCreated(
            locker, boardroom, pool, params.tokenA, params.tokenB, amountA, amountB, liquidity, params.salt
        );
    }

    function _canCreateLockedLiquidity(address boardroom, bytes calldata data) internal view returns (bool) {
        if (data.length != CREATE_LOCKED_LIQUIDITY_DATA_LENGTH) return false;

        CreateParams memory params = abi.decode(data[4:], (CreateParams));
        if (params.tokenA == address(0) || params.tokenB == address(0) || params.tokenA == params.tokenB) return false;
        if (params.amountADesired == 0 || params.amountBDesired == 0) return false;

        address shareToken = _verifiedBoardroomShareToken(boardroom);
        if (shareToken == address(0)) return false;
        return _containsShareToken(params, shareToken);
    }

    function _boardroomShareToken(address boardroom) internal view returns (address shareToken) {
        shareToken = _verifiedBoardroomShareToken(boardroom);
        if (shareToken == address(0)) revert InvalidBoardroom(boardroom);
    }

    function _requireIssuedDistribution(address boardroom, address payer) internal view {
        if (boardroom == address(0) || payer == address(0) || boardroom.code.length == 0) {
            revert UnauthorizedBoardroomPayer(boardroom, payer);
        }

        (bool success, bytes memory data) =
            boardroom.staticcall(abi.encodeCall(ILockedLiquidityFactoryBoardroom.isIssuedDistribution, (payer)));
        if (!success || data.length != 32 || !abi.decode(data, (bool))) {
            revert UnauthorizedBoardroomPayer(boardroom, payer);
        }
    }

    function _verifiedBoardroomShareToken(address boardroom) internal view returns (address shareToken) {
        if (boardroom.code.length == 0) return address(0);

        shareToken = _readBoardroomShareToken(boardroom);
        if (shareToken == address(0)) return address(0);
        if (!_hasLockedLiquidityExitHook(boardroom)) return address(0);
    }

    function _readBoardroomShareToken(address boardroom) internal view returns (address shareToken) {
        (bool success, bytes memory data) =
            boardroom.staticcall(abi.encodeCall(ILockedLiquidityFactoryBoardroom.shareToken, ()));
        if (!success || data.length != 32) return address(0);

        shareToken = abi.decode(data, (address));
    }

    function _hasLockedLiquidityExitHook(address boardroom) internal view returns (bool) {
        (bool success, bytes memory data) =
            boardroom.staticcall(abi.encodeCall(ILockedLiquidityFactoryBoardroom.lockedLiquidityExitAllowed, ()));
        return success && data.length == 32;
    }

    function _containsShareToken(CreateParams memory params, address shareToken) internal pure returns (bool) {
        return params.tokenA == shareToken || params.tokenB == shareToken;
    }

    function _pullSeedTokens(address locker, address payer, CreateParams calldata params) internal {
        _checkedTransferFrom(params.tokenA, payer, locker, params.amountADesired);
        _checkedTransferFrom(params.tokenB, payer, locker, params.amountBDesired);
    }

    function _checkedTransferFrom(address token, address from, address to, uint256 expectedAmount) internal {
        ExactTransferLib.RecipientDelta memory delta = ExactTransferLib.pullTo(token, from, to, expectedAmount);
        if (delta.balanceDecreased) revert TransferAmountMismatch(token, expectedAmount, 0);
        if (delta.received != expectedAmount) {
            revert TransferAmountMismatch(token, expectedAmount, delta.received);
        }
    }

    function _cloneSalt(address boardroom, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(boardroom, salt));
    }

    function _selector(bytes calldata data) internal pure returns (bytes4 selector) {
        if (data.length < 4) return bytes4(0);
        return bytes4(data[:4]);
    }
}
