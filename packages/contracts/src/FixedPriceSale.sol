// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "solady/tokens/ERC20.sol";
import {Initializable} from "solady/utils/Initializable.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";

contract FixedPriceSale is Initializable, ReentrancyGuard {
    using SafeTransferLib for address;

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
        return price * shareAmount / 1e18;
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
        if (deadline < block.timestamp) revert Expired();
        if (block.timestamp < startTime || (endTime != 0 && block.timestamp > endTime)) revert SaleNotOpen();
    }

    function _checkedTransfer(address token, address to, uint256 expectedAmount) internal {
        uint256 balanceBefore = ERC20(token).balanceOf(to);
        token.safeTransfer(to, expectedAmount);
        _checkBalanceChange(token, to, expectedAmount, balanceBefore);
    }

    function _checkedTransferFrom(address token, address from, address to, uint256 expectedAmount) internal {
        uint256 balanceBefore = ERC20(token).balanceOf(to);
        token.safeTransferFrom(from, to, expectedAmount);
        _checkBalanceChange(token, to, expectedAmount, balanceBefore);
    }

    function _checkBalanceChange(address token, address account, uint256 expectedAmount, uint256 balanceBefore)
        internal
        view
    {
        uint256 balanceAfter = ERC20(token).balanceOf(account);
        if (balanceAfter < balanceBefore) {
            revert UnexpectedTokenBalanceChange(token, expectedAmount, 0);
        }

        uint256 actualAmount = balanceAfter - balanceBefore;
        if (actualAmount != expectedAmount) {
            revert UnexpectedTokenBalanceChange(token, expectedAmount, actualAmount);
        }
    }
}
