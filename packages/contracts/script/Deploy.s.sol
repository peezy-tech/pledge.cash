// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {AmmFactory} from "../src/AmmFactory.sol";
import {AmmRouter} from "../src/AmmRouter.sol";
import {AssetPolicy} from "../src/AssetPolicy.sol";
import {BoardroomFactory} from "../src/BoardroomFactory.sol";
import {BoardroomPolicyRegistry} from "../src/BoardroomPolicyRegistry.sol";
import {DistributionFactory} from "../src/DistributionFactory.sol";
import {LockedLiquidityFactory} from "../src/LockedLiquidityFactory.sol";
import {ProtocolPolicy} from "../src/ProtocolPolicy.sol";
import {TokenGrantFactory} from "../src/TokenGrantFactory.sol";

contract Deploy is Script {
    using stdJson for string;

    error MissingWrappedNativeAddress();

    struct DeployState {
        address deployer;
        address wrappedNative;
        address ammProtocolFeeRecipient;
        BoardroomPolicyRegistry boardroomPolicyRegistry;
        ProtocolPolicy protocolPolicy;
        AssetPolicy assetPolicy;
        TokenGrantFactory tokenGrantFactory;
        AmmFactory ammFactory;
        AmmRouter ammRouter;
        LockedLiquidityFactory lockedLiquidityFactory;
        DistributionFactory distributionFactory;
        BoardroomFactory boardroomFactory;
    }

    function run() external {
        uint256 deployerKey = vm.envOr("PRIVATE_KEY", uint256(0));
        DeployState memory state;
        state.deployer = deployerKey == 0 ? msg.sender : vm.addr(deployerKey);
        state.wrappedNative = vm.envOr("WRAPPED_NATIVE_ADDRESS", address(0));
        if (state.wrappedNative == address(0)) revert MissingWrappedNativeAddress();

        if (deployerKey == 0) {
            vm.startBroadcast();
        } else {
            vm.startBroadcast(deployerKey);
        }

        _deployContracts(state);
        _configurePolicies(state);
        _configureCreationFee(state.tokenGrantFactory);

        vm.stopBroadcast();

        string memory output = _deploymentJson(state);

        if (vm.envOr("WRITE_DEPLOYMENT_STATE", true)) {
            vm.createDir("deployments", true);
            vm.writeJson(output, string.concat("deployments/", vm.toString(block.chainid), ".json"));
        }

        _logDeployment(state);
    }

    function _deployContracts(DeployState memory state) internal {
        state.boardroomPolicyRegistry = new BoardroomPolicyRegistry(state.deployer);
        state.protocolPolicy = new ProtocolPolicy(state.deployer);
        state.assetPolicy = new AssetPolicy(state.deployer, state.wrappedNative);
        state.tokenGrantFactory = new TokenGrantFactory();
        state.ammFactory = new AmmFactory();

        state.ammProtocolFeeRecipient = vm.envOr("AMM_PROTOCOL_FEE_RECIPIENT", address(0));
        if (state.ammProtocolFeeRecipient != address(0)) {
            state.ammFactory.setProtocolFeeRecipient(state.ammProtocolFeeRecipient);
        }

        state.ammRouter = new AmmRouter(address(state.ammFactory), state.wrappedNative);
        state.lockedLiquidityFactory = new LockedLiquidityFactory(address(state.ammRouter));
        state.distributionFactory = new DistributionFactory(address(state.lockedLiquidityFactory));
        state.boardroomFactory = new BoardroomFactory(address(state.boardroomPolicyRegistry), state.wrappedNative);
    }

    function _configurePolicies(DeployState memory state) internal {
        state.protocolPolicy.setProtocolTargetAllowed(address(state.tokenGrantFactory), true);
        state.protocolPolicy.setProtocolTargetAllowed(address(state.distributionFactory), true);
        state.protocolPolicy.setProtocolTargetAllowed(address(state.lockedLiquidityFactory), true);
        state.protocolPolicy.setProtocolTargetAllowed(address(state.ammFactory), true);
        state.protocolPolicy.setProtocolTargetAllowed(address(state.ammRouter), true);
        state.assetPolicy.setApprovalSpenderAllowed(address(state.tokenGrantFactory), true);
        state.assetPolicy.setApprovalSpenderAllowed(address(state.distributionFactory), true);
        state.assetPolicy.setApprovalSpenderAllowed(address(state.lockedLiquidityFactory), true);
        state.boardroomPolicyRegistry.setPolicyAllowed(address(state.protocolPolicy), true);
        state.boardroomPolicyRegistry.setPolicyAllowed(address(state.assetPolicy), true);
        state.boardroomPolicyRegistry.setPolicyAllowed(address(state.tokenGrantFactory), true);
        state.boardroomPolicyRegistry.setPolicyAllowed(address(state.distributionFactory), true);
        state.boardroomPolicyRegistry.setPolicyAllowed(address(state.lockedLiquidityFactory), true);
    }

    function _configureCreationFee(TokenGrantFactory tokenGrantFactory) internal {
        uint256 creationFee = vm.envOr("TOKEN_GRANT_CREATION_FEE_WEI", uint256(0));
        if (creationFee == 0) {
            creationFee = vm.envOr("GRANT_CREATION_FEE_WEI", uint256(0));
        }
        if (creationFee != 0) {
            tokenGrantFactory.setCreationFee(creationFee);
        }
    }

    function _deploymentJson(DeployState memory state) internal returns (string memory output) {
        uint256 chainId = block.chainid;
        string memory json = "deployment";
        json.serialize("chainId", chainId);
        _serializeAddresses(json, state);
        _serializePolicyState(json, state);
        _serializeOwnershipState(json, state);
        json.serialize("deploymentTimestamp", block.timestamp);
        output = json.serialize("deployer", state.deployer);
    }

    function _serializeAddresses(string memory json, DeployState memory state) internal {
        json.serialize("boardroomPolicyRegistry", address(state.boardroomPolicyRegistry));
        json.serialize("protocolPolicy", address(state.protocolPolicy));
        json.serialize("assetPolicy", address(state.assetPolicy));
        json.serialize("boardroomFactory", address(state.boardroomFactory));
        json.serialize("distributionFactory", address(state.distributionFactory));
        json.serialize("ammFactory", address(state.ammFactory));
        if (state.ammProtocolFeeRecipient != address(0)) {
            json.serialize("ammProtocolFeeRecipient", state.ammFactory.protocolFeeRecipient());
        }
        json.serialize("wrappedNative", state.wrappedNative);
        json.serialize("ammRouter", address(state.ammRouter));
        json.serialize("lockedLiquidityFactory", address(state.lockedLiquidityFactory));
        json.serialize("tokenGrantFactory", address(state.tokenGrantFactory));
        json.serialize("tokenGrantLogic", state.tokenGrantFactory.tokenGrantLogic());
    }

    function _serializePolicyState(string memory json, DeployState memory state) internal {
        json.serialize(
            "protocolPolicyAllowed", state.boardroomPolicyRegistry.isPolicyAllowed(address(state.protocolPolicy))
        );
        json.serialize("assetPolicyAllowed", state.boardroomPolicyRegistry.isPolicyAllowed(address(state.assetPolicy)));
        json.serialize(
            "protocolTokenGrantFactoryAllowed",
            state.protocolPolicy.isProtocolTargetAllowed(address(state.tokenGrantFactory))
        );
        json.serialize(
            "protocolDistributionFactoryAllowed",
            state.protocolPolicy.isProtocolTargetAllowed(address(state.distributionFactory))
        );
        json.serialize(
            "protocolLockedLiquidityFactoryAllowed",
            state.protocolPolicy.isProtocolTargetAllowed(address(state.lockedLiquidityFactory))
        );
        json.serialize(
            "protocolAmmFactoryAllowed", state.protocolPolicy.isProtocolTargetAllowed(address(state.ammFactory))
        );
        json.serialize(
            "protocolAmmRouterAllowed", state.protocolPolicy.isProtocolTargetAllowed(address(state.ammRouter))
        );
        json.serialize("assetWrappedNativeAllowed", state.assetPolicy.isAssetAllowed(state.wrappedNative));
        json.serialize(
            "assetTokenGrantSpenderAllowed",
            state.assetPolicy.isApprovalSpenderAllowed(address(state.tokenGrantFactory))
        );
        json.serialize(
            "assetDistributionSpenderAllowed",
            state.assetPolicy.isApprovalSpenderAllowed(address(state.distributionFactory))
        );
        json.serialize(
            "assetLockedLiquiditySpenderAllowed",
            state.assetPolicy.isApprovalSpenderAllowed(address(state.lockedLiquidityFactory))
        );
        json.serialize(
            "lockedLiquidityPolicyAllowed",
            state.boardroomPolicyRegistry.isPolicyAllowed(address(state.lockedLiquidityFactory))
        );
        json.serialize(
            "tokenGrantPolicyAllowed", state.boardroomPolicyRegistry.isPolicyAllowed(address(state.tokenGrantFactory))
        );
        json.serialize(
            "distributionPolicyAllowed",
            state.boardroomPolicyRegistry.isPolicyAllowed(address(state.distributionFactory))
        );
    }

    function _serializeOwnershipState(string memory json, DeployState memory state) internal {
        json.serialize("policyRegistryOwner", state.boardroomPolicyRegistry.owner());
        json.serialize("protocolPolicyOwner", state.protocolPolicy.owner());
        json.serialize("assetPolicyOwner", state.assetPolicy.owner());
        json.serialize("factoryOwner", state.tokenGrantFactory.owner());
        json.serialize("creationFee", state.tokenGrantFactory.creationFee());
    }

    function _logDeployment(DeployState memory state) internal view {
        console2.log("BoardroomPolicyRegistry", address(state.boardroomPolicyRegistry));
        console2.log("ProtocolPolicy", address(state.protocolPolicy));
        console2.log("AssetPolicy", address(state.assetPolicy));
        console2.log("BoardroomFactory", address(state.boardroomFactory));
        console2.log("DistributionFactory", address(state.distributionFactory));
        console2.log("AmmFactory", address(state.ammFactory));
        if (state.ammProtocolFeeRecipient != address(0)) {
            console2.log("AmmProtocolFeeRecipient", state.ammFactory.protocolFeeRecipient());
        }
        console2.log("WrappedNative", state.wrappedNative);
        console2.log("AmmRouter", address(state.ammRouter));
        console2.log("LockedLiquidityFactory", address(state.lockedLiquidityFactory));
        _logPolicyState(state);
        console2.log("TokenGrantFactory", address(state.tokenGrantFactory));
        console2.log("TokenGrantLogic", state.tokenGrantFactory.tokenGrantLogic());
        console2.log("PolicyRegistryOwner", state.boardroomPolicyRegistry.owner());
        console2.log("ProtocolPolicyOwner", state.protocolPolicy.owner());
        console2.log("AssetPolicyOwner", state.assetPolicy.owner());
        console2.log(
            "TokenGrantPolicyAllowed", state.boardroomPolicyRegistry.isPolicyAllowed(address(state.tokenGrantFactory))
        );
        console2.log(
            "DistributionPolicyAllowed",
            state.boardroomPolicyRegistry.isPolicyAllowed(address(state.distributionFactory))
        );
        console2.log("FactoryOwner", state.tokenGrantFactory.owner());
        console2.log("CreationFee", state.tokenGrantFactory.creationFee());
        console2.log("Deployment chain", block.chainid);
    }

    function _logPolicyState(DeployState memory state) internal view {
        console2.log(
            "ProtocolPolicyAllowed", state.boardroomPolicyRegistry.isPolicyAllowed(address(state.protocolPolicy))
        );
        console2.log("AssetPolicyAllowed", state.boardroomPolicyRegistry.isPolicyAllowed(address(state.assetPolicy)));
        console2.log(
            "ProtocolTokenGrantFactoryAllowed",
            state.protocolPolicy.isProtocolTargetAllowed(address(state.tokenGrantFactory))
        );
        console2.log(
            "ProtocolDistributionFactoryAllowed",
            state.protocolPolicy.isProtocolTargetAllowed(address(state.distributionFactory))
        );
        console2.log(
            "ProtocolLockedLiquidityFactoryAllowed",
            state.protocolPolicy.isProtocolTargetAllowed(address(state.lockedLiquidityFactory))
        );
        console2.log(
            "ProtocolAmmFactoryAllowed", state.protocolPolicy.isProtocolTargetAllowed(address(state.ammFactory))
        );
        console2.log("ProtocolAmmRouterAllowed", state.protocolPolicy.isProtocolTargetAllowed(address(state.ammRouter)));
        console2.log("AssetWrappedNativeAllowed", state.assetPolicy.isAssetAllowed(state.wrappedNative));
        console2.log(
            "AssetTokenGrantSpenderAllowed",
            state.assetPolicy.isApprovalSpenderAllowed(address(state.tokenGrantFactory))
        );
        console2.log(
            "AssetDistributionSpenderAllowed",
            state.assetPolicy.isApprovalSpenderAllowed(address(state.distributionFactory))
        );
        console2.log(
            "AssetLockedLiquiditySpenderAllowed",
            state.assetPolicy.isApprovalSpenderAllowed(address(state.lockedLiquidityFactory))
        );
        console2.log(
            "LockedLiquidityPolicyAllowed",
            state.boardroomPolicyRegistry.isPolicyAllowed(address(state.lockedLiquidityFactory))
        );
    }
}
