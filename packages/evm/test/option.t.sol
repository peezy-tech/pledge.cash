// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "forge-std/Test.sol";
import "../src/option.sol"; // Assuming Option.sol is in ../src/

import {MockERC20} from "solady/../test/utils/mocks/MockERC20.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";

contract OptionTest is Test {
    Option public optionContract;
    MockERC20 public currencyToken;
    MockERC20 public underlyingToken;

    address public deployer; // Will be address(this) - the OptionTest contract itself
    address public holder; // Will be an EOA for holding the option
    address public otherUser = address(0x3); // For testing unauthorized access

    uint256 public constant INITIAL_CURRENCY_BALANCE = 1_000_000 * 10**18;
    uint256 public constant INITIAL_UNDERLYING_BALANCE = 1_000_000 * 10**18;

    // Option Parameters
    uint256 public optAmount = 100 * 10**18; // 100 tokens
    uint256 public optStrikePrice = 2 * 10**18; // 2 currency units per underlying
    uint256 public optTotalCost = optAmount * optStrikePrice; // Calculated for convenience

    uint256 public startTime;
    uint256 public optVestingCliff;
    uint256 public optVestingEnd;
    uint256 public optExpiry;

    event Exercise(address indexed _holder, uint256 _amountExercised, uint256 _costPaid); // Custom event for easier testing

    function setUp() public {
        deployer = address(this); // OptionTest contract is the deployer

        // 1. Deploy mock tokens
        currencyToken = new MockERC20("MockCurrency", "MCUR", 18);
        underlyingToken = new MockERC20("MockUnderlying", "MUND", 18);

        // Create a dedicated EOA for the option holder and other user
        holder = makeAddr("Holder");
        // otherUser is already defined as address(0x3) but can be labeled if needed for clarity in traces
        // vm.label(otherUser, "Other User"); // Already address(0x3)

        vm.label(deployer, "Deployer (OptionTest Contract)");
        vm.label(holder, "Option Holder");
        vm.label(address(currencyToken), "CurrencyToken (MCUR)");
        vm.label(address(underlyingToken), "UnderlyingToken (MUND)");

        // 2. Mint initial balances
        // Deployer (OptionTest contract) gets underlying tokens to fund the Option contract
        underlyingToken.mint(deployer, INITIAL_UNDERLYING_BALANCE);
        // Holder (EOA) gets currency tokens to exercise the option
        currencyToken.mint(holder, INITIAL_CURRENCY_BALANCE);

        // Define time parameters for the option based on current block timestamp
        startTime = block.timestamp;
        optVestingCliff = startTime + 1 weeks;
        optVestingEnd = optVestingCliff + 3 weeks; // Total 4 weeks vesting period
        optExpiry = optVestingEnd + 1 weeks; // MODIFIED: Option expires 1 week after full vesting

        // 3. Deployer (OptionTest contract) approves the predicted Option contract address
        // The Option constructor will pull 'optAmount' of 'underlyingToken' from 'msg.sender' (which will be 'deployer')
        address predictedOptionAddress = vm.computeCreateAddress(deployer, vm.getNonce(deployer)); // MODIFIED

        vm.prank(deployer); // Set msg.sender to OptionTest contract for the approval call
        underlyingToken.approve(predictedOptionAddress, optAmount);

        // 4. Deployer (OptionTest contract) deploys the Option contract
        vm.prank(deployer); // Set msg.sender to OptionTest contract for the constructor call
        optionContract = new Option(
            address(currencyToken),
            holder, // The EOA holder
            address(underlyingToken),
            optAmount,
            optStrikePrice,
            optExpiry,
            optVestingCliff,
            optVestingEnd
        );
        vm.label(address(optionContract), "OptionContract");

        // Check if prediction was correct (good for sanity)
        assertEq(address(optionContract), predictedOptionAddress, "Predicted Option contract address mismatch");

        // 5. Holder (EOA) approves Option contract for currency token transfer during exercise
        vm.prank(holder);
        currencyToken.approve(address(optionContract), type(uint256).max); // Approve max for simplicity in tests
    }

    // --- Test Constructor & Initial State ---

    function test_InitialState() public {
        assertEq(optionContract.currency(), address(currencyToken), "Currency mismatch");
        assertEq(optionContract.holder(), holder, "Holder mismatch");
        assertEq(optionContract.underlying(), address(underlyingToken), "Underlying mismatch");
        assertEq(optionContract.amount(), optAmount, "Amount mismatch");
        assertEq(optionContract.strikePrice(), optStrikePrice, "Strike price mismatch");
        assertEq(optionContract.expiry(), optExpiry, "Expiry mismatch");
        assertEq(optionContract.vestingCliff(), optVestingCliff, "Vesting cliff mismatch");
        assertEq(optionContract.vestingEnd(), optVestingEnd, "Vesting end mismatch");
        assertEq(optionContract.owner(), deployer, "Owner mismatch"); // Ownable owner
        assertEq(optionContract.exercisedAmount(), 0, "Initial exercised amount should be 0");

        // Check if underlying tokens were transferred to the contract
        assertEq(underlyingToken.balanceOf(address(optionContract)), optAmount, "Underlying not in contract");
        assertEq(underlyingToken.balanceOf(deployer), INITIAL_UNDERLYING_BALANCE - optAmount, "Deployer underlying balance incorrect");
    }

    function test_Revert_Deploy_CliffAfterEnd() public {
        vm.startPrank(deployer); // Prank as deployer for the following operations

        // Predict address for the Option contract that will be created.
        // The nonce used by new Option() will be the deployer's current nonce + 1 (due to the upcoming approve call).
        address predictedOptionAddr = vm.computeCreateAddress(deployer, vm.getNonce(deployer) + 1);

        // Approve this predicted address for the underlying token transfer.
        // This is deployer's 1st transaction in this sequence, nonce increments.
        underlyingToken.approve(predictedOptionAddr, optAmount);

        // Now, expect the specific revert from the Option constructor.
        vm.expectRevert(bytes("Option: cliff > end"));

        // Deploy the Option contract. This is deployer's 2nd transaction, uses the incremented nonce.
        // Its address should match predictedOptionAddr.
        new Option(
            address(currencyToken),
            holder,
            address(underlyingToken),
            optAmount,
            optStrikePrice,
            optExpiry,           // optExpiry from setUp is optVestingEnd + 1 weeks, which is valid.
            optVestingEnd + 1,   // Cliff after end - THIS IS THE INVALID PARAMETER.
            optVestingEnd
        );
        vm.stopPrank();
    }

    function test_Revert_Deploy_ExpiryAfterVestingEnd() public {
        vm.startPrank(deployer);

        address predictedOptionAddr = vm.computeCreateAddress(deployer, vm.getNonce(deployer) + 1);
        underlyingToken.approve(predictedOptionAddr, optAmount);

        vm.expectRevert(bytes("Option: expiry must be at or after vesting end"));
        new Option(
            address(currencyToken),
            holder,
            address(underlyingToken),
            optAmount,
            optStrikePrice,
            optVestingEnd - 1 days, // Expiry before vesting end - THIS IS THE INVALID PARAMETER.
            optVestingCliff,        // optVestingCliff from setUp is valid relative to optVestingEnd.
            optVestingEnd
        );
        vm.stopPrank();
    }

    // --- Test Exercise Functionality ---

    // Utility to calculate expected vested amount
    function getExpectedVestedAmount(uint256 currentTime) internal view returns (uint256) {
        if (currentTime < optVestingCliff) return 0;
        if (currentTime >= optVestingEnd) return optAmount;
        return (optAmount * (currentTime - optVestingCliff)) / (optVestingEnd - optVestingCliff);
    }

    function test_Revert_Exercise_BeforeCliff() public {
        vm.warp(optVestingCliff - 1 days); // Time before cliff
        vm.prank(holder);
        vm.expectRevert("Option: still in cliff period");
        optionContract.exercise(1); // Pass a dummy amount
    }

    function test_Revert_Exercise_AfterExpiry() public {
        vm.warp(optExpiry + 1 days); // Time after expiry
        vm.prank(holder);
        vm.expectRevert("Option: expired");
        optionContract.exercise(1); // Pass a dummy amount
    }

    function test_Revert_Exercise_NotHolder() public {
        vm.warp(optVestingCliff); // Valid time
        vm.prank(otherUser); // Not the holder
        vm.expectRevert("Option: only holder can exercise");
        optionContract.exercise(1); // Pass a dummy amount
    }

    function test_Revert_Exercise_InsufficientCurrency() public {
        // Burn holder's currency
        vm.prank(holder);
        currencyToken.burn(holder, currencyToken.balanceOf(holder)); // Burn all currency

        vm.warp(optVestingCliff + 1 days); // Valid time, some amount should vest
        uint256 vestedAmount = getExpectedVestedAmount(optVestingCliff + 1 days);
        assertTrue(vestedAmount > 0, "Should have vested amount");

        vm.prank(holder);
        // Exact revert message depends on SafeTransferLib, usually no specific message or "transfer amount exceeds balance"
        vm.expectRevert(); // ERC20: transfer amount exceeds balance (or similar)
        optionContract.exercise(vestedAmount);
    }

    function test_Exercise_AtCliff_Exactly() public {
        // The logic is `(amount * (timestamp - cliff)) / (end - cliff)`.
        // If timestamp == cliff, then numerator is 0, so vested is 0.
        // "Option: insufficient vested amount for request" will be triggered if trying to exercise >0.
        // Let's test exercising 1 second after cliff start.
        vm.warp(optVestingCliff + 1); // 1 second into vesting period after cliff
        uint256 expectedVested = getExpectedVestedAmount(optVestingCliff + 1);
        assertTrue(expectedVested > 0, "Expected vested should be > 0 just after cliff");

        uint256 cost = (expectedVested * optStrikePrice) / (10**18);

        vm.prank(holder);
        optionContract.exercise(expectedVested);

        assertEq(optionContract.exercisedAmount(), expectedVested, "Exercised amount mismatch at cliff");
        assertEq(underlyingToken.balanceOf(holder), expectedVested, "Holder underlying balance mismatch");
        assertEq(currencyToken.balanceOf(holder), INITIAL_CURRENCY_BALANCE - cost, "Holder currency balance mismatch");
        assertEq(currencyToken.balanceOf(deployer), cost, "Deployer currency balance mismatch"); // Owner gets payment
    }


    function test_Exercise_Partial_MidVesting() public {
        uint256 midTime = optVestingCliff + (optVestingEnd - optVestingCliff) / 2;
        vm.warp(midTime);

        uint256 expectedVested = getExpectedVestedAmount(midTime);
        assertTrue(expectedVested > 0 && expectedVested < optAmount, "Expected vested should be partial");
        uint256 cost = (expectedVested * optStrikePrice) / (10**18);

        vm.startPrank(holder);
        optionContract.exercise(expectedVested);
        vm.stopPrank();

        assertEq(optionContract.exercisedAmount(), expectedVested, "Exercised amount mismatch mid-vesting");
        assertEq(underlyingToken.balanceOf(holder), expectedVested, "Holder underlying balance mismatch");
        assertEq(currencyToken.balanceOf(holder), INITIAL_CURRENCY_BALANCE - cost, "Holder currency balance mismatch");
        assertEq(currencyToken.balanceOf(deployer), cost, "Deployer currency balance mismatch");
    }

    function test_Exercise_MultiplePartials_ExactVestedAmounts() public {
        // Time 1: 25% into vesting period (after cliff)
        uint256 time1 = optVestingCliff + (optVestingEnd - optVestingCliff) / 4;
        vm.warp(time1);

        uint256 vestedAtTime1 = getExpectedVestedAmount(time1);
        uint256 amountToExercise1 = vestedAtTime1; // Exercise all currently vested
        uint256 cost1 = (amountToExercise1 * optStrikePrice) / (10**18);

        vm.prank(holder);
        optionContract.exercise(amountToExercise1);

        assertEq(optionContract.exercisedAmount(), vestedAtTime1, "Exercised amount mismatch time1");
        assertEq(underlyingToken.balanceOf(holder), vestedAtTime1, "Holder underlying time1");
        assertEq(currencyToken.balanceOf(holder), INITIAL_CURRENCY_BALANCE - cost1, "Holder currency time1");
        assertEq(currencyToken.balanceOf(deployer), cost1, "Deployer currency time1");

        // Time 2: 75% into vesting period (after cliff)
        uint256 time2 = optVestingCliff + (optVestingEnd - optVestingCliff) * 3 / 4;
        vm.warp(time2);

        uint256 totalVestedAtTime2 = getExpectedVestedAmount(time2);
        uint256 alreadyExercised = optionContract.exercisedAmount();
        uint256 amountToExercise2 = totalVestedAtTime2 - alreadyExercised; // Exercise newly vested
        assertTrue(amountToExercise2 > 0, "Should have new amount to exercise at time2");
        uint256 cost2 = (amountToExercise2 * optStrikePrice) / (10**18);

        vm.prank(holder);
        optionContract.exercise(amountToExercise2);

        assertEq(optionContract.exercisedAmount(), totalVestedAtTime2, "Exercised amount mismatch time2");
        assertEq(underlyingToken.balanceOf(holder), totalVestedAtTime2, "Holder underlying time2");
        assertEq(currencyToken.balanceOf(holder), INITIAL_CURRENCY_BALANCE - cost1 - cost2, "Holder currency time2");
        assertEq(currencyToken.balanceOf(deployer), cost1 + cost2, "Deployer currency time2");
    }

    function test_Exercise_AtVestingEnd_FullAmount() public {
        vm.warp(optVestingEnd);

        uint256 amountToExercise = optAmount; // Should be fully vested
        uint256 cost = (amountToExercise * optStrikePrice) / (10**18);

        vm.prank(holder);
        optionContract.exercise(amountToExercise);

        assertEq(optionContract.exercisedAmount(), amountToExercise, "Exercised amount mismatch at vesting end");
        assertEq(underlyingToken.balanceOf(holder), amountToExercise, "Holder underlying balance at vesting end");
        assertEq(currencyToken.balanceOf(holder), INITIAL_CURRENCY_BALANCE - cost, "Holder currency balance at vesting end");
        assertEq(currencyToken.balanceOf(deployer), cost, "Deployer currency balance at vesting end");
    }

     function test_Exercise_AfterVestingEnd_FullAmount() public {
        vm.warp(optVestingEnd + 1 weeks); // Sometime after full vesting

        uint256 amountToExercise = optAmount;
        uint256 cost = (amountToExercise * optStrikePrice) / (10**18);

        vm.prank(holder);
        optionContract.exercise(amountToExercise);

        assertEq(optionContract.exercisedAmount(), amountToExercise, "Exercised amount mismatch after vesting end");
        assertEq(underlyingToken.balanceOf(holder), amountToExercise);
        assertEq(currencyToken.balanceOf(holder), INITIAL_CURRENCY_BALANCE - cost);
        assertEq(currencyToken.balanceOf(deployer), cost);
    }

    // Renaming and repurposing test_Revert_Exercise_NoNewVestedAmount
    function test_Revert_Exercise_InsufficientVested_IfTryToExerciseMoreThanAvailable() public {
        uint256 time1 = optVestingCliff + (optVestingEnd - optVestingCliff) / 2;
        vm.warp(time1);

        uint256 vestedAtTime1 = getExpectedVestedAmount(time1);
        uint256 amountToExercise1 = vestedAtTime1 / 2; // Exercise half of it
        assertTrue(amountToExercise1 > 0, "Amount to exercise should be > 0");

        vm.prank(holder);
        optionContract.exercise(amountToExercise1);

        uint256 remainingVested = vestedAtTime1 - amountToExercise1;
        assertTrue(remainingVested > 0, "Should have some vested amount remaining");

        vm.prank(holder);
        vm.expectRevert("Option: insufficient vested amount for request");
        optionContract.exercise(remainingVested + 1); // Try to exercise more than remaining vested
    }

    function test_Revert_Exercise_RequestExceedsTotal_AfterFullExercise() public {
        vm.warp(optVestingEnd); // Fully vested

        vm.prank(holder);
        optionContract.exercise(optAmount); // Exercise all

        // Try to exercise again, even 1 wei
        vm.prank(holder);
        // This revert comes from: require(exercisedAmount + _amountToExercise <= amount, "Option: request exceeds total available option amount");
        // Since exercisedAmount is optAmount, (optAmount + 1 <= optAmount) is false.
        vm.expectRevert("Option: request exceeds total available option amount");
        optionContract.exercise(1);
    }


    function test_Exercise_FullAmount_IfCliffIsZeroAndVestingEndReached() public {
        // Re-deploy with cliff = startTime
        vm.prank(deployer);
        address predicted = vm.computeCreateAddress(deployer, vm.getNonce(deployer));
        underlyingToken.approve(predicted, optAmount);

        uint256 newCliff = startTime;
        uint256 newEnd = startTime + 1 weeks;
        uint256 newExpiry = newEnd;

        Option localOption = new Option(
            address(currencyToken),
            holder,
            address(underlyingToken),
            optAmount,
            optStrikePrice,
            newExpiry,
            newCliff,
            newEnd
        );
        vm.label(address(localOption), "LocalOption_ZeroCliff");

        vm.prank(holder);
        currencyToken.approve(address(localOption), type(uint256).max);

        vm.warp(newEnd); // Warp to its vesting end

        uint256 amountToExercise = optAmount;
        uint256 cost = (amountToExercise * optStrikePrice) / (10**18);

        vm.prank(holder);
        localOption.exercise(amountToExercise);

        assertEq(localOption.exercisedAmount(), amountToExercise);
        assertEq(underlyingToken.balanceOf(holder), amountToExercise);
        assertEq(currencyToken.balanceOf(holder), INITIAL_CURRENCY_BALANCE - cost);
        assertEq(currencyToken.balanceOf(deployer), cost);
    }

    // --- New Tests for _amountToExercise parameter ---

    function test_Revert_Exercise_ZeroAmount() public {
        vm.warp(optVestingCliff + 1 days); // Valid time
        vm.prank(holder);
        vm.expectRevert("Option: amount must be > 0");
        optionContract.exercise(0);
    }

    function test_Revert_Exercise_AmountExceedsCurrentlyVested() public {
        uint256 midTime = optVestingCliff + (optVestingEnd - optVestingCliff) / 2;
        vm.warp(midTime);

        uint256 currentlyVested = getExpectedVestedAmount(midTime);
        assertTrue(currentlyVested < optAmount, "Vested amount should be less than total option amount");

        vm.prank(holder);
        vm.expectRevert("Option: insufficient vested amount for request");
        optionContract.exercise(currentlyVested + 1); // Try to exercise 1 more than vested
    }
    
    function test_Revert_Exercise_AmountExceedsTotalOptionAmount() public {
        vm.warp(optVestingEnd); // Fully vested, so all optAmount is available
        vm.prank(holder);
        vm.expectRevert("Option: request exceeds total available option amount");
        optionContract.exercise(optAmount + 1);
    }

    function test_Exercise_Partial_LessThanVested_ThenRemaining() public {
        uint256 midTime = optVestingCliff + (optVestingEnd - optVestingCliff) / 2;
        vm.warp(midTime);

        uint256 totalVestedAtMidTime = getExpectedVestedAmount(midTime);
        uint256 firstExerciseAmount = totalVestedAtMidTime / 2;
        assertTrue(firstExerciseAmount > 0, "First exercise amount should be > 0");

        uint256 cost1 = (firstExerciseAmount * optStrikePrice) / (10**18);

        // First partial exercise
        vm.prank(holder);
        optionContract.exercise(firstExerciseAmount);

        assertEq(optionContract.exercisedAmount(), firstExerciseAmount, "Exercised amount after first partial");
        assertEq(underlyingToken.balanceOf(holder), firstExerciseAmount, "Holder underlying after first partial");
        assertEq(currencyToken.balanceOf(holder), INITIAL_CURRENCY_BALANCE - cost1, "Holder currency after first partial");
        assertEq(currencyToken.balanceOf(deployer), cost1, "Deployer currency after first partial");

        uint256 remainingVestedAmount = totalVestedAtMidTime - firstExerciseAmount;
        assertTrue(remainingVestedAmount > 0, "Remaining vested amount should be > 0");
        uint256 cost2 = (remainingVestedAmount * optStrikePrice) / (10**18);

        // Second partial exercise (remaining of currently vested)
        vm.prank(holder);
        optionContract.exercise(remainingVestedAmount);

        assertEq(optionContract.exercisedAmount(), totalVestedAtMidTime, "Exercised amount after second partial");
        assertEq(underlyingToken.balanceOf(holder), totalVestedAtMidTime, "Holder underlying after second partial");
        assertEq(currencyToken.balanceOf(holder), INITIAL_CURRENCY_BALANCE - cost1 - cost2, "Holder currency after second partial");
        uint256 deployerBalanceAfter2 = cost1 + cost2;
        assertEq(currencyToken.balanceOf(deployer), deployerBalanceAfter2, "Deployer currency after second partial");
    }

    // test_Exercise_MultiplePartials_ArbitraryAmounts_WithinVestedLimits will be replaced by the following three tests:

    // Test 1: Simulates the first part of the original multi-stage test.
    function test_Exercise_FirstPartial_ArbitraryAmount() public {
        // Time 1: 30% into vesting period (after cliff)
        uint256 time1 = optVestingCliff + (optVestingEnd - optVestingCliff) * 3 / 10;
        vm.warp(time1);

        uint256 vestedAtTime1 = getExpectedVestedAmount(time1);
        uint256 amountToExercise1 = vestedAtTime1 / 2; // Exercise less than fully vested
        assertTrue(amountToExercise1 > 0, "Amount to exercise1 should be > 0");
        uint256 cost1 = (amountToExercise1 * optStrikePrice) / (10**18);

        vm.prank(holder);
        optionContract.exercise(amountToExercise1);

        assertEq(optionContract.exercisedAmount(), amountToExercise1, "Exercised amount after 1st part");
        assertEq(underlyingToken.balanceOf(holder), amountToExercise1, "Holder underlying after 1st part");
        assertEq(currencyToken.balanceOf(holder), INITIAL_CURRENCY_BALANCE - cost1, "Holder currency after 1st part");
        assertEq(currencyToken.balanceOf(deployer), cost1, "Deployer currency after 1st part");
    }

    // Test 2: Simulates the first two parts of the original multi-stage test.
    function test_Exercise_SecondPartial_ArbitraryAmount_AfterFirst() public {
        // ---- Setup first exercise ----
        uint256 time1 = optVestingCliff + (optVestingEnd - optVestingCliff) * 3 / 10;
        vm.warp(time1);
        uint256 vestedAtTime1 = getExpectedVestedAmount(time1);
        uint256 amountToExercise1 = vestedAtTime1 / 2;
        assertTrue(amountToExercise1 > 0);
        uint256 cost1 = (amountToExercise1 * optStrikePrice) / (10**18);
        vm.prank(holder);
        optionContract.exercise(amountToExercise1);
        // ---- End of first exercise setup ----

        // Time 2: 60% into vesting period (after cliff)
        uint256 time2 = optVestingCliff + (optVestingEnd - optVestingCliff) * 6 / 10;
        vm.warp(time2);

        uint256 totalVestedAtTime2 = getExpectedVestedAmount(time2);
        uint256 alreadyExercised = optionContract.exercisedAmount(); // Should be amountToExercise1
        uint256 availableToExerciseAtTime2 = totalVestedAtTime2 - alreadyExercised;
        uint256 amountToExercise2 = availableToExerciseAtTime2 / 2; // Exercise half of newly available
        assertTrue(amountToExercise2 > 0, "Amount to exercise2 should be > 0");
        uint256 cost2 = (amountToExercise2 * optStrikePrice) / (10**18);

        vm.prank(holder);
        optionContract.exercise(amountToExercise2);

        uint256 totalExercisedAfter2 = amountToExercise1 + amountToExercise2;
        assertEq(optionContract.exercisedAmount(), totalExercisedAfter2, "Exercised amount after 2nd part");
        assertEq(underlyingToken.balanceOf(holder), totalExercisedAfter2, "Holder underlying after 2nd part");
        assertEq(currencyToken.balanceOf(holder), INITIAL_CURRENCY_BALANCE - cost1 - cost2, "Holder currency after 2nd part");
        assertEq(currencyToken.balanceOf(deployer), cost1 + cost2, "Deployer currency after 2nd part");
    }

    // Test 3: Simulates all three parts, exercising fully at the end.
    function test_Exercise_FinalPartial_ArbitraryAmount_ToFullExercise() public {
        // ---- Setup first exercise ----
        uint256 time1 = optVestingCliff + (optVestingEnd - optVestingCliff) * 3 / 10;
        vm.warp(time1);
        uint256 vestedAtTime1 = getExpectedVestedAmount(time1);
        uint256 amountToExercise1 = vestedAtTime1 / 2;
        assertTrue(amountToExercise1 > 0);
        uint256 cost1 = (amountToExercise1 * optStrikePrice) / (10**18);
        vm.prank(holder);
        optionContract.exercise(amountToExercise1);
        // ---- End of first exercise setup ----

        // ---- Setup second exercise ----
        uint256 time2 = optVestingCliff + (optVestingEnd - optVestingCliff) * 6 / 10;
        vm.warp(time2);
        uint256 totalVestedAtTime2 = getExpectedVestedAmount(time2);
        uint256 alreadyExercisedAfter1 = optionContract.exercisedAmount();
        uint256 availableToExerciseAtTime2 = totalVestedAtTime2 - alreadyExercisedAfter1;
        uint256 amountToExercise2 = availableToExerciseAtTime2 / 2;
        assertTrue(amountToExercise2 > 0);
        uint256 cost2 = (amountToExercise2 * optStrikePrice) / (10**18);
        vm.prank(holder);
        optionContract.exercise(amountToExercise2);
        // ---- End of second exercise setup ----

        // Time 3: Fully Vested (at optVestingEnd)
        vm.warp(optVestingEnd);
        uint256 totalVestedAtTime3 = getExpectedVestedAmount(optVestingEnd); // should be optAmount
        uint256 alreadyExercisedAfter2 = optionContract.exercisedAmount();
        uint256 amountToExercise3 = totalVestedAtTime3 - alreadyExercisedAfter2; // Exercise all remaining
        assertTrue(amountToExercise3 > 0, "Amount to exercise3 should be > 0");
        uint256 cost3 = (amountToExercise3 * optStrikePrice) / (10**18);

        vm.prank(holder);
        optionContract.exercise(amountToExercise3);

        assertEq(optionContract.exercisedAmount(), optAmount, "Should be fully exercised");
        assertEq(underlyingToken.balanceOf(holder), optAmount, "Holder underlying should be full optAmount");
        // Corrected typo from user's diff: It should be subtraction of all costs
        assertEq(currencyToken.balanceOf(holder), INITIAL_CURRENCY_BALANCE - cost1 - cost2 - cost3, "Holder currency after full exercise");
        assertEq(currencyToken.balanceOf(deployer), cost1 + cost2 + cost3, "Deployer currency after full exercise");
    }


    // NOTE: The Solidity helper function computeCreateAddress was removed from here as it's not used.
    // The Forge cheatcode `vm.computeCreateAddress(address, uint256)` is used directly in tests like setUp and test_Revert_Deploy_CliffAfterEnd.
}
