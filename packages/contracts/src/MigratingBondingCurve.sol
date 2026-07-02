// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "solady/tokens/ERC20.sol";
import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";
import {Initializable} from "solady/utils/Initializable.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {ExactTransferLib} from "./ExactTransferLib.sol";
import {LockedLiquidityFactory} from "./LockedLiquidityFactory.sol";

interface IMigratingBondingCurveBoardroom {
    function status() external view returns (uint8);
    function recordLockedLiquidityFromDistribution(address locker, address pool) external;
}

contract MigratingBondingCurve is Initializable, ReentrancyGuard {
    using SafeTransferLib for address;

    uint8 internal constant BOARDROOM_STATUS_ACTIVE = 0;
    uint256 internal constant WAD = 1e18;
    uint256 internal constant BPS = 10_000;
    uint256 public constant MAX_CURVE_SUPPLY = 1e36;

    enum CurveStatus {
        Active,
        Migrated,
        Cancelled
    }

    struct CreateParams {
        address shareToken;
        address quoteToken;
        uint256 saleSupply;
        uint256 migrationSupply;
        uint256 basePrice;
        uint256 slope;
        uint256 graduationQuoteTarget;
        uint16 quoteToLpBps;
        uint64 startTime;
        uint64 endTime;
        bytes32 migrationSalt;
        bytes32 salt;
    }

    address public factory;
    address public boardroom;
    address public lockedLiquidityFactory;
    address public shareToken;
    address public quoteToken;
    address public locker;
    address public pool;
    uint256 public saleSupply;
    uint256 public migrationSupply;
    uint256 public remainingSaleShares;
    uint256 public basePrice;
    uint256 public slope;
    uint256 public graduationQuoteTarget;
    uint16 public quoteToLpBps;
    uint64 public startTime;
    uint64 public endTime;
    bytes32 public migrationSalt;
    CurveStatus public curveStatus;

    mapping(address => uint256) public sellableSharesBy;

    error InvalidAddress();
    error InvalidAmount();
    error InvalidBasisPoints();
    error InvalidTimeWindow();
    error OnlyBoardroom();
    error CurveNotActive();
    error BuyWindowClosed();
    error BoardroomNotActive();
    error Expired();
    error InsufficientShares(uint256 requested, uint256 available);
    error InsufficientSellableShares(address seller, uint256 requested, uint256 available);
    error InsufficientQuote(uint256 available, uint256 required);
    error SlippageExceeded(uint256 actual, uint256 bound);
    error MigrationNotReady(uint256 quoteReserve, uint256 target, uint256 remainingShares);
    error UnexpectedTokenBalanceChange(address token, uint256 expected, uint256 actual);

    event MigratingBondingCurveInitialized(
        address indexed boardroom,
        address indexed shareToken,
        address indexed quoteToken,
        uint256 saleSupply,
        uint256 migrationSupply,
        uint256 basePrice,
        uint256 slope,
        uint256 graduationQuoteTarget,
        uint16 quoteToLpBps,
        uint64 startTime,
        uint64 endTime,
        bytes32 migrationSalt,
        bytes32 salt
    );
    event CurveBuy(address indexed buyer, address indexed recipient, uint256 shares, uint256 quotePaid);
    event CurveSell(address indexed seller, address indexed recipient, uint256 shares, uint256 quoteReturned);
    event CurveMigrated(
        address indexed locker,
        address indexed pool,
        uint256 sharesToLiquidity,
        uint256 quoteToLiquidity,
        uint256 liquidity,
        uint256 quoteToBoardroom
    );
    event CurveCancelled(uint256 returnedShares, uint256 returnedQuote);

    constructor() {
        _disableInitializers();
    }

    function initialize(address boardroom_, address lockedLiquidityFactory_, CreateParams calldata params)
        external
        initializer
    {
        if (
            boardroom_ == address(0) || lockedLiquidityFactory_ == address(0) || params.shareToken == address(0)
                || params.quoteToken == address(0) || params.shareToken == params.quoteToken
        ) {
            revert InvalidAddress();
        }
        if (
            params.saleSupply == 0 || params.migrationSupply == 0 || params.basePrice == 0
                || params.graduationQuoteTarget == 0 || params.saleSupply + params.migrationSupply > MAX_CURVE_SUPPLY
        ) {
            revert InvalidAmount();
        }
        if (params.quoteToLpBps == 0 || params.quoteToLpBps > BPS) revert InvalidBasisPoints();
        if (params.endTime != 0 && params.endTime < params.startTime) revert InvalidTimeWindow();

        factory = msg.sender;
        boardroom = boardroom_;
        lockedLiquidityFactory = lockedLiquidityFactory_;
        shareToken = params.shareToken;
        quoteToken = params.quoteToken;
        saleSupply = params.saleSupply;
        migrationSupply = params.migrationSupply;
        remainingSaleShares = params.saleSupply;
        basePrice = params.basePrice;
        slope = params.slope;
        graduationQuoteTarget = params.graduationQuoteTarget;
        quoteToLpBps = params.quoteToLpBps;
        startTime = params.startTime;
        endTime = params.endTime;
        migrationSalt = params.migrationSalt;
        curveStatus = CurveStatus.Active;

        emit MigratingBondingCurveInitialized(
            boardroom_,
            params.shareToken,
            params.quoteToken,
            params.saleSupply,
            params.migrationSupply,
            params.basePrice,
            params.slope,
            params.graduationQuoteTarget,
            params.quoteToLpBps,
            params.startTime,
            params.endTime,
            params.migrationSalt,
            params.salt
        );
    }

    function buy(uint256 shareAmount, address recipient, uint256 maxQuoteIn, uint256 deadline)
        external
        nonReentrant
        returns (uint256 quoteIn)
    {
        _requireActiveBoardroom();
        _requireBuyOpen(deadline);
        if (recipient == address(0)) revert InvalidAddress();
        if (shareAmount == 0) revert InvalidAmount();
        if (shareAmount > remainingSaleShares) revert InsufficientShares(shareAmount, remainingSaleShares);

        quoteIn = getBuyQuote(shareAmount);
        if (quoteIn > maxQuoteIn) revert SlippageExceeded(quoteIn, maxQuoteIn);

        remainingSaleShares -= shareAmount;
        sellableSharesBy[recipient] += shareAmount;
        _checkedTransferFrom(quoteToken, msg.sender, address(this), quoteIn);
        _checkedTransfer(shareToken, recipient, shareAmount);

        emit CurveBuy(msg.sender, recipient, shareAmount, quoteIn);
    }

    function sell(uint256 shareAmount, address recipient, uint256 minQuoteOut, uint256 deadline)
        external
        nonReentrant
        returns (uint256 quoteOut)
    {
        _requireActiveBoardroom();
        _requireCurveActive();
        if (deadline < block.timestamp) revert Expired();
        if (recipient == address(0)) revert InvalidAddress();
        if (shareAmount == 0) revert InvalidAmount();

        uint256 sellerSellableShares = sellableSharesBy[msg.sender];
        if (shareAmount > sellerSellableShares) {
            revert InsufficientSellableShares(msg.sender, shareAmount, sellerSellableShares);
        }
        uint256 currentlySold = soldShares();
        if (shareAmount > currentlySold) revert InsufficientShares(shareAmount, currentlySold);

        quoteOut = getSellQuote(shareAmount);
        if (quoteOut < minQuoteOut) revert SlippageExceeded(quoteOut, minQuoteOut);
        uint256 reserve = quoteReserve();
        if (quoteOut > reserve) revert InsufficientQuote(reserve, quoteOut);

        remainingSaleShares += shareAmount;
        sellableSharesBy[msg.sender] = sellerSellableShares - shareAmount;
        _checkedTransferFrom(shareToken, msg.sender, address(this), shareAmount);
        _checkedTransfer(quoteToken, recipient, quoteOut);

        emit CurveSell(msg.sender, recipient, shareAmount, quoteOut);
    }

    function migrate(uint256 minShareLiquidity, uint256 minQuoteLiquidity, uint256 deadline)
        external
        nonReentrant
        onlyBoardroom
        returns (address createdLocker, address createdPool, uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        _requireCurveActive();
        if (deadline < block.timestamp) revert Expired();
        if (!canMigrate()) {
            revert MigrationNotReady(quoteReserve(), graduationQuoteTarget, remainingSaleShares);
        }

        curveStatus = CurveStatus.Migrated;
        uint256 sharesToLiquidity = migrationSupply + remainingSaleShares;
        uint256 quoteBalance = quoteReserve();
        uint256 quoteToLiquidity = quoteBalance * quoteToLpBps / BPS;
        if (sharesToLiquidity == 0 || quoteToLiquidity == 0) revert InvalidAmount();
        if (sharesToLiquidity < minShareLiquidity) revert SlippageExceeded(sharesToLiquidity, minShareLiquidity);
        if (quoteToLiquidity < minQuoteLiquidity) revert SlippageExceeded(quoteToLiquidity, minQuoteLiquidity);

        remainingSaleShares = 0;

        shareToken.safeApprove(lockedLiquidityFactory, sharesToLiquidity);
        quoteToken.safeApprove(lockedLiquidityFactory, quoteToLiquidity);
        (createdLocker, createdPool, amountA, amountB, liquidity) = LockedLiquidityFactory(lockedLiquidityFactory)
            .createLockedLiquidityForBoardroom(
                boardroom,
                LockedLiquidityFactory.CreateParams({
                tokenA: shareToken,
                tokenB: quoteToken,
                amountADesired: sharesToLiquidity,
                amountBDesired: quoteToLiquidity,
                amountAMin: minShareLiquidity,
                amountBMin: minQuoteLiquidity,
                deadline: deadline,
                salt: migrationSalt
            })
            );
        if (createdLocker == address(0) || createdPool == address(0)) revert InvalidAddress();
        shareToken.safeApprove(lockedLiquidityFactory, 0);
        quoteToken.safeApprove(lockedLiquidityFactory, 0);

        locker = createdLocker;
        pool = createdPool;
        IMigratingBondingCurveBoardroom(boardroom).recordLockedLiquidityFromDistribution(createdLocker, createdPool);

        uint256 shareRemainder = ERC20(shareToken).balanceOf(address(this));
        uint256 quoteRemainder = ERC20(quoteToken).balanceOf(address(this));
        if (shareRemainder != 0) _checkedTransfer(shareToken, boardroom, shareRemainder);
        if (quoteRemainder != 0) _checkedTransfer(quoteToken, boardroom, quoteRemainder);

        emit CurveMigrated(createdLocker, createdPool, amountA, amountB, liquidity, quoteRemainder);
    }

    function cancel() external nonReentrant onlyBoardroom {
        _requireCurveActive();
        curveStatus = CurveStatus.Cancelled;
        remainingSaleShares = 0;

        uint256 shareBalance = ERC20(shareToken).balanceOf(address(this));
        uint256 quoteBalance = ERC20(quoteToken).balanceOf(address(this));
        if (shareBalance != 0) _checkedTransfer(shareToken, boardroom, shareBalance);
        if (quoteBalance != 0) _checkedTransfer(quoteToken, boardroom, quoteBalance);

        emit CurveCancelled(shareBalance, quoteBalance);
    }

    function isClosed() external view returns (bool) {
        return curveStatus != CurveStatus.Active;
    }

    function canMigrate() public view returns (bool) {
        return
            curveStatus == CurveStatus.Active && (quoteReserve() >= graduationQuoteTarget || remainingSaleShares == 0);
    }

    function soldShares() public view returns (uint256) {
        return saleSupply - remainingSaleShares;
    }

    function quoteReserve() public view returns (uint256) {
        return ERC20(quoteToken).balanceOf(address(this));
    }

    function getBuyQuote(uint256 shareAmount) public view returns (uint256) {
        if (shareAmount == 0) return 0;
        if (shareAmount > remainingSaleShares) revert InsufficientShares(shareAmount, remainingSaleShares);
        return _curveIntegralUp(soldShares(), shareAmount);
    }

    function getSellQuote(uint256 shareAmount) public view returns (uint256) {
        if (shareAmount == 0) return 0;
        uint256 currentlySold = soldShares();
        if (shareAmount > currentlySold) revert InsufficientShares(shareAmount, currentlySold);
        return _curveIntegralDown(currentlySold - shareAmount, shareAmount);
    }

    modifier onlyBoardroom() {
        if (msg.sender != boardroom) revert OnlyBoardroom();
        _;
    }

    function _requireCurveActive() internal view {
        if (curveStatus != CurveStatus.Active) revert CurveNotActive();
    }

    function _requireActiveBoardroom() internal view {
        if (IMigratingBondingCurveBoardroom(boardroom).status() != BOARDROOM_STATUS_ACTIVE) {
            revert BoardroomNotActive();
        }
    }

    function _requireBuyOpen(uint256 deadline) internal view {
        _requireCurveActive();
        if (deadline < block.timestamp) revert Expired();
        if (block.timestamp < startTime || (endTime != 0 && block.timestamp > endTime)) revert BuyWindowClosed();
    }

    function _curveIntegralUp(uint256 soldBefore, uint256 shareAmount) internal view returns (uint256) {
        uint256 linearQuote = FixedPointMathLib.fullMulDivUp(basePrice, shareAmount, WAD);
        uint256 slopeQuote =
            FixedPointMathLib.fullMulDivUp(slope, _slopeNumerator(soldBefore, shareAmount), 2 * WAD * WAD);
        return linearQuote + slopeQuote;
    }

    function _curveIntegralDown(uint256 soldBefore, uint256 shareAmount) internal view returns (uint256) {
        uint256 linearQuote = FixedPointMathLib.fullMulDiv(basePrice, shareAmount, WAD);
        uint256 slopeQuote =
            FixedPointMathLib.fullMulDiv(slope, _slopeNumerator(soldBefore, shareAmount), 2 * WAD * WAD);
        return linearQuote + slopeQuote;
    }

    function _slopeNumerator(uint256 soldBefore, uint256 shareAmount) internal pure returns (uint256) {
        return shareAmount * (soldBefore * 2 + shareAmount);
    }

    function _checkedTransfer(address token, address to, uint256 expectedAmount) internal {
        _requireExactBalanceChanges(token, expectedAmount, ExactTransferLib.sendFromSelfTo(token, to, expectedAmount));
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
        if (delta.senderBalanceIncreased) {
            revert UnexpectedTokenBalanceChange(token, expectedAmount, 0);
        }
        if (delta.senderSpent != expectedAmount) {
            revert UnexpectedTokenBalanceChange(token, expectedAmount, delta.senderSpent);
        }
        if (delta.recipientBalanceDecreased) {
            revert UnexpectedTokenBalanceChange(token, expectedAmount, 0);
        }
        if (delta.recipientReceived != expectedAmount) {
            revert UnexpectedTokenBalanceChange(token, expectedAmount, delta.recipientReceived);
        }
    }
}
