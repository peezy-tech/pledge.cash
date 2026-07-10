// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "solady/auth/Ownable.sol";
import {WETH} from "solady/tokens/WETH.sol";
import {BoardroomPolicyRegistry} from "../../src/boardroom/BoardroomPolicyRegistry.sol";
import {AssetPolicy} from "../../src/policy/AssetPolicy.sol";

contract BoardroomPolicyTest is Test {
    WETH internal wrappedNative;
    BoardroomPolicyRegistry internal policyRegistry;
    AssetPolicy internal assetPolicy;

    address internal owner = address(this);
    address internal boardroom = address(0xB0A);
    address internal caller = address(0xA11CE);
    address internal token = address(0xC0FFEE);
    address internal spender = address(0x5EED);
    address internal stranger = address(0xCAFE);

    function setUp() public {
        wrappedNative = new WETH();
        policyRegistry = new BoardroomPolicyRegistry(owner);
        assetPolicy = new AssetPolicy(owner, address(wrappedNative));
    }

    function testPolicyRegistryTracksStatusWithoutTreatingPlainPolicyAsModule() public {
        assertFalse(policyRegistry.isPolicyAllowed(token));
        assertFalse(policyRegistry.isPolicyLifecycleAllowed(token));
        assertFalse(policyRegistry.isModulePolicy(token));

        policyRegistry.setPolicyAllowed(token, true);

        assertTrue(policyRegistry.isPolicyAllowed(token));
        assertTrue(policyRegistry.isPolicyLifecycleAllowed(token));
        assertFalse(policyRegistry.isModulePolicy(token));
    }

    function testModuleIdentityIsPermanentAcrossEveryStatus() public {
        policyRegistry.registerModulePolicy(token);

        assertTrue(policyRegistry.isModulePolicy(token));
        assertTrue(policyRegistry.isPolicyAllowed(token));
        assertTrue(policyRegistry.isPolicyLifecycleAllowed(token));

        policyRegistry.setPolicyStatus(token, BoardroomPolicyRegistry.PolicyStatus.LifecycleOnly);

        assertFalse(policyRegistry.isPolicyAllowed(token));
        assertTrue(policyRegistry.isPolicyLifecycleAllowed(token));

        policyRegistry.setPolicyAllowed(token, false);

        assertFalse(policyRegistry.isPolicyAllowed(token));
        assertTrue(policyRegistry.isPolicyLifecycleAllowed(token));
        assertTrue(policyRegistry.isModulePolicy(token));

        vm.expectRevert(abi.encodeWithSelector(BoardroomPolicyRegistry.ModulePolicyAlreadyRegistered.selector, token));
        policyRegistry.registerModulePolicy(token);
    }

    function testPolicyRegistryOnlyOwnerCanManageStatus() public {
        vm.prank(stranger);
        vm.expectRevert(Ownable.Unauthorized.selector);
        policyRegistry.setPolicyAllowed(token, true);

        vm.prank(stranger);
        vm.expectRevert(Ownable.Unauthorized.selector);
        policyRegistry.setPolicyStatus(token, BoardroomPolicyRegistry.PolicyStatus.LifecycleOnly);

        vm.prank(stranger);
        vm.expectRevert(Ownable.Unauthorized.selector);
        policyRegistry.registerModulePolicy(token);

        vm.expectRevert(BoardroomPolicyRegistry.InvalidAddress.selector);
        policyRegistry.setPolicyAllowed(address(0), true);

        vm.expectRevert(BoardroomPolicyRegistry.InvalidAddress.selector);
        policyRegistry.setPolicyStatus(address(0), BoardroomPolicyRegistry.PolicyStatus.Active);

        vm.expectRevert(BoardroomPolicyRegistry.InvalidAddress.selector);
        policyRegistry.registerModulePolicy(address(0));
    }

    function testAssetPolicyAllowsWrappedNativeDepositOnly() public view {
        assertTrue(
            assetPolicy.canCall(boardroom, caller, address(wrappedNative), 1 ether, abi.encodeCall(WETH.deposit, ()))
        );
        assertFalse(
            assetPolicy.canCall(boardroom, caller, address(wrappedNative), 0, abi.encodeCall(WETH.withdraw, (1 ether)))
        );
    }

    function testAssetPolicyAllowsErc20ApprovalOnlyForAllowedAssetAndSpender() public {
        bytes memory approval = abi.encodeWithSignature("approve(address,uint256)", spender, 1 ether);

        assertFalse(assetPolicy.canCall(boardroom, caller, token, 0, approval));

        assetPolicy.setAssetAllowed(token, true);

        assertFalse(assetPolicy.canCall(boardroom, caller, token, 0, approval));

        assetPolicy.setApprovalSpenderAllowed(spender, true);

        assertTrue(assetPolicy.canCall(boardroom, caller, token, 0, approval));
        assertFalse(assetPolicy.canCall(boardroom, caller, token, 1, approval));
        assertFalse(
            assetPolicy.canCall(
                boardroom, caller, token, 0, abi.encodeWithSignature("transfer(address,uint256)", spender, 1 ether)
            )
        );
        assertFalse(
            assetPolicy.canCall(
                boardroom, caller, token, 0, abi.encodeWithSignature("approve(address,uint256)", stranger, 1 ether)
            )
        );
    }

    function testAssetPolicyOnlyOwnerCanManageRegistries() public {
        vm.prank(stranger);
        vm.expectRevert(Ownable.Unauthorized.selector);
        assetPolicy.setAssetAllowed(token, true);

        vm.prank(stranger);
        vm.expectRevert(Ownable.Unauthorized.selector);
        assetPolicy.setApprovalSpenderAllowed(spender, true);

        vm.expectRevert(AssetPolicy.InvalidAddress.selector);
        assetPolicy.setAssetAllowed(address(0), true);

        vm.expectRevert(AssetPolicy.InvalidAddress.selector);
        assetPolicy.setApprovalSpenderAllowed(address(0), true);
    }
}
