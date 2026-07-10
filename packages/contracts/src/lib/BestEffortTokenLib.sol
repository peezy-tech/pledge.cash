// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Bounded token calls for failure-tolerant cleanup paths and asset probes.
/// @dev These helpers intentionally do not interpret transfer return data. Callers must verify balance deltas.
library BestEffortTokenLib {
    uint256 internal constant MAX_BALANCE_PROBE_GAS = 30_000;
    uint256 internal constant MAX_TRANSFER_CALL_GAS = 100_000;

    function tryBalanceOf(address token, address account) internal view returns (bool readable, uint256 amount) {
        if (token.code.length == 0) return (false, 0);

        uint256 stipend = gasleft() / 2;
        if (stipend > MAX_BALANCE_PROBE_GAS) stipend = MAX_BALANCE_PROBE_GAS;

        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, shl(224, 0x70a08231))
            mstore(add(ptr, 4), account)
            readable := staticcall(stipend, token, ptr, 36, ptr, 32)
            readable := and(readable, eq(returndatasize(), 32))
            if readable { amount := mload(ptr) }
        }
    }

    function tryTransfer(address token, address recipient, uint256 amount) internal returns (bool callSucceeded) {
        if (token.code.length == 0) return false;

        uint256 stipend = gasleft() / 2;
        if (stipend > MAX_TRANSFER_CALL_GAS) stipend = MAX_TRANSFER_CALL_GAS;

        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, shl(224, 0xa9059cbb))
            mstore(add(ptr, 4), recipient)
            mstore(add(ptr, 36), amount)
            callSucceeded := call(stipend, token, 0, ptr, 68, 0, 0)
        }
    }
}
