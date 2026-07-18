// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {AmmFactory} from "../amm/AmmFactory.sol";
import {AmmRouter} from "../amm/AmmRouter.sol";
import {AssetPolicy} from "../policy/AssetPolicy.sol";
import {BoardroomFactory} from "../boardroom/BoardroomFactory.sol";
import {BoardroomGovernanceLogic} from "../boardroom/BoardroomGovernanceLogic.sol";
import {BoardroomPolicyRegistry} from "../boardroom/BoardroomPolicyRegistry.sol";
import {BoardroomRedemptionPayout} from "../boardroom/BoardroomRedemptionPayout.sol";
import {DistributionFactory} from "../distribution/DistributionFactory.sol";
import {ProtocolFeeRouter} from "../fees/ProtocolFeeRouter.sol";
import {TokenGrantFactory} from "../grants/TokenGrantFactory.sol";
import {LockedLiquidityFactory} from "../liquidity/LockedLiquidityFactory.sol";
import {BoardroomRewardsFactory} from "../rewards/BoardroomRewardsFactory.sol";

library PledgeCashDeploymentSalts {
    string internal constant VERSION = "pledge.cash.deterministic.v4";

    bytes32 internal constant DETERMINISTIC_DEPLOYER =
        keccak256("pledge.cash.deterministic.v1.PledgeCashDeterministicDeployer");

    function version() internal pure returns (string memory) {
        return VERSION;
    }

    function deterministicDeployer() internal pure returns (bytes32) {
        return DETERMINISTIC_DEPLOYER;
    }

    function boardroomPolicyRegistry() internal pure returns (bytes32) {
        return _releaseSalt("BoardroomPolicyRegistry", keccak256(type(BoardroomPolicyRegistry).creationCode));
    }

    function assetPolicy() internal pure returns (bytes32) {
        return _releaseSalt("AssetPolicy", keccak256(type(AssetPolicy).creationCode));
    }

    function boardroomGovernanceLogic() internal pure returns (bytes32) {
        return _releaseSalt("BoardroomGovernanceLogic", keccak256(type(BoardroomGovernanceLogic).creationCode));
    }

    function boardroomRedemptionPayout() internal pure returns (bytes32) {
        return _releaseSalt("BoardroomRedemptionPayout", keccak256(type(BoardroomRedemptionPayout).creationCode));
    }

    function protocolFeeRouter() internal pure returns (bytes32) {
        return _releaseSalt("ProtocolFeeRouter", keccak256(type(ProtocolFeeRouter).creationCode));
    }

    function tokenGrantFactory() internal pure returns (bytes32) {
        return _releaseSalt("TokenGrantFactory", keccak256(type(TokenGrantFactory).creationCode));
    }

    function ammFactory() internal pure returns (bytes32) {
        return _releaseSalt("AmmFactory", keccak256(type(AmmFactory).creationCode));
    }

    function ammRouter() internal pure returns (bytes32) {
        return _releaseSalt("AmmRouter", keccak256(type(AmmRouter).creationCode));
    }

    function lockedLiquidityFactory() internal pure returns (bytes32) {
        return _releaseSalt("LockedLiquidityFactory", keccak256(type(LockedLiquidityFactory).creationCode));
    }

    function distributionFactory() internal pure returns (bytes32) {
        return _releaseSalt("DistributionFactory", keccak256(type(DistributionFactory).creationCode));
    }

    function boardroomRewardsFactory() internal pure returns (bytes32) {
        return _releaseSalt("BoardroomRewardsFactory", keccak256(type(BoardroomRewardsFactory).creationCode));
    }

    function boardroomFactory() internal pure returns (bytes32) {
        return _releaseSalt("BoardroomFactory", keccak256(type(BoardroomFactory).creationCode));
    }

    function releaseCodeHash() internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(type(BoardroomPolicyRegistry).creationCode),
                keccak256(type(AssetPolicy).creationCode),
                keccak256(type(BoardroomGovernanceLogic).creationCode),
                keccak256(type(BoardroomRedemptionPayout).creationCode),
                keccak256(type(ProtocolFeeRouter).creationCode),
                keccak256(type(TokenGrantFactory).creationCode),
                keccak256(type(AmmFactory).creationCode),
                keccak256(type(AmmRouter).creationCode),
                keccak256(type(LockedLiquidityFactory).creationCode),
                keccak256(type(DistributionFactory).creationCode),
                keccak256(type(BoardroomRewardsFactory).creationCode),
                keccak256(type(BoardroomFactory).creationCode)
            )
        );
    }

    function _releaseSalt(string memory contractName, bytes32 creationCodeHash) private pure returns (bytes32) {
        return keccak256(abi.encode(VERSION, contractName, creationCodeHash));
    }
}
