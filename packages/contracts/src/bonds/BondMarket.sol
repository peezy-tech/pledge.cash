// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";
import {Initializable} from "solady/utils/Initializable.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {ExactTransferLib} from "../lib/ExactTransferLib.sol";

interface IBondMarketBoardroom {
    function status() external view returns (uint8);
}

/// @notice A pre-funded, fixed-term Sequential Dutch Auction bond market.
/// @dev Positions are deliberately internal accounting records, not transferable tokens.
contract BondMarket is Initializable, ReentrancyGuard {
    uint8 internal constant BOARDROOM_STATUS_ACTIVE = 0;
    uint256 internal constant PRICE_SCALE = 1e18;
    uint256 internal constant DEBT_BUFFER_SCALE = 100_000;
    uint32 internal constant MINIMUM_DEBT_BUFFER = 10_000;
    uint32 internal constant DEFAULT_TUNE_INTERVAL = 1 days;
    uint32 internal constant DEFAULT_TUNE_ADJUSTMENT = 6 hours;
    uint32 internal constant MINIMUM_DEBT_DECAY_INTERVAL = 3 days;
    uint32 internal constant MINIMUM_DEPOSIT_INTERVAL = 1 hours;
    uint32 internal constant MINIMUM_MARKET_DURATION = 1 days;
    uint48 internal constant MAXIMUM_VESTING_TERM = 52 weeks * 50;

    enum MarketKind {
        Reserve,
        Liquidity
    }

    enum MarketStatus {
        Active,
        Closed
    }

    struct CreateParams {
        address quoteToken;
        MarketKind kind;
        uint256 capacity;
        uint256 initialPrice;
        uint256 minimumPrice;
        uint32 debtBuffer;
        uint48 vesting;
        uint48 start;
        uint32 duration;
        uint32 depositInterval;
        bytes32 salt;
    }

    struct Metadata {
        uint48 lastTune;
        uint48 lastDecay;
        uint32 depositInterval;
        uint32 tuneInterval;
        uint32 tuneAdjustmentDelay;
        uint32 debtDecayInterval;
        uint256 tuneIntervalCapacity;
        uint256 tuneBelowCapacity;
        uint256 lastTuneDebt;
    }

    struct Adjustment {
        uint256 change;
        uint48 lastAdjustment;
        uint48 timeToAdjusted;
        bool active;
    }

    struct Position {
        address owner;
        uint256 payout;
        uint48 maturity;
        bool redeemed;
    }

    address public factory;
    address public boardroom;
    address public shareToken;
    address public quoteToken;
    MarketKind public marketKind;
    MarketStatus public marketStatus;

    uint256 public initialCapacity;
    uint256 public capacity;
    uint256 public totalDebt;
    uint256 public minimumPrice;
    uint256 public storedMaxPayout;
    uint256 public purchased;
    uint256 public sold;
    uint256 public outstandingPayout;
    uint256 public returnedPayout;
    uint256 public controlVariable;
    uint256 public maxDebt;
    uint256 public nextPositionId;

    uint48 public startTime;
    uint48 public conclusion;
    uint48 public vestingTerm;
    Metadata public metadata;
    Adjustment public adjustment;
    mapping(uint256 => Position) public positions;
    mapping(address => uint256[]) internal positionsForOwner;

    error InvalidAddress();
    error InvalidAmount();
    error InvalidTerms();
    error OnlyBoardroom();
    error MarketNotActive();
    error MarketNotOpen();
    error MarketNotConcluded();
    error Expired();
    error SlippageExceeded(uint256 payout, uint256 minimumPayout);
    error MaxPayoutExceeded(uint256 payout, uint256 maximumPayout);
    error InsufficientCapacity(uint256 payout, uint256 remainingCapacity);
    error InvalidPosition(uint256 positionId);
    error PositionNotMature(uint256 positionId, uint48 maturity);
    error PositionAlreadyRedeemed(uint256 positionId);
    error UnexpectedTokenBalanceChange(address token, uint256 expected, uint256 actual);
    error ArithmeticOverflow();

    event BondMarketInitialized(
        address indexed boardroom,
        address indexed shareToken,
        address indexed quoteToken,
        MarketKind kind,
        uint256 capacity,
        uint256 initialPrice,
        uint256 minimumPrice,
        uint48 start,
        uint48 conclusion,
        uint48 vesting,
        bytes32 salt
    );
    event BondPurchased(
        uint256 indexed positionId,
        address indexed owner,
        uint256 quoteAmount,
        uint256 payout,
        uint256 price,
        uint48 maturity
    );
    event BondRedeemed(uint256 indexed positionId, address indexed owner, uint256 payout);
    event MarketTuned(uint256 previousControlVariable, uint256 newControlVariable);
    event MarketClosed(uint256 returnedPayout);
    event MarketSettled();

    constructor() {
        _disableInitializers();
    }

    function initialize(address boardroom_, address shareToken_, CreateParams calldata params) external initializer {
        _validateCreateParams(boardroom_, shareToken_, params);

        uint48 start = params.start == 0 ? _timestamp() : params.start;
        uint48 conclusion_ = _toUint48(uint256(start) + params.duration);
        uint32 debtDecayInterval = params.depositInterval * 5;
        if (debtDecayInterval < MINIMUM_DEBT_DECAY_INTERVAL) {
            debtDecayInterval = MINIMUM_DEBT_DECAY_INTERVAL;
        }
        uint32 tuneInterval =
            params.depositInterval > DEFAULT_TUNE_INTERVAL ? params.depositInterval : DEFAULT_TUNE_INTERVAL;

        uint256 targetDebt = FixedPointMathLib.fullMulDiv(params.capacity, debtDecayInterval, params.duration);
        uint256 maxPayout_ = FixedPointMathLib.fullMulDiv(params.capacity, params.depositInterval, params.duration);
        if (targetDebt == 0 || maxPayout_ == 0) revert InvalidTerms();

        uint256 minimumBuffer = FixedPointMathLib.fullMulDivUp(maxPayout_, DEBT_BUFFER_SCALE, targetDebt);
        if (minimumBuffer < MINIMUM_DEBT_BUFFER) minimumBuffer = MINIMUM_DEBT_BUFFER;
        uint256 effectiveBuffer = params.debtBuffer > minimumBuffer ? params.debtBuffer : minimumBuffer;
        uint256 maxDebt_ = targetDebt + FixedPointMathLib.fullMulDiv(targetDebt, effectiveBuffer, DEBT_BUFFER_SCALE);
        uint256 controlVariable_ = FixedPointMathLib.fullMulDivUp(params.initialPrice, PRICE_SCALE, targetDebt);
        if (controlVariable_ == 0) revert InvalidTerms();

        uint256 tuneIntervalCapacity = FixedPointMathLib.fullMulDiv(params.capacity, tuneInterval, params.duration);

        factory = msg.sender;
        boardroom = boardroom_;
        shareToken = shareToken_;
        quoteToken = params.quoteToken;
        marketKind = params.kind;
        marketStatus = MarketStatus.Active;
        initialCapacity = params.capacity;
        capacity = params.capacity;
        totalDebt = targetDebt;
        minimumPrice = params.minimumPrice;
        storedMaxPayout = maxPayout_;
        controlVariable = controlVariable_;
        maxDebt = maxDebt_;
        startTime = start;
        conclusion = conclusion_;
        vestingTerm = params.vesting;
        metadata = Metadata({
            lastTune: start,
            lastDecay: start,
            depositInterval: params.depositInterval,
            tuneInterval: tuneInterval,
            tuneAdjustmentDelay: DEFAULT_TUNE_ADJUSTMENT,
            debtDecayInterval: debtDecayInterval,
            tuneIntervalCapacity: tuneIntervalCapacity,
            tuneBelowCapacity: params.capacity > tuneIntervalCapacity ? params.capacity - tuneIntervalCapacity : 0,
            lastTuneDebt: targetDebt
        });

        _emitInitialized(params.initialPrice, params.salt);
    }

    function purchase(uint256 quoteAmount, uint256 minimumPayout_, uint256 deadline)
        external
        nonReentrant
        returns (uint256 positionId, uint256 payout, uint256 price)
    {
        if (deadline < block.timestamp) revert Expired();
        if (quoteAmount == 0) revert InvalidAmount();
        _requireOpen();

        uint48 timestamp = _timestamp();
        (price, payout) = _decayAndGetPrice(quoteAmount, timestamp);
        if (payout == 0) revert InvalidAmount();
        if (payout < minimumPayout_) revert SlippageExceeded(payout, minimumPayout_);

        uint256 maximumPayout = maxPayout();
        if (payout > maximumPayout) revert MaxPayoutExceeded(payout, maximumPayout);
        if (payout > capacity) revert InsufficientCapacity(payout, capacity);

        capacity -= payout;
        purchased += quoteAmount;
        sold += payout;
        outstandingPayout += payout;

        uint48 maturity = _toUint48(uint256(timestamp) + vestingTerm);
        positionId = nextPositionId;
        nextPositionId = positionId + 1;
        positions[positionId] = Position({owner: msg.sender, payout: payout, maturity: maturity, redeemed: false});
        positionsForOwner[msg.sender].push(positionId);

        uint256 unusedPayout;
        if (capacity == 0 || totalDebt > maxDebt) {
            unusedPayout = _closeState();
        } else {
            _tune(timestamp, price);
        }

        _checkedTransferFrom(quoteToken, msg.sender, boardroom, quoteAmount);
        if (unusedPayout != 0) _checkedTransfer(shareToken, boardroom, unusedPayout);

        emit BondPurchased(positionId, msg.sender, quoteAmount, payout, price, maturity);
    }

    /// @notice Redeems a matured position to its immutable owner. Anyone may execute the call.
    function redeem(uint256 positionId) external nonReentrant returns (uint256 payout) {
        Position storage position = positions[positionId];
        address owner = position.owner;
        if (owner == address(0)) revert InvalidPosition(positionId);
        if (position.redeemed) revert PositionAlreadyRedeemed(positionId);
        if (block.timestamp < position.maturity) revert PositionNotMature(positionId, position.maturity);

        payout = position.payout;
        position.redeemed = true;
        outstandingPayout -= payout;
        _checkedTransfer(shareToken, owner, payout);

        emit BondRedeemed(positionId, owner, payout);
        if (marketStatus == MarketStatus.Closed && outstandingPayout == 0) emit MarketSettled();
    }

    /// @notice Stops new purchases without impairing existing positions.
    function close() external nonReentrant onlyBoardroom returns (uint256 returned) {
        returned = _closeAndReturn();
    }

    /// @notice Permissionlessly closes an elapsed market and returns its unsold capacity.
    function finalize() external nonReentrant returns (uint256 returned) {
        if (marketStatus != MarketStatus.Active) revert MarketNotActive();
        if (block.timestamp < conclusion) revert MarketNotConcluded();
        returned = _closeAndReturn();
    }

    function marketPrice() public view returns (uint256 price) {
        price = FixedPointMathLib.fullMulDivUp(currentControlVariable(), currentDebt(), PRICE_SCALE);
        if (price < minimumPrice) price = minimumPrice;
    }

    function payoutFor(uint256 quoteAmount) public view returns (uint256) {
        return FixedPointMathLib.fullMulDiv(quoteAmount, PRICE_SCALE, marketPrice());
    }

    function maxPayout() public view returns (uint256) {
        return storedMaxPayout < capacity ? storedMaxPayout : capacity;
    }

    function maxAmountAccepted() external view returns (uint256) {
        return FixedPointMathLib.fullMulDiv(maxPayout(), marketPrice(), PRICE_SCALE);
    }

    function positionCountFor(address owner) external view returns (uint256) {
        return positionsForOwner[owner].length;
    }

    function positionForOwnerAt(address owner, uint256 index) external view returns (uint256) {
        return positionsForOwner[owner][index];
    }

    function currentDebt() public view returns (uint256) {
        uint256 currentTime = block.timestamp;
        if (currentTime < startTime) return totalDebt;

        Metadata memory meta = metadata;
        uint256 lastDecay = meta.lastDecay;
        if (lastDecay > currentTime) {
            return FixedPointMathLib.fullMulDiv(
                totalDebt, uint256(meta.debtDecayInterval) + (lastDecay - currentTime), meta.debtDecayInterval
            );
        }

        uint256 elapsed = currentTime - lastDecay;
        if (elapsed > meta.debtDecayInterval) return 0;
        return
            FixedPointMathLib.fullMulDiv(totalDebt, uint256(meta.debtDecayInterval) - elapsed, meta.debtDecayInterval);
    }

    function currentControlVariable() public view returns (uint256) {
        (uint256 decay,,) = _controlDecay();
        return controlVariable - decay;
    }

    function isLive() public view returns (bool) {
        return marketStatus == MarketStatus.Active && capacity != 0 && block.timestamp >= startTime
            && block.timestamp < conclusion && _isBoardroomActive();
    }

    /// @notice True only when purchases are closed and no funded position remains outstanding.
    function isClosed() external view returns (bool) {
        return marketStatus == MarketStatus.Closed && outstandingPayout == 0;
    }

    function _decayAndGetPrice(uint256 quoteAmount, uint48 timestamp) internal returns (uint256 price, uint256 payout) {
        uint256 decayedDebt = currentDebt();
        totalDebt = decayedDebt;

        if (adjustment.active) {
            (uint256 adjustBy, uint48 secondsSince, bool stillActive) = _controlDecay();
            controlVariable -= adjustBy;
            if (stillActive) {
                adjustment.change -= adjustBy;
                adjustment.timeToAdjusted -= secondsSince;
                adjustment.lastAdjustment = timestamp;
            } else {
                adjustment.active = false;
            }
        }

        price = FixedPointMathLib.fullMulDivUp(controlVariable, totalDebt, PRICE_SCALE);
        if (price < minimumPrice) price = minimumPrice;
        payout = FixedPointMathLib.fullMulDiv(quoteAmount, PRICE_SCALE, price);

        Metadata memory meta = metadata;
        uint256 lastDecayIncrement = FixedPointMathLib.fullMulDivUp(meta.debtDecayInterval, payout, meta.lastTuneDebt);
        uint256 decayAnchor = decayedDebt == 0 ? timestamp : meta.lastDecay;
        metadata.lastDecay = _toUint48(decayAnchor + lastDecayIncrement);

        uint256 decayOffset;
        if (timestamp > decayAnchor) {
            uint256 elapsed = uint256(timestamp) - decayAnchor;
            decayOffset = meta.debtDecayInterval > elapsed ? meta.debtDecayInterval - elapsed : 0;
        } else {
            decayOffset = uint256(meta.debtDecayInterval) + (decayAnchor - timestamp);
        }

        totalDebt = FixedPointMathLib.fullMulDiv(decayedDebt, meta.debtDecayInterval, decayOffset + lastDecayIncrement)
            + payout + 1;
    }

    function _tune(uint48 timestamp, uint256 price) internal {
        Metadata memory meta = metadata;
        uint256 timeRemaining = uint256(conclusion) - timestamp;
        uint256 duration = uint256(conclusion) - startTime;
        uint256 initialCapacity_ = capacity + sold;
        uint256 timeNeutralCapacity =
            FixedPointMathLib.fullMulDiv(initialCapacity_, duration - timeRemaining, duration) + capacity;

        bool oversold = capacity < meta.tuneBelowCapacity && timeNeutralCapacity < initialCapacity_;
        bool undersold = timestamp >= meta.lastTune + meta.tuneInterval && timeNeutralCapacity > initialCapacity_;
        if (!oversold && !undersold) return;

        storedMaxPayout = FixedPointMathLib.fullMulDiv(capacity, meta.depositInterval, timeRemaining);
        uint256 targetDebt = FixedPointMathLib.fullMulDiv(timeNeutralCapacity, meta.debtDecayInterval, duration);
        if (targetDebt == 0) return;

        uint256 previousControlVariable = controlVariable;
        uint256 newControlVariable = FixedPointMathLib.fullMulDivUp(price, PRICE_SCALE, targetDebt);
        emit MarketTuned(previousControlVariable, newControlVariable);

        if (newControlVariable < previousControlVariable) {
            adjustment = Adjustment({
                change: previousControlVariable - newControlVariable,
                lastAdjustment: timestamp,
                timeToAdjusted: meta.tuneAdjustmentDelay,
                active: true
            });
        } else {
            controlVariable = newControlVariable;
            adjustment.active = false;
        }

        metadata.lastTune = timestamp;
        metadata.tuneBelowCapacity = capacity > meta.tuneIntervalCapacity ? capacity - meta.tuneIntervalCapacity : 0;
        metadata.lastTuneDebt = targetDebt;
    }

    function _controlDecay() internal view returns (uint256 decay, uint48 secondsSince, bool active) {
        Adjustment memory info = adjustment;
        if (!info.active) return (0, 0, false);

        uint48 timestamp = _timestamp();
        secondsSince = timestamp - info.lastAdjustment;
        active = secondsSince < info.timeToAdjusted;
        decay = active ? FixedPointMathLib.fullMulDiv(info.change, secondsSince, info.timeToAdjusted) : info.change;
    }

    function _closeAndReturn() internal returns (uint256 returned) {
        returned = _closeState();
        if (returned != 0) _checkedTransfer(shareToken, boardroom, returned);
    }

    function _closeState() internal returns (uint256 returned) {
        if (marketStatus != MarketStatus.Active) revert MarketNotActive();

        marketStatus = MarketStatus.Closed;
        if (block.timestamp < conclusion) conclusion = _timestamp();
        returned = capacity;
        capacity = 0;
        returnedPayout += returned;

        emit MarketClosed(returned);
        if (outstandingPayout == 0) emit MarketSettled();
    }

    function _requireOpen() internal view {
        if (marketStatus != MarketStatus.Active) revert MarketNotActive();
        if (!isLive()) revert MarketNotOpen();
    }

    function _validateCreateParams(address boardroom_, address shareToken_, CreateParams calldata params)
        internal
        view
    {
        if (boardroom_ == address(0) || shareToken_ == address(0) || params.quoteToken == address(0)) {
            revert InvalidAddress();
        }
        if (params.quoteToken == shareToken_ || params.capacity == 0 || params.minimumPrice == 0) {
            revert InvalidAmount();
        }
        if (params.initialPrice < params.minimumPrice || params.debtBuffer < MINIMUM_DEBT_BUFFER) {
            revert InvalidTerms();
        }
        if (params.duration < MINIMUM_MARKET_DURATION || params.depositInterval < MINIMUM_DEPOSIT_INTERVAL) {
            revert InvalidTerms();
        }
        if (params.depositInterval > type(uint32).max / 5) revert InvalidTerms();
        if (params.depositInterval > params.duration) revert InvalidTerms();
        if (params.vesting < 1 days || params.vesting > MAXIMUM_VESTING_TERM) revert InvalidTerms();
        if (params.start != 0 && params.start < block.timestamp) revert InvalidTerms();
        if (uint256(params.start == 0 ? block.timestamp : params.start) + params.duration > type(uint48).max) {
            revert InvalidTerms();
        }
    }

    function _checkedTransfer(address token, address to, uint256 expectedAmount) internal {
        _requireExactBalanceChanges(token, expectedAmount, ExactTransferLib.sendFromSelfTo(token, to, expectedAmount));
    }

    function _emitInitialized(uint256 initialPrice, bytes32 salt) internal {
        emit BondMarketInitialized(
            boardroom,
            shareToken,
            quoteToken,
            marketKind,
            initialCapacity,
            initialPrice,
            minimumPrice,
            startTime,
            conclusion,
            vestingTerm,
            salt
        );
    }

    function _checkedTransferFrom(address token, address from, address to, uint256 expectedAmount) internal {
        _requireExactBalanceChanges(
            token, expectedAmount, ExactTransferLib.pullBetween(token, from, to, expectedAmount)
        );
    }

    function _requireExactBalanceChanges(
        address token,
        uint256 expectedAmount,
        ExactTransferLib.ExactDelta memory delta
    ) internal pure {
        if (delta.senderBalanceIncreased || delta.recipientBalanceDecreased) {
            revert UnexpectedTokenBalanceChange(token, expectedAmount, 0);
        }
        if (delta.senderSpent != expectedAmount) {
            revert UnexpectedTokenBalanceChange(token, expectedAmount, delta.senderSpent);
        }
        if (delta.recipientReceived != expectedAmount) {
            revert UnexpectedTokenBalanceChange(token, expectedAmount, delta.recipientReceived);
        }
    }

    function _isBoardroomActive() internal view returns (bool) {
        return IBondMarketBoardroom(boardroom).status() == BOARDROOM_STATUS_ACTIVE;
    }

    function _timestamp() internal view returns (uint48) {
        return _toUint48(block.timestamp);
    }

    function _toUint48(uint256 value) internal pure returns (uint48 result) {
        if (value > type(uint48).max) revert ArithmeticOverflow();
        // forge-lint: disable-next-line(unsafe-typecast)
        result = uint48(value);
    }

    modifier onlyBoardroom() {
        if (msg.sender != boardroom) revert OnlyBoardroom();
        _;
    }
}
