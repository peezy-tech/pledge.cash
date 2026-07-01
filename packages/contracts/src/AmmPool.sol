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

    constructor() {
        _disableInitializers();
    }

    function initialize(address token0_, address token1_) external initializer {
        if (token0_ == address(0) || token1_ == address(0) || token0_ == token1_) revert InvalidAddress();

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
        if (timeElapsed != 0 && reserve0 != 0 && reserve1 != 0) {
            price0Cumulative += uint256(reserve1) * FEE_INDEX_SCALE * timeElapsed / reserve0;
            price1Cumulative += uint256(reserve0) * FEE_INDEX_SCALE * timeElapsed / reserve1;
        }
    }

    function sample(address tokenIn, uint256 amountIn, uint256 points, uint256 window)
        external
        view
        returns (uint256[] memory amountsOut)
    {
        if (tokenIn != token0 && tokenIn != token1) revert InvalidToken();
        if (points == 0 || window == 0) revert InvalidInput();
        if (points > MAX_SAMPLE_POINTS) revert TooManySamplePoints(points, MAX_SAMPLE_POINTS);

        amountsOut = new uint256[](points);
        uint32 nowTimestamp = _blockTimestamp();
        for (uint256 i; i < points; ++i) {
            uint256 offset = (points - i) * window;
            uint256 target = offset > nowTimestamp ? 0 : uint256(nowTimestamp) - offset;
            (uint256 start0, uint256 start1) = _cumulativeAt(target);
            (uint256 end0, uint256 end1) = _cumulativeAt(target + window);
            uint256 averagePrice = tokenIn == token0 ? (end0 - start0) / window : (end1 - start1) / window;
            amountsOut[i] = amountIn * averagePrice / FEE_INDEX_SCALE;
        }
    }

    function getAmountOut(uint256 amountIn, address tokenIn) public view returns (uint256 amountOut) {
        if (tokenIn != token0 && tokenIn != token1) revert InvalidToken();
        if (amountIn == 0) return 0;

        (uint112 reserveIn, uint112 reserveOut) = tokenIn == token0 ? (reserve0, reserve1) : (reserve1, reserve0);
        if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();

        uint256 amountInWithFee = amountIn
            * (AmmFactory(factory).FEE_DENOMINATOR() - AmmFactory(factory).SWAP_FEE_BPS())
            / AmmFactory(factory).FEE_DENOMINATOR();
        amountOut = amountInWithFee * reserveOut / (reserveIn + amountInWithFee);
    }

    function mint(address to) external nonReentrant returns (uint256 liquidity) {
        if (to == address(0)) revert InvalidAddress();
        _updateFor(to);

        (uint112 reserve0_, uint112 reserve1_,) = getReserves();
        uint256 balance0 = _balance(token0);
        uint256 balance1 = _balance(token1);
        uint256 amount0 = balance0 - reserve0_;
        uint256 amount1 = balance1 - reserve1_;
        uint256 supply = totalSupply();

        if (supply == 0) {
            liquidity = (amount0 * amount1).sqrt() - MINIMUM_LIQUIDITY;
            _mint(address(1), MINIMUM_LIQUIDITY);
        } else {
            liquidity = FixedPointMathLib.min(amount0 * supply / reserve0_, amount1 * supply / reserve1_);
        }
        if (liquidity == 0) revert InsufficientLiquidityMinted();

        _mint(to, liquidity);
        _update(balance0, balance1, reserve0_, reserve1_);
        emit Mint(msg.sender, amount0, amount1);
    }

    function burn(address to) external nonReentrant returns (uint256 amount0, uint256 amount1) {
        if (to == address(0)) revert InvalidAddress();

        (uint112 reserve0_, uint112 reserve1_,) = getReserves();
        address token0_ = token0;
        address token1_ = token1;
        uint256 balance0 = _balance(token0_);
        uint256 balance1 = _balance(token1_);
        uint256 liquidity = balanceOf(address(this));
        uint256 supply = totalSupply();

        amount0 = liquidity * balance0 / supply;
        amount1 = liquidity * balance1 / supply;
        if (amount0 == 0 || amount1 == 0) revert InsufficientLiquidityBurned();

        _burn(address(this), liquidity);
        token0_.safeTransfer(to, amount0);
        token1_.safeTransfer(to, amount1);

        balance0 = _balance(token0_);
        balance1 = _balance(token1_);
        _update(balance0, balance1, reserve0_, reserve1_);
        emit Burn(msg.sender, amount0, amount1, to);
    }

    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external nonReentrant {
        if (amount0Out == 0 && amount1Out == 0) revert InsufficientOutputAmount();
        SwapCache memory cache;
        (cache.reserve0, cache.reserve1,) = getReserves();
        if (amount0Out >= cache.reserve0 || amount1Out >= cache.reserve1) revert InsufficientLiquidity();
        if (to == token0 || to == token1 || to == address(0)) revert InvalidRecipient();

        if (amount0Out != 0) token0.safeTransfer(to, amount0Out);
        if (amount1Out != 0) token1.safeTransfer(to, amount1Out);
        if (data.length != 0) IAmmCallee(to).ammCall(msg.sender, amount0Out, amount1Out, data);

        cache.balance0 = _balance(token0);
        cache.balance1 = _balance(token1);
        cache.amount0In =
            cache.balance0 > cache.reserve0 - amount0Out ? cache.balance0 - (cache.reserve0 - amount0Out) : 0;
        cache.amount1In =
            cache.balance1 > cache.reserve1 - amount1Out ? cache.balance1 - (cache.reserve1 - amount1Out) : 0;
        if (cache.amount0In == 0 && cache.amount1In == 0) revert InsufficientInputAmount();

        cache.balance0 -= _accrueFee(token0, cache.amount0In, true);
        cache.balance1 -= _accrueFee(token1, cache.amount1In, false);

        if (cache.balance0 * cache.balance1 < uint256(cache.reserve0) * uint256(cache.reserve1)) revert KInvariant();

        _update(cache.balance0, cache.balance1, cache.reserve0, cache.reserve1);
        emit Swap(msg.sender, cache.amount0In, cache.amount1In, amount0Out, amount1Out, to);
    }

    function claimFees() external nonReentrant returns (uint256 claimed0, uint256 claimed1) {
        _updateFor(msg.sender);

        claimed0 = claimable0[msg.sender];
        claimed1 = claimable1[msg.sender];
        if (claimed0 != 0) claimable0[msg.sender] = 0;
        if (claimed1 != 0) claimable1[msg.sender] = 0;

        if (claimed0 != 0 || claimed1 != 0) {
            PoolFees(poolFees).claimFeesFor(msg.sender, claimed0, claimed1);
        }

        emit FeesClaimed(msg.sender, claimed0, claimed1);
    }

    function _beforeTokenTransfer(address from, address to, uint256) internal override {
        if (from != address(0)) _updateFor(from);
        if (to != address(0)) _updateFor(to);
    }

    function _updateFor(address owner) internal {
        uint256 ownerBalance = balanceOf(owner);

        uint256 currentIndex0 = index0;
        uint256 suppliedIndex0 = supplyIndex0[owner];
        if (suppliedIndex0 != currentIndex0) {
            if (ownerBalance != 0) {
                claimable0[owner] += ownerBalance * (currentIndex0 - suppliedIndex0) / FEE_INDEX_SCALE;
            }
            supplyIndex0[owner] = currentIndex0;
        }

        uint256 currentIndex1 = index1;
        uint256 suppliedIndex1 = supplyIndex1[owner];
        if (suppliedIndex1 != currentIndex1) {
            if (ownerBalance != 0) {
                claimable1[owner] += ownerBalance * (currentIndex1 - suppliedIndex1) / FEE_INDEX_SCALE;
            }
            supplyIndex1[owner] = currentIndex1;
        }
    }

    function _accrueFee(address token, uint256 amountIn, bool zeroForOne) internal returns (uint256 debitedFee) {
        if (amountIn == 0) return 0;

        uint256 denominator = AmmFactory(factory).FEE_DENOMINATOR();
        debitedFee = amountIn * AmmFactory(factory).SWAP_FEE_BPS() / denominator;
        if (debitedFee == 0) return 0;

        uint256 feeBalanceBefore = ERC20(token).balanceOf(poolFees);
        token.safeTransfer(poolFees, debitedFee);
        uint256 feeBalanceAfter = ERC20(token).balanceOf(poolFees);
        if (feeBalanceAfter < feeBalanceBefore) revert UnexpectedFeeTransfer(token, debitedFee, 0);

        uint256 receivedFee = feeBalanceAfter - feeBalanceBefore;
        uint256 supply = totalSupply();
        if (supply != 0 && receivedFee != 0) {
            if (zeroForOne) {
                index0 += receivedFee * FEE_INDEX_SCALE / supply;
            } else {
                index1 += receivedFee * FEE_INDEX_SCALE / supply;
            }
        }
    }

    function _update(uint256 balance0, uint256 balance1, uint112 reserve0_, uint112 reserve1_) internal {
        if (balance0 > type(uint112).max || balance1 > type(uint112).max) revert ReserveOverflow();

        // casting to uint112 is safe because ReserveOverflow was checked above.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint112 nextReserve0 = uint112(balance0);
        // casting to uint112 is safe because ReserveOverflow was checked above.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint112 nextReserve1 = uint112(balance1);

        uint32 timestamp = _blockTimestamp();
        uint32 timeElapsed = timestamp - blockTimestampLast;
        if (timeElapsed != 0 && reserve0_ != 0 && reserve1_ != 0) {
            price0CumulativeLast += uint256(reserve1_) * FEE_INDEX_SCALE * timeElapsed / reserve0_;
            price1CumulativeLast += uint256(reserve0_) * FEE_INDEX_SCALE * timeElapsed / reserve1_;
        }
        if (timeElapsed != 0) {
            observations.push(
                Observation(timestamp, price0CumulativeLast, price1CumulativeLast, nextReserve0, nextReserve1)
            );
        }

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
            if (targetTimestamp >= observation.timestamp) {
                price0Cumulative = observation.price0Cumulative;
                price1Cumulative = observation.price1Cumulative;
                uint256 elapsed = targetTimestamp - observation.timestamp;
                if (elapsed != 0 && observation.reserve0 != 0 && observation.reserve1 != 0) {
                    price0Cumulative += uint256(observation.reserve1) * FEE_INDEX_SCALE * elapsed / observation.reserve0;
                    price1Cumulative += uint256(observation.reserve0) * FEE_INDEX_SCALE * elapsed / observation.reserve1;
                }
                return (price0Cumulative, price1Cumulative);
            }
        }

        Observation memory first = observations[0];
        return (first.price0Cumulative, first.price1Cumulative);
    }

    function _balance(address token) internal view returns (uint256) {
        return ERC20(token).balanceOf(address(this));
    }

    function _blockTimestamp() internal view returns (uint32) {
        return uint32(block.timestamp % 2 ** 32);
    }
}
