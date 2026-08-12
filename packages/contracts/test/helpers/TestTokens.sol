// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "solady/tokens/ERC20.sol";

/// @dev Configurable token with the production-like Solady transfer semantics used by protocol tests.
contract SoladyTestERC20 is ERC20 {
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

contract DepositOnlyTestWrappedNative is SoladyTestERC20 {
    constructor() SoladyTestERC20("Wrapped Ether", "WETH") {}

    function deposit() public payable {
        _mint(msg.sender, msg.value);
    }
}

contract TestWrappedNative is DepositOnlyTestWrappedNative {
    receive() external payable {
        deposit();
    }
}

/// @dev Bare configurable token preserving the deliberately minimal grant-test transfer semantics.
contract TestERC20 {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;

    mapping(address account => uint256 balance) internal balances;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) {
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
    }

    function mint(address to, uint256 amount) external {
        balances[to] += amount;
        totalSupply += amount;
    }

    function balanceOf(address account) public view virtual returns (uint256) {
        return balances[account];
    }

    function approve(address spender, uint256 amount) public virtual returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) public virtual returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public virtual returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) internal virtual {
        balances[from] -= amount;
        balances[to] += amount;
    }
}

contract OnePercentFeeTestERC20 is TestERC20 {
    constructor() TestERC20("Fee Token", "FEE", 18) {}

    function transfer(address to, uint256 amount) public override returns (bool) {
        _moveWithFee(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        _moveWithFee(from, to, amount);
        return true;
    }

    function _moveWithFee(address from, address to, uint256 amount) internal {
        uint256 fee = amount / 100;
        balances[from] -= amount;
        balances[to] += amount - fee;
        totalSupply -= fee;
    }
}

contract FeeOnTransferTestERC20 is TestERC20 {
    uint256 internal immutable feeBps;
    bool internal immutable feeOnTransfer;
    bool internal immutable feeOnTransferFrom;

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        uint256 feeBps_,
        bool feeOnTransfer_,
        bool feeOnTransferFrom_
    ) TestERC20(name_, symbol_, decimals_) {
        feeBps = feeBps_;
        feeOnTransfer = feeOnTransfer_;
        feeOnTransferFrom = feeOnTransferFrom_;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        _moveWithFee(msg.sender, to, amount, feeOnTransfer);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        _moveWithFee(from, to, amount, feeOnTransferFrom);
        return true;
    }

    function _moveWithFee(address from, address to, uint256 amount, bool applyFee) internal {
        uint256 fee = applyFee ? (amount * feeBps) / 10_000 : 0;
        balances[from] -= amount;
        balances[to] += amount - fee;
        totalSupply -= fee;
    }
}

contract MutableFailureTestERC20 is TestERC20 {
    bool public transfersFail;

    constructor() TestERC20("Mutable Grant", "MGRANT", 18) {}

    function setTransfersFail(bool fail_) external {
        transfersFail = fail_;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (transfersFail) return false;
        return super.transfer(to, amount);
    }
}
