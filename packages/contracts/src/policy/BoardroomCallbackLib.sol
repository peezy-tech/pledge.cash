// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IBoardroomCallbackTarget {
    function facetSetHash() external view returns (bytes32);

    function reserveRedeemableAsset(bytes32 expectedFacetSetHash, address asset) external;

    function activateProtocolLiquidity(bytes32 expectedFacetSetHash, address vault, bytes32 poolId, address quoteAsset)
        external;

    function closeProtocolLiquidityFromFactory(bytes32 expectedFacetSetHash, address vault) external;
}

/// @notice Hash-bound callbacks shared by canonical module factories and children.
/// @dev Every helper takes the expected release hash as an explicit argument instead of
/// reading it from the Boardroom it is about to call: a hash read in the same frame always
/// equals the value the kernel compares it against, so it can never reject the mid-flight
/// facet swap the mechanism exists to reject. Callers must pass a hash that was fixed
/// before the current frame, which is one of exactly two things:
/// - the `expectedFacetSetHash` supplied by the module's own caller, for module entrypoints
///   reachable without going through the Boardroom; or
/// - `boundFacetSetHash(boardroom)`, for frames the Boardroom itself initiated. Those already
///   carry the caller's hash on the outer mutating route, and the kernel reverts with
///   `ActiveReleaseChanged` if the active release moves before that route returns.
/// These are internal calls, so the external callback still observes the invoking factory or
/// child as `msg.sender`.
library BoardroomCallbackLib {
    /// @notice Reads the release hash already bound by the Boardroom-initiated frame in progress.
    /// @dev Only sound when the call stack was entered from `boardroom` itself. Modules reachable
    /// directly by an arbitrary caller must thread that caller's expected hash instead.
    function boundFacetSetHash(address boardroom) internal view returns (bytes32) {
        return IBoardroomCallbackTarget(boardroom).facetSetHash();
    }

    function reserveRedeemableAsset(address boardroom, bytes32 expectedFacetSetHash, address asset) internal {
        IBoardroomCallbackTarget(boardroom).reserveRedeemableAsset(expectedFacetSetHash, asset);
    }

    function activateProtocolLiquidity(
        address boardroom,
        bytes32 expectedFacetSetHash,
        address vault,
        bytes32 poolId,
        address quoteAsset
    ) internal {
        IBoardroomCallbackTarget(boardroom).activateProtocolLiquidity(expectedFacetSetHash, vault, poolId, quoteAsset);
    }

    function closeProtocolLiquidityFromFactory(address boardroom, bytes32 expectedFacetSetHash, address vault)
        internal
    {
        IBoardroomCallbackTarget(boardroom).closeProtocolLiquidityFromFactory(expectedFacetSetHash, vault);
    }
}
