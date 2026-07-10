// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {LibClone} from "solady/utils/LibClone.sol";
import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {LockedLiquidity} from "./LockedLiquidity.sol";
import {ExactTransferLib} from "../lib/ExactTransferLib.sol";
import {IBoardroomObligationPolicy} from "../policy/IBoardroomObligationPolicy.sol";

interface ILockedLiquidityFactoryBoardroom {
    function shareToken() external view returns (address);
    function lockedLiquidityExitAllowed() external view returns (bool);
    function isIssuedDistribution(address distribution) external view returns (bool);
    function policyRegistry() external view returns (address);
}

interface ILockedLiquidityFactoryPolicyRegistry {
    function isModulePolicy(address policy) external view returns (bool);
}

interface ILockedLiquidityFactoryBoardroomFactory {
    function isBoardroom(address boardroom) external view returns (bool);
}

interface ILockedLiquidityFactoryShareToken {
    function boardroom() external view returns (address);
}

interface ILockedLiquidityMigrationDistribution {
    function factory() external view returns (address);
    function boardroom() external view returns (address);
    function shareToken() external view returns (address);
    function quoteToken() external view returns (address);
    function migrationSalt() external view returns (bytes32);
}

interface ILockedLiquidityReservationRouter {
    function poolFor(address tokenA, address tokenB) external view returns (address);
    function factory() external view returns (address);
}

interface ILockedLiquidityReservationAmmFactory {
    function reserveInitialLiquidity(
        address tokenA,
        address tokenB,
        address initializer,
        address recipient,
        address reservationOwner
    ) external returns (address pool);

    function releaseInitialLiquidityReservation(address tokenA, address tokenB, address reservationOwner) external;
}

