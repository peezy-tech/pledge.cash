// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {LegacyBoardroomFacet} from "./LegacyBoardroomFacet.sol";

/// @notice Read-only release-A compatibility facet.
/// @dev Only selectors published as `View` can reach this fallback.
contract BoardroomViewFacet is LegacyBoardroomFacet {
    constructor(address legacyBoardroomLogic_) LegacyBoardroomFacet(legacyBoardroomLogic_) {}

    fallback() external {
        address target = legacyBoardroomLogic;
        assembly ("memory-safe") {
            calldatacopy(0, 0, calldatasize())
            let success := delegatecall(gas(), target, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            if iszero(success) { revert(0, returndatasize()) }
            return(0, returndatasize())
        }
    }
}
