// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "forge-std/Test.sol";
import {Ownable} from "solady/auth/Ownable.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";

contract Option is Ownable, Test {
    address public underlying;
    uint256 public amount;
    uint256 public strikePrice;
    uint256 public expiry;
    address public holder;
    address public currency;
    uint256 public vestingCliff;
    uint256 public vestingEnd;
    uint256 public exercisedAmount; // Tracks the amount already exercised

    constructor(
        address _currency,
        address _holder,
        address _underlying,
        uint256 _amount,
        uint256 _strikePrice,
        uint256 _expiry,
        uint256 _vestingCliff,
        uint256 _vestingEnd
    ) {
        _initializeOwner(msg.sender);

        require(_vestingCliff <= _vestingEnd, "Option: cliff > end");
        require(_expiry >= _vestingEnd, "Option: expiry must be at or after vesting end");

        currency = _currency;
        underlying = _underlying;
        amount = _amount;
        strikePrice = _strikePrice;
        expiry = _expiry;
        holder = _holder;
        vestingCliff = _vestingCliff;
        vestingEnd = _vestingEnd;

        SafeTransferLib.safeTransferFrom(
            _underlying,
            msg.sender,
            address(this),
            _amount
        );
    }

    function exercise() external {
        require(block.timestamp <= expiry, "Option: expired");
        require(msg.sender == holder, "Option: only holder can exercise");
        require(exercisedAmount < amount, "Option: already fully exercised");
        require(block.timestamp >= vestingCliff, "Option: still in cliff period");

        uint256 totalCurrentlyVested;
        if (block.timestamp >= vestingEnd) {
            totalCurrentlyVested = amount;
        } else {
            // Linear vesting between cliff and end
            totalCurrentlyVested = (amount * (block.timestamp - vestingCliff)) / (vestingEnd - vestingCliff);
        }

        uint256 amountToExerciseNow = totalCurrentlyVested - exercisedAmount;


        require(amountToExerciseNow > 0, "Option: no new vested amount to exercise");

        exercisedAmount += amountToExerciseNow;

        // Original: uint256 totalCost = (amountToExerciseNow * strikePrice) / (10**18);
        // Reordered to prevent overflow:
        // Assumes strikePrice is P_full_currency_tokens * 10**18_currency_decimals
        // and 10**18 is the currency_decimals factor.
        uint256 pricePerSmallestUnderlyingUnitInFullCurrency = strikePrice / (10**18);
        uint256 totalCost = amountToExerciseNow * pricePerSmallestUnderlyingUnitInFullCurrency;


        SafeTransferLib.safeTransferFrom(currency, holder, owner(), totalCost);
        SafeTransferLib.safeTransfer(underlying, holder, amountToExerciseNow);

    }
}
