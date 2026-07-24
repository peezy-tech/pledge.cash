// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";
import {Initializable} from "solady/utils/Initializable.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {ExactTransferLib} from "../lib/ExactTransferLib.sol";
import {BestEffortTokenLib} from "../lib/BestEffortTokenLib.sol";

interface IDutchAuctionSaleBoardroom {
    function status() external view returns (uint8);
}

/// @notice A pre-funded, linearly descending, pay-at-execution project-share sale.
contract DutchAuctionSale is Initializable, ReentrancyGuard {
    uint8 internal constant BOARDROOM_STATUS_ACTIVE = 0;

    enum SaleStatus {
        Active,
        Closed,
        Cancelled
    }

    struct CreateParams {
        address shareToken;
        address paymentToken;
        uint256 shareAmount;
        uint256 startPrice;
        uint256 floorPrice;
        uint256 maxPerBuyer;
        uint64 startTime;
        uint64 endTime;
        bytes32 salt;
    }

    address public factory;
    address public boardroom;
    address public shareToken;
    address public paymentToken;
    uint256 public saleSupply;
    uint256 public remainingShares;
    uint256 public startPrice;
    uint256 public floorPrice;
    uint256 public maxPerBuyer;
    uint256 public totalPayment;
    uint256 public lastPurchasePrice;
    uint256 public settlementPrice;
    uint64 public startTime;
    uint64 public endTime;
    SaleStatus public saleStatus;

    mapping(address => uint256) public purchasedBy;

    error InvalidAddress();
    error InvalidAmount();
    error InvalidPriceRange();
    error InvalidTimeWindow();
    error OnlyBoardroom();
    error SaleNotActive();
    error SaleNotOpen();
    error SaleNotConcluded();
    error CancellationUnavailable();
    error WindDownRequired();
    error Expired();
    error InsufficientShares(uint256 requested, uint256 available);
    error InsufficientPayment(uint256 required, uint256 maximum);
    error MaxPerBuyerExceeded(address buyer, uint256 purchased, uint256 maximum);
    error UnexpectedTokenBalanceChange(address token, uint256 expected, uint256 actual);
    error InvalidPaymentAsset(address asset);

    event DutchAuctionInitialized(
        address indexed boardroom,
        address indexed shareToken,
        address indexed paymentToken,
        uint256 shareAmount,
        uint256 startPrice,
        uint256 floorPrice,
        uint256 maxPerBuyer,
        uint64 startTime,
        uint64 endTime,
        bytes32 salt
    );
    event DutchAuctionPurchase(
        address indexed buyer, address indexed recipient, uint256 shares, uint256 payment, uint256 price
    );
    event DutchAuctionClosed(uint256 returnedShares, uint256 settlementPrice, uint256 totalPayment);
    event DutchAuctionCancelled(uint256 returnedShares);

    constructor() {
        _disableInitializers();
    }

    function initialize(address boardroom_, CreateParams calldata params) external initializer {
        uint64 effectiveStartTime = params.startTime == 0 ? uint64(block.timestamp) : params.startTime;
        _requireValidCreateParams(boardroom_, params, effectiveStartTime);

        factory = msg.sender;
        boardroom = boardroom_;
        shareToken = params.shareToken;
        paymentToken = params.paymentToken;
        saleSupply = params.shareAmount;
        remainingShares = params.shareAmount;
        startPrice = params.startPrice;
        floorPrice = params.floorPrice;
        maxPerBuyer = params.maxPerBuyer;
        startTime = effectiveStartTime;
        endTime = params.endTime;
        saleStatus = SaleStatus.Active;

        emit DutchAuctionInitialized(
            boardroom_,
            params.shareToken,
            params.paymentToken,
            params.shareAmount,
            params.startPrice,
            params.floorPrice,
            params.maxPerBuyer,
            effectiveStartTime,
            params.endTime,
            params.salt
        );
    }

    function buy(uint256 shareAmount, address recipient, uint256 maxPayment, uint256 deadline)
        external
        nonReentrant
        returns (uint256 payment)
    {
        _requireOpen(deadline);
        _requirePurchasableShares(recipient, shareAmount);

        uint256 price = currentPrice();
        payment = getPaymentAmountAtPrice(shareAmount, price);
        if (payment > maxPayment) revert InsufficientPayment(payment, maxPayment);

        uint256 buyerPurchased = purchasedBy[msg.sender] + shareAmount;
        if (maxPerBuyer != 0 && buyerPurchased > maxPerBuyer) {
            revert MaxPerBuyerExceeded(msg.sender, buyerPurchased, maxPerBuyer);
        }

        remainingShares -= shareAmount;
        purchasedBy[msg.sender] = buyerPurchased;
        totalPayment += payment;
        lastPurchasePrice = price;
        if (remainingShares == 0) {
            saleStatus = SaleStatus.Closed;
            settlementPrice = price;
        }

        _checkedTransferFrom(paymentToken, msg.sender, boardroom, payment);
        _checkedTransfer(shareToken, recipient, shareAmount);

        emit DutchAuctionPurchase(msg.sender, recipient, shareAmount, payment, price);
        if (remainingShares == 0) emit DutchAuctionClosed(0, price, totalPayment);
    }

    /// @notice Permissionlessly settles an elapsed auction and returns unsold shares.
    function finalize() external nonReentrant returns (uint256 returnedShares) {
        _requireActive();
        if (block.timestamp < endTime) revert SaleNotConcluded();
        returnedShares = _close();
    }

    /// @notice Closes the auction only as part of Boardroom wind-down.
    function close() external nonReentrant onlyBoardroom returns (uint256 returnedShares) {
        _requireActive();
        if (_isBoardroomActive()) revert WindDownRequired();
        returnedShares = _close();
    }

    /// @notice Cancels a scheduled auction before its immutable sale window starts.
    function cancel() external nonReentrant onlyBoardroom returns (uint256 returnedShares) {
        _requireActive();
        if (block.timestamp >= startTime || saleSupply != remainingShares) revert CancellationUnavailable();
        saleStatus = SaleStatus.Cancelled;
        returnedShares = _returnRemainingShares();
        emit DutchAuctionCancelled(returnedShares);
    }

    function isClosed() external view returns (bool) {
        return saleStatus != SaleStatus.Active;
    }

    function soldShares() external view returns (uint256) {
        return saleSupply - remainingShares;
    }

    function currentPrice() public view returns (uint256) {
        uint256 timestamp = block.timestamp;
        if (timestamp <= startTime) return startPrice;
        if (timestamp >= endTime) return floorPrice;

        uint256 elapsed = timestamp - startTime;
        uint256 duration = uint256(endTime) - startTime;
        uint256 priceDecrease = FixedPointMathLib.fullMulDiv(startPrice - floorPrice, elapsed, duration);
        return startPrice - priceDecrease;
    }

    function getPaymentAmount(uint256 shareAmount) external view returns (uint256) {
        return getPaymentAmountAtPrice(shareAmount, currentPrice());
    }

    function getPaymentAmountAtPrice(uint256 shareAmount, uint256 price) public pure returns (uint256) {
        return FixedPointMathLib.fullMulDivUp(price, shareAmount, 1e18);
    }

    modifier onlyBoardroom() {
        if (msg.sender != boardroom) revert OnlyBoardroom();
        _;
    }

    function _close() internal returns (uint256 returnedShares) {
        saleStatus = SaleStatus.Closed;
        settlementPrice = lastPurchasePrice;
        returnedShares = _returnRemainingShares();
        emit DutchAuctionClosed(returnedShares, settlementPrice, totalPayment);
    }

    function _requireActive() internal view {
        if (saleStatus != SaleStatus.Active) revert SaleNotActive();
    }

    function _requireOpen(uint256 deadline) internal view {
        _requireActive();
        if (!_isBoardroomActive()) revert SaleNotOpen();
        if (deadline < block.timestamp) revert Expired();
        if (block.timestamp < startTime || block.timestamp >= endTime) revert SaleNotOpen();
    }

    function _requireValidCreateParams(address boardroom_, CreateParams calldata params, uint64 effectiveStartTime)
        internal
        view
    {
        if (boardroom_ == address(0) || params.shareToken == address(0) || params.paymentToken == address(0)) {
            revert InvalidAddress();
        }
        if (params.paymentToken == params.shareToken || !_isAsset(params.paymentToken)) {
            revert InvalidPaymentAsset(params.paymentToken);
        }
        if (params.shareAmount == 0) revert InvalidAmount();
        if (params.startPrice <= params.floorPrice || params.floorPrice == 0) revert InvalidPriceRange();
        if (params.endTime <= effectiveStartTime || uint256(params.endTime) <= block.timestamp) {
            revert InvalidTimeWindow();
        }
    }

    function _requirePurchasableShares(address recipient, uint256 shareAmount) internal view {
        if (recipient == address(0)) revert InvalidAddress();
        if (shareAmount == 0) revert InvalidAmount();
        if (shareAmount > remainingShares) revert InsufficientShares(shareAmount, remainingShares);
    }

    function _returnRemainingShares() internal returns (uint256 returnedShares) {
        returnedShares = remainingShares;
        remainingShares = 0;
        if (returnedShares != 0) _checkedTransfer(shareToken, boardroom, returnedShares);
    }

    function _isBoardroomActive() internal view returns (bool) {
        return IDutchAuctionSaleBoardroom(boardroom).status() == BOARDROOM_STATUS_ACTIVE;
    }

    function _isAsset(address asset) internal view returns (bool) {
        (bool readable,) = BestEffortTokenLib.tryBalanceOf(asset, address(this));
        return readable;
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
