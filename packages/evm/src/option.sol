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

    function exercise(uint256 _amountToExercise) external {
        require(block.timestamp <= expiry, "Option: expired");
        require(msg.sender == holder, "Option: only holder can exercise");
        require(_amountToExercise > 0, "Option: amount must be > 0");
        // Ensures that the sum of already exercised amount and the amount to exercise now
        // does not exceed the total option amount. This also implicitly handles
        // the case where the option might have been fully exercised already.
        require(exercisedAmount + _amountToExercise <= amount, "Option: request exceeds total available option amount");
        require(block.timestamp >= vestingCliff, "Option: still in cliff period");

        uint256 totalCurrentlyVested;
        if (block.timestamp >= vestingEnd) {
            totalCurrentlyVested = amount;
        } else {
            // Linear vesting between cliff and end
            totalCurrentlyVested = (amount * (block.timestamp - vestingCliff)) / (vestingEnd - vestingCliff);
        }

        // Calculate the amount that is vested and not yet exercised
        uint256 availableVestedAmount = totalCurrentlyVested - exercisedAmount;

        require(_amountToExercise <= availableVestedAmount, "Option: insufficient vested amount for request");

        // No longer need amountToExerciseNow based on total vested, we use the parameter
        // uint256 amountToExerciseNow = totalCurrentlyVested - exercisedAmount;
        // require(amountToExerciseNow > 0, "Option: no new vested amount to exercise");


        exercisedAmount += _amountToExercise;

        // Original: uint256 totalCost = (amountToExerciseNow * strikePrice) / (10**18);
        // Reordered to prevent overflow:
        // Assumes strikePrice is P_full_currency_tokens * 10**18_currency_decimals
        // and 10**18 is the currency_decimals factor.
        uint256 pricePerSmallestUnderlyingUnitInFullCurrency = strikePrice / (10**18);
        uint256 totalCost = _amountToExercise * pricePerSmallestUnderlyingUnitInFullCurrency;


        SafeTransferLib.safeTransferFrom(currency, holder, owner(), totalCost);
        SafeTransferLib.safeTransfer(underlying, holder, _amountToExercise);

    }
}
