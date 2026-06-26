// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "solady/auth/Ownable.sol";
import {Initializable} from "solady/utils/Initializable.sol";
import {BoardroomToken} from "./BoardroomToken.sol";
import {TokenGrantFactory} from "./TokenGrantFactory.sol";

contract Boardroom is Ownable, Initializable {
    address public tokenGrantFactory;
    address public shareToken;

    error InvalidAddress();
    error InvalidAmount();

    event BoardroomInitialized(
        address indexed owner, address indexed tokenGrantFactory, address indexed shareToken, string name, string symbol
    );
    event SharesMinted(address indexed to, uint256 amount);
    event BoardroomGrantCreated(
        address indexed grant, address indexed holder, address indexed paymentToken, uint256 amount, uint256 price
    );

    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, address tokenGrantFactory_, string calldata name_, string calldata symbol_)
        external
        initializer
    {
        if (owner_ == address(0) || tokenGrantFactory_ == address(0)) revert InvalidAddress();

        _initializeOwner(owner_);
        tokenGrantFactory = tokenGrantFactory_;
        shareToken = address(new BoardroomToken(address(this), name_, symbol_));

        emit BoardroomInitialized(owner_, tokenGrantFactory_, shareToken, name_, symbol_);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();

        BoardroomToken(shareToken).mint(to, amount);
        emit SharesMinted(to, amount);
    }

    function createGrant(
        address holder,
        address paymentToken,
        uint256 amount,
        uint256 price,
        uint256 expiry,
        uint256 vestingCliff,
        uint256 vestingEnd,
        bool transferable,
        uint256 transferUnlockTime,
        bytes32 salt
    ) external payable onlyOwner returns (address grant) {
        if (holder == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();

        address grantAddress = TokenGrantFactory(tokenGrantFactory).predictGrantAddress(salt);
        BoardroomToken(shareToken).approve(grantAddress, amount);

        grant = TokenGrantFactory(tokenGrantFactory).createGrant{value: msg.value}(
            holder,
            shareToken,
            paymentToken,
            amount,
            price,
            expiry,
            vestingCliff,
            vestingEnd,
            transferable,
            transferUnlockTime,
            salt
        );
        emit BoardroomGrantCreated(grant, holder, paymentToken, amount, price);
    }
}
