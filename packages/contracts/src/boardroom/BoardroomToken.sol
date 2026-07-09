// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "solady/tokens/ERC20.sol";

contract BoardroomToken is ERC20 {
    address public immutable boardroom;

    string internal tokenName;
    string internal tokenSymbol;

    error InvalidAddress();
    error InvalidAmount();
    error OnlyBoardroom();

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
