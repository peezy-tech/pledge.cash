// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "solady/auth/Ownable.sol";
import {ProtocolFeeRouter} from "../../src/fees/ProtocolFeeRouter.sol";
import {SoladyTestERC20} from "../helpers/TestTokens.sol";

contract ProtocolFeeRouterToken is SoladyTestERC20 {
    constructor() SoladyTestERC20("Protocol Fee Token", "PFT") {}
}

contract ReentrantProtocolFeeRouterToken is ProtocolFeeRouterToken {
    ProtocolFeeRouter internal immutable router;
    address internal immutable tokenToForward;

    bool public callbackEntered;
    uint256 public nativeForwardedDuringCallback;
    uint256 public tokenForwardedDuringCallback;

    constructor(ProtocolFeeRouter router_, address tokenToForward_) {
        router = router_;
        tokenToForward = tokenToForward_;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (!callbackEntered) {
            callbackEntered = true;
            tokenForwardedDuringCallback = router.forwardToken(tokenToForward);
            nativeForwardedDuringCallback = router.forwardNative();
        }
        return super.transfer(to, amount);
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

    function testTokenCallbackCanOnlyForwardOtherAssetsToFixedRecipient() public {
        ReentrantProtocolFeeRouterToken callbackToken = new ReentrantProtocolFeeRouterToken(router, address(token));
        callbackToken.mint(address(router), 2 ether);
        token.mint(address(router), 1 ether);
        vm.deal(address(router), 3 ether);

        assertEq(router.forwardToken(address(callbackToken)), 2 ether);

        assertTrue(callbackToken.callbackEntered());
        assertEq(callbackToken.tokenForwardedDuringCallback(), 1 ether);
        assertEq(callbackToken.nativeForwardedDuringCallback(), 3 ether);
        assertEq(callbackToken.balanceOf(treasury), 2 ether);
        assertEq(token.balanceOf(treasury), 1 ether);
        assertEq(treasury.balance, 3 ether);
        assertEq(callbackToken.balanceOf(address(router)), 0);
        assertEq(token.balanceOf(address(router)), 0);
        assertEq(address(router).balance, 0);
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
