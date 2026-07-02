// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "solady/auth/Ownable.sol";
import {WETH} from "solady/tokens/WETH.sol";
import {AssetPolicy} from "../src/AssetPolicy.sol";
import {ProtocolPolicy} from "../src/ProtocolPolicy.sol";

contract BoardroomPolicyTest is Test {
    WETH internal wrappedNative;
    ProtocolPolicy internal protocolPolicy;
    AssetPolicy internal assetPolicy;

    address internal owner = address(this);
    address internal boardroom = address(0xB0A);
    address internal caller = address(0xA11CE);
    address internal protocolTarget = address(0xFACADE);
    address internal token = address(0xC0FFEE);
    address internal spender = address(0x5EED);
    address internal stranger = address(0xCAFE);

    function setUp() public {
        wrappedNative = new WETH();
        protocolPolicy = new ProtocolPolicy(owner);
        assetPolicy = new AssetPolicy(owner, address(wrappedNative));
    }

    function testProtocolPolicyAllowsOnlyRegisteredProtocolTargets() public {
        bytes memory data = abi.encodeWithSignature("setCreationFee(uint256)", 1 ether);

        assertFalse(protocolPolicy.canCall(boardroom, caller, protocolTarget, 0, data));

        protocolPolicy.setProtocolTargetAllowed(protocolTarget, true);

        assertTrue(protocolPolicy.canCall(boardroom, caller, protocolTarget, 0, data));
        assertFalse(protocolPolicy.canCall(boardroom, caller, stranger, 0, data));
    }

    function testProtocolPolicyOnlyOwnerCanManageTargets() public {
        vm.prank(stranger);
        vm.expectRevert(Ownable.Unauthorized.selector);
        protocolPolicy.setProtocolTargetAllowed(protocolTarget, true);

        vm.expectRevert(ProtocolPolicy.InvalidAddress.selector);
        protocolPolicy.setProtocolTargetAllowed(address(0), true);
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
