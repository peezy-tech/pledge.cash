// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

contract LockedVault is EIP712 {
    /*//////////////////////////////////////////////////////////////
                                 CONFIG
    //////////////////////////////////////////////////////////////*/

    address public immutable director;          // signs withdraw permits

    constructor(address _director)
        EIP712("LockedVault", "1")
    {   director = _director;   }

    /*//////////////////////////////////////////////////////////////
                               LEDGER
    //////////////////////////////////////////////////////////////*/

    mapping(IERC20 => mapping(address => uint256)) public balance;

    function deposit(IERC20 tok, uint256 amt) external {
        tok.transferFrom(msg.sender, address(this), amt);
        balance[tok][msg.sender] += amt;
    }

    /*//////////////////////////////////////////////////////////////
                           AUCTIONS  (unchanged)
    //////////////////////////////////////////////////////////////*/

    struct Auction {
        IERC20  sellTok;
        uint256 amount;                // lot (already transferred in)
        IERC20  stable;
        address auctioneer;
        bytes32 root;                  // Merkle of fills
        uint256 price;                 // uniform clearing px
        bool    settled;
    }

    uint256 public nextId = 1;
    mapping(uint256 => Auction) public auctions;
    uint256 public lastAuctionTime;     // ←  updated each settlement

    function createAuction(IERC20 sell, uint256 amt, IERC20 stable)
        external returns (uint256 id)
    {
        sell.transferFrom(msg.sender, address(this), amt);
        id = nextId++;
        auctions[id] = Auction({
            sellTok: sell,
            amount:  amt,
            stable:  stable,
            auctioneer: msg.sender,
            root:    bytes32(0),
            price:   0,
            settled: false
        });
    }

    bytes32 private constant ROOT_TYPEHASH =
        keccak256("Root(uint256 auctionId,bytes32 root,uint256 price)");

    function settle(
        uint256  id,
        bytes32  root,
        uint256  price,
        bytes    calldata auctioneerSig
    ) external
    {
        require(msg.sender == director, "only dir");
        Auction storage a = auctions[id];
        require(!a.settled, "already");

        /* ─ verify auctioneer approval ─ */
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(ROOT_TYPEHASH, id, root, price))
        );
        require(
            ECDSA.recover(digest, auctioneerSig) == a.auctioneer,
            "bad sig"
        );

        a.root   = root;
        a.price  = price;
        a.settled = true;

        lastAuctionTime = block.timestamp;      // *** key line ***
    }

    /*//////////////////////////////////////////////////////////////
                           CLAIM  (unchanged)
    //////////////////////////////////////////////////////////////*/

    mapping(uint256 => mapping(address => bool)) public claimed;

    function claim(
        uint256  id,
        uint256  fillAmt,
        uint256  payAmt,
        uint256  nonce,            // keeps leaf unique
        bytes32[] calldata proof
    ) external
    {
        Auction storage a = auctions[id];
        require(a.settled, "not settled");
        require(!claimed[id][msg.sender], "dup");

        bytes32 leaf = keccak256(abi.encode(msg.sender, fillAmt, payAmt, nonce));
        require(MerkleProof.verify(proof, a.root, leaf), "bad proof");

        balance[a.stable][msg.sender] -= payAmt;
        balance[a.sellTok][msg.sender] += fillAmt;

        claimed[id][msg.sender] = true;
    }

    /*//////////////////////////////////////////////////////////////
                        PERMIT-BASED WITHDRAW
    //////////////////////////////////////////////////////////////*/

    // EIP-712 struct:
    // Withdraw(address owner,address token,uint256 amount,
    //          uint256 nonce,uint256 validAfter)
    bytes32 private constant WITHDRAW_TYPEHASH =
        keccak256(
            "Withdraw(address owner,address token,uint256 amount,uint256 nonce,uint256 validAfter)"
        );

    mapping(address => uint256) public nonces;   // per owner

    function withdraw(
        IERC20   tok,
        uint256  amt,
        uint256  validAfter,      // must be > lastAuctionTime
        bytes    calldata dirSig
    ) external
    {
        require(validAfter > lastAuctionTime, "sig stale");

        uint256 nonce = nonces[msg.sender]++;
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    WITHDRAW_TYPEHASH,
                    msg.sender,
                    address(tok),
                    amt,
                    nonce,
                    validAfter
                )
            )
        );
        require(ECDSA.recover(digest, dirSig) == director, "bad sig");

        balance[tok][msg.sender] -= amt;
        tok.transfer(msg.sender, amt);
    }

    /*//////////////////////////////////////////////////////////////
                          VIEW HELPERS (loops allowed)
    //////////////////////////////////////////////////////////////*/

    function previewWithdraw(address user, IERC20 tok)
        external view returns (uint256)
    {   return balance[tok][user];   }

    /*//////////////////////////////////////////////////////////////
                          EIP-712 DIGEST HELPERS
    //////////////////////////////////////////////////////////////*/

    function getWithdrawPermitDigest(
        address owner,
        IERC20 token,
        uint256 amount,
        uint256 nonce,
        uint256 validAfter
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                WITHDRAW_TYPEHASH,
                owner,
                address(token),
                amount,
                nonce,
                validAfter
            )
        );
        return _hashTypedDataV4(structHash);
    }

    function getAuctionSettlementDigest(
        uint256 auctionId,
        bytes32 root,
        uint256 price
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(ROOT_TYPEHASH, auctionId, root, price));
        return _hashTypedDataV4(structHash);
    }
}
