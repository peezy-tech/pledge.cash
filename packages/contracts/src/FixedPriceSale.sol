// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";
import {Initializable} from "solady/utils/Initializable.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {ExactTransferLib} from "./ExactTransferLib.sol";

interface IFixedPriceSaleBoardroom {
    function status() external view returns (uint8);
}

contract FixedPriceSale is Initializable, ReentrancyGuard {
    using SafeTransferLib for address;

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
        uint256 price;
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
    uint256 public price;
    uint256 public maxPerBuyer;
    uint64 public startTime;
    uint64 public endTime;
    SaleStatus public saleStatus;

    mapping(address => uint256) public purchasedBy;

    error InvalidAddress();
    error InvalidAmount();
    error InvalidTimeWindow();
    error OnlyBoardroom();
    error SaleNotActive();
    error SaleNotOpen();
    error Expired();
    error InsufficientShares(uint256 requested, uint256 available);
    error InsufficientPayment(uint256 required, uint256 maximum);
    error MaxPerBuyerExceeded(address buyer, uint256 purchased, uint256 maximum);
    error UnexpectedTokenBalanceChange(address token, uint256 expected, uint256 actual);

    event FixedPriceSaleInitialized(
        address indexed boardroom,
        address indexed shareToken,
        address indexed paymentToken,
        uint256 shareAmount,
        uint256 price,
        uint256 maxPerBuyer,
        uint64 startTime,
        uint64 endTime,
        bytes32 salt
    );
    event FixedPricePurchase(address indexed buyer, address indexed recipient, uint256 shares, uint256 payment);
    event FixedPriceSaleClosed(uint256 returnedShares);
    event FixedPriceSaleCancelled(uint256 returnedShares);

    constructor() {
        _disableInitializers();
    }

    function initialize(address boardroom_, CreateParams calldata params) external initializer {
        if (boardroom_ == address(0) || params.shareToken == address(0) || params.paymentToken == address(0)) {
            revert InvalidAddress();
        }
        if (params.shareAmount == 0 || params.price == 0) revert InvalidAmount();
        if (params.endTime != 0 && params.endTime < params.startTime) revert InvalidTimeWindow();

        factory = msg.sender;
        boardroom = boardroom_;
        shareToken = params.shareToken;
        paymentToken = params.paymentToken;
        saleSupply = params.shareAmount;
        remainingShares = params.shareAmount;
        price = params.price;
        maxPerBuyer = params.maxPerBuyer;
        startTime = params.startTime;
        endTime = params.endTime;
        saleStatus = SaleStatus.Active;

        emit FixedPriceSaleInitialized(
            boardroom_,
            params.shareToken,
            params.paymentToken,
            params.shareAmount,
            params.price,
            params.maxPerBuyer,
            params.startTime,
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
        if (recipient == address(0)) revert InvalidAddress();
        if (shareAmount == 0) revert InvalidAmount();
        if (shareAmount > remainingShares) revert InsufficientShares(shareAmount, remainingShares);

        payment = getPaymentAmount(shareAmount);
        if (payment > maxPayment) revert InsufficientPayment(payment, maxPayment);

        uint256 buyerPurchased = purchasedBy[msg.sender] + shareAmount;
        if (maxPerBuyer != 0 && buyerPurchased > maxPerBuyer) {
            revert MaxPerBuyerExceeded(msg.sender, buyerPurchased, maxPerBuyer);
        }

        remainingShares -= shareAmount;
        purchasedBy[msg.sender] = buyerPurchased;

        _checkedTransferFrom(paymentToken, msg.sender, boardroom, payment);
        _checkedTransfer(shareToken, recipient, shareAmount);

        emit FixedPricePurchase(msg.sender, recipient, shareAmount, payment);
    }

    function close() external nonReentrant onlyBoardroom {
        _requireActive();
        saleStatus = SaleStatus.Closed;

        uint256 returnedShares = remainingShares;
        remainingShares = 0;
        if (returnedShares != 0) _checkedTransfer(shareToken, boardroom, returnedShares);

        emit FixedPriceSaleClosed(returnedShares);
    }

    function cancel() external nonReentrant onlyBoardroom {
        _requireActive();
        saleStatus = SaleStatus.Cancelled;

        uint256 returnedShares = remainingShares;
        remainingShares = 0;
        if (returnedShares != 0) _checkedTransfer(shareToken, boardroom, returnedShares);

        emit FixedPriceSaleCancelled(returnedShares);
    }

    function isClosed() external view returns (bool) {
        return saleStatus != SaleStatus.Active;
    }

    function getPaymentAmount(uint256 shareAmount) public view returns (uint256) {
        return FixedPointMathLib.fullMulDivUp(price, shareAmount, 1e18);
    }

    modifier onlyBoardroom() {
        if (msg.sender != boardroom) revert OnlyBoardroom();
        _;
    }

    function _requireActive() internal view {
        if (saleStatus != SaleStatus.Active) revert SaleNotActive();
    }

    function _requireOpen(uint256 deadline) internal view {
        _requireActive();
        if (IFixedPriceSaleBoardroom(boardroom).status() != BOARDROOM_STATUS_ACTIVE) revert SaleNotOpen();
        if (deadline < block.timestamp) revert Expired();
        if (block.timestamp < startTime || (endTime != 0 && block.timestamp > endTime)) revert SaleNotOpen();
    }

    function _checkedTransfer(address token, address to, uint256 expectedAmount) internal {
        _requireExactReceived(token, expectedAmount, ExactTransferLib.sendTo(token, to, expectedAmount));
    }

    function _checkedTransferFrom(address token, address from, address to, uint256 expectedAmount) internal {
        _requireExactReceived(token, expectedAmount, ExactTransferLib.pullTo(token, from, to, expectedAmount));
    }

    function _requireExactReceived(address token, uint256 expectedAmount, ExactTransferLib.RecipientDelta memory delta)
        internal
        pure
    {
        if (delta.balanceDecreased) {
            revert UnexpectedTokenBalanceChange(token, expectedAmount, 0);
        }
        if (delta.received != expectedAmount) {
            revert UnexpectedTokenBalanceChange(token, expectedAmount, delta.received);
        }
    }
}
