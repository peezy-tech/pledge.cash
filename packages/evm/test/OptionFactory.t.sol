// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "forge-std/Test.sol";
import {OptionFactory, OptionLogic, Option} from "../src/option.sol";
import {LibClone} from "solady/utils/LibClone.sol";

import {MockERC20} from "solady/../test/utils/mocks/MockERC20.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {Ownable} from "solady/auth/Ownable.sol";

contract OptionFactoryTest is Test {
    OptionFactory public factory;
    OptionLogic public optionContract; // The logic contract instance (clone)
    MockERC20 public currencyToken;
    MockERC20 public underlyingToken;

    address public deployer;
    address public holder;
    address public otherUser = address(0x3);

    uint256 public constant INITIAL_CURRENCY_BALANCE = 200 * 10 ** 6;
    uint256 public constant INITIAL_UNDERLYING_BALANCE = 1_000_000 * 10 ** 6;

    uint256 public optAmount = 100 * 10 ** 6;
    uint256 public optStrikePrice = 2 * 10 ** 6;

    uint256 public startTime;
    uint256 public optVestingCliff;
    uint256 public optVestingEnd;
    uint256 public optExpiry;

    event VestingHalted(uint256 vestedAtHalt, uint256 unvestedWithdrawn);
    event ExpiredTokensWithdrawn(uint256 amountWithdrawn);
    event OptionCreated(address optionAddress, address indexed creator);

    function setUp() public {
        deployer = address(this);
        factory = new OptionFactory();

        currencyToken = new MockERC20("MockCurrency", "MCUR", 6);
        underlyingToken = new MockERC20("MockUnderlying", "MUND", 6);

        holder = makeAddr("Holder");

        vm.label(deployer, "Deployer (Test Contract)");
        vm.label(address(factory), "OptionFactory");
        vm.label(holder, "Option Holder");
        vm.label(otherUser, "OtherUser");
        vm.label(address(currencyToken), "CurrencyToken (MCUR)");
        vm.label(address(underlyingToken), "UnderlyingToken (MUND)");

        underlyingToken.mint(deployer, INITIAL_UNDERLYING_BALANCE);
        currencyToken.mint(holder, INITIAL_CURRENCY_BALANCE);

        startTime = block.timestamp;
        optVestingCliff = startTime + 1 weeks;
        optVestingEnd = optVestingCliff + 3 weeks;
        optExpiry = optVestingEnd + 1 weeks;

        bytes32 salt = keccak256("test salt");
        address predictedAddress = LibClone.predictDeterministicAddress(
            factory.optionLogic(),
            salt,
            address(factory)
        );

        vm.prank(deployer);
        underlyingToken.approve(predictedAddress, optAmount);

        vm.prank(deployer);
        address optionAddress = factory.createOptionDeterministic(
            address(currencyToken),
            holder,
            address(underlyingToken),
            optAmount,
            optStrikePrice,
            optExpiry,
            optVestingCliff,
            optVestingEnd,
            salt
        );

        assertEq(optionAddress, predictedAddress, "Predicted address mismatch");
        optionContract = OptionLogic(optionAddress);
        vm.label(address(optionContract), "OptionContract (Clone)");

        vm.prank(holder);
        currencyToken.approve(address(optionContract), type(uint256).max);
    }

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
        vm.startPrank(deployer);
        vm.expectRevert(OptionLogic.InvalidVestingSchedule.selector);
        factory.createOptionDeterministic(
            address(currencyToken),
            holder,
            address(underlyingToken),
            optAmount,
            optStrikePrice,
            optExpiry,
            optVestingEnd + 1,
            optVestingEnd,
            keccak256("test cliff after end")
        );
        vm.stopPrank();
    }

    function test_Revert_Deploy_ExpiryBeforeVestingEnd() public {
        vm.startPrank(deployer);
        vm.expectRevert(OptionLogic.InvalidExpiry.selector);
        factory.createOptionDeterministic(
            address(currencyToken),
            holder,
            address(underlyingToken),
            optAmount,
            optStrikePrice,
            optVestingEnd - 1 days,
            optVestingCliff,
            optVestingEnd,
            keccak256("test expiry before vesting end")
        );
        vm.stopPrank();
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
        vm.warp(optVestingCliff - 1 days);
        vm.prank(holder);
        vm.expectRevert(
            abi.encodeWithSelector(
                OptionLogic.InsufficientVestedAmount.selector,
                1,
                0
            )
        );
        optionContract.exercise(1);
    }

    function test_Exercise_AtCliff_Exactly() public {
        vm.warp(optVestingCliff);
        uint256 expectedVested = getExpectedVestedSnapshot(optVestingCliff);
        assertEq(expectedVested, 0);

        vm.prank(holder);
        vm.expectRevert(
            abi.encodeWithSelector(
                OptionLogic.InsufficientVestedAmount.selector,
                1,
                0
            )
        );
        optionContract.exercise(1);

        vm.warp(optVestingCliff + 1);
        expectedVested = getExpectedVestedSnapshot(optVestingCliff + 1);
        assertTrue(expectedVested > 0);

        uint256 cost = (expectedVested * optStrikePrice) / (10 ** 6);

        vm.prank(holder);
        optionContract.exercise(expectedVested);

        assertEq(optionContract.exercisedAmount(), expectedVested);
        assertEq(underlyingToken.balanceOf(holder), expectedVested);
        assertEq(
            currencyToken.balanceOf(holder),
            INITIAL_CURRENCY_BALANCE - cost
        );
        assertEq(currencyToken.balanceOf(deployer), cost);
    }

    function test_Exercise_Partial_MidVesting() public {
        uint256 midTime = optVestingCliff +
            (optVestingEnd - optVestingCliff) /
            2;
        vm.warp(midTime);

        uint256 expectedVested = getExpectedVestedSnapshot(midTime);
        assertTrue(
            expectedVested > 0 &&
                expectedVested < optionContract.originalAmount()
        );
        uint256 cost = (expectedVested * optStrikePrice) / (10 ** 6);

        vm.prank(holder);
        optionContract.exercise(expectedVested);

        assertEq(optionContract.exercisedAmount(), expectedVested);
        assertEq(underlyingToken.balanceOf(holder), expectedVested);
        assertEq(
            currencyToken.balanceOf(holder),
            INITIAL_CURRENCY_BALANCE - cost
        );
        assertEq(currencyToken.balanceOf(deployer), cost);
    }

    function test_Exercise_MultiplePartials_ExactVestedAmounts() public {
        uint256 time1 = optVestingCliff + (optVestingEnd - optVestingCliff) / 4;
        vm.warp(time1);

        uint256 vestedAtTime1 = getExpectedVestedSnapshot(time1);
        uint256 amountToExercise1 = vestedAtTime1;
        uint256 cost1 = (amountToExercise1 * optStrikePrice) / (10 ** 6);

        vm.prank(holder);
        optionContract.exercise(amountToExercise1);

        assertEq(optionContract.exercisedAmount(), vestedAtTime1);
        assertEq(underlyingToken.balanceOf(holder), vestedAtTime1);
        assertEq(
            currencyToken.balanceOf(holder),
            INITIAL_CURRENCY_BALANCE - cost1
        );
        assertEq(currencyToken.balanceOf(deployer), cost1);

        uint256 time2 = optVestingCliff +
            ((optVestingEnd - optVestingCliff) * 3) /
            4;
        vm.warp(time2);

        uint256 totalVestedAtTime2 = getExpectedVestedSnapshot(time2);
        uint256 amountToExercise2 = totalVestedAtTime2 -
            optionContract.exercisedAmount();
        assertTrue(amountToExercise2 > 0);
        uint256 cost2 = (amountToExercise2 * optStrikePrice) / (10 ** 6);

        vm.prank(holder);
        optionContract.exercise(amountToExercise2);

        assertEq(optionContract.exercisedAmount(), totalVestedAtTime2);
        assertEq(underlyingToken.balanceOf(holder), totalVestedAtTime2);
        assertEq(
            currencyToken.balanceOf(holder),
            INITIAL_CURRENCY_BALANCE - cost1 - cost2
        );
        assertEq(currencyToken.balanceOf(deployer), cost1 + cost2);
    }

    function test_Exercise_AtVestingEnd_FullAmount() public {
        vm.warp(optVestingEnd);

        uint256 amountToExercise = optionContract.originalAmount();
        uint256 cost = (amountToExercise * optStrikePrice) / (10 ** 6);

        vm.prank(holder);
        optionContract.exercise(amountToExercise);

        assertEq(optionContract.exercisedAmount(), amountToExercise);
        assertEq(underlyingToken.balanceOf(holder), amountToExercise);
        assertEq(
            currencyToken.balanceOf(holder),
            INITIAL_CURRENCY_BALANCE - cost
        );
        assertEq(currencyToken.balanceOf(deployer), cost);
    }

    function test_Exercise_AfterVestingEnd_FullAmount() public {
        vm.warp(optVestingEnd + 1 weeks);

        uint256 amountToExercise = optionContract.originalAmount();
        uint256 cost = (amountToExercise * optStrikePrice) / (10 ** 6);

        vm.prank(holder);
        optionContract.exercise(amountToExercise);

        assertEq(optionContract.exercisedAmount(), amountToExercise);
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

        uint256 vestedAtTime1 = getExpectedVestedSnapshot(time1);
        uint256 amountToExercise1 = vestedAtTime1 / 2;
        assertTrue(amountToExercise1 > 0);

        vm.prank(holder);
        optionContract.exercise(amountToExercise1);

        uint256 remainingVested = vestedAtTime1 - amountToExercise1;

        vm.prank(holder);
        vm.expectRevert(
            abi.encodeWithSelector(
                OptionLogic.InsufficientVestedAmount.selector,
                remainingVested + 1,
                remainingVested
            )
        );
        optionContract.exercise(remainingVested + 1);
    }

    function test_Revert_Exercise_AmountExceedsCurrentlyVested() public {
        uint256 midTime = optVestingCliff +
            (optVestingEnd - optVestingCliff) /
            2;
        vm.warp(midTime);

        uint256 currentlyVested = getExpectedVestedSnapshot(midTime);

        vm.prank(holder);
        vm.expectRevert(
            abi.encodeWithSelector(
                OptionLogic.InsufficientVestedAmount.selector,
                currentlyVested + 1,
                currentlyVested
            )
        );
        optionContract.exercise(currentlyVested + 1);
    }

    function test_Revert_Exercise_AmountExceedsTotalOptionAmount() public {
        vm.warp(optVestingEnd);
        vm.startPrank(holder);
        uint256 amountToExercise = optionContract.originalAmount() + 1;
        vm.expectRevert(
            abi.encodeWithSelector(
                OptionLogic.AmountExceedsTotal.selector,
                amountToExercise,
                optionContract.originalAmount()
            )
        );
        optionContract.exercise(amountToExercise);
        vm.stopPrank();
    }

    // --- Tests for stopVestingAndWithdrawUnvested ---

    function test_Revert_StopVesting_NotOwner() public {
        vm.prank(otherUser);
        vm.expectRevert(Ownable.Unauthorized.selector);
        optionContract.stopVestingAndWithdrawUnvested();
    }

    function test_Revert_StopVesting_AlreadyHalted() public {
        vm.prank(deployer);
        optionContract.stopVestingAndWithdrawUnvested();

        vm.prank(deployer);
        vm.expectRevert(OptionLogic.VestingAlreadyHalted.selector);
        optionContract.stopVestingAndWithdrawUnvested();
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

        assertTrue(optionContract.vestingIsHalted());
        assertEq(optionContract.vestingHaltTimestamp(), midTime);
        assertEq(optionContract.amount(), expectedVestedAtHalt);
        assertEq(
            underlyingToken.balanceOf(deployer),
            initialOwnerUnderlying + expectedUnvestedToWithdraw
        );
        assertEq(
            underlyingToken.balanceOf(address(optionContract)),
            expectedVestedAtHalt
        );
    }

    // --- Tests for withdrawExpiredTokens ---

    function test_Revert_WithdrawExpired_NotOwner() public {
        vm.warp(optExpiry + 1 days);
        vm.prank(otherUser);
        vm.expectRevert(Ownable.Unauthorized.selector);
        optionContract.withdrawExpiredTokens();
    }

    function test_Revert_WithdrawExpired_NotYetExpired() public {
        vm.warp(optExpiry - 1 days);
        vm.prank(deployer);
        vm.expectRevert(OptionLogic.NotYetExpired.selector);
        optionContract.withdrawExpiredTokens();
    }

    function test_WithdrawExpired_NoExercise_VestingNotHalted() public {
        vm.warp(optExpiry + 1 days);
        uint256 initialOwnerUnderlying = underlyingToken.balanceOf(deployer);
        uint256 contractUnderlying = underlyingToken.balanceOf(
            address(optionContract)
        );
        assertEq(contractUnderlying, optionContract.originalAmount());

        vm.prank(deployer);
        vm.expectEmit(false, false, false, true, address(optionContract));
        emit ExpiredTokensWithdrawn(contractUnderlying);
        optionContract.withdrawExpiredTokens();

        assertEq(
            underlyingToken.balanceOf(deployer),
            initialOwnerUnderlying + contractUnderlying
        );
        assertEq(underlyingToken.balanceOf(address(optionContract)), 0);
    }
}
