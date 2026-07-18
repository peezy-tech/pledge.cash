// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "solady/tokens/ERC20.sol";

contract BoardroomToken is ERC20 {
    struct Checkpoint {
        uint48 fromBlock;
        uint208 value;
    }

    address public immutable boardroom;

    string internal tokenName;
    string internal tokenSymbol;
    mapping(address => Checkpoint[]) internal balanceCheckpoints;
    Checkpoint[] internal totalSupplyCheckpoints;
    /// @notice Permanent canonical-custody classification; accounts are never reclassified as voters.
    mapping(address => bool) public isEncumberedAccount;
    /// @notice Sum of all share balances held by registered non-voting custodians.
    uint256 public encumberedSupply;
    Checkpoint[] internal encumberedSupplyCheckpoints;
    address public rewardLocker;
    bool public rewardLocksDisabled;
    mapping(address => uint256) public lockedStakeBalance;

    error InvalidAddress();
    error InvalidAmount();
    error OnlyBoardroom();
    error FutureCheckpointLookup(uint256 requestedBlock, uint256 currentBlock);
    error CheckpointValueOverflow(uint256 value);
    error InvalidEncumberedAccount(address account);
    error EncumberedAccountAlreadyRegistered(address account);
    error InvalidRewardLocker(address locker);
    error RewardLockerAlreadyRegistered(address locker);
    error OnlyRewardLocker();
    error RewardLocksAreDisabled();
    error InsufficientUnlockedBalance(address account, uint256 requested, uint256 available);
    error InsufficientLockedStake(address account, uint256 requested, uint256 available);

    event EncumberedAccountRegistered(address indexed account, uint256 balance);
    event RewardLockerRegistered(address indexed locker);
    event StakeBalanceLocked(address indexed account, uint256 amount, uint256 lockedBalance);
    event StakeBalanceUnlocked(address indexed account, uint256 amount, uint256 lockedBalance);
    event RewardLocksDisabled();

    constructor(address boardroom_, string memory name_, string memory symbol_) {
        if (boardroom_ == address(0)) revert InvalidAddress();

        boardroom = boardroom_;
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
        _requireBoardroomCaller();
        _requireTokenAccount(to);
        _requireTokenAmount(amount);

        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _requireBoardroomCaller();
        _requireTokenAccount(from);
        _requireTokenAmount(amount);

        _burn(from, amount);
    }

    /// @notice Permanently classifies a canonically authenticated obligation custodian as non-voting.
    /// @dev The existing balance is included because canonical obligations are funded before Boardroom records them.
    function registerEncumberedAccount(address account) external {
        _requireBoardroomCaller();
        if (account == address(0) || account == boardroom || account.code.length == 0) {
            revert InvalidEncumberedAccount(account);
        }
        if (isEncumberedAccount[account]) revert EncumberedAccountAlreadyRegistered(account);

        isEncumberedAccount[account] = true;
        uint256 balance = balanceOf(account);
        if (balance != 0) _setEncumberedSupply(encumberedSupply + balance);
        emit EncumberedAccountRegistered(account, balance);
    }

    function registerRewardLocker(address locker) external {
        _requireBoardroomCaller();
        if (locker == address(0) || locker.code.length == 0 || locker == boardroom) {
            revert InvalidRewardLocker(locker);
        }
        if (rewardLocker != address(0)) revert RewardLockerAlreadyRegistered(rewardLocker);
        rewardLocker = locker;
        emit RewardLockerRegistered(locker);
    }

    function lockStake(address account, uint256 amount) external {
        _requireRewardLockerCaller();
        if (rewardLocksDisabled) revert RewardLocksAreDisabled();
        _requireTokenAccount(account);
        _requireTokenAmount(amount);

        uint256 balance = balanceOf(account);
        uint256 locked = lockedStakeBalance[account];
        uint256 available = balance > locked ? balance - locked : 0;
        if (amount > available) revert InsufficientUnlockedBalance(account, amount, available);
        uint256 nextLocked = locked + amount;
        lockedStakeBalance[account] = nextLocked;
        emit StakeBalanceLocked(account, amount, nextLocked);
    }

    function unlockStake(address account, uint256 amount) external {
        _requireRewardLockerCaller();
        _requireTokenAccount(account);
        _requireTokenAmount(amount);

        uint256 locked = lockedStakeBalance[account];
        if (amount > locked) revert InsufficientLockedStake(account, amount, locked);
        uint256 nextLocked = locked - amount;
        lockedStakeBalance[account] = nextLocked;
        emit StakeBalanceUnlocked(account, amount, nextLocked);
    }

    function disableRewardLocks() external {
        _requireBoardroomCaller();
        if (rewardLocksDisabled) return;
        rewardLocksDisabled = true;
        emit RewardLocksDisabled();
    }

    function transferableBalanceOf(address account) external view returns (uint256) {
        uint256 balance = balanceOf(account);
        if (rewardLocksDisabled) return balance;
        uint256 locked = lockedStakeBalance[account];
        return balance > locked ? balance - locked : 0;
    }

    /// @notice Current circulating supply used as the denominator for active-staker governance thresholds.
    /// @dev Redemption accounting intentionally continues to use total supply after treasury burning.
    function governanceEligibleSupply() public view returns (uint256) {
        return totalSupply() - balanceOf(boardroom) - encumberedSupply;
    }

    function getPastBalance(address account, uint256 blockNumber) external view returns (uint256) {
        return _checkpointLookup(balanceCheckpoints[account], blockNumber);
    }

    function getPastTotalSupply(uint256 blockNumber) external view returns (uint256) {
        return _checkpointLookup(totalSupplyCheckpoints, blockNumber);
    }

    function getPastEncumberedSupply(uint256 blockNumber) external view returns (uint256) {
        return _checkpointLookup(encumberedSupplyCheckpoints, blockNumber);
    }

    function getPastGovernanceEligibleSupply(uint256 blockNumber) external view returns (uint256) {
        return _checkpointLookup(totalSupplyCheckpoints, blockNumber)
            - _checkpointLookup(balanceCheckpoints[boardroom], blockNumber)
            - _checkpointLookup(encumberedSupplyCheckpoints, blockNumber);
    }

    function balanceCheckpointCount(address account) external view returns (uint256) {
        return balanceCheckpoints[account].length;
    }

    function totalSupplyCheckpointCount() external view returns (uint256) {
        return totalSupplyCheckpoints.length;
    }

    function encumberedSupplyCheckpointCount() external view returns (uint256) {
        return encumberedSupplyCheckpoints.length;
    }

    function _afterTokenTransfer(address from, address to, uint256 amount) internal override {
        if (from != address(0)) _writeCheckpoint(balanceCheckpoints[from], balanceOf(from));
        if (to != address(0) && to != from) _writeCheckpoint(balanceCheckpoints[to], balanceOf(to));
        if (from == address(0) || to == address(0)) _writeCheckpoint(totalSupplyCheckpoints, totalSupply());

        if (from == to) return;
        bool fromEncumbered = isEncumberedAccount[from];
        bool toEncumbered = isEncumberedAccount[to];
        // Transfers inside or outside the custody set do not cross the governance eligibility boundary.
        if (fromEncumbered == toEncumbered) return;
        if (fromEncumbered) _setEncumberedSupply(encumberedSupply - amount);
        else _setEncumberedSupply(encumberedSupply + amount);
    }

    function _beforeTokenTransfer(address from, address, uint256 amount) internal view override {
        if (from == address(0) || rewardLocksDisabled) return;
        uint256 locked = lockedStakeBalance[from];
        if (locked == 0) return;
        uint256 balance = balanceOf(from);
        uint256 available = balance > locked ? balance - locked : 0;
        if (amount > available) revert InsufficientUnlockedBalance(from, amount, available);
    }

    function _setEncumberedSupply(uint256 value) internal {
        encumberedSupply = value;
        _writeCheckpoint(encumberedSupplyCheckpoints, value);
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

    function _requireBoardroomCaller() internal view {
        if (msg.sender != boardroom) revert OnlyBoardroom();
    }

    function _requireRewardLockerCaller() internal view {
        if (msg.sender != rewardLocker) revert OnlyRewardLocker();
    }

    function _requireTokenAccount(address account) internal pure {
        if (account == address(0)) revert InvalidAddress();
    }

    function _requireTokenAmount(uint256 amount) internal pure {
        if (amount == 0) revert InvalidAmount();
    }
}
