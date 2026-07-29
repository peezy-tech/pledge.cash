// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Shared adapter used by the vNext spike facets.
/// @dev Release A deliberately delegates into the already-proven v5 Boardroom
/// implementation while exposing a release-bound selector surface. This keeps
/// one custody/storage context and lets later releases replace selectors with
/// native facet implementations incrementally.
abstract contract LegacyBoardroomFacet {
    address public immutable legacyBoardroomLogic;

    error InvalidLegacyBoardroomLogic(address logic);

    constructor(address legacyBoardroomLogic_) {
        if (legacyBoardroomLogic_ == address(0) || legacyBoardroomLogic_.code.length == 0) {
            revert InvalidLegacyBoardroomLogic(legacyBoardroomLogic_);
        }
        legacyBoardroomLogic = legacyBoardroomLogic_;
    }

    /// @dev Rebuilds calldata with `legacySelector`, dropping the expected
    /// facet-set hash at calldata bytes [4:36].
    function _delegateLegacy(bytes4 legacySelector) internal returns (bytes memory result) {
        address target = legacyBoardroomLogic;
        assembly ("memory-safe") {
            let inputSize := sub(calldatasize(), 32)
            let input := mload(0x40)
            mstore(input, legacySelector)
            calldatacopy(add(input, 4), 36, sub(calldatasize(), 36))

            let success := delegatecall(gas(), target, input, inputSize, 0, 0)
            let outputSize := returndatasize()
            result := mload(0x40)
            mstore(result, outputSize)
            returndatacopy(add(result, 32), 0, outputSize)
            mstore(0x40, and(add(add(result, 63), outputSize), not(31)))
            if iszero(success) { revert(add(result, 32), outputSize) }
        }
    }

    function _delegateLegacyData(bytes memory data) internal returns (bytes memory result) {
        address target = legacyBoardroomLogic;
        assembly ("memory-safe") {
            let success := delegatecall(gas(), target, add(data, 32), mload(data), 0, 0)
            let outputSize := returndatasize()
            result := mload(0x40)
            mstore(result, outputSize)
            returndatacopy(add(result, 32), 0, outputSize)
            mstore(0x40, and(add(add(result, 63), outputSize), not(31)))
            if iszero(success) { revert(add(result, 32), outputSize) }
        }
    }
}
