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

    address public factory;
    address public token0;
    address public token1;
    address public poolFees;

    uint112 internal reserve0;
    uint112 internal reserve1;
    uint32 internal blockTimestampLast;

    uint256 public price0CumulativeLast;
    uint256 public price1CumulativeLast;
    Observation[] public observations;

    uint256 public index0;
    uint256 public index1;
    mapping(address => uint256) public supplyIndex0;
    mapping(address => uint256) public supplyIndex1;
    mapping(address => uint256) public claimable0;
    mapping(address => uint256) public claimable1;

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
    error TooManySamplePoints(uint256 requested, uint256 maximum);
    error UnexpectedFeeTransfer(address token, uint256 expected, uint256 actual);

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

    constructor() {
        _disableInitializers();
    }

    function initialize(address token0_, address token1_) external initializer {
        _requireDistinctTokens(token0_, token1_);

        factory = msg.sender;
        token0 = token0_;
        token1 = token1_;
        poolFees = address(new PoolFees(address(this), token0_, token1_));
        blockTimestampLast = _blockTimestamp();
        observations.push(Observation(blockTimestampLast, 0, 0, 0, 0));
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

    function currentCumulativePrices()
        public
        view
        returns (uint256 price0Cumulative, uint256 price1Cumulative, uint32 timestamp)
    {
        timestamp = _blockTimestamp();
        price0Cumulative = price0CumulativeLast;
        price1Cumulative = price1CumulativeLast;

        uint32 timeElapsed = timestamp - blockTimestampLast;
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
        uint32 nowTimestamp = _blockTimestamp();
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
        amountOut = amountInWithFee * reserveOut / (reserveIn + amountInWithFee);
    }

    function mint(address to) external nonReentrant returns (uint256 liquidity) {
        _requireNonZero(to);
        _updateFor(to);

        (uint112 reserve0_, uint112 reserve1_,) = getReserves();
        uint256 balance0 = _balance(token0);
        uint256 balance1 = _balance(token1);
        uint256 amount0 = balance0 - reserve0_;
        uint256 amount1 = balance1 - reserve1_;
        uint256 supply = totalSupply();

        if (supply == 0) {
            liquidity = _mintInitialLiquidity(amount0, amount1);
        } else {
            liquidity = _mintAdditionalLiquidity(amount0, amount1, supply, reserve0_, reserve1_);
        }
        if (liquidity == 0) revert InsufficientLiquidityMinted();

        _mint(to, liquidity);
        _update(balance0, balance1, reserve0_, reserve1_);
        emit Mint(msg.sender, amount0, amount1);
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
    }

    function _sampleAmountOut(uint256 amountIn, uint256 window, uint256 target, bool tokenInIsToken0)
        internal
        view
        returns (uint256)
    {
        (uint256 start0, uint256 start1) = _cumulativeAt(target);
        (uint256 end0, uint256 end1) = _cumulativeAt(target + window);
        uint256 averagePrice = tokenInIsToken0 ? (end0 - start0) / window : (end1 - start1) / window;
        return amountIn * averagePrice / FEE_INDEX_SCALE;
    }

    function _reservesFor(address tokenIn) internal view returns (uint112 reserveIn, uint112 reserveOut) {
        return tokenIn == token0 ? (reserve0, reserve1) : (reserve1, reserve0);
    }

    function _requireLiquidity(uint112 reserveIn, uint112 reserveOut) internal pure {
        if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();
    }

    function _amountInAfterSwapFee(uint256 amountIn) internal view returns (uint256) {
        AmmFactory factory_ = AmmFactory(factory);
        uint256 denominator = factory_.FEE_DENOMINATOR();
        return amountIn * (denominator - factory_.SWAP_FEE_BPS()) / denominator;
    }

    function _mintInitialLiquidity(uint256 amount0, uint256 amount1) internal returns (uint256 liquidity) {
        liquidity = (amount0 * amount1).sqrt() - MINIMUM_LIQUIDITY;
        _mint(address(1), MINIMUM_LIQUIDITY);
    }

    function _mintAdditionalLiquidity(
        uint256 amount0,
        uint256 amount1,
        uint256 supply,
        uint112 reserve0_,
        uint112 reserve1_
    ) internal pure returns (uint256) {
        return FixedPointMathLib.min(amount0 * supply / reserve0_, amount1 * supply / reserve1_);
    }

    function _burnedAmounts(uint256 liquidity, uint256 supply, uint256 balance0, uint256 balance1)
        internal
        pure
        returns (uint256 amount0, uint256 amount1)
    {
        amount0 = liquidity * balance0 / supply;
        amount1 = liquidity * balance1 / supply;
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

    function _beforeTokenTransfer(address from, address to, uint256) internal override {
        if (from != address(0)) _updateFor(from);
        if (to != address(0)) _updateFor(to);
    }

    function _updateFor(address owner) internal {
        uint256 ownerBalance = balanceOf(owner);

        _applyFeeIndex(owner, ownerBalance, index0, supplyIndex0, claimable0);
        _applyFeeIndex(owner, ownerBalance, index1, supplyIndex1, claimable1);
    }

    function _accrueFee(address token, uint256 amountIn, bool zeroForOne) internal returns (uint256 debitedFee) {
        if (amountIn == 0) return 0;

        AmmFactory factory_ = AmmFactory(factory);
        uint256 denominator = factory_.FEE_DENOMINATOR();
        debitedFee = amountIn * factory_.SWAP_FEE_BPS() / denominator;
        if (debitedFee == 0) return 0;

        address protocolFeeRecipient = factory_.protocolFeeRecipient();
        uint256 protocolFee = _protocolFee(factory_, protocolFeeRecipient, debitedFee, denominator);
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
            claimableAmounts[owner] += ownerBalance * (currentIndex - suppliedIndex) / FEE_INDEX_SCALE;
        }
        suppliedIndexes[owner] = currentIndex;
    }

    function _protocolFee(AmmFactory factory_, address protocolFeeRecipient, uint256 swapFee, uint256 denominator)
        internal
        view
        returns (uint256)
    {
        if (protocolFeeRecipient == address(0)) return 0;

        return swapFee * factory_.PROTOCOL_FEE_SHARE_BPS() / denominator;
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
            index0 += receivedFee * FEE_INDEX_SCALE / supply;
        } else {
            index1 += receivedFee * FEE_INDEX_SCALE / supply;
        }
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

        uint32 timestamp = _blockTimestamp();
        uint32 timeElapsed = timestamp - blockTimestampLast;
        _accumulateCumulativePrices(timeElapsed, reserve0_, reserve1_);
        _recordObservation(timestamp, timeElapsed, nextReserve0, nextReserve1);

        reserve0 = nextReserve0;
        reserve1 = nextReserve1;
        blockTimestampLast = timestamp;
        emit Sync(reserve0, reserve1);
    }

    function _cumulativeAt(uint256 targetTimestamp)
        internal
        view
        returns (uint256 price0Cumulative, uint256 price1Cumulative)
    {
        (uint256 current0, uint256 current1, uint32 currentTimestamp) = currentCumulativePrices();
        if (targetTimestamp >= currentTimestamp) return (current0, current1);

        uint256 length = observations.length;
        for (uint256 i = length; i > 0; --i) {
            Observation memory observation = observations[i - 1];
            if (targetTimestamp < observation.timestamp) continue;

            return _cumulativeFromObservation(observation, targetTimestamp);
        }

        Observation memory first = observations[0];
        return (first.price0Cumulative, first.price1Cumulative);
    }

    function _toReserve(uint256 balance) internal pure returns (uint112) {
        if (balance > type(uint112).max) revert ReserveOverflow();

        // casting to uint112 is safe because ReserveOverflow was checked above.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint112(balance);
    }

    function _accumulateCumulativePrices(uint32 timeElapsed, uint112 reserve0_, uint112 reserve1_) internal {
        if (!_hasCumulativePriceDelta(timeElapsed, reserve0_, reserve1_)) return;

        (uint256 price0Delta, uint256 price1Delta) = _cumulativePriceDeltas(reserve0_, reserve1_, timeElapsed);
        price0CumulativeLast += price0Delta;
        price1CumulativeLast += price1Delta;
    }

    function _recordObservation(uint32 timestamp, uint32 timeElapsed, uint112 nextReserve0, uint112 nextReserve1)
        internal
    {
        if (timeElapsed == 0) return;

        observations.push(
            Observation(timestamp, price0CumulativeLast, price1CumulativeLast, nextReserve0, nextReserve1)
        );
    }

    function _cumulativeFromObservation(Observation memory observation, uint256 targetTimestamp)
        internal
        pure
        returns (uint256 price0Cumulative, uint256 price1Cumulative)
    {
        price0Cumulative = observation.price0Cumulative;
        price1Cumulative = observation.price1Cumulative;

        uint256 elapsed = targetTimestamp - observation.timestamp;
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

    function _blockTimestamp() internal view returns (uint32) {
        return uint32(block.timestamp % 2 ** 32);
    }
}
