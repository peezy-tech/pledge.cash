// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "forge-std/Test.sol";
import {Option} from "../src/option.sol"; // Assuming Option.sol is in ../src/

import {MockERC20} from "solady/../test/utils/mocks/MockERC20.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {Ownable} from "solady/auth/Ownable.sol";

contract OptionTest is Test {
    Option public optionContract;
    MockERC20 public currencyToken;
    MockERC20 public underlyingToken;

    address public deployer; // Will be address(this) - the OptionTest contract itself
    address public holder; // Will be an EOA for holding the option
    address public otherUser = address(0x3); // For testing unauthorized access

    uint256 public constant INITIAL_CURRENCY_BALANCE = 200 * 10 ** 6;
    uint256 public constant INITIAL_UNDERLYING_BALANCE = 1_000_000 * 10 ** 6;

    // Option Parameters
    uint256 public optAmount = 100 * 10 ** 6; // 100 tokens (this will be originalAmount)
    uint256 public optStrikePrice = 2 * 10 ** 6; // 2 currency units per underlying
    // uint256 public optTotalCost = optAmount * optStrikePrice; // Calculated for convenience - careful if optAmount changes conceptually

    uint256 public startTime;
    uint256 public optVestingCliff;
    uint256 public optVestingEnd;
    uint256 public optExpiry;

    event VestingHalted(uint256 vestedAtHalt, uint256 unvestedWithdrawn);
    event ExpiredTokensWithdrawn(uint256 amountWithdrawn);

    // Event Exercise is not standard, let's keep Option events for now.
    // event Exercise(address indexed _holder, uint256 _amountExercised, uint256 _costPaid); // Custom event for easier testing

    function setUp() public {
        deployer = address(this); // OptionTest contract is the deployer

        // 1. Deploy mock tokens
        currencyToken = new MockERC20("MockCurrency", "MCUR", 6);
        underlyingToken = new MockERC20("MockUnderlying", "MUND", 6);

        holder = makeAddr("Holder");

        vm.label(deployer, "Deployer (OptionTest Contract)");
        vm.label(holder, "Option Holder");
        vm.label(otherUser, "OtherUser");
        vm.label(address(currencyToken), "CurrencyToken (MCUR)");
        vm.label(address(underlyingToken), "UnderlyingToken (MUND)");

        // 2. Mint initial balances
        underlyingToken.mint(deployer, INITIAL_UNDERLYING_BALANCE);
        currencyToken.mint(holder, INITIAL_CURRENCY_BALANCE);

        startTime = block.timestamp;
        optVestingCliff = startTime + 1 weeks;
        optVestingEnd = optVestingCliff + 3 weeks; // Total 4 weeks vesting period
        optExpiry = optVestingEnd + 1 weeks;

        address predictedOptionAddress = vm.computeCreateAddress(
            deployer,
            vm.getNonce(deployer)
        );

        vm.prank(deployer);
        underlyingToken.approve(predictedOptionAddress, optAmount);

        vm.prank(deployer);
        optionContract = new Option(
            address(currencyToken),
            holder,
            address(underlyingToken),
            optAmount,
            optStrikePrice,
            optExpiry,
            optVestingCliff,
            optVestingEnd
        );
        vm.label(address(optionContract), "OptionContract");
        assertEq(
            address(optionContract),
            predictedOptionAddress,
            "Predicted Option contract address mismatch"
        );

        vm.prank(holder);
        currencyToken.approve(address(optionContract), type(uint256).max);
    }

    // --- Test Constructor & Initial State ---

    function test_InitialState() public {
        assertEq(
            optionContract.currency(),
            address(currencyToken),
            "Currency mismatch"
        );
        assertEq(optionContract.holder(), holder, "Holder mismatch");
        assertEq(
            optionContract.underlying(),
            address(underlyingToken),
            "Underlying mismatch"
        );
        assertEq(
            optionContract.originalAmount(),
            optAmount,
            "OriginalAmount mismatch"
        );
        assertEq(
            optionContract.amount(),
            optAmount,
            "Amount mismatch initially"
        );
        assertEq(
            optionContract.strikePrice(),
            optStrikePrice,
            "Strike price mismatch"
        );
        assertEq(optionContract.expiry(), optExpiry, "Expiry mismatch");
        assertEq(
            optionContract.vestingCliff(),
            optVestingCliff,
            "Vesting cliff mismatch"
        );
        assertEq(
            optionContract.vestingEnd(),
            optVestingEnd,
            "Vesting end mismatch"
        );
        assertEq(optionContract.owner(), deployer, "Owner mismatch");
        assertEq(
            optionContract.exercisedAmount(),
            0,
            "Initial exercised amount should be 0"
        );
        assertEq(
            optionContract.vestingIsHalted(),
            false,
            "Vesting should not be halted initially"
        );
        assertEq(
            optionContract.vestingHaltTimestamp(),
            0,
            "Vesting halt timestamp should be 0 initially"
        );

        assertEq(
            underlyingToken.balanceOf(address(optionContract)),
            optAmount,
            "Underlying not in contract"
        );
        assertEq(
            underlyingToken.balanceOf(deployer),
            INITIAL_UNDERLYING_BALANCE - optAmount,
            "Deployer underlying balance incorrect"
        );
    }

    function test_Revert_Deploy_CliffAfterEnd() public {
        vm.startPrank(deployer); // Prank as deployer for the following operations

        // Predict address for the Option contract that will be created.
        // The nonce used by new Option() will be the deployer's current nonce + 1 (due to the upcoming approve call).
        address predictedOptionAddr = vm.computeCreateAddress(
            deployer,
            vm.getNonce(deployer) + 1
        );

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
            optExpiry, // optExpiry from setUp is optVestingEnd + 1 weeks, which is valid.
            optVestingEnd + 1, // Cliff after end - THIS IS THE INVALID PARAMETER.
            optVestingEnd
        );
        vm.stopPrank();
    }

    function test_Revert_Deploy_ExpiryAfterVestingEnd() public {
        vm.startPrank(deployer);

        address predictedOptionAddr = vm.computeCreateAddress(
            deployer,
            vm.getNonce(deployer) + 1
        );
        underlyingToken.approve(predictedOptionAddr, optAmount);

        vm.expectRevert(
            bytes("Option: expiry must be at or after vesting end")
        );
        new Option(
            address(currencyToken),
            holder,
            address(underlyingToken),
            optAmount,
            optStrikePrice,
            optVestingEnd - 1 days, // Expiry before vesting end - THIS IS THE INVALID PARAMETER.
            optVestingCliff, // optVestingCliff from setUp is valid relative to optVestingEnd.
            optVestingEnd
        );
        vm.stopPrank();
    }

    // --- Test Exercise Functionality ---

    // Utility to calculate expected vested amount based on original parameters
    function getExpectedOriginalVestedAmount(
        uint256 currentTime
    ) internal view returns (uint256) {
        if (currentTime < optionContract.vestingCliff()) return 0;
        if (currentTime >= optionContract.vestingEnd())
            return optionContract.originalAmount();
        return
            (optionContract.originalAmount() *
                (currentTime - optionContract.vestingCliff())) /
            (optionContract.vestingEnd() - optionContract.vestingCliff());
    }

    // Utility to calculate expected vested snapshot considering halt
    function getExpectedVestedSnapshot(
        uint256 currentTime
    ) internal view returns (uint256) {
        if (currentTime < optionContract.vestingCliff()) return 0;

        uint256 effectiveVestingCapTime = optionContract.vestingEnd();
        if (
            optionContract.vestingIsHalted() &&
            optionContract.vestingHaltTimestamp() < effectiveVestingCapTime
        ) {
            effectiveVestingCapTime = optionContract.vestingHaltTimestamp();
        }

        if (currentTime >= effectiveVestingCapTime) {
            if (effectiveVestingCapTime <= optionContract.vestingCliff())
                return 0;
            return
                (optionContract.originalAmount() *
                    (effectiveVestingCapTime - optionContract.vestingCliff())) /
                (optionContract.vestingEnd() - optionContract.vestingCliff());
        } else {
            return
                (optionContract.originalAmount() *
                    (currentTime - optionContract.vestingCliff())) /
                (optionContract.vestingEnd() - optionContract.vestingCliff());
        }
    }

    function test_Revert_Exercise_BeforeCliff() public {
        vm.warp(optVestingCliff - 1 days); // Time before cliff
        vm.prank(holder);
        // The internal getCurrentlyVestedSnapshot will return 0, leading to availableVestedAmount = 0.
        // So, exercising any amount > 0 will fail here.
        vm.expectRevert("Option: insufficient vested amount for request");
        optionContract.exercise(1);
    }

    function test_Exercise_AtCliff_Exactly() public {
        // At the exact cliff time, vested amount snapshot is 0.
        vm.warp(optVestingCliff);
        uint256 expectedVested = getExpectedVestedSnapshot(optVestingCliff);
        assertEq(
            expectedVested,
            0,
            "Expected vested should be 0 at exact cliff time"
        );

        vm.prank(holder);
        vm.expectRevert("Option: insufficient vested amount for request");
        optionContract.exercise(1); // Cannot exercise anything yet

        // Let's test exercising 1 second after cliff start.
        vm.warp(optVestingCliff + 1);
        expectedVested = getExpectedVestedSnapshot(optVestingCliff + 1);
        assertTrue(
            expectedVested > 0,
            "Expected vested should be > 0 just after cliff"
        );

        uint256 cost = (expectedVested * optStrikePrice) / (10 ** 6);

        vm.prank(holder);
        optionContract.exercise(expectedVested);

        assertEq(
            optionContract.exercisedAmount(),
            expectedVested,
            "Exercised amount mismatch at cliff"
        );
        assertEq(
            underlyingToken.balanceOf(holder),
            expectedVested,
            "Holder underlying balance mismatch"
        );
        assertEq(
            currencyToken.balanceOf(holder),
            INITIAL_CURRENCY_BALANCE - cost,
            "Holder currency balance mismatch"
        );
        assertEq(
            currencyToken.balanceOf(deployer),
            cost,
            "Deployer currency balance mismatch"
        );
    }

    function test_Exercise_Partial_MidVesting() public {
        uint256 midTime = optVestingCliff +
            (optVestingEnd - optVestingCliff) /
            2;
        vm.warp(midTime);

        uint256 expectedVested = getExpectedVestedSnapshot(midTime);
        assertTrue(
            expectedVested > 0 &&
                expectedVested < optionContract.originalAmount(),
            "Expected vested should be partial"
        );
        uint256 cost = (expectedVested * optStrikePrice) / (10 ** 6);

        vm.startPrank(holder);
        optionContract.exercise(expectedVested);
        vm.stopPrank();

        assertEq(
            optionContract.exercisedAmount(),
            expectedVested,
            "Exercised amount mismatch mid-vesting"
        );
        assertEq(
            underlyingToken.balanceOf(holder),
            expectedVested,
            "Holder underlying balance mismatch"
        );
        assertEq(
            currencyToken.balanceOf(holder),
            INITIAL_CURRENCY_BALANCE - cost,
            "Holder currency balance mismatch"
        );
        assertEq(
            currencyToken.balanceOf(deployer),
            cost,
            "Deployer currency balance mismatch"
        );
    }

    function test_Exercise_MultiplePartials_ExactVestedAmounts() public {
        uint256 time1 = optVestingCliff + (optVestingEnd - optVestingCliff) / 4;
        vm.warp(time1);

        uint256 vestedAtTime1 = getExpectedVestedSnapshot(time1);
        uint256 amountToExercise1 = vestedAtTime1;
        uint256 cost1 = (amountToExercise1 * optStrikePrice) / (10 ** 6);

        vm.prank(holder);
        optionContract.exercise(amountToExercise1);

        console.log(
            "Assert: exercisedAmount at time1. Expected:",
            vestedAtTime1,
            "Actual:",
            optionContract.exercisedAmount()
        );
        assertEq(
            optionContract.exercisedAmount(),
            vestedAtTime1,
            "Exercised amount mismatch time1"
        );

        console.log(
            "Assert: holder underlying at time1. Expected:",
            vestedAtTime1,
            "Actual:",
            underlyingToken.balanceOf(holder)
        );
        assertEq(
            underlyingToken.balanceOf(holder),
            vestedAtTime1,
            "Holder underlying time1"
        );

        console.log(
            "Assert: holder currency at time1. Expected:",
            INITIAL_CURRENCY_BALANCE - cost1,
            "Actual:",
            currencyToken.balanceOf(holder)
        );
        assertEq(
            currencyToken.balanceOf(holder),
            INITIAL_CURRENCY_BALANCE - cost1,
            "Holder currency time1"
        );

        console.log(
            "Assert: deployer currency at time1. Expected:",
            cost1,
            "Actual:",
            currencyToken.balanceOf(deployer)
        );
        assertEq(
            currencyToken.balanceOf(deployer),
            cost1,
            "Deployer currency time1"
        );

        uint256 time2 = optVestingCliff +
            ((optVestingEnd - optVestingCliff) * 3) /
            4;
        vm.warp(time2);

        uint256 totalVestedAtTime2_snapshot = getExpectedVestedSnapshot(time2);
        uint256 alreadyExercised = optionContract.exercisedAmount();
        uint256 amountToExercise2 = totalVestedAtTime2_snapshot -
            alreadyExercised;
        console.log(
            "Assert: amountToExercise2 > 0. Actual:",
            amountToExercise2
        );
        assertTrue(
            amountToExercise2 > 0,
            "Should have new amount to exercise at time2"
        );
        uint256 cost2 = (amountToExercise2 * optStrikePrice) / (10 ** 6);

        vm.prank(holder);
        optionContract.exercise(amountToExercise2);

        console.log(
            "Assert: exercisedAmount at time2. Expected:",
            totalVestedAtTime2_snapshot,
            "Actual:",
            optionContract.exercisedAmount()
        );
        assertEq(
            optionContract.exercisedAmount(),
            totalVestedAtTime2_snapshot,
            "Exercised amount mismatch time2"
        );

        console.log(
            "Assert: holder underlying at time2. Expected:",
            totalVestedAtTime2_snapshot,
            "Actual:",
            underlyingToken.balanceOf(holder)
        );
        assertEq(
            underlyingToken.balanceOf(holder),
            totalVestedAtTime2_snapshot,
            "Holder underlying time2"
        );

        console.log(
            "Assert: holder currency at time2. Expected:",
            INITIAL_CURRENCY_BALANCE - cost1 - cost2,
            "Actual:",
            currencyToken.balanceOf(holder)
        );
        assertEq(
            currencyToken.balanceOf(holder),
            INITIAL_CURRENCY_BALANCE - cost1 - cost2,
            "Holder currency time2"
        );

        console.log(
            "Assert: deployer currency at time2. Expected:",
            cost1 + cost2,
            "Actual:",
            currencyToken.balanceOf(deployer)
        );
        assertEq(
            currencyToken.balanceOf(deployer),
            cost1 + cost2,
            "Deployer currency time2"
        );
    }

    function test_Exercise_AtVestingEnd_FullAmount() public {
        vm.warp(optVestingEnd);

        uint256 amountToExercise = optionContract.originalAmount();
        uint256 cost = (amountToExercise * optStrikePrice) / (10 ** 6);

        vm.prank(holder);
        optionContract.exercise(amountToExercise);

        assertEq(
            optionContract.exercisedAmount(),
            amountToExercise,
            "Exercised amount mismatch at vesting end"
        );
        assertEq(
            underlyingToken.balanceOf(holder),
            amountToExercise,
            "Holder underlying balance at vesting end"
        );
        assertEq(
            currencyToken.balanceOf(holder),
            INITIAL_CURRENCY_BALANCE - cost,
            "Holder currency balance at vesting end"
        );
        assertEq(
            currencyToken.balanceOf(deployer),
            cost,
            "Deployer currency balance at vesting end"
        );
    }

    function test_Exercise_AfterVestingEnd_FullAmount() public {
        vm.warp(optVestingEnd + 1 weeks);

        uint256 amountToExercise = optionContract.originalAmount();
        uint256 cost = (amountToExercise * optStrikePrice) / (10 ** 6);

        vm.prank(holder);
        optionContract.exercise(amountToExercise);

        assertEq(
            optionContract.exercisedAmount(),
            amountToExercise,
            "Exercised amount mismatch after vesting end"
        );
        assertEq(underlyingToken.balanceOf(holder), amountToExercise);
        assertEq(
            currencyToken.balanceOf(holder),
            INITIAL_CURRENCY_BALANCE - cost
        );
        assertEq(currencyToken.balanceOf(deployer), cost);
    }

    function test_Revert_Exercise_InsufficientVested_IfTryToExerciseMoreThanAvailable()
        public
    {
        uint256 time1 = optVestingCliff + (optVestingEnd - optVestingCliff) / 2;
        vm.warp(time1);

        uint256 vestedAtTime1_snapshot = getExpectedVestedSnapshot(time1);
        uint256 amountToExercise1 = vestedAtTime1_snapshot / 2;
        assertTrue(amountToExercise1 > 0, "Amount to exercise should be > 0");

        vm.prank(holder);
        optionContract.exercise(amountToExercise1);

        uint256 remainingVested_snapshot = vestedAtTime1_snapshot -
            amountToExercise1;
        assertTrue(
            remainingVested_snapshot > 0,
            "Should have some vested amount remaining from snapshot"
        );

        vm.prank(holder);
        vm.expectRevert("Option: insufficient vested amount for request");
        optionContract.exercise(remainingVested_snapshot + 1);
    }

    function test_Revert_Exercise_AmountExceedsCurrentlyVested() public {
        uint256 midTime = optVestingCliff +
            (optVestingEnd - optVestingCliff) /
            2;
        vm.warp(midTime);

        uint256 currentlyVested_snapshot = getExpectedVestedSnapshot(midTime);
        assertTrue(
            currentlyVested_snapshot < optionContract.originalAmount(),
            "Vested amount snapshot should be less than total option amount"
        );

        vm.prank(holder);
        vm.expectRevert("Option: insufficient vested amount for request");
        optionContract.exercise(currentlyVested_snapshot + 1);
    }

    function test_Revert_Exercise_AmountExceedsTotalOptionAmount() public {
        vm.warp(optVestingEnd); // Fully vested, so all originalAmount is available by snapshot
        vm.startPrank(holder);
        // amount() is still originalAmount here
        uint256 amountToExercise = optionContract.originalAmount() + 1;
        vm.expectRevert(
            "Option: request exceeds total available option amount"
        );
        optionContract.exercise(amountToExercise);
        vm.stopPrank();
    }

    function test_Exercise_Partial_LessThanVested_ThenRemaining() public {
        uint256 midTime = optVestingCliff +
            (optVestingEnd - optVestingCliff) /
            2;
        vm.warp(midTime);

        uint256 totalVestedAtMidTime_snapshot = getExpectedVestedSnapshot(
            midTime
        );
        uint256 firstExerciseAmount = totalVestedAtMidTime_snapshot / 2;
        assertTrue(
            firstExerciseAmount > 0,
            "First exercise amount should be > 0"
        );

        uint256 cost1 = (firstExerciseAmount * optStrikePrice) / (10 ** 6);

        vm.prank(holder);
        optionContract.exercise(firstExerciseAmount);

        assertEq(
            optionContract.exercisedAmount(),
            firstExerciseAmount,
            "Exercised amount after first partial"
        );
        assertEq(
            underlyingToken.balanceOf(holder),
            firstExerciseAmount,
            "Holder underlying after first partial"
        );
        assertEq(
            currencyToken.balanceOf(holder),
            INITIAL_CURRENCY_BALANCE - cost1,
            "Holder currency after first partial"
        );
        assertEq(
            currencyToken.balanceOf(deployer),
            cost1,
            "Deployer currency after first partial"
        );

        uint256 remainingVestedAmount_snapshot = totalVestedAtMidTime_snapshot -
            firstExerciseAmount;
        assertTrue(
            remainingVestedAmount_snapshot > 0,
            "Remaining vested amount from snapshot should be > 0"
        );
        uint256 cost2 = (remainingVestedAmount_snapshot * optStrikePrice) /
            (10 ** 6);

        vm.prank(holder);
        optionContract.exercise(remainingVestedAmount_snapshot);

        assertEq(
            optionContract.exercisedAmount(),
            totalVestedAtMidTime_snapshot,
            "Exercised amount after second partial"
        );
        assertEq(
            underlyingToken.balanceOf(holder),
            totalVestedAtMidTime_snapshot,
            "Holder underlying after second partial"
        );
        assertEq(
            currencyToken.balanceOf(holder),
            INITIAL_CURRENCY_BALANCE - cost1 - cost2,
            "Holder currency after second partial"
        );
        uint256 deployerBalanceAfter2 = cost1 + cost2;
        assertEq(
            currencyToken.balanceOf(deployer),
            deployerBalanceAfter2,
            "Deployer currency after second partial"
        );
    }

    function test_Exercise_FirstPartial_ArbitraryAmount() public {
        uint256 time1 = optVestingCliff +
            ((optVestingEnd - optVestingCliff) * 3) /
            10;
        vm.warp(time1);

        uint256 vestedAtTime1_snapshot = getExpectedVestedSnapshot(time1);
        uint256 amountToExercise1 = vestedAtTime1_snapshot / 2;
        assertTrue(amountToExercise1 > 0, "Amount to exercise1 should be > 0");
        uint256 cost1 = (amountToExercise1 * optStrikePrice) / (10 ** 6);

        vm.prank(holder);
        optionContract.exercise(amountToExercise1);

        assertEq(
            optionContract.exercisedAmount(),
            amountToExercise1,
            "Exercised amount after 1st part"
        );
        assertEq(
            underlyingToken.balanceOf(holder),
            amountToExercise1,
            "Holder underlying after 1st part"
        );
        assertEq(
            currencyToken.balanceOf(holder),
            INITIAL_CURRENCY_BALANCE - cost1,
            "Holder currency after 1st part"
        );
        assertEq(
            currencyToken.balanceOf(deployer),
            cost1,
            "Deployer currency after 1st part"
        );
    }

    function test_Exercise_SecondPartial_ArbitraryAmount_AfterFirst() public {
        uint256 time1 = optVestingCliff +
            ((optVestingEnd - optVestingCliff) * 3) /
            10;
        vm.warp(time1);
        uint256 vestedAtTime1_snapshot = getExpectedVestedSnapshot(time1);
        uint256 amountToExercise1 = vestedAtTime1_snapshot / 2;
        assertTrue(amountToExercise1 > 0);
        uint256 cost1 = (amountToExercise1 * optStrikePrice) / (10 ** 6);
        vm.prank(holder);
        optionContract.exercise(amountToExercise1);

        uint256 time2 = optVestingCliff +
            ((optVestingEnd - optVestingCliff) * 6) /
            10;
        vm.warp(time2);

        uint256 totalVestedAtTime2_snapshot = getExpectedVestedSnapshot(time2);
        uint256 alreadyExercised = optionContract.exercisedAmount();
        uint256 availableToExerciseAtTime2_snapshot = totalVestedAtTime2_snapshot -
                alreadyExercised;
        uint256 amountToExercise2 = availableToExerciseAtTime2_snapshot / 2;
        assertTrue(amountToExercise2 > 0, "Amount to exercise2 should be > 0");
        uint256 cost2 = (amountToExercise2 * optStrikePrice) / (10 ** 6);

        vm.prank(holder);
        optionContract.exercise(amountToExercise2);

        uint256 totalExercisedAfter2 = amountToExercise1 + amountToExercise2;
        assertEq(
            optionContract.exercisedAmount(),
            totalExercisedAfter2,
            "Exercised amount after 2nd part"
        );
        assertEq(
            underlyingToken.balanceOf(holder),
            totalExercisedAfter2,
            "Holder underlying after 2nd part"
        );
        assertEq(
            currencyToken.balanceOf(holder),
            INITIAL_CURRENCY_BALANCE - cost1 - cost2,
            "Holder currency after 2nd part"
        );
        assertEq(
            currencyToken.balanceOf(deployer),
            cost1 + cost2,
            "Deployer currency after 2nd part"
        );
    }

    function test_Exercise_FinalPartial_ArbitraryAmount_ToFullExercise()
        public
    {
        uint256 time1 = optVestingCliff +
            ((optVestingEnd - optVestingCliff) * 3) /
            10;
        vm.warp(time1);
        uint256 vestedAtTime1_snapshot = getExpectedVestedSnapshot(time1);
        uint256 amountToExercise1 = vestedAtTime1_snapshot / 2;
        assertTrue(amountToExercise1 > 0);
        uint256 cost1 = (amountToExercise1 * optStrikePrice) / (10 ** 6);
        vm.prank(holder);
        optionContract.exercise(amountToExercise1);

        uint256 time2 = optVestingCliff +
            ((optVestingEnd - optVestingCliff) * 6) /
            10;
        vm.warp(time2);
        uint256 totalVestedAtTime2_snapshot = getExpectedVestedSnapshot(time2);
        uint256 alreadyExercisedAfter1 = optionContract.exercisedAmount();
        uint256 availableToExerciseAtTime2_snapshot = totalVestedAtTime2_snapshot -
                alreadyExercisedAfter1;
        uint256 amountToExercise2 = availableToExerciseAtTime2_snapshot / 2;
        assertTrue(amountToExercise2 > 0);
        uint256 cost2 = (amountToExercise2 * optStrikePrice) / (10 ** 6);
        vm.prank(holder);
        optionContract.exercise(amountToExercise2);

        vm.warp(optVestingEnd);
        uint256 totalVestedAtTime3_snapshot = getExpectedVestedSnapshot(
            optVestingEnd
        );
        uint256 alreadyExercisedAfter2 = optionContract.exercisedAmount();
        uint256 amountToExercise3 = totalVestedAtTime3_snapshot -
            alreadyExercisedAfter2;
        assertTrue(amountToExercise3 > 0, "Amount to exercise3 should be > 0");
        uint256 cost3 = (amountToExercise3 * optStrikePrice) / (10 ** 6);

        vm.prank(holder);
        optionContract.exercise(amountToExercise3);

        assertEq(
            optionContract.exercisedAmount(),
            optionContract.originalAmount(),
            "Should be fully exercised based on original amount"
        );
        assertEq(
            underlyingToken.balanceOf(holder),
            optionContract.originalAmount(),
            "Holder underlying should be full originalAmount"
        );
        assertEq(
            currencyToken.balanceOf(holder),
            INITIAL_CURRENCY_BALANCE - cost1 - cost2 - cost3,
            "Holder currency after full exercise"
        );
        assertEq(
            currencyToken.balanceOf(deployer),
            cost1 + cost2 + cost3,
            "Deployer currency after full exercise"
        );
    }

    // --- Tests for stopVestingAndWithdrawUnvested ---

    function test_Revert_StopVesting_NotOwner() public {
        vm.prank(otherUser);
        vm.expectRevert(Ownable.Unauthorized.selector);
        optionContract.stopVestingAndWithdrawUnvested();
    }

    function test_Revert_StopVesting_AlreadyHalted() public {
        vm.prank(deployer);
        optionContract.stopVestingAndWithdrawUnvested(); // First halt

        vm.prank(deployer);
        vm.expectRevert("Option: vesting already halted");
        optionContract.stopVestingAndWithdrawUnvested(); // Second attempt
    }

    function test_StopVesting_BeforeCliff() public {
        vm.warp(optVestingCliff - 1 days); // Time before cliff
        uint256 initialOwnerUnderlying = underlyingToken.balanceOf(deployer);

        uint256 expectedVestedAtHalt = 0; // Before cliff, 0 vested
        uint256 expectedUnvestedToWithdraw = optionContract.originalAmount();

        vm.prank(deployer);
        vm.expectEmit(false, false, false, true, address(optionContract));
        emit VestingHalted(expectedVestedAtHalt, expectedUnvestedToWithdraw);
        optionContract.stopVestingAndWithdrawUnvested();

        assertTrue(
            optionContract.vestingIsHalted(),
            "Vesting should be halted"
        );
        assertEq(
            optionContract.vestingHaltTimestamp(),
            block.timestamp,
            "Halt timestamp mismatch"
        );
        assertEq(
            optionContract.amount(),
            expectedVestedAtHalt,
            "Option amount should be vestedAtHalt"
        );
        assertEq(
            underlyingToken.balanceOf(deployer),
            initialOwnerUnderlying + expectedUnvestedToWithdraw,
            "Owner underlying balance incorrect"
        );
        assertEq(
            underlyingToken.balanceOf(address(optionContract)),
            expectedVestedAtHalt,
            "Contract underlying balance incorrect"
        );

        // Holder tries to exercise - should fail as amount is 0 / no vested tokens
        vm.prank(holder);
        vm.expectRevert(
            "Option: request exceeds total available option amount"
        ); // or insufficient vested
        optionContract.exercise(1);
    }

    function test_StopVesting_AtCliff() public {
        vm.warp(optVestingCliff); // Exactly at cliff
        uint256 initialOwnerUnderlying = underlyingToken.balanceOf(deployer);
        uint256 expectedVestedAtHalt = getExpectedVestedSnapshot(
            optVestingCliff
        ); // Should be 0
        assertEq(expectedVestedAtHalt, 0, "Vested at cliff should be 0");
        uint256 expectedUnvestedToWithdraw = optionContract.originalAmount() -
            expectedVestedAtHalt;

        vm.prank(deployer);
        vm.expectEmit(false, false, false, true, address(optionContract));
        emit VestingHalted(expectedVestedAtHalt, expectedUnvestedToWithdraw);
        optionContract.stopVestingAndWithdrawUnvested();

        assertTrue(
            optionContract.vestingIsHalted(),
            "Vesting should be halted"
        );
        assertEq(
            optionContract.vestingHaltTimestamp(),
            block.timestamp,
            "Halt timestamp mismatch"
        );
        assertEq(
            optionContract.amount(),
            expectedVestedAtHalt,
            "Option amount should be vestedAtHalt"
        );
        assertEq(
            underlyingToken.balanceOf(deployer),
            initialOwnerUnderlying + expectedUnvestedToWithdraw,
            "Owner underlying balance incorrect"
        );
        assertEq(
            underlyingToken.balanceOf(address(optionContract)),
            expectedVestedAtHalt,
            "Contract underlying balance incorrect"
        );

        vm.prank(holder);
        vm.expectRevert(
            "Option: request exceeds total available option amount"
        );
        optionContract.exercise(1);
    }

    function test_StopVesting_MidVesting() public {
        uint256 midTime = optVestingCliff +
            (optVestingEnd - optVestingCliff) /
            2;
        vm.warp(midTime);
        uint256 initialOwnerUnderlying = underlyingToken.balanceOf(deployer);
        uint256 expectedVestedAtHalt = getExpectedVestedSnapshot(midTime);
        uint256 expectedUnvestedToWithdraw = optionContract.originalAmount() -
            expectedVestedAtHalt;

        vm.prank(deployer);
        vm.expectEmit(false, false, false, true, address(optionContract));
        emit VestingHalted(expectedVestedAtHalt, expectedUnvestedToWithdraw);
        optionContract.stopVestingAndWithdrawUnvested();

        assertTrue(
            optionContract.vestingIsHalted(),
            "Vesting should be halted"
        );
        assertEq(
            optionContract.vestingHaltTimestamp(),
            midTime,
            "Halt timestamp mismatch"
        ); // block.timestamp is midTime
        assertEq(
            optionContract.amount(),
            expectedVestedAtHalt,
            "Option amount should be vestedAtHalt"
        );
        assertEq(
            underlyingToken.balanceOf(deployer),
            initialOwnerUnderlying + expectedUnvestedToWithdraw,
            "Owner underlying balance incorrect"
        );
        assertEq(
            underlyingToken.balanceOf(address(optionContract)),
            expectedVestedAtHalt,
            "Contract underlying balance incorrect"
        );

        // Holder tries to exercise a portion of the new (halted) amount
        uint256 amountToExercise = expectedVestedAtHalt / 2;
        assertTrue(amountToExercise > 0, "Amount to exercise should be > 0");
        uint256 cost = (amountToExercise * optStrikePrice) / (10 ** 6);

        // Warp time a bit more, but still before original vesting end (and after halt)
        vm.warp(midTime + 1 days);

        vm.prank(holder);
        optionContract.exercise(amountToExercise);

        assertEq(
            optionContract.exercisedAmount(),
            amountToExercise,
            "Exercised amount mismatch"
        );
        assertEq(
            underlyingToken.balanceOf(holder),
            amountToExercise,
            "Holder underlying after exercise"
        );
        assertEq(
            currencyToken.balanceOf(holder),
            INITIAL_CURRENCY_BALANCE - cost,
            "Holder currency after exercise"
        );
        assertEq(
            currencyToken.balanceOf(deployer),
            cost,
            "Deployer currency after exercise"
        );
        assertEq(
            underlyingToken.balanceOf(address(optionContract)),
            expectedVestedAtHalt - amountToExercise,
            "Contract underlying after exercise"
        );
    }

    function test_StopVesting_AtVestingEnd() public {
        vm.warp(optVestingEnd);
        uint256 initialOwnerUnderlying = underlyingToken.balanceOf(deployer);
        uint256 expectedVestedAtHalt = getExpectedVestedSnapshot(optVestingEnd); // Should be originalAmount
        assertEq(
            expectedVestedAtHalt,
            optionContract.originalAmount(),
            "Vested at end should be full original amount"
        );
        uint256 expectedUnvestedToWithdraw = optionContract.originalAmount() -
            expectedVestedAtHalt; // Should be 0

        vm.prank(deployer);
        vm.expectEmit(false, false, false, true, address(optionContract));
        emit VestingHalted(expectedVestedAtHalt, expectedUnvestedToWithdraw);
        optionContract.stopVestingAndWithdrawUnvested();

        assertTrue(
            optionContract.vestingIsHalted(),
            "Vesting should be halted"
        );
        assertEq(
            optionContract.vestingHaltTimestamp(),
            block.timestamp,
            "Halt timestamp mismatch"
        );
        assertEq(
            optionContract.amount(),
            expectedVestedAtHalt,
            "Option amount should be originalAmount"
        );
        assertEq(
            underlyingToken.balanceOf(deployer),
            initialOwnerUnderlying,
            "Owner underlying should not change"
        );
        assertEq(
            underlyingToken.balanceOf(address(optionContract)),
            optionContract.originalAmount(),
            "Contract should still hold all original underlying"
        );

        // Holder can still exercise fully
        uint256 amountToExercise = optionContract.originalAmount();
        uint256 cost = (amountToExercise * optStrikePrice) / (10 ** 6);
        vm.prank(holder);
        optionContract.exercise(amountToExercise);
        assertEq(optionContract.exercisedAmount(), amountToExercise);
    }

    function test_StopVesting_AfterVestingEnd() public {
        vm.warp(optVestingEnd + 1 days);
        uint256 initialOwnerUnderlying = underlyingToken.balanceOf(deployer);
        uint256 expectedVestedAtHalt = getExpectedVestedSnapshot(
            optVestingEnd + 1 days
        ); // Should be originalAmount
        assertEq(
            expectedVestedAtHalt,
            optionContract.originalAmount(),
            "Vested after end should be full original amount"
        );
        uint256 expectedUnvestedToWithdraw = optionContract.originalAmount() -
            expectedVestedAtHalt; // Should be 0

        vm.prank(deployer);
        vm.expectEmit(false, false, false, true, address(optionContract));
        emit VestingHalted(expectedVestedAtHalt, expectedUnvestedToWithdraw);
        optionContract.stopVestingAndWithdrawUnvested();

        assertTrue(
            optionContract.vestingIsHalted(),
            "Vesting should be halted"
        );
        assertEq(
            optionContract.vestingHaltTimestamp(),
            block.timestamp,
            "Halt timestamp mismatch"
        );
        assertEq(
            optionContract.amount(),
            expectedVestedAtHalt,
            "Option amount should be originalAmount"
        );
        assertEq(
            underlyingToken.balanceOf(deployer),
            initialOwnerUnderlying,
            "Owner underlying should not change"
        );
        assertEq(
            underlyingToken.balanceOf(address(optionContract)),
            optionContract.originalAmount(),
            "Contract should still hold all original underlying"
        );
    }

    function test_Exercise_AfterVestingHalted_MidVesting_PastHaltTime() public {
        uint256 midTimeHalt = optVestingCliff +
            (optVestingEnd - optVestingCliff) /
            2;
        vm.warp(midTimeHalt);
        uint256 vestedAtHalt = getExpectedVestedSnapshot(midTimeHalt);

        vm.prank(deployer);
        optionContract.stopVestingAndWithdrawUnvested(); // Halts vesting, amount becomes vestedAtHalt
        assertEq(
            optionContract.amount(),
            vestedAtHalt,
            "Option amount is now vestedAtHalt"
        );

        // Warp time to after halt time, but before original vesting end.
        // The vested amount should not increase beyond vestedAtHalt for exercise purposes.
        uint256 timeAfterHalt = midTimeHalt + 1 days;
        vm.warp(timeAfterHalt);

        uint256 snapshotAtExerciseTime = optionContract
            .getCurrentlyVestedSnapshot(timeAfterHalt);
        // Snapshot should be capped at vestedAtHalt because vestingIsHalted and timeAfterHalt > vestingHaltTimestamp
        assertEq(
            snapshotAtExerciseTime,
            vestedAtHalt,
            "Snapshot should be capped at vestedAtHalt amount"
        );

        uint256 amountToExercise = vestedAtHalt; // Try to exercise the full amount that was vested at halt
        uint256 cost = (amountToExercise * optStrikePrice) / (10 ** 6);

        vm.prank(holder);
        optionContract.exercise(amountToExercise);

        assertEq(
            optionContract.exercisedAmount(),
            vestedAtHalt,
            "Exercised amount mismatch"
        );
        assertEq(
            underlyingToken.balanceOf(holder),
            vestedAtHalt,
            "Holder underlying after exercise"
        );
        assertEq(
            currencyToken.balanceOf(holder),
            INITIAL_CURRENCY_BALANCE - cost,
            "Holder currency after exercise"
        );
        assertEq(
            underlyingToken.balanceOf(address(optionContract)),
            0,
            "Contract should have no underlying left from option amount"
        );
    }

    function test_Revert_Exercise_MoreThanHaltedAmount_AfterHalt() public {
        uint256 midTimeHalt = optVestingCliff +
            (optVestingEnd - optVestingCliff) /
            2;
        vm.warp(midTimeHalt);
        uint256 vestedAtHalt = getExpectedVestedSnapshot(midTimeHalt);

        vm.prank(deployer);
        optionContract.stopVestingAndWithdrawUnvested();
        assertEq(optionContract.amount(), vestedAtHalt);

        vm.warp(midTimeHalt + 1 days);
        vm.prank(holder);
        // Try to exercise vestedAtHalt + 1. Should fail on the check:
        // require(exercisedAmount + _amountToExercise <= amount, ...)
        // because amount is now vestedAtHalt.
        vm.expectRevert(
            "Option: request exceeds total available option amount"
        );
        optionContract.exercise(vestedAtHalt + 1);
    }

    // --- Tests for withdrawExpiredTokens ---

    function test_Revert_WithdrawExpired_NotOwner() public {
        vm.warp(optExpiry + 1 days); // After expiry
        vm.prank(otherUser);
        vm.expectRevert(Ownable.Unauthorized.selector);
        optionContract.withdrawExpiredTokens();
    }

    function test_Revert_WithdrawExpired_NotYetExpired() public {
        vm.warp(optExpiry - 1 days); // Before expiry
        vm.prank(deployer);
        vm.expectRevert("Option: not yet expired");
        optionContract.withdrawExpiredTokens();
    }

    function test_WithdrawExpired_NoExercise_VestingNotHalted() public {
        vm.warp(optExpiry + 1 days);
        uint256 initialOwnerUnderlying = underlyingToken.balanceOf(deployer);
        uint256 contractUnderlyingBeforeWithdraw = underlyingToken.balanceOf(
            address(optionContract)
        );
        assertEq(
            contractUnderlyingBeforeWithdraw,
            optionContract.originalAmount(),
            "Contract should hold originalAmount"
        );

        uint256 expectedAmountWithdrawn = optionContract.originalAmount();

        vm.prank(deployer);
        vm.expectEmit(false, false, false, true, address(optionContract));
        emit ExpiredTokensWithdrawn(expectedAmountWithdrawn);
        optionContract.withdrawExpiredTokens();

        assertEq(
            underlyingToken.balanceOf(deployer),
            initialOwnerUnderlying + optionContract.originalAmount(),
            "Owner should get back full originalAmount"
        );
        assertEq(
            underlyingToken.balanceOf(address(optionContract)),
            0,
            "Contract should have 0 underlying"
        );
    }

    function test_WithdrawExpired_PartialExercise_VestingNotHalted() public {
        uint256 midTime = optVestingCliff +
            (optVestingEnd - optVestingCliff) /
            2;
        vm.warp(midTime);
        uint256 amountToExercise = getExpectedVestedSnapshot(midTime) / 2;
        uint256 cost = (amountToExercise * optStrikePrice) / (10 ** 6);

        vm.prank(holder);
        optionContract.exercise(amountToExercise);

        vm.warp(optExpiry + 1 days);
        uint256 initialOwnerUnderlying = underlyingToken.balanceOf(deployer);
        uint256 expectedWithdrawAmount = optionContract.originalAmount() -
            amountToExercise;
        uint256 contractUnderlyingBeforeWithdraw = underlyingToken.balanceOf(
            address(optionContract)
        );
        assertEq(
            contractUnderlyingBeforeWithdraw,
            expectedWithdrawAmount,
            "Contract underlying mismatch before withdraw"
        );

        vm.prank(deployer);
        vm.expectEmit(false, false, false, true, address(optionContract));
        emit ExpiredTokensWithdrawn(expectedWithdrawAmount);
        optionContract.withdrawExpiredTokens();

        assertEq(
            underlyingToken.balanceOf(deployer),
            initialOwnerUnderlying + expectedWithdrawAmount,
            "Owner final balance incorrect"
        );
        assertEq(
            underlyingToken.balanceOf(address(optionContract)),
            0,
            "Contract should have 0 underlying post-withdraw"
        );
    }

    function test_WithdrawExpired_FullExercise_VestingNotHalted() public {
        vm.warp(optVestingEnd); // Fully vested
        uint256 amountToExercise = optionContract.originalAmount();
        uint256 cost = (amountToExercise * optStrikePrice) / (10 ** 6);

        vm.prank(holder);
        optionContract.exercise(amountToExercise);
        assertEq(
            underlyingToken.balanceOf(address(optionContract)),
            0,
            "Contract should have 0 underlying after full exercise"
        );

        vm.warp(optExpiry + 1 days);
        uint256 initialOwnerUnderlying = underlyingToken.balanceOf(deployer);

        vm.prank(deployer);
        vm.expectEmit(false, false, false, true, address(optionContract));
        emit ExpiredTokensWithdrawn(0);
        optionContract.withdrawExpiredTokens();

        assertEq(
            underlyingToken.balanceOf(deployer),
            initialOwnerUnderlying,
            "Owner balance should not change"
        );
        assertEq(
            underlyingToken.balanceOf(address(optionContract)),
            0,
            "Contract should still have 0 underlying"
        );
    }

    function test_WithdrawExpired_NoExercise_VestingHalted_MidWay() public {
        uint256 midTimeHalt = optVestingCliff +
            (optVestingEnd - optVestingCliff) /
            2;
        vm.warp(midTimeHalt);
        uint256 vestedAtHalt = getExpectedVestedSnapshot(midTimeHalt);
        uint256 unvestedWithdrawn = optionContract.originalAmount() -
            vestedAtHalt;

        vm.prank(deployer);
        optionContract.stopVestingAndWithdrawUnvested();
        assertEq(
            optionContract.amount(),
            vestedAtHalt,
            "Option amount set to vestedAtHalt"
        );
        assertEq(
            underlyingToken.balanceOf(address(optionContract)),
            vestedAtHalt,
            "Contract holds vestedAtHalt amount"
        );

        vm.warp(optExpiry + 1 days);
        uint256 initialOwnerUnderlying = underlyingToken.balanceOf(deployer);
        // Owner already got unvestedWithdrawn. Now should get vestedAtHalt.

        vm.prank(deployer);
        vm.expectEmit(true, false, false, true, address(optionContract));
        emit ExpiredTokensWithdrawn(vestedAtHalt);
        optionContract.withdrawExpiredTokens();

        assertEq(
            underlyingToken.balanceOf(deployer),
            initialOwnerUnderlying + vestedAtHalt,
            "Owner final balance incorrect"
        );
        assertEq(
            underlyingToken.balanceOf(address(optionContract)),
            0,
            "Contract should have 0 underlying"
        );
    }

    function test_WithdrawExpired_PartialExercise_VestingHalted_MidWay()
        public
    {
        uint256 midTimeHalt = optVestingCliff +
            (optVestingEnd - optVestingCliff) /
            2;
        vm.warp(midTimeHalt);
        uint256 vestedAtHalt = getExpectedVestedSnapshot(midTimeHalt);

        vm.prank(deployer);
        optionContract.stopVestingAndWithdrawUnvested(); // amount becomes vestedAtHalt
        assertEq(
            underlyingToken.balanceOf(address(optionContract)),
            vestedAtHalt
        );

        // Holder exercises a portion of the halted amount
        uint256 amountToExercise = vestedAtHalt / 2;
        assertTrue(amountToExercise > 0);
        uint256 cost = (amountToExercise * optStrikePrice) / (10 ** 6);
        vm.prank(holder);
        optionContract.exercise(amountToExercise);

        assertEq(
            underlyingToken.balanceOf(address(optionContract)),
            vestedAtHalt - amountToExercise,
            "Contract balance after partial exercise"
        );

        vm.warp(optExpiry + 1 days);
        uint256 initialOwnerUnderlying = underlyingToken.balanceOf(deployer);
        uint256 expectedWithdrawAmount = vestedAtHalt - amountToExercise;

        vm.prank(deployer);
        vm.expectEmit(false, false, false, true, address(optionContract));
        emit ExpiredTokensWithdrawn(expectedWithdrawAmount);
        optionContract.withdrawExpiredTokens();

        assertEq(
            underlyingToken.balanceOf(deployer),
            initialOwnerUnderlying + expectedWithdrawAmount,
            "Owner final balance incorrect"
        );
        assertEq(
            underlyingToken.balanceOf(address(optionContract)),
            0,
            "Contract should have 0 underlying"
        );
    }

    function test_WithdrawExpired_VestingHaltedBeforeCliff_NoExercise() public {
        vm.warp(optVestingCliff - 1 days); // Halt before cliff
        uint256 initialOwnerUnderlying = underlyingToken.balanceOf(deployer);

        vm.prank(deployer);
        optionContract.stopVestingAndWithdrawUnvested(); // VestedAtHalt=0, amount=0. Owner gets back originalAmount.
        assertEq(optionContract.amount(), 0, "Amount should be 0");
        assertEq(
            underlyingToken.balanceOf(address(optionContract)),
            0,
            "Contract should have 0 underlying after halt"
        );
        assertEq(
            underlyingToken.balanceOf(deployer),
            initialOwnerUnderlying + optionContract.originalAmount(),
            "Owner got originalAmount back"
        );

        vm.warp(optExpiry + 1 days);
        uint256 ownerUnderlyingBeforeFinalWithdraw = underlyingToken.balanceOf(
            deployer
        );

        vm.prank(deployer);
        vm.expectEmit(true, false, false, true, address(optionContract));
        emit ExpiredTokensWithdrawn(0);
        optionContract.withdrawExpiredTokens();

        assertEq(
            underlyingToken.balanceOf(deployer),
            ownerUnderlyingBeforeFinalWithdraw,
            "Owner balance should not change"
        );
        assertEq(
            underlyingToken.balanceOf(address(optionContract)),
            0,
            "Contract still has 0 underlying"
        );
    }
}
