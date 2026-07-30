// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Rollback frame for kernel view dispatch, deliberately kept off the Boardroom's ABI.
/// @dev The kernel delegatecalls this contract so the facet call happens in a catchable frame
/// without the Boardroom exposing an external entrypoint that delegatecalls caller-supplied
/// code in clone storage. Calling this contract directly executes against its own empty
/// storage and always reverts, so no Boardroom state is reachable that way.
contract BoardroomViewDispatcher {
    /// @dev Delegatecalls a view facet and always reverts with an encoded
    /// `(success, returndata)` envelope. The kernel catches this frame so every storage write
    /// and external side effect is rolled back while the original caller and Boardroom context
    /// are preserved.
    function dispatchViewAndRollback(address facet, bytes calldata input) external {
        (bool success, bytes memory output) = facet.delegatecall(input);
        bytes memory envelope = abi.encode(success, output);
        assembly ("memory-safe") {
            revert(add(envelope, 0x20), mload(envelope))
        }
    }
}
