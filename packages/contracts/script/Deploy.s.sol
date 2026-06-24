// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
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

        TokenGrantFactory tokenGrantFactory = new TokenGrantFactory();
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
        json.serialize("tokenGrantFactory", address(tokenGrantFactory));
        json.serialize("tokenGrantLogic", tokenGrantFactory.tokenGrantLogic());
        json.serialize("factoryOwner", tokenGrantFactory.owner());
        json.serialize("creationFee", tokenGrantFactory.creationFee());
        json.serialize("deploymentTimestamp", block.timestamp);
        string memory output = json.serialize("deployer", deployer);

        if (vm.envOr("WRITE_DEPLOYMENT_STATE", true)) {
            vm.createDir("deployments", true);
            vm.writeJson(output, string.concat("deployments/", vm.toString(chainId), ".json"));
        }

        console2.log("TokenGrantFactory", address(tokenGrantFactory));
        console2.log("TokenGrantLogic", tokenGrantFactory.tokenGrantLogic());
        console2.log("FactoryOwner", tokenGrantFactory.owner());
        console2.log("CreationFee", tokenGrantFactory.creationFee());
        console2.log("Deployment chain", chainId);
    }
}
