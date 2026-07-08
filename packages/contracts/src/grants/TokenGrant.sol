// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {Initializable} from "solady/utils/Initializable.sol";
import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";
import {ExactTransferLib} from "../lib/ExactTransferLib.sol";

interface ITokenGrantERC20Metadata {
    function decimals() external view returns (uint8);
}

interface ITokenGrantFactory {
    function closeGrant(uint256 tokenId) external;
}

contract TokenGrant is Initializable {
    using SafeTransferLib for address;

    uint8 internal constant MAX_SUPPORTED_DECIMALS = 77;

    // Identity.
    address public factory;
    address public issuer;
    address public holder;
    uint256 public tokenId;

    // Assets.
    address public token;
    address public paymentToken;
    uint8 public tokenDecimals;
    uint8 public paymentTokenDecimals;

    // Economics.
    uint256 public grantSize;
    uint256 public claimable;
    uint256 public price;
    uint256 public settledAmount;

    // Schedule.
    uint256 public expiry;
    uint256 public vestingCliff;
    uint256 public vestingEnd;
    bool public vestingIsHalted;
    uint256 public vestingHaltTimestamp;

    // Grant-right policy.
    bool public transferable;
    uint256 public transferUnlockTime;
    bool public transferLocked;

    // Terminal state.
    bool public isClosed;

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
    error OnlyFactory();
    error HolderSyncMismatch(address expected, address actual);

    event GrantSettled(address indexed holder, address indexed issuer, uint256 tokenAmount, uint256 paymentAmount);
    event VestingHalted(address indexed issuer, uint256 vestedAtHalt, uint256 unvestedWithdrawn);
    event ExpiredTokensWithdrawn(address indexed issuer, uint256 amountWithdrawn);

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
        if (_issuer == address(0) || _holder == address(0) || _token == address(0)) {
            revert InvalidAddress();
        }
        if (_amount == 0) revert InvalidAmount();
        if (_expiry < _vestingEnd) revert InvalidExpiry();
        if (_expiry <= block.timestamp) revert InvalidExpiry();
        if (_vestingCliff > _vestingEnd) revert InvalidVestingSchedule();

        tokenDecimals = _readTokenDecimals(_token);

        if (_price == 0) {
            if (_paymentToken != address(0)) revert InvalidPaymentToken();
        } else {
            if (_paymentToken == address(0)) revert InvalidPaymentToken();
            if (_paymentToken == _token) revert InvalidTokenPair();
            paymentTokenDecimals = _readTokenDecimals(_paymentToken);
        }

        factory = msg.sender;
        issuer = _issuer;
        holder = _holder;
        token = _token;
        paymentToken = _paymentToken;
        tokenId = uint256(uint160(address(this)));
        grantSize = _amount;
        claimable = _amount;
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

    function getCurrentlyVestedSnapshot(uint256 _currentTime) public view returns (uint256) {
        if (_currentTime < vestingCliff) {
            return 0;
        }

        uint256 cappedTime = _currentTime;
        if (vestingIsHalted && vestingHaltTimestamp < cappedTime) {
            cappedTime = vestingHaltTimestamp;
        }

        if (cappedTime < vestingCliff) {
            return 0;
        }
        if (vestingEnd == vestingCliff || cappedTime >= vestingEnd) {
            return claimable;
        }

        return FixedPointMathLib.fullMulDiv(grantSize, cappedTime - vestingCliff, vestingEnd - vestingCliff);
    }

    function getSettlementCost(uint256 _amountToSettle) public view returns (uint256) {
        if (price == 0) return 0;
        return FixedPointMathLib.fullMulDivUp(_amountToSettle, price, tokenUnit());
    }

    function getSettleableAmount(uint256 _currentTime) public view returns (uint256) {
        uint256 vested = getCurrentlyVestedSnapshot(_currentTime);
        if (vested <= settledAmount) return 0;
        return vested - settledAmount;
    }

    function getUnsettledAmount() public view returns (uint256) {
        return claimable - settledAmount;
    }

    function isExpired(uint256 _currentTime) public view returns (bool) {
        return _currentTime > expiry;
    }

    function isHalted() public view returns (bool) {
        return vestingIsHalted;
    }

    function requireCanTransferGrantRight(uint256 _currentTime) external view {
        _requireOpen();
        if (!transferable) revert NonTransferableGrant(tokenId);
        if (transferLocked) revert GrantTransferLocked(tokenId);
        if (_currentTime < transferUnlockTime) {
            revert GrantTransferNotUnlocked(tokenId, transferUnlockTime);
        }
        if (isExpired(_currentTime)) revert GrantExpired();
    }

    function tokenUnit() public view returns (uint256) {
        return 10 ** uint256(tokenDecimals);
    }

    /*//////////////////////////////////////////////////////////////
                            FACTORY HOOKS
    //////////////////////////////////////////////////////////////*/

    function onGrantRightTransferred(address from, address to) external onlyFactory {
        _requireOpen();
        if (from != holder) revert HolderSyncMismatch(holder, from);
        if (to == address(0)) revert InvalidAddress();

        holder = to;
    }

    /*//////////////////////////////////////////////////////////////
                              LIFECYCLE
    //////////////////////////////////////////////////////////////*/

    function settle(uint256 _amountToSettle) external {
        _requireOpen();
        if (block.timestamp > expiry) revert GrantExpired();
        address currentHolder = holder;
        if (msg.sender != currentHolder) revert OnlyHolder();
        if (_amountToSettle == 0) revert ZeroAmount();

        uint256 requestedTotal = settledAmount + _amountToSettle;
        if (requestedTotal > claimable) {
            revert AmountExceedsTotal({requested: requestedTotal, available: claimable});
        }

        uint256 vested = getCurrentlyVestedSnapshot(block.timestamp);
        uint256 settleable = vested - settledAmount;
        if (_amountToSettle > settleable) {
            revert InsufficientVestedAmount({requested: _amountToSettle, vested: settleable});
        }

        settledAmount += _amountToSettle;

        transferLocked = true;
        uint256 totalCost = getSettlementCost(_amountToSettle);
        if (totalCost > 0) {
            _checkedTransferFrom(paymentToken, currentHolder, issuer, totalCost);
        }
        _checkedTransfer(token, currentHolder, _amountToSettle);

        if (settledAmount >= claimable) {
            _closeAndBurnGrantRight();
            emit GrantSettled(currentHolder, issuer, _amountToSettle, totalCost);
            return;
        }

        transferLocked = false;
        emit GrantSettled(currentHolder, issuer, _amountToSettle, totalCost);
    }

    function stopVestingAndWithdrawUnvested() external onlyIssuer {
        _requireOpen();
        if (vestingIsHalted) revert VestingAlreadyHalted();

        uint256 vestedAtHalt = getCurrentlyVestedSnapshot(block.timestamp);
        uint256 unvestedToWithdraw = grantSize - vestedAtHalt;

        vestingIsHalted = true;
        vestingHaltTimestamp = block.timestamp;
        claimable = vestedAtHalt;

        transferLocked = true;
        if (unvestedToWithdraw > 0) {
            SafeTransferLib.safeTransfer(token, issuer, unvestedToWithdraw);
        }
        if (settledAmount >= claimable) {
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
            SafeTransferLib.safeTransfer(token, issuer, remainingBalance);
        }
        _closeAndBurnGrantRight();
        emit ExpiredTokensWithdrawn(issuer, remainingBalance);
    }

    /*//////////////////////////////////////////////////////////////
                               INTERNAL
    //////////////////////////////////////////////////////////////*/

    modifier onlyFactory() {
        if (msg.sender != factory) revert OnlyFactory();
        _;
    }

    modifier onlyIssuer() {
        if (msg.sender != issuer) revert OnlyIssuer();
        _;
    }

    function _requireOpen() internal view {
        if (isClosed) revert GrantClosed();
    }

    function _closeAndBurnGrantRight() internal {
        isClosed = true;
        holder = address(0);
        transferLocked = false;
        ITokenGrantFactory(factory).closeGrant(tokenId);
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
        _requireExactReceived(token_, expectedAmount, ExactTransferLib.pullTo(token_, from, to, expectedAmount));
    }

    function _checkedTransfer(address token_, address to, uint256 expectedAmount) internal {
        _requireExactReceived(token_, expectedAmount, ExactTransferLib.sendTo(token_, to, expectedAmount));
    }

    function _requireExactReceived(address token_, uint256 expectedAmount, ExactTransferLib.RecipientDelta memory delta)
        internal
        pure
    {
        if (delta.balanceDecreased) {
            revert UnexpectedTokenBalanceChange(token_, expectedAmount, 0);
        }
        if (delta.received != expectedAmount) {
            revert UnexpectedTokenBalanceChange(token_, expectedAmount, delta.received);
        }
    }
}
