// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {TokenGrant} from "../../src/grants/TokenGrant.sol";
import {TokenGrantFactory} from "../../src/grants/TokenGrantFactory.sol";
import {GrantERC20, MutableFailureGrantERC20, TokenGrantTestBoardroomFactory} from "./TokenGrant.t.sol";

contract TokenGrantLifecycleBoardroom {
    address public immutable shareToken;

    constructor(address shareToken_) {
        shareToken = shareToken_;
    }

    function reserveRedeemableAsset(address) external {}
}

contract TokenGrantLifecycleBoundaryTest is Test {
    TokenGrantFactory internal factory;
    TokenGrantTestBoardroomFactory internal boardroomFactory;
    GrantERC20 internal token;

    address internal issuer;
    address internal holder = address(0xB0B);

    uint256 internal constant GRANT_SIZE = 100 ether;
    uint256 internal constant CLIFF = 1_000;
    uint256 internal constant VESTING_END = 2_000;
    uint256 internal constant EXPIRY = VESTING_END + 1 days;

    event ExpiredTokensWithdrawn(address indexed issuer, uint256 amount);

    function setUp() public {
        boardroomFactory = new TokenGrantTestBoardroomFactory();
        factory = new TokenGrantFactory(address(this), address(boardroomFactory));
        token = new GrantERC20("Grant Token", "GRANT", 18);
        issuer = address(new TokenGrantLifecycleBoardroom(address(token)));
        token.mint(issuer, GRANT_SIZE);
    }

    function testSettleableIsZeroAfterExpiryAndClose() public {
        TokenGrant grant = _createFreeGrant(keccak256("settleable-expiry"));

        vm.warp(VESTING_END);
        assertEq(grant.getSettleableAmount(block.timestamp), GRANT_SIZE);

        vm.warp(EXPIRY + 1);
        assertEq(grant.getSettleableAmount(block.timestamp), 0);

        vm.prank(issuer);
        grant.withdrawExpiredTokens();
        assertTrue(grant.isClosed());
        assertEq(grant.getSettleableAmount(block.timestamp), 0);
    }

    function testCanonicalBoardroomGrantExpiryIsBoundedWhileStandaloneGrantIsNot() public {
        uint256 maximum = block.timestamp + factory.MAX_BOARDROOM_GRANT_DURATION();
        uint256 longExpiry = maximum + 1;
        uint256 vestingEnd = block.timestamp + 1 days;
        _approve(address(token), issuer, GRANT_SIZE);
        boardroomFactory.setBoardroom(issuer, true);

        vm.prank(issuer);
        vm.expectRevert(
            abi.encodeWithSelector(TokenGrantFactory.BoardroomGrantExpiryTooFar.selector, longExpiry, maximum)
        );
        factory.createGrant(
            holder,
            address(token),
            address(0),
            GRANT_SIZE,
            0,
            longExpiry,
            block.timestamp,
            vestingEnd,
            false,
            0,
            keccak256("boardroom-long-expiry")
        );

        boardroomFactory.setBoardroom(issuer, false);
        vm.prank(issuer);
        address grant = factory.createGrant(
            holder,
            address(token),
            address(0),
            GRANT_SIZE,
            0,
            longExpiry,
            block.timestamp,
            vestingEnd,
            false,
            0,
            keccak256("standalone-long-expiry")
        );
        assertEq(TokenGrant(grant).expiry(), longExpiry);
    }

    function testExpiredBoardroomGrantCanQuarantineMutatedTokenAfterFailedRecovery() public {
        MutableFailureGrantERC20 mutableToken = new MutableFailureGrantERC20();
        mutableToken.mint(issuer, GRANT_SIZE);
        boardroomFactory.setBoardroom(issuer, true);

        uint256 cliff = block.timestamp;
        uint256 vestingEnd = block.timestamp + 10 days;
        uint256 expiry = vestingEnd + 1 days;
        _approve(address(mutableToken), issuer, GRANT_SIZE);
        vm.prank(issuer);
        TokenGrant grant = TokenGrant(
            factory.createGrant(
                holder,
                address(mutableToken),
                address(0),
                GRANT_SIZE,
                0,
                expiry,
                cliff,
                vestingEnd,
                false,
                0,
                keccak256("mutated-boardroom-grant")
            )
        );

        vm.warp(cliff + 5 days);
        uint256 settledBeforeMutation = 25 ether;
        vm.prank(holder);
        grant.settle(settledBeforeMutation);
        assertEq(grant.settledAmount(), settledBeforeMutation);
        assertEq(mutableToken.balanceOf(holder), settledBeforeMutation);

        mutableToken.setTransfersFail(true);
        vm.prank(issuer);
        vm.expectRevert();
        grant.stopVestingAndWithdrawUnvested();

        vm.prank(issuer);
        vm.expectRevert(TokenGrant.NotYetExpired.selector);
        grant.quarantineAndClose();

        vm.warp(expiry + 1);
        vm.prank(issuer);
        vm.expectRevert();
        grant.withdrawExpiredTokens();

        vm.prank(issuer);
        grant.quarantineAndClose();

        assertTrue(grant.isClosed());
        assertTrue(grant.isQuarantined());
        assertEq(grant.quarantinedAmount(), GRANT_SIZE - settledBeforeMutation);
        assertEq(mutableToken.balanceOf(address(grant)), GRANT_SIZE - settledBeforeMutation);
        uint256 tokenId = grant.tokenId();
        vm.expectRevert();
        factory.ownerOf(tokenId);
    }

    function testExpiredBoardroomGrantQuarantineCallRecoversHealthyToken() public {
        boardroomFactory.setBoardroom(issuer, true);
        TokenGrant grant = _createFreeGrant(keccak256("healthy-boardroom-quarantine-call"));

        vm.warp(EXPIRY + 1);
        vm.expectEmit(true, false, false, true, address(grant));
        emit ExpiredTokensWithdrawn(issuer, GRANT_SIZE);
        vm.prank(issuer);
        grant.quarantineAndClose();

        assertTrue(grant.isClosed());
        assertFalse(grant.isQuarantined());
        assertEq(grant.quarantinedAmount(), 0);
        assertEq(token.balanceOf(address(grant)), 0);
        assertEq(token.balanceOf(issuer), GRANT_SIZE);
    }

    function _createFreeGrant(bytes32 salt) internal returns (TokenGrant grant) {
        _approve(address(token), issuer, GRANT_SIZE);
        vm.prank(issuer);
        grant = TokenGrant(
            factory.createGrant(
                holder, address(token), address(0), GRANT_SIZE, 0, EXPIRY, CLIFF, VESTING_END, false, 0, salt
            )
        );
    }

    function _approve(address tokenAddress, address tokenOwner, uint256 amount) internal {
        vm.prank(tokenOwner);
        GrantERC20(tokenAddress).approve(address(factory), amount);
    }
}
