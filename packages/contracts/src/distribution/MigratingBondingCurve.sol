// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "solady/tokens/ERC20.sol";
import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";
import {Initializable} from "solady/utils/Initializable.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {ExactTransferLib} from "../lib/ExactTransferLib.sol";
import {BestEffortTokenLib} from "../lib/BestEffortTokenLib.sol";
import {LockedLiquidityFactory} from "../liquidity/LockedLiquidityFactory.sol";

interface IMigratingBondingCurveBoardroom {
    function status() external view returns (uint8);
    function recordLockedLiquidityFromDistribution(address locker, address pool) external;
}

contract MigratingBondingCurve is Initializable, ReentrancyGuard {
    using SafeTransferLib for address;

    uint8 internal constant BOARDROOM_STATUS_ACTIVE = 0;
    uint256 internal constant WAD = 1e18;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant MINIMUM_MIGRATION_FILL_BPS = 9_500;
    uint256 internal constant AMM_MINIMUM_LIQUIDITY = 1_000;
    uint256 public constant MAX_CURVE_SUPPLY = type(uint112).max;

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
    uint256 public accountedQuoteReserve;
    uint256 public basePrice;
    uint256 public slope;
    uint256 public graduationQuoteTarget;
    uint16 public quoteToLpBps;
    uint64 public startTime;
    uint64 public endTime;
    bytes32 public migrationSalt;
    CurveStatus public curveStatus;
    bool public graduationLatched;
    bool public quoteQuarantined;
    uint256 public unrecoveredQuote;

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
    error InvalidQuoteAsset(address asset);
    error InvalidMigrationConfiguration();
    error MigrationMinimumTooLow(uint256 provided, uint256 required);
    error GraduationLatched();
    error QuoteNotQuarantined();

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
    event CurveGraduationLatched(uint256 quoteReserve, uint256 remainingShares);
    event CurveQuoteQuarantined(
        uint256 expectedQuote,
        uint256 observedQuote,
        uint256 returnedQuote,
        uint256 unrecoveredQuote,
        bool balanceReadable
    );
    event CurveQuoteRecovered(uint256 returnedQuote, uint256 unrecoveredQuote, bool balanceReadable);

    constructor() {
        _disableInitializers();
    }

    function initialize(address boardroom_, address lockedLiquidityFactory_, CreateParams calldata params)
        external
        initializer
    {
        _requireValidCreateParams(boardroom_, lockedLiquidityFactory_, params);

        factory = msg.sender;
        boardroom = boardroom_;
        lockedLiquidityFactory = lockedLiquidityFactory_;
        shareToken = params.shareToken;
        quoteToken = params.quoteToken;
        saleSupply = params.saleSupply;
        migrationSupply = params.migrationSupply;
        remainingSaleShares = params.saleSupply;
        accountedQuoteReserve = 0;
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
        _requireBuyableShares(recipient, shareAmount);

        quoteIn = getBuyQuote(shareAmount);
        if (quoteIn > maxQuoteIn) revert SlippageExceeded(quoteIn, maxQuoteIn);

        remainingSaleShares -= shareAmount;
        sellableSharesBy[recipient] += shareAmount;
        accountedQuoteReserve += quoteIn;
        _checkedTransferFrom(quoteToken, msg.sender, address(this), quoteIn);
        _checkedTransfer(shareToken, recipient, shareAmount);
        _latchGraduationIfReady();

        emit CurveBuy(msg.sender, recipient, shareAmount, quoteIn);
    }

    function sell(uint256 shareAmount, address recipient, uint256 minQuoteOut, uint256 deadline)
        external
        nonReentrant
        returns (uint256 quoteOut)
    {
        _requireActiveBoardroom();
        _requireCurveActive();
        if (graduationLatched) revert GraduationLatched();
        if (deadline < block.timestamp) revert Expired();

        uint256 sellerSellableShares = _requireSellableShares(recipient, shareAmount);
        uint256 currentlySold = soldShares();
        if (shareAmount > currentlySold) revert InsufficientShares(shareAmount, currentlySold);

        quoteOut = getSellQuote(shareAmount);
        if (quoteOut < minQuoteOut) revert SlippageExceeded(quoteOut, minQuoteOut);
        uint256 reserve = accountedQuoteReserve;
        if (quoteOut > reserve) revert InsufficientQuote(reserve, quoteOut);

        remainingSaleShares += shareAmount;
        sellableSharesBy[msg.sender] = sellerSellableShares - shareAmount;
        accountedQuoteReserve = reserve - quoteOut;
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
        _requireActiveBoardroom();
        _requireCurveActive();
        if (deadline < block.timestamp) revert Expired();
        _requireMigrationReady();

        curveStatus = CurveStatus.Migrated;
        uint256 sharesToLiquidity = migrationSupply + remainingSaleShares;
        uint256 quoteBalance = accountedQuoteReserve;
        uint256 quoteToLiquidity = _quoteToLiquidity(quoteBalance);
        _requireMigrationLiquidity(sharesToLiquidity, quoteToLiquidity, minShareLiquidity, minQuoteLiquidity);

        remainingSaleShares = 0;

        (createdLocker, createdPool, amountA, amountB, liquidity) =
            _createLockedLiquidity(sharesToLiquidity, quoteToLiquidity, minShareLiquidity, minQuoteLiquidity, deadline);

        locker = createdLocker;
        pool = createdPool;
        IMigratingBondingCurveBoardroom(boardroom).recordLockedLiquidityFromDistribution(createdLocker, createdPool);

        uint256 expectedQuoteRemainder = quoteBalance - quoteToLiquidity;
        accountedQuoteReserve = 0;
        _returnCanonicalShares();
        uint256 quoteRemainder = _returnQuoteOrQuarantine(expectedQuoteRemainder);

        emit CurveMigrated(createdLocker, createdPool, amountA, amountB, liquidity, quoteRemainder);
    }

    function cancel() external nonReentrant onlyBoardroom {
        _requireCurveActive();
        curveStatus = CurveStatus.Cancelled;
        remainingSaleShares = 0;
        uint256 expectedQuote = accountedQuoteReserve;
        accountedQuoteReserve = 0;

        LockedLiquidityFactory(lockedLiquidityFactory)
            .releaseMigrationReservation(boardroom, shareToken, quoteToken, migrationSalt);

        uint256 shareBalance = _returnCanonicalShares();
        uint256 quoteBalance = _returnQuoteOrQuarantine(expectedQuote);

        emit CurveCancelled(shareBalance, quoteBalance);
    }

    /// @notice Retries recovery of quote assets left in a closed curve after a token failure.
    /// @dev Anyone may call; recovered value can only be sent to the issuing Boardroom.
    function recoverQuarantinedQuote() external nonReentrant returns (uint256 returnedQuote) {
        if (curveStatus == CurveStatus.Active || !quoteQuarantined) revert QuoteNotQuarantined();
        uint256 expectedQuote = unrecoveredQuote;
        returnedQuote = _returnQuoteOrQuarantine(expectedQuote);
        (bool balanceReadable,) = _tryBalanceOf(quoteToken, address(this));
        emit CurveQuoteRecovered(returnedQuote, unrecoveredQuote, balanceReadable);
    }

    function isClosed() external view returns (bool) {
        return curveStatus != CurveStatus.Active;
    }

    function canMigrate() public view returns (bool) {
        if (curveStatus != CurveStatus.Active || !graduationLatched) return false;
        return _migrationAmountsFitAmm(accountedQuoteReserve, remainingSaleShares);
    }

    function soldShares() public view returns (uint256) {
        return saleSupply - remainingSaleShares;
    }

    function quoteReserve() public view returns (uint256) {
        return accountedQuoteReserve;
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
        if (graduationLatched) revert GraduationLatched();
        if (deadline < block.timestamp) revert Expired();
        if (!_isWithinBuyWindow()) revert BuyWindowClosed();
    }

    function _requireValidCreateParams(
        address boardroom_,
        address lockedLiquidityFactory_,
        CreateParams calldata params
    ) internal view {
        _requireValidCreateAddresses(boardroom_, lockedLiquidityFactory_, params);
        if (params.quoteToLpBps == 0 || params.quoteToLpBps > BPS) revert InvalidBasisPoints();
        _requireValidCurveParameters(params);
        if (params.endTime != 0 && (params.endTime <= params.startTime || uint256(params.endTime) <= block.timestamp)) {
            revert InvalidTimeWindow();
        }
    }

    function _requireValidCreateAddresses(
        address boardroom_,
        address lockedLiquidityFactory_,
        CreateParams calldata params
    ) internal view {
        if (
            boardroom_ == address(0) || lockedLiquidityFactory_ == address(0) || params.shareToken == address(0)
                || params.quoteToken == address(0) || params.shareToken == params.quoteToken
        ) {
            revert InvalidAddress();
        }
        if (!_isAsset(params.quoteToken)) revert InvalidQuoteAsset(params.quoteToken);
    }

    function _requireValidCurveParameters(CreateParams calldata params) internal pure {
        if (
            params.saleSupply == 0 || params.migrationSupply == 0 || params.basePrice == 0
                || params.graduationQuoteTarget == 0 || params.saleSupply > MAX_CURVE_SUPPLY
                || params.migrationSupply > MAX_CURVE_SUPPLY - params.saleSupply || params.basePrice > type(uint112).max
                || params.slope > type(uint112).max
        ) {
            revert InvalidAmount();
        }

        uint256 fullSaleQuote = _curveIntegralForParams(params, 0, params.saleSupply);
        uint256 fullSaleQuoteToLiquidity = FixedPointMathLib.fullMulDiv(fullSaleQuote, params.quoteToLpBps, BPS);
        uint256 minimumShares = _minimumMigrationFill(params.migrationSupply);
        uint256 minimumQuote = _minimumMigrationFill(fullSaleQuoteToLiquidity);
        if (
            fullSaleQuoteToLiquidity == 0 || fullSaleQuoteToLiquidity > type(uint112).max
                || FixedPointMathLib.sqrt(minimumShares * minimumQuote) <= AMM_MINIMUM_LIQUIDITY
        ) {
            revert InvalidMigrationConfiguration();
        }
    }

    function _requireBuyableShares(address recipient, uint256 shareAmount) internal view {
        if (recipient == address(0)) revert InvalidAddress();
        if (shareAmount == 0) revert InvalidAmount();
        if (shareAmount > remainingSaleShares) revert InsufficientShares(shareAmount, remainingSaleShares);
    }

    function _requireSellableShares(address recipient, uint256 shareAmount)
        internal
        view
        returns (uint256 sellerSellableShares)
    {
        if (recipient == address(0)) revert InvalidAddress();
        if (shareAmount == 0) revert InvalidAmount();

        sellerSellableShares = sellableSharesBy[msg.sender];
        if (shareAmount > sellerSellableShares) {
            revert InsufficientSellableShares(msg.sender, shareAmount, sellerSellableShares);
        }
    }

    function _requireMigrationReady() internal view {
        if (!canMigrate()) {
            revert MigrationNotReady(accountedQuoteReserve, graduationQuoteTarget, remainingSaleShares);
        }
    }

    function _requireMigrationLiquidity(
        uint256 sharesToLiquidity,
        uint256 quoteToLiquidity,
        uint256 minShareLiquidity,
        uint256 minQuoteLiquidity
    ) internal pure {
        if (sharesToLiquidity == 0 || quoteToLiquidity == 0) revert InvalidAmount();
        uint256 requiredShareMinimum = _minimumMigrationFill(sharesToLiquidity);
        uint256 requiredQuoteMinimum = _minimumMigrationFill(quoteToLiquidity);
        if (minShareLiquidity < requiredShareMinimum) {
            revert MigrationMinimumTooLow(minShareLiquidity, requiredShareMinimum);
        }
        if (minQuoteLiquidity < requiredQuoteMinimum) {
            revert MigrationMinimumTooLow(minQuoteLiquidity, requiredQuoteMinimum);
        }
        if (sharesToLiquidity < minShareLiquidity) revert SlippageExceeded(sharesToLiquidity, minShareLiquidity);
        if (quoteToLiquidity < minQuoteLiquidity) revert SlippageExceeded(quoteToLiquidity, minQuoteLiquidity);
    }

    function _createLockedLiquidity(
        uint256 sharesToLiquidity,
        uint256 quoteToLiquidity,
        uint256 minShareLiquidity,
        uint256 minQuoteLiquidity,
        uint256 deadline
    )
        internal
        returns (address createdLocker, address createdPool, uint256 amountA, uint256 amountB, uint256 liquidity)
    {
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
    }

    function _returnCanonicalShares() internal returns (uint256 shareBalance) {
        shareBalance = ERC20(shareToken).balanceOf(address(this));
        if (shareBalance != 0) _checkedTransfer(shareToken, boardroom, shareBalance);
    }

    function _returnQuoteOrQuarantine(uint256 expectedQuote) internal returns (uint256 returnedQuote) {
        (bool balanceReadable, uint256 observedQuote) = _tryBalanceOf(quoteToken, address(this));
        uint256 remainingQuote = observedQuote;

        if (balanceReadable && observedQuote != 0) {
            (returnedQuote, remainingQuote, balanceReadable) = _tryReturnQuote(observedQuote);
        }

        uint256 shortfall = expectedQuote > returnedQuote ? expectedQuote - returnedQuote : 0;
        uint256 unrecovered = shortfall > remainingQuote ? shortfall : remainingQuote;
        quoteQuarantined = !balanceReadable || unrecovered != 0;
        unrecoveredQuote = unrecovered;

        if (quoteQuarantined) {
            emit CurveQuoteQuarantined(expectedQuote, observedQuote, returnedQuote, unrecoveredQuote, balanceReadable);
        }
    }

    function _tryReturnQuote(uint256 amount)
        internal
        returns (uint256 returnedQuote, uint256 remainingQuote, bool verified)
    {
        (bool senderBeforeReadable, uint256 senderBefore) = _tryBalanceOf(quoteToken, address(this));
        (bool recipientBeforeReadable, uint256 recipientBefore) = _tryBalanceOf(quoteToken, boardroom);
        if (!senderBeforeReadable || !recipientBeforeReadable || senderBefore < amount) {
            return (0, senderBefore, false);
        }

        bool callSucceeded = BestEffortTokenLib.tryTransfer(quoteToken, boardroom, amount);
        if (!callSucceeded) return (0, senderBefore, true);

        (bool senderAfterReadable, uint256 senderAfter) = _tryBalanceOf(quoteToken, address(this));
        (bool recipientAfterReadable, uint256 recipientAfter) = _tryBalanceOf(quoteToken, boardroom);
        if (!senderAfterReadable || !recipientAfterReadable) return (0, senderBefore, false);

        if (recipientAfter >= recipientBefore) returnedQuote = recipientAfter - recipientBefore;
        remainingQuote = senderAfter;
        verified = true;
    }

    function _tryBalanceOf(address asset, address account) internal view returns (bool readable, uint256 balance) {
        return BestEffortTokenLib.tryBalanceOf(asset, account);
    }

    function _isAsset(address asset) internal view returns (bool) {
        (bool readable,) = _tryBalanceOf(asset, address(this));
        return readable;
    }

    function _quoteToLiquidity(uint256 quoteBalance) internal view returns (uint256) {
        return FixedPointMathLib.fullMulDiv(quoteBalance, quoteToLpBps, BPS);
    }

    function _isWithinBuyWindow() internal view returns (bool) {
        return block.timestamp >= startTime && (endTime == 0 || block.timestamp <= endTime);
    }

    function _latchGraduationIfReady() internal {
        if (graduationLatched) return;
        uint256 reserve = accountedQuoteReserve;
        if (reserve < graduationQuoteTarget && remainingSaleShares != 0) return;
        if (!_migrationAmountsFitAmm(reserve, remainingSaleShares)) return;

        graduationLatched = true;
        emit CurveGraduationLatched(reserve, remainingSaleShares);
    }

    function _migrationAmountsFitAmm(uint256 quoteBalance, uint256 remainingShares) internal view returns (bool) {
        uint256 sharesToLiquidity = migrationSupply + remainingShares;
        uint256 quoteToLiquidity = _quoteToLiquidity(quoteBalance);
        uint256 minimumShares = _minimumMigrationFill(sharesToLiquidity);
        uint256 minimumQuote = _minimumMigrationFill(quoteToLiquidity);
        return sharesToLiquidity != 0 && sharesToLiquidity <= type(uint112).max && quoteToLiquidity != 0
            && quoteToLiquidity <= type(uint112).max
            && FixedPointMathLib.sqrt(minimumShares * minimumQuote) > AMM_MINIMUM_LIQUIDITY;
    }

    function _minimumMigrationFill(uint256 desiredAmount) internal pure returns (uint256) {
        return FixedPointMathLib.fullMulDivUp(desiredAmount, MINIMUM_MIGRATION_FILL_BPS, BPS);
    }

    function _curveIntegralUp(uint256 soldBefore, uint256 shareAmount) internal view returns (uint256) {
        uint256 linearQuote = FixedPointMathLib.fullMulDivUp(basePrice, shareAmount, WAD);
        uint256 slopeQuote =
            FixedPointMathLib.fullMulDivUp(slope, _slopeNumerator(soldBefore, shareAmount), 2 * WAD * WAD);
        return linearQuote + slopeQuote;
    }

    function _curveIntegralForParams(CreateParams calldata params, uint256 soldBefore, uint256 shareAmount)
        internal
        pure
        returns (uint256)
    {
        uint256 linearQuote = FixedPointMathLib.fullMulDivUp(params.basePrice, shareAmount, WAD);
        uint256 slopeNumerator = shareAmount * (soldBefore * 2 + shareAmount);
        uint256 slopeQuote = FixedPointMathLib.fullMulDivUp(params.slope, slopeNumerator, 2 * WAD * WAD);
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
