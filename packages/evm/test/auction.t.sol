// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/auction.sol"; // LockedVault contract
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
// ECDSA, EIP712, MerkleProof are used by LockedVault, not directly by test helpers anymore for hashing
// import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
// import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol"; // Still needed for MerkleProof.verify in claim tests

// Mock ERC20 token for testing
contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) public {
        _burn(from, amount);
    }
}

contract LockedVaultTest is
    Test // Removed EIP712 inheritance
{
    LockedVault vault;
    MockERC20 sellToken; // e.g., WETH
    MockERC20 stableToken; // e.g., USDC

    // Users
    address deployer; // Address that deploys the test contract
    address director;
    address auctioneer;
    address alice; // Bidder / User
    address bob; // Another User

    // Private keys for signing (these are standard Foundry test keys)
    uint256 directorPrivateKey =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 auctioneerPrivateKey =
        0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;

    // TYPEHASH constants are no longer needed here as digest calculation is delegated to LockedVault
    // bytes32 private constant WITHDRAW_TYPEHASH = ...
    // bytes32 private constant ROOT_TYPEHASH = ...

    // Removed EIP712 constructor
    // constructor() EIP712("LockedVault", "1") {}

    function setUp() public {
        deployer = msg.sender;

        director = vm.addr(directorPrivateKey);
        auctioneer = vm.addr(auctioneerPrivateKey);
        alice = address(0x3);
        bob = address(0x4);

        vm.label(director, "Director");
        vm.label(auctioneer, "Auctioneer");
        vm.label(alice, "Alice");
        vm.label(bob, "Bob");

        vault = new LockedVault(director);
        vm.label(address(vault), "LockedVault");

        sellToken = new MockERC20("Sell Token", "SELL");
        stableToken = new MockERC20("Stable Token", "STBL");
        vm.label(address(sellToken), "SELL_Token");
        vm.label(address(stableToken), "STABLE_Token");

        sellToken.mint(auctioneer, 1000 ether);
        stableToken.mint(alice, 10000 ether);
        stableToken.mint(bob, 5000 ether);
    }

    /*//////////////////////////////////////////////////////////////
                                 HELPER FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function _signWithdrawPermit(
        address owner,
        IERC20 token,
        uint256 amount,
        uint256 nonce,
        uint256 validAfter
    ) internal view returns (bytes memory) {
        bytes32 digest = vault.getWithdrawPermitDigest(
            owner,
            token,
            amount,
            nonce,
            validAfter
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(directorPrivateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signAuctioneerSettlement(
        uint256 auctionId,
        bytes32 root,
        uint256 price
    ) internal view returns (bytes memory) {
        bytes32 digest = vault.getAuctionSettlementDigest(
            auctionId,
            root,
            price
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(auctioneerPrivateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    /*//////////////////////////////////////////////////////////////
                                 TESTS
    //////////////////////////////////////////////////////////////*/

    function test_Constructor() public view {
        // Changed to view
        assertEq(vault.director(), director, "Director not set correctly");
        // Removed unused domainSeparator variable and check for EIP712 in test context
    }

    function test_Deposit() public {
        uint256 depositAmount = 100 ether;
        vm.startPrank(alice);
        stableToken.approve(address(vault), depositAmount);
        vault.deposit(stableToken, depositAmount);
        vm.stopPrank();

        assertEq(
            stableToken.balanceOf(address(vault)),
            depositAmount,
            "Vault stablecoin balance incorrect"
        );
        assertEq(
            vault.balance(stableToken, alice),
            depositAmount,
            "Alice's vault balance incorrect"
        );
    }

    function test_Revert_Deposit_InsufficientAllowance() public {
        uint256 depositAmount = 100 ether;
        vm.startPrank(alice);
        vm.expectRevert();
        vault.deposit(stableToken, depositAmount);
        vm.stopPrank();
    }

    function test_CreateAuction() public {
        uint256 auctionAmount = 50 ether;
        vm.startPrank(auctioneer);
        sellToken.approve(address(vault), auctionAmount);
        uint256 auctionId = vault.createAuction(
            sellToken,
            auctionAmount,
            stableToken
        );
        vm.stopPrank();

        assertEq(auctionId, 1, "First auction ID should be 1");
        assertEq(
            sellToken.balanceOf(address(vault)),
            auctionAmount,
            "Vault sellToken balance incorrect after auction creation"
        );

        // Using commas for unused destructured variables r and p
        (
            IERC20 sTok,
            uint256 amt,
            IERC20 stbl,
            address auc /*bytes32 r*/ /*uint256 p*/,
            ,
            ,
            bool settld
        ) = vault.auctions(auctionId);
        assertEq(address(sTok), address(sellToken));
        assertEq(amt, auctionAmount);
        assertEq(address(stbl), address(stableToken));
        assertEq(auc, auctioneer);
        assertFalse(settld);
    }

    function test_SettleAuction() public {
        // 1. Create auction
        uint256 auctionAmount = 50 ether;
        vm.startPrank(auctioneer);
        sellToken.approve(address(vault), auctionAmount);
        uint256 auctionId = vault.createAuction(
            sellToken,
            auctionAmount,
            stableToken
        );
        vm.stopPrank();

        // 2. Prepare settlement data
        bytes32 testRoot = keccak256(abi.encodePacked("merkleRoot"));
        uint256 clearingPrice = 2 ether;
        bytes memory auctioneerSig = _signAuctioneerSettlement(
            auctionId,
            testRoot,
            clearingPrice
        );

        // 3. Settle auction (as director)
        uint256 timeBeforeSettle = block.timestamp;
        vm.warp(timeBeforeSettle + 1 days);

        vm.startPrank(director);
        vault.settle(auctionId, testRoot, clearingPrice, auctioneerSig);
        vm.stopPrank();

        (
            ,
            ,
            ,
            ,
            bytes32 fetchedRoot,
            uint256 fetchedPrice,
            bool isSettled
        ) = vault.auctions(auctionId);
        assertTrue(isSettled, "Auction not settled");
        assertEq(fetchedRoot, testRoot, "Auction root incorrect");
        assertEq(fetchedPrice, clearingPrice, "Auction price incorrect");
        assertTrue(
            vault.lastAuctionTime() >= timeBeforeSettle + 1 days,
            "lastAuctionTime not updated correctly"
        );
    }

    function test_Revert_Settle_NotDirector() public {
        uint256 auctionId = 1;
        bytes32 testRoot = keccak256(abi.encodePacked("merkleRoot"));
        uint256 clearingPrice = 2 ether;
        // Create dummy auction for this revert test to proceed past auction existence checks if any are added later
        vm.startPrank(auctioneer);
        sellToken.approve(address(vault), 1 ether);
        auctionId = vault.createAuction(sellToken, 1 ether, stableToken);
        vm.stopPrank();

        bytes memory auctioneerSig = _signAuctioneerSettlement(
            auctionId,
            testRoot,
            clearingPrice
        );

        vm.startPrank(alice);
        vm.expectRevert("only dir");
        vault.settle(auctionId, testRoot, clearingPrice, auctioneerSig);
        vm.stopPrank();
    }

    function test_Revert_Settle_BadAuctioneerSignature() public {
        uint256 auctionAmount = 50 ether;
        vm.startPrank(auctioneer);
        sellToken.approve(address(vault), auctionAmount);
        uint256 auctionId = vault.createAuction(
            sellToken,
            auctionAmount,
            stableToken
        );
        vm.stopPrank();

        bytes32 testRoot = keccak256(abi.encodePacked("merkleRoot"));
        uint256 clearingPrice = 2 ether;
        bytes memory badSig = _signAuctioneerSettlement(
            auctionId + 1,
            testRoot,
            clearingPrice
        );

        vm.startPrank(director);
        vm.expectRevert("bad sig");
        vault.settle(auctionId, testRoot, clearingPrice, badSig);
        vm.stopPrank();
    }

    function test_Revert_Settle_AlreadySettled() public {
        uint256 auctionAmount = 50 ether;
        vm.startPrank(auctioneer);
        sellToken.approve(address(vault), auctionAmount);
        uint256 auctionId = vault.createAuction(
            sellToken,
            auctionAmount,
            stableToken
        );
        vm.stopPrank();

        bytes32 testRoot = keccak256(abi.encodePacked("merkleRoot"));
        uint256 clearingPrice = 2 ether;
        bytes memory auctioneerSig = _signAuctioneerSettlement(
            auctionId,
            testRoot,
            clearingPrice
        );

        vm.startPrank(director);
        vault.settle(auctionId, testRoot, clearingPrice, auctioneerSig);
        vm.expectRevert("already");
        vault.settle(auctionId, testRoot, clearingPrice, auctioneerSig);
        vm.stopPrank();
    }

    function test_Claim() public {
        uint256 aliceDeposit = 200 ether;
        vm.startPrank(alice);
        stableToken.approve(address(vault), aliceDeposit);
        vault.deposit(stableToken, aliceDeposit);
        vm.stopPrank();
        assertEq(vault.balance(stableToken, alice), aliceDeposit);

        uint256 auctionAmount = 50 ether;
        vm.startPrank(auctioneer);
        sellToken.approve(address(vault), auctionAmount);
        uint256 auctionId = vault.createAuction(
            sellToken,
            auctionAmount,
            stableToken
        );
        vm.stopPrank();

        uint256 aliceFillAmount = 10 ether;
        uint256 alicePayAmount = 20 ether;
        uint256 claimNonce = 123;
        bytes32 leaf = keccak256(
            abi.encode(alice, aliceFillAmount, alicePayAmount, claimNonce)
        );

        bytes32 merkleRoot = leaf;
        bytes32[] memory proof = new bytes32[](0);

        uint256 clearingPrice = alicePayAmount / aliceFillAmount;

        bytes memory auctioneerSig = _signAuctioneerSettlement(
            auctionId,
            merkleRoot,
            clearingPrice
        );

        vm.warp(block.timestamp + 1 hours);
        vm.startPrank(director);
        vault.settle(auctionId, merkleRoot, clearingPrice, auctioneerSig);
        vm.stopPrank();

        uint256 aliceStableBalanceBefore = vault.balance(stableToken, alice);
        uint256 aliceSellBalanceBefore = vault.balance(sellToken, alice);

        vm.startPrank(alice);
        vault.claim(
            auctionId,
            aliceFillAmount,
            alicePayAmount,
            claimNonce,
            proof
        );
        vm.stopPrank();

        assertTrue(vault.claimed(auctionId, alice), "Alice's claim not marked");
        assertEq(
            vault.balance(stableToken, alice),
            aliceStableBalanceBefore - alicePayAmount,
            "Alice stable balance after claim incorrect"
        );
        assertEq(
            vault.balance(sellToken, alice),
            aliceSellBalanceBefore + aliceFillAmount,
            "Alice sell token balance after claim incorrect"
        );
    }

    function test_Revert_Claim_NotSettled() public {
        uint256 auctionAmount = 50 ether;
        vm.startPrank(auctioneer);
        sellToken.approve(address(vault), auctionAmount);
        uint256 auctionId = vault.createAuction(
            sellToken,
            auctionAmount,
            stableToken
        );
        vm.stopPrank();

        bytes32[] memory proof = new bytes32[](0);
        vm.startPrank(alice);
        vm.expectRevert("not settled");
        vault.claim(auctionId, 10 ether, 20 ether, 123, proof);
        vm.stopPrank();
    }

    function test_Revert_Claim_BadProof() public {
        vm.startPrank(alice);
        stableToken.approve(address(vault), 200 ether);
        vault.deposit(stableToken, 200 ether);
        vm.stopPrank();

        vm.startPrank(auctioneer);
        sellToken.approve(address(vault), 50 ether);
        uint256 auctionId = vault.createAuction(
            sellToken,
            50 ether,
            stableToken
        );
        vm.stopPrank();

        bytes32 actualLeaf = keccak256(
            abi.encode(alice, 10 ether, 20 ether, 123)
        );
        bytes32 merkleRoot = actualLeaf;
        bytes memory auctioneerSig = _signAuctioneerSettlement(
            auctionId,
            merkleRoot,
            2 ether
        );

        vm.startPrank(director);
        vault.settle(auctionId, merkleRoot, 2 ether, auctioneerSig);
        vm.stopPrank();

        // Removed unused differentLeaf and proof variables
        bytes32[] memory badProof = new bytes32[](1);
        badProof[0] = keccak256(
            abi.encodePacked("some other hash for bad proof")
        );

        vm.startPrank(alice);
        vm.expectRevert("bad proof");
        vault.claim(auctionId, 10 ether, 20 ether, 123, badProof);
        vm.stopPrank();
    }

    function test_Withdraw() public {
        uint256 depositAmount = 100 ether;
        vm.startPrank(alice);
        stableToken.approve(address(vault), depositAmount);
        vault.deposit(stableToken, depositAmount);
        vm.stopPrank();

        vm.startPrank(auctioneer);
        sellToken.approve(address(vault), 1 ether);
        uint256 auctionId = vault.createAuction(
            sellToken,
            1 ether,
            stableToken
        );
        vm.stopPrank();

        bytes32 dummyRoot = keccak256(abi.encodePacked("root"));
        bytes memory sigAuctioneer = _signAuctioneerSettlement(
            auctionId,
            dummyRoot,
            1 ether
        );

        vm.warp(block.timestamp + 100);
        vm.startPrank(director);
        vault.settle(auctionId, dummyRoot, 1 ether, sigAuctioneer);
        vm.stopPrank();

        uint256 lastAuctionTime = vault.lastAuctionTime();
        assertTrue(lastAuctionTime > 0, "lastAuctionTime should be set");

        uint256 withdrawAmount = 30 ether;
        uint256 nonce = vault.nonces(alice);
        uint256 validAfter = lastAuctionTime + 1;

        bytes memory directorSig = _signWithdrawPermit(
            alice,
            stableToken,
            withdrawAmount,
            nonce,
            validAfter
        );

        uint256 aliceTokenBalanceBefore = stableToken.balanceOf(alice);
        uint256 vaultAliceBalanceBefore = vault.balance(stableToken, alice);

        vm.startPrank(alice);
        vault.withdraw(stableToken, withdrawAmount, validAfter, directorSig);
        vm.stopPrank();

        assertEq(vault.nonces(alice), nonce + 1, "Nonce not incremented");
        assertEq(
            stableToken.balanceOf(alice),
            aliceTokenBalanceBefore + withdrawAmount,
            "Alice's external balance incorrect"
        );
        assertEq(
            vault.balance(stableToken, alice),
            vaultAliceBalanceBefore - withdrawAmount,
            "Alice's vault balance incorrect"
        );
    }

    function test_Revert_Withdraw_StaleSignature() public {
        vm.startPrank(alice);
        stableToken.approve(address(vault), 100 ether);
        vault.deposit(stableToken, 100 ether);
        vm.stopPrank();

        vm.startPrank(auctioneer);
        sellToken.approve(address(vault), 1 ether);
        uint256 auctionId = vault.createAuction(
            sellToken,
            1 ether,
            stableToken
        );
        vm.stopPrank();

        bytes32 dummyRoot = keccak256(abi.encodePacked("root"));
        bytes memory sigAuctioneer = _signAuctioneerSettlement(
            auctionId,
            dummyRoot,
            1 ether
        );

        vm.warp(block.timestamp + 100);
        vm.startPrank(director);
        vault.settle(auctionId, dummyRoot, 1 ether, sigAuctioneer);
        vm.stopPrank();

        uint256 lastAuctionTime = vault.lastAuctionTime();

        uint256 withdrawAmount = 30 ether;
        uint256 nonce = vault.nonces(alice);
        uint256 staleValidAfter = lastAuctionTime;

        bytes memory directorSig = _signWithdrawPermit(
            alice,
            stableToken,
            withdrawAmount,
            nonce,
            staleValidAfter
        );

        vm.startPrank(alice);
        vm.expectRevert("sig stale");
        vault.withdraw(
            stableToken,
            withdrawAmount,
            staleValidAfter,
            directorSig
        );
        vm.stopPrank();
    }

    function test_Revert_Withdraw_BadDirectorSignature() public {
        vm.startPrank(alice);
        stableToken.approve(address(vault), 100 ether);
        vault.deposit(stableToken, 100 ether);
        vm.stopPrank();

        vm.startPrank(auctioneer);
        sellToken.approve(address(vault), 1 ether);
        uint256 auctionId = vault.createAuction(
            sellToken,
            1 ether,
            stableToken
        );
        vm.stopPrank();
        bytes32 r = keccak256(abi.encodePacked("r"));
        uint256 p = 1 ether;
        bytes memory sA = _signAuctioneerSettlement(auctionId, r, p);
        vm.startPrank(director);
        vault.settle(auctionId, r, p, sA);
        vm.stopPrank();

        uint256 lastAucTime = vault.lastAuctionTime();
        uint256 withdrawAmount = 30 ether;
        uint256 nonce = vault.nonces(alice);
        uint256 validAfter = lastAucTime + 1;

        bytes32 digest = vault.getWithdrawPermitDigest(
            alice,
            stableToken,
            withdrawAmount,
            nonce,
            validAfter
        );
        (uint8 v, bytes32 rSig, bytes32 sSig) = vm.sign(
            auctioneerPrivateKey,
            digest
        ); // Signed by wrong key (auctioneer)
        bytes memory badDirSig = abi.encodePacked(rSig, sSig, v);

        vm.startPrank(alice);
        vm.expectRevert("bad sig");
        vault.withdraw(stableToken, withdrawAmount, validAfter, badDirSig);
        vm.stopPrank();
    }

    function test_PreviewWithdraw() public {
        uint256 depositAmount = 77 ether;
        vm.startPrank(bob);
        stableToken.approve(address(vault), depositAmount);
        vault.deposit(stableToken, depositAmount);
        vm.stopPrank();

        assertEq(
            vault.previewWithdraw(bob, stableToken),
            depositAmount,
            "Preview amount incorrect"
        );
    }
}
