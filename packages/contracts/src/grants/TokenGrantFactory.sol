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
import {IBoardroomObligationPolicy} from "../policy/IBoardroomObligationPolicy.sol";

interface ITokenGrantDistributionIssuer {
    function isIssuedDistribution(address distribution) external view returns (bool);
}

contract TokenGrantFactory is Ownable, ERC721, IBoardroomObligationPolicy {
    address public immutable tokenGrantLogic;
    uint256 public creationFee;

    mapping(uint256 => address) public grantForTokenId;

    struct GrantCreateInput {
        address issuer;
        address funder;
        address holder;
        address token;
        address paymentToken;
        uint256 amount;
        uint256 price;
        uint256 expiry;
        uint256 vestingCliff;
        uint256 vestingEnd;
        bool transferable;
        uint256 transferUnlockTime;
        bytes32 salt;
    }

    struct GrantCreateParams {
        address holder;
        address token;
        address paymentToken;
        uint256 amount;
        uint256 price;
        uint256 expiry;
        uint256 vestingCliff;
        uint256 vestingEnd;
        bool transferable;
        uint256 transferUnlockTime;
        bytes32 salt;
    }

    error UnknownGrantToken(uint256 tokenId);
    error OnlyLinkedGrant(address caller);
    error GrantStillOpen(uint256 tokenId);
    error InvalidOwner();
    error InvalidCreationFeePayment(uint256 expected, uint256 actual);
    error UnauthorizedGrantIssuer(address issuer, address caller);
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
        grant = _createGrant(
            GrantCreateInput({
                issuer: msg.sender,
                funder: msg.sender,
                holder: holder,
                token: token,
                paymentToken: paymentToken,
                amount: amount,
                price: price,
                expiry: expiry,
                vestingCliff: vestingCliff,
                vestingEnd: vestingEnd,
                transferable: transferable,
                transferUnlockTime: transferUnlockTime,
                salt: salt
            })
        );
    }

    function createGrantFromDistribution(address issuer, GrantCreateParams calldata params)
        external
        payable
        returns (address grant)
    {
        _requireDistributionIssuer(issuer, msg.sender);

        grant = _createGrant(
            GrantCreateInput({
                issuer: issuer,
                funder: msg.sender,
                holder: params.holder,
                token: params.token,
                paymentToken: params.paymentToken,
                amount: params.amount,
                price: params.price,
                expiry: params.expiry,
                vestingCliff: params.vestingCliff,
                vestingEnd: params.vestingEnd,
                transferable: params.transferable,
                transferUnlockTime: params.transferUnlockTime,
                salt: params.salt
            })
        );
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
            return _isAuthorizedCreateGrantCall(selector, value);
        }

        if (value != 0) return false;
        return _isAuthorizedLifecycleCall(boardroom, target, selector);
    }

    function obligationForCall(address, address target, uint256, bytes calldata data, bytes calldata result)
        external
        view
        returns (Obligation memory obligation)
    {
        if (!_createsGrantObligation(target, data, result)) {
            return obligation;
        }

        obligation.kind = ObligationKind.Grant;
        obligation.account = abi.decode(result, (address));
    }

    function isLifecycleCallAllowed(address boardroom, address target, bytes4 selector) external view returns (bool) {
        return _isAuthorizedLifecycleCall(boardroom, target, selector);
    }

    function grantSlotReleaseForLifecycleCall(address, address, bytes4) external pure returns (address distribution) {}

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
        if (_isMintOrBurn(from, to)) return;

        address grant = grantForTokenId[id];
        if (grant == address(0)) revert UnknownGrantToken(id);
        TokenGrant(grant).requireCanTransferGrantRight(block.timestamp);
    }

    function _afterTokenTransfer(address from, address to, uint256 id) internal override {
        if (_isMintOrBurn(from, to)) return;

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

    function _isMintOrBurn(address from, address to) internal pure returns (bool) {
        return from == address(0) || to == address(0);
    }

    function _isAuthorizedCreateGrantCall(bytes4 selector, uint256 value) internal view returns (bool) {
        return selector == TokenGrantFactory.createGrant.selector && value == creationFee;
    }

    function _isAuthorizedLifecycleCall(address boardroom, address grant, bytes4 selector)
        internal
        view
        returns (bool)
    {
        return _isLinkedBoardroomGrant(boardroom, grant) && _isGrantLifecycleSelector(selector);
    }

    function _isLinkedBoardroomGrant(address boardroom, address grant) internal view returns (bool) {
        uint256 tokenId = uint256(uint160(grant));
        if (grantForTokenId[tokenId] != grant) return false;
        return TokenGrant(grant).issuer() == boardroom;
    }

    function _isGrantLifecycleSelector(bytes4 selector) internal pure returns (bool) {
        return selector == TokenGrant.stopVestingAndWithdrawUnvested.selector
            || selector == TokenGrant.withdrawExpiredTokens.selector;
    }

    function _createsGrantObligation(address target, bytes calldata data, bytes calldata result)
        internal
        view
        returns (bool)
    {
        return
            target == address(this) && _selector(data) == TokenGrantFactory.createGrant.selector && result.length == 32;
    }

    function _createGrant(GrantCreateInput memory input) internal returns (address grant) {
        if (msg.value != creationFee) {
            revert InvalidCreationFeePayment(creationFee, msg.value);
        }

        grant = LibClone.cloneDeterministic(tokenGrantLogic, _deploymentSalt(input.issuer, input.salt));
        uint256 tokenId = uint256(uint160(grant));

        grantForTokenId[tokenId] = grant;

        _initializeGrant(grant, input);
        _checkedTransferFrom(input.token, input.funder, grant, input.amount);
        _payCreationFee();
        _mint(input.holder, tokenId);
        _emitTokenGrantCreated(grant, tokenId, input.transferable, input.transferUnlockTime, input.salt);
    }

    function _initializeGrant(address grant, GrantCreateInput memory input) internal {
        TokenGrant(grant)
            .initialize(
                input.issuer,
                input.holder,
                input.token,
                input.paymentToken,
                input.amount,
                input.price,
                input.expiry,
                input.vestingCliff,
                input.vestingEnd,
                input.transferable,
                input.transferUnlockTime
            );
    }

    function _requireDistributionIssuer(address issuer, address caller) internal view {
        try ITokenGrantDistributionIssuer(issuer).isIssuedDistribution(caller) returns (bool allowed) {
            if (allowed) return;
        } catch {}

        revert UnauthorizedGrantIssuer(issuer, caller);
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
        _requireExactReceived(token, expectedAmount, delta);
    }

    function _requireExactReceived(address token, uint256 expectedAmount, ExactTransferLib.RecipientDelta memory delta)
        internal
        pure
    {
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
