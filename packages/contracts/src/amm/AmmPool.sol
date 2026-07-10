// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "solady/tokens/ERC20.sol";
import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";
import {Initializable} from "solady/utils/Initializable.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {AmmFactory} from "./AmmFactory.sol";
import {PoolFees} from "./PoolFees.sol";

interface IAmmCallee {
    function ammCall(address sender, uint256 amount0Out, uint256 amount1Out, bytes calldata data) external;
}

contract AmmPool is ERC20, Initializable, ReentrancyGuard {
    using FixedPointMathLib for uint256;
    using SafeTransferLib for address;

    uint256 public constant MINIMUM_LIQUIDITY = 1_000;
    uint256 public constant MAX_SAMPLE_POINTS = 32;
    uint256 internal constant FEE_INDEX_SCALE = 1e18;

    struct Observation {
        uint32 timestamp;
        uint256 price0Cumulative;
        uint256 price1Cumulative;
        uint112 reserve0;
        uint112 reserve1;
    }

    struct SwapCache {
        uint112 reserve0;
        uint112 reserve1;
        uint256 balance0;
        uint256 balance1;
        uint256 amount0In;
        uint256 amount1In;
    }

    struct MintCache {
        uint112 reserve0;
        uint112 reserve1;
        uint256 balance0;
        uint256 balance1;
        uint256 amount0;
        uint256 amount1;
        uint256 supply;
    }

    address public factory;
    address public token0;
    address public token1;
    address public poolFees;

    uint112 internal reserve0;
    uint112 internal reserve1;
    uint32 internal blockTimestampLast;
    uint64 internal observationTimestampLast;

    uint256 public price0CumulativeLast;
    uint256 public price1CumulativeLast;
    Observation[] public observations;
    uint64[] internal observationTimestamps;

    uint256 public index0;
    uint256 public index1;
    uint256 public protocolFeeRemainder0;
    uint256 public protocolFeeRemainder1;
    uint256 public lpFeeIndexRemainder0;
    uint256 public lpFeeIndexRemainder1;
    uint256 public pendingBurnRedistribution0;
    uint256 public pendingBurnRedistribution1;
    mapping(address => uint256) public supplyIndex0;
    mapping(address => uint256) public supplyIndex1;
    mapping(address => uint256) public claimable0;
    mapping(address => uint256) public claimable1;
    mapping(address => uint256) public pendingClaimable0;
    mapping(address => uint256) public pendingClaimable1;
    mapping(address => uint256) public lastLpReceiptBlock;
    mapping(address => bool) internal hasLpReceipt;

    error InvalidAddress();
    error InvalidInput();
    error InvalidToken();
    error InsufficientLiquidityMinted();
    error InsufficientLiquidityBurned();
    error InsufficientLiquidity();
    error InsufficientInputAmount();
    error InsufficientOutputAmount();
    error InvalidRecipient();
    error KInvariant();
    error ReserveOverflow();
    error TimestampOverflow();
    error OnlyFeeManager();
    error BalanceBelowReserve(address token, uint256 balance, uint256 reserve);
    error NoExcessBalance();
    error PoolNotInitialized();
    error InsufficientObservationHistory(uint256 requestedTimestamp, uint256 oldestTimestamp);
    error TooManySamplePoints(uint256 requested, uint256 maximum);
    error UnexpectedFeeTransfer(address token, uint256 expected, uint256 actual);
    error UnexpectedInitialLiquidityBalance(address token, uint256 expected, uint256 actual);

    event Mint(address indexed sender, uint256 amount0, uint256 amount1);
    event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
    event Swap(
        address indexed sender,
        uint256 amount0In,
        uint256 amount1In,
        uint256 amount0Out,
        uint256 amount1Out,
        address indexed to
    );
    event Sync(uint112 reserve0, uint112 reserve1);
    event FeesClaimed(address indexed owner, uint256 amount0, uint256 amount1);
    event ProtocolFeesAccrued(address indexed recipient, address indexed token, uint256 amount);
    event ExcessRecovered(address indexed recipient, uint256 amount0, uint256 amount1);
    event ExcessSynced(uint112 reserve0, uint112 reserve1);
    event InitialLiquidityExcessSwept(address indexed recipient, uint256 amount0, uint256 amount1);

    constructor() {
        _disableInitializers();
    }

    function initialize(address token0_, address token1_) external initializer {
        _requireDistinctTokens(token0_, token1_);

        factory = msg.sender;
        token0 = token0_;
        token1 = token1_;
        poolFees = address(new PoolFees(address(this), token0_, token1_));
        uint64 timestamp = _observationTimestamp();
        observationTimestampLast = timestamp;
        blockTimestampLast = _truncateTimestamp(timestamp);
        observations.push(Observation(blockTimestampLast, 0, 0, 0, 0));
        observationTimestamps.push(timestamp);
    }

    function name() public pure override returns (string memory) {
        return "Pledge AMM LP";
    }

    function symbol() public pure override returns (string memory) {
        return "PAMM-LP";
    }

    function tokens() external view returns (address, address) {
        return (token0, token1);
    }

    function getReserves() public view returns (uint112, uint112, uint32) {
        return (reserve0, reserve1, blockTimestampLast);
    }

    function observationLength() external view returns (uint256) {
        return observations.length;
    }

    function observationTimestampAt(uint256 index) external view returns (uint64) {
        return observationTimestamps[index];
    }

    function currentCumulativePrices()
        public
        view
        returns (uint256 price0Cumulative, uint256 price1Cumulative, uint32 timestamp)
    {
        uint64 observationTimestamp;
        (price0Cumulative, price1Cumulative, observationTimestamp) = _currentCumulativePrices();
        timestamp = _truncateTimestamp(observationTimestamp);
    }

    function _currentCumulativePrices()
        internal
        view
        returns (uint256 price0Cumulative, uint256 price1Cumulative, uint64 timestamp)
    {
        timestamp = _observationTimestamp();
        price0Cumulative = price0CumulativeLast;
        price1Cumulative = price1CumulativeLast;

        uint256 timeElapsed = timestamp - observationTimestampLast;
        if (_hasCumulativePriceDelta(timeElapsed, reserve0, reserve1)) {
            (uint256 price0Delta, uint256 price1Delta) = _cumulativePriceDeltas(reserve0, reserve1, timeElapsed);
            price0Cumulative += price0Delta;
            price1Cumulative += price1Delta;
        }
    }

    function sample(address tokenIn, uint256 amountIn, uint256 points, uint256 window)
        external
        view
        returns (uint256[] memory amountsOut)
    {
        _requireSampleInput(tokenIn, points, window);

        amountsOut = new uint256[](points);
        uint256 nowTimestamp = _observationTimestamp();
        bool tokenInIsToken0 = tokenIn == token0;

        for (uint256 i; i < points; ++i) {
            uint256 offset = (points - i) * window;
            uint256 target = offset > nowTimestamp ? 0 : uint256(nowTimestamp) - offset;
            amountsOut[i] = _sampleAmountOut(amountIn, window, target, tokenInIsToken0);
        }
    }

    function getAmountOut(uint256 amountIn, address tokenIn) public view returns (uint256 amountOut) {
        _requirePoolToken(tokenIn);
        if (amountIn == 0) return 0;

        (uint112 reserveIn, uint112 reserveOut) = _reservesFor(tokenIn);
        _requireLiquidity(reserveIn, reserveOut);

        uint256 amountInWithFee = _amountInAfterSwapFee(amountIn);
        if (amountInWithFee == 0) return 0;
        if (amountInWithFee > type(uint112).max - reserveIn) revert ReserveOverflow();
        amountOut = FixedPointMathLib.fullMulDiv(amountInWithFee, reserveOut, reserveIn + amountInWithFee);
    }

    function mint(address to) external nonReentrant returns (uint256 liquidity) {
        return _mintLiquidity(to, msg.sender, msg.sender, 0, 0);
    }

    function mintFromRouter(address to, address initializer, uint256 seedAmount0, uint256 seedAmount1)
        external
        nonReentrant
        returns (uint256 liquidity)
    {
        return _mintLiquidity(to, initializer, msg.sender, seedAmount0, seedAmount1);
    }

    function _mintLiquidity(
        address to,
        address initializer,
        address liquidityCaller,
        uint256 seedAmount0,
        uint256 seedAmount1
    ) internal returns (uint256 liquidity) {
        _requireNonZero(to);
        _requireNonZero(initializer);
        _updateFor(to);

        MintCache memory cache;
        (cache.reserve0, cache.reserve1,) = getReserves();
        cache.balance0 = _balance(token0);
        cache.balance1 = _balance(token1);
        _requireBalancesAtLeastReserves(cache.balance0, cache.balance1);
        cache.supply = totalSupply();

        if (cache.supply == 0) {
            (bool reserved, address reservationOwner) =
                AmmFactory(factory).consumeInitialLiquidityReservation(initializer, to, liquidityCaller);
            if (reserved) {
                (cache.balance0, cache.balance1) = _sweepReservedInitialLiquidityExcess(
                    cache.balance0, cache.balance1, seedAmount0, seedAmount1, reservationOwner
                );
            }
            _requireReserveBalances(cache.balance0, cache.balance1);
            cache.amount0 = cache.balance0 - cache.reserve0;
            cache.amount1 = cache.balance1 - cache.reserve1;
            liquidity = _mintInitialLiquidity(cache.amount0, cache.amount1, reserved);
        } else {
            _requireReserveBalances(cache.balance0, cache.balance1);
            cache.amount0 = cache.balance0 - cache.reserve0;
            cache.amount1 = cache.balance1 - cache.reserve1;
            liquidity =
                _mintAdditionalLiquidity(cache.amount0, cache.amount1, cache.supply, cache.reserve0, cache.reserve1);
        }
        if (liquidity == 0) revert InsufficientLiquidityMinted();

        _mint(to, liquidity);
        _update(cache.balance0, cache.balance1, cache.reserve0, cache.reserve1);
        emit Mint(msg.sender, cache.amount0, cache.amount1);
    }

    function _sweepReservedInitialLiquidityExcess(
        uint256 balance0,
        uint256 balance1,
        uint256 seedAmount0,
        uint256 seedAmount1,
        address reservationOwner
    ) internal returns (uint256 nextBalance0, uint256 nextBalance1) {
        if (balance0 < seedAmount0) {
            revert UnexpectedInitialLiquidityBalance(token0, seedAmount0, balance0);
        }
        if (balance1 < seedAmount1) {
            revert UnexpectedInitialLiquidityBalance(token1, seedAmount1, balance1);
        }

        uint256 excess0 = balance0 - seedAmount0;
        uint256 excess1 = balance1 - seedAmount1;
        _transferExact(token0, reservationOwner, excess0);
        _transferExact(token1, reservationOwner, excess1);

        nextBalance0 = _balance(token0);
        nextBalance1 = _balance(token1);
        if (nextBalance0 != seedAmount0) {
            revert UnexpectedInitialLiquidityBalance(token0, seedAmount0, nextBalance0);
        }
        if (nextBalance1 != seedAmount1) {
            revert UnexpectedInitialLiquidityBalance(token1, seedAmount1, nextBalance1);
        }

        emit InitialLiquidityExcessSwept(reservationOwner, excess0, excess1);
    }

    function burn(address to) external nonReentrant returns (uint256 amount0, uint256 amount1) {
        _requireNonZero(to);

        (uint112 reserve0_, uint112 reserve1_,) = getReserves();
        address token0_ = token0;
        address token1_ = token1;
        uint256 balance0 = _balance(token0_);
        uint256 balance1 = _balance(token1_);
        uint256 liquidity = balanceOf(address(this));
        uint256 supply = totalSupply();

        (amount0, amount1) = _burnedAmounts(liquidity, supply, balance0, balance1);

        _burn(address(this), liquidity);
        _redistributePendingBurnFees();
        token0_.safeTransfer(to, amount0);
        token1_.safeTransfer(to, amount1);

        balance0 = _balance(token0_);
        balance1 = _balance(token1_);
        _update(balance0, balance1, reserve0_, reserve1_);
        emit Burn(msg.sender, amount0, amount1, to);
    }

    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external nonReentrant {
        _requireSwapOutput(amount0Out, amount1Out);

        SwapCache memory cache;
        (cache.reserve0, cache.reserve1,) = getReserves();
        _requireSwapLiquidity(amount0Out, amount1Out, cache.reserve0, cache.reserve1);
        _requireSwapRecipient(to);

        _transferSwapOutput(to, amount0Out, amount1Out);
        _callAmmCallee(to, amount0Out, amount1Out, data);

        cache.balance0 = _balance(token0);
        cache.balance1 = _balance(token1);
        cache.amount0In = _amountIn(cache.balance0, cache.reserve0, amount0Out);
        cache.amount1In = _amountIn(cache.balance1, cache.reserve1, amount1Out);
        _requireSwapInput(cache.amount0In, cache.amount1In);

        cache.balance0 -= _accrueFee(token0, cache.amount0In, true);
        cache.balance1 -= _accrueFee(token1, cache.amount1In, false);

        _requireKInvariant(cache);

        _update(cache.balance0, cache.balance1, cache.reserve0, cache.reserve1);
        emit Swap(msg.sender, cache.amount0In, cache.amount1In, amount0Out, amount1Out, to);
    }

    function recoverExcess(address recipient) external nonReentrant returns (uint256 recovered0, uint256 recovered1) {
        _requireFeeManager();
        _requireNonZero(recipient);

        recovered0 = _excessBalance(token0, reserve0);
        recovered1 = _excessBalance(token1, reserve1);
        if (recovered0 == 0 && recovered1 == 0) revert NoExcessBalance();

        _transferExact(token0, recipient, recovered0);
        _transferExact(token1, recipient, recovered1);
        emit ExcessRecovered(recipient, recovered0, recovered1);
    }

    function syncExcess() external nonReentrant {
        _requireFeeManager();
        if (totalSupply() == 0) revert PoolNotInitialized();

        uint256 balance0 = _balance(token0);
        uint256 balance1 = _balance(token1);
        _requireBalancesAtLeastReserves(balance0, balance1);
        if (balance0 == reserve0 && balance1 == reserve1) revert NoExcessBalance();

        _update(balance0, balance1, reserve0, reserve1);
        emit ExcessSynced(reserve0, reserve1);
    }

    function claimFees() external nonReentrant returns (uint256 claimed0, uint256 claimed1) {
        _updateFor(msg.sender);

        (claimed0, claimed1) = _clearClaimableFees(msg.sender);
        _claimFeesIfAny(msg.sender, claimed0, claimed1);

        emit FeesClaimed(msg.sender, claimed0, claimed1);
    }

    function _requireDistinctTokens(address token0_, address token1_) internal pure {
        if (token0_ == address(0)) revert InvalidAddress();
        if (token1_ == address(0)) revert InvalidAddress();
        if (token0_ == token1_) revert InvalidAddress();
    }

    function _requireNonZero(address account) internal pure {
        if (account == address(0)) revert InvalidAddress();
    }

    function _requirePoolToken(address token) internal view {
        if (token != token0 && token != token1) revert InvalidToken();
    }

    function _requireSampleInput(address tokenIn, uint256 points, uint256 window) internal view {
        _requirePoolToken(tokenIn);
        if (points == 0 || window == 0) revert InvalidInput();
        if (points > MAX_SAMPLE_POINTS) revert TooManySamplePoints(points, MAX_SAMPLE_POINTS);
        if (window > type(uint64).max / points) revert InvalidInput();
    }

    function _sampleAmountOut(uint256 amountIn, uint256 window, uint256 target, bool tokenInIsToken0)
        internal
        view
        returns (uint256)
    {
        (uint256 start0, uint256 start1) = _cumulativeAt(target);
        (uint256 end0, uint256 end1) = _cumulativeAt(target + window);
        uint256 averagePrice = tokenInIsToken0 ? (end0 - start0) / window : (end1 - start1) / window;
        return FixedPointMathLib.fullMulDiv(amountIn, averagePrice, FEE_INDEX_SCALE);
    }

    function _reservesFor(address tokenIn) internal view returns (uint112 reserveIn, uint112 reserveOut) {
        return tokenIn == token0 ? (reserve0, reserve1) : (reserve1, reserve0);
    }

    function _requireLiquidity(uint112 reserveIn, uint112 reserveOut) internal pure {
        if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();
    }

    function _amountInAfterSwapFee(uint256 amountIn) internal view returns (uint256) {
        return amountIn - _swapFee(amountIn);
    }

    function _swapFee(uint256 amountIn) internal view returns (uint256) {
        AmmFactory factory_ = AmmFactory(factory);
        return FixedPointMathLib.fullMulDivUp(amountIn, factory_.SWAP_FEE_BPS(), factory_.FEE_DENOMINATOR());
    }

    function _mintInitialLiquidity(uint256 amount0, uint256 amount1, bool reserved)
        internal
        returns (uint256 liquidity)
    {
        uint256 initialLiquidity = (amount0 * amount1).sqrt();
        if (initialLiquidity <= MINIMUM_LIQUIDITY) revert InsufficientLiquidityMinted();
        if (reserved) return initialLiquidity;

        liquidity = initialLiquidity - MINIMUM_LIQUIDITY;
        _mint(address(1), MINIMUM_LIQUIDITY);
    }

    function _mintAdditionalLiquidity(
        uint256 amount0,
        uint256 amount1,
        uint256 supply,
        uint112 reserve0_,
        uint112 reserve1_
    ) internal pure returns (uint256) {
        return FixedPointMathLib.min(
            FixedPointMathLib.fullMulDiv(amount0, supply, reserve0_),
            FixedPointMathLib.fullMulDiv(amount1, supply, reserve1_)
        );
    }

    function _burnedAmounts(uint256 liquidity, uint256 supply, uint256 balance0, uint256 balance1)
        internal
        pure
        returns (uint256 amount0, uint256 amount1)
    {
        amount0 = FixedPointMathLib.fullMulDiv(liquidity, balance0, supply);
        amount1 = FixedPointMathLib.fullMulDiv(liquidity, balance1, supply);
        if (amount0 == 0 || amount1 == 0) revert InsufficientLiquidityBurned();
    }

    function _requireSwapOutput(uint256 amount0Out, uint256 amount1Out) internal pure {
        if (amount0Out == 0 && amount1Out == 0) revert InsufficientOutputAmount();
    }

    function _requireSwapLiquidity(uint256 amount0Out, uint256 amount1Out, uint112 reserve0_, uint112 reserve1_)
        internal
        pure
    {
        if (amount0Out >= reserve0_ || amount1Out >= reserve1_) revert InsufficientLiquidity();
    }

    function _requireSwapRecipient(address recipient) internal view {
        if (recipient == token0 || recipient == token1 || recipient == address(0)) revert InvalidRecipient();
    }

    function _transferSwapOutput(address recipient, uint256 amount0Out, uint256 amount1Out) internal {
        if (amount0Out != 0) token0.safeTransfer(recipient, amount0Out);
        if (amount1Out != 0) token1.safeTransfer(recipient, amount1Out);
    }

    function _callAmmCallee(address recipient, uint256 amount0Out, uint256 amount1Out, bytes calldata data) internal {
        if (data.length == 0) return;

        IAmmCallee(recipient).ammCall(msg.sender, amount0Out, amount1Out, data);
    }

    function _amountIn(uint256 balance, uint112 reserve, uint256 amountOut) internal pure returns (uint256) {
        uint256 balanceBeforeInput = uint256(reserve) - amountOut;
        return balance > balanceBeforeInput ? balance - balanceBeforeInput : 0;
    }

    function _requireSwapInput(uint256 amount0In, uint256 amount1In) internal pure {
        if (amount0In == 0 && amount1In == 0) revert InsufficientInputAmount();
    }

    function _requireKInvariant(SwapCache memory cache) internal pure {
        _requireReserveBalances(cache.balance0, cache.balance1);
        if (cache.balance0 * cache.balance1 < uint256(cache.reserve0) * uint256(cache.reserve1)) revert KInvariant();
    }

    function _clearClaimableFees(address owner) internal returns (uint256 claimed0, uint256 claimed1) {
        claimed0 = claimable0[owner];
        claimed1 = claimable1[owner];

        if (claimed0 != 0) claimable0[owner] = 0;
        if (claimed1 != 0) claimable1[owner] = 0;
    }

    function _claimFeesIfAny(address recipient, uint256 claimed0, uint256 claimed1) internal {
        if (claimed0 == 0 && claimed1 == 0) return;

        PoolFees(poolFees).claimFeesFor(recipient, claimed0, claimed1);
    }

    function _beforeTokenTransfer(address from, address to, uint256 amount) internal override {
        if (from == address(0)) {
            if (to != address(0)) {
                _updateFor(to);
                _recordLpReceipt(to, amount);
            }
            return;
        }
        if (to == address(0)) return;

        _updateFor(from);
        if (to == address(this)) {
            _forfeitPendingForBurn(from, amount, balanceOf(from));
            return;
        }
        if (to == from) return;

        _updateFor(to);
        _moveFeeEntitlement(from, to, amount, balanceOf(from), claimable0, pendingClaimable0);
        _moveFeeEntitlement(from, to, amount, balanceOf(from), claimable1, pendingClaimable1);
        _recordLpReceipt(to, amount);
    }

    function _updateFor(address owner) internal {
        _maturePendingFees(owner);
        uint256 ownerBalance = balanceOf(owner);
        bool receiptInCurrentBlock = _receivedLpThisBlock(owner);

        _applyFeeIndex(
            owner, ownerBalance, index0, supplyIndex0, receiptInCurrentBlock ? pendingClaimable0 : claimable0
        );
        _applyFeeIndex(
            owner, ownerBalance, index1, supplyIndex1, receiptInCurrentBlock ? pendingClaimable1 : claimable1
        );
    }

    function _accrueFee(address token, uint256 amountIn, bool zeroForOne) internal returns (uint256 debitedFee) {
        if (amountIn == 0) return 0;

        AmmFactory factory_ = AmmFactory(factory);
        uint256 denominator = factory_.FEE_DENOMINATOR();
        debitedFee = _swapFee(amountIn);

        address protocolFeeRecipient = factory_.protocolFeeRecipient();
        uint256 protocolFee = _protocolFee(factory_, protocolFeeRecipient, debitedFee, denominator, zeroForOne);
        uint256 lpFee = debitedFee - protocolFee;

        (uint256 lpFeeSpent, uint256 lpFeeReceived) = _transferLpFee(token, lpFee);
        debitedFee = lpFeeSpent + _transferProtocolFee(token, protocolFeeRecipient, protocolFee);
        _increaseLpFeeIndex(zeroForOne, lpFeeReceived);
    }

    function _applyFeeIndex(
        address owner,
        uint256 ownerBalance,
        uint256 currentIndex,
        mapping(address => uint256) storage suppliedIndexes,
        mapping(address => uint256) storage claimableAmounts
    ) internal {
        uint256 suppliedIndex = suppliedIndexes[owner];
        if (suppliedIndex == currentIndex) return;

        if (ownerBalance != 0) {
            claimableAmounts[
                owner
            ] += FixedPointMathLib.fullMulDiv(ownerBalance, currentIndex - suppliedIndex, FEE_INDEX_SCALE);
        }
        suppliedIndexes[owner] = currentIndex;
    }

    function _moveFeeEntitlement(
        address from,
        address to,
        uint256 amount,
        uint256 fromBalance,
        mapping(address => uint256) storage matureAmounts,
        mapping(address => uint256) storage pendingAmounts
    ) internal {
        if (amount == 0) return;

        uint256 fromMature = matureAmounts[from];
        uint256 fromPending = pendingAmounts[from];
        uint256 movedMature =
            amount == fromBalance ? fromMature : FixedPointMathLib.fullMulDiv(fromMature, amount, fromBalance);
        uint256 movedPending =
            amount == fromBalance ? fromPending : FixedPointMathLib.fullMulDiv(fromPending, amount, fromBalance);
        uint256 moved = movedMature + movedPending;
        if (moved == 0) return;

        matureAmounts[from] = fromMature - movedMature;
        pendingAmounts[from] = fromPending - movedPending;
        pendingAmounts[to] += moved;
    }

    function _recordLpReceipt(address owner, uint256 amount) internal {
        if (amount == 0) return;
        hasLpReceipt[owner] = true;
        lastLpReceiptBlock[owner] = block.number;
    }

    function _receivedLpThisBlock(address owner) internal view returns (bool) {
        return hasLpReceipt[owner] && lastLpReceiptBlock[owner] == block.number;
    }

    function _maturePendingFees(address owner) internal {
        if (_receivedLpThisBlock(owner)) return;

        uint256 pending0 = pendingClaimable0[owner];
        uint256 pending1 = pendingClaimable1[owner];
        if (pending0 != 0) {
            pendingClaimable0[owner] = 0;
            claimable0[owner] += pending0;
        }
        if (pending1 != 0) {
            pendingClaimable1[owner] = 0;
            claimable1[owner] += pending1;
        }
    }

    function _forfeitPendingForBurn(address owner, uint256 amount, uint256 ownerBalance) internal {
        if (amount == 0) return;

        uint256 ownerPending0 = pendingClaimable0[owner];
        uint256 ownerPending1 = pendingClaimable1[owner];
        uint256 forfeited0 =
            amount == ownerBalance ? ownerPending0 : FixedPointMathLib.fullMulDiv(ownerPending0, amount, ownerBalance);
        uint256 forfeited1 =
            amount == ownerBalance ? ownerPending1 : FixedPointMathLib.fullMulDiv(ownerPending1, amount, ownerBalance);

        if (forfeited0 != 0) {
            pendingClaimable0[owner] = ownerPending0 - forfeited0;
            pendingBurnRedistribution0 += forfeited0;
        }
        if (forfeited1 != 0) {
            pendingClaimable1[owner] = ownerPending1 - forfeited1;
            pendingBurnRedistribution1 += forfeited1;
        }
    }

    function _redistributePendingBurnFees() internal {
        uint256 redistribution0 = pendingBurnRedistribution0;
        uint256 redistribution1 = pendingBurnRedistribution1;
        if (redistribution0 != 0) {
            pendingBurnRedistribution0 = 0;
            _increaseLpFeeIndex(true, redistribution0);
        }
        if (redistribution1 != 0) {
            pendingBurnRedistribution1 = 0;
            _increaseLpFeeIndex(false, redistribution1);
        }
    }

    function _protocolFee(
        AmmFactory factory_,
        address protocolFeeRecipient,
        uint256 swapFee,
        uint256 denominator,
        bool zeroForOne
    ) internal returns (uint256) {
        if (protocolFeeRecipient == address(0)) return 0;

        uint256 share = factory_.PROTOCOL_FEE_SHARE_BPS();
        uint256 protocolFee = FixedPointMathLib.fullMulDiv(swapFee, share, denominator);
        uint256 remainder = zeroForOne ? protocolFeeRemainder0 : protocolFeeRemainder1;
        uint256 carried = mulmod(swapFee, share, denominator) + remainder;
        protocolFee += carried / denominator;
        carried %= denominator;

        if (zeroForOne) protocolFeeRemainder0 = carried;
        else protocolFeeRemainder1 = carried;
        return protocolFee;
    }

    function _transferLpFee(address token, uint256 amount) internal returns (uint256 spent, uint256 received) {
        if (amount == 0) return (0, 0);

        return _transferFee(token, poolFees, amount);
    }

    function _transferProtocolFee(address token, address recipient, uint256 amount) internal returns (uint256 spent) {
        if (amount == 0) return 0;

        uint256 received;
        (spent, received) = _transferFee(token, recipient, amount);
        if (received != 0) emit ProtocolFeesAccrued(recipient, token, received);
    }

    function _increaseLpFeeIndex(bool zeroForOne, uint256 receivedFee) internal {
        if (receivedFee == 0) return;

        uint256 supply = totalSupply();
        if (supply == 0) return;

        if (zeroForOne) {
            (uint256 indexDelta, uint256 remainder) = _feeIndexDelta(receivedFee, supply, lpFeeIndexRemainder0);
            index0 += indexDelta;
            lpFeeIndexRemainder0 = remainder;
        } else {
            (uint256 indexDelta, uint256 remainder) = _feeIndexDelta(receivedFee, supply, lpFeeIndexRemainder1);
            index1 += indexDelta;
            lpFeeIndexRemainder1 = remainder;
        }
    }

    function _feeIndexDelta(uint256 receivedFee, uint256 supply, uint256 previousRemainder)
        internal
        pure
        returns (uint256 indexDelta, uint256 nextRemainder)
    {
        indexDelta = FixedPointMathLib.fullMulDiv(receivedFee, FEE_INDEX_SCALE, supply);
        uint256 carried = mulmod(receivedFee, FEE_INDEX_SCALE, supply) + previousRemainder;
        indexDelta += carried / supply;
        nextRemainder = carried % supply;
    }

    function _transferFee(address token, address recipient, uint256 amount)
        internal
        returns (uint256 spent, uint256 received)
    {
        uint256 poolBalanceBefore = ERC20(token).balanceOf(address(this));
        uint256 recipientBalanceBefore = ERC20(token).balanceOf(recipient);
        token.safeTransfer(recipient, amount);

        uint256 poolBalanceAfter = ERC20(token).balanceOf(address(this));
        if (poolBalanceAfter > poolBalanceBefore) revert UnexpectedFeeTransfer(token, amount, 0);
        spent = poolBalanceBefore - poolBalanceAfter;

        uint256 recipientBalanceAfter = ERC20(token).balanceOf(recipient);
        if (recipientBalanceAfter < recipientBalanceBefore) revert UnexpectedFeeTransfer(token, amount, 0);
        received = recipientBalanceAfter - recipientBalanceBefore;
    }

    function _update(uint256 balance0, uint256 balance1, uint112 reserve0_, uint112 reserve1_) internal {
        uint112 nextReserve0 = _toReserve(balance0);
        uint112 nextReserve1 = _toReserve(balance1);

        uint64 timestamp = _observationTimestamp();
        uint256 timeElapsed = timestamp - observationTimestampLast;
        _accumulateCumulativePrices(timeElapsed, reserve0_, reserve1_);
        _recordObservation(timestamp, timeElapsed, nextReserve0, nextReserve1);

        reserve0 = nextReserve0;
        reserve1 = nextReserve1;
        observationTimestampLast = timestamp;
        blockTimestampLast = _truncateTimestamp(timestamp);
        emit Sync(reserve0, reserve1);
    }

    function _cumulativeAt(uint256 targetTimestamp)
        internal
        view
        returns (uint256 price0Cumulative, uint256 price1Cumulative)
    {
        (uint256 current0, uint256 current1, uint64 currentTimestamp) = _currentCumulativePrices();
        if (targetTimestamp > currentTimestamp) revert InvalidInput();
        if (targetTimestamp == currentTimestamp) return (current0, current1);

        uint256 length = observations.length;
        uint64 firstTimestamp = observationTimestamps[0];
        if (targetTimestamp < firstTimestamp) {
            revert InsufficientObservationHistory(targetTimestamp, firstTimestamp);
        }

        uint256 low;
        uint256 high = length - 1;
        while (low < high) {
            uint256 middle = (low + high + 1) >> 1;
            if (observationTimestamps[middle] <= targetTimestamp) low = middle;
            else high = middle - 1;
        }

        return _cumulativeFromObservation(observations[low], observationTimestamps[low], targetTimestamp);
    }

    function _toReserve(uint256 balance) internal pure returns (uint112) {
        if (balance > type(uint112).max) revert ReserveOverflow();

        // casting to uint112 is safe because ReserveOverflow was checked above.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint112(balance);
    }

    function _accumulateCumulativePrices(uint256 timeElapsed, uint112 reserve0_, uint112 reserve1_) internal {
        if (!_hasCumulativePriceDelta(timeElapsed, reserve0_, reserve1_)) return;

        (uint256 price0Delta, uint256 price1Delta) = _cumulativePriceDeltas(reserve0_, reserve1_, timeElapsed);
        price0CumulativeLast += price0Delta;
        price1CumulativeLast += price1Delta;
    }

    function _recordObservation(uint64 timestamp, uint256 timeElapsed, uint112 nextReserve0, uint112 nextReserve1)
        internal
    {
        Observation memory nextObservation = Observation(
            _truncateTimestamp(timestamp), price0CumulativeLast, price1CumulativeLast, nextReserve0, nextReserve1
        );
        if (timeElapsed == 0) {
            uint256 lastIndex = observations.length - 1;
            observations[lastIndex] = nextObservation;
            observationTimestamps[lastIndex] = timestamp;
            return;
        }

        observations.push(nextObservation);
        observationTimestamps.push(timestamp);
    }

    function _cumulativeFromObservation(
        Observation memory observation,
        uint64 observationTimestamp,
        uint256 targetTimestamp
    ) internal pure returns (uint256 price0Cumulative, uint256 price1Cumulative) {
        price0Cumulative = observation.price0Cumulative;
        price1Cumulative = observation.price1Cumulative;

        uint256 elapsed = targetTimestamp - observationTimestamp;
        if (!_hasCumulativePriceDelta(elapsed, observation.reserve0, observation.reserve1)) {
            return (price0Cumulative, price1Cumulative);
        }

        (uint256 price0Delta, uint256 price1Delta) =
            _cumulativePriceDeltas(observation.reserve0, observation.reserve1, elapsed);
        price0Cumulative += price0Delta;
        price1Cumulative += price1Delta;
    }

    function _hasCumulativePriceDelta(uint256 timeElapsed, uint112 reserve0_, uint112 reserve1_)
        internal
        pure
        returns (bool)
    {
        return timeElapsed != 0 && reserve0_ != 0 && reserve1_ != 0;
    }

    function _cumulativePriceDeltas(uint112 reserve0_, uint112 reserve1_, uint256 timeElapsed)
        internal
        pure
        returns (uint256 price0Delta, uint256 price1Delta)
    {
        price0Delta = uint256(reserve1_) * FEE_INDEX_SCALE * timeElapsed / reserve0_;
        price1Delta = uint256(reserve0_) * FEE_INDEX_SCALE * timeElapsed / reserve1_;
    }

    function _balance(address token) internal view returns (uint256) {
        return ERC20(token).balanceOf(address(this));
    }

    function _requireFeeManager() internal view {
        if (msg.sender != AmmFactory(factory).feeManager()) revert OnlyFeeManager();
    }

    function _excessBalance(address token, uint112 reserve) internal view returns (uint256) {
        uint256 balance = _balance(token);
        if (balance < reserve) revert BalanceBelowReserve(token, balance, reserve);
        return balance - reserve;
    }

    function _requireBalancesAtLeastReserves(uint256 balance0, uint256 balance1) internal view {
        if (balance0 < reserve0) revert BalanceBelowReserve(token0, balance0, reserve0);
        if (balance1 < reserve1) revert BalanceBelowReserve(token1, balance1, reserve1);
    }

    function _requireReserveBalances(uint256 balance0, uint256 balance1) internal pure {
        if (balance0 > type(uint112).max || balance1 > type(uint112).max) revert ReserveOverflow();
    }

    function _transferExact(address token, address recipient, uint256 amount) internal {
        if (amount == 0) return;

        uint256 poolBalanceBefore = _balance(token);
        uint256 recipientBalanceBefore = ERC20(token).balanceOf(recipient);
        token.safeTransfer(recipient, amount);

        uint256 poolBalanceAfter = _balance(token);
        uint256 recipientBalanceAfter = ERC20(token).balanceOf(recipient);
        if (poolBalanceAfter > poolBalanceBefore || recipientBalanceAfter < recipientBalanceBefore) {
            revert UnexpectedFeeTransfer(token, amount, 0);
        }

        uint256 spent = poolBalanceBefore - poolBalanceAfter;
        uint256 received = recipientBalanceAfter - recipientBalanceBefore;
        if (spent != amount) revert UnexpectedFeeTransfer(token, amount, spent);
        if (received != amount) revert UnexpectedFeeTransfer(token, amount, received);
    }

    function _observationTimestamp() internal view returns (uint64 timestamp) {
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > type(uint64).max) revert TimestampOverflow();
        // block.timestamp fits uint64 after the explicit bound above.
        // forge-lint: disable-next-line(unsafe-typecast)
        timestamp = uint64(block.timestamp);
    }

    function _truncateTimestamp(uint64 timestamp) internal pure returns (uint32) {
        // The legacy reserve API deliberately exposes the low 32 bits, while TWAP history uses the full uint64 value.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint32(timestamp);
    }
}
