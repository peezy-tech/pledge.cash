// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {AmmFactory} from "../amm/AmmFactory.sol";
import {AmmRouter} from "../amm/AmmRouter.sol";
import {AssetPolicy} from "../policy/AssetPolicy.sol";
import {BoardroomGovernanceLogic} from "../boardroom/BoardroomGovernanceLogic.sol";
import {BoardroomMarketLogic} from "../boardroom/BoardroomMarketLogic.sol";
import {BoardroomPolicyRegistry} from "../boardroom/BoardroomPolicyRegistry.sol";
import {BoardroomRedemptionPayout} from "../boardroom/BoardroomRedemptionPayout.sol";
import {BoardroomController} from "../boardroom/BoardroomController.sol";
import {BoardroomControllerFactory} from "../boardroom/BoardroomControllerFactory.sol";
import {BoardroomFactory} from "../boardroom/BoardroomFactory.sol";
import {BoardroomAuthorityFacet} from "../boardroom/diamond/BoardroomAuthorityFacet.sol";
import {BoardroomExecutionFacet} from "../boardroom/diamond/BoardroomExecutionFacet.sol";
import {BoardroomKernel} from "../boardroom/diamond/BoardroomKernel.sol";
import {BoardroomMarketFacet} from "../boardroom/diamond/BoardroomMarketFacet.sol";
import {BoardroomRedemptionFacet} from "../boardroom/diamond/BoardroomRedemptionFacet.sol";
import {BoardroomViewFacet} from "../boardroom/diamond/BoardroomViewFacet.sol";
import {ProtocolFacetRegistry} from "../boardroom/diamond/ProtocolFacetRegistry.sol";
import {BondMarketFactory} from "../bonds/BondMarketFactory.sol";
import {DistributionFactory} from "../distribution/DistributionFactory.sol";
import {ProtocolFeeRouter} from "../fees/ProtocolFeeRouter.sol";
import {TokenGrantFactory} from "../grants/TokenGrantFactory.sol";
import {LockedLiquidityFactory} from "../liquidity/LockedLiquidityFactory.sol";
import {BoardroomRewardsFactory} from "../rewards/BoardroomRewardsFactory.sol";
import {PledgeCashDeterministicDeployer} from "./PledgeCashDeterministicDeployer.sol";

/// @notice Bytecode-bound salts for the sole canonical pledge.cash protocol release.
/// @dev A changed creation bytecode hash necessarily yields a different CREATE3 salt.
/// Constructor arguments remain protected by `PledgeCashDeterministicDeployer`'s
/// first-use init-code commitment for that salt.
library PledgeCashDeploymentSalts {
    string internal constant VERSION = "pledge.cash.protocol.v1";

    function version() internal pure returns (string memory) {
        return VERSION;
    }

    function deterministicDeployer() internal pure returns (bytes32) {
        return
            _releaseSalt(
                "PledgeCashDeterministicDeployer", keccak256(type(PledgeCashDeterministicDeployer).creationCode)
            );
    }

    function protocolFacetRegistry() internal pure returns (bytes32) {
        return _releaseSalt("ProtocolFacetRegistry", keccak256(type(ProtocolFacetRegistry).creationCode));
    }

    function boardroomKernel() internal pure returns (bytes32) {
        return _releaseSalt("BoardroomKernel", keccak256(type(BoardroomKernel).creationCode));
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

    function boardroomMarketLogic() internal pure returns (bytes32) {
        return _releaseSalt("BoardroomMarketLogic", keccak256(type(BoardroomMarketLogic).creationCode));
    }

    function boardroomFactory() internal pure returns (bytes32) {
        return _releaseSalt("BoardroomFactory", keccak256(type(BoardroomFactory).creationCode));
    }

    function boardroomAuthorityFacet() internal pure returns (bytes32) {
        return _releaseSalt("BoardroomAuthorityFacet", keccak256(type(BoardroomAuthorityFacet).creationCode));
    }

    function boardroomExecutionFacet() internal pure returns (bytes32) {
        return _releaseSalt("BoardroomExecutionFacet", keccak256(type(BoardroomExecutionFacet).creationCode));
    }

    function boardroomMarketFacet() internal pure returns (bytes32) {
        return _releaseSalt("BoardroomMarketFacet", keccak256(type(BoardroomMarketFacet).creationCode));
    }

    function boardroomRedemptionFacet() internal pure returns (bytes32) {
        return _releaseSalt("BoardroomRedemptionFacet", keccak256(type(BoardroomRedemptionFacet).creationCode));
    }

    function boardroomViewFacet() internal pure returns (bytes32) {
        return _releaseSalt("BoardroomViewFacet", keccak256(type(BoardroomViewFacet).creationCode));
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

    function bondMarketFactory() internal pure returns (bytes32) {
        return _releaseSalt("BondMarketFactory", keccak256(type(BondMarketFactory).creationCode));
    }

    function boardroomArchitectureCodeHash() internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(type(ProtocolFacetRegistry).creationCode),
                keccak256(type(BoardroomKernel).creationCode),
                keccak256(type(BoardroomFactory).creationCode),
                keccak256(type(BoardroomControllerFactory).creationCode),
                keccak256(type(BoardroomController).creationCode),
                keccak256(type(BoardroomGovernanceLogic).creationCode),
                keccak256(type(BoardroomMarketLogic).creationCode),
                keccak256(type(BoardroomRedemptionPayout).creationCode),
                keccak256(type(BoardroomAuthorityFacet).creationCode),
                keccak256(type(BoardroomExecutionFacet).creationCode),
                keccak256(type(BoardroomMarketFacet).creationCode),
                keccak256(type(BoardroomRedemptionFacet).creationCode),
                keccak256(type(BoardroomViewFacet).creationCode)
            )
        );
    }

    function moduleArchitectureCodeHash() internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(type(BoardroomPolicyRegistry).creationCode),
                keccak256(type(AssetPolicy).creationCode),
                keccak256(type(ProtocolFeeRouter).creationCode),
                keccak256(type(TokenGrantFactory).creationCode),
                keccak256(type(AmmFactory).creationCode),
                keccak256(type(AmmRouter).creationCode),
                keccak256(type(LockedLiquidityFactory).creationCode),
                keccak256(type(DistributionFactory).creationCode),
                keccak256(type(BoardroomRewardsFactory).creationCode),
                keccak256(type(BondMarketFactory).creationCode)
            )
        );
    }

    function releaseCodeHash() internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(type(PledgeCashDeterministicDeployer).creationCode),
                boardroomArchitectureCodeHash(),
                moduleArchitectureCodeHash()
            )
        );
    }

    function _releaseSalt(string memory contractName, bytes32 creationCodeHash) private pure returns (bytes32) {
        return keccak256(abi.encode(VERSION, contractName, creationCodeHash));
    }
}
