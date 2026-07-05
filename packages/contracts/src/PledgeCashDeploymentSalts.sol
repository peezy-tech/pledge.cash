// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

library PledgeCashDeploymentSalts {
    function version() internal pure returns (string memory) {
        return "pledge.cash.deterministic.v1-boardroom-factory-v2";
    }

    function deterministicDeployer() internal pure returns (bytes32) {
        return keccak256("pledge.cash.deterministic.v1.PledgeCashDeterministicDeployer");
    }

    function boardroomPolicyRegistry() internal pure returns (bytes32) {
        return keccak256("pledge.cash.deterministic.v1.BoardroomPolicyRegistry");
    }

    function protocolPolicy() internal pure returns (bytes32) {
        return keccak256("pledge.cash.deterministic.v1.ProtocolPolicy");
    }

    function assetPolicy() internal pure returns (bytes32) {
        return keccak256("pledge.cash.deterministic.v1.AssetPolicy");
    }

    function tokenGrantFactory() internal pure returns (bytes32) {
        return keccak256("pledge.cash.deterministic.v1.TokenGrantFactory");
    }

    function ammFactory() internal pure returns (bytes32) {
        return keccak256("pledge.cash.deterministic.v1.AmmFactory");
    }

    function ammRouter() internal pure returns (bytes32) {
        return keccak256("pledge.cash.deterministic.v1.AmmRouter");
    }

    function lockedLiquidityFactory() internal pure returns (bytes32) {
        return keccak256("pledge.cash.deterministic.v1.LockedLiquidityFactory");
    }

    function distributionFactory() internal pure returns (bytes32) {
        return keccak256("pledge.cash.deterministic.v1.DistributionFactory");
    }

    function boardroomFactory() internal pure returns (bytes32) {
        return keccak256("pledge.cash.deterministic.v1.BoardroomFactory.v2");
    }
}
