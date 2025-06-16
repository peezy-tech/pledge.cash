// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import {Ownable} from "solady/auth/Ownable.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {Initializable} from "solady/utils/Initializable.sol";
import "forge-std/Test.sol";
import {LibClone} from "solady/utils/LibClone.sol";

contract OptionFactory {
    address public immutable optionLogic;

    event OptionCreated(address optionAddress, address indexed creator);

    constructor() {
        optionLogic = address(new OptionLogic());
    }

    function createOptionDeterministic(
        address _currency,
        address _holder,
        address _underlying,
        uint256 _amount,
        uint256 _strikePrice,
        uint256 _expiry,
        uint256 _vestingCliff,
        uint256 _vestingEnd,
        bytes32 salt
    ) external returns (address proxy) {
        proxy = _create2(
            abi.encodeWithSignature(
                "initialize(address,address,address,address,uint256,uint256,uint256,uint256,uint256)",
                msg.sender,
                _currency,
                _holder,
                _underlying,
                _amount,
                _strikePrice,
                _expiry,
                _vestingCliff,
                _vestingEnd
            ),
            salt
        );
        emit OptionCreated(proxy, msg.sender);
    }

    function _create(bytes memory data) internal returns (address proxy) {
        proxy = LibClone.clone(optionLogic);
        if (data.length > 0) {
            (bool success, bytes memory err) = proxy.call(data);
            if (!success) {
                assembly {
                    revert(add(err, 0x20), mload(err))
                }
            }
        }
    }

    function _create2(
        bytes memory data,
        bytes32 salt
    ) internal returns (address proxy) {
        proxy = LibClone.cloneDeterministic(optionLogic, salt);
        if (data.length > 0) {
            (bool success, bytes memory err) = proxy.call(data);
            if (!success) {
                assembly {
                    revert(add(err, 0x20), mload(err))
                }
            }
        }
    }
}

interface IERC20Metadata {
    function decimals() external view returns (uint8);
}

