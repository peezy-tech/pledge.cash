// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "solady/auth/Ownable.sol";
import {LibClone} from "solady/utils/LibClone.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {TokenGrant} from "./TokenGrant.sol";

contract TokenGrantFactory is Ownable {
    address public immutable tokenGrantLogic;
    uint256 public creationFee;

    error InvalidCreationFeePayment(uint256 expected, uint256 actual);

    event TokenGrantCreated(
        address indexed grantAddress,
        address indexed issuer,
        address indexed holder,
        address token,
        address paymentToken,
        uint256 amount,
        uint256 price,
        uint256 expiry,
        uint256 vestingCliff,
        uint256 vestingEnd,
        bytes32 salt
    );
    event CreationFeeSet(uint256 amount);
    event CreationFeePaid(address indexed payer, address indexed recipient, uint256 amount);

    constructor() {
        _initializeOwner(msg.sender);
        tokenGrantLogic = address(new TokenGrant());
    }

    function setCreationFee(uint256 amount) external onlyOwner {
        creationFee = amount;
        emit CreationFeeSet(amount);
    }

    function createGrant(
        address holder,
        address token,
        address paymentToken,
        uint256 amount,
        uint256 price,
        uint256 expiry,
        uint256 vestingCliff,
        uint256 vestingEnd,
        bytes32 salt
    ) external payable returns (address grant) {
        uint256 fee = creationFee;
        if (msg.value != fee) revert InvalidCreationFeePayment(fee, msg.value);

        grant = LibClone.cloneDeterministic(tokenGrantLogic, salt);
        TokenGrant(grant)
            .initialize(msg.sender, holder, token, paymentToken, amount, price, expiry, vestingCliff, vestingEnd);

        _payCreationFee(fee);

        emit TokenGrantCreated(
            grant, msg.sender, holder, token, paymentToken, amount, price, expiry, vestingCliff, vestingEnd, salt
        );
    }

    function predictGrantAddress(bytes32 salt) external view returns (address) {
        return LibClone.predictDeterministicAddress(tokenGrantLogic, salt, address(this));
    }

    function _payCreationFee(uint256 fee) internal {
        if (fee == 0) return;

        address recipient = owner();
        SafeTransferLib.safeTransferETH(recipient, fee);
        emit CreationFeePaid(msg.sender, recipient, fee);
    }
}
