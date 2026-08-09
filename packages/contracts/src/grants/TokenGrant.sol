// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {Initializable} from "solady/utils/Initializable.sol";
import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";
import {BestEffortTokenLib} from "../lib/BestEffortTokenLib.sol";
import {ExactTransferLib} from "../lib/ExactTransferLib.sol";

interface ITokenGrantERC20Metadata {
    function decimals() external view returns (uint8);
}

interface ITokenGrantFactory {
    function closeGrant(uint256 tokenId) external;
    function isCanonicalBoardroom(address account) external view returns (bool);
    function ownerOf(uint256 tokenId) external view returns (address);
}

contract TokenGrant is Initializable {
    uint8 internal constant MAX_SUPPORTED_DECIMALS = 77;
    uint256 public constant MIN_SETTLEMENT_GRACE = 1 days;

    // Identity.
    address public factory;
    address public issuer;

    // Assets.
    address public token;
    address public paymentToken;
    uint8 public tokenDecimals;
    uint8 public paymentTokenDecimals;

    // Economics.
    uint256 public grantSize;
    uint256 public price;
    uint256 public settledAmount;

    // Schedule.
    uint256 public expiry;
    uint256 public vestingCliff;
    uint256 public vestingEnd;
    uint256 internal _vestingHaltTimestampPlusOne;

    // Grant-right policy.
    bool public transferable;
    uint256 public transferUnlockTime;
    bool public transferLocked;

    // Terminal state.
    bool public isClosed;
    bool public isQuarantined;
    uint256 public quarantinedAmount;

    error InvalidAddress();
    error InvalidAmount();
    error InvalidTokenPair();
    error InvalidPaymentToken();
    error InvalidVestingSchedule();
    error InvalidExpiry();
    error InvalidTokenDecimals(address token);
    error UnsupportedTokenDecimals(address token, uint8 decimals);
    error UnexpectedTokenBalanceChange(address token, uint256 expected, uint256 actual);
    error GrantExpired();
    error GrantClosed();
    error OnlyIssuer();
    error OnlyHolder();
    error ZeroAmount();
    error AmountExceedsTotal(uint256 requested, uint256 available);
    error InsufficientVestedAmount(uint256 requested, uint256 vested);
    error VestingAlreadyHalted();
    error NotYetExpired();
    error NonTransferableGrant(uint256 tokenId);
    error GrantTransferLocked(uint256 tokenId);
    error GrantTransferNotUnlocked(uint256 tokenId, uint256 unlockTime);
    error QuarantineNotAllowed(address issuer);

    event GrantSettled(address indexed holder, address indexed issuer, uint256 tokenAmount, uint256 paymentAmount);
    event VestingHalted(address indexed issuer, uint256 vestedAtHalt, uint256 unvestedWithdrawn);
    event ExpiredTokensWithdrawn(address indexed issuer, uint256 amountWithdrawn);
    event GrantQuarantined(address indexed issuer, address indexed lastHolder, uint256 strandedAmount);

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _issuer,
        address _holder,
        address _token,
        address _paymentToken,
        uint256 _amount,
        uint256 _price,
        uint256 _expiry,
        uint256 _vestingCliff,
        uint256 _vestingEnd,
        bool _transferable,
        uint256 _transferUnlockTime
    ) external initializer {
        _validateGrantParties(_issuer, _holder, _token);
        _validateGrantTerms(_amount, _expiry, _vestingCliff, _vestingEnd);

        tokenDecimals = _readTokenDecimals(_token);
        _configurePaymentTerms(_token, _paymentToken, _price);

        factory = msg.sender;
        issuer = _issuer;
        token = _token;
        paymentToken = _paymentToken;
        grantSize = _amount;
        price = _price;
        expiry = _expiry;
        vestingCliff = _vestingCliff;
        vestingEnd = _vestingEnd;
        transferable = _transferable;
        transferUnlockTime = _transferUnlockTime;
    }

    /*//////////////////////////////////////////////////////////////
                                VIEWS
    //////////////////////////////////////////////////////////////*/

    function holder() public view returns (address) {
        if (isClosed) return address(0);
        return ITokenGrantFactory(factory).ownerOf(tokenId());
    }

    function tokenId() public view returns (uint256) {
        return uint256(uint160(address(this)));
    }

    function claimable() public view returns (uint256) {
        if (!vestingIsHalted()) return grantSize;
        return _vestedAt(vestingHaltTimestamp());
    }

    function vestingIsHalted() public view returns (bool) {
        return _vestingHaltTimestampPlusOne != 0;
    }

    function vestingHaltTimestamp() public view returns (uint256) {
        uint256 encodedTimestamp = _vestingHaltTimestampPlusOne;
        return encodedTimestamp == 0 ? 0 : encodedTimestamp - 1;
    }

    function getCurrentlyVestedSnapshot(uint256 _currentTime) public view returns (uint256) {
        uint256 effectiveTime = _effectiveVestingTime(_currentTime);
        return _vestedAt(effectiveTime);
    }

    function getSettlementCost(uint256 _amountToSettle) public view returns (uint256) {
        if (price == 0) return 0;
        return FixedPointMathLib.fullMulDivUp(_amountToSettle, price, tokenUnit());
    }

    function getSettleableAmount(uint256 _currentTime) public view returns (uint256) {
        if (isClosed || isExpired(_currentTime)) return 0;
        uint256 vested = getCurrentlyVestedSnapshot(_currentTime);
        if (vested <= settledAmount) return 0;
        return vested - settledAmount;
    }

    function getUnsettledAmount() public view returns (uint256) {
        return claimable() - settledAmount;
    }

    function isExpired(uint256 _currentTime) public view returns (bool) {
        return _currentTime > expiry;
    }

    function isHalted() public view returns (bool) {
        return vestingIsHalted();
    }

    function requireCanTransferGrantRight(uint256 _currentTime) external view {
        _requireOpen();
        _requireTransferableGrantRight(_currentTime);
    }

    function tokenUnit() public view returns (uint256) {
        return 10 ** uint256(tokenDecimals);
    }

    /*//////////////////////////////////////////////////////////////
                              LIFECYCLE
    //////////////////////////////////////////////////////////////*/

    function settle(uint256 _amountToSettle) external {
        _requireOpen();
        address currentHolder = holder();
        _requireSettlementAllowed(currentHolder, _amountToSettle);

        settledAmount += _amountToSettle;
        transferLocked = true;

        uint256 totalCost = getSettlementCost(_amountToSettle);
        if (totalCost > 0) {
            _checkedTransferFrom(paymentToken, currentHolder, issuer, totalCost);
        }
        _checkedTransfer(token, currentHolder, _amountToSettle);

        if (settledAmount >= claimable()) {
            _closeAndBurnGrantRight();
            emit GrantSettled(currentHolder, issuer, _amountToSettle, totalCost);
            return;
        }

        transferLocked = false;
        emit GrantSettled(currentHolder, issuer, _amountToSettle, totalCost);
    }

    function stopVestingAndWithdrawUnvested() external onlyIssuer {
        _requireOpen();
        if (vestingIsHalted()) revert VestingAlreadyHalted();

        uint256 haltTimestamp = block.timestamp;
        uint256 vestedAtHalt = getCurrentlyVestedSnapshot(haltTimestamp);
        uint256 unvestedToWithdraw = grantSize - vestedAtHalt;

        _vestingHaltTimestampPlusOne = haltTimestamp + 1;

        transferLocked = true;
        if (unvestedToWithdraw > 0) {
            _checkedTransfer(token, issuer, unvestedToWithdraw);
        }
        if (settledAmount >= vestedAtHalt) {
            _closeAndBurnGrantRight();
            emit VestingHalted(issuer, vestedAtHalt, unvestedToWithdraw);
            return;
        }

        transferLocked = false;
        emit VestingHalted(issuer, vestedAtHalt, unvestedToWithdraw);
    }

    function withdrawExpiredTokens() external onlyIssuer {
        _requireOpen();
        if (block.timestamp <= expiry) revert NotYetExpired();

        uint256 remainingBalance = SafeTransferLib.balanceOf(token, address(this));
        transferLocked = true;
        if (remainingBalance > 0) {
            _checkedTransfer(token, issuer, remainingBalance);
        }
        _closeAndBurnGrantRight();
        emit ExpiredTokensWithdrawn(issuer, remainingBalance);
    }

    /// @notice Recovers an expired Boardroom grant when possible, or closes it around a token that cannot transfer safely.
    /// @dev Recovery calls are bounded; `quarantinedAmount` records any unsettled promise left behind on failure.
    function quarantineAndClose() external onlyIssuer {
        _requireOpen();
        if (block.timestamp <= expiry) revert NotYetExpired();
        if (!ITokenGrantFactory(factory).isCanonicalBoardroom(issuer)) revert QuarantineNotAllowed(issuer);

        uint256 unsettledPromise = claimable() - settledAmount;
        (bool recoveredExactly, uint256 recoveredAmount) = _tryRecoverExpiredTokens(unsettledPromise);
        if (recoveredExactly) {
            _closeAndBurnGrantRight();
            emit ExpiredTokensWithdrawn(issuer, recoveredAmount);
            return;
        }

        address lastHolder = holder();
        uint256 strandedAmount = unsettledPromise > recoveredAmount ? unsettledPromise - recoveredAmount : 0;
        isQuarantined = true;
        quarantinedAmount = strandedAmount;
        _closeAndBurnGrantRight();

        emit GrantQuarantined(issuer, lastHolder, strandedAmount);
    }

    /*//////////////////////////////////////////////////////////////
                               INTERNAL
    //////////////////////////////////////////////////////////////*/

    function _tryRecoverExpiredTokens(uint256 expectedAmount)
        internal
        returns (bool recoveredExactly, uint256 recoveredAmount)
    {
        (bool grantBalanceReadable, uint256 grantBalanceBefore) = BestEffortTokenLib.tryBalanceOf(token, address(this));
        (bool issuerBalanceReadable, uint256 issuerBalanceBefore) = BestEffortTokenLib.tryBalanceOf(token, issuer);
        if (!grantBalanceReadable || !issuerBalanceReadable || grantBalanceBefore == 0) return (false, 0);

        bool callSucceeded = BestEffortTokenLib.tryTransfer(token, issuer, grantBalanceBefore);
        if (!callSucceeded) return (false, 0);

        (bool grantAfterReadable, uint256 grantBalanceAfter) = BestEffortTokenLib.tryBalanceOf(token, address(this));
        (bool issuerAfterReadable, uint256 issuerBalanceAfter) = BestEffortTokenLib.tryBalanceOf(token, issuer);
        if (!grantAfterReadable || !issuerAfterReadable) return (false, 0);

        uint256 grantSpent = grantBalanceAfter > grantBalanceBefore ? 0 : grantBalanceBefore - grantBalanceAfter;
        recoveredAmount = issuerBalanceAfter > issuerBalanceBefore ? issuerBalanceAfter - issuerBalanceBefore : 0;
        recoveredExactly = grantBalanceBefore >= expectedAmount && grantSpent == grantBalanceBefore
            && recoveredAmount == grantBalanceBefore;
    }

    modifier onlyIssuer() {
        if (msg.sender != issuer) revert OnlyIssuer();
        _;
    }

    function _requireOpen() internal view {
        if (isClosed) revert GrantClosed();
    }

    function _validateGrantParties(address issuer_, address holder_, address token_) internal pure {
        if (issuer_ == address(0) || holder_ == address(0) || token_ == address(0)) {
            revert InvalidAddress();
        }
    }

    function _validateGrantTerms(uint256 amount_, uint256 expiry_, uint256 vestingCliff_, uint256 vestingEnd_)
        internal
        view
    {
        if (amount_ == 0) revert InvalidAmount();
        if (expiry_ < vestingEnd_ || expiry_ - vestingEnd_ < MIN_SETTLEMENT_GRACE) revert InvalidExpiry();
        if (expiry_ <= block.timestamp) revert InvalidExpiry();
        if (vestingCliff_ > vestingEnd_) revert InvalidVestingSchedule();
    }

    function _configurePaymentTerms(address token_, address paymentToken_, uint256 price_) internal {
        if (price_ == 0) {
            if (paymentToken_ != address(0)) revert InvalidPaymentToken();
            return;
        }

        if (paymentToken_ == address(0)) revert InvalidPaymentToken();
        if (paymentToken_ == token_) revert InvalidTokenPair();
        paymentTokenDecimals = _readTokenDecimals(paymentToken_);
    }

    function _effectiveVestingTime(uint256 currentTime) internal view returns (uint256) {
        if (!vestingIsHalted()) return currentTime;
        uint256 haltTimestamp = vestingHaltTimestamp();
        if (haltTimestamp >= currentTime) return currentTime;
        return haltTimestamp;
    }

    function _isFullyVestedAt(uint256 currentTime) internal view returns (bool) {
        return vestingEnd == vestingCliff || currentTime >= vestingEnd;
    }

    function _linearVestedAmount(uint256 currentTime) internal view returns (uint256) {
        return FixedPointMathLib.fullMulDiv(grantSize, currentTime - vestingCliff, vestingEnd - vestingCliff);
    }

    function _vestedAt(uint256 currentTime) internal view returns (uint256) {
        if (currentTime < vestingCliff) return 0;
        if (_isFullyVestedAt(currentTime)) return grantSize;
        return _linearVestedAmount(currentTime);
    }

    function _requireTransferableGrantRight(uint256 currentTime) internal view {
        uint256 grantTokenId = tokenId();
        if (!transferable) revert NonTransferableGrant(grantTokenId);
        if (transferLocked) revert GrantTransferLocked(grantTokenId);
        if (currentTime < transferUnlockTime) {
            revert GrantTransferNotUnlocked(grantTokenId, transferUnlockTime);
        }
        if (isExpired(currentTime)) revert GrantExpired();
    }

    function _requireSettlementAllowed(address currentHolder, uint256 amountToSettle) internal view {
        if (block.timestamp > expiry) revert GrantExpired();
        if (msg.sender != currentHolder) revert OnlyHolder();
        if (amountToSettle == 0) revert ZeroAmount();

        uint256 requestedTotal = settledAmount + amountToSettle;
        uint256 claimableAmount = claimable();
        if (requestedTotal > claimableAmount) {
            revert AmountExceedsTotal({requested: requestedTotal, available: claimableAmount});
        }

        uint256 vested = getCurrentlyVestedSnapshot(block.timestamp);
        uint256 settleable = vested - settledAmount;
        if (amountToSettle > settleable) {
            revert InsufficientVestedAmount({requested: amountToSettle, vested: settleable});
        }
    }

    function _closeAndBurnGrantRight() internal {
        isClosed = true;
        transferLocked = false;
        ITokenGrantFactory(factory).closeGrant(tokenId());
    }

    function _readTokenDecimals(address token_) internal view returns (uint8) {
        (bool success, bytes memory data) = token_.staticcall(abi.encodeCall(ITokenGrantERC20Metadata.decimals, ()));
        if (!success || data.length < 32) revert InvalidTokenDecimals(token_);

        uint256 decimals = abi.decode(data, (uint256));
        if (decimals > type(uint8).max) revert InvalidTokenDecimals(token_);

        // casting to uint8 is safe because decimals was checked against type(uint8).max.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint8 tokenDecimals_ = uint8(decimals);
        if (tokenDecimals_ > MAX_SUPPORTED_DECIMALS) {
            revert UnsupportedTokenDecimals(token_, tokenDecimals_);
        }

        return tokenDecimals_;
    }

    function _checkedTransferFrom(address token_, address from, address to, uint256 expectedAmount) internal {
        _requireExactBalanceChanges(
            token_, expectedAmount, ExactTransferLib.pullBetween(token_, from, to, expectedAmount)
        );
    }

    function _checkedTransfer(address token_, address to, uint256 expectedAmount) internal {
        _requireExactBalanceChanges(token_, expectedAmount, ExactTransferLib.sendFromSelfTo(token_, to, expectedAmount));
    }

    function _requireExactBalanceChanges(
        address token_,
        uint256 expectedAmount,
        ExactTransferLib.ExactDelta memory delta
    ) internal pure {
        if (delta.senderBalanceIncreased) {
            revert UnexpectedTokenBalanceChange(token_, expectedAmount, 0);
        }
        if (delta.senderSpent != expectedAmount) {
            revert UnexpectedTokenBalanceChange(token_, expectedAmount, delta.senderSpent);
        }
        if (delta.recipientBalanceDecreased) {
            revert UnexpectedTokenBalanceChange(token_, expectedAmount, 0);
        }
        if (delta.recipientReceived != expectedAmount) {
            revert UnexpectedTokenBalanceChange(token_, expectedAmount, delta.recipientReceived);
        }
    }
}