contract OptionLogic is Ownable, Initializable, Test {
    using SafeTransferLib for address;

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

    // Custom Errors
    error InvalidVestingSchedule();
    error InvalidExpiry();
    error OptionExpired();
    error OnlyHolder();
    error ZeroAmount();
    error AmountExceedsTotal(uint256 requested, uint256 available);
    error InsufficientVestedAmount(uint256 requested, uint256 vested);
    error VestingAlreadyHalted();
    error NotYetExpired();

    // Events
    event VestingHalted(uint256 vestedAtHalt, uint256 unvestedWithdrawn);
    event ExpiredTokensWithdrawn(uint256 amountWithdrawn);

    function initialize(
        address _owner,
        address _currency,
        address _holder,
        address _underlying,
        uint256 _amount,
        uint256 _strikePrice,
        uint256 _expiry,
        uint256 _vestingCliff,
        uint256 _vestingEnd
    ) external initializer {
        _initializeOwner(_owner);

        if (_vestingCliff > _vestingEnd) revert InvalidVestingSchedule();
        if (_expiry < _vestingEnd) revert InvalidExpiry();

        currency = _currency;
        underlying = _underlying;
        originalAmount = _amount; // Store original grant size
        amount = _amount; // Initially, full amount is potentially exercisable
        strikePrice = _strikePrice;
        expiry = _expiry;
        holder = _holder;
        vestingCliff = _vestingCliff;
        vestingEnd = _vestingEnd;

        SafeTransferLib.safeTransferFrom(
            _underlying,
            _owner,
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
    function getCurrentlyVestedSnapshot(
        uint256 _currentTime
    ) public view returns (uint256) {
        if (_currentTime < vestingCliff) {
            return 0;
        }

        uint256 effectiveVestingCapTime = vestingEnd;
        if (vestingIsHalted && vestingHaltTimestamp < effectiveVestingCapTime) {
            effectiveVestingCapTime = vestingHaltTimestamp;
        }

        if (_currentTime >= effectiveVestingCapTime) {
            // Vested up to the effective cap time (original end or halt time)
            if (effectiveVestingCapTime <= vestingCliff) {
                // handles halt at or before cliff
                return 0;
            }
            // Calculation based on originalAmount and original vestingEnd
            return
                (originalAmount * (effectiveVestingCapTime - vestingCliff)) /
                (vestingEnd - vestingCliff);
        } else {
            // _currentTime is between vestingCliff and effectiveVestingCapTime
            // Calculation based on originalAmount and original vestingEnd
            return
                (originalAmount * (_currentTime - vestingCliff)) /
                (vestingEnd - vestingCliff);
        }
    }

    function exercise(uint256 _amountToExercise) external {
        if (block.timestamp > expiry) revert OptionExpired();
        if (msg.sender != holder) revert OnlyHolder();
        if (_amountToExercise == 0) revert ZeroAmount();

        uint256 requestedTotal = exercisedAmount + _amountToExercise;
        if (requestedTotal > amount)
            revert AmountExceedsTotal({
                requested: requestedTotal,
                available: amount
            });
        // No explicit check for block.timestamp >= vestingCliff here, as getCurrentlyVestedSnapshot handles it.

        uint256 totalVestedUpToNow = getCurrentlyVestedSnapshot(
            block.timestamp
        );

        // Calculate the amount that is vested and not yet exercised
        uint256 availableVestedAmount = totalVestedUpToNow - exercisedAmount;

        if (_amountToExercise > availableVestedAmount)
            revert InsufficientVestedAmount({
                requested: _amountToExercise,
                vested: availableVestedAmount
            });

        exercisedAmount += _amountToExercise;

        // Calculate total cost properly handling different decimals
        // strikePrice is denominated per unit of underlying token
        // We need to scale the calculation to account for decimal differences
        uint256 underlyingDecimals = IERC20Metadata(underlying).decimals();
        uint256 currencyDecimals = IERC20Metadata(currency).decimals();

        uint256 totalCost;
        if (underlyingDecimals >= currencyDecimals) {
            // Scale down the amount to match currency precision
            totalCost =
                (_amountToExercise * strikePrice) /
                (10 ** underlyingDecimals);
        } else {
            // Scale up to match currency precision
            totalCost =
                (_amountToExercise *
                    strikePrice *
                    (10 ** (currencyDecimals - underlyingDecimals))) /
                (10 ** underlyingDecimals);
        }

        console.log("totalCost", totalCost);
        console.log("currency decimals", currencyDecimals);
        console.log("underlying decimals", underlyingDecimals);

        // Log balances before transfers
        console.log(
            "holder currency before",
            SafeTransferLib.balanceOf(currency, holder)
        );
        console.log(
            "owner currency before",
            SafeTransferLib.balanceOf(currency, owner())
        );
        console.log(
            "holder underlying before",
            SafeTransferLib.balanceOf(underlying, holder)
        );
        console.log(
            "contract underlying before",
            SafeTransferLib.balanceOf(underlying, address(this))
        );

        SafeTransferLib.safeTransferFrom(currency, holder, owner(), totalCost);
        SafeTransferLib.safeTransfer(underlying, holder, _amountToExercise);

        // Log balances after transfers
        console.log(
            "holder currency after",
            SafeTransferLib.balanceOf(currency, holder)
        );
        console.log(
            "owner currency after",
            SafeTransferLib.balanceOf(currency, owner())
        );
        console.log(
            "holder underlying after",
            SafeTransferLib.balanceOf(underlying, holder)
        );
        console.log(
            "contract underlying after",
            SafeTransferLib.balanceOf(underlying, address(this))
        );
    }

    /**
     * @dev Allows the owner to stop the vesting process.
     *      Unvested tokens (based on originalAmount) are returned to the owner.
     *      The option's `amount` is updated to what was vested at the time of halt.
     */
    function stopVestingAndWithdrawUnvested() external onlyOwner {
        if (vestingIsHalted) revert VestingAlreadyHalted();

        uint256 vestedAtHalt = getCurrentlyVestedSnapshot(block.timestamp);
        uint256 unvestedToWithdraw = originalAmount - vestedAtHalt;

        vestingIsHalted = true;
        vestingHaltTimestamp = block.timestamp;
        amount = vestedAtHalt; // This is the new ceiling for the option exercisability.

        if (unvestedToWithdraw > 0) {
            SafeTransferLib.safeTransfer(
                underlying,
                owner(),
                unvestedToWithdraw
            );
        }
        emit VestingHalted(vestedAtHalt, unvestedToWithdraw);
    }

    /**
     * @dev Allows the owner to withdraw any remaining underlying tokens from the contract after expiry.
     *      This includes tokens that were part of the option but never exercised.
     */
    function withdrawExpiredTokens() external onlyOwner {
        if (block.timestamp <= expiry) revert NotYetExpired();

        uint256 remainingBalance = SafeTransferLib.balanceOf(
            underlying,
            address(this)
        );
        if (remainingBalance > 0) {
            SafeTransferLib.safeTransfer(underlying, owner(), remainingBalance);
        }
        emit ExpiredTokensWithdrawn(remainingBalance);
    }
}

contract Option is Ownable, Initializable, Test {
    using SafeTransferLib for address;

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
        require(
            _expiry >= _vestingEnd,
            "Option: expiry must be at or after vesting end"
        );

        currency = _currency;
        underlying = _underlying;
        originalAmount = _amount; // Store original grant size
        amount = _amount; // Initially, full amount is potentially exercisable
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
    function getCurrentlyVestedSnapshot(
        uint256 _currentTime
    ) public view returns (uint256) {
        if (_currentTime < vestingCliff) {
            return 0;
        }

        uint256 effectiveVestingCapTime = vestingEnd;
        if (vestingIsHalted && vestingHaltTimestamp < effectiveVestingCapTime) {
            effectiveVestingCapTime = vestingHaltTimestamp;
        }

        if (_currentTime >= effectiveVestingCapTime) {
            // Vested up to the effective cap time (original end or halt time)
            if (effectiveVestingCapTime <= vestingCliff) {
                // handles halt at or before cliff
                return 0;
            }
            // Calculation based on originalAmount and original vestingEnd
            return
                (originalAmount * (effectiveVestingCapTime - vestingCliff)) /
                (vestingEnd - vestingCliff);
        } else {
            // _currentTime is between vestingCliff and effectiveVestingCapTime
            // Calculation based on originalAmount and original vestingEnd
            return
                (originalAmount * (_currentTime - vestingCliff)) /
                (vestingEnd - vestingCliff);
        }
    }

    function exercise(uint256 _amountToExercise) external {
        require(block.timestamp <= expiry, "Option: expired");
        require(msg.sender == holder, "Option: only holder can exercise");
        require(_amountToExercise > 0, "Option: amount must be > 0");
        // Check against the current `amount`, which is the max exercisable (potentially reduced by halt)
        require(
            exercisedAmount + _amountToExercise <= amount,
            "Option: request exceeds total available option amount"
        );
        // No explicit check for block.timestamp >= vestingCliff here, as getCurrentlyVestedSnapshot handles it.

        uint256 totalVestedUpToNow = getCurrentlyVestedSnapshot(
            block.timestamp
        );

        // Calculate the amount that is vested and not yet exercised
        uint256 availableVestedAmount = totalVestedUpToNow - exercisedAmount;

        require(
            _amountToExercise <= availableVestedAmount,
            "Option: insufficient vested amount for request"
        );

        exercisedAmount += _amountToExercise;

        // Calculate total cost properly handling different decimals
        // strikePrice is denominated per unit of underlying token
        // We need to scale the calculation to account for decimal differences
        uint256 underlyingDecimals = IERC20Metadata(underlying).decimals();
        uint256 currencyDecimals = IERC20Metadata(currency).decimals();

        uint256 totalCost;
        if (underlyingDecimals >= currencyDecimals) {
            // Scale down the amount to match currency precision
            totalCost =
                (_amountToExercise * strikePrice) /
                (10 ** underlyingDecimals);
        } else {
            // Scale up to match currency precision
            totalCost =
                (_amountToExercise *
                    strikePrice *
                    (10 ** (currencyDecimals - underlyingDecimals))) /
                (10 ** underlyingDecimals);
        }

        console.log("totalCost", totalCost);
        console.log("currency decimals", currencyDecimals);
        console.log("underlying decimals", underlyingDecimals);

        // Log balances before transfers
        console.log(
            "holder currency before",
            SafeTransferLib.balanceOf(currency, holder)
        );
        console.log(
            "owner currency before",
            SafeTransferLib.balanceOf(currency, owner())
        );
        console.log(
            "holder underlying before",
            SafeTransferLib.balanceOf(underlying, holder)
        );
        console.log(
            "contract underlying before",
            SafeTransferLib.balanceOf(underlying, address(this))
        );

        SafeTransferLib.safeTransferFrom(currency, holder, owner(), totalCost);
        SafeTransferLib.safeTransfer(underlying, holder, _amountToExercise);

        // Log balances after transfers
        console.log(
            "holder currency after",
            SafeTransferLib.balanceOf(currency, holder)
        );
        console.log(
            "owner currency after",
            SafeTransferLib.balanceOf(currency, owner())
        );
        console.log(
            "holder underlying after",
            SafeTransferLib.balanceOf(underlying, holder)
        );
        console.log(
            "contract underlying after",
            SafeTransferLib.balanceOf(underlying, address(this))
        );
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
            SafeTransferLib.safeTransfer(
                underlying,
                owner(),
                unvestedToWithdraw
            );
        }
        emit VestingHalted(vestedAtHalt, unvestedToWithdraw);
    }

    /**
     * @dev Allows the owner to withdraw any remaining underlying tokens from the contract after expiry.
     *      This includes tokens that were part of the option but never exercised.
     */
    function withdrawExpiredTokens() external onlyOwner {
        require(block.timestamp > expiry, "Option: not yet expired");

        uint256 remainingBalance = SafeTransferLib.balanceOf(
            underlying,
            address(this)
        );
        if (remainingBalance > 0) {
            SafeTransferLib.safeTransfer(underlying, owner(), remainingBalance);
        }
        emit ExpiredTokensWithdrawn(remainingBalance);
    }
}
