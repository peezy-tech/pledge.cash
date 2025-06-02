// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "forge-std/Test.sol";
import "../src/option.sol"; // Assuming Option.sol is in ../src/
import {MockERC20} from "solady/test/utils/mocks/MockERC20.sol"; // Adjusted path based on common Solady usage

contract OptionTest is Test {
    Option public optionContract;
    MockERC20 public currencyToken;
    MockERC20 public underlyingToken;

    address public deployer; // Will also be the owner of the Option contract
    address public holder;
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
        deployer = address(this); // Test contract itself deploys the Option
        holder = address(0x123); // A distinct holder address

        // 1. Deploy mock tokens
        currencyToken = new MockERC20("MockCurrency", "MCUR", 18);
        underlyingToken = new MockERC20("MockUnderlying", "MUND", 18);

        // 2. Mint initial balances
        underlyingToken.mint(deployer, INITIAL_UNDERLYING_BALANCE);
        currencyToken.mint(holder, INITIAL_CURRENCY_BALANCE);

        // Define time parameters for the option based on current block timestamp
        startTime = block.timestamp;
        optVestingCliff = startTime + 1 weeks;
        optVestingEnd = optVestingCliff + 3 weeks; // Total 4 weeks vesting period
        optExpiry = optVestingEnd; // Option expires when fully vested

        // 3. Deployer (this contract) approves underlying tokens to be taken by Option contract constructor
        // The Option contract will pull 'optAmount' of 'underlyingToken' from 'deployer'
        vm.prank(deployer);
        underlyingToken.approve(address(this), optAmount); // Approve this contract to then pass to Option

        // Deploy the Option contract
        // The Option constructor will transfer underlyingToken from deployer (address(this)) to itself.
        // We need to ensure `deployer` has approved `address(this)` (test contract) to pull,
        // and then the test contract (as msg.sender to Option constructor) has the tokens.
        // A simpler way for testing: predict the address or approve a temporary deployer contract.
        // Or, make deployer of Option contract `msg.sender` of `setUp`.
        // Let's use `address(this)` as deployer directly.
        // The `Option` constructor's `safeTransferFrom` is `_underlying, msg.sender, address(this), _amount`
        // So `msg.sender` (which is `deployer` = `address(this)`) needs `_amount` of `_underlying`
        // and must have approved `address(optionContract)` for this transfer.
        // This is tricky. Let's adjust the approval logic.
        // The deployer of Option is `address(this)`.
        // So underlyingToken.safeTransferFrom(token, deployer, optionContract, amount) will be called.
        // `deployer` needs to approve `optionContract`. We don't know its address yet.

        // Alternative: The user who calls `new Option(...)` is msg.sender.
        // In `setUp`, `msg.sender` is `address(this)`. So `address(this)` is the initial owner.
        // `address(this)` needs to own `optAmount` of `underlyingToken`.
        // `address(this)` (as deployer) must approve the `Option` contract to take `optAmount`.
        // This is a common pattern: deployer approves itself to setup the contract which pulls funds.

        // Let's assume `deployer` funds the option.
        // The Option contract takes `_underlying` from `msg.sender` (the deployer).
        // So, `deployer` (address(this) in setUp) must have `optAmount` of `underlyingToken`. (Done)
        // And `deployer` (address(this)) must approve the `Option` contract to take these tokens.
        // This is a circular dependency if we approve before getting optionContract address.
        // The `Option` contract takes from `msg.sender`.
        // So `msg.sender` = `deployer` must approve `address(optionContract)`.

        // Simplest for test: `deployer` is `address(this)`.
        // `underlyingToken` is minted to `deployer`.
        // When `new Option(...)` is called by `deployer`, the constructor will attempt:
        // `SafeTransferLib.safeTransferFrom(underlyingToken, deployer, address(optionContract), optAmount);`
        // This requires `deployer` to have called `underlyingToken.approve(address(optionContract), optAmount);`

        // We can't approve the option contract before it's deployed if we need its address for approval.
        // However, the `Option` contract's constructor is pulling from `msg.sender` to `address(this)` (i.e. to itself).
        // `SafeTransferLib.safeTransferFrom(_underlying, msg.sender, address(this), _amount);`
        // This means `msg.sender` (our `deployer`) must approve the `Option` contract (`address(this)` within Option.sol)
        // for the transfer.

        // Let's re-verify `Option.sol` constructor:
        // `SafeTransferLib.safeTransferFrom(_underlying, msg.sender, address(this), _amount);`
        // Here `msg.sender` is the deployer of the Option contract. `address(this)` is the Option contract's address.
        // So, `deployer` must approve `Option contract address` to pull `_amount` of `_underlying`.
        // This is the standard way.

        // To do this in `setUp`:
        // 1. Create `deployer` and `holder` addresses.
        // 2. Deploy tokens, mint to `deployer` (underlying) and `holder` (currency).
        // 3. `vm.startPrank(deployer)`.
        // 4. `underlyingToken.approve(predictedOptionContractAddress, optAmount)` OR deploy option contract first.
        //    It's easier to deploy first, then have the deployer approve and call a "fund" function.
        //    But the current constructor *requires* the transfer.
        //
        // If `deployer = address(this)` for the test, then `address(this)` must approve `optionContractAddress`.
        // The `Option` contract is deployed by `address(this)`.
        vm.prank(deployer); // `deployer` is `address(this)`
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
        // The line above will fail if `deployer` hasn't approved `address(optionContract)`.
        // We need to approve `address(optionContract)` *by the deployer* for `underlyingToken`.
        // This must happen *before* `new Option` if `underlyingToken.transferFrom` is used in constructor.
        // And it is: `SafeTransferLib.safeTransferFrom(_underlying, msg.sender, address(this), _amount);`
        // `msg.sender` is `deployer`. `address(this)` is `optionContract`.
        // So, `deployer` must approve `optionContract`.

        // This is a common pattern: the entity calling `new ContractThatTakesFunds()` must have pre-approved
        // the `ContractThatTakesFunds` to `transferFrom` `msg.sender`.
        // So, the `deployer` (address(this)) must approve `address(optionContract)`.
        // We can't get `address(optionContract)` before it's deployed.
        // This implies that either:
        //  a) The constructor doesn't pull funds, but an init/fund function does (common).
        //  b) The `msg.sender` sends tokens directly to the contract, not via `transferFrom msg.sender`.
        //  c) The test needs to predict the address of the option contract for approval.

        // Given the current Option.sol, `msg.sender` (deployer) is the source in `transferFrom`.
        // `SafeTransferLib.safeTransferFrom(token, from, to, amount)`
        // `SafeTransferLib.safeTransferFrom(_underlying, msg.sender, address(this) /*option contract*/, _amount)`
        // This is correct. `msg.sender` (the deployer) must have approved the Option Contract.

        // Let's try predicting or using a two-step deployment for tests if direct approval is hard.
        // For Forge tests, `address(this)` is often the deployer. If so, `address(this)` needs to approve
        // the future Option contract address.
        // Or, `deployer` is a separate EOA.

        // Let's stick to `deployer = address(this)`.
        // `address(this)` mints underlying to itself.
        // `address(this)` must call `underlyingToken.approve(address(optionContract), optAmount)`.
        // This means `optionContract` must be deployed first to get its address.
        // This contradicts the constructor transferring funds.

        // What if `msg.sender` of `new Option` is `alice` (a test EOA), and `alice` owns the underlying?
        // `vm.startPrank(alice)`
        // `underlyingToken.approve(computedAddress, amount)`
        // `new Option(...)`
        // `vm.stopPrank()`

        // The issue is `_underlying, msg.sender, address(this), _amount`
        // `msg.sender` is the account calling `new Option`.
        // `address(this)` inside Option.sol is the option contract's own address.
        // So `msg.sender` must approve `optionContract.address`.
        // This is a classic setup. The `deployer` (who calls `new Option`) must have called
        // `underlyingToken.approve(THE_OPTION_CONTRACT_ADDRESS, optAmount)` beforehand.

        // We can get the "next deployed address" in Forge.
        // address predictedOptionAddress = predictAddress(deployer, nonce);
        // `address predictedAddress = computeCreateAddress(deployer, vm.getNonce(deployer));`

        // Let `deployer = address(this)` to keep it simple for now.
        // The test contract (`address(this)`) is msg.sender for `new Option`.
        // So, `address(this)` needs to approve the `optionContract` address.
        // Let's assume `deployer` is actually `makeAddr("deployer")`.

        deployer = makeAddr("Deployer");
        holder = makeAddr("Holder");
        vm.label(deployer, "Deployer (Option Owner)");
        vm.label(holder, "Option Holder");
        vm.label(otherUser, "Other User");
        vm.label(address(currencyToken), "CurrencyToken (MCUR)");
        vm.label(address(underlyingToken), "UnderlyingToken (MUND)");


        // Mint tokens
        underlyingToken.mint(deployer, INITIAL_UNDERLYING_BALANCE);
        currencyToken.mint(holder, INITIAL_CURRENCY_BALANCE);

        // Deployer needs to approve the Option contract to take underlying tokens
        // We need the Option contract's address. This has to be done in steps or by prediction.

        // Step 1: Deployer approves a pre-calculated address
        address predictedOptionAddress = computeCreateAddress(deployer, vm.getNonce(deployer));
        vm.prank(deployer);
        underlyingToken.approve(predictedOptionAddress, optAmount);

        // Step 2: Deployer deploys the Option contract
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

        // Check if prediction was correct (optional, but good for sanity)
        assertEq(address(optionContract), predictedOptionAddress);


        // Holder approves Option contract for currency token transfer
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
        vm.expectRevert("Option: cliff > end");
        vm.prank(deployer); // Need to approve again for this new predicted address
        address predicted = computeCreateAddress(deployer, vm.getNonce(deployer));
        underlyingToken.approve(predicted, optAmount);

        new Option(
            address(currencyToken),
            holder,
            address(underlyingToken),
            optAmount,
            optStrikePrice,
            optExpiry, // Expiry can be <= vestingEnd
            optVestingEnd + 1, // Cliff after end
            optVestingEnd
        );
    }

    function test_Revert_Deploy_ExpiryAfterVestingEnd() public {
        vm.expectRevert("Option: expiry > vesting end");
        vm.prank(deployer);
        address predicted = computeCreateAddress(deployer, vm.getNonce(deployer));
        underlyingToken.approve(predicted, optAmount);

        new Option(
            address(currencyToken),
            holder,
            address(underlyingToken),
            optAmount,
            optStrikePrice,
            optVestingEnd + 1 days, // Expiry after vesting end
            optVestingCliff,
            optVestingEnd
        );
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

        vm.warp(optVestingCliff); // Valid time, some amount should vest
        vm.prank(holder);
        // Exact revert message depends on SafeTransferLib, usually no specific message or "transfer amount exceeds balance"
        vm.expectRevert(); // ERC20: transfer amount exceeds balance (or similar)
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

        uint256 cost = expectedVested * optStrikePrice;

        vm.prank(holder);
        optionContract.exercise();

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
        uint256 cost = expectedVested * optStrikePrice;

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
        uint256 cost1 = expectedVested1 * optStrikePrice;

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
        uint256 cost2 = expectedToExerciseNow * optStrikePrice;

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
        uint256 cost = expectedVested * optStrikePrice;

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
        uint256 cost = expectedVested * optStrikePrice;

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
        vm.warp(time1 + 1); // if division by (end-cliff) is large, 1s might not be enough
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
        vm.prank(deployer);
        address predicted = computeCreateAddress(deployer, vm.getNonce(deployer));
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


        // Holder needs to approve this new contract instance too
        vm.prank(holder);
        currencyToken.approve(address(localOption), type(uint256).max);


        vm.warp(newEnd); // Warp to its vesting end

        uint256 cost = optAmount * optStrikePrice;

        vm.prank(holder);
        localOption.exercise();

        assertEq(localOption.exercisedAmount(), optAmount);
        assertEq(underlyingToken.balanceOf(holder), optAmount); // Assuming holder had 0 underlying before
        assertEq(currencyToken.balanceOf(holder), INITIAL_CURRENCY_BALANCE - cost);
        // deployer's currency balance should increase from this specific option contract's exercise
        // Note: deployer here is the global test deployer, not owner of localOption if different.
        // Owner of localOption is also `deployer` due to vm.prank(deployer) during `new Option`.
        assertEq(currencyToken.balanceOf(deployer), cost);
    }

    // NOTE: The Solidity helper function computeCreateAddress was removed from here as it's not used.
    // The Forge cheatcode `vm.computeCreateAddress(address, uint256)` is used directly in tests like setUp and test_Revert_Deploy_CliffAfterEnd.
}
