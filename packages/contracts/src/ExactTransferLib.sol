// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";

library ExactTransferLib {
    using SafeTransferLib for address;

    struct RecipientDelta {
        bool balanceDecreased;
        uint256 received;
    }

    struct ExactDelta {
        bool senderBalanceIncreased;
        uint256 senderSpent;
        bool recipientBalanceDecreased;
        uint256 recipientReceived;
    }

    function pullTo(address token, address from, address to, uint256 amount) internal returns (RecipientDelta memory) {
        uint256 recipientBalanceBefore = SafeTransferLib.balanceOf(token, to);
        token.safeTransferFrom(from, to, amount);
        return received(token, to, recipientBalanceBefore);
    }

    function sendTo(address token, address to, uint256 amount) internal returns (RecipientDelta memory) {
        uint256 recipientBalanceBefore = SafeTransferLib.balanceOf(token, to);
        token.safeTransfer(to, amount);
        return received(token, to, recipientBalanceBefore);
    }

    function pullBetween(address token, address from, address to, uint256 amount) internal returns (ExactDelta memory) {
        uint256 senderBalanceBefore = SafeTransferLib.balanceOf(token, from);
        uint256 recipientBalanceBefore = SafeTransferLib.balanceOf(token, to);
        token.safeTransferFrom(from, to, amount);
        return exactDelta(token, from, senderBalanceBefore, to, recipientBalanceBefore);
    }

    function sendFromSelfTo(address token, address to, uint256 amount) internal returns (ExactDelta memory) {
        address from = address(this);
        uint256 senderBalanceBefore = SafeTransferLib.balanceOf(token, from);
        uint256 recipientBalanceBefore = SafeTransferLib.balanceOf(token, to);
        token.safeTransfer(to, amount);
        return exactDelta(token, from, senderBalanceBefore, to, recipientBalanceBefore);
    }

    function received(address token, address account, uint256 balanceBefore)
        internal
        view
        returns (RecipientDelta memory)
    {
        uint256 balanceAfter = SafeTransferLib.balanceOf(token, account);
        if (balanceAfter < balanceBefore) return RecipientDelta({balanceDecreased: true, received: 0});
        return RecipientDelta({balanceDecreased: false, received: balanceAfter - balanceBefore});
    }

    function exactDelta(
        address token,
        address sender,
        uint256 senderBalanceBefore,
        address recipient,
        uint256 recipientBalanceBefore
    ) internal view returns (ExactDelta memory) {
        uint256 senderBalanceAfter = SafeTransferLib.balanceOf(token, sender);
        uint256 recipientBalanceAfter = SafeTransferLib.balanceOf(token, recipient);

        return ExactDelta({
            senderBalanceIncreased: senderBalanceAfter > senderBalanceBefore,
            senderSpent: senderBalanceAfter > senderBalanceBefore ? 0 : senderBalanceBefore - senderBalanceAfter,
            recipientBalanceDecreased: recipientBalanceAfter < recipientBalanceBefore,
            recipientReceived: recipientBalanceAfter < recipientBalanceBefore
                ? 0
                : recipientBalanceAfter - recipientBalanceBefore
        });
    }
}
