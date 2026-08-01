// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IBoardroomCallbackTarget {
    function facetSetHash() external view returns (bytes32);

    function reserveRedeemableAsset(bytes32 expectedFacetSetHash, address asset) external;

    function precommitBondingCurve(
        bytes32 expectedFacetSetHash,
        address curve,
        address quoteAsset,
        uint256 fundingAmount
    ) external;

    function recordGrantFromDistribution(bytes32 expectedFacetSetHash, address grant) external;

    function recordProtocolLiquidityFromDistribution(bytes32 expectedFacetSetHash, address vault, bytes32 poolId)
        external;

    function settleBondingCurve(bytes32 expectedFacetSetHash) external;

    function precommitProtocolLiquidity(
        bytes32 expectedFacetSetHash,
        address expectedVault,
        bytes32 expectedPoolId,
        address quoteAsset,
        address curve,
        bytes32 salt,
        uint64 expiresAt
    ) external;

    function activateProtocolLiquidity(
        bytes32 expectedFacetSetHash,
        address vault,
        bytes32 poolId,
        address quoteAsset,
        address curve,
        bytes32 salt
    ) external;

    function releaseProtocolLiquidityReservation(
        bytes32 expectedFacetSetHash,
        address curve,
        bytes32 expectedPoolId,
        bytes32 salt
    ) external;

    function closeProtocolLiquidityFromFactory(bytes32 expectedFacetSetHash, address vault) external;
}

/// @notice Hash-bound callbacks shared by canonical module factories and children.
/// @dev Every helper takes the expected release hash as an explicit argument instead of
/// reading it from the Boardroom it is about to call: a hash read in the same frame always
/// equals the value the kernel compares it against, so it can never reject the mid-flight
/// facet swap the mechanism exists to reject. Callers must pass a hash that was fixed
/// before the current frame, which is one of exactly two things:
/// - the `expectedFacetSetHash` supplied by the module's own caller, for module entrypoints
///   reachable without going through the Boardroom (curve settlement/migration, airdrop
///   claims, and the factory callbacks they trigger); or
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

    function precommitBondingCurve(
        address boardroom,
        bytes32 expectedFacetSetHash,
        address curve,
        address quoteAsset,
        uint256 fundingAmount
    ) internal {
        IBoardroomCallbackTarget(boardroom)
            .precommitBondingCurve(expectedFacetSetHash, curve, quoteAsset, fundingAmount);
    }

    function recordGrantFromDistribution(address boardroom, bytes32 expectedFacetSetHash, address grant) internal {
        IBoardroomCallbackTarget(boardroom).recordGrantFromDistribution(expectedFacetSetHash, grant);
    }

    function recordProtocolLiquidityFromDistribution(
        address boardroom,
        bytes32 expectedFacetSetHash,
        address vault,
        bytes32 poolId
    ) internal {
        IBoardroomCallbackTarget(boardroom).recordProtocolLiquidityFromDistribution(expectedFacetSetHash, vault, poolId);
    }

    function settleBondingCurve(address boardroom, bytes32 expectedFacetSetHash) internal {
        IBoardroomCallbackTarget(boardroom).settleBondingCurve(expectedFacetSetHash);
    }

    function precommitProtocolLiquidity(
        address boardroom,
        bytes32 expectedFacetSetHash,
        address expectedVault,
        bytes32 expectedPoolId,
        address quoteAsset,
        address curve,
        bytes32 salt,
        uint64 expiresAt
    ) internal {
        IBoardroomCallbackTarget(boardroom)
            .precommitProtocolLiquidity(
                expectedFacetSetHash, expectedVault, expectedPoolId, quoteAsset, curve, salt, expiresAt
            );
    }

    function activateProtocolLiquidity(
        address boardroom,
        bytes32 expectedFacetSetHash,
        address vault,
        bytes32 poolId,
        address quoteAsset,
        address curve,
        bytes32 salt
    ) internal {
        IBoardroomCallbackTarget(boardroom)
            .activateProtocolLiquidity(expectedFacetSetHash, vault, poolId, quoteAsset, curve, salt);
    }

    function releaseProtocolLiquidityReservation(
        address boardroom,
        bytes32 expectedFacetSetHash,
        address curve,
        bytes32 expectedPoolId,
        bytes32 salt
    ) internal {
        IBoardroomCallbackTarget(boardroom)
            .releaseProtocolLiquidityReservation(expectedFacetSetHash, curve, expectedPoolId, salt);
    }

    function closeProtocolLiquidityFromFactory(address boardroom, bytes32 expectedFacetSetHash, address vault)
        internal
    {
        IBoardroomCallbackTarget(boardroom).closeProtocolLiquidityFromFactory(expectedFacetSetHash, vault);
    }
}
