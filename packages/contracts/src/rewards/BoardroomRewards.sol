// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Initializable} from "solady/utils/Initializable.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {ExactTransferLib} from "../lib/ExactTransferLib.sol";
import {BestEffortTokenLib} from "../lib/BestEffortTokenLib.sol";

interface IBoardroomRewardsBoardroom {
    function status() external view returns (uint8);
    function windDownStartedAt() external view returns (uint256);
}

interface IBoardroomRewardsShareToken {
    function balanceOf(address account) external view returns (uint256);
    function isEncumberedAccount(address account) external view returns (bool);
    function lockStake(address account, uint256 amount) external;
    function unlockStake(address account, uint256 amount) external;
}

contract BoardroomRewards is Initializable, ReentrancyGuard {
    uint8 internal constant BOARDROOM_STATUS_ACTIVE = 0;
    uint256 internal constant PRECISION = 1e18;
    uint256 public constant MAX_REWARD_ASSETS = 8;
    uint256 public constant MAX_PENDING_UNSTAKES = 5;
    uint256 public constant MIN_REWARD_DURATION = 1 days;
    uint256 public constant MAX_REWARD_DURATION = 365 days;

    struct Checkpoint {
        uint48 fromBlock;
        uint208 value;
    }

    struct UnstakeRequest {
        uint208 amount;
        uint48 unlockAt;
    }

    struct RewardState {
        uint64 periodFinish;
        uint64 lastUpdateTime;
        uint256 rewardRate;
        uint256 rewardPerTokenStored;
        uint256 unallocated;
    }

    address public factory;
    address public boardroom;
    address public shareToken;
    uint64 public cooldown;
    bool public terminalized;
    uint256 public totalActiveStake;

    address[] internal rewardAssets;
    mapping(address asset => bool) public isRewardAsset;
    mapping(address asset => RewardState) public rewardState;
    mapping(address account => uint256) public activeStakeOf;
    mapping(address account => Checkpoint[]) internal activeStakeCheckpoints;
    Checkpoint[] internal totalActiveStakeCheckpoints;
    mapping(address account => UnstakeRequest[MAX_PENDING_UNSTAKES]) internal unstakeRequests;
    mapping(address account => uint256) public pendingUnstakeCount;
    mapping(address account => mapping(address asset => uint256)) public userRewardPerTokenPaid;
    mapping(address account => mapping(address asset => uint256)) public accruedReward;

    error InvalidAddress();
    error InvalidAmount();
    error InvalidCooldown();
    error InvalidRewardDuration();
    error InvalidRewardAsset(address asset);
    error TooManyRewardAssets();
    error TooManyPendingUnstakes(address account);
    error InvalidUnstakeRequest(address account, uint256 slot);
    error UnstakeNotReady(uint256 unlockAt, uint256 currentTime);
    error InsufficientActiveStake(uint256 requested, uint256 available);
    error InsufficientUnlockedBalance(uint256 requested, uint256 available);
    error EncumberedAccount(address account);
    error BoardroomNotActive();
    error BoardroomStillActive();
    error RewardProgramTerminalized();
    error OnlyFactory();
    error CheckpointValueOverflow(uint256 value);
    error FutureCheckpointLookup(uint256 requestedBlock, uint256 currentBlock);
    error UnexpectedTokenBalanceChange(address token, uint256 expected, uint256 actual);

    event BoardroomRewardsInitialized(
        address indexed boardroom, address indexed shareToken, address indexed factory, uint256 cooldown
    );
    event StakeLocked(address indexed account, uint256 amount, uint256 activeStake);
    event UnstakeRequested(
        address indexed account, uint256 indexed slot, uint256 amount, uint256 unlockAt, uint256 activeStake
    );
    event UnstakeCompleted(address indexed account, uint256 indexed slot, uint256 amount);
    event RewardFunded(
        address indexed asset, uint256 amount, uint256 duration, uint256 rewardRate, uint256 periodFinish
    );
    event RewardClaimed(address indexed account, address indexed recipient, address indexed asset, uint256 amount);
    event RewardRefunded(address indexed asset, uint256 expected, uint256 returned);
    event RewardRefundQuarantined(address indexed asset, uint256 expected, uint256 returned);
    event RewardsTerminalized(uint256 stoppedAt);

    constructor() {
        _disableInitializers();
    }

    function initialize(address boardroom_, address shareToken_, uint64 cooldown_) external initializer {
        if (boardroom_ == address(0) || shareToken_ == address(0)) revert InvalidAddress();
        if (cooldown_ == 0 || cooldown_ > 30 days) revert InvalidCooldown();

        factory = msg.sender;
        boardroom = boardroom_;
        shareToken = shareToken_;
        cooldown = cooldown_;

        emit BoardroomRewardsInitialized(boardroom_, shareToken_, msg.sender, cooldown_);
    }

    function stake(uint256 amount) external nonReentrant {
        _requireActive();
        if (amount == 0) revert InvalidAmount();

        IBoardroomRewardsShareToken shares = IBoardroomRewardsShareToken(shareToken);
        if (shares.isEncumberedAccount(msg.sender)) revert EncumberedAccount(msg.sender);
        uint256 balance = shares.balanceOf(msg.sender);
        uint256 locked = lockedStakeOf(msg.sender);
        uint256 available = balance > locked ? balance - locked : 0;
        if (amount > available) revert InsufficientUnlockedBalance(amount, available);

        _updateAllRewards(msg.sender, block.timestamp);
        shares.lockStake(msg.sender, amount);

        uint256 nextActive = activeStakeOf[msg.sender] + amount;
        uint256 nextTotal = totalActiveStake + amount;
        activeStakeOf[msg.sender] = nextActive;
        totalActiveStake = nextTotal;
        _writeCheckpoint(activeStakeCheckpoints[msg.sender], nextActive);
        _writeCheckpoint(totalActiveStakeCheckpoints, nextTotal);

        emit StakeLocked(msg.sender, amount, nextActive);
    }

    function requestUnstake(uint256 amount) external nonReentrant returns (uint256 slot) {
        _requireActive();
        if (amount == 0) revert InvalidAmount();
        uint256 active = activeStakeOf[msg.sender];
        if (amount > active) revert InsufficientActiveStake(amount, active);

        slot = _emptyUnstakeSlot(msg.sender);
        _updateAllRewards(msg.sender, block.timestamp);

        uint256 nextActive = active - amount;
        uint256 nextTotal = totalActiveStake - amount;
        activeStakeOf[msg.sender] = nextActive;
        totalActiveStake = nextTotal;
        _writeCheckpoint(activeStakeCheckpoints[msg.sender], nextActive);
        _writeCheckpoint(totalActiveStakeCheckpoints, nextTotal);

        uint256 unlockAt = block.timestamp + cooldown;
        unstakeRequests[msg.sender][slot] = UnstakeRequest({amount: uint208(amount), unlockAt: uint48(unlockAt)});
        pendingUnstakeCount[msg.sender] += 1;
        emit UnstakeRequested(msg.sender, slot, amount, unlockAt, nextActive);
    }

    function completeUnstake(address account, uint256 slot) external nonReentrant returns (uint256 amount) {
        if (account == address(0)) revert InvalidAddress();
        if (slot >= MAX_PENDING_UNSTAKES) revert InvalidUnstakeRequest(account, slot);

        UnstakeRequest memory request = unstakeRequests[account][slot];
        amount = request.amount;
        if (amount == 0) revert InvalidUnstakeRequest(account, slot);
        if (_boardroomIsActive() && block.timestamp < request.unlockAt) {
            revert UnstakeNotReady(request.unlockAt, block.timestamp);
        }

        delete unstakeRequests[account][slot];
        pendingUnstakeCount[account] -= 1;
        IBoardroomRewardsShareToken(shareToken).unlockStake(account, amount);
        emit UnstakeCompleted(account, slot, amount);
    }

    function claim(address asset, address recipient) external nonReentrant returns (uint256 amount) {
        if (recipient == address(0)) revert InvalidAddress();
        if (!isRewardAsset[asset]) revert InvalidRewardAsset(asset);

        _updateReward(asset, msg.sender, _rewardStopTime());
        amount = accruedReward[msg.sender][asset];
        if (amount == 0) return 0;
        accruedReward[msg.sender][asset] = 0;

        ExactTransferLib.ExactDelta memory delta = ExactTransferLib.sendFromSelfTo(asset, recipient, amount);
        if (delta.senderBalanceIncreased || delta.senderSpent != amount) {
            revert UnexpectedTokenBalanceChange(asset, amount, delta.senderSpent);
        }
        if (delta.recipientBalanceDecreased || delta.recipientReceived != amount) {
            revert UnexpectedTokenBalanceChange(asset, amount, delta.recipientReceived);
        }
        emit RewardClaimed(msg.sender, recipient, asset, amount);
    }

    function notifyRewardAmount(address asset, uint256 amount, uint256 duration) external nonReentrant onlyFactory {
        _requireActive();
        if (asset == address(0) || asset == shareToken || asset.code.length == 0) revert InvalidRewardAsset(asset);
        if (amount == 0) revert InvalidAmount();
        if (duration < MIN_REWARD_DURATION || duration > MAX_REWARD_DURATION) revert InvalidRewardDuration();

        if (!isRewardAsset[asset]) {
            if (rewardAssets.length >= MAX_REWARD_ASSETS) revert TooManyRewardAssets();
            isRewardAsset[asset] = true;
            rewardAssets.push(asset);
        }

        RewardState storage state = rewardState[asset];
        _updateRewardState(state, block.timestamp);
        uint256 remaining = block.timestamp < state.periodFinish
            ? (uint256(state.periodFinish) - block.timestamp) * state.rewardRate
            : 0;
        uint256 distributable = amount + remaining + state.unallocated;
        uint256 rate = distributable / duration;
        if (rate == 0) revert InvalidAmount();

        state.unallocated = distributable % duration;
        state.rewardRate = rate;
        state.lastUpdateTime = uint64(block.timestamp);
        state.periodFinish = uint64(block.timestamp + duration);
        emit RewardFunded(asset, amount, duration, rate, state.periodFinish);
    }

    function terminalize() external nonReentrant {
        if (_boardroomIsActive()) revert BoardroomStillActive();
        if (terminalized) return;

        uint256 stopTime = IBoardroomRewardsBoardroom(boardroom).windDownStartedAt();
        uint256 length = rewardAssets.length;
        for (uint256 i; i < length; ++i) {
            address asset = rewardAssets[i];
            RewardState storage state = rewardState[asset];
            _updateRewardState(state, stopTime);

            uint256 remaining =
                stopTime < state.periodFinish ? (uint256(state.periodFinish) - stopTime) * state.rewardRate : 0;
            uint256 refund = remaining + state.unallocated;
            state.periodFinish = uint64(stopTime);
            state.lastUpdateTime = uint64(stopTime);
            state.rewardRate = 0;
            state.unallocated = 0;
            if (refund != 0) _refundBestEffort(asset, refund);
        }

        terminalized = true;
        emit RewardsTerminalized(stopTime);
    }

    function isTerminalized() external view returns (bool) {
        return terminalized;
    }

    function rewardAssetCount() external view returns (uint256) {
        return rewardAssets.length;
    }

    function rewardAssetAt(uint256 index) external view returns (address) {
        return rewardAssets[index];
    }

    function getRewardAssets() external view returns (address[] memory) {
        return rewardAssets;
    }

    function unstakeRequest(address account, uint256 slot) external view returns (uint256 amount, uint256 unlockAt) {
        if (slot >= MAX_PENDING_UNSTAKES) revert InvalidUnstakeRequest(account, slot);
        UnstakeRequest memory request = unstakeRequests[account][slot];
        return (request.amount, request.unlockAt);
    }

    function lockedStakeOf(address account) public view returns (uint256 locked) {
        locked = activeStakeOf[account];
        for (uint256 i; i < MAX_PENDING_UNSTAKES; ++i) {
            locked += unstakeRequests[account][i].amount;
        }
    }

    function earned(address account, address asset) external view returns (uint256) {
        if (!isRewardAsset[asset]) return 0;
        RewardState memory state = rewardState[asset];
        uint256 applicable = _applicableRewardTime(state, _rewardStopTime());
        uint256 rewardPerToken = state.rewardPerTokenStored;
        if (applicable > state.lastUpdateTime && totalActiveStake != 0) {
            uint256 emitted = (applicable - uint256(state.lastUpdateTime)) * state.rewardRate;
            rewardPerToken += emitted * PRECISION / totalActiveStake;
        }
        return accruedReward[account][asset] + activeStakeOf[account]
            * (rewardPerToken - userRewardPerTokenPaid[account][asset]) / PRECISION;
    }

    function getPastActiveStake(address account, uint256 blockNumber) external view returns (uint256) {
        return _checkpointLookup(activeStakeCheckpoints[account], blockNumber);
    }

    function getPastTotalActiveStake(uint256 blockNumber) external view returns (uint256) {
        return _checkpointLookup(totalActiveStakeCheckpoints, blockNumber);
    }

    function activeStakeCheckpointCount(address account) external view returns (uint256) {
        return activeStakeCheckpoints[account].length;
    }

    function totalActiveStakeCheckpointCount() external view returns (uint256) {
        return totalActiveStakeCheckpoints.length;
    }

    modifier onlyFactory() {
        if (msg.sender != factory) revert OnlyFactory();
        _;
    }

    function _requireActive() internal view {
        if (terminalized) revert RewardProgramTerminalized();
        if (!_boardroomIsActive()) revert BoardroomNotActive();
    }

    function _boardroomIsActive() internal view returns (bool) {
        return IBoardroomRewardsBoardroom(boardroom).status() == BOARDROOM_STATUS_ACTIVE;
    }

    function _rewardStopTime() internal view returns (uint256) {
        if (_boardroomIsActive()) return block.timestamp;
        return IBoardroomRewardsBoardroom(boardroom).windDownStartedAt();
    }

    function _emptyUnstakeSlot(address account) internal view returns (uint256 slot) {
        for (; slot < MAX_PENDING_UNSTAKES; ++slot) {
            if (unstakeRequests[account][slot].amount == 0) return slot;
        }
        revert TooManyPendingUnstakes(account);
    }

    function _updateAllRewards(address account, uint256 timestamp) internal {
        uint256 length = rewardAssets.length;
        for (uint256 i; i < length; ++i) {
            _updateReward(rewardAssets[i], account, timestamp);
        }
    }

    function _updateReward(address asset, address account, uint256 timestamp) internal {
        RewardState storage state = rewardState[asset];
        _updateRewardState(state, timestamp);
        uint256 paid = userRewardPerTokenPaid[account][asset];
        uint256 current = state.rewardPerTokenStored;
        if (current != paid) {
            accruedReward[account][asset] += activeStakeOf[account] * (current - paid) / PRECISION;
            userRewardPerTokenPaid[account][asset] = current;
        }
    }

    function _updateRewardState(RewardState storage state, uint256 timestamp) internal {
        uint256 applicable = _applicableRewardTime(state, timestamp);
        uint256 last = state.lastUpdateTime;
        if (applicable <= last) return;

        uint256 emitted = (applicable - last) * state.rewardRate;
        if (totalActiveStake == 0) state.unallocated += emitted;
        else state.rewardPerTokenStored += emitted * PRECISION / totalActiveStake;
        state.lastUpdateTime = uint64(applicable);
    }

    function _applicableRewardTime(RewardState memory state, uint256 timestamp) internal pure returns (uint256) {
        uint256 finish = state.periodFinish;
        return timestamp < finish ? timestamp : finish;
    }

    function _refundBestEffort(address asset, uint256 expected) internal {
        (bool poolReadable, uint256 poolBefore) = BestEffortTokenLib.tryBalanceOf(asset, address(this));
        (bool boardroomReadable, uint256 boardroomBefore) = BestEffortTokenLib.tryBalanceOf(asset, boardroom);
        bool called = poolReadable && boardroomReadable && BestEffortTokenLib.tryTransfer(asset, boardroom, expected);
        (bool poolAfterReadable, uint256 poolAfter) = BestEffortTokenLib.tryBalanceOf(asset, address(this));
        (bool boardroomAfterReadable, uint256 boardroomAfter) = BestEffortTokenLib.tryBalanceOf(asset, boardroom);

        uint256 spent = poolAfterReadable && poolBefore >= poolAfter ? poolBefore - poolAfter : 0;
        uint256 returned =
            boardroomAfterReadable && boardroomAfter >= boardroomBefore ? boardroomAfter - boardroomBefore : 0;
        if (called && poolAfterReadable && boardroomAfterReadable && spent == expected && returned == expected) {
            emit RewardRefunded(asset, expected, returned);
        } else {
            emit RewardRefundQuarantined(asset, expected, returned);
        }
    }

    function _writeCheckpoint(Checkpoint[] storage checkpoints, uint256 value) internal {
        if (value > type(uint208).max) revert CheckpointValueOverflow(value);
        uint48 currentBlock = uint48(block.number);
        uint256 length = checkpoints.length;
        if (length != 0 && checkpoints[length - 1].fromBlock == currentBlock) {
            checkpoints[length - 1].value = uint208(value);
        } else {
            checkpoints.push(Checkpoint({fromBlock: currentBlock, value: uint208(value)}));
        }
    }

    function _checkpointLookup(Checkpoint[] storage checkpoints, uint256 blockNumber) internal view returns (uint256) {
        if (blockNumber >= block.number) revert FutureCheckpointLookup(blockNumber, block.number);
        uint256 low;
        uint256 high = checkpoints.length;
        while (low < high) {
            uint256 midpoint = (low + high) >> 1;
            if (checkpoints[midpoint].fromBlock > blockNumber) high = midpoint;
            else low = midpoint + 1;
        }
        return high == 0 ? 0 : checkpoints[high - 1].value;
    }
}