contract LockedLiquidityFactory is IBoardroomObligationPolicy, ReentrancyGuard {
    uint256 internal constant CREATE_LOCKED_LIQUIDITY_DATA_LENGTH = 4 + 32 * 8;
    uint256 internal constant CREATE_LOCKED_LIQUIDITY_RESULT_LENGTH = 32 * 5;
    uint256 public constant MAX_LOCKERS_PER_BOARDROOM = 32;
    uint256 public constant MAX_SEED_SLIPPAGE_BPS = 500;
    uint256 public constant BPS_DENOMINATOR = 10_000;

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
    address public immutable boardroomFactory;
    address public immutable lockedLiquidityLogic;

    mapping(address => bool) public isLocker;
    mapping(address => address) public lockerBoardroom;
    mapping(address => mapping(address => address)) public lockerForBoardroomPool;
    mapping(address => address[]) internal lockersForBoardroom;
    mapping(address => uint256) public migrationReservationCount;
    mapping(address => mapping(bytes32 => address)) public migrationReservationForSalt;
    mapping(address => mapping(bytes32 => address)) public migrationReservationForPair;

    error InvalidAddress();
    error InvalidBoardroomFactory(address factory);
    error InvalidAmount();
    error UnsafeLiquidityMinimums(uint256 amountAMin, uint256 requiredAMin, uint256 amountBMin, uint256 requiredBMin);
    error InvalidBoardroom(address boardroom);
    error MissingBoardroomShareToken(address tokenA, address tokenB, address shareToken);
    error UnauthorizedBoardroomPayer(address boardroom, address payer);
    error LockerAlreadyExists(address boardroom, address pool);
    error TooManyBoardroomLockers(address boardroom);
    error TransferAmountMismatch(address token, uint256 expected, uint256 actual);
    error UnauthorizedMigrationReservation(address boardroom, address caller);
    error MigrationSaltReserved(address boardroom, bytes32 salt);
    error MigrationLockerSaltUsed(address boardroom, bytes32 salt, address locker);
    error MigrationPairReserved(address boardroom, address tokenA, address tokenB);
    error MissingMigrationReservation(address boardroom, address distribution);

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
    event ClosedLockerPruned(address indexed boardroom, address indexed locker, address indexed pool);
    event MigrationReserved(
        address indexed boardroom, address indexed distribution, bytes32 indexed salt, address tokenA, address tokenB
    );
    event MigrationReservationReleased(address indexed boardroom, address indexed distribution, bytes32 indexed salt);

    constructor(address ammRouter_, address boardroomFactory_) {
        if (ammRouter_ == address(0)) revert InvalidAddress();
        if (boardroomFactory_ == address(0) || boardroomFactory_.code.length == 0) {
            revert InvalidBoardroomFactory(boardroomFactory_);
        }
        ammRouter = ammRouter_;
        boardroomFactory = boardroomFactory_;
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

    function reserveMigration(address boardroom, address distribution, address tokenA, address tokenB, bytes32 salt)
        external
        nonReentrant
    {
        _requireAuthorizedMigrationFactory(boardroom, distribution, tokenA, tokenB, salt);
        _pruneClosedLockers(boardroom);

        bytes32 pairKey = _pairKey(tokenA, tokenB);
        if (migrationReservationForSalt[boardroom][salt] != address(0)) {
            revert MigrationSaltReserved(boardroom, salt);
        }
        address predictedLocker =
            LibClone.predictDeterministicAddress(lockedLiquidityLogic, _cloneSalt(boardroom, salt), address(this));
        if (isLocker[predictedLocker] || predictedLocker.code.length != 0) {
            revert MigrationLockerSaltUsed(boardroom, salt, predictedLocker);
        }
        if (migrationReservationForPair[boardroom][pairKey] != address(0)) {
            revert MigrationPairReserved(boardroom, tokenA, tokenB);
        }

        address existingPool = ILockedLiquidityReservationRouter(ammRouter).poolFor(tokenA, tokenB);
        if (existingPool != address(0) && lockerForBoardroomPool[boardroom][existingPool] != address(0)) {
            revert LockerAlreadyExists(boardroom, existingPool);
        }
        if (lockersForBoardroom[boardroom].length + migrationReservationCount[boardroom] >= MAX_LOCKERS_PER_BOARDROOM) {
            revert TooManyBoardroomLockers(boardroom);
        }

        migrationReservationForSalt[boardroom][salt] = distribution;
        migrationReservationForPair[boardroom][pairKey] = distribution;
        migrationReservationCount[boardroom] += 1;

        address ammFactory = ILockedLiquidityReservationRouter(ammRouter).factory();
        ILockedLiquidityReservationAmmFactory(ammFactory)
            .reserveInitialLiquidity(tokenA, tokenB, predictedLocker, predictedLocker, distribution);
        emit MigrationReserved(boardroom, distribution, salt, tokenA, tokenB);
    }

    function releaseMigrationReservation(address boardroom, address tokenA, address tokenB, bytes32 salt)
        external
        nonReentrant
    {
        _requireIssuedDistribution(boardroom, msg.sender);
        _releaseMigrationReservation(boardroom, msg.sender, tokenA, tokenB, salt, true);
    }

    function canCall(address boardroom, address, address target, uint256 value, bytes calldata data)
        external
        view
        returns (bool)
    {
        if (value != 0) return false;

        bytes4 selector = _selector(data);
        if (target == address(this)) {
            return _canCreateLockedLiquidityCall(boardroom, selector, data);
        }

        return _canClaimLockerFees(boardroom, target, selector);
    }

    function obligationForCall(address, address target, uint256, bytes calldata data, bytes calldata result)
        external
        view
        returns (Obligation memory obligation)
    {
        if (!_isCreateLockedLiquidityCall(target, data)) return obligation;
        if (result.length != CREATE_LOCKED_LIQUIDITY_RESULT_LENGTH) return obligation;

        (address locker, address pool,,,) = abi.decode(result, (address, address, uint256, uint256, uint256));
        obligation.kind = ObligationKind.LockedLiquidity;
        obligation.account = locker;
        obligation.aux = pool;
    }

    function isLifecycleCallAllowed(address boardroom, address target, bytes4 selector) external view returns (bool) {
        return _canClaimLockerFees(boardroom, target, selector);
    }

    function grantSlotReleaseForLifecycleCall(address, address, bytes4) external pure returns (address distribution) {}

    function lockerCountForBoardroom(address boardroom) external view returns (uint256) {
        return lockersForBoardroom[boardroom].length;
    }

    function lockerForBoardroomAt(address boardroom, uint256 index) external view returns (address) {
        return lockersForBoardroom[boardroom][index];
    }

    function getLockersForBoardroom(address boardroom) external view returns (address[] memory) {
        return lockersForBoardroom[boardroom];
    }

    function pruneClosedLockers(address boardroom) external nonReentrant returns (uint256 pruned) {
        return _pruneClosedLockers(boardroom);
    }

    function predictLockedLiquidityAddress(address boardroom, bytes32 salt) external view returns (address) {
        return LibClone.predictDeterministicAddress(lockedLiquidityLogic, _cloneSalt(boardroom, salt), address(this));
    }

    function _createLockedLiquidity(address boardroom, address payer, CreateParams calldata params)
        internal
        returns (address locker, address pool, uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        _requireValidCreateRequest(boardroom, payer, params);

        address shareToken = _boardroomShareToken(boardroom);
        _requirePairContainsShareToken(params, shareToken);
        _pruneClosedLockers(boardroom);
        bool usesMigrationReservation = payer != boardroom;
        if (usesMigrationReservation) {
            _requireOwnedMigrationReservation(boardroom, payer, params.tokenA, params.tokenB, params.salt);
        } else {
            _requireUnreservedDirectCreation(boardroom, params.tokenA, params.tokenB, params.salt);
        }
        _requireLockerCapacity(boardroom, usesMigrationReservation);

        locker = _deployLocker(boardroom, params);
        _recordLockerBoardroom(locker, boardroom);
        _pullSeedTokens(locker, payer, params);
        (pool, amountA, amountB, liquidity) = _seedLockerLiquidity(locker, params);
        _recordLockerPool(boardroom, pool, locker);
        if (usesMigrationReservation) {
            _releaseMigrationReservation(boardroom, payer, params.tokenA, params.tokenB, params.salt, false);
        }

        _emitLockedLiquidityCreated(locker, boardroom, pool, params, amountA, amountB, liquidity);
    }

    function _emitLockedLiquidityCreated(
        address locker,
        address boardroom,
        address pool,
        CreateParams calldata params,
        uint256 amountA,
        uint256 amountB,
        uint256 liquidity
    ) internal {
        emit LockedLiquidityCreated(
            locker, boardroom, pool, params.tokenA, params.tokenB, amountA, amountB, liquidity, params.salt
        );
    }

    function _canCreateLockedLiquidityCall(address boardroom, bytes4 selector, bytes calldata data)
        internal
        view
        returns (bool)
    {
        return selector == LockedLiquidityFactory.createLockedLiquidity.selector
            && _canCreateLockedLiquidity(boardroom, data);
    }

    function _canClaimLockerFees(address boardroom, address target, bytes4 selector) internal view returns (bool) {
        return lockerBoardroom[target] == boardroom && selector == LockedLiquidity.claimFees.selector;
    }

    function _isCreateLockedLiquidityCall(address target, bytes calldata data) internal view returns (bool) {
        return target == address(this) && _selector(data) == LockedLiquidityFactory.createLockedLiquidity.selector;
    }

    function _canCreateLockedLiquidity(address boardroom, bytes calldata data) internal view returns (bool) {
        if (data.length != CREATE_LOCKED_LIQUIDITY_DATA_LENGTH) return false;

        CreateParams memory params = abi.decode(data[4:], (CreateParams));
        if (!_hasValidTokenPair(params.tokenA, params.tokenB)) return false;
        if (!_hasSeedAmounts(params.amountADesired, params.amountBDesired)) return false;
        if (!_hasMeaningfulSeedMinimums(params)) return false;

        address shareToken = _verifiedBoardroomShareToken(boardroom);
        if (shareToken == address(0)) return false;
        return _containsShareToken(params.tokenA, params.tokenB, shareToken);
    }

    function _requireValidCreateRequest(address boardroom, address payer, CreateParams calldata params) internal pure {
        if (boardroom == address(0) || payer == address(0)) revert InvalidAddress();
        if (!_hasValidTokenPair(params.tokenA, params.tokenB)) revert InvalidAddress();
        if (!_hasSeedAmounts(params.amountADesired, params.amountBDesired)) revert InvalidAmount();
        _requireMeaningfulSeedMinimums(params);
    }

    function _requirePairContainsShareToken(CreateParams calldata params, address shareToken) internal pure {
        if (!_containsShareToken(params.tokenA, params.tokenB, shareToken)) {
            revert MissingBoardroomShareToken(params.tokenA, params.tokenB, shareToken);
        }
    }

    function _requireLockerCapacity(address boardroom, bool usesMigrationReservation) internal view {
        uint256 used = lockersForBoardroom[boardroom].length + migrationReservationCount[boardroom];
        if (usesMigrationReservation ? used > MAX_LOCKERS_PER_BOARDROOM : used >= MAX_LOCKERS_PER_BOARDROOM) {
            revert TooManyBoardroomLockers(boardroom);
        }
    }

    function _requireAuthorizedMigrationFactory(
        address boardroom,
        address distribution,
        address tokenA,
        address tokenB,
        bytes32 salt
    ) internal view {
        if (boardroom.code.length == 0 || distribution.code.length == 0) {
            revert UnauthorizedMigrationReservation(boardroom, msg.sender);
        }
        if (!ILockedLiquidityFactoryBoardroomFactory(boardroomFactory).isBoardroom(boardroom)) {
            revert UnauthorizedMigrationReservation(boardroom, msg.sender);
        }

        address registry = ILockedLiquidityFactoryBoardroom(boardroom).policyRegistry();
        if (!ILockedLiquidityFactoryPolicyRegistry(registry).isModulePolicy(msg.sender)) {
            revert UnauthorizedMigrationReservation(boardroom, msg.sender);
        }
        if (
            ILockedLiquidityFactoryBoardroom(boardroom).shareToken() != tokenA
                || ILockedLiquidityFactoryShareToken(tokenA).boardroom() != boardroom
        ) {
            revert UnauthorizedMigrationReservation(boardroom, msg.sender);
        }

        ILockedLiquidityMigrationDistribution curve = ILockedLiquidityMigrationDistribution(distribution);
        if (
            curve.factory() != msg.sender || curve.boardroom() != boardroom || curve.shareToken() != tokenA
                || curve.quoteToken() != tokenB || curve.migrationSalt() != salt
        ) {
            revert UnauthorizedMigrationReservation(boardroom, msg.sender);
        }
    }

    function _requireOwnedMigrationReservation(
        address boardroom,
        address distribution,
        address tokenA,
        address tokenB,
        bytes32 salt
    ) internal view {
        if (
            migrationReservationForSalt[boardroom][salt] != distribution
                || migrationReservationForPair[boardroom][_pairKey(tokenA, tokenB)] != distribution
        ) {
            revert MissingMigrationReservation(boardroom, distribution);
        }
    }

    function _requireUnreservedDirectCreation(address boardroom, address tokenA, address tokenB, bytes32 salt)
        internal
        view
    {
        if (migrationReservationForSalt[boardroom][salt] != address(0)) {
            revert MigrationSaltReserved(boardroom, salt);
        }
        if (migrationReservationForPair[boardroom][_pairKey(tokenA, tokenB)] != address(0)) {
            revert MigrationPairReserved(boardroom, tokenA, tokenB);
        }
    }

    function _releaseMigrationReservation(
        address boardroom,
        address distribution,
        address tokenA,
        address tokenB,
        bytes32 salt,
        bool releaseAmmReservation
    ) internal {
        _requireOwnedMigrationReservation(boardroom, distribution, tokenA, tokenB, salt);
        if (releaseAmmReservation) {
            address ammFactory = ILockedLiquidityReservationRouter(ammRouter).factory();
            ILockedLiquidityReservationAmmFactory(ammFactory)
                .releaseInitialLiquidityReservation(tokenA, tokenB, distribution);
        }
        delete migrationReservationForSalt[boardroom][salt];
        delete migrationReservationForPair[boardroom][_pairKey(tokenA, tokenB)];
        migrationReservationCount[boardroom] -= 1;
        emit MigrationReservationReleased(boardroom, distribution, salt);
    }

    function _pruneClosedLockers(address boardroom) internal returns (uint256 pruned) {
        address[] storage lockers = lockersForBoardroom[boardroom];
        uint256 index;
        while (index < lockers.length) {
            address locker = lockers[index];
            LockedLiquidity position = LockedLiquidity(locker);
            if (position.lockedLiquidity() != 0) {
                ++index;
                continue;
            }

            address pool = position.pool();
            lockers[index] = lockers[lockers.length - 1];
            lockers.pop();
            ++pruned;
            emit ClosedLockerPruned(boardroom, locker, pool);
        }
    }

    function _deployLocker(address boardroom, CreateParams calldata params) internal returns (address locker) {
        locker = LibClone.cloneDeterministic(lockedLiquidityLogic, _cloneSalt(boardroom, params.salt));
        LockedLiquidity(locker).initialize(address(this), boardroom, ammRouter, params.tokenA, params.tokenB);
    }

    function _recordLockerBoardroom(address locker, address boardroom) internal {
        isLocker[locker] = true;
        lockerBoardroom[locker] = boardroom;
    }

    function _seedLockerLiquidity(address locker, CreateParams calldata params)
        internal
        returns (address pool, uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        return LockedLiquidity(locker)
            .seedLiquidity(
                params.amountADesired, params.amountBDesired, params.amountAMin, params.amountBMin, params.deadline
            );
    }

    function _recordLockerPool(address boardroom, address pool, address locker) internal {
        if (lockerForBoardroomPool[boardroom][pool] != address(0)) revert LockerAlreadyExists(boardroom, pool);

        lockerForBoardroomPool[boardroom][pool] = locker;
        lockersForBoardroom[boardroom].push(locker);
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

    function _hasValidTokenPair(address tokenA, address tokenB) internal pure returns (bool) {
        if (tokenA == address(0)) return false;
        if (tokenB == address(0)) return false;
        return tokenA != tokenB;
    }

    function _hasSeedAmounts(uint256 amountADesired, uint256 amountBDesired) internal pure returns (bool) {
        return amountADesired != 0 && amountBDesired != 0;
    }

    function _hasMeaningfulSeedMinimums(CreateParams memory params) internal pure returns (bool) {
        (uint256 requiredAMin, uint256 requiredBMin) = _requiredSeedMinimums(params);
        return params.amountAMin >= requiredAMin && params.amountBMin >= requiredBMin;
    }

    function _requireMeaningfulSeedMinimums(CreateParams calldata params) internal pure {
        (uint256 requiredAMin, uint256 requiredBMin) = _requiredSeedMinimums(params);
        if (params.amountAMin < requiredAMin || params.amountBMin < requiredBMin) {
            revert UnsafeLiquidityMinimums(params.amountAMin, requiredAMin, params.amountBMin, requiredBMin);
        }
    }

    function _requiredSeedMinimums(CreateParams memory params)
        internal
        pure
        returns (uint256 requiredAMin, uint256 requiredBMin)
    {
        uint256 retainedBps = BPS_DENOMINATOR - MAX_SEED_SLIPPAGE_BPS;
        requiredAMin = FixedPointMathLib.fullMulDivUp(params.amountADesired, retainedBps, BPS_DENOMINATOR);
        requiredBMin = FixedPointMathLib.fullMulDivUp(params.amountBDesired, retainedBps, BPS_DENOMINATOR);
    }

    function _containsShareToken(address tokenA, address tokenB, address shareToken) internal pure returns (bool) {
        return tokenA == shareToken || tokenB == shareToken;
    }

    function _pullSeedTokens(address locker, address payer, CreateParams calldata params) internal {
        _checkedTransferFrom(params.tokenA, payer, locker, params.amountADesired);
        _checkedTransferFrom(params.tokenB, payer, locker, params.amountBDesired);
    }

    function _checkedTransferFrom(address token, address from, address to, uint256 expectedAmount) internal {
        ExactTransferLib.ExactDelta memory delta = ExactTransferLib.pullBetween(token, from, to, expectedAmount);
        if (delta.senderBalanceIncreased) revert TransferAmountMismatch(token, expectedAmount, 0);
        if (delta.senderSpent != expectedAmount) {
            revert TransferAmountMismatch(token, expectedAmount, delta.senderSpent);
        }
        if (delta.recipientBalanceDecreased) revert TransferAmountMismatch(token, expectedAmount, 0);
        if (delta.recipientReceived != expectedAmount) {
            revert TransferAmountMismatch(token, expectedAmount, delta.recipientReceived);
        }
    }

    function _cloneSalt(address boardroom, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(boardroom, salt));
    }

    function _pairKey(address tokenA, address tokenB) internal pure returns (bytes32) {
        return tokenA < tokenB ? keccak256(abi.encode(tokenA, tokenB)) : keccak256(abi.encode(tokenB, tokenA));
    }

    function _selector(bytes calldata data) internal pure returns (bytes4 selector) {
        if (data.length < 4) return bytes4(0);
        return bytes4(data[:4]);
    }
}
