// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "solady/auth/Ownable.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";

/// @notice Durable protocol-fee custody whose payout destination can outlive any one Boardroom.
/// @dev Anyone may forward accumulated fees. Only governance can rotate the destination.
contract ProtocolFeeRouter is Ownable {
    using SafeTransferLib for address;

    address public feeRecipient;

    error InvalidAddress();

    event FeeRecipientSet(address indexed previousRecipient, address indexed newRecipient);
    event NativeFeesForwarded(address indexed recipient, uint256 amount);
    event TokenFeesForwarded(address indexed token, address indexed recipient, uint256 amount);

    constructor(address owner_, address feeRecipient_) {
        _requireNonZero(owner_);
        _requireNonZero(feeRecipient_);

        _initializeOwner(owner_);
        feeRecipient = feeRecipient_;
        emit FeeRecipientSet(address(0), feeRecipient_);
    }

    receive() external payable {}

    function setFeeRecipient(address newRecipient) external onlyOwner {
        _requireNonZero(newRecipient);

        address previousRecipient = feeRecipient;
        feeRecipient = newRecipient;
        emit FeeRecipientSet(previousRecipient, newRecipient);
    }

    function forwardNative() external returns (uint256 amount) {
        amount = address(this).balance;
        if (amount == 0) return 0;

        address recipient = feeRecipient;
        SafeTransferLib.safeTransferETH(recipient, amount);
        emit NativeFeesForwarded(recipient, amount);
    }

    function forwardToken(address token) external returns (uint256 amount) {
        _requireNonZero(token);

        amount = SafeTransferLib.balanceOf(token, address(this));
        if (amount == 0) return 0;

        address recipient = feeRecipient;
        token.safeTransfer(recipient, amount);
        emit TokenFeesForwarded(token, recipient, amount);
    }

    function _requireNonZero(address account) internal pure {
        if (account == address(0)) revert InvalidAddress();
    }
}
