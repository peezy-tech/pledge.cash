// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "solady/tokens/ERC20.sol";
import {WETH} from "solady/tokens/WETH.sol";
import {Boardroom} from "../../src/boardroom/Boardroom.sol";
import {BoardroomFactory} from "../../src/boardroom/BoardroomFactory.sol";
import {BoardroomGovernanceLogic} from "../../src/boardroom/BoardroomGovernanceLogic.sol";
import {BoardroomPolicyRegistry} from "../../src/boardroom/BoardroomPolicyRegistry.sol";
import {BoardroomRedemptionPayout} from "../../src/boardroom/BoardroomRedemptionPayout.sol";
import {BoardroomToken} from "../../src/boardroom/BoardroomToken.sol";
import {AssetPolicy} from "../../src/policy/AssetPolicy.sol";
import {BoardroomRewards} from "../../src/rewards/BoardroomRewards.sol";
import {BoardroomRewardsFactory} from "../../src/rewards/BoardroomRewardsFactory.sol";

contract RewardCurrency is ERC20 {
    string internal tokenName;
    string internal tokenSymbol;

    constructor(string memory name_, string memory symbol_) {
        tokenName = name_;
        tokenSymbol = symbol_;
    }

    function name() public view override returns (string memory) {
        return tokenName;
    }

    function symbol() public view override returns (string memory) {
        return tokenSymbol;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract BoardroomRewardsTest is Test {
    BoardroomPolicyRegistry internal registry;
    AssetPolicy internal assetPolicy;
    BoardroomFactory internal boardroomFactory;
    BoardroomRewardsFactory internal rewardsFactory;
    RewardCurrency internal rewardToken;
    WETH internal wrappedNative;

    address internal owner = address(0xA11CE);
    address internal staker = address(0xB0B);
    address internal liquidHolder = address(0xCAFE);

    function setUp() public {
        wrappedNative = new WETH();
        registry = new BoardroomPolicyRegistry(address(this));
        assetPolicy = new AssetPolicy(address(this), address(wrappedNative));
        BoardroomGovernanceLogic governance = new BoardroomGovernanceLogic();
        BoardroomRedemptionPayout payout = new BoardroomRedemptionPayout();
        boardroomFactory =
            new BoardroomFactory(address(registry), address(wrappedNative), address(payout), address(governance));
        rewardsFactory = new BoardroomRewardsFactory(address(boardroomFactory));
        rewardToken = new RewardCurrency("Reward", "RWD");

        registry.setPolicyAllowed(address(assetPolicy), true);
        registry.registerModulePolicy(address(rewardsFactory));
        assetPolicy.setAssetAllowed(address(rewardToken), true);
        assetPolicy.setApprovalSpenderAllowed(address(rewardsFactory), true);
    }

    function testCreateRewardsRegistersCanonicalNonCustodialLocker() public {
        (Boardroom boardroom, BoardroomToken shares) = _createBoardroom("create");
        BoardroomRewards rewards = _createRewards(boardroom, 7 days, keccak256("rewards"));

        assertEq(boardroom.rewardPool(), address(rewards));
        assertEq(shares.rewardLocker(), address(rewards));
        assertEq(rewards.boardroom(), address(boardroom));
        assertEq(rewards.shareToken(), address(shares));
        assertEq(rewards.cooldown(), 7 days);
        assertEq(boardroom.obligationPolicyOf(address(rewards)), address(rewardsFactory));

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                Boardroom.CallNotAllowed.selector,
                address(rewardsFactory),
                address(rewardsFactory),
                BoardroomRewardsFactory.createRewards.selector
            )
        );
        boardroom.execute(
            _rewardsFactoryCall(abi.encodeCall(rewardsFactory.createRewards, (uint64(7 days), bytes32("again"))))
        );
    }

    function testStakeLocksTransfersAndUnstakeRemovesPowerImmediately() public {
        (Boardroom boardroom, BoardroomToken shares) = _createBoardroom("stake");
        BoardroomRewards rewards = _createRewards(boardroom, 7 days, keccak256("stake-rewards"));
        _mint(boardroom, staker, 1_000 ether);

        vm.prank(staker);
        rewards.stake(200 ether);
        assertEq(rewards.activeStakeOf(staker), 200 ether);
        assertEq(rewards.totalActiveStake(), 200 ether);
        assertEq(shares.lockedStakeBalance(staker), 200 ether);
        assertEq(shares.transferableBalanceOf(staker), 800 ether);

        vm.prank(staker);
        vm.expectRevert(
            abi.encodeWithSelector(BoardroomToken.InsufficientUnlockedBalance.selector, staker, 801 ether, 800 ether)
        );
        shares.transfer(liquidHolder, 801 ether);

        vm.prank(staker);
        uint256 slot = rewards.requestUnstake(50 ether);
        assertEq(slot, 0);
        assertEq(rewards.activeStakeOf(staker), 150 ether);
        assertEq(shares.lockedStakeBalance(staker), 200 ether);
        (uint256 amount, uint256 unlockAt) = rewards.unstakeRequest(staker, slot);
        assertEq(amount, 50 ether);
        assertEq(unlockAt, block.timestamp + 7 days);

        vm.expectRevert(abi.encodeWithSelector(BoardroomRewards.UnstakeNotReady.selector, unlockAt, block.timestamp));
        rewards.completeUnstake(staker, slot);

        vm.warp(unlockAt);
        rewards.completeUnstake(staker, slot);
        assertEq(shares.lockedStakeBalance(staker), 150 ether);
        assertEq(rewards.pendingUnstakeCount(staker), 0);
    }

    function testOnlyActiveStakeHasGovernancePowerAgainstCirculatingSupply() public {
        (Boardroom boardroom,) = _createBoardroom("governance");
        BoardroomRewards rewards = _createRewards(boardroom, 7 days, keccak256("governance-rewards"));
        _mint(boardroom, staker, 100 ether);
        _mint(boardroom, liquidHolder, 900 ether);

        vm.prank(staker);
        rewards.stake(100 ether);
        vm.prank(owner);
        boardroom.launch(1 days);
        vm.roll(block.number + 1);

        vm.prank(liquidHolder);
        vm.expectRevert(
            abi.encodeWithSelector(Boardroom.InsufficientStakerPower.selector, liquidHolder, 0, 0, 100 ether)
        );
        boardroom.startWindDown();

        vm.prank(staker);
        boardroom.startWindDown();
        assertEq(uint8(boardroom.status()), uint8(Boardroom.BoardroomStatus.WindingDown));
    }

    function testRequestUnstakeImmediatelyRemovesGovernancePower() public {
        (Boardroom boardroom,) = _createBoardroom("unstake-power");
        BoardroomRewards rewards = _createRewards(boardroom, 7 days, keccak256("unstake-power-rewards"));
        _mint(boardroom, staker, 100 ether);
        _mint(boardroom, liquidHolder, 900 ether);

        vm.prank(staker);
        rewards.stake(100 ether);
        vm.prank(owner);
        boardroom.launch(1 days);
        vm.roll(block.number + 1);

        vm.prank(staker);
        rewards.requestUnstake(1 ether);
        vm.roll(block.number + 1);

        vm.prank(staker);
        vm.expectRevert(
            abi.encodeWithSelector(Boardroom.InsufficientStakerPower.selector, staker, 99 ether, 99 ether, 100 ether)
        );
        boardroom.startWindDown();
    }

    function testFundedRewardAccruesAndClaimsWithoutShareCustody() public {
        (Boardroom boardroom, BoardroomToken shares) = _createBoardroom("claim");
        BoardroomRewards rewards = _createRewards(boardroom, 7 days, keccak256("claim-rewards"));
        _mint(boardroom, staker, 100 ether);
        vm.prank(staker);
        rewards.stake(100 ether);

        uint256 funded = 86_400 ether;
        _fundReward(boardroom, rewards, funded, 1 days);
        vm.warp(block.timestamp + 100);

        assertEq(rewards.earned(staker, address(rewardToken)), 100 ether);
        vm.prank(staker);
        uint256 claimed = rewards.claim(address(rewardToken), staker);
        assertEq(claimed, 100 ether);
        assertEq(rewardToken.balanceOf(staker), 100 ether);
        assertEq(shares.balanceOf(staker), 100 ether);
        assertEq(shares.balanceOf(address(rewards)), 0);
    }

    function testZeroStakeRewardsRemainFundedAndRollIntoNextPeriod() public {
        (Boardroom boardroom,) = _createBoardroom("zero-stake");
        BoardroomRewards rewards = _createRewards(boardroom, 7 days, keccak256("zero-stake-rewards"));
        _mint(boardroom, staker, 100 ether);

        uint256 funded = 86_400 ether;
        _fundReward(boardroom, rewards, funded, 1 days);
        vm.warp(block.timestamp + 100);

        vm.prank(staker);
        rewards.stake(100 ether);
        vm.warp(block.timestamp + 86_300);

        assertEq(rewards.earned(staker, address(rewardToken)), 86_300 ether);
        (,,,, uint256 unallocated) = rewards.rewardState(address(rewardToken));
        assertEq(unallocated, 100 ether);

        vm.prank(staker);
        rewards.claim(address(rewardToken), staker);
        assertEq(rewardToken.balanceOf(address(rewards)), 100 ether);

        _fundReward(boardroom, rewards, 86_300 ether, 1 days);
        (,, uint256 nextRate,, uint256 nextUnallocated) = rewards.rewardState(address(rewardToken));
        assertEq(nextRate, 1 ether);
        assertEq(nextUnallocated, 0);

        vm.warp(block.timestamp + 100);
        assertEq(rewards.earned(staker, address(rewardToken)), 100 ether);
    }

    function testWindDownRequiresTerminalizationAndRefundsUndistributedRewards() public {
        (Boardroom boardroom, BoardroomToken shares) = _createBoardroom("terminalize");
        BoardroomRewards rewards = _createRewards(boardroom, 7 days, keccak256("terminalize-rewards"));
        _mint(boardroom, staker, 100 ether);
        vm.prank(staker);
        rewards.stake(100 ether);

        uint256 funded = 86_400 ether;
        _fundReward(boardroom, rewards, funded, 1 days);
        vm.warp(block.timestamp + 100);

        vm.prank(owner);
        boardroom.startWindDown();
        assertTrue(shares.rewardLocksDisabled());
        assertEq(shares.transferableBalanceOf(staker), 100 ether);

        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(abi.encodeWithSelector(Boardroom.RewardPoolStillOpen.selector, address(rewards)));
        boardroom.openRedemptions();

        rewards.terminalize();
        assertTrue(rewards.terminalized());
        assertEq(rewardToken.balanceOf(address(boardroom)), funded - 100 ether);
        assertEq(rewards.earned(staker, address(rewardToken)), 100 ether);

        vm.prank(staker);
        assertEq(rewards.claim(address(rewardToken), staker), 100 ether);

        boardroom.openRedemptions();
        assertEq(uint8(boardroom.status()), uint8(Boardroom.BoardroomStatus.RedemptionsOpen));
    }

    function testPendingUnstakeQueueIsBounded() public {
        (Boardroom boardroom,) = _createBoardroom("queue");
        BoardroomRewards rewards = _createRewards(boardroom, 7 days, keccak256("queue-rewards"));
        _mint(boardroom, staker, 10 ether);
        vm.prank(staker);
        rewards.stake(10 ether);

        vm.startPrank(staker);
        for (uint256 i; i < 5; ++i) {
            rewards.requestUnstake(1 ether);
        }
        vm.expectRevert(abi.encodeWithSelector(BoardroomRewards.TooManyPendingUnstakes.selector, staker));
        rewards.requestUnstake(1 ether);
        vm.stopPrank();
    }

    function _createBoardroom(string memory seed) internal returns (Boardroom boardroom, BoardroomToken shares) {
        address created = boardroomFactory.createBoardroom(owner, "Project", "PRJ", keccak256(bytes(seed)));
        boardroom = Boardroom(payable(created));
        shares = BoardroomToken(boardroom.shareToken());
    }

    function _createRewards(Boardroom boardroom, uint64 cooldown, bytes32 salt)
        internal
        returns (BoardroomRewards rewards)
    {
        vm.prank(owner);
        bytes memory result =
            boardroom.execute(_rewardsFactoryCall(abi.encodeCall(rewardsFactory.createRewards, (cooldown, salt))));
        rewards = BoardroomRewards(abi.decode(result, (address)));
    }

    function _mint(Boardroom boardroom, address to, uint256 amount) internal {
        vm.prank(owner);
        boardroom.mint(to, amount);
    }

    function _fundReward(Boardroom boardroom, BoardroomRewards rewards, uint256 amount, uint256 duration) internal {
        rewardToken.mint(address(boardroom), amount);
        Boardroom.Call[] memory calls = new Boardroom.Call[](2);
        calls[0] = Boardroom.Call({
            policy: address(assetPolicy),
            target: address(rewardToken),
            value: 0,
            data: abi.encodeWithSignature("approve(address,uint256)", address(rewardsFactory), amount)
        });
        calls[1] = _rewardsFactoryCall(
            abi.encodeCall(rewardsFactory.fundReward, (address(rewards), address(rewardToken), amount, duration))
        );
        vm.prank(owner);
        boardroom.executeBatch(calls);
    }

    function _rewardsFactoryCall(bytes memory data) internal view returns (Boardroom.Call memory) {
        return Boardroom.Call({policy: address(rewardsFactory), target: address(rewardsFactory), value: 0, data: data});
    }
}
