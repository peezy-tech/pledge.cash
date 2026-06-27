// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "solady/auth/Ownable.sol";
import {Initializable} from "solady/utils/Initializable.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {BoardroomToken} from "./BoardroomToken.sol";
import {IBoardroomCallPolicy} from "./IBoardroomCallPolicy.sol";
import {IBoardroomPolicyRegistry} from "./IBoardroomPolicyRegistry.sol";

contract Boardroom is Ownable, Initializable, ReentrancyGuard {
    uint256 public constant MAX_BATCH_CALLS = 16;

    struct Call {
        address policy;
        address target;
        uint256 value;
        bytes data;
    }

    address public policyRegistry;
    address public shareToken;

    error InvalidAddress();
    error InvalidAmount();
    error EmptyBatch();
    error TooManyCalls(uint256 requested, uint256 maximum);
    error PolicyNotAllowed(address policy);
    error CallNotAllowed(address policy, address target, bytes4 selector);
    error CallFailed(address target);

    event BoardroomInitialized(
        address indexed owner, address indexed policyRegistry, address indexed shareToken, string name, string symbol
    );
    event SharesMinted(address indexed to, uint256 amount);
    event BoardroomCallExecuted(
        address indexed policy, address indexed target, bytes4 indexed selector, uint256 value, bytes32 dataHash
    );

    constructor() {
        _disableInitializers();
    }

    receive() external payable {}

    function initialize(address owner_, address policyRegistry_, string calldata name_, string calldata symbol_)
        external
        initializer
    {
        if (owner_ == address(0) || policyRegistry_ == address(0)) revert InvalidAddress();

        _initializeOwner(owner_);
        policyRegistry = policyRegistry_;
        shareToken = address(new BoardroomToken(address(this), name_, symbol_));

        emit BoardroomInitialized(owner_, policyRegistry_, shareToken, name_, symbol_);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();

        BoardroomToken(shareToken).mint(to, amount);
        emit SharesMinted(to, amount);
    }

    function execute(Call calldata call_) external payable onlyOwner nonReentrant returns (bytes memory result) {
        result = _execute(call_);
    }

    function executeBatch(Call[] calldata calls)
        external
        payable
        onlyOwner
        nonReentrant
        returns (bytes[] memory results)
    {
        uint256 length = calls.length;
        if (length == 0) revert EmptyBatch();
        if (length > MAX_BATCH_CALLS) revert TooManyCalls(length, MAX_BATCH_CALLS);

        results = new bytes[](length);
        for (uint256 i; i < length; ++i) {
            results[i] = _execute(calls[i]);
        }
    }

    function _execute(Call calldata call_) internal returns (bytes memory result) {
        address policy = call_.policy;
        address target = call_.target;
        if (policy == address(0) || target == address(0)) revert InvalidAddress();

        bytes4 selector = _selector(call_.data);
        if (!IBoardroomPolicyRegistry(policyRegistry).isPolicyAllowed(policy)) {
            revert PolicyNotAllowed(policy);
        }
        if (!IBoardroomCallPolicy(policy).canCall(address(this), msg.sender, target, call_.value, call_.data)) {
            revert CallNotAllowed(policy, target, selector);
        }

        bool success;
        (success, result) = target.call{value: call_.value}(call_.data);
        if (!success) _revertCall(target, result);

        emit BoardroomCallExecuted(policy, target, selector, call_.value, keccak256(call_.data));
    }

    function _selector(bytes calldata data) internal pure returns (bytes4 selector) {
        if (data.length < 4) return bytes4(0);
        return bytes4(data[:4]);
    }

    function _revertCall(address target, bytes memory returnData) internal pure {
        if (returnData.length == 0) revert CallFailed(target);

        assembly {
            revert(add(returnData, 0x20), mload(returnData))
        }
    }
}
