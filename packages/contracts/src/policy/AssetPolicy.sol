// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "solady/auth/Ownable.sol";
import {IBoardroomCallPolicy} from "./IBoardroomCallPolicy.sol";

contract AssetPolicy is Ownable, IBoardroomCallPolicy {
    bytes4 internal constant APPROVE_SELECTOR = 0x095ea7b3;
    bytes4 internal constant DEPOSIT_SELECTOR = 0xd0e30db0;
    uint256 internal constant SELECTOR_LENGTH = 4;
    uint256 internal constant APPROVE_CALL_LENGTH = SELECTOR_LENGTH + 32 * 2;

    address public immutable wrappedNative;

    mapping(address => bool) public isAssetAllowed;
    mapping(address => bool) public isApprovalSpenderAllowed;

    error InvalidAddress();

    event AssetAllowedSet(address indexed asset, bool allowed);
    event ApprovalSpenderAllowedSet(address indexed spender, bool allowed);

    constructor(address owner_, address wrappedNative_) {
        if (owner_ == address(0) || wrappedNative_ == address(0)) revert InvalidAddress();

        _initializeOwner(owner_);
        wrappedNative = wrappedNative_;
        isAssetAllowed[wrappedNative_] = true;
        emit AssetAllowedSet(wrappedNative_, true);
    }

    function setAssetAllowed(address asset, bool allowed) external onlyOwner {
        if (asset == address(0)) revert InvalidAddress();

        isAssetAllowed[asset] = allowed;
        emit AssetAllowedSet(asset, allowed);
    }

    function setApprovalSpenderAllowed(address spender, bool allowed) external onlyOwner {
        if (spender == address(0)) revert InvalidAddress();

        isApprovalSpenderAllowed[spender] = allowed;
        emit ApprovalSpenderAllowedSet(spender, allowed);
    }

    function canCall(address, address, address target, uint256 value, bytes calldata data)
        external
        view
        returns (bool)
    {
        bytes4 selector = _selector(data);
        if (_isWrappedNativeDeposit(target, selector)) {
            return data.length == SELECTOR_LENGTH && isAssetAllowed[target];
        }

        if (!_isAllowedApprovalCall(target, value, selector, data.length)) {
            return false;
        }

        return isApprovalSpenderAllowed[_approvalSpender(data)];
    }

    function _isWrappedNativeDeposit(address target, bytes4 selector) internal view returns (bool) {
        return target == wrappedNative && selector == DEPOSIT_SELECTOR;
    }

    function _isAllowedApprovalCall(address target, uint256 value, bytes4 selector, uint256 dataLength)
        internal
        view
        returns (bool)
    {
        if (value != 0) return false;
        if (selector != APPROVE_SELECTOR) return false;
        if (dataLength != APPROVE_CALL_LENGTH) return false;
        return isAssetAllowed[target];
    }

    function _approvalSpender(bytes calldata data) internal pure returns (address spender) {
        (spender,) = abi.decode(data[SELECTOR_LENGTH:], (address, uint256));
    }

    function _selector(bytes calldata data) internal pure returns (bytes4 selector) {
        if (data.length < SELECTOR_LENGTH) return bytes4(0);
        return bytes4(data[:SELECTOR_LENGTH]);
    }
}
