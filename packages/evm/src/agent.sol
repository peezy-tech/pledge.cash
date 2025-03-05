// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import {ERC6551} from "solady/accounts/ERC6551.sol";
import {Initializable} from "solady/utils/Initializable.sol";

import "forge-std/Test.sol";
interface IAgentStory {
    function validateExternalCall(
        address agent,
        address target,
        uint256 value,
        bytes memory data,
        bytes memory sig
    ) external view returns (bool);

    function validateExternalCalls(
        bytes calldata signature,
        ERC6551.Call[] calldata calls
    ) external view returns (bool);
}

contract Agent is ERC6551, Initializable, Test {
    error AccountLocked();
    error UnauthorizedOperation();

    address public story;

    function lock() external initializer {}

    function initialize(address story_) external initializer {
        story = story_;
        (uint256 chainId, address tokenContract, uint256 tokenId) = token();
        // story.registerTBA(tokenContract, tokenId);
    }

    function owner() public view override returns (address result) {
        address _owner = super.owner();
        if (_owner == address(0)) {
            console.log("no owner!");
            return story;
        }
        return _owner;
    }

    bool isAccountLocked = true;

    modifier onlyUnlocked() {
        // should i put reentrancy prevention here?
        if (story != address(0) && !isAccountLocked) revert AccountLocked();
        _;
    }

    function setStory(bool isEntering) public returns (bool) {
        if (isEntering && story != address(0)) {
            console.log('revert cause');
            console.log(isEntering);
            console.log("story is zero?", story != address(0), story);
            revert();
            }
        // if(!isEntering && story != msg.sender) revert();

        console.log('foo');
        story = isEntering ? msg.sender : address(0);
        console.log('story set?', story, msg.sender);
        // emit storyEnter

        return true;
    }

    // TODO: should add reentrancy prevention here and in executeBatch?
    function execute(
        address target,
        uint256 value,
        bytes calldata data,
        uint8 operation
    ) public payable override onlyUnlocked returns (bytes memory result) {
        return super.execute(target, value, data, operation);
    }

    function executeBatch(
        Call[] calldata calls,
        uint8 operation
    ) public payable override onlyUnlocked returns (bytes[] memory results) {
        return super.executeBatch(calls, operation);
    }

    function allowedExecute(
        bytes calldata signature,
        address target,
        uint256 value,
        bytes calldata data,
        uint8 operation
    ) public payable {
        if (
            !IAgentStory(story).validateExternalCall(
                address(this),
                target,
                value,
                data,
                signature
            )
        ) {
            revert UnauthorizedOperation();
        }

        isAccountLocked = false;
        execute(target, value, data, operation);
        isAccountLocked = true;
    }

    function allowedExecuteBatch(
        bytes calldata signature,
        Call[] calldata calls,
        uint8 operation
    ) public payable {
        if (!IAgentStory(story).validateExternalCalls(signature, calls)) {
            revert UnauthorizedOperation();
        }

        isAccountLocked = false;
        executeBatch(calls, operation);
        isAccountLocked = true;
    }

    function _domainNameAndVersion()
        internal
        pure
        override
        returns (string memory, string memory)
    {
        return ("drama.haus", "1");
    }

    function hashTypedData(bytes32 structHash) external view returns (bytes32) {
        return _hashTypedData(structHash);
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparator();
    }

    function mockId() public pure virtual returns (string memory) {
        return "1";
    }
}
