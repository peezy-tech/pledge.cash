// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Isolated CREATE2 salt namespace for the non-production Boardroom
/// diamondization spike. Existing v5 release salts are intentionally unchanged.
library PledgeCashBoardroomDiamondSalts {
    bytes32 internal constant POLICY_REGISTRY = keccak256("pledge.cash.boardroom-diamond.vnext.policy-registry");
    bytes32 internal constant WRAPPED_NATIVE = keccak256("pledge.cash.boardroom-diamond.vnext.wrapped-native");
    bytes32 internal constant FACET_REGISTRY = keccak256("pledge.cash.boardroom-diamond.vnext.facet-registry");
    bytes32 internal constant KERNEL = keccak256("pledge.cash.boardroom-diamond.vnext.kernel");
    bytes32 internal constant GOVERNANCE_LOGIC = keccak256("pledge.cash.boardroom-diamond.vnext.governance-logic");
    bytes32 internal constant MARKET_LOGIC = keccak256("pledge.cash.boardroom-diamond.vnext.market-logic");
    bytes32 internal constant REDEMPTION_LOGIC = keccak256("pledge.cash.boardroom-diamond.vnext.redemption-logic");
    bytes32 internal constant FACTORY = keccak256("pledge.cash.boardroom-diamond.vnext.factory");
    bytes32 internal constant ASSET_POLICY = keccak256("pledge.cash.boardroom-diamond.vnext.asset-policy");
    bytes32 internal constant PROTOCOL_FEE_ROUTER =
        keccak256("pledge.cash.boardroom-diamond.vnext.protocol-fee-router");
    bytes32 internal constant TOKEN_GRANT_FACTORY =
        keccak256("pledge.cash.boardroom-diamond.vnext.token-grant-factory");
    bytes32 internal constant AMM_FACTORY = keccak256("pledge.cash.boardroom-diamond.vnext.amm-factory");
    bytes32 internal constant AMM_ROUTER = keccak256("pledge.cash.boardroom-diamond.vnext.amm-router");
    bytes32 internal constant LOCKED_LIQUIDITY_FACTORY =
        keccak256("pledge.cash.boardroom-diamond.vnext.locked-liquidity-factory");
    bytes32 internal constant DISTRIBUTION_FACTORY =
        keccak256("pledge.cash.boardroom-diamond.vnext.distribution-factory");
    bytes32 internal constant REWARDS_FACTORY = keccak256("pledge.cash.boardroom-diamond.vnext.rewards-factory");
    bytes32 internal constant BOND_MARKET_FACTORY =
        keccak256("pledge.cash.boardroom-diamond.vnext.bond-market-factory");
    bytes32 internal constant AUTHORITY_FACET = keccak256("pledge.cash.boardroom-diamond.vnext.authority-facet");
    bytes32 internal constant EXECUTION_FACET = keccak256("pledge.cash.boardroom-diamond.vnext.execution-facet");
    bytes32 internal constant MARKET_FACET = keccak256("pledge.cash.boardroom-diamond.vnext.market-facet");
    bytes32 internal constant REDEMPTION_FACET = keccak256("pledge.cash.boardroom-diamond.vnext.redemption-facet");
    bytes32 internal constant VIEW_FACET = keccak256("pledge.cash.boardroom-diamond.vnext.view-facet");
    bytes32 internal constant RELEASE_B_MIGRATION =
        keccak256("pledge.cash.boardroom-diamond.vnext.release-b-migration");
    bytes32 internal constant RELEASE_B_VIEW = keccak256("pledge.cash.boardroom-diamond.vnext.release-b-view");
}
