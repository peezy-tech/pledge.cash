// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Local CREATE2 salt namespace used only by the canonical Boardroom scenario.
library PledgeCashBoardroomScenarioSalts {
    bytes32 internal constant POLICY_REGISTRY = keccak256("pledge.cash.boardroom.scenario.policy-registry");
    bytes32 internal constant WRAPPED_NATIVE = keccak256("pledge.cash.boardroom.scenario.wrapped-native");
    bytes32 internal constant FACET_REGISTRY = keccak256("pledge.cash.boardroom.scenario.facet-registry");
    bytes32 internal constant KERNEL = keccak256("pledge.cash.boardroom.scenario.kernel");
    bytes32 internal constant GOVERNANCE_LOGIC = keccak256("pledge.cash.boardroom.scenario.governance-logic");
    bytes32 internal constant MARKET_LOGIC = keccak256("pledge.cash.boardroom.scenario.market-logic");
    bytes32 internal constant REDEMPTION_LOGIC = keccak256("pledge.cash.boardroom.scenario.redemption-logic");
    bytes32 internal constant FACTORY = keccak256("pledge.cash.boardroom.scenario.factory");
    bytes32 internal constant ASSET_POLICY = keccak256("pledge.cash.boardroom.scenario.asset-policy");
    bytes32 internal constant PROTOCOL_FEE_ROUTER = keccak256("pledge.cash.boardroom.scenario.protocol-fee-router");
    bytes32 internal constant TOKEN_GRANT_FACTORY = keccak256("pledge.cash.boardroom.scenario.token-grant-factory");
    bytes32 internal constant AMM_FACTORY = keccak256("pledge.cash.boardroom.scenario.amm-factory");
    bytes32 internal constant AMM_ROUTER = keccak256("pledge.cash.boardroom.scenario.amm-router");
    bytes32 internal constant LOCKED_LIQUIDITY_FACTORY =
        keccak256("pledge.cash.boardroom.scenario.locked-liquidity-factory");
    bytes32 internal constant DISTRIBUTION_FACTORY = keccak256("pledge.cash.boardroom.scenario.distribution-factory");
    bytes32 internal constant REWARDS_FACTORY = keccak256("pledge.cash.boardroom.scenario.rewards-factory");
    bytes32 internal constant BOND_MARKET_FACTORY = keccak256("pledge.cash.boardroom.scenario.bond-market-factory");
    bytes32 internal constant AUTHORITY_FACET = keccak256("pledge.cash.boardroom.scenario.authority-facet");
    bytes32 internal constant EXECUTION_FACET = keccak256("pledge.cash.boardroom.scenario.execution-facet");
    bytes32 internal constant MARKET_FACET = keccak256("pledge.cash.boardroom.scenario.market-facet");
    bytes32 internal constant REDEMPTION_FACET = keccak256("pledge.cash.boardroom.scenario.redemption-facet");
    bytes32 internal constant VIEW_FACET = keccak256("pledge.cash.boardroom.scenario.view-facet");
    bytes32 internal constant RELEASE_B_MIGRATION = keccak256("pledge.cash.boardroom.scenario.release-b-migration");
    bytes32 internal constant RELEASE_B_VIEW = keccak256("pledge.cash.boardroom.scenario.release-b-view");
}
