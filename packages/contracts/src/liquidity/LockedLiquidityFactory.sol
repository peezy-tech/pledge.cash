// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {LibClone} from "solady/utils/LibClone.sol";
import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {LockedLiquidity} from "./LockedLiquidity.sol";
import {BestEffortTokenLib} from "../lib/BestEffortTokenLib.sol";
import {ExactTransferLib} from "../lib/ExactTransferLib.sol";
import {IBoardroomObligationPolicy} from "../policy/IBoardroomObligationPolicy.sol";
import {BoardroomCallbackLib} from "../policy/BoardroomCallbackLib.sol";

interface ILockedLiquidityFactoryBoardroom {
    function shareToken() external view returns (address);

    function isIssuedDistribution(address distribution) external view returns (bool);

    function policyRegistry() external view returns (address);

    function lockedLiquidityExitAllowed() external view returns (bool);
}

interface ILockedLiquidityFactoryPolicyRegistry {
    function isModulePolicy(address policy) external view returns (bool);
}

interface ILockedLiquidityFactoryBoardroomFactory {
    function isBoardroom(address boardroom) external view returns (bool);

    function isShareToken(address token) external view returns (bool);
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

    function reservationExpiresAt() external view returns (uint64);
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

    function boardroomFactory() external view returns (address);
}

interface ILockedLiquiditySeedPool {
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
}

