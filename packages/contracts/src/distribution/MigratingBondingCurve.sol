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
import {BoardroomCallbackLib} from "../policy/BoardroomCallbackLib.sol";

interface IMigratingBondingCurveBoardroom {
    function status() external view returns (uint8);
    function redemptionExcessRecipient() external view returns (address);
    function requireBondingCurveForfeitureVetoPower(address account) external view;
}

contract MigratingBondingCurve is Initializable, ReentrancyGuard {
    using SafeTransferLib for address;

    uint8 internal constant BOARDROOM_STATUS_ACTIVE = 0;
    uint8 internal constant BOARDROOM_STATUS_WINDING_DOWN = 1;
    uint8 internal constant BOARDROOM_STATUS_SNAPSHOTTING = 2;
    uint256 internal constant WAD = 1e18;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant MINIMUM_MIGRATION_FILL_BPS = 9_500;
    uint256 internal constant AMM_MINIMUM_LIQUIDITY = 1_000;

    uint256 public constant MAX_CURVE_SUPPLY = type(uint112).max;
    uint256 public constant MAX_CURVE_LIFETIME = 90 days;
    uint256 public constant MIGRATION_GRACE = 7 days;
    uint256 public constant SETTLEMENT_GRACE = 30 days;
    uint256 public constant QUARANTINE_FORFEITURE_DELAY = 30 days;
    uint256 public constant FORFEITURE_VETO_WINDOW = 7 days;
    uint256 public constant MAX_MIGRATION_PRICE_DEVIATION_BPS = 50;

    enum CurvePhase {
        Selling,
        Graduated,
        Unwinding,
        Migrated,
        Settled,
        Quarantined
    }

    enum SettlementReason {
        None,
        Cancelled,
        Expired,
        MigrationFailed
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

    /// @dev Migration seeding inputs, including the release hash bound by the migrating caller.
    struct MigrationSeed {
        bytes32 expectedFacetSetHash;
        uint256 sharesToLiquidity;
        uint256 quoteToLiquidity;
        uint256 minShareLiquidity;
        uint256 minQuoteLiquidity;
        uint256 deadline;
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
    /// @notice Global quantity of transferable shares that the curve is still obligated to buy back.
    /// @dev Fungible sell rights follow the token itself; they are never assigned to a purchase recipient.
    uint256 public outstandingCurveShareLiability;
    uint256 public accountedQuoteReserve;
    uint256 public basePrice;
    uint256 public slope;
    uint256 public graduationQuoteTarget;
    uint16 public quoteToLpBps;
    uint64 public startTime;
    uint64 public endTime;
    uint64 public phaseEndsAt;
    uint64 public quarantineStartedAt;
    uint64 public forfeitureEligibleAt;
    uint64 public forfeitureWindowEndsAt;
    bytes32 public migrationSalt;
    CurvePhase public curveStatus;
    CurvePhase public postQuarantinePhase;
    SettlementReason public settlementReason;
    bool public graduationLatched;
    bool public migrationInProgress;
    bool public migrationReservationHeld;
    bool public quoteQuarantined;
    bool public forfeitureFinalized;
    uint256 public unrecoveredQuote;
    uint256 public forfeitedQuote;

    error InvalidAddress();
    error InvalidAmount();
    error InvalidBasisPoints();
    error InvalidTimeWindow();
    error OnlyBoardroom();
    error InvalidCurvePhase(CurvePhase expected, CurvePhase actual);
    error BuyWindowClosed();
    error BoardroomNotActive();
    error BoardroomPastWindDown();
    error Expired();
    error GracePeriodActive(uint256 endsAt);
    error GracePeriodExpired(uint256 endedAt);
    error InsufficientShares(uint256 requested, uint256 available);
    error InsufficientSellableShares(address seller, uint256 requested, uint256 available);
    error InsufficientQuote(uint256 available, uint256 required);
    error SlippageExceeded(uint256 actual, uint256 bound);
    error MigrationNotReady(uint256 quoteReserve, uint256 target, uint256 remainingShares);
    error UnexpectedTokenBalanceChange(address token, uint256 expected, uint256 actual);
    error InvalidQuoteAsset(address asset);
    error InvalidMigrationConfiguration();
    error MigrationMinimumTooLow(uint256 provided, uint256 required);
    error MigrationPriceDeviation(uint256 actualPrice, uint256 terminalPrice, uint256 deviationBps);
    error QuoteNotQuarantined();
    error ForfeitureNotAvailable(uint256 availableAt);
    error ForfeitureWindowNotOpen();

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
    event CurvePhaseChanged(CurvePhase indexed phase, SettlementReason indexed reason, uint256 phaseEndsAt);
    event CurveMigrated(
        address indexed locker,
        address indexed pool,
        uint256 sharesToLiquidity,
        uint256 quoteToLiquidity,
        uint256 liquidity,
        uint256 quoteToBoardroom,
        uint256 terminalPrice
    );
    event CurveUnwindFinalized(uint256 returnedShares, uint256 returnedQuote, uint256 retainedHolderShares);
    event CurveGraduationLatched(uint256 quoteReserve, uint256 remainingShares, uint256 migrationEndsAt);
    event CurveQuoteQuarantined(
        uint256 expectedQuote,
        uint256 observedQuote,
        uint256 returnedQuote,
        uint256 unrecoveredQuote,
        bool balanceReadable
    );
    event CurveQuoteRecovered(
        address indexed recipient, uint256 returnedQuote, uint256 unrecoveredQuote, bool readable
    );
    event QuoteForfeitureOpened(uint256 indexed windowEndsAt);
    event QuoteForfeitureVetoed(address indexed staker, uint256 nextEligibleAt);
    event QuoteForfeitureFinalized(uint256 forfeitedQuote, CurvePhase terminalPhase);
    event ForfeitedQuoteRecovered(address indexed recipient, uint256 returnedQuote, bool readable);

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
        basePrice = params.basePrice;
        slope = params.slope;
        graduationQuoteTarget = params.graduationQuoteTarget;
        quoteToLpBps = params.quoteToLpBps;
        startTime = params.startTime;
        endTime = params.endTime;
        migrationSalt = params.migrationSalt;
        curveStatus = CurvePhase.Selling;
        migrationReservationHeld = true;

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
        outstandingCurveShareLiability += shareAmount;
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
        _requireBoardroomBeforeSnapshot();
        CurvePhase phase = curveStatus;
        if (phase != CurvePhase.Selling && phase != CurvePhase.Unwinding) {
            revert InvalidCurvePhase(CurvePhase.Unwinding, phase);
        }
        if (deadline < block.timestamp) revert Expired();
        if (phase == CurvePhase.Unwinding && block.timestamp > phaseEndsAt) {
            revert GracePeriodExpired(phaseEndsAt);
        }

        _requireSellableShares(recipient, shareAmount);
        uint256 currentlySold = outstandingCurveShareLiability;
        if (shareAmount > currentlySold) revert InsufficientShares(shareAmount, currentlySold);

        quoteOut = getSellQuote(shareAmount);
        if (quoteOut < minQuoteOut) revert SlippageExceeded(quoteOut, minQuoteOut);
        uint256 reserve = accountedQuoteReserve;
        if (quoteOut > reserve) revert InsufficientQuote(reserve, quoteOut);

        remainingSaleShares += shareAmount;
        outstandingCurveShareLiability = currentlySold - shareAmount;
        accountedQuoteReserve = reserve - quoteOut;
        _checkedTransferFrom(shareToken, msg.sender, address(this), shareAmount);
        _checkedTransfer(quoteToken, recipient, quoteOut);

        emit CurveSell(msg.sender, recipient, shareAmount, quoteOut);
    }

    /// @notice Permissionlessly migrates a graduated curve at the protocol-derived terminal price.
    /// @param expectedFacetSetHash Release the caller commits to; every Boardroom callback this
    /// transaction makes carries it, so an activation landing first reverts the whole migration.
    function migrate(
        bytes32 expectedFacetSetHash,
        uint256 minShareLiquidity,
        uint256 minQuoteLiquidity,
        uint256 deadline
    )
        external
        nonReentrant
        returns (address createdLocker, address createdPool, uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        _requireActiveBoardroom();
        if (deadline < block.timestamp) revert Expired();
        _requireMigrationReady();

        MigrationSeed memory seed = MigrationSeed({
            expectedFacetSetHash: expectedFacetSetHash,
            sharesToLiquidity: 0,
            quoteToLiquidity: 0,
            minShareLiquidity: minShareLiquidity,
            minQuoteLiquidity: minQuoteLiquidity,
            deadline: deadline
        });
        uint256 quoteBalance = accountedQuoteReserve;
        uint256 terminalPrice = terminalCurvePrice();
        seed.quoteToLiquidity = _quoteToLiquidity(quoteBalance);
        seed.sharesToLiquidity = FixedPointMathLib.fullMulDiv(seed.quoteToLiquidity, WAD, terminalPrice);
        uint256 availableShares = ERC20(shareToken).balanceOf(address(this));
        if (seed.sharesToLiquidity > availableShares) {
            revert InsufficientShares(seed.sharesToLiquidity, availableShares);
        }
        _requireMigrationLiquidity(
            seed.sharesToLiquidity, seed.quoteToLiquidity, seed.minShareLiquidity, seed.minQuoteLiquidity
        );

        migrationInProgress = true;
        phaseEndsAt = 0;
        remainingSaleShares = 0;
        outstandingCurveShareLiability = 0;
        accountedQuoteReserve = 0;

        (createdLocker, createdPool, amountA, amountB, liquidity) = _createLockedLiquidity(seed);
        _requireMigrationPrice(amountA, amountB, terminalPrice);

        locker = createdLocker;
        pool = createdPool;
        migrationReservationHeld = false;
        uint256 expectedQuoteRemainder = quoteBalance - seed.quoteToLiquidity;
        _returnCanonicalShares();
        uint256 quoteRemainder = _returnQuoteOrQuarantine(expectedQuoteRemainder, boardroom);
        if (quoteQuarantined) {
            _enterQuarantine(CurvePhase.Migrated);
        } else {
            curveStatus = CurvePhase.Migrated;
        }
        // Every external token/factory callback above may have changed Boardroom lifecycle state.
        // Migration is an Active-only atomic transition, so fail and roll the whole stack back if it did.
        _requireActiveBoardroom();
        migrationInProgress = false;

        BoardroomCallbackLib.recordLockedLiquidityFromDistribution(
            boardroom, seed.expectedFacetSetHash, createdLocker, createdPool
        );
        emit CurveMigrated(createdLocker, createdPool, amountA, amountB, liquidity, quoteRemainder, terminalPrice);
    }

    /// @notice Governance cancellation before graduation starts the same bounded sell-only unwind as expiry.
    function cancel() external nonReentrant onlyBoardroom {
        _requirePhase(CurvePhase.Selling);
        _beginUnwind(SettlementReason.Cancelled);
    }

    /// @notice Permissionlessly resolves a finished sale window; satisfied graduation always wins over expiry.
    function expire() external nonReentrant {
        _requirePhase(CurvePhase.Selling);
        if (block.timestamp <= endTime) revert GracePeriodActive(endTime);
        _latchGraduationIfReady();
        if (curveStatus == CurvePhase.Selling) _beginUnwind(SettlementReason.Expired);
    }

    /// @notice Permissionlessly reopens sell-only unwind after the immutable migration grace.
    function fallbackToUnwind() external nonReentrant {
        _requirePhase(CurvePhase.Graduated);
        uint8 boardroomStatus = IMigratingBondingCurveBoardroom(boardroom).status();
        if (block.timestamp <= phaseEndsAt) {
            revert GracePeriodActive(phaseEndsAt);
        }
        if (boardroomStatus > BOARDROOM_STATUS_WINDING_DOWN) revert BoardroomPastWindDown();
        _beginUnwind(SettlementReason.MigrationFailed);
    }

    /// @notice Finalizes a completed unwind without confiscating holder shares during its sell-only grace period.
    /// @param expectedFacetSetHash Release the caller commits to for the settlement callback.
    function finalizeUnwind(bytes32 expectedFacetSetHash) external nonReentrant {
        _requireBoardroomBeforeSnapshot();
        _requirePhase(CurvePhase.Unwinding);
        if (block.timestamp <= phaseEndsAt) revert GracePeriodActive(phaseEndsAt);

        uint256 retainedHolderShares = outstandingCurveShareLiability;
        outstandingCurveShareLiability = 0;
        remainingSaleShares = 0;
        uint256 expectedQuote = accountedQuoteReserve;
        accountedQuoteReserve = 0;
        phaseEndsAt = 0;

        uint256 returnedShares = _returnCanonicalShares();
        uint256 returnedQuote = _returnQuoteOrQuarantine(expectedQuote, boardroom);
        if (quoteQuarantined) {
            _enterQuarantine(CurvePhase.Settled);
        } else {
            _releaseMigrationReservation(expectedFacetSetHash);
            curveStatus = CurvePhase.Settled;
            BoardroomCallbackLib.settleBondingCurve(boardroom, expectedFacetSetHash);
            emit CurvePhaseChanged(CurvePhase.Settled, settlementReason, 0);
        }

        emit CurveUnwindFinalized(returnedShares, returnedQuote, retainedHolderShares);
    }

    /// @notice Anyone may retry a quarantined quote return; the recipient is fixed by Boardroom lifecycle.
    /// @param expectedFacetSetHash Release the caller commits to for the settlement callback.
    function recoverQuarantinedQuote(bytes32 expectedFacetSetHash)
        external
        nonReentrant
        returns (uint256 returnedQuote)
    {
        if (curveStatus != CurvePhase.Quarantined || !quoteQuarantined) {
            revert QuoteNotQuarantined();
        }
        uint256 expectedQuote = unrecoveredQuote;
        address recipient = _recoveryRecipient();
        returnedQuote = _returnQuoteOrQuarantine(expectedQuote, recipient);
        (bool balanceReadable,) = _tryBalanceOf(quoteToken, address(this));
        emit CurveQuoteRecovered(recipient, returnedQuote, unrecoveredQuote, balanceReadable);

        if (!quoteQuarantined) {
            CurvePhase terminalPhase = postQuarantinePhase;
            curveStatus = terminalPhase;
            if (terminalPhase == CurvePhase.Settled) _releaseMigrationReservation(expectedFacetSetHash);
            BoardroomCallbackLib.settleBondingCurve(boardroom, expectedFacetSetHash);
            emit CurvePhaseChanged(terminalPhase, settlementReason, 0);
        }
    }

    /// @notice Opens the approved forfeiture window only after prolonged quarantine during wind-down.
    function openQuoteForfeiture() external nonReentrant {
        _requireWindingDownQuarantine();
        uint256 availableAt = forfeitureEligibleAt;
        if (block.timestamp < availableAt) revert ForfeitureNotAvailable(availableAt);
        if (forfeitureWindowEndsAt != 0) revert ForfeitureWindowNotOpen();
        forfeitureWindowEndsAt = uint64(block.timestamp + FORFEITURE_VETO_WINDOW);
        emit QuoteForfeitureOpened(forfeitureWindowEndsAt);
    }

    /// @notice A one-percent current-and-prior-block eligible staker delays forfeiture for another quarantine period.
    function vetoQuoteForfeiture() external nonReentrant {
        _requireWindingDownQuarantine();
        uint256 windowEndsAt = forfeitureWindowEndsAt;
        if (windowEndsAt == 0 || block.timestamp > windowEndsAt) revert ForfeitureWindowNotOpen();
        IMigratingBondingCurveBoardroom(boardroom).requireBondingCurveForfeitureVetoPower(msg.sender);
        forfeitureWindowEndsAt = 0;
        forfeitureEligibleAt = uint64(block.timestamp + QUARANTINE_FORFEITURE_DELAY);
        emit QuoteForfeitureVetoed(msg.sender, forfeitureEligibleAt);
    }

    /// @notice Anyone may accept forfeiture after an unvetoed seven-day window during wind-down.
    /// @param expectedFacetSetHash Release the caller commits to for the settlement callback.
    function finalizeQuoteForfeiture(bytes32 expectedFacetSetHash) external nonReentrant {
        _requireWindingDownQuarantine();
        uint256 windowEndsAt = forfeitureWindowEndsAt;
        if (windowEndsAt == 0 || block.timestamp <= windowEndsAt) revert ForfeitureWindowNotOpen();

        uint256 forfeited = unrecoveredQuote;
        forfeitedQuote = forfeited;
        unrecoveredQuote = 0;
        quoteQuarantined = false;
        forfeitureFinalized = true;
        forfeitureWindowEndsAt = 0;
        CurvePhase terminalPhase = postQuarantinePhase;
        curveStatus = terminalPhase;
        if (terminalPhase == CurvePhase.Settled) _releaseMigrationReservation(expectedFacetSetHash);
        BoardroomCallbackLib.settleBondingCurve(boardroom, expectedFacetSetHash);
        emit QuoteForfeitureFinalized(forfeited, terminalPhase);
        emit CurvePhaseChanged(terminalPhase, settlementReason, 0);
    }

    /// @notice Later-recoverable forfeited value follows the frozen redemption boundary.
    function recoverForfeitedQuote() external nonReentrant returns (uint256 returnedQuote) {
        if (!forfeitureFinalized) revert QuoteNotQuarantined();
        (bool readable, uint256 observed) = _tryBalanceOf(quoteToken, address(this));
        address recipient = _recoveryRecipient();
        if (readable && observed != 0) {
            (returnedQuote,, readable) = _tryReturnQuote(observed, recipient);
            if (returnedQuote >= forfeitedQuote) forfeitedQuote = 0;
            else forfeitedQuote -= returnedQuote;
        }
        emit ForfeitedQuoteRecovered(recipient, returnedQuote, readable);
    }

    function isClosed() external view returns (bool) {
        CurvePhase phase = curveStatus;
        return
            !migrationInProgress && (phase == CurvePhase.Migrated || phase == CurvePhase.Settled) && !quoteQuarantined;
    }

    function canMigrate() public view returns (bool) {
        if (
            migrationInProgress || curveStatus != CurvePhase.Graduated || block.timestamp > phaseEndsAt
                || IMigratingBondingCurveBoardroom(boardroom).status() != BOARDROOM_STATUS_ACTIVE
        ) return false;
        return _migrationAmountsFitAmm(accountedQuoteReserve, outstandingCurveShareLiability);
    }

    function reservationExpiresAt() external view returns (uint64) {
        return uint64(uint256(endTime) + MIGRATION_GRACE + SETTLEMENT_GRACE);
    }

    function terminalCurvePrice() public view returns (uint256) {
        return basePrice + FixedPointMathLib.fullMulDiv(slope, outstandingCurveShareLiability, WAD);
    }

    function migrationAmounts() public view returns (uint256 sharesToLiquidity, uint256 quoteToLiquidity) {
        quoteToLiquidity = _quoteToLiquidity(accountedQuoteReserve);
        sharesToLiquidity = FixedPointMathLib.fullMulDiv(quoteToLiquidity, WAD, terminalCurvePrice());
    }

    function soldShares() public view returns (uint256) {
        return outstandingCurveShareLiability;
    }

    function sellableShares(address holder) public view returns (uint256) {
        uint256 holderBalance = ERC20(shareToken).balanceOf(holder);
        uint256 liability = outstandingCurveShareLiability;
        return holderBalance < liability ? holderBalance : liability;
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

    function _requirePhase(CurvePhase expected) internal view {
        CurvePhase actual = curveStatus;
        if (actual != expected) revert InvalidCurvePhase(expected, actual);
    }

    function _requireActiveBoardroom() internal view {
        if (IMigratingBondingCurveBoardroom(boardroom).status() != BOARDROOM_STATUS_ACTIVE) {
            revert BoardroomNotActive();
        }
    }

    function _requireBoardroomBeforeSnapshot() internal view {
        if (IMigratingBondingCurveBoardroom(boardroom).status() > BOARDROOM_STATUS_WINDING_DOWN) {
            revert BoardroomPastWindDown();
        }
    }

    function _requireBuyOpen(uint256 deadline) internal view {
        _requirePhase(CurvePhase.Selling);
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
        if (
            params.endTime == 0 || params.endTime <= params.startTime || uint256(params.endTime) <= block.timestamp
                || uint256(params.endTime) - uint256(params.startTime) > MAX_CURVE_LIFETIME
                || uint256(params.endTime) > block.timestamp + MAX_CURVE_LIFETIME
        ) revert InvalidTimeWindow();
    }

    function _requireValidCreateAddresses(
        address boardroom_,
        address lockedLiquidityFactory_,
        CreateParams calldata params
    ) internal view {
        if (
            boardroom_ == address(0) || lockedLiquidityFactory_ == address(0) || params.shareToken == address(0)
                || params.quoteToken == address(0) || params.shareToken == params.quoteToken
        ) revert InvalidAddress();
        if (!_isAsset(params.quoteToken)) revert InvalidQuoteAsset(params.quoteToken);
    }

    function _requireValidCurveParameters(CreateParams calldata params) internal pure {
        if (
            params.saleSupply == 0 || params.migrationSupply == 0 || params.basePrice == 0
                || params.graduationQuoteTarget == 0 || params.saleSupply > MAX_CURVE_SUPPLY
                || params.migrationSupply > MAX_CURVE_SUPPLY - params.saleSupply || params.basePrice > type(uint112).max
                || params.slope > type(uint112).max
        ) revert InvalidAmount();

        uint256 fullSaleQuote = _curveIntegralForParams(params, 0, params.saleSupply);
        uint256 quoteToLiquidity = FixedPointMathLib.fullMulDiv(fullSaleQuote, params.quoteToLpBps, BPS);
        uint256 terminalPrice = params.basePrice + FixedPointMathLib.fullMulDiv(params.slope, params.saleSupply, WAD);
        uint256 sharesToLiquidity = FixedPointMathLib.fullMulDiv(quoteToLiquidity, WAD, terminalPrice);
        uint256 minimumShares = _minimumMigrationFill(sharesToLiquidity);
        uint256 minimumQuote = _minimumMigrationFill(quoteToLiquidity);
        if (
            sharesToLiquidity == 0 || sharesToLiquidity > params.migrationSupply
                || sharesToLiquidity > type(uint112).max || quoteToLiquidity == 0
                || quoteToLiquidity > type(uint112).max
                || FixedPointMathLib.sqrt(minimumShares * minimumQuote) <= AMM_MINIMUM_LIQUIDITY
        ) revert InvalidMigrationConfiguration();
    }

    function _requireBuyableShares(address recipient, uint256 shareAmount) internal view {
        if (recipient == address(0)) revert InvalidAddress();
        if (shareAmount == 0) revert InvalidAmount();
        if (shareAmount > remainingSaleShares) revert InsufficientShares(shareAmount, remainingSaleShares);
    }

    function _requireSellableShares(address recipient, uint256 shareAmount) internal view {
        if (recipient == address(0)) revert InvalidAddress();
        if (shareAmount == 0) revert InvalidAmount();
        uint256 sellerSellableShares = sellableShares(msg.sender);
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

    function _requireMigrationPrice(uint256 shares, uint256 quote, uint256 terminalPrice) internal pure {
        if (shares == 0 || quote == 0) revert InvalidMigrationConfiguration();
        uint256 actualPrice = FixedPointMathLib.fullMulDiv(quote, WAD, shares);
        uint256 difference = actualPrice > terminalPrice ? actualPrice - terminalPrice : terminalPrice - actualPrice;
        uint256 deviationBps = FixedPointMathLib.fullMulDivUp(difference, BPS, terminalPrice);
        if (deviationBps > MAX_MIGRATION_PRICE_DEVIATION_BPS) {
            revert MigrationPriceDeviation(actualPrice, terminalPrice, deviationBps);
        }
    }

    function _createLockedLiquidity(MigrationSeed memory seed)
        internal
        returns (address createdLocker, address createdPool, uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        shareToken.safeApprove(lockedLiquidityFactory, seed.sharesToLiquidity);
        quoteToken.safeApprove(lockedLiquidityFactory, seed.quoteToLiquidity);
        (createdLocker, createdPool, amountA, amountB, liquidity) = LockedLiquidityFactory(lockedLiquidityFactory)
            .createLockedLiquidityForBoardroom(
                seed.expectedFacetSetHash,
                boardroom,
                LockedLiquidityFactory.CreateParams({
                tokenA: shareToken,
                tokenB: quoteToken,
                amountADesired: seed.sharesToLiquidity,
                amountBDesired: seed.quoteToLiquidity,
                amountAMin: seed.minShareLiquidity,
                amountBMin: seed.minQuoteLiquidity,
                deadline: seed.deadline,
                salt: migrationSalt
            })
            );
        if (createdLocker == address(0) || createdPool == address(0)) revert InvalidAddress();
        shareToken.safeApprove(lockedLiquidityFactory, 0);
        quoteToken.safeApprove(lockedLiquidityFactory, 0);
    }

    function _beginUnwind(SettlementReason reason) internal {
        settlementReason = reason;
        curveStatus = CurvePhase.Unwinding;
        phaseEndsAt = uint64(block.timestamp + SETTLEMENT_GRACE);
        emit CurvePhaseChanged(CurvePhase.Unwinding, reason, phaseEndsAt);
    }

    function _releaseMigrationReservation(bytes32 expectedFacetSetHash) internal {
        if (!migrationReservationHeld) return;
        migrationReservationHeld = false;
        LockedLiquidityFactory(lockedLiquidityFactory)
            .releaseMigrationReservation(expectedFacetSetHash, boardroom, shareToken, quoteToken, migrationSalt);
    }

    function _enterQuarantine(CurvePhase terminalPhase) internal {
        postQuarantinePhase = terminalPhase;
        curveStatus = CurvePhase.Quarantined;
        quarantineStartedAt = uint64(block.timestamp);
        forfeitureEligibleAt = uint64(block.timestamp + QUARANTINE_FORFEITURE_DELAY);
        forfeitureWindowEndsAt = 0;
        emit CurvePhaseChanged(CurvePhase.Quarantined, settlementReason, forfeitureEligibleAt);
    }

    function _requireWindingDownQuarantine() internal view {
        if (curveStatus != CurvePhase.Quarantined || !quoteQuarantined) revert QuoteNotQuarantined();
        if (IMigratingBondingCurveBoardroom(boardroom).status() != BOARDROOM_STATUS_WINDING_DOWN) {
            revert BoardroomPastWindDown();
        }
    }

    function _returnCanonicalShares() internal returns (uint256 shareBalance) {
        shareBalance = ERC20(shareToken).balanceOf(address(this));
        if (shareBalance != 0) _checkedTransfer(shareToken, boardroom, shareBalance);
    }

    function _returnQuoteOrQuarantine(uint256 expectedQuote, address recipient)
        internal
        returns (uint256 returnedQuote)
    {
        (bool balanceReadable, uint256 observedQuote) = _tryBalanceOf(quoteToken, address(this));
        uint256 remainingQuote = observedQuote;
        if (balanceReadable && observedQuote != 0) {
            (returnedQuote, remainingQuote, balanceReadable) = _tryReturnQuote(observedQuote, recipient);
        }

        uint256 shortfall = expectedQuote > returnedQuote ? expectedQuote - returnedQuote : 0;
        uint256 unrecovered = shortfall > remainingQuote ? shortfall : remainingQuote;
        quoteQuarantined = !balanceReadable || unrecovered != 0;
        unrecoveredQuote = unrecovered;
        if (quoteQuarantined) {
            emit CurveQuoteQuarantined(expectedQuote, observedQuote, returnedQuote, unrecovered, balanceReadable);
        }
    }

    function _tryReturnQuote(uint256 amount, address recipient)
        internal
        returns (uint256 returnedQuote, uint256 remainingQuote, bool verified)
    {
        (bool senderBeforeReadable, uint256 senderBefore) = _tryBalanceOf(quoteToken, address(this));
        (bool recipientBeforeReadable, uint256 recipientBefore) = _tryBalanceOf(quoteToken, recipient);
        if (!senderBeforeReadable || !recipientBeforeReadable || senderBefore < amount) {
            return (0, senderBefore, false);
        }

        bool callSucceeded = BestEffortTokenLib.tryTransfer(quoteToken, recipient, amount);
        if (!callSucceeded) return (0, senderBefore, true);

        (bool senderAfterReadable, uint256 senderAfter) = _tryBalanceOf(quoteToken, address(this));
        (bool recipientAfterReadable, uint256 recipientAfter) = _tryBalanceOf(quoteToken, recipient);
        if (!senderAfterReadable || !recipientAfterReadable) return (0, senderBefore, false);

        if (recipientAfter >= recipientBefore) returnedQuote = recipientAfter - recipientBefore;
        remainingQuote = senderAfter;
        verified = true;
    }

    function _recoveryRecipient() internal view returns (address) {
        if (IMigratingBondingCurveBoardroom(boardroom).status() >= BOARDROOM_STATUS_SNAPSHOTTING) {
            return IMigratingBondingCurveBoardroom(boardroom).redemptionExcessRecipient();
        }
        return boardroom;
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
        return block.timestamp >= startTime && block.timestamp <= endTime;
    }

    function _latchGraduationIfReady() internal {
        if (curveStatus != CurvePhase.Selling) return;
        uint256 reserve = accountedQuoteReserve;
        if (reserve < graduationQuoteTarget && remainingSaleShares != 0) return;

        graduationLatched = true;
        curveStatus = CurvePhase.Graduated;
        phaseEndsAt = uint64(block.timestamp + MIGRATION_GRACE);
        emit CurveGraduationLatched(reserve, remainingSaleShares, phaseEndsAt);
        emit CurvePhaseChanged(CurvePhase.Graduated, SettlementReason.None, phaseEndsAt);
    }

    function _migrationAmountsFitAmm(uint256 quoteBalance, uint256 liability) internal view returns (bool) {
        uint256 quoteToLiquidity = _quoteToLiquidity(quoteBalance);
        uint256 terminalPrice = basePrice + FixedPointMathLib.fullMulDiv(slope, liability, WAD);
        uint256 sharesToLiquidity = FixedPointMathLib.fullMulDiv(quoteToLiquidity, WAD, terminalPrice);
        uint256 availableShares = ERC20(shareToken).balanceOf(address(this));
        uint256 minimumShares = _minimumMigrationFill(sharesToLiquidity);
        uint256 minimumQuote = _minimumMigrationFill(quoteToLiquidity);
        return sharesToLiquidity != 0 && sharesToLiquidity <= availableShares && sharesToLiquidity <= type(uint112).max
            && quoteToLiquidity != 0 && quoteToLiquidity <= type(uint112).max
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
        if (delta.recipientBalanceDecreased) revert UnexpectedTokenBalanceChange(token, expectedAmount, 0);
        if (delta.recipientReceived != expectedAmount) {
            revert UnexpectedTokenBalanceChange(token, expectedAmount, delta.recipientReceived);
        }
    }
}
