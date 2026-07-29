// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IBoardroomVNextCallbackTarget {
    function facetSetHash() external view returns (bytes32);

    function reserveRedeemableAsset(bytes32 expectedFacetSetHash, address asset) external;

    function precommitBondingCurve(
        bytes32 expectedFacetSetHash,
        address curve,
        address quoteAsset,
        uint256 fundingAmount
    ) external;

    function recordGrantFromDistribution(bytes32 expectedFacetSetHash, address grant) external;

    function recordLockedLiquidityFromDistribution(bytes32 expectedFacetSetHash, address locker, address pool) external;

    function settleBondingCurve(bytes32 expectedFacetSetHash) external;

    function precommitProtocolLiquidity(
        bytes32 expectedFacetSetHash,
        address expectedLocker,
        address quoteAsset,
        address curve,
        bytes32 pairKey,
        bytes32 salt,
        uint64 expiresAt
    ) external;

    function activateProtocolLiquidity(
        bytes32 expectedFacetSetHash,
        address locker,
        address pool,
        address quoteAsset,
        address curve,
        bytes32 pairKey,
        bytes32 salt
    ) external;

    function releaseProtocolLiquidityReservation(
        bytes32 expectedFacetSetHash,
        address curve,
        bytes32 pairKey,
        bytes32 salt
    ) external;

    function closeProtocolLiquidityFromFactory(bytes32 expectedFacetSetHash, address locker) external;
}

/// @notice Hash-bound callbacks shared by vNext module factories and children.
/// @dev Every helper reads the Boardroom's current release hash and immediately
/// calls the corresponding hash-prefixed callback. These are internal calls, so
/// the external callback still observes the invoking factory or child as
/// `msg.sender`.
library BoardroomVNextCallbackLib {
    function reserveRedeemableAsset(address boardroom, address asset) internal {
        IBoardroomVNextCallbackTarget target = IBoardroomVNextCallbackTarget(boardroom);
        target.reserveRedeemableAsset(target.facetSetHash(), asset);
    }

    function precommitBondingCurve(address boardroom, address curve, address quoteAsset, uint256 fundingAmount)
        internal
    {
        IBoardroomVNextCallbackTarget target = IBoardroomVNextCallbackTarget(boardroom);
        target.precommitBondingCurve(target.facetSetHash(), curve, quoteAsset, fundingAmount);
    }

    function recordGrantFromDistribution(address boardroom, address grant) internal {
        IBoardroomVNextCallbackTarget target = IBoardroomVNextCallbackTarget(boardroom);
        target.recordGrantFromDistribution(target.facetSetHash(), grant);
    }

    function recordLockedLiquidityFromDistribution(address boardroom, address locker, address pool) internal {
        IBoardroomVNextCallbackTarget target = IBoardroomVNextCallbackTarget(boardroom);
        target.recordLockedLiquidityFromDistribution(target.facetSetHash(), locker, pool);
    }

    function settleBondingCurve(address boardroom) internal {
        IBoardroomVNextCallbackTarget target = IBoardroomVNextCallbackTarget(boardroom);
        target.settleBondingCurve(target.facetSetHash());
    }

    function precommitProtocolLiquidity(
        address boardroom,
        address expectedLocker,
        address quoteAsset,
        address curve,
        bytes32 pairKey,
        bytes32 salt,
        uint64 expiresAt
    ) internal {
        IBoardroomVNextCallbackTarget target = IBoardroomVNextCallbackTarget(boardroom);
        target.precommitProtocolLiquidity(
            target.facetSetHash(), expectedLocker, quoteAsset, curve, pairKey, salt, expiresAt
        );
    }

    function activateProtocolLiquidity(
        address boardroom,
        address locker,
        address pool,
        address quoteAsset,
        address curve,
        bytes32 pairKey,
        bytes32 salt
    ) internal {
        IBoardroomVNextCallbackTarget target = IBoardroomVNextCallbackTarget(boardroom);
        target.activateProtocolLiquidity(target.facetSetHash(), locker, pool, quoteAsset, curve, pairKey, salt);
    }

    function releaseProtocolLiquidityReservation(address boardroom, address curve, bytes32 pairKey, bytes32 salt)
        internal
    {
        IBoardroomVNextCallbackTarget target = IBoardroomVNextCallbackTarget(boardroom);
        target.releaseProtocolLiquidityReservation(target.facetSetHash(), curve, pairKey, salt);
    }

    function closeProtocolLiquidityFromFactory(address boardroom, address locker) internal {
        IBoardroomVNextCallbackTarget target = IBoardroomVNextCallbackTarget(boardroom);
        target.closeProtocolLiquidityFromFactory(target.facetSetHash(), locker);
    }
}
