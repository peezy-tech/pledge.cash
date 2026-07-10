// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "solady/auth/Ownable.sol";
import {ERC20} from "solady/tokens/ERC20.sol";
import {ProtocolFeeRouter} from "../../src/fees/ProtocolFeeRouter.sol";

contract ProtocolFeeRouterToken is ERC20 {
    function name() public pure override returns (string memory) {
        return "Protocol Fee Token";
    }

    function symbol() public pure override returns (string memory) {
        return "PFT";
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract ProtocolFeeRouterTest is Test {
    address internal governance = address(0xA11CE);
    address internal treasury = address(0xB0B);
    address internal nextTreasury = address(0xCAFE);

    ProtocolFeeRouter internal router;
    ProtocolFeeRouterToken internal token;

    function setUp() public {
        router = new ProtocolFeeRouter(governance, treasury);
        token = new ProtocolFeeRouterToken();
    }

    function testGovernanceRotatesRecipientBeforeForwardingAccumulatedFees() public {
        token.mint(address(router), 25 ether);
        vm.deal(address(router), 3 ether);

        vm.prank(governance);
        router.setFeeRecipient(nextTreasury);

        assertEq(router.forwardToken(address(token)), 25 ether);
        assertEq(router.forwardNative(), 3 ether);
        assertEq(token.balanceOf(nextTreasury), 25 ether);
        assertEq(nextTreasury.balance, 3 ether);
        assertEq(token.balanceOf(treasury), 0);
        assertEq(treasury.balance, 0);
    }

    function testAnyoneCanForwardButOnlyOwnerCanRotateRecipient() public {
        token.mint(address(router), 1 ether);

        vm.prank(nextTreasury);
        assertEq(router.forwardToken(address(token)), 1 ether);
        assertEq(token.balanceOf(treasury), 1 ether);

        vm.prank(nextTreasury);
        vm.expectRevert(Ownable.Unauthorized.selector);
        router.setFeeRecipient(nextTreasury);
    }

    function testRejectsZeroAddressesAndEmptyForwardsAreNoops() public {
        vm.expectRevert(ProtocolFeeRouter.InvalidAddress.selector);
        new ProtocolFeeRouter(address(0), treasury);

        vm.prank(governance);
        vm.expectRevert(ProtocolFeeRouter.InvalidAddress.selector);
        router.setFeeRecipient(address(0));

        assertEq(router.forwardNative(), 0);
        assertEq(router.forwardToken(address(token)), 0);
    }
}
