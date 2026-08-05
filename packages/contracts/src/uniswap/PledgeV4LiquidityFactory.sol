// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.30;

import {LibClone} from "solady/utils/LibClone.sol";
import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {ExactTransferLib} from "../lib/ExactTransferLib.sol";
import {BoardroomCallbackLib} from "../policy/BoardroomCallbackLib.sol";
import {IBoardroomObligationPolicy} from "../policy/IBoardroomObligationPolicy.sol";
import {PledgeV4Hook} from "./PledgeV4Hook.sol";
import {PledgeV4LiquidityVault} from "./PledgeV4LiquidityVault.sol";

interface IPledgeV4LiquidityFactoryBoardroom {
    function shareToken() external view returns (address);

    function lockedLiquidityExitAllowed() external view returns (bool);
}

interface IPledgeV4LiquidityFactoryBoardroomFactory {
    function isBoardroom(address boardroom) external view returns (bool);

    function isShareToken(address token) external view returns (bool);
}

interface IPledgeV4LiquidityFactoryShareToken {
    function boardroom() external view returns (address);
}

/// @notice Canonical pledge.cash policy for Boardroom-owned Uniswap v4 liquidity.
/// @dev The factory authenticates the one canonical pool initialization and one full-range vault per Boardroom.
/// It does not mediate swaps or permissionless third-party v4 liquidity.
contract PledgeV4LiquidityFactory is IBoardroomObligationPolicy, ReentrancyGuard {
    using FixedPointMathLib for uint256;

    uint256 internal constant CREATE_DATA_LENGTH = 4 + 32 * 9;
    uint256 internal constant CREATE_RESULT_LENGTH = 32 * 5;
    uint256 internal constant ADD_DATA_LENGTH = 4 + 32 * 7;
    uint256 internal constant REMOVE_DATA_LENGTH = 4 + 32 * 4;
    uint160 internal constant ALL_HOOK_FLAGS = (1 << 14) - 1;

    uint24 public constant POOL_FEE = 3_000;
    int24 public constant TICK_SPACING = 60;
    uint160 public constant REQUIRED_HOOK_FLAGS = 1 << 13;
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
        uint160 sqrtPriceX96;
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
        address vault;
        bytes32 poolId;
        address quoteAsset;
        PositionStatus status;
    }

    struct CreationContext {
        address boardroom;
        address payer;
    }

    struct CreationResult {
        address vault;
        bytes32 poolId;
        address quoteAsset;
        uint256 amountA;
        uint256 amountB;
        uint256 liquidity;
    }

    IPoolManager public immutable poolManager;
    address public immutable boardroomFactory;
    address public immutable protocolFeeRecipient;
    address public immutable hookAuthority;
    address public immutable vaultImplementation;

    PledgeV4Hook public hook;
    bytes32 public hookSalt;
    bytes32 public initializingPoolId;

    mapping(address vault => bool canonical) public isVault;
    mapping(address vault => address boardroom) public vaultBoardroom;
    mapping(bytes32 poolId => address vault) public vaultForPoolId;
    mapping(address boardroom => Position position) public positionOfBoardroom;

    error InvalidAddress();
    error InvalidBoardroomFactory(address factory);
    error InvalidAmount();
    error InvalidBoardroom(address boardroom);
    error InvalidPair(address tokenA, address tokenB);
    error InvalidPosition(address boardroom);
    error PositionAlreadyConfigured(address boardroom);
    error PoolAlreadyInitialized(bytes32 poolId);
    error HookNotDeployed();
    error HookAlreadyDeployed(address hook);
    error OnlyHookAuthority(address caller);
    error InvalidHookFlags(address predicted, uint160 actualFlags);
    error UnsafeLiquidityMinimums(uint256 amountAMin, uint256 requiredAMin, uint256 amountBMin, uint256 requiredBMin);
    error UnexpectedTokenBalanceChange(address token, uint256 expected, uint256 actual);

    event PledgeV4HookDeployed(address indexed hook, bytes32 indexed salt, bytes32 initCodeHash);
    event ProtocolLiquidityCreated(
        address indexed vault,
        address indexed boardroom,
        bytes32 indexed poolId,
        address quoteAsset,
        uint256 amountA,
        uint256 amountB,
        uint256 liquidity,
        uint160 sqrtPriceX96,
        bytes32 salt
    );
    event ProtocolLiquidityAdded(
        address indexed boardroom,
        address indexed vault,
        bytes32 indexed poolId,
        uint256 amountA,
        uint256 amountB,
        uint256 liquidity
    );
    event ProtocolLiquidityRemoved(
        address indexed boardroom,
        address indexed vault,
        bytes32 indexed poolId,
        uint256 liquidity,
        uint256 amountA,
        uint256 amountB
    );
    event ProtocolLiquidityPositionClosed(address indexed boardroom, address indexed vault, bytes32 indexed poolId);

    constructor(
        IPoolManager poolManager_,
        address boardroomFactory_,
        address protocolFeeRecipient_,
        address hookAuthority_
    ) {
        if (address(poolManager_) == address(0) || address(poolManager_).code.length == 0) revert InvalidAddress();
        if (boardroomFactory_ == address(0) || boardroomFactory_.code.length == 0) {
            revert InvalidBoardroomFactory(boardroomFactory_);
        }
        if (
            protocolFeeRecipient_ == address(0) || protocolFeeRecipient_.code.length == 0
                || hookAuthority_ == address(0)
        ) revert InvalidAddress();
        poolManager = poolManager_;
        boardroomFactory = boardroomFactory_;
        protocolFeeRecipient = protocolFeeRecipient_;
        hookAuthority = hookAuthority_;
        vaultImplementation = address(new PledgeV4LiquidityVault());
    }

    function deployHook(bytes32 salt) external returns (address deployed) {
        if (msg.sender != hookAuthority) revert OnlyHookAuthority(msg.sender);
        if (address(hook) != address(0)) revert HookAlreadyDeployed(address(hook));
        address predicted = predictHookAddress(salt);
        uint160 actualFlags = uint160(predicted) & ALL_HOOK_FLAGS;
        if (actualFlags != REQUIRED_HOOK_FLAGS) revert InvalidHookFlags(predicted, actualFlags);
        PledgeV4Hook created = new PledgeV4Hook{salt: salt}(poolManager, address(this));
        if (address(created) != predicted) revert InvalidAddress();
        hook = created;
        hookSalt = salt;
        emit PledgeV4HookDeployed(predicted, salt, hookInitCodeHash());
        return predicted;
    }

    function hookInitCodeHash() public view returns (bytes32) {
        return keccak256(abi.encodePacked(type(PledgeV4Hook).creationCode, abi.encode(poolManager, address(this))));
    }

    function predictHookAddress(bytes32 salt) public view returns (address predicted) {
        bytes32 digest = keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, hookInitCodeHash()));
        predicted = address(uint160(uint256(digest)));
    }

    function poolKeyFor(address tokenA, address tokenB) public view returns (PoolKey memory key) {
        PledgeV4Hook hook_ = hook;
        if (address(hook_) == address(0)) revert HookNotDeployed();
        if (tokenA == address(0) || tokenB == address(0) || tokenA == tokenB) revert InvalidPair(tokenA, tokenB);
        (address currency0, address currency1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        key = PoolKey({
            currency0: Currency.wrap(currency0),
            currency1: Currency.wrap(currency1),
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook_))
        });
    }

    function poolIdFor(address tokenA, address tokenB) public view returns (bytes32) {
        return PoolId.unwrap(poolKeyFor(tokenA, tokenB).toId());
    }

    function isPoolInitializationAuthorized(address sender, PoolKey calldata key) external view returns (bool) {
        bytes32 pending = initializingPoolId;
        return pending != bytes32(0) && sender == address(this) && address(key.hooks) == address(hook)
            && PoolId.unwrap(key.toId()) == pending;
    }

    function createProtocolLiquidity(CreateParams calldata params)
        external
        nonReentrant
        returns (address vault, bytes32 poolId, uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        _requireCanonicalBoardroom(msg.sender);
        return _createProtocolLiquidity(CreationContext({boardroom: msg.sender, payer: msg.sender}), params);
    }

    function addProtocolLiquidity(AddParams calldata params)
        external
        nonReentrant
        returns (uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        address boardroom = msg.sender;
        _requireCanonicalBoardroom(boardroom);
        Position storage position = positionOfBoardroom[boardroom];
        if (position.status != PositionStatus.Active) revert InvalidPosition(boardroom);
        PledgeV4LiquidityVault vault = PledgeV4LiquidityVault(position.vault);
        if (params.tokenA != vault.tokenA() || params.tokenB != vault.tokenB()) {
            revert InvalidPair(params.tokenA, params.tokenB);
        }
        _requireSeedAmountsAndMinimums(
            params.amountADesired, params.amountBDesired, params.amountAMin, params.amountBMin
        );
        _pullSeedTokens(
            position.vault, boardroom, params.tokenA, params.tokenB, params.amountADesired, params.amountBDesired
        );
        (amountA, amountB, liquidity) = vault.addLiquidity(
            params.amountADesired, params.amountBDesired, params.amountAMin, params.amountBMin, params.deadline
        );
        emit ProtocolLiquidityAdded(boardroom, position.vault, position.poolId, amountA, amountB, liquidity);
    }

    function removeProtocolLiquidity(RemoveParams calldata params)
        external
        nonReentrant
        returns (uint256 amountA, uint256 amountB)
    {
        address boardroom = msg.sender;
        _requireCanonicalBoardroom(boardroom);
        Position storage position = positionOfBoardroom[boardroom];
        if (position.status != PositionStatus.Active || params.liquidity == 0 || params.liquidity > type(uint128).max) {
            revert InvalidPosition(boardroom);
        }
        (amountA, amountB) = PledgeV4LiquidityVault(position.vault)
            .removeLiquidityToBoardroom(
                uint128(params.liquidity), params.amountAMin, params.amountBMin, params.deadline
            );
        emit ProtocolLiquidityRemoved(boardroom, position.vault, position.poolId, params.liquidity, amountA, amountB);
    }

    function closeProtocolLiquidity() external nonReentrant {
        address boardroom = msg.sender;
        _requireCanonicalBoardroom(boardroom);
        Position storage position = positionOfBoardroom[boardroom];
        if (position.status != PositionStatus.Active) revert InvalidPosition(boardroom);
        PledgeV4LiquidityVault(position.vault).close();
        position.status = PositionStatus.Closed;
        BoardroomCallbackLib.closeProtocolLiquidityFromFactory(
            boardroom, BoardroomCallbackLib.boundFacetSetHash(boardroom), position.vault
        );
        emit ProtocolLiquidityPositionClosed(boardroom, position.vault, position.poolId);
    }

    /// @notice Synchronizes factory state after a permissionless Boardroom wind-down exit or claim release.
    function finalizeWindDownClosure() external nonReentrant {
        address boardroom = msg.sender;
        _requireCanonicalBoardroom(boardroom);
        Position storage position = positionOfBoardroom[boardroom];
        if (
            position.status != PositionStatus.Active
                || !IPledgeV4LiquidityFactoryBoardroom(boardroom).lockedLiquidityExitAllowed()
                || !PledgeV4LiquidityVault(position.vault).isClosed()
        ) revert InvalidPosition(boardroom);
        position.status = PositionStatus.Closed;
        emit ProtocolLiquidityPositionClosed(boardroom, position.vault, position.poolId);
    }

    function canCall(address boardroom, address, address target, uint256 value, bytes calldata data)
        external
        view
        returns (bool)
    {
        if (value != 0 || !_isCanonicalBoardroom(boardroom)) return false;
        bytes4 selector = _selector(data);
        if (target == address(this)) {
            if (
                selector == PledgeV4LiquidityFactory.createProtocolLiquidity.selector
                    && data.length == CREATE_DATA_LENGTH
            ) return _canCreate(boardroom, abi.decode(data[4:], (CreateParams)));
            if (selector == PledgeV4LiquidityFactory.addProtocolLiquidity.selector && data.length == ADD_DATA_LENGTH) {
                return _canAdd(boardroom, abi.decode(data[4:], (AddParams)));
            }
            if (
                selector == PledgeV4LiquidityFactory.removeProtocolLiquidity.selector
                    && data.length == REMOVE_DATA_LENGTH
            ) {
                RemoveParams memory params = abi.decode(data[4:], (RemoveParams));
                return positionOfBoardroom[boardroom].status == PositionStatus.Active && params.liquidity != 0
                    && params.liquidity <= type(uint128).max;
            }
            if (selector == PledgeV4LiquidityFactory.closeProtocolLiquidity.selector && data.length == 4) {
                Position memory position = positionOfBoardroom[boardroom];
                return position.status == PositionStatus.Active
                    && PledgeV4LiquidityVault(position.vault).lockedLiquidity() == 0;
            }
            return false;
        }
        Position memory canonical = positionOfBoardroom[boardroom];
        return target == canonical.vault && canonical.status == PositionStatus.Active
            && selector == PledgeV4LiquidityVault.claimFees.selector;
    }

    function obligationForCall(address, address target, uint256, bytes calldata data, bytes calldata result)
        external
        view
        returns (Obligation memory obligation)
    {
        if (
            target != address(this) || _selector(data) != PledgeV4LiquidityFactory.createProtocolLiquidity.selector
                || result.length != CREATE_RESULT_LENGTH
        ) return obligation;
        (address vault, bytes32 poolId,,,) = abi.decode(result, (address, bytes32, uint256, uint256, uint256));
        if (!isVault[vault] || poolId == bytes32(0) || PledgeV4LiquidityVault(vault).poolId() != poolId) {
            return obligation;
        }
        obligation.kind = ObligationKind.Liquidity;
        obligation.account = vault;
    }

    function isLifecycleCallAllowed(address boardroom, address target, bytes4 selector) external view returns (bool) {
        Position memory position = positionOfBoardroom[boardroom];
        return position.status == PositionStatus.Active && target == position.vault
            && selector == PledgeV4LiquidityVault.claimFees.selector;
    }

    function predictLiquidityVaultAddress(address boardroom, bytes32 salt) public view returns (address) {
        return LibClone.predictDeterministicAddress(vaultImplementation, _cloneSalt(boardroom, salt), address(this));
    }

    function _createProtocolLiquidity(CreationContext memory context, CreateParams calldata params)
        internal
        returns (address vault, bytes32 poolId, uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        _requireCanonicalBoardroom(context.boardroom);
        _requireValidPair(context.boardroom, params.tokenA, params.tokenB);
        _requireSeedAmountsAndMinimums(
            params.amountADesired, params.amountBDesired, params.amountAMin, params.amountBMin
        );
        _requireValidSqrtPrice(params.sqrtPriceX96);
        if (positionOfBoardroom[context.boardroom].status != PositionStatus.Unconfigured) {
            revert PositionAlreadyConfigured(context.boardroom);
        }

        address quoteAsset = _quoteAsset(context.boardroom, params.tokenA, params.tokenB);
        PoolKey memory key = poolKeyFor(params.tokenA, params.tokenB);
        poolId = PoolId.unwrap(key.toId());
        vault = predictLiquidityVaultAddress(context.boardroom, params.salt);
        _requireUninitializedPool(poolId);
        if (vault.code.length != 0 || isVault[vault] || vaultForPoolId[poolId] != address(0)) {
            revert PositionAlreadyConfigured(context.boardroom);
        }

        _initializePool(key, poolId, params.sqrtPriceX96);
        vault = _deployVault(context.boardroom, poolId, params.tokenA, params.tokenB, params.salt);
        isVault[vault] = true;
        vaultBoardroom[vault] = context.boardroom;
        vaultForPoolId[poolId] = vault;
        _pullSeedTokens(
            vault, context.payer, params.tokenA, params.tokenB, params.amountADesired, params.amountBDesired
        );
        (amountA, amountB, liquidity) = PledgeV4LiquidityVault(vault)
            .addLiquidity(
                params.amountADesired, params.amountBDesired, params.amountAMin, params.amountBMin, params.deadline
            );

        positionOfBoardroom[context.boardroom] =
            Position({vault: vault, poolId: poolId, quoteAsset: quoteAsset, status: PositionStatus.Active});
        CreationResult memory created = CreationResult({
            vault: vault,
            poolId: poolId,
            quoteAsset: quoteAsset,
            amountA: amountA,
            amountB: amountB,
            liquidity: liquidity
        });
        _activateProtocolLiquidity(context, params.sqrtPriceX96, params.salt, created);
    }

    function _deployVault(address boardroom, bytes32 poolId, address tokenA, address tokenB, bytes32 salt)
        internal
        returns (address vault)
    {
        vault = LibClone.cloneDeterministic(vaultImplementation, _cloneSalt(boardroom, salt));
        PledgeV4LiquidityVault(vault)
            .initialize(
                address(this),
                boardroom,
                poolManager,
                protocolFeeRecipient,
                tokenA,
                tokenB,
                POOL_FEE,
                TICK_SPACING,
                IHooks(address(hook)),
                salt
            );
        if (PledgeV4LiquidityVault(vault).poolId() != poolId) revert InvalidPosition(boardroom);
    }

    function _activateProtocolLiquidity(
        CreationContext memory context,
        uint160 sqrtPriceX96,
        bytes32 salt,
        CreationResult memory created
    ) internal {
        BoardroomCallbackLib.activateProtocolLiquidity(
            context.boardroom,
            BoardroomCallbackLib.boundFacetSetHash(context.boardroom),
            created.vault,
            created.poolId,
            created.quoteAsset
        );
        emit ProtocolLiquidityCreated(
            created.vault,
            context.boardroom,
            created.poolId,
            created.quoteAsset,
            created.amountA,
            created.amountB,
            created.liquidity,
            sqrtPriceX96,
            salt
        );
    }

    function _initializePool(PoolKey memory key, bytes32 poolId, uint160 sqrtPriceX96) internal {
        if (initializingPoolId != bytes32(0)) revert PoolAlreadyInitialized(initializingPoolId);
        initializingPoolId = poolId;
        poolManager.initialize(key, sqrtPriceX96);
        initializingPoolId = bytes32(0);
    }

    function _canCreate(address boardroom, CreateParams memory params) internal view returns (bool) {
        if (address(hook) == address(0) || positionOfBoardroom[boardroom].status != PositionStatus.Unconfigured) {
            return false;
        }
        if (
            !_validPair(boardroom, params.tokenA, params.tokenB)
                || !_validSeedAmountsAndMinimums(
                    params.amountADesired, params.amountBDesired, params.amountAMin, params.amountBMin
                ) || !_validSqrtPrice(params.sqrtPriceX96)
        ) return false;
        return !_isPoolInitialized(PoolId.unwrap(poolKeyFor(params.tokenA, params.tokenB).toId()));
    }

    function _canAdd(address boardroom, AddParams memory params) internal view returns (bool) {
        Position memory position = positionOfBoardroom[boardroom];
        if (position.status != PositionStatus.Active) return false;
        PledgeV4LiquidityVault vault = PledgeV4LiquidityVault(position.vault);
        return params.tokenA == vault.tokenA() && params.tokenB == vault.tokenB()
            && _validSeedAmountsAndMinimums(
            params.amountADesired, params.amountBDesired, params.amountAMin, params.amountBMin
        );
    }

    function _requireCanonicalBoardroom(address boardroom) internal view {
        if (!_isCanonicalBoardroom(boardroom)) revert InvalidBoardroom(boardroom);
    }

    function _isCanonicalBoardroom(address boardroom) internal view returns (bool) {
        return boardroom.code.length != 0
            && IPledgeV4LiquidityFactoryBoardroomFactory(boardroomFactory).isBoardroom(boardroom);
    }

    function _requireValidPair(address boardroom, address tokenA, address tokenB) internal view {
        if (!_validPair(boardroom, tokenA, tokenB)) revert InvalidPair(tokenA, tokenB);
    }

    function _validPair(address boardroom, address tokenA, address tokenB) internal view returns (bool) {
        if (tokenA == address(0) || tokenB == address(0) || tokenA == tokenB) return false;
        address shareToken = _boardroomShareToken(boardroom);
        if (tokenA != shareToken && tokenB != shareToken) return false;
        address quoteAsset = tokenA == shareToken ? tokenB : tokenA;
        return !IPledgeV4LiquidityFactoryBoardroomFactory(boardroomFactory).isShareToken(quoteAsset);
    }

    function _quoteAsset(address boardroom, address tokenA, address tokenB) internal view returns (address) {
        address shareToken = _boardroomShareToken(boardroom);
        return tokenA == shareToken ? tokenB : tokenA;
    }

    function _boardroomShareToken(address boardroom) internal view returns (address shareToken) {
        shareToken = IPledgeV4LiquidityFactoryBoardroom(boardroom).shareToken();
        if (shareToken == address(0) || IPledgeV4LiquidityFactoryShareToken(shareToken).boardroom() != boardroom) {
            revert InvalidBoardroom(boardroom);
        }
    }

    function _requireUninitializedPool(bytes32 poolId) internal view {
        if (_isPoolInitialized(poolId)) revert PoolAlreadyInitialized(poolId);
    }

    function _isPoolInitialized(bytes32 poolId) internal view returns (bool) {
        (uint160 sqrtPriceX96,,,) = StateLibrary.getSlot0(poolManager, PoolId.wrap(poolId));
        return sqrtPriceX96 != 0;
    }

    function _pullSeedTokens(
        address vault,
        address payer,
        address tokenA,
        address tokenB,
        uint256 amountA,
        uint256 amountB
    ) internal {
        _checkedTransferFrom(tokenA, payer, vault, amountA);
        _checkedTransferFrom(tokenB, payer, vault, amountB);
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
        requiredA = amountA.fullMulDiv(retainedBps, BPS_DENOMINATOR);
        requiredB = amountB.fullMulDiv(retainedBps, BPS_DENOMINATOR);
    }

    function _requireValidSqrtPrice(uint160 sqrtPriceX96) internal pure {
        if (!_validSqrtPrice(sqrtPriceX96)) revert InvalidAmount();
    }

    function _validSqrtPrice(uint160 sqrtPriceX96) internal pure returns (bool) {
        uint160 lower = TickMath.getSqrtPriceAtTick(TickMath.minUsableTick(TICK_SPACING));
        uint160 upper = TickMath.getSqrtPriceAtTick(TickMath.maxUsableTick(TICK_SPACING));
        return sqrtPriceX96 > lower && sqrtPriceX96 < upper;
    }

    function _cloneSalt(address boardroom, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encode(boardroom, salt));
    }

    function _selector(bytes calldata data) internal pure returns (bytes4 selector) {
        if (data.length < 4) return bytes4(0);
        return bytes4(data[:4]);
    }
}
