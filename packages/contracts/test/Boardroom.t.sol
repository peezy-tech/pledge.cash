// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "solady/auth/Ownable.sol";
import {Boardroom} from "../src/Boardroom.sol";
import {BoardroomFactory} from "../src/BoardroomFactory.sol";
import {BoardroomToken} from "../src/BoardroomToken.sol";
import {TokenGrant} from "../src/TokenGrant.sol";
import {TokenGrantFactory} from "../src/TokenGrantFactory.sol";

contract BoardroomCurrency {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) {
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract BoardroomTest is Test {
    TokenGrantFactory internal tokenGrantFactory;
    BoardroomFactory internal boardroomFactory;
    BoardroomCurrency internal paymentToken;

    address internal owner = address(0xA11CE);
    address internal holder = address(0xB0B);
    address internal stranger = address(0xCAFE);

    uint256 internal constant GRANT_SIZE = 100 ether;
    uint256 internal constant PRICE = 2_000000;
    uint256 internal constant CLIFF = 1_000;
    uint256 internal constant VESTING_END = 2_000;
    uint256 internal constant EXPIRY = 3_000;

    function setUp() public {
        tokenGrantFactory = new TokenGrantFactory();
        boardroomFactory = new BoardroomFactory(address(tokenGrantFactory));
        paymentToken = new BoardroomCurrency("Payment", "PAY", 6);

        paymentToken.mint(holder, 1_000_000000);
    }

    receive() external payable {}

    function testFactoryRejectsZeroTokenGrantFactory() public {
        vm.expectRevert(BoardroomFactory.InvalidAddress.selector);
        new BoardroomFactory(address(0));
    }

    function testCreateBoardroomInitializesCloneAndShareToken() public {
        (Boardroom boardroom, address boardroomAddress) = _createBoardroom("create");

        assertEq(address(boardroom), boardroomAddress);
        assertTrue(boardroomFactory.isBoardroom(boardroomAddress));
        assertEq(boardroomFactory.allBoardrooms(0), boardroomAddress);
        assertEq(boardroomFactory.allBoardroomsLength(), 1);
        assertEq(boardroom.owner(), owner);
        assertEq(boardroom.tokenGrantFactory(), address(tokenGrantFactory));

        BoardroomToken shareToken = BoardroomToken(boardroom.shareToken());
        assertEq(shareToken.boardroom(), boardroomAddress);
        assertEq(shareToken.name(), "Acme Common");
        assertEq(shareToken.symbol(), "ACME");
        assertEq(shareToken.decimals(), 18);
    }

    function testOnlyOwnerCanMintShares() public {
        (Boardroom boardroom,) = _createBoardroom("mint");

        vm.prank(stranger);
        vm.expectRevert(Ownable.Unauthorized.selector);
        boardroom.mint(holder, 1 ether);

        vm.prank(owner);
        boardroom.mint(holder, 1 ether);

        BoardroomToken shareToken = BoardroomToken(boardroom.shareToken());
        assertEq(shareToken.balanceOf(holder), 1 ether);
        assertEq(shareToken.totalSupply(), 1 ether);
    }

    function testOnlyBoardroomCanMintShareToken() public {
        (Boardroom boardroom,) = _createBoardroom("token-mint-auth");
        BoardroomToken shareToken = BoardroomToken(boardroom.shareToken());

        vm.expectRevert(BoardroomToken.OnlyBoardroom.selector);
        shareToken.mint(holder, 1 ether);
    }

    function testMintRejectsZeroAddressAndZeroAmount() public {
        (Boardroom boardroom,) = _createBoardroom("mint-invalid");

        vm.startPrank(owner);
        vm.expectRevert(Boardroom.InvalidAddress.selector);
        boardroom.mint(address(0), 1);

        vm.expectRevert(Boardroom.InvalidAmount.selector);
        boardroom.mint(holder, 0);
        vm.stopPrank();
    }

    function testOnlyOwnerCanCreateGrants() public {
        (Boardroom boardroom,) = _createBoardroom("create-grant-auth");

        vm.prank(stranger);
        vm.expectRevert(Ownable.Unauthorized.selector);
        boardroom.createGrant(
            holder, address(0), GRANT_SIZE, 0, EXPIRY, CLIFF, VESTING_END, false, 0, keccak256("auth-grant")
        );
    }

    function testCreateGrantRejectsZeroHolderAndZeroAmount() public {
        (Boardroom boardroom,) = _createBoardroom("invalid-grant");

        vm.startPrank(owner);
        vm.expectRevert(Boardroom.InvalidAddress.selector);
        boardroom.createGrant(
            address(0), address(0), GRANT_SIZE, 0, EXPIRY, CLIFF, VESTING_END, false, 0, keccak256("zero-holder")
        );

        vm.expectRevert(Boardroom.InvalidAmount.selector);
        boardroom.createGrant(holder, address(0), 0, 0, EXPIRY, CLIFF, VESTING_END, false, 0, keccak256("zero-amount"));
        vm.stopPrank();
    }

    function testBoardroomCanIssueFreeGrantForItsShares() public {
        (Boardroom boardroom,) = _createBoardroom("issue-free-grant");
        BoardroomToken shareToken = BoardroomToken(boardroom.shareToken());

        vm.prank(owner);
        boardroom.mint(address(boardroom), GRANT_SIZE);

        bytes32 grantSalt = keccak256("boardroom-free-grant");
        address grantAddress = tokenGrantFactory.predictGrantAddress(grantSalt);

        TokenGrant grant = _createBoardroomGrant(boardroom, address(0), 0, grantSalt, 0);

        assertEq(address(grant), grantAddress);
        assertEq(grant.issuer(), address(boardroom));
        assertEq(grant.holder(), holder);
        assertEq(grant.token(), address(shareToken));
        assertEq(grant.paymentToken(), address(0));
        assertEq(grant.price(), 0);
        assertEq(shareToken.balanceOf(address(boardroom)), 0);
        assertEq(shareToken.balanceOf(grantAddress), GRANT_SIZE);
        assertEq(shareToken.allowance(address(boardroom), grantAddress), 0);

        vm.warp(VESTING_END);
        vm.prank(holder);
        grant.settle(10 ether);

        assertEq(shareToken.balanceOf(holder), 10 ether);
    }

    function testBoardroomCanIssuePaidGrantForItsShares() public {
        (Boardroom boardroom,) = _createBoardroom("issue-paid-grant");
        BoardroomToken shareToken = BoardroomToken(boardroom.shareToken());

        vm.prank(owner);
        boardroom.mint(address(boardroom), GRANT_SIZE);

        bytes32 grantSalt = keccak256("boardroom-paid-grant");
        address grantAddress = tokenGrantFactory.predictGrantAddress(grantSalt);

        TokenGrant grant = _createBoardroomGrant(boardroom, address(paymentToken), PRICE, grantSalt, 0);

        uint256 expectedCost = grant.getSettlementCost(10 ether);
        vm.warp(VESTING_END);

        vm.prank(holder);
        paymentToken.approve(address(grant), expectedCost);

        vm.prank(holder);
        grant.settle(10 ether);

        assertEq(shareToken.balanceOf(holder), 10 ether);
        assertEq(shareToken.allowance(address(boardroom), grantAddress), 0);
        assertEq(paymentToken.balanceOf(address(boardroom)), expectedCost);
    }

    function testBoardroomForwardsGrantCreationFee() public {
        uint256 fee = 0.01 ether;
        tokenGrantFactory.setCreationFee(fee);

        (Boardroom boardroom,) = _createBoardroom("issue-fee-grant");

        vm.prank(owner);
        boardroom.mint(address(boardroom), GRANT_SIZE);

        bytes32 grantSalt = keccak256("boardroom-fee-grant");
        address grantAddress = tokenGrantFactory.predictGrantAddress(grantSalt);

        vm.deal(owner, fee);
        uint256 recipientBalanceBefore = address(this).balance;
        TokenGrant grant = _createBoardroomGrant(boardroom, address(0), 0, grantSalt, fee);

        assertEq(address(grant), grantAddress);
        assertEq(address(this).balance, recipientBalanceBefore + fee);
        assertEq(address(boardroom).balance, 0);
    }

    function _createBoardroom(string memory saltLabel)
        internal
        returns (Boardroom boardroom, address boardroomAddress)
    {
        bytes32 salt = keccak256(bytes(saltLabel));
        boardroomAddress = boardroomFactory.predictBoardroomAddress(salt);
        address created = boardroomFactory.createBoardroom(owner, "Acme Common", "ACME", salt);

        assertEq(created, boardroomAddress);
        boardroom = Boardroom(payable(boardroomAddress));
    }

    function _createBoardroomGrant(
        Boardroom boardroom,
        address grantPaymentToken,
        uint256 grantPrice,
        bytes32 grantSalt,
        uint256 value
    ) internal returns (TokenGrant grant) {
        vm.prank(owner);
        address grantAddress = boardroom.createGrant{value: value}(
            holder, grantPaymentToken, GRANT_SIZE, grantPrice, EXPIRY, CLIFF, VESTING_END, false, 0, grantSalt
        );

        grant = TokenGrant(grantAddress);
    }
}
