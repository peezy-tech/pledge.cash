// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import {ERC20} from "solady/tokens/ERC20.sol";

contract Drama is ERC20 {
    string internal _name;
    string internal _symbol;

    constructor(string memory name_, string memory symbol_, uint256 initialSupply) {
        _name = name_;
        _symbol = symbol_;

        _mint(msg.sender, initialSupply);
    }

    function name() public view virtual override returns (string memory) {
        return _name;
    }

    function symbol() public view virtual override returns (string memory) {
        return _symbol;
    }
}