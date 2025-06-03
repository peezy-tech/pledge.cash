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
        optionContract.exercise();
    }

    function test_Revert_Exercise_AfterExpiry() public {
        vm.warp(optExpiry + 1 days); // Time after expiry
        vm.prank(holder);
        vm.expectRevert("Option: expired");
        optionContract.exercise();
    }

    function test_Revert_Exercise_NotHolder() public {
        vm.warp(optVestingCliff); // Valid time
        vm.prank(otherUser); // Not the holder
        vm.expectRevert("Option: only holder can exercise");
        optionContract.exercise();
    }

    function test_Revert_Exercise_InsufficientCurrency() public {
        // Burn holder's currency
        vm.prank(holder);
        currencyToken.burn(holder, currencyToken.balanceOf(holder)); // Burn all currency

        vm.warp(optVestingCliff + 1 days); // MODIFIED: Valid time, some amount should vest
        vm.prank(holder);
        // Exact revert message depends on SafeTransferLib, usually no specific message or "transfer amount exceeds balance"
        vm.expectRevert(); // ERC20: transfer amount exceeds balance (or similar) // TODO: Be more specific if SafeTransferLib has a standard error
        optionContract.exercise();
    }

    function test_Exercise_AtCliff_Exactly() public {
        vm.warp(optVestingCliff);

        uint256 expectedVested = getExpectedVestedAmount(optVestingCliff);
        // At the exact cliff moment, (block.timestamp - vestingCliff) is 0, so vested is 0.
        // This means you can only exercise *after* the cliff has passed by some time.
        // Or, if cliff = 0, then it's just vestedAmount = (amount * block.timestamp) / vestingEnd.
        // The logic is `(amount * (timestamp - cliff)) / (end - cliff)`.
        // If timestamp == cliff, then numerator is 0, so vested is 0.
        // This leads to "no new vested amount to exercise" if called exactly at cliff start, unless cliff duration is 0.
        // Let's test exercising 1 second after cliff start.

        vm.warp(optVestingCliff + 1); // 1 second into vesting period after cliff
        expectedVested = getExpectedVestedAmount(optVestingCliff + 1);
        assertTrue(expectedVested > 0, "Expected vested should be > 0 just after cliff");

        uint256 cost = (expectedVested * optStrikePrice) / (10**18);

        vm.prank(holder);
        optionContract.exercise();

        console.log("optionContract.exercisedAmount()", optionContract.exercisedAmount());
        assertEq(optionContract.exercisedAmount(), expectedVested, "Exercised amount mismatch at cliff");

        console.log("underlyingToken.balanceOf(holder)", underlyingToken.balanceOf(holder));
        console.log("expectedVested", expectedVested);
        assertEq(underlyingToken.balanceOf(holder), expectedVested, "Holder underlying balance mismatch");

        console.log("currencyToken.balanceOf(holder)", currencyToken.balanceOf(holder));
        console.log("INITIAL_CURRENCY_BALANCE", INITIAL_CURRENCY_BALANCE);
        console.log("cost", cost);
        assertEq(currencyToken.balanceOf(holder), INITIAL_CURRENCY_BALANCE - cost, "Holder currency balance mismatch");

        console.log("currencyToken.balanceOf(deployer)", currencyToken.balanceOf(deployer));
        console.log("cost", cost);
        assertEq(currencyToken.balanceOf(deployer), cost, "Deployer currency balance mismatch"); // Owner gets payment
    }


    function test_Exercise_Partial_MidVesting() public {
        uint256 midTime = optVestingCliff + (optVestingEnd - optVestingCliff) / 2;
        vm.warp(midTime);

        uint256 expectedVested = getExpectedVestedAmount(midTime);
        assertTrue(expectedVested > 0 && expectedVested < optAmount, "Expected vested should be partial");
        uint256 cost = (expectedVested * optStrikePrice) / (10**18);

        vm.startPrank(holder);
        optionContract.exercise();
        vm.stopPrank();

        assertEq(optionContract.exercisedAmount(), expectedVested, "Exercised amount mismatch mid-vesting");
        assertEq(underlyingToken.balanceOf(holder), expectedVested, "Holder underlying balance mismatch");
        assertEq(currencyToken.balanceOf(holder), INITIAL_CURRENCY_BALANCE - cost, "Holder currency balance mismatch");
        assertEq(currencyToken.balanceOf(deployer), cost, "Deployer currency balance mismatch");
    }

    function test_Exercise_MultiplePartials() public {
        // Time 1: 25% into vesting period (after cliff)
        uint256 time1 = optVestingCliff + (optVestingEnd - optVestingCliff) / 4;
        vm.warp(time1);

        uint256 expectedVested1 = getExpectedVestedAmount(time1);
        uint256 cost1 = (expectedVested1 * optStrikePrice) / (10**18);

        vm.prank(holder);
        optionContract.exercise();

        assertEq(optionContract.exercisedAmount(), expectedVested1, "Exercised amount mismatch time1");
        assertEq(underlyingToken.balanceOf(holder), expectedVested1, "Holder underlying time1");
        assertEq(currencyToken.balanceOf(holder), INITIAL_CURRENCY_BALANCE - cost1, "Holder currency time1");
        assertEq(currencyToken.balanceOf(deployer), cost1, "Deployer currency time1");

        // Time 2: 75% into vesting period (after cliff)
        uint256 time2 = optVestingCliff + (optVestingEnd - optVestingCliff) * 3 / 4;
        vm.warp(time2);

        uint256 totalVestedAtTime2 = getExpectedVestedAmount(time2);
        uint256 expectedToExerciseNow = totalVestedAtTime2 - expectedVested1; // amount from this exercise call
        assertTrue(expectedToExerciseNow > 0, "Should have new amount to exercise at time2");
        uint256 cost2 = (expectedToExerciseNow * optStrikePrice) / (10**18);

        vm.prank(holder);
        optionContract.exercise();

        assertEq(optionContract.exercisedAmount(), totalVestedAtTime2, "Exercised amount mismatch time2");
        assertEq(underlyingToken.balanceOf(holder), totalVestedAtTime2, "Holder underlying time2");
        assertEq(currencyToken.balanceOf(holder), INITIAL_CURRENCY_BALANCE - cost1 - cost2, "Holder currency time2");
        assertEq(currencyToken.balanceOf(deployer), cost1 + cost2, "Deployer currency time2");
    }

    function test_Exercise_AtVestingEnd_FullAmount() public {
        vm.warp(optVestingEnd);

        uint256 expectedVested = optAmount; // Should be fully vested
        uint256 cost = (expectedVested * optStrikePrice) / (10**18);

        vm.prank(holder);
        optionContract.exercise();

        assertEq(optionContract.exercisedAmount(), expectedVested, "Exercised amount mismatch at vesting end");
        assertEq(underlyingToken.balanceOf(holder), expectedVested, "Holder underlying balance at vesting end");
        assertEq(currencyToken.balanceOf(holder), INITIAL_CURRENCY_BALANCE - cost, "Holder currency balance at vesting end");
        assertEq(currencyToken.balanceOf(deployer), cost, "Deployer currency balance at vesting end");
    }

     function test_Exercise_AfterVestingEnd_FullAmount() public {
        vm.warp(optVestingEnd + 1 weeks); // Sometime after full vesting

        uint256 expectedVested = optAmount;
        uint256 cost = (expectedVested * optStrikePrice) / (10**18);

        vm.prank(holder);
        optionContract.exercise();

        assertEq(optionContract.exercisedAmount(), expectedVested, "Exercised amount mismatch after vesting end");
        // ... rest of assertions same as AtVestingEnd
        assertEq(underlyingToken.balanceOf(holder), expectedVested);
        assertEq(currencyToken.balanceOf(holder), INITIAL_CURRENCY_BALANCE - cost);
        assertEq(currencyToken.balanceOf(deployer), cost);
    }


    function test_Revert_Exercise_NoNewVestedAmount() public {
        uint256 time1 = optVestingCliff + (optVestingEnd - optVestingCliff) / 2;
        vm.warp(time1);

        vm.prank(holder);
        optionContract.exercise(); // First exercise

        // Warp to same time or just slightly after, but not enough for new integer vested amount
        // vm.warp(time1 + 1); // MODIFIED: Removed warp to test immediate re-exercise
                           // or more simply, call exercise again without warping time
        vm.prank(holder);
        vm.expectRevert("Option: no new vested amount to exercise");
        optionContract.exercise();
    }

    function test_Revert_Exercise_AlreadyFullyExercised() public {
        vm.warp(optVestingEnd); // Fully vested

        vm.prank(holder);
        optionContract.exercise(); // Exercise all

        // Try to exercise again
        vm.prank(holder);
        vm.expectRevert("Option: already fully exercised");
        optionContract.exercise();
    }

    function test_Exercise_FullAmount_IfCliffIsZeroAndVestingEndReached() public {
        // Re-deploy with cliff = startTime
        // Deployer is address(this)
        vm.prank(deployer);
        address predicted = vm.computeCreateAddress(deployer, vm.getNonce(deployer)); // MODIFIED
        underlyingToken.approve(predicted, optAmount); // address(this) approves

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


        // Holder needs to approve this new contract instance too
        vm.prank(holder);
        currencyToken.approve(address(localOption), type(uint256).max);


        vm.warp(newEnd); // Warp to its vesting end

        uint256 cost = (optAmount * optStrikePrice) / (10**18);

        vm.prank(holder);
        localOption.exercise();

        assertEq(localOption.exercisedAmount(), optAmount);
        assertEq(underlyingToken.balanceOf(holder), optAmount); // Assuming holder had 0 underlying before
        assertEq(currencyToken.balanceOf(holder), INITIAL_CURRENCY_BALANCE - cost);
        // deployer's currency balance should increase from this specific option contract's exercise
        // Note: deployer here is the global test deployer, not owner of localOption if different.
        // Owner of localOption is also `deployer` (address(this)) due to vm.prank(deployer) during `new Option`.
        assertEq(currencyToken.balanceOf(deployer), cost);
    }

    // NOTE: The Solidity helper function computeCreateAddress was removed from here as it's not used.
    // The Forge cheatcode `vm.computeCreateAddress(address, uint256)` is used directly in tests like setUp and test_Revert_Deploy_CliffAfterEnd.
}
