// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "forge-std/Test.sol";
import "../src/backed.sol";
import {MockERC20} from "solady/../test/utils/mocks/MockERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

contract WrappedDN404Test is Test {
    WrappedDN404 public wrappedToken;
    MockERC20 public underlying;

    address public owner = address(this);
    address public alice = address(0x1);
    address public bob = address(0x2);

    uint256 public BASE_UNIT;

    event Deposit(address indexed from, uint256 amount);
    event Withdraw(address indexed to, uint256 amount);

    function setUp() public {
        // Deploy mock underlying token
        underlying = new MockERC20("Underlying", "UNDL", 18);

        // Deploy wrapped token
        wrappedToken = new WrappedDN404(
            "Wrapped Token",
            "WRAP",
            address(underlying)
        );

        BASE_UNIT = wrappedToken.price();

        // Give alice and bob some underlying tokens
        underlying.mint(alice, 10 * BASE_UNIT);
        underlying.mint(bob, 10 * BASE_UNIT);

        // Approve wrapped token contract for alice and bob
        vm.prank(alice);
        underlying.approve(address(wrappedToken), type(uint256).max);
        vm.prank(bob);
        underlying.approve(address(wrappedToken), type(uint256).max);
    }

    function test_initial_state() public {
        assertEq(wrappedToken.name(), "Wrapped Token");
        assertEq(wrappedToken.symbol(), "WRAP");
        assertEq(address(wrappedToken.underlying()), address(underlying));
        assertEq(wrappedToken.owner(), address(this));
        assertTrue(wrappedToken.mirrorERC721() != address(0));
    }

    function test_mint() public {
        uint256 amount = 1 * BASE_UNIT;

        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit Deposit(alice, amount);
        wrappedToken.mint(amount);

        assertEq(wrappedToken.balanceOf(alice), amount);
        assertEq(underlying.balanceOf(address(wrappedToken)), amount);
        assertEq(underlying.balanceOf(alice), 9 * BASE_UNIT);
    }

    function test_burn() public {
        uint256 amount = 1 * BASE_UNIT;

        // First mint some tokens
        vm.prank(alice);
        wrappedToken.mint(amount);

        // Then burn them
        wrappedToken.burn(alice, amount);

        assertEq(wrappedToken.balanceOf(alice), 0);
        assertEq(underlying.balanceOf(address(wrappedToken)), 0);
        assertEq(underlying.balanceOf(owner), amount);
    }

    function test_does_not_mint_on_minting_base_unit() public {
        uint256 amount = 1 * BASE_UNIT;

        // Mint exactly one base unit
        vm.prank(alice);
        wrappedToken.mint(amount);

        // Check NFT was minted
        address erc721 = wrappedToken.mirrorERC721();
        IERC721 nft = IERC721(erc721);
        // assertEq(, alice);
        vm.expectRevert();
        nft.ownerOf(0);

        assertEq(nft.balanceOf(alice), 0);
    }

    function test_fail_burn_unauthorized() public {
        uint256 amount = 1 * BASE_UNIT;

        // Mint some tokens to alice
        vm.prank(alice);
        wrappedToken.mint(amount);

        // Try to burn as bob (should fail)
        vm.startPrank(bob);
        vm.expectRevert();
        wrappedToken.burn(bob, amount);
        vm.stopPrank();
    }

    // function test_withdraw_underlying() public {
    //     uint256 amount = 1 * BASE_UNIT;

    //     // Mint some tokens
    //     vm.prank(alice);
    //     wrappedToken.mint(amount);

    //     // Send extra underlying tokens to contract
    //     underlying.mint(address(wrappedToken), amount);
    //     wrappedToken.withdrawUnderlying();

    //     assertEq(underlying.balanceOf(owner), 2 * amount);
    //     assertEq(underlying.balanceOf(address(wrappedToken)), 0);
    // }

    function test_partial_base_unit_transfer() public {
        uint256 amount = 1 * BASE_UNIT;

        // Mint one base unit to alice
        vm.prank(alice);
        wrappedToken.mint(amount);

        address erc721 = wrappedToken.mirrorERC721();
        IERC721 nft = IERC721(erc721);
        vm.prank(owner);
        wrappedToken.mintNft(alice, 1);
        assertEq(nft.ownerOf(1), alice);

        // Transfer half to bob
        vm.prank(alice);
        wrappedToken.transfer(bob, amount / 2);

        // Check balances
        assertEq(wrappedToken.balanceOf(alice), amount / 2);
        assertEq(wrappedToken.balanceOf(bob), amount / 2);

        vm.expectRevert(); // NFT does not exist anymore
        nft.ownerOf(1);
    }

    function test_complete_base_unit_transfer() public {
        uint256 amount = 1 * BASE_UNIT;

        // Mint one base unit to alice
        vm.prank(alice);
        wrappedToken.mint(amount);

        address erc721 = wrappedToken.mirrorERC721();
        IERC721 nft = IERC721(erc721);
        vm.prank(owner);
        wrappedToken.mintNft(alice, 1);
        console.log("nft balacne of alice", nft.balanceOf(alice));
        assertEq(nft.ownerOf(1), alice);

        // Transfer all to bob
        vm.prank(alice);
        wrappedToken.transfer(bob, amount);

        // Check balances
        assertEq(wrappedToken.balanceOf(alice), 0);
        assertEq(wrappedToken.balanceOf(bob), amount);

        vm.prank(owner);
        wrappedToken.mintNft(bob, 1);

        // NFT should transfer to bob
        // console.log('nft id owner', 0, nft.ownerOf(0));
        console.log("nft balacne of alice", nft.balanceOf(alice));
        console.log("nft balacne of bob", nft.balanceOf(bob));
        console.log("nft id owner", 1, nft.ownerOf(1)); // id was reused? or just transfer? test this case
        assertEq(nft.ownerOf(1), bob);
    }
}
