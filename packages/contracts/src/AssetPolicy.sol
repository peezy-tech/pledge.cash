// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "solady/auth/Ownable.sol";
import {IBoardroomCallPolicy} from "./IBoardroomCallPolicy.sol";

contract AssetPolicy is Ownable, IBoardroomCallPolicy {
    bytes4 internal constant APPROVE_SELECTOR = 0x095ea7b3;
    bytes4 internal constant DEPOSIT_SELECTOR = 0xd0e30db0;

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
        if (target == wrappedNative) {
            if (selector == DEPOSIT_SELECTOR) return data.length == 4 && isAssetAllowed[target];
        }

        if (value != 0 || selector != APPROVE_SELECTOR || data.length != 68 || !isAssetAllowed[target]) {
            return false;
        }

        (address spender,) = abi.decode(data[4:], (address, uint256));
        return isApprovalSpenderAllowed[spender];
    }

    function _selector(bytes calldata data) internal pure returns (bytes4 selector) {
        if (data.length < 4) return bytes4(0);
        return bytes4(data[:4]);
    }
}
