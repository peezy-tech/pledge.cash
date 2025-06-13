// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "forge-std/Script.sol";
import "forge-std/Test.sol";

import {MockERC20} from "../test/mocks/mockERC20.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";

import {Option} from "../src/option.sol";

contract Deploy is Script, Test {
    address public USDC;
    address public TOKEN;

    address public deployer;
    uint256 public deployerPrivateKey =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80; // local testnet

    address public guy = 0xc0D9C85978112748f293E28E4a6C232bB2dF30f0; // hyperliquid guy

    function run() external {
        deployer = vm.addr(deployerPrivateKey);
        vm.startBroadcast(deployerPrivateKey);

        _deployCore();
        vm.stopBroadcast();
    }

    function _deployCore() internal {
        MockERC20 usdc = new MockERC20("mockUSDC", "mUSDC", 6);
        USDC = address(usdc);
        usdc.mint(deployer, 100_000_000 * (10 ** 6));
        console.log("usdc", address(usdc));
        console.log("usdc balance", usdc.balanceOf(deployer));

        MockERC20 token = new MockERC20("mockToken", "mTOKEN", 18);
        TOKEN = address(token);
        token.mint(deployer, 1_000_000_000 ether);
        console.log("token", address(token));
        console.log("token balance", token.balanceOf(deployer));

        // Precompute the Option contract address
        address optionAddress = vm.computeCreateAddress(deployer, vm.getNonce(deployer) + 1);
        console.log("precomputed option address", optionAddress);

        // Give allowance to the precomputed Option contract address
        token.approve(optionAddress, 100_000_000 ether);

        Option option = new Option(
            USDC,
            deployer,
            TOKEN,
            100_000_000 ether,
            100 * (10 ** 6),
            block.timestamp + 10 days,
            block.timestamp,
            block.timestamp
        );

        console.log("option", address(option));
        console.log("option balance", option.amount());

        console.log("option holder", option.holder());
        console.log("option currency", option.currency());
        console.log("option underlying", option.underlying());
        console.log("option strikePrice", option.strikePrice());
        console.log("option expiry", option.expiry());

        SafeTransferLib.safeTransfer(
            USDC,
            guy,
            100_000_000 * (10 ** 6)
        );

        // Also transfer some ether to guy
        payable(guy).transfer(100 ether);
        
    }
}
