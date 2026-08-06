// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "solady/auth/Ownable.sol";
import {ERC721} from "solady/tokens/ERC721.sol";
import {Base64} from "solady/utils/Base64.sol";
import {LibClone} from "solady/utils/LibClone.sol";
import {LibString} from "solady/utils/LibString.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {TokenGrant} from "./TokenGrant.sol";
import {IBoardroom} from "../boardroom/IBoardroom.sol";
import {ExactTransferLib} from "../lib/ExactTransferLib.sol";

interface ITokenGrantBoardroomFactory {
    function isBoardroom(address boardroom) external view returns (bool);
}

contract TokenGrantFactory is Ownable, ERC721 {
    uint256 public constant MAX_BOARDROOM_GRANT_DURATION = 5 * 365 days;

    address public immutable boardroomFactory;
    address public immutable tokenGrantLogic;
    uint256 public creationFee;
    address public feeRecipient;

    mapping(uint256 => address) public grantForTokenId;

    struct GrantCreateInput {
        address issuer;
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
    error InvalidFeeRecipient();
    error InvalidBoardroomFactory(address factory);
    error InvalidCreationFeePayment(uint256 expected, uint256 actual);
    error BoardroomGrantExpiryTooFar(uint256 expiry, uint256 maximum);
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
    event FeeRecipientSet(address indexed previousRecipient, address indexed newRecipient);
    event CreationFeePaid(address indexed payer, address indexed recipient, uint256 amount);

    constructor(address owner_, address boardroomFactory_) {
        if (owner_ == address(0)) revert InvalidOwner();
        if (boardroomFactory_ == address(0) || boardroomFactory_.code.length == 0) {
            revert InvalidBoardroomFactory(boardroomFactory_);
        }
        _initializeOwner(owner_);
        feeRecipient = owner_;
        boardroomFactory = boardroomFactory_;
        tokenGrantLogic = address(new TokenGrant());
        emit FeeRecipientSet(address(0), owner_);
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

    function setFeeRecipient(address recipient) external onlyOwner {
        if (recipient == address(0)) revert InvalidFeeRecipient();

        address previousRecipient = feeRecipient;
        feeRecipient = recipient;
        emit FeeRecipientSet(previousRecipient, recipient);
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
        uint256 fee = creationFee;
        grant = _createGrant(
            GrantCreateInput({
                issuer: msg.sender,
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
            }),
            fee
        );
    }

    function predictGrantAddress(address issuer, bytes32 salt) external view returns (address) {
        return LibClone.predictDeterministicAddress(tokenGrantLogic, _deploymentSalt(issuer, salt), address(this));
    }

    function isCanonicalBoardroom(address account) public view returns (bool) {
        return ITokenGrantBoardroomFactory(boardroomFactory).isBoardroom(account);
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

    function _createGrant(GrantCreateInput memory input, uint256 fee) internal returns (address grant) {
        if (msg.value != fee) {
            revert InvalidCreationFeePayment(fee, msg.value);
        }
        _requireBoardroomGrantExpiry(input.issuer, input.expiry);
        grant = LibClone.cloneDeterministic(tokenGrantLogic, _deploymentSalt(input.issuer, input.salt));
        uint256 tokenId = uint256(uint160(grant));

        grantForTokenId[tokenId] = grant;

        _initializeGrant(grant, input);
        _checkedTransferFrom(input.token, input.issuer, grant, input.amount);
        _registerBoardroomGrant(input, grant);
        _payCreationFee(fee);
        _mint(input.holder, tokenId);
        _emitTokenGrantCreated(grant, tokenId, input.transferable, input.transferUnlockTime, input.salt);
    }

    function _requireBoardroomGrantExpiry(address issuer, uint256 expiry) internal view {
        if (!isCanonicalBoardroom(issuer)) return;

        uint256 maximum = block.timestamp + MAX_BOARDROOM_GRANT_DURATION;
        if (expiry > maximum) revert BoardroomGrantExpiryTooFar(expiry, maximum);
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

    /// @dev The canonical Boardroom only permits these callbacks while this factory is
    /// its owner-selected execution target, making funding and obligation registration atomic.
    function _registerBoardroomGrant(GrantCreateInput memory input, address grant) internal {
        if (!isCanonicalBoardroom(input.issuer)) return;

        IBoardroom boardroom = IBoardroom(input.issuer);
        address shares = boardroom.shareToken();
        bool includeToken = input.token != shares;
        bool includePayment =
            input.paymentToken != address(0) && input.paymentToken != input.token && input.paymentToken != shares;
        uint256 dependencyCount = (includeToken ? 1 : 0) + (includePayment ? 1 : 0);
        address[] memory dependencies = new address[](dependencyCount);
        uint256 cursor;
        if (includeToken) dependencies[cursor++] = input.token;
        if (includePayment) dependencies[cursor] = input.paymentToken;

        for (uint256 i; i < dependencyCount; ++i) {
            boardroom.reserveRedeemableAsset(dependencies[i]);
        }
        boardroom.registerObligation(grant, IBoardroom.ObligationKind.Grant, dependencies);
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

    function _payCreationFee(uint256 fee) internal {
        if (fee == 0) return;

        address recipient = feeRecipient;
        SafeTransferLib.safeTransferETH(recipient, fee);
        emit CreationFeePaid(msg.sender, recipient, fee);
    }

    function _checkedTransferFrom(address token, address from, address to, uint256 expectedAmount) internal {
        ExactTransferLib.ExactDelta memory delta = ExactTransferLib.pullBetween(token, from, to, expectedAmount);
        _requireExactBalanceChanges(token, expectedAmount, delta);
    }

    function _requireExactBalanceChanges(
        address token,
        uint256 expectedAmount,
        ExactTransferLib.ExactDelta memory delta
    ) internal pure {
        if (delta.senderBalanceIncreased) {
            revert UnexpectedTokenBalanceChange(token, expectedAmount, 0);
        }
        if (delta.senderSpent != expectedAmount) {
            revert UnexpectedTokenBalanceChange(token, expectedAmount, delta.senderSpent);
        }
        if (delta.recipientBalanceDecreased) {
            revert UnexpectedTokenBalanceChange(token, expectedAmount, 0);
        }
        if (delta.recipientReceived != expectedAmount) {
            revert UnexpectedTokenBalanceChange(token, expectedAmount, delta.recipientReceived);
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
}
