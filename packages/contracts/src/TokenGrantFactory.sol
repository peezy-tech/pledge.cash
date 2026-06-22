// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "solady/auth/Ownable.sol";
import {ERC721} from "solady/tokens/ERC721.sol";
import {LibClone} from "solady/utils/LibClone.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {TokenGrant} from "./TokenGrant.sol";

contract TokenGrantFactory is Ownable, ERC721 {
    address public immutable tokenGrantLogic;
    uint256 public creationFee;

    mapping(uint256 => address) public grantForTokenId;
    mapping(address => uint256) public tokenIdForGrant;
    mapping(uint256 => bool) public grantTransferable;
    mapping(uint256 => uint256) public grantTransferUnlockTime;
    mapping(uint256 => address) public lastHolderOf;
    mapping(uint256 => bool) public isGrantClosed;
    mapping(uint256 => bool) public grantIsLocked;

    error UnknownGrantToken(uint256 tokenId);
    error OnlyLinkedGrant(address caller);
    error GrantAlreadyClosed(uint256 tokenId);
    error NonTransferableGrant(uint256 tokenId);
    error GrantTokenLocked(uint256 tokenId);
    error GrantTokenExpired(uint256 tokenId);
    error GrantTransferNotUnlocked(uint256 tokenId, uint256 unlockTime);
    error InvalidCreationFeePayment(uint256 expected, uint256 actual);

    event TokenGrantCreated(
        address indexed grantAddress,
        address indexed issuer,
        address indexed holder,
        uint256 tokenId,
        bool transferable,
        uint256 transferUnlockTime,
        address token,
        address paymentToken,
        uint256 amount,
        uint256 price,
        uint256 expiry,
        uint256 vestingCliff,
        uint256 vestingEnd,
        bytes32 salt
    );
    event GrantClosed(address indexed grantAddress, uint256 indexed tokenId, address indexed lastHolder);
    event CreationFeeSet(uint256 amount);
    event CreationFeePaid(address indexed payer, address indexed recipient, uint256 amount);

    constructor() {
        _initializeOwner(msg.sender);
        tokenGrantLogic = address(new TokenGrant());
    }

    function name() public pure override returns (string memory) {
        return "Token Grant";
    }

    function symbol() public pure override returns (string memory) {
        return "TGRANT";
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        ownerOf(id);
        return "";
    }

    function setCreationFee(uint256 amount) external onlyOwner {
        creationFee = amount;
        emit CreationFeeSet(amount);
    }

    function createGrant(
        address holder,
        address token,
        address paymentToken,
        uint256 amount,
        uint256 price,
        uint256 expiry,
        uint256 vestingCliff,
        uint256 vestingEnd,
        bool transferable,
        uint256 transferUnlockTime,
        bytes32 salt
    ) external payable returns (address grant) {
        if (msg.value != creationFee) revert InvalidCreationFeePayment(creationFee, msg.value);

        grant = LibClone.cloneDeterministic(tokenGrantLogic, salt);
        uint256 tokenId = uint256(uint160(grant));

        grantForTokenId[tokenId] = grant;
        tokenIdForGrant[grant] = tokenId;
        grantTransferable[tokenId] = transferable;
        grantTransferUnlockTime[tokenId] = transferUnlockTime;

        _initializeGrant(grant, holder, token, paymentToken, amount, price, expiry, vestingCliff, vestingEnd);
        _payCreationFee();
        _mint(holder, tokenId);
        _emitTokenGrantCreated(grant, tokenId, transferable, transferUnlockTime, salt);
    }

    function predictGrantAddress(bytes32 salt) external view returns (address) {
        return LibClone.predictDeterministicAddress(tokenGrantLogic, salt, address(this));
    }

    function lockGrant(uint256 tokenId) external onlyLinkedGrant(tokenId) {
        if (isGrantClosed[tokenId]) revert GrantAlreadyClosed(tokenId);
        grantIsLocked[tokenId] = true;
    }

    function unlockGrant(uint256 tokenId) external onlyLinkedGrant(tokenId) {
        if (isGrantClosed[tokenId]) revert GrantAlreadyClosed(tokenId);
        grantIsLocked[tokenId] = false;
    }

    function closeGrant(uint256 tokenId) external onlyLinkedGrant(tokenId) {
        if (isGrantClosed[tokenId]) revert GrantAlreadyClosed(tokenId);

        address holder = ownerOf(tokenId);
        address grant = grantForTokenId[tokenId];
        lastHolderOf[tokenId] = holder;
        isGrantClosed[tokenId] = true;
        grantIsLocked[tokenId] = false;

        _burn(tokenId);
        emit GrantClosed(grant, tokenId, holder);
    }

    function approve(address account, uint256 id) public payable override {
        _requireTransferable(id);
        super.approve(account, id);
    }

    function _beforeTokenTransfer(address from, address to, uint256 id) internal view override {
        if (from == address(0) || to == address(0)) return;

        address grant = grantForTokenId[id];
        if (grant == address(0)) revert UnknownGrantToken(id);
        if (grantIsLocked[id]) revert GrantTokenLocked(id);
        _requireTransferable(id);
        if (TokenGrant(grant).isExpired(block.timestamp)) revert GrantTokenExpired(id);
    }

    modifier onlyLinkedGrant(uint256 tokenId) {
        if (grantForTokenId[tokenId] != msg.sender) revert OnlyLinkedGrant(msg.sender);
        _;
    }

    function _requireTransferable(uint256 tokenId) internal view {
        if (!grantTransferable[tokenId]) revert NonTransferableGrant(tokenId);

        uint256 unlockTime = grantTransferUnlockTime[tokenId];
        if (block.timestamp < unlockTime) revert GrantTransferNotUnlocked(tokenId, unlockTime);
    }

    function _initializeGrant(
        address grant,
        address holder,
        address token,
        address paymentToken,
        uint256 amount,
        uint256 price,
        uint256 expiry,
        uint256 vestingCliff,
        uint256 vestingEnd
    ) internal {
        TokenGrant(grant).initialize(
            msg.sender, holder, token, paymentToken, amount, price, expiry, vestingCliff, vestingEnd
        );
    }

    function _emitTokenGrantCreated(
        address grant,
        uint256 tokenId,
        bool transferable,
        uint256 transferUnlockTime,
        bytes32 salt
    ) internal {
        TokenGrant tokenGrant = TokenGrant(grant);
        emit TokenGrantCreated(
            grant,
            tokenGrant.issuer(),
            ownerOf(tokenId),
            tokenId,
            transferable,
            transferUnlockTime,
            tokenGrant.token(),
            tokenGrant.paymentToken(),
            tokenGrant.grantSize(),
            tokenGrant.price(),
            tokenGrant.expiry(),
            tokenGrant.vestingCliff(),
            tokenGrant.vestingEnd(),
            salt
        );
    }

    function _payCreationFee() internal {
        uint256 fee = creationFee;
        if (fee == 0) return;

        address recipient = owner();
        SafeTransferLib.safeTransferETH(recipient, fee);
        emit CreationFeePaid(msg.sender, recipient, fee);
    }
}