/// @notice Canonical singleton protocol-liquidity factory for each Boardroom.
contract LockedLiquidityFactory is IBoardroomObligationPolicy, ReentrancyGuard {
    uint256 internal constant CREATE_DATA_LENGTH = 4 + 32 * 8;
    uint256 internal constant CREATE_RESULT_LENGTH = 32 * 5;
    uint256 internal constant ADD_DATA_LENGTH = 4 + 32 * 7;
    uint256 internal constant REMOVE_DATA_LENGTH = 4 + 32 * 4;
    uint256 public constant MAX_SEED_SLIPPAGE_BPS = 500;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    enum PositionStatus {
        Unconfigured,
        Active,
        Closed
    }

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

    struct AddParams {
        address tokenA;
        address tokenB;
        uint256 amountADesired;
        uint256 amountBDesired;
        uint256 amountAMin;
        uint256 amountBMin;
        uint256 deadline;
    }

    struct RemoveParams {
        uint256 liquidity;
        uint256 amountAMin;
        uint256 amountBMin;
        uint256 deadline;
    }

    struct Position {
        address locker;
        address pool;
        address quoteAsset;
        PositionStatus status;
    }

    struct MigrationReservation {
        address curve;
        address expectedLocker;
        address expectedPool;
        address shareToken;
        address quoteAsset;
        bytes32 pairKey;
        bytes32 salt;
    }

    struct CreationResult {
        address locker;
        address pool;
        address quoteAsset;
        uint256 amountA;
        uint256 amountB;
        uint256 liquidity;
    }

    address public immutable ammRouter;
    address public immutable boardroomFactory;
    address public immutable lockedLiquidityLogic;

    mapping(address locker => bool canonical) public isLocker;
    mapping(address locker => address boardroom) public lockerBoardroom;
    mapping(address boardroom => Position position) public positionOfBoardroom;
    mapping(address boardroom => MigrationReservation reservation) public migrationReservationOf;

    error InvalidAddress();
    error InvalidBoardroomFactory(address factory);
    error IncoherentFactoryIdentity(address expected, address actual);
    error InvalidAmount();
    error InvalidBoardroom(address boardroom);
    error InvalidPair(address tokenA, address tokenB);
    error InvalidPosition(address boardroom);
    error PositionAlreadyConfigured(address boardroom);
    error InvalidMigrationReservation(address boardroom, address curve);
    error PoolAlreadySeeded(address pool);
    error UnsafeLiquidityMinimums(uint256 amountAMin, uint256 requiredAMin, uint256 amountBMin, uint256 requiredBMin);
    error UnexpectedTokenBalanceChange(address token, uint256 expected, uint256 actual);

    event ProtocolLiquidityCreated(
        address indexed locker,
        address indexed boardroom,
        address indexed pool,
        address quoteAsset,
        uint256 amountA,
        uint256 amountB,
        uint256 liquidity,
        bytes32 salt,
        address curve
    );
    event ProtocolLiquidityAdded(
        address indexed boardroom,
        address indexed locker,
        address indexed pool,
        uint256 amountA,
        uint256 amountB,
        uint256 liquidity
    );
    event ProtocolLiquidityRemoved(
        address indexed boardroom,
        address indexed locker,
        address indexed pool,
        uint256 liquidity,
        uint256 amountA,
        uint256 amountB
    );
    event ProtocolLiquidityPositionClosed(address indexed boardroom, address indexed locker, address indexed pool);
    event MigrationReserved(
        address indexed boardroom,
        address indexed curve,
        address indexed expectedLocker,
        address expectedPool,
        bytes32 salt
    );
    event MigrationReservationReleased(address indexed boardroom, address indexed curve, bytes32 indexed salt);

    constructor(address ammRouter_, address boardroomFactory_) {
        if (ammRouter_ == address(0) || ammRouter_.code.length == 0) revert InvalidAddress();
        if (boardroomFactory_ == address(0) || boardroomFactory_.code.length == 0) {
            revert InvalidBoardroomFactory(boardroomFactory_);
        }
        address ammFactory = ILockedLiquidityReservationRouter(ammRouter_).factory();
        if (ammFactory == address(0) || ammFactory.code.length == 0) revert InvalidAddress();
        address ammBoardroomFactory = ILockedLiquidityReservationAmmFactory(ammFactory).boardroomFactory();
        if (ammBoardroomFactory != boardroomFactory_) {
            revert IncoherentFactoryIdentity(boardroomFactory_, ammBoardroomFactory);
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
        return _createLockedLiquidity(msg.sender, msg.sender, address(0), params);
    }

    function createLockedLiquidityForBoardroom(address boardroom, CreateParams calldata params)
        external
        nonReentrant
        returns (address locker, address pool, uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        _requireIssuedDistribution(boardroom, msg.sender);
        return _createLockedLiquidity(boardroom, msg.sender, msg.sender, params);
    }

    function addLockedLiquidity(AddParams calldata params)
        external
        nonReentrant
        returns (uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        address boardroom = msg.sender;
        _requireCanonicalBoardroom(boardroom);
        Position storage position = positionOfBoardroom[boardroom];
        if (position.status != PositionStatus.Active) revert InvalidPosition(boardroom);
        if (
            params.tokenA != LockedLiquidity(position.locker).tokenA()
                || params.tokenB != LockedLiquidity(position.locker).tokenB()
        ) {
            revert InvalidPair(params.tokenA, params.tokenB);
        }
        _requireSeedAmountsAndMinimums(
            params.amountADesired, params.amountBDesired, params.amountAMin, params.amountBMin
        );
        return _addToLocker(boardroom, position.locker, position.pool, params);
    }

    function removeLockedLiquidity(RemoveParams calldata params)
        external
        nonReentrant
        returns (uint256 amountA, uint256 amountB)
    {
        address boardroom = msg.sender;
        _requireCanonicalBoardroom(boardroom);
        Position storage position = positionOfBoardroom[boardroom];
        if (position.status != PositionStatus.Active || params.liquidity == 0) revert InvalidPosition(boardroom);
        (amountA, amountB) = LockedLiquidity(position.locker)
            .removeLiquidityToBoardroom(params.liquidity, params.amountAMin, params.amountBMin, params.deadline);
        emit ProtocolLiquidityRemoved(boardroom, position.locker, position.pool, params.liquidity, amountA, amountB);
    }

    function closeLockedLiquidity() external nonReentrant {
        address boardroom = msg.sender;
        _requireCanonicalBoardroom(boardroom);
        Position storage position = positionOfBoardroom[boardroom];
        if (position.status != PositionStatus.Active || migrationReservationOf[boardroom].curve != address(0)) {
            revert InvalidPosition(boardroom);
        }
        LockedLiquidity(position.locker).close();
        position.status = PositionStatus.Closed;
        BoardroomCallbackLib.closeProtocolLiquidityFromFactory(boardroom, position.locker);
        emit ProtocolLiquidityPositionClosed(boardroom, position.locker, position.pool);
    }

    /// @notice Synchronizes the canonical singleton after the Boardroom performs a permissionless wind-down close.
    function finalizeWindDownClosure() external nonReentrant {
        address boardroom = msg.sender;
        _requireCanonicalBoardroom(boardroom);
        Position storage position = positionOfBoardroom[boardroom];
        if (
            position.status != PositionStatus.Active || migrationReservationOf[boardroom].curve != address(0)
                || !ILockedLiquidityFactoryBoardroom(boardroom).lockedLiquidityExitAllowed()
                || !LockedLiquidity(position.locker).isClosed()
        ) revert InvalidPosition(boardroom);

        position.status = PositionStatus.Closed;
        emit ProtocolLiquidityPositionClosed(boardroom, position.locker, position.pool);
    }

    function reserveMigration(address boardroom, address curve, address tokenA, address tokenB, bytes32 salt)
        external
        nonReentrant
    {
        _requireAuthorizedMigrationFactory(boardroom, curve, tokenA, tokenB, salt);
        if (
            positionOfBoardroom[boardroom].status != PositionStatus.Unconfigured
                || migrationReservationOf[boardroom].curve != address(0)
        ) revert PositionAlreadyConfigured(boardroom);

        address expectedLocker = predictLockedLiquidityAddress(boardroom, salt);
        if (expectedLocker.code.length != 0 || isLocker[expectedLocker]) revert PositionAlreadyConfigured(boardroom);
        bytes32 pairKey = _pairKey(tokenA, tokenB);
        address expectedPool = _reserveInitialLiquidity(tokenA, tokenB, expectedLocker, curve);
        migrationReservationOf[boardroom] = MigrationReservation({
            curve: curve,
            expectedLocker: expectedLocker,
            expectedPool: expectedPool,
            shareToken: tokenA,
            quoteAsset: tokenB,
            pairKey: pairKey,
            salt: salt
        });
        uint64 expiresAt = ILockedLiquidityMigrationDistribution(curve).reservationExpiresAt();
        BoardroomCallbackLib.precommitProtocolLiquidity(
            boardroom, expectedLocker, tokenB, curve, pairKey, salt, expiresAt
        );
        emit MigrationReserved(boardroom, curve, expectedLocker, expectedPool, salt);
    }

    function releaseMigrationReservation(address boardroom, address tokenA, address tokenB, bytes32 salt)
        external
        nonReentrant
    {
        _requireIssuedDistribution(boardroom, msg.sender);
        MigrationReservation memory reservation = migrationReservationOf[boardroom];
        if (
            reservation.curve != msg.sender || reservation.shareToken != tokenA || reservation.quoteAsset != tokenB
                || reservation.salt != salt
        ) revert InvalidMigrationReservation(boardroom, msg.sender);
        _releaseInitialLiquidity(tokenA, tokenB, msg.sender);
        delete migrationReservationOf[boardroom];
        BoardroomCallbackLib.releaseProtocolLiquidityReservation(boardroom, msg.sender, reservation.pairKey, salt);
        emit MigrationReservationReleased(boardroom, msg.sender, salt);
    }

    function canCall(address boardroom, address, address target, uint256 value, bytes calldata data)
        external
        view
        returns (bool)
    {
        if (value != 0 || !_isCanonicalBoardroom(boardroom)) return false;
        bytes4 selector = _selector(data);
        if (target == address(this)) {
            if (selector == LockedLiquidityFactory.createLockedLiquidity.selector && data.length == CREATE_DATA_LENGTH)
            {
                return _canCreate(boardroom, abi.decode(data[4:], (CreateParams)));
            }
            if (selector == LockedLiquidityFactory.addLockedLiquidity.selector && data.length == ADD_DATA_LENGTH) {
                return _canAdd(boardroom, abi.decode(data[4:], (AddParams)));
            }
            if (selector == LockedLiquidityFactory.removeLockedLiquidity.selector && data.length == REMOVE_DATA_LENGTH)
            {
                RemoveParams memory params = abi.decode(data[4:], (RemoveParams));
                return positionOfBoardroom[boardroom].status == PositionStatus.Active && params.liquidity != 0;
            }
            if (selector == LockedLiquidityFactory.closeLockedLiquidity.selector && data.length == 4) {
                Position memory position = positionOfBoardroom[boardroom];
                return position.status == PositionStatus.Active && migrationReservationOf[boardroom].curve == address(0)
                    && LockedLiquidity(position.locker).lockedLiquidity() == 0;
            }
            return false;
        }
        Position memory canonical = positionOfBoardroom[boardroom];
        return target == canonical.locker && canonical.status == PositionStatus.Active
            && selector == LockedLiquidity.claimFees.selector;
    }

    function obligationForCall(address, address target, uint256, bytes calldata data, bytes calldata result)
        external
        view
        returns (Obligation memory obligation)
    {
        if (
            target != address(this) || _selector(data) != LockedLiquidityFactory.createLockedLiquidity.selector
                || result.length != CREATE_RESULT_LENGTH
        ) return obligation;
        (address locker, address pool,,,) = abi.decode(result, (address, address, uint256, uint256, uint256));
        obligation.kind = ObligationKind.LockedLiquidity;
        obligation.account = locker;
        obligation.aux = pool;
    }

    function isLifecycleCallAllowed(address boardroom, address target, bytes4 selector) external view returns (bool) {
        Position memory position = positionOfBoardroom[boardroom];
        return position.status == PositionStatus.Active && target == position.locker
            && selector == LockedLiquidity.claimFees.selector;
    }

    function predictLockedLiquidityAddress(address boardroom, bytes32 salt) public view returns (address) {
        return LibClone.predictDeterministicAddress(lockedLiquidityLogic, _cloneSalt(boardroom, salt), address(this));
    }

    function _createLockedLiquidity(address boardroom, address payer, address curve, CreateParams calldata params)
        internal
        returns (address locker, address pool, uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        _requireCanonicalBoardroom(boardroom);
        _requireValidPair(boardroom, params.tokenA, params.tokenB);
        _requireSeedAmountsAndMinimums(
            params.amountADesired, params.amountBDesired, params.amountAMin, params.amountBMin
        );
        if (positionOfBoardroom[boardroom].status != PositionStatus.Unconfigured) {
            revert PositionAlreadyConfigured(boardroom);
        }

        address quoteAsset = _quoteAsset(boardroom, params.tokenA, params.tokenB);
        bytes32 pairKey = _pairKey(params.tokenA, params.tokenB);
        address expectedPool;
        if (curve == address(0)) {
            if (migrationReservationOf[boardroom].curve != address(0)) revert PositionAlreadyConfigured(boardroom);
            locker = predictLockedLiquidityAddress(boardroom, params.salt);
            BoardroomCallbackLib.precommitProtocolLiquidity(
                boardroom, locker, quoteAsset, address(0), pairKey, params.salt, 0
            );
            expectedPool = _reserveInitialLiquidity(params.tokenA, params.tokenB, locker, boardroom);
        } else {
            MigrationReservation memory reservation = migrationReservationOf[boardroom];
            if (
                reservation.curve != curve || reservation.expectedLocker == address(0)
                    || reservation.shareToken != params.tokenA || reservation.quoteAsset != params.tokenB
                    || reservation.pairKey != pairKey || reservation.salt != params.salt
            ) revert InvalidMigrationReservation(boardroom, curve);
            locker = reservation.expectedLocker;
            expectedPool = reservation.expectedPool;
        }
        _requireUnseededPool(expectedPool, params.tokenA, params.tokenB);
        if (locker.code.length != 0 || isLocker[locker]) revert PositionAlreadyConfigured(boardroom);

        locker = LibClone.cloneDeterministic(lockedLiquidityLogic, _cloneSalt(boardroom, params.salt));
        LockedLiquidity(locker).initialize(address(this), boardroom, ammRouter, params.tokenA, params.tokenB);
        isLocker[locker] = true;
        lockerBoardroom[locker] = boardroom;
        _pullSeedTokens(locker, payer, params.tokenA, params.tokenB, params.amountADesired, params.amountBDesired);
        (pool, amountA, amountB, liquidity) = LockedLiquidity(locker)
            .addLiquidity(
                params.amountADesired, params.amountBDesired, params.amountAMin, params.amountBMin, params.deadline
            );
        if (pool != expectedPool) revert InvalidPosition(boardroom);

        positionOfBoardroom[boardroom] =
            Position({locker: locker, pool: pool, quoteAsset: quoteAsset, status: PositionStatus.Active});
        if (curve != address(0)) delete migrationReservationOf[boardroom];
        BoardroomCallbackLib.activateProtocolLiquidity(boardroom, locker, pool, quoteAsset, curve, pairKey, params.salt);
        CreationResult memory created = CreationResult({
            locker: locker, pool: pool, quoteAsset: quoteAsset, amountA: amountA, amountB: amountB, liquidity: liquidity
        });
        _emitProtocolLiquidityCreated(boardroom, curve, params.salt, created);
    }

    function _emitProtocolLiquidityCreated(
        address boardroom,
        address curve,
        bytes32 salt,
        CreationResult memory created
    ) internal {
        emit ProtocolLiquidityCreated(
            created.locker,
            boardroom,
            created.pool,
            created.quoteAsset,
            created.amountA,
            created.amountB,
            created.liquidity,
            salt,
            curve
        );
    }

    function _addToLocker(address boardroom, address locker, address expectedPool, AddParams calldata params)
        internal
        returns (uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        _pullSeedTokens(locker, boardroom, params.tokenA, params.tokenB, params.amountADesired, params.amountBDesired);
        address pool;
        (pool, amountA, amountB, liquidity) = LockedLiquidity(locker)
            .addLiquidity(
                params.amountADesired, params.amountBDesired, params.amountAMin, params.amountBMin, params.deadline
            );
        if (pool != expectedPool) revert InvalidPosition(boardroom);
        emit ProtocolLiquidityAdded(boardroom, locker, pool, amountA, amountB, liquidity);
    }

    function _canCreate(address boardroom, CreateParams memory params) internal view returns (bool) {
        if (positionOfBoardroom[boardroom].status != PositionStatus.Unconfigured) return false;
        if (migrationReservationOf[boardroom].curve != address(0)) return false;
        return _validPair(boardroom, params.tokenA, params.tokenB)
            && _validSeedAmountsAndMinimums(
            params.amountADesired, params.amountBDesired, params.amountAMin, params.amountBMin
        );
    }

    function _canAdd(address boardroom, AddParams memory params) internal view returns (bool) {
        Position memory position = positionOfBoardroom[boardroom];
        if (position.status != PositionStatus.Active) return false;
        LockedLiquidity locker = LockedLiquidity(position.locker);
        return params.tokenA == locker.tokenA() && params.tokenB == locker.tokenB()
            && _validSeedAmountsAndMinimums(
            params.amountADesired, params.amountBDesired, params.amountAMin, params.amountBMin
        );
    }

    function _requireAuthorizedMigrationFactory(
        address boardroom,
        address curve,
        address tokenA,
        address tokenB,
        bytes32 salt
    ) internal view {
        _requireCanonicalBoardroom(boardroom);
        address registry = ILockedLiquidityFactoryBoardroom(boardroom).policyRegistry();
        if (!ILockedLiquidityFactoryPolicyRegistry(registry).isModulePolicy(msg.sender)) {
            revert InvalidMigrationReservation(boardroom, curve);
        }
        if (!_validPair(boardroom, tokenA, tokenB) || tokenA != _boardroomShareToken(boardroom)) {
            revert InvalidMigrationReservation(boardroom, curve);
        }
        ILockedLiquidityMigrationDistribution distribution = ILockedLiquidityMigrationDistribution(curve);
        if (
            distribution.factory() != msg.sender || distribution.boardroom() != boardroom
                || distribution.shareToken() != tokenA || distribution.quoteToken() != tokenB
                || distribution.migrationSalt() != salt
        ) revert InvalidMigrationReservation(boardroom, curve);
    }

    function _requireIssuedDistribution(address boardroom, address curve) internal view {
        _requireCanonicalBoardroom(boardroom);
        if (!ILockedLiquidityFactoryBoardroom(boardroom).isIssuedDistribution(curve)) {
            revert InvalidMigrationReservation(boardroom, curve);
        }
    }

    function _requireCanonicalBoardroom(address boardroom) internal view {
        if (!_isCanonicalBoardroom(boardroom)) revert InvalidBoardroom(boardroom);
    }

    function _isCanonicalBoardroom(address boardroom) internal view returns (bool) {
        return
            boardroom.code.length != 0
                && ILockedLiquidityFactoryBoardroomFactory(boardroomFactory).isBoardroom(boardroom);
    }

    function _requireValidPair(address boardroom, address tokenA, address tokenB) internal view {
        if (!_validPair(boardroom, tokenA, tokenB)) revert InvalidPair(tokenA, tokenB);
    }

    function _validPair(address boardroom, address tokenA, address tokenB) internal view returns (bool) {
        if (tokenA == address(0) || tokenB == address(0) || tokenA == tokenB) return false;
        address shareToken = _boardroomShareToken(boardroom);
        if (tokenA != shareToken && tokenB != shareToken) return false;
        address quoteAsset = tokenA == shareToken ? tokenB : tokenA;
        return !ILockedLiquidityFactoryBoardroomFactory(boardroomFactory).isShareToken(quoteAsset);
    }

    function _quoteAsset(address boardroom, address tokenA, address tokenB) internal view returns (address) {
        address shareToken = _boardroomShareToken(boardroom);
        return tokenA == shareToken ? tokenB : tokenA;
    }

    function _boardroomShareToken(address boardroom) internal view returns (address shareToken) {
        shareToken = ILockedLiquidityFactoryBoardroom(boardroom).shareToken();
        if (shareToken == address(0) || ILockedLiquidityFactoryShareToken(shareToken).boardroom() != boardroom) {
            revert InvalidBoardroom(boardroom);
        }
    }

    function _reserveInitialLiquidity(address tokenA, address tokenB, address expectedLocker, address reservationOwner)
        internal
        returns (address pool)
    {
        address ammFactory = ILockedLiquidityReservationRouter(ammRouter).factory();
        pool = ILockedLiquidityReservationAmmFactory(ammFactory)
            .reserveInitialLiquidity(tokenA, tokenB, expectedLocker, expectedLocker, reservationOwner);
        _requireUnseededPool(pool, tokenA, tokenB);
    }

    function _releaseInitialLiquidity(address tokenA, address tokenB, address reservationOwner) internal {
        address ammFactory = ILockedLiquidityReservationRouter(ammRouter).factory();
        ILockedLiquidityReservationAmmFactory(ammFactory)
            .releaseInitialLiquidityReservation(tokenA, tokenB, reservationOwner);
    }

    function _requireUnseededPool(address pool, address tokenA, address tokenB) internal view {
        (uint112 reserve0, uint112 reserve1,) = ILockedLiquiditySeedPool(pool).getReserves();
        (bool tokenAReadable, uint256 tokenABalance) = BestEffortTokenLib.tryBalanceOf(tokenA, pool);
        (bool tokenBReadable, uint256 tokenBBalance) = BestEffortTokenLib.tryBalanceOf(tokenB, pool);
        if (
            reserve0 != 0 || reserve1 != 0 || !tokenAReadable || !tokenBReadable || tokenABalance != 0
                || tokenBBalance != 0
        ) revert PoolAlreadySeeded(pool);
    }

    function _pullSeedTokens(
        address locker,
        address payer,
        address tokenA,
        address tokenB,
        uint256 amountA,
        uint256 amountB
    ) internal {
        _checkedTransferFrom(tokenA, payer, locker, amountA);
        _checkedTransferFrom(tokenB, payer, locker, amountB);
    }

    function _checkedTransferFrom(address token, address payer, address recipient, uint256 expectedAmount) internal {
        ExactTransferLib.ExactDelta memory delta = ExactTransferLib.pullBetween(token, payer, recipient, expectedAmount);
        if (
            delta.senderBalanceIncreased || delta.recipientBalanceDecreased || delta.senderSpent != expectedAmount
                || delta.recipientReceived != expectedAmount
        ) revert UnexpectedTokenBalanceChange(token, expectedAmount, delta.recipientReceived);
    }

    function _requireSeedAmountsAndMinimums(
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin
    ) internal pure {
        if (amountADesired == 0 || amountBDesired == 0) revert InvalidAmount();
        (uint256 requiredA, uint256 requiredB) = _requiredMinimums(amountADesired, amountBDesired);
        if (amountAMin < requiredA || amountBMin < requiredB) {
            revert UnsafeLiquidityMinimums(amountAMin, requiredA, amountBMin, requiredB);
        }
    }

    function _validSeedAmountsAndMinimums(
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin
    ) internal pure returns (bool) {
        if (amountADesired == 0 || amountBDesired == 0) return false;
        (uint256 requiredA, uint256 requiredB) = _requiredMinimums(amountADesired, amountBDesired);
        return amountAMin >= requiredA && amountBMin >= requiredB;
    }

    function _requiredMinimums(uint256 amountA, uint256 amountB)
        internal
        pure
        returns (uint256 requiredA, uint256 requiredB)
    {
        uint256 retainedBps = BPS_DENOMINATOR - MAX_SEED_SLIPPAGE_BPS;
        requiredA = FixedPointMathLib.fullMulDivUp(amountA, retainedBps, BPS_DENOMINATOR);
        requiredB = FixedPointMathLib.fullMulDivUp(amountB, retainedBps, BPS_DENOMINATOR);
    }

    function _pairKey(address tokenA, address tokenB) internal pure returns (bytes32) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encode(token0, token1));
    }

    function _cloneSalt(address boardroom, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encode(boardroom, salt));
    }

    function _selector(bytes calldata data) internal pure returns (bytes4 selector) {
        if (data.length < 4) return bytes4(0);
        return bytes4(data[:4]);
    }
}
