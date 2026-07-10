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

    error InvalidAddress();
    error InvalidAmount();
    error OnlyBoardroom();
    error FutureCheckpointLookup(uint256 requestedBlock, uint256 currentBlock);
    error CheckpointValueOverflow(uint256 value);

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

    function getPastBalance(address account, uint256 blockNumber) external view returns (uint256) {
        return _checkpointLookup(balanceCheckpoints[account], blockNumber);
    }

    function getPastTotalSupply(uint256 blockNumber) external view returns (uint256) {
        return _checkpointLookup(totalSupplyCheckpoints, blockNumber);
    }

    function balanceCheckpointCount(address account) external view returns (uint256) {
        return balanceCheckpoints[account].length;
    }

    function totalSupplyCheckpointCount() external view returns (uint256) {
        return totalSupplyCheckpoints.length;
    }

    function _afterTokenTransfer(address from, address to, uint256) internal override {
        if (from != address(0)) _writeCheckpoint(balanceCheckpoints[from], balanceOf(from));
        if (to != address(0) && to != from) _writeCheckpoint(balanceCheckpoints[to], balanceOf(to));
        if (from == address(0) || to == address(0)) _writeCheckpoint(totalSupplyCheckpoints, totalSupply());
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

    function _requireTokenAccount(address account) internal pure {
        if (account == address(0)) revert InvalidAddress();
    }

    function _requireTokenAmount(uint256 amount) internal pure {
        if (amount == 0) revert InvalidAmount();
    }
}
