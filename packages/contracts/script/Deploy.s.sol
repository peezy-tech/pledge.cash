// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {AmmFactory} from "../src/AmmFactory.sol";
import {AmmRouter} from "../src/AmmRouter.sol";
import {BoardroomFactory} from "../src/BoardroomFactory.sol";
import {BoardroomPolicyRegistry} from "../src/BoardroomPolicyRegistry.sol";
import {DistributionFactory} from "../src/DistributionFactory.sol";
import {LockedLiquidityFactory} from "../src/LockedLiquidityFactory.sol";
import {TokenGrantFactory} from "../src/TokenGrantFactory.sol";

contract Deploy is Script {
    using stdJson for string;

    function run() external {
        uint256 deployerKey = vm.envOr("PRIVATE_KEY", uint256(0));
        address deployer = deployerKey == 0 ? msg.sender : vm.addr(deployerKey);

        if (deployerKey == 0) {
            vm.startBroadcast();
        } else {
            vm.startBroadcast(deployerKey);
        }

        BoardroomPolicyRegistry boardroomPolicyRegistry = new BoardroomPolicyRegistry(deployer);
        TokenGrantFactory tokenGrantFactory = new TokenGrantFactory();
        AmmFactory ammFactory = new AmmFactory();

        address wrappedNative = vm.envOr("WRAPPED_NATIVE_ADDRESS", address(0));
        AmmRouter ammRouter;
        LockedLiquidityFactory lockedLiquidityFactory;
        if (wrappedNative != address(0)) {
            ammRouter = new AmmRouter(address(ammFactory), wrappedNative);
            lockedLiquidityFactory = new LockedLiquidityFactory(address(ammRouter));
            boardroomPolicyRegistry.setPolicyAllowed(address(lockedLiquidityFactory), true);
        }

        DistributionFactory distributionFactory = new DistributionFactory(address(lockedLiquidityFactory));
        BoardroomFactory boardroomFactory = new BoardroomFactory(address(boardroomPolicyRegistry));

        boardroomPolicyRegistry.setPolicyAllowed(address(tokenGrantFactory), true);
        boardroomPolicyRegistry.setPolicyAllowed(address(distributionFactory), true);

        uint256 creationFee = vm.envOr("TOKEN_GRANT_CREATION_FEE_WEI", uint256(0));
        if (creationFee == 0) {
            creationFee = vm.envOr("GRANT_CREATION_FEE_WEI", uint256(0));
        }
        if (creationFee != 0) {
            tokenGrantFactory.setCreationFee(creationFee);
        }

        vm.stopBroadcast();

        uint256 chainId = block.chainid;
        string memory json = "deployment";
        json.serialize("chainId", chainId);
        json.serialize("boardroomPolicyRegistry", address(boardroomPolicyRegistry));
        json.serialize("boardroomFactory", address(boardroomFactory));
        json.serialize("distributionFactory", address(distributionFactory));
        json.serialize("ammFactory", address(ammFactory));
        if (wrappedNative != address(0)) {
            json.serialize("wrappedNative", wrappedNative);
            json.serialize("ammRouter", address(ammRouter));
            json.serialize("lockedLiquidityFactory", address(lockedLiquidityFactory));
            json.serialize(
                "lockedLiquidityPolicyAllowed", boardroomPolicyRegistry.isPolicyAllowed(address(lockedLiquidityFactory))
            );
        }
        json.serialize("tokenGrantFactory", address(tokenGrantFactory));
        json.serialize("tokenGrantLogic", tokenGrantFactory.tokenGrantLogic());
        json.serialize("policyRegistryOwner", boardroomPolicyRegistry.owner());
        json.serialize("tokenGrantPolicyAllowed", boardroomPolicyRegistry.isPolicyAllowed(address(tokenGrantFactory)));
        json.serialize(
            "distributionPolicyAllowed", boardroomPolicyRegistry.isPolicyAllowed(address(distributionFactory))
        );
        json.serialize("factoryOwner", tokenGrantFactory.owner());
        json.serialize("creationFee", tokenGrantFactory.creationFee());
        json.serialize("deploymentTimestamp", block.timestamp);
        string memory output = json.serialize("deployer", deployer);

        if (vm.envOr("WRITE_DEPLOYMENT_STATE", true)) {
            vm.createDir("deployments", true);
            vm.writeJson(output, string.concat("deployments/", vm.toString(chainId), ".json"));
        }

        console2.log("BoardroomPolicyRegistry", address(boardroomPolicyRegistry));
        console2.log("BoardroomFactory", address(boardroomFactory));
        console2.log("DistributionFactory", address(distributionFactory));
        console2.log("AmmFactory", address(ammFactory));
        if (wrappedNative != address(0)) {
            console2.log("WrappedNative", wrappedNative);
            console2.log("AmmRouter", address(ammRouter));
            console2.log("LockedLiquidityFactory", address(lockedLiquidityFactory));
            console2.log(
                "LockedLiquidityPolicyAllowed", boardroomPolicyRegistry.isPolicyAllowed(address(lockedLiquidityFactory))
            );
        }
        console2.log("TokenGrantFactory", address(tokenGrantFactory));
        console2.log("TokenGrantLogic", tokenGrantFactory.tokenGrantLogic());
        console2.log("PolicyRegistryOwner", boardroomPolicyRegistry.owner());
        console2.log("TokenGrantPolicyAllowed", boardroomPolicyRegistry.isPolicyAllowed(address(tokenGrantFactory)));
        console2.log("DistributionPolicyAllowed", boardroomPolicyRegistry.isPolicyAllowed(address(distributionFactory)));
        console2.log("FactoryOwner", tokenGrantFactory.owner());
        console2.log("CreationFee", tokenGrantFactory.creationFee());
        console2.log("Deployment chain", chainId);
    }
}
