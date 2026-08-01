// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.30;

import {ERC20} from "solady/tokens/ERC20.sol";
import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";
import {Initializable} from "solady/utils/Initializable.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "v4-core/types/BalanceDelta.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {ExactTransferLib} from "../lib/ExactTransferLib.sol";
import {PledgeV4LiquidityMath} from "./PledgeV4LiquidityMath.sol";

interface IPledgeV4LiquidityBoardroom {
    function status() external view returns (uint8);

    function lockedLiquidityExitAllowed() external view returns (bool);

    function liquidityMutationAllowed() external view returns (bool);
}

/// @notice One lifetime full-range Uniswap v4 position custodian for a Boardroom.
/// @dev While Active, protocol claim units remain escrowed by this vault while external depositors may hold
/// lifecycle-bound claims. During wind-down the Boardroom can remove its own position share or receive its ERC20
/// claims. Claims mode makes every remaining claim independently redeemable for pro-rata principal and backing.
contract PledgeV4LiquidityVault is ERC20, Initializable, ReentrancyGuard, IUnlockCallback {
    using BalanceDeltaLibrary for BalanceDelta;
    using CurrencyLibrary for Currency;
    using FixedPointMathLib for uint256;
    using PoolIdLibrary for PoolKey;

    uint256 public constant PROTOCOL_FEE_SHARE_BPS = 500;
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint8 internal constant BOARDROOM_STATUS_ACTIVE = 0;

    enum LiquidityState {
        Unconfigured,
        Active,
        Claims,
        Closed
    }

    struct UnlockRequest {
        int256 liquidityDelta;
        address recipient;
    }

    struct AddRequest {
        uint256 amountADesired;
        uint256 amountBDesired;
        uint256 amountAMin;
        uint256 amountBMin;
        address claimRecipient;
        address refundRecipient;
    }

    address public factory;
    address public boardroom;
    address public protocolFeeRecipient;
    address public tokenA;
    address public tokenB;
    address public currency0;
    address public currency1;
    address public hook;
    IPoolManager public poolManager;
    bytes32 public positionSalt;
    bytes32 internal poolIdStorage;
    int24 public tickLower;
    int24 public tickUpper;
    uint24 public poolFee;
    int24 public tickSpacing;
    uint128 public positionLiquidity;
    LiquidityState public liquidityState;
    bytes32 private pendingUnlockHash;

    error InvalidAddress();
    error InvalidAmount();
    error Expired(uint256 deadline);
    error OnlyFactory(address caller);
    error OnlyBoardroom(address caller);
    error OnlyPoolManager(address caller);
    error InvalidLiquidityState(LiquidityState expected, LiquidityState actual);
    error BoardroomMutationForbidden();
    error BoardroomNotWindingDown();
    error PositionNotEmpty(uint256 liquidity);
    error SlippageExceeded(uint256 amountA, uint256 minimumA, uint256 amountB, uint256 minimumB);
    error InvalidUnlockCallback();
    error UnexpectedCurrencyDelta(address currency, int128 delta);
    error UnexpectedSettlement(address currency, uint256 expected, uint256 paid);
    error UnexpectedPoolManagerTransfer(address currency, uint256 expected, uint256 actual);
    error UnexpectedTokenTransfer(address token, uint256 expected, uint256 senderSpent, uint256 recipientReceived);

    event PledgeV4LiquidityVaultInitialized(
        address indexed boardroom,
        bytes32 indexed poolId,
        address indexed poolManager,
        address tokenA,
        address tokenB,
        int24 tickLower,
        int24 tickUpper,
        bytes32 positionSalt
    );
    event LiquidityAdded(bytes32 indexed poolId, uint256 amountA, uint256 amountB, uint128 liquidity);
    event LiquidityClaimsMinted(address indexed depositor, address indexed recipient, uint256 claims);
    event LiquidityRemoved(bytes32 indexed poolId, uint128 liquidity, uint256 amountA, uint256 amountB);
    event FeesForwarded(
        address indexed boardroom,
        address indexed protocolFeeRecipient,
        uint256 boardroomAmount0,
        uint256 boardroomAmount1,
        uint256 protocolAmount0,
        uint256 protocolAmount1
    );
    event PositionClaimsReleased(bytes32 indexed poolId, address indexed boardroom, uint256 claims);
    event PositionClaimsRedeemed(
        address indexed holder,
        address indexed recipient,
        uint256 claims,
        uint128 liquidity,
        uint256 amountA,
        uint256 amountB
    );
    event LiquidityClosed(bytes32 indexed poolId);

    constructor() {
        _disableInitializers();
    }

    function name() public pure override returns (string memory) {
        return "pledge.cash Uniswap v4 position claim";
    }

    function symbol() public pure override returns (string memory) {
        return "P4LP";
    }

    function initialize(
        address factory_,
        address boardroom_,
        IPoolManager poolManager_,
        address protocolFeeRecipient_,
        address tokenA_,
        address tokenB_,
        uint24 poolFee_,
        int24 tickSpacing_,
        IHooks hook_,
        bytes32 salt
    ) external initializer {
        if (
            factory_ == address(0) || boardroom_ == address(0) || address(poolManager_) == address(0)
                || address(poolManager_).code.length == 0 || protocolFeeRecipient_ == address(0)
                || protocolFeeRecipient_.code.length == 0 || tokenA_ == address(0) || tokenB_ == address(0)
                || tokenA_ == tokenB_ || address(hook_) == address(0) || address(hook_).code.length == 0
        ) revert InvalidAddress();

        (address currency0_, address currency1_) = tokenA_ < tokenB_ ? (tokenA_, tokenB_) : (tokenB_, tokenA_);
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(currency0_),
            currency1: Currency.wrap(currency1_),
            fee: poolFee_,
            tickSpacing: tickSpacing_,
            hooks: hook_
        });

        factory = factory_;
        boardroom = boardroom_;
        poolManager = poolManager_;
        protocolFeeRecipient = protocolFeeRecipient_;
        tokenA = tokenA_;
        tokenB = tokenB_;
        currency0 = currency0_;
        currency1 = currency1_;
        hook = address(hook_);
        poolFee = poolFee_;
        tickSpacing = tickSpacing_;
        tickLower = TickMath.minUsableTick(tickSpacing_);
        tickUpper = TickMath.maxUsableTick(tickSpacing_);
        positionSalt = keccak256(abi.encode(boardroom_, salt));
        poolIdStorage = PoolId.unwrap(key.toId());

        emit PledgeV4LiquidityVaultInitialized(
            boardroom_, poolIdStorage, address(poolManager_), tokenA_, tokenB_, tickLower, tickUpper, positionSalt
        );
    }

    function poolId() external view returns (bytes32) {
        return poolIdStorage;
    }

    function poolKey() public view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(currency0),
            currency1: Currency.wrap(currency1),
            fee: poolFee,
            tickSpacing: tickSpacing,
            hooks: IHooks(hook)
        });
    }

    function addLiquidity(
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        uint256 deadline
    ) external nonReentrant returns (uint256 amountA, uint256 amountB, uint128 liquidity) {
        _requireFactoryCaller();
        _requireBoardroomMutation();
        _requireDeadline(deadline);
        return _addLiquidity(
            AddRequest({
                amountADesired: amountADesired,
                amountBDesired: amountBDesired,
                amountAMin: amountAMin,
                amountBMin: amountBMin,
                claimRecipient: address(this),
                refundRecipient: boardroom
            })
        );
    }

    /// @notice Opts external capital into the Boardroom lifecycle in exchange for fungible P4LP claims.
    /// @dev Claims cannot redeem principal until the Boardroom enters wind-down. Ordinary v4 positions
    /// remain available to providers who do not want this lifecycle-bound liquidity-bond asset.
    function depositLiquidityForClaims(
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address recipient,
        uint256 deadline
    ) external nonReentrant returns (uint256 amountA, uint256 amountB, uint128 liquidity) {
        _requireActive();
        _requireBoardroomActive();
        _requireDeadline(deadline);
        if (recipient == address(0)) revert InvalidAddress();
        _pullExact(tokenA, msg.sender, amountADesired);
        _pullExact(tokenB, msg.sender, amountBDesired);
        _requireBoardroomActive();
        (amountA, amountB, liquidity) = _addLiquidity(
            AddRequest({
                amountADesired: amountADesired,
                amountBDesired: amountBDesired,
                amountAMin: amountAMin,
                amountBMin: amountBMin,
                claimRecipient: recipient,
                refundRecipient: msg.sender
            })
        );
        _requireBoardroomActive();
        emit LiquidityClaimsMinted(msg.sender, recipient, liquidity);
    }

    function _addLiquidity(AddRequest memory request)
        internal
        returns (uint256 amountA, uint256 amountB, uint128 liquidity)
    {
        if (liquidityState == LiquidityState.Claims || liquidityState == LiquidityState.Closed) {
            revert InvalidLiquidityState(LiquidityState.Active, liquidityState);
        }
        if (request.amountADesired == 0 || request.amountBDesired == 0) revert InvalidAmount();

        if (positionLiquidity != 0) _collectFees(boardroom);
        (uint256 amount0Desired, uint256 amount1Desired) =
            _toCurrencyOrder(request.amountADesired, request.amountBDesired);
        (uint160 sqrtPriceX96,,,) = StateLibrary.getSlot0(poolManager, PoolId.wrap(poolIdStorage));
        liquidity = PledgeV4LiquidityMath.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(tickLower),
            TickMath.getSqrtPriceAtTick(tickUpper),
            amount0Desired,
            amount1Desired
        );
        if (liquidity == 0 || uint256(positionLiquidity) + liquidity > type(uint128).max) revert InvalidAmount();

        (int128 delta0, int128 delta1) = _modifyLiquidity(int256(uint256(liquidity)), address(this));
        uint256 amount0 = _negativeAmount(currency0, delta0);
        uint256 amount1 = _negativeAmount(currency1, delta1);
        (amountA, amountB) = _fromCurrencyOrder(amount0, amount1);
        _requireMinimums(amountA, amountB, request.amountAMin, request.amountBMin);

        positionLiquidity += liquidity;
        _mint(request.claimRecipient, liquidity);
        if (liquidityState == LiquidityState.Unconfigured) liquidityState = LiquidityState.Active;
        _refundDepositDust(request.refundRecipient, request.amountADesired - amountA, request.amountBDesired - amountB);
        emit LiquidityAdded(poolIdStorage, amountA, amountB, liquidity);
    }

    function removeLiquidityToBoardroom(uint128 liquidity, uint256 amountAMin, uint256 amountBMin, uint256 deadline)
        external
        nonReentrant
        returns (uint256 amountA, uint256 amountB)
    {
        _requireFactoryCaller();
        _requireBoardroomMutation();
        _requireDeadline(deadline);
        _requireActive();
        (amountA, amountB) = _removeActiveLiquidity(liquidity, amountAMin, amountBMin);
    }

    function exitToBoardroom(uint256 amountAMin, uint256 amountBMin, uint256 deadline)
        external
        nonReentrant
        returns (uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        _requireBoardroomCaller();
        _requireBoardroomCanExit();
        _requireDeadline(deadline);
        _requireActive();
        liquidity = balanceOf(address(this));
        if (liquidity == 0) return (0, 0, 0);
        (amountA, amountB) = _removeActiveLiquidity(uint128(liquidity), amountAMin, amountBMin);
    }

    /// @notice Converts the live position into independently redeemable claims without touching either underlying.
    /// @dev This is the wind-down liveness fallback when PoolManager collection or an underlying transfer is hostile.
    function releaseClaimsToBoardroom() external nonReentrant returns (uint256 claims) {
        _requireBoardroomCaller();
        _requireBoardroomCanExit();
        _requireActive();
        claims = balanceOf(address(this));
        if (positionLiquidity == 0 || positionLiquidity != totalSupply()) revert InvalidAmount();
        liquidityState = LiquidityState.Claims;
        if (claims != 0) _transfer(address(this), boardroom, claims);
        emit PositionClaimsReleased(poolIdStorage, boardroom, claims);
    }

    function redeemClaims(uint256 claims, uint256 amountAMin, uint256 amountBMin, address recipient, uint256 deadline)
        external
        nonReentrant
        returns (uint256 amountA, uint256 amountB, uint128 liquidity)
    {
        _requireDeadline(deadline);
        if (liquidityState != LiquidityState.Claims) {
            revert InvalidLiquidityState(LiquidityState.Claims, liquidityState);
        }
        if (claims == 0 || recipient == address(0)) revert InvalidAmount();
        uint256 supply = totalSupply();
        if (claims > balanceOf(msg.sender) || claims > supply) revert InvalidAmount();

        _collectFees(address(this));
        (uint256 backingA, uint256 backingB) = _proRataBacking(claims, supply);
        liquidity =
            claims == supply ? positionLiquidity : uint128(uint256(positionLiquidity).fullMulDiv(claims, supply));
        if (liquidity == 0) revert InvalidAmount();

        _burn(msg.sender, claims);
        positionLiquidity -= liquidity;
        (amountA, amountB) = _removeClaimLiquidity(liquidity, backingA, backingB);
        _requireMinimums(amountA, amountB, amountAMin, amountBMin);
        _transferExact(tokenA, recipient, amountA);
        _transferExact(tokenB, recipient, amountB);

        if (claims == supply) {
            if (positionLiquidity != 0) revert PositionNotEmpty(positionLiquidity);
            liquidityState = LiquidityState.Closed;
            emit LiquidityClosed(poolIdStorage);
        }
        emit PositionClaimsRedeemed(msg.sender, recipient, claims, liquidity, amountA, amountB);
    }

    function _removeClaimLiquidity(uint128 liquidity, uint256 backingA, uint256 backingB)
        internal
        returns (uint256 amountA, uint256 amountB)
    {
        (int128 delta0, int128 delta1) = _modifyLiquidity(-int256(uint256(liquidity)), address(this));
        uint256 principal0 = _positiveAmount(currency0, delta0);
        uint256 principal1 = _positiveAmount(currency1, delta1);
        (uint256 principalA, uint256 principalB) = _fromCurrencyOrder(principal0, principal1);
        amountA = backingA + principalA;
        amountB = backingB + principalB;
    }

    function claimFees()
        external
        nonReentrant
        returns (uint256 boardroomAmount0, uint256 boardroomAmount1, uint256 protocolAmount0, uint256 protocolAmount1)
    {
        _requireBoardroomMutation();
        _requireActive();
        return _collectFees(boardroom);
    }

    function close() external nonReentrant {
        if (msg.sender == factory) {
            _requireBoardroomMutation();
        } else {
            _requireBoardroomCaller();
            _requireBoardroomCanExit();
        }
        _requireActive();
        if (positionLiquidity != 0 || totalSupply() != 0) revert PositionNotEmpty(positionLiquidity);
        liquidityState = LiquidityState.Closed;
        emit LiquidityClosed(poolIdStorage);
    }

    function isClosed() external view returns (bool) {
        return liquidityState == LiquidityState.Claims || liquidityState == LiquidityState.Closed;
    }

    function lockedLiquidity() external view returns (uint256) {
        return positionLiquidity;
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory result) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager(msg.sender);
        bytes32 expected = pendingUnlockHash;
        if (expected == bytes32(0) || expected != keccak256(data)) revert InvalidUnlockCallback();
        pendingUnlockHash = bytes32(0);

        UnlockRequest memory request = abi.decode(data, (UnlockRequest));
        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            poolKey(),
            IPoolManager.ModifyLiquidityParams({
                tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: request.liquidityDelta, salt: positionSalt
            }),
            bytes("")
        );
        int128 delta0 = delta.amount0();
        int128 delta1 = delta.amount1();
        _settleDelta(Currency.wrap(currency0), delta0, request.recipient);
        _settleDelta(Currency.wrap(currency1), delta1, request.recipient);
        result = abi.encode(delta0, delta1);
    }

    function _removeActiveLiquidity(uint128 liquidity, uint256 amountAMin, uint256 amountBMin)
        internal
        returns (uint256 amountA, uint256 amountB)
    {
        if (liquidity == 0 || liquidity > positionLiquidity || liquidity > balanceOf(address(this))) {
            revert InvalidAmount();
        }
        _collectFees(boardroom);
        (int128 delta0, int128 delta1) = _modifyLiquidity(-int256(uint256(liquidity)), address(this));
        uint256 amount0 = _positiveAmount(currency0, delta0);
        uint256 amount1 = _positiveAmount(currency1, delta1);
        (amountA, amountB) = _fromCurrencyOrder(amount0, amount1);
        _requireMinimums(amountA, amountB, amountAMin, amountBMin);
        positionLiquidity -= liquidity;
        _burn(address(this), liquidity);
        _transferExact(tokenA, boardroom, amountA);
        _transferExact(tokenB, boardroom, amountB);
        emit LiquidityRemoved(poolIdStorage, liquidity, amountA, amountB);
    }

    function _collectFees(address destination)
        internal
        returns (uint256 boardroomAmount0, uint256 boardroomAmount1, uint256 protocolAmount0, uint256 protocolAmount1)
    {
        if (positionLiquidity == 0) return (0, 0, 0, 0);
        (int128 delta0, int128 delta1) = _modifyLiquidity(0, address(this));
        uint256 fees0 = _positiveAmount(currency0, delta0);
        uint256 fees1 = _positiveAmount(currency1, delta1);
        protocolAmount0 = fees0.fullMulDiv(PROTOCOL_FEE_SHARE_BPS, BPS_DENOMINATOR);
        protocolAmount1 = fees1.fullMulDiv(PROTOCOL_FEE_SHARE_BPS, BPS_DENOMINATOR);
        boardroomAmount0 = fees0 - protocolAmount0;
        boardroomAmount1 = fees1 - protocolAmount1;

        _transferExact(currency0, protocolFeeRecipient, protocolAmount0);
        _transferExact(currency1, protocolFeeRecipient, protocolAmount1);
        if (destination != address(this)) {
            _transferExact(currency0, destination, boardroomAmount0);
            _transferExact(currency1, destination, boardroomAmount1);
        }
        emit FeesForwarded(
            boardroom,
            protocolFeeRecipient,
            destination == address(this) ? 0 : boardroomAmount0,
            destination == address(this) ? 0 : boardroomAmount1,
            protocolAmount0,
            protocolAmount1
        );
    }

    function _modifyLiquidity(int256 liquidityDelta, address recipient)
        internal
        returns (int128 delta0, int128 delta1)
    {
        bytes memory data = abi.encode(UnlockRequest({liquidityDelta: liquidityDelta, recipient: recipient}));
        if (pendingUnlockHash != bytes32(0)) revert InvalidUnlockCallback();
        pendingUnlockHash = keccak256(data);
        bytes memory result = poolManager.unlock(data);
        if (pendingUnlockHash != bytes32(0)) revert InvalidUnlockCallback();
        (delta0, delta1) = abi.decode(result, (int128, int128));
    }

    function _settleDelta(Currency currency, int128 delta, address recipient) internal {
        if (delta < 0) {
            uint256 amount = uint256(-int256(delta));
            uint256 balanceBefore = ERC20(Currency.unwrap(currency)).balanceOf(address(this));
            poolManager.sync(currency);
            currency.transfer(address(poolManager), amount);
            uint256 balanceAfter = ERC20(Currency.unwrap(currency)).balanceOf(address(this));
            uint256 spent = balanceAfter > balanceBefore ? 0 : balanceBefore - balanceAfter;
            if (spent != amount) revert UnexpectedPoolManagerTransfer(Currency.unwrap(currency), amount, spent);
            uint256 paid = poolManager.settle();
            if (paid != amount) revert UnexpectedSettlement(Currency.unwrap(currency), amount, paid);
        } else if (delta > 0) {
            uint256 amount = uint128(delta);
            uint256 balanceBefore = ERC20(Currency.unwrap(currency)).balanceOf(recipient);
            poolManager.take(currency, recipient, amount);
            uint256 balanceAfter = ERC20(Currency.unwrap(currency)).balanceOf(recipient);
            uint256 received = balanceAfter < balanceBefore ? 0 : balanceAfter - balanceBefore;
            if (received != amount) revert UnexpectedPoolManagerTransfer(Currency.unwrap(currency), amount, received);
        }
    }

    function _negativeAmount(address currency, int128 delta) internal pure returns (uint256 amount) {
        if (delta >= 0) revert UnexpectedCurrencyDelta(currency, delta);
        amount = uint256(-int256(delta));
    }

    function _positiveAmount(address currency, int128 delta) internal pure returns (uint256 amount) {
        if (delta < 0) revert UnexpectedCurrencyDelta(currency, delta);
        amount = uint128(delta);
    }

    function _toCurrencyOrder(uint256 amountA, uint256 amountB)
        internal
        view
        returns (uint256 amount0, uint256 amount1)
    {
        return tokenA == currency0 ? (amountA, amountB) : (amountB, amountA);
    }

    function _fromCurrencyOrder(uint256 amount0, uint256 amount1)
        internal
        view
        returns (uint256 amountA, uint256 amountB)
    {
        return tokenA == currency0 ? (amount0, amount1) : (amount1, amount0);
    }

    function _proRataBacking(uint256 claims, uint256 supply) internal view returns (uint256 amountA, uint256 amountB) {
        uint256 available0 = ERC20(currency0).balanceOf(address(this));
        uint256 available1 = ERC20(currency1).balanceOf(address(this));
        uint256 amount0 = claims == supply ? available0 : available0.fullMulDiv(claims, supply);
        uint256 amount1 = claims == supply ? available1 : available1.fullMulDiv(claims, supply);
        return _fromCurrencyOrder(amount0, amount1);
    }

    function _requireMinimums(uint256 amountA, uint256 amountB, uint256 amountAMin, uint256 amountBMin) internal pure {
        if (amountA < amountAMin || amountB < amountBMin) {
            revert SlippageExceeded(amountA, amountAMin, amountB, amountBMin);
        }
    }

    function _refundDepositDust(address recipient, uint256 amountA, uint256 amountB) internal {
        // Refund only the unused part of this deposit. Unsolicited transfers remain position backing
        // and cannot be captured by whichever account happens to add liquidity next.
        _transferExact(tokenA, recipient, amountA);
        _transferExact(tokenB, recipient, amountB);
    }

    function _pullExact(address token, address payer, uint256 amount) internal {
        if (amount == 0) revert InvalidAmount();
        ExactTransferLib.ExactDelta memory delta = ExactTransferLib.pullBetween(token, payer, address(this), amount);
        if (
            delta.senderBalanceIncreased || delta.recipientBalanceDecreased || delta.senderSpent != amount
                || delta.recipientReceived != amount
        ) revert UnexpectedTokenTransfer(token, amount, delta.senderSpent, delta.recipientReceived);
    }

    function _transferExact(address token, address recipient, uint256 amount) internal {
        if (amount == 0) return;
        ExactTransferLib.ExactDelta memory delta = ExactTransferLib.sendFromSelfTo(token, recipient, amount);
        if (
            delta.senderBalanceIncreased || delta.recipientBalanceDecreased || delta.senderSpent != amount
                || delta.recipientReceived != amount
        ) revert UnexpectedTokenTransfer(token, amount, delta.senderSpent, delta.recipientReceived);
    }

    function _requireFactoryCaller() internal view {
        if (msg.sender != factory) revert OnlyFactory(msg.sender);
    }

    function _requireBoardroomCaller() internal view {
        if (msg.sender != boardroom) revert OnlyBoardroom(msg.sender);
    }

    function _requireBoardroomMutation() internal view {
        if (!IPledgeV4LiquidityBoardroom(boardroom).liquidityMutationAllowed()) {
            revert BoardroomMutationForbidden();
        }
    }

    function _requireBoardroomActive() internal view {
        if (IPledgeV4LiquidityBoardroom(boardroom).status() != BOARDROOM_STATUS_ACTIVE) {
            revert BoardroomMutationForbidden();
        }
    }

    function _requireBoardroomCanExit() internal view {
        if (!IPledgeV4LiquidityBoardroom(boardroom).lockedLiquidityExitAllowed()) {
            revert BoardroomNotWindingDown();
        }
    }

    function _requireDeadline(uint256 deadline) internal view {
        if (deadline < block.timestamp) revert Expired(deadline);
    }

    function _requireActive() internal view {
        if (liquidityState != LiquidityState.Active) {
            revert InvalidLiquidityState(LiquidityState.Active, liquidityState);
        }
    }
}
