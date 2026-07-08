// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "solady/auth/Ownable.sol";
import {ERC721} from "solady/tokens/ERC721.sol";
import {Base64} from "solady/utils/Base64.sol";
import {LibClone} from "solady/utils/LibClone.sol";
import {LibString} from "solady/utils/LibString.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {TokenGrant} from "./TokenGrant.sol";
import {ExactTransferLib} from "../lib/ExactTransferLib.sol";
import {IBoardroomCallPolicy} from "../policy/IBoardroomCallPolicy.sol";

contract TokenGrantFactory is Ownable, ERC721, IBoardroomCallPolicy {
    address public immutable tokenGrantLogic;
    uint256 public creationFee;

    mapping(uint256 => address) public grantForTokenId;

    error UnknownGrantToken(uint256 tokenId);
    error OnlyLinkedGrant(address caller);
    error GrantStillOpen(uint256 tokenId);
    error InvalidOwner();
    error InvalidCreationFeePayment(uint256 expected, uint256 actual);
    error UnexpectedTokenBalanceChange(address token, uint256 expected, uint256 actual);

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

    constructor(address owner_) {
        if (owner_ == address(0)) revert InvalidOwner();
        _initializeOwner(owner_);
        tokenGrantLogic = address(new TokenGrant());
    }

    function name() public pure override returns (string memory) {
        return "Token Grant";
    }

    function symbol() public pure override returns (string memory) {
        return "TGRANT";
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        address holder = ownerOf(id);
        address grant = grantForTokenId[id];
        if (grant == address(0)) revert UnknownGrantToken(id);

        string memory json = string.concat(
            _metadataIdentity(id, grant, holder),
            _metadataEconomics(grant),
            _metadataSchedule(grant),
            _metadataStatus(grant)
        );

        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
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
        if (msg.value != creationFee) {
            revert InvalidCreationFeePayment(creationFee, msg.value);
        }

        grant = LibClone.cloneDeterministic(tokenGrantLogic, _deploymentSalt(msg.sender, salt));
        uint256 tokenId = uint256(uint160(grant));

        grantForTokenId[tokenId] = grant;

        _initializeGrant(
            grant,
            holder,
            token,
            paymentToken,
            amount,
            price,
            expiry,
            vestingCliff,
            vestingEnd,
            transferable,
            transferUnlockTime
        );
        _checkedTransferFrom(token, msg.sender, grant, amount);
        _payCreationFee();
        _mint(holder, tokenId);
        _emitTokenGrantCreated(grant, tokenId, transferable, transferUnlockTime, salt);
    }

    function predictGrantAddress(address issuer, bytes32 salt) external view returns (address) {
        return LibClone.predictDeterministicAddress(tokenGrantLogic, _deploymentSalt(issuer, salt), address(this));
    }

    function canCall(address boardroom, address, address target, uint256 value, bytes calldata data)
        external
        view
        returns (bool)
    {
        bytes4 selector = _selector(data);
        if (target == address(this)) {
            return selector == TokenGrantFactory.createGrant.selector && value == creationFee;
        }

        if (value != 0) return false;

        uint256 tokenId = uint256(uint160(target));
        if (grantForTokenId[tokenId] != target) return false;
        if (TokenGrant(target).issuer() != boardroom) return false;

        return selector == TokenGrant.stopVestingAndWithdrawUnvested.selector
            || selector == TokenGrant.withdrawExpiredTokens.selector;
    }

    function closeGrant(uint256 tokenId) external onlyLinkedGrant(tokenId) {
        address grant = grantForTokenId[tokenId];
        address holder = ownerOf(tokenId);
        if (!TokenGrant(grant).isClosed()) revert GrantStillOpen(tokenId);

        _burn(tokenId);
        emit GrantClosed(grant, tokenId, holder);
    }

    function approve(address account, uint256 id) public payable override {
        _requireGrantRightTransferable(id);
        super.approve(account, id);
    }

    /*//////////////////////////////////////////////////////////////
                              ERC721 HOOKS
    //////////////////////////////////////////////////////////////*/

    function _beforeTokenTransfer(address from, address to, uint256 id) internal view override {
        if (from == address(0) || to == address(0)) return;

        address grant = grantForTokenId[id];
        if (grant == address(0)) revert UnknownGrantToken(id);
        TokenGrant(grant).requireCanTransferGrantRight(block.timestamp);
    }

    function _afterTokenTransfer(address from, address to, uint256 id) internal override {
        if (from == address(0) || to == address(0)) return;

        TokenGrant(grantForTokenId[id]).onGrantRightTransferred(from, to);
    }

    /*//////////////////////////////////////////////////////////////
                               INTERNAL
    //////////////////////////////////////////////////////////////*/

    modifier onlyLinkedGrant(uint256 tokenId) {
        if (grantForTokenId[tokenId] != msg.sender) {
            revert OnlyLinkedGrant(msg.sender);
        }
        _;
    }

    function _requireGrantRightTransferable(uint256 tokenId) internal view {
        address grant = grantForTokenId[tokenId];
        if (grant == address(0)) revert UnknownGrantToken(tokenId);
        TokenGrant(grant).requireCanTransferGrantRight(block.timestamp);
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
        uint256 vestingEnd,
        bool transferable,
        uint256 transferUnlockTime
    ) internal {
        TokenGrant(grant)
            .initialize(
                msg.sender,
                holder,
                token,
                paymentToken,
                amount,
                price,
                expiry,
                vestingCliff,
                vestingEnd,
                transferable,
                transferUnlockTime
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
            tokenGrant.holder(),
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

    function _checkedTransferFrom(address token, address from, address to, uint256 expectedAmount) internal {
        ExactTransferLib.RecipientDelta memory delta = ExactTransferLib.pullTo(token, from, to, expectedAmount);
        if (delta.balanceDecreased) {
            revert UnexpectedTokenBalanceChange(token, expectedAmount, 0);
        }
        if (delta.received != expectedAmount) {
            revert UnexpectedTokenBalanceChange(token, expectedAmount, delta.received);
        }
    }

    function _deploymentSalt(address issuer, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encode(issuer, salt));
    }

    function _metadataIdentity(uint256 id, address grant, address holder) internal view returns (string memory) {
        TokenGrant tokenGrant = TokenGrant(grant);
        return string.concat(
            '{"name":"Token Grant #',
            LibString.toString(id),
            '","description":"pledge.cash escrow-backed grant right",',
            '"external_url":"https://pledge.cash",',
            '"properties":{',
            '"grantAddress":"',
            LibString.toHexString(grant),
            '","issuer":"',
            LibString.toHexString(tokenGrant.issuer()),
            '","holder":"',
            LibString.toHexString(holder),
            '","token":"',
            LibString.toHexString(tokenGrant.token()),
            '","paymentToken":"',
            LibString.toHexString(tokenGrant.paymentToken()),
            '",'
        );
    }

    function _metadataEconomics(address grant) internal view returns (string memory) {
        TokenGrant tokenGrant = TokenGrant(grant);
        return string.concat(
            '"amount":"',
            LibString.toString(tokenGrant.grantSize()),
            '","claimable":"',
            LibString.toString(tokenGrant.claimable()),
            '","settledAmount":"',
            LibString.toString(tokenGrant.settledAmount()),
            '","price":"',
            LibString.toString(tokenGrant.price()),
            '",'
        );
    }

    function _metadataSchedule(address grant) internal view returns (string memory) {
        TokenGrant tokenGrant = TokenGrant(grant);
        return string.concat(
            '"expiry":"',
            LibString.toString(tokenGrant.expiry()),
            '","vestingCliff":"',
            LibString.toString(tokenGrant.vestingCliff()),
            '","vestingEnd":"',
            LibString.toString(tokenGrant.vestingEnd()),
            '",'
        );
    }

    function _metadataStatus(address grant) internal view returns (string memory) {
        TokenGrant tokenGrant = TokenGrant(grant);
        return string.concat(
            '"transferable":',
            _boolString(tokenGrant.transferable()),
            ',"transferUnlockTime":"',
            LibString.toString(tokenGrant.transferUnlockTime()),
            '","closed":',
            _boolString(tokenGrant.isClosed()),
            "}}"
        );
    }

    function _boolString(bool value) internal pure returns (string memory) {
        return value ? "true" : "false";
    }

    function _selector(bytes calldata data) internal pure returns (bytes4 selector) {
        if (data.length < 4) return bytes4(0);
        return bytes4(data[:4]);
    }
}
