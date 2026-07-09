// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

library PledgeCashDeploymentSalts {
    string internal constant VERSION = "pledge.cash.deterministic.v2";

    bytes32 internal constant DETERMINISTIC_DEPLOYER =
        keccak256("pledge.cash.deterministic.v1.PledgeCashDeterministicDeployer");
    bytes32 internal constant BOARDROOM_POLICY_REGISTRY =
        keccak256("pledge.cash.deterministic.v2.BoardroomPolicyRegistry");
    bytes32 internal constant ASSET_POLICY = keccak256("pledge.cash.deterministic.v1.AssetPolicy");
    bytes32 internal constant TOKEN_GRANT_FACTORY = keccak256("pledge.cash.deterministic.v2.TokenGrantFactory");
    bytes32 internal constant AMM_FACTORY = keccak256("pledge.cash.deterministic.v1.AmmFactory");
    bytes32 internal constant AMM_ROUTER = keccak256("pledge.cash.deterministic.v1.AmmRouter");
    bytes32 internal constant LOCKED_LIQUIDITY_FACTORY =
        keccak256("pledge.cash.deterministic.v2.LockedLiquidityFactory");
    bytes32 internal constant DISTRIBUTION_FACTORY = keccak256("pledge.cash.deterministic.v2.DistributionFactory");
    bytes32 internal constant BOARDROOM_FACTORY = keccak256("pledge.cash.deterministic.v2.BoardroomFactory");

    function version() internal pure returns (string memory) {
        return VERSION;
    }

    function deterministicDeployer() internal pure returns (bytes32) {
        return DETERMINISTIC_DEPLOYER;
    }

    function boardroomPolicyRegistry() internal pure returns (bytes32) {
        return BOARDROOM_POLICY_REGISTRY;
    }

    function assetPolicy() internal pure returns (bytes32) {
        return ASSET_POLICY;
    }

    function tokenGrantFactory() internal pure returns (bytes32) {
        return TOKEN_GRANT_FACTORY;
    }

    function ammFactory() internal pure returns (bytes32) {
        return AMM_FACTORY;
    }

    function ammRouter() internal pure returns (bytes32) {
        return AMM_ROUTER;
    }

    function lockedLiquidityFactory() internal pure returns (bytes32) {
        return LOCKED_LIQUIDITY_FACTORY;
    }

    function distributionFactory() internal pure returns (bytes32) {
        return DISTRIBUTION_FACTORY;
    }

    function boardroomFactory() internal pure returns (bytes32) {
        return BOARDROOM_FACTORY;
    }
}
