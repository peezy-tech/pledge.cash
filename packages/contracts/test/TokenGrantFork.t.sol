// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {TokenGrant} from "../src/TokenGrant.sol";
import {TokenGrantFactory} from "../src/TokenGrantFactory.sol";

interface IERC20ForkLike {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract TokenGrantForkTest is Test {
    address internal constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address internal constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address internal constant USDT = 0xdAC17F958D2ee523a2206206994597C13D831ec7;

    address internal issuer = address(0xA11CE);
    address internal holder = address(0xB0B);

    TokenGrantFactory internal factory;

    function setUp() public {
        if (_hasMainnetTokens()) {
            factory = new TokenGrantFactory();
        }
    }

    function testMainnetForkWethUsdcLifecycle() public {
        if (!_hasMainnetTokens()) return;

        TokenGrant grant = _createWethGrant(USDC, 2_000000, "weth-usdc");
        _fundAndSettle(grant, USDC, 1 ether);
    }

    function testMainnetForkWethUsdtNoReturnPaymentLifecycle() public {
        if (!_hasMainnetTokens()) return;

        TokenGrant grant = _createWethGrant(USDT, 2_000000, "weth-usdt");
        _fundAndSettle(grant, USDT, 1 ether);
    }

    function _createWethGrant(address paymentToken, uint256 price, string memory saltSeed)
        internal
        returns (TokenGrant grant)
    {
        uint256 grantSize = 10 ether;
        uint256 start = block.timestamp + 1;
        bytes32 salt = keccak256(bytes(saltSeed));
        address grantAddress = factory.predictGrantAddress(salt);

        deal(WETH, issuer, grantSize);
        _approve(WETH, issuer, grantAddress, grantSize);

        vm.prank(issuer);
        grant = TokenGrant(
            factory.createGrant(
                holder, WETH, paymentToken, grantSize, price, start + 30 days, start, start, false, 0, salt
            )
        );

        assertEq(address(grant), grantAddress);
        assertEq(IERC20ForkLike(WETH).balanceOf(address(grant)), grantSize);
        vm.warp(start);
    }

    function _fundAndSettle(TokenGrant grant, address paymentToken, uint256 settleAmount) internal {
        uint256 expectedCost = grant.getSettlementCost(settleAmount);

        deal(paymentToken, holder, expectedCost);
        _approve(paymentToken, holder, address(grant), expectedCost);

        vm.prank(holder);
        grant.settle(settleAmount);

        assertEq(IERC20ForkLike(paymentToken).balanceOf(issuer), expectedCost);
        assertEq(IERC20ForkLike(WETH).balanceOf(holder), settleAmount);
        assertEq(grant.settledAmount(), settleAmount);
    }

    function _approve(address token, address tokenOwner, address spender, uint256 amount) internal {
        vm.prank(tokenOwner);
        (bool success, bytes memory returnData) =
            token.call(abi.encodeWithSelector(IERC20ForkLike.approve.selector, spender, amount));

        assertTrue(success, "approve failed");
        if (returnData.length > 0) {
            assertTrue(abi.decode(returnData, (bool)), "approve returned false");
        }
    }

    function _hasMainnetTokens() internal view returns (bool) {
        return WETH.code.length > 0 && USDC.code.length > 0 && USDT.code.length > 0;
    }
}
