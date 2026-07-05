// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "solady/tokens/ERC20.sol";

interface IBoardroomTokenTransferPolicy {
    function canTransferShares(address operator, address from, address to, uint256 amount) external view returns (bool);
}

contract BoardroomToken is ERC20 {
    address public immutable boardroom;

    string internal tokenName;
    string internal tokenSymbol;

    error InvalidAddress();
    error InvalidAmount();
    error OnlyBoardroom();
    error ShareTransferLocked(address operator, address from, address to);

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
        if (msg.sender != boardroom) revert OnlyBoardroom();
        if (to == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();

        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        if (msg.sender != boardroom) revert OnlyBoardroom();
        if (from == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();

        _burn(from, amount);
    }

    function _beforeTokenTransfer(address from, address to, uint256 amount) internal view override {
        if (from == address(0) || to == address(0)) return;
        if (!IBoardroomTokenTransferPolicy(boardroom).canTransferShares(msg.sender, from, to, amount)) {
            revert ShareTransferLocked(msg.sender, from, to);
        }
    }
}
