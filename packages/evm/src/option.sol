// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import {Ownable} from "solady/auth/Ownable.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";

contract Option is Ownable {
    address public underlying;
    uint256 public amount; // Max exercisable tokens. Reduced if vesting is halted.
    uint256 public strikePrice;
    uint256 public expiry;
    address public holder;
    address public currency;
    uint256 public vestingCliff;
    uint256 public vestingEnd;
    uint256 public exercisedAmount; // Tracks the amount already exercised

    // New state variables for vesting halt feature
    uint256 public originalAmount; // The initial total grant size
    bool public vestingIsHalted;
    uint256 public vestingHaltTimestamp;

    // Events
    event VestingHalted(uint256 vestedAtHalt, uint256 unvestedWithdrawn);
    event ExpiredTokensWithdrawn(uint256 amountWithdrawn);


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
        originalAmount = _amount; // Store original grant size
        amount = _amount;         // Initially, full amount is potentially exercisable
        strikePrice = _strikePrice;
        expiry = _expiry;
        holder = _holder;
        vestingCliff = _vestingCliff;
        vestingEnd = _vestingEnd;

        SafeTransferLib.safeTransferFrom(
            _underlying,
            msg.sender,
            address(this),
            originalAmount // Transfer the full original amount to the contract
        );
    }

    /**
     * @dev Calculates the amount of tokens that should have vested by a given time,
     *      considering the original vesting schedule and any potential halt.
     * @param _currentTime The timestamp to calculate vested amount for.
     * @return The amount vested by _currentTime based on original parameters, capped by halt time.
     */
    function getCurrentlyVestedSnapshot(uint256 _currentTime) public view returns (uint256) {
        if (_currentTime < vestingCliff) {
            return 0;
        }

        uint256 effectiveVestingCapTime = vestingEnd;
        if (vestingIsHalted && vestingHaltTimestamp < effectiveVestingCapTime) {
            effectiveVestingCapTime = vestingHaltTimestamp;
        }

        if (_currentTime >= effectiveVestingCapTime) {
            // Vested up to the effective cap time (original end or halt time)
            if (effectiveVestingCapTime <= vestingCliff) { // handles halt at or before cliff
                return 0;
            }
            // Calculation based on originalAmount and original vestingEnd
            return (originalAmount * (effectiveVestingCapTime - vestingCliff)) / (vestingEnd - vestingCliff);
        } else {
            // _currentTime is between vestingCliff and effectiveVestingCapTime
            // Calculation based on originalAmount and original vestingEnd
            return (originalAmount * (_currentTime - vestingCliff)) / (vestingEnd - vestingCliff);
        }
    }

    function exercise(uint256 _amountToExercise) external {
        require(block.timestamp <= expiry, "Option: expired");
        require(msg.sender == holder, "Option: only holder can exercise");
        require(_amountToExercise > 0, "Option: amount must be > 0");
        // Check against the current `amount`, which is the max exercisable (potentially reduced by halt)
        require(exercisedAmount + _amountToExercise <= amount, "Option: request exceeds total available option amount");
        // No explicit check for block.timestamp >= vestingCliff here, as getCurrentlyVestedSnapshot handles it.

        uint256 totalVestedUpToNow = getCurrentlyVestedSnapshot(block.timestamp);

        // Calculate the amount that is vested and not yet exercised
        uint256 availableVestedAmount = totalVestedUpToNow - exercisedAmount;

        require(_amountToExercise <= availableVestedAmount, "Option: insufficient vested amount for request");

        exercisedAmount += _amountToExercise;

        uint256 pricePerSmallestUnderlyingUnitInFullCurrency = strikePrice / (10**18);
        uint256 totalCost = _amountToExercise * pricePerSmallestUnderlyingUnitInFullCurrency;

        SafeTransferLib.safeTransferFrom(currency, holder, owner(), totalCost);
        SafeTransferLib.safeTransfer(underlying, holder, _amountToExercise);
    }

    /**
     * @dev Allows the owner to stop the vesting process.
     *      Unvested tokens (based on originalAmount) are returned to the owner.
     *      The option's `amount` is updated to what was vested at the time of halt.
     */
    function stopVestingAndWithdrawUnvested() external onlyOwner {
        require(!vestingIsHalted, "Option: vesting already halted");

        uint256 vestedAtHalt = getCurrentlyVestedSnapshot(block.timestamp);
        uint256 unvestedToWithdraw = originalAmount - vestedAtHalt;

        vestingIsHalted = true;
        vestingHaltTimestamp = block.timestamp;
        amount = vestedAtHalt; // This is the new ceiling for the option exercisability.

        if (unvestedToWithdraw > 0) {
            SafeTransferLib.safeTransfer(underlying, owner(), unvestedToWithdraw);
        }
        emit VestingHalted(vestedAtHalt, unvestedToWithdraw);
    }

    /**
     * @dev Allows the owner to withdraw any remaining underlying tokens from the contract after expiry.
     *      This includes tokens that were part of the option but never exercised.
     */
    function withdrawExpiredTokens() external onlyOwner {
        require(block.timestamp > expiry, "Option: not yet expired");

        uint256 remainingBalance = SafeTransferLib.balanceOf(underlying, address(this));
        if (remainingBalance > 0) {
            SafeTransferLib.safeTransfer(underlying, owner(), remainingBalance);
        }
        emit ExpiredTokensWithdrawn(remainingBalance);
    }
}
