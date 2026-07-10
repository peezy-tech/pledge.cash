// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Initializable} from "solady/utils/Initializable.sol";
import {MerkleProofLib} from "solady/utils/MerkleProofLib.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {ExactTransferLib} from "../lib/ExactTransferLib.sol";
import {TokenGrantFactory} from "../grants/TokenGrantFactory.sol";

interface IMerkleAirdropBoardroom {
    function status() external view returns (uint8);
    function recordGrantFromDistribution(address grant) external;
}

contract MerkleAirdrop is Initializable, ReentrancyGuard {
    using SafeTransferLib for address;

    uint8 internal constant BOARDROOM_STATUS_ACTIVE = 0;

    bytes32 public constant DIRECT_CLAIM_TYPEHASH = keccak256(
        "MerkleAirdropDirectClaim(uint256 chainId,uint256 index,address airdrop,address boardroom,address shareToken,address account,uint256 amount)"
    );
    bytes32 public constant GRANT_CLAIM_TYPEHASH = keccak256(
        "MerkleAirdropGrantClaim(uint256 chainId,uint256 index,address airdrop,address boardroom,address shareToken,address tokenGrantFactory,address account,uint256 amount,bytes32 termsHash)"
    );
    bytes32 public constant GRANT_TERMS_TYPEHASH = keccak256(
        "MerkleAirdropGrantTerms(address paymentToken,uint256 price,uint256 expiry,uint256 vestingCliff,uint256 vestingEnd,bool transferable,uint256 transferUnlockTime,bytes32 salt)"
    );

    enum AirdropStatus {
        Active,
        Closed,
        Cancelled
    }

    struct CreateParams {
        address shareToken;
        uint256 shareAmount;
        bytes32 merkleRoot;
        uint64 startTime;
        uint64 endTime;
        uint16 maxGrantClaims;
        bytes32 salt;
    }

    struct GrantClaimParams {
        address paymentToken;
        uint256 price;
        uint256 expiry;
        uint256 vestingCliff;
        uint256 vestingEnd;
        bool transferable;
        uint256 transferUnlockTime;
        bytes32 salt;
    }

    address public factory;
    address public boardroom;
    address public shareToken;
    address public tokenGrantFactory;
    uint256 public airdropSupply;
    uint256 public claimedShares;
    uint256 public remainingShares;
    bytes32 public merkleRoot;
    uint64 public startTime;
    uint64 public endTime;
    uint16 public maxGrantClaims;
    uint16 public claimedGrantCount;
    AirdropStatus public airdropStatus;

    mapping(uint256 => uint256) internal claimedBitMap;

    error InvalidAddress();
    error InvalidAmount();
    error InvalidMerkleRoot();
    error InvalidTimeWindow();
    error OnlyBoardroom();
    error AirdropNotActive();
    error AirdropNotOpen();
    error ClaimAlreadyMade(uint256 index);
    error InvalidProof();
    error InsufficientShares(uint256 requested, uint256 available);
    error TooManyGrantClaims(uint256 maximum);
    error UnexpectedTokenBalanceChange(address token, uint256 expected, uint256 actual);

    event MerkleAirdropInitialized(
        address indexed boardroom,
        address indexed shareToken,
        address indexed tokenGrantFactory,
        uint256 shareAmount,
        bytes32 merkleRoot,
        uint64 startTime,
        uint64 endTime,
        uint16 maxGrantClaims,
        bytes32 salt
    );
    event AirdropClaimed(uint256 indexed index, address indexed account, uint256 amount);
    event AirdropGrantClaimed(uint256 indexed index, address indexed account, address indexed grant, uint256 amount);
    event MerkleAirdropClosed(uint256 returnedShares);
    event MerkleAirdropCancelled(uint256 returnedShares);

    constructor() {
        _disableInitializers();
    }

    function initialize(address boardroom_, address tokenGrantFactory_, CreateParams calldata params)
        external
        initializer
    {
        _requireValidCreateParams(boardroom_, tokenGrantFactory_, params);

        factory = msg.sender;
        boardroom = boardroom_;
        shareToken = params.shareToken;
        tokenGrantFactory = tokenGrantFactory_;
        airdropSupply = params.shareAmount;
        remainingShares = params.shareAmount;
        merkleRoot = params.merkleRoot;
        startTime = params.startTime;
        endTime = params.endTime;
        maxGrantClaims = params.maxGrantClaims;
        airdropStatus = AirdropStatus.Active;

        emit MerkleAirdropInitialized(
            boardroom_,
            params.shareToken,
            tokenGrantFactory_,
            params.shareAmount,
            params.merkleRoot,
            params.startTime,
            params.endTime,
            params.maxGrantClaims,
            params.salt
        );
    }

    function claim(uint256 index, address account, uint256 amount, bytes32[] calldata proof) external nonReentrant {
        _claim(index, account, amount, getDirectClaimLeaf(index, account, amount), proof);
        _checkedTransfer(account, amount);

        emit AirdropClaimed(index, account, amount);
    }

    function claimGrant(
        uint256 index,
        address account,
        uint256 amount,
        GrantClaimParams calldata params,
        bytes32[] calldata proof
    ) external nonReentrant returns (address grant) {
        uint16 nextClaimedGrantCount = _nextClaimedGrantCount();

        _claim(index, account, amount, getGrantClaimLeaf(index, account, amount, params), proof);
        claimedGrantCount = nextClaimedGrantCount;

        grant = _createGrantFromClaim(index, account, amount, params);
        IMerkleAirdropBoardroom(boardroom).recordGrantFromDistribution(grant);

        emit AirdropGrantClaimed(index, account, grant, amount);
    }

    function close() external nonReentrant onlyBoardroom {
        _requireActive();
        airdropStatus = AirdropStatus.Closed;

        uint256 returnedShares = _returnRemainingShares();

        emit MerkleAirdropClosed(returnedShares);
    }

    function cancel() external nonReentrant onlyBoardroom {
        _requireActive();
        airdropStatus = AirdropStatus.Cancelled;

        uint256 returnedShares = _returnRemainingShares();

        emit MerkleAirdropCancelled(returnedShares);
    }

    function isClosed() external view returns (bool) {
        return airdropStatus != AirdropStatus.Active;
    }

    function isClaimed(uint256 index) public view returns (bool) {
        (uint256 claimedWordIndex, uint256 mask) = _claimBit(index);
        uint256 claimedWord = claimedBitMap[claimedWordIndex];
        return (claimedWord & mask) == mask;
    }

    function getDirectClaimLeaf(uint256 index, address account, uint256 amount) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                DIRECT_CLAIM_TYPEHASH, block.chainid, index, address(this), boardroom, shareToken, account, amount
            )
        );
    }

    function getGrantClaimLeaf(uint256 index, address account, uint256 amount, GrantClaimParams calldata params)
        public
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                GRANT_CLAIM_TYPEHASH,
                block.chainid,
                index,
                address(this),
                boardroom,
                shareToken,
                tokenGrantFactory,
                account,
                amount,
                getGrantTermsHash(params)
            )
        );
    }

    function getGrantTermsHash(GrantClaimParams calldata params) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                GRANT_TERMS_TYPEHASH,
                params.paymentToken,
                params.price,
                params.expiry,
                params.vestingCliff,
                params.vestingEnd,
                params.transferable,
                params.transferUnlockTime,
                params.salt
            )
        );
    }

    function getGrantSalt(uint256 index, address account, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), index, account, salt));
    }

    modifier onlyBoardroom() {
        if (msg.sender != boardroom) revert OnlyBoardroom();
        _;
    }

    function _claim(uint256 index, address account, uint256 amount, bytes32 leaf, bytes32[] calldata proof) internal {
        _requireOpen();
        _requireClaimable(index, account, amount, leaf, proof);

        _setClaimed(index);
        uint256 nextClaimedShares = claimedShares + amount;
        claimedShares = nextClaimedShares;
        remainingShares = airdropSupply - nextClaimedShares;
    }

    function _setClaimed(uint256 index) internal {
        (uint256 claimedWordIndex, uint256 mask) = _claimBit(index);
        claimedBitMap[claimedWordIndex] = claimedBitMap[claimedWordIndex] | mask;
    }

    function _claimBit(uint256 index) internal pure returns (uint256 claimedWordIndex, uint256 mask) {
        claimedWordIndex = index >> 8;
        mask = uint256(1) << (index & 255);
    }

    function _grantCreateParams(
        uint256 index,
        address account,
        address shareToken_,
        uint256 amount,
        GrantClaimParams calldata params
    ) internal view returns (TokenGrantFactory.GrantCreateParams memory grantParams) {
        grantParams = TokenGrantFactory.GrantCreateParams({
            holder: account,
            token: shareToken_,
            paymentToken: params.paymentToken,
            amount: amount,
            price: params.price,
            expiry: params.expiry,
            vestingCliff: params.vestingCliff,
            vestingEnd: params.vestingEnd,
            transferable: params.transferable,
            transferUnlockTime: params.transferUnlockTime,
            salt: getGrantSalt(index, account, params.salt)
        });
    }

    function _requireActive() internal view {
        if (airdropStatus != AirdropStatus.Active) revert AirdropNotActive();
    }

    function _requireOpen() internal view {
        _requireActive();
        if (!_isBoardroomActive()) revert AirdropNotOpen();
        if (!_isWithinClaimWindow()) revert AirdropNotOpen();
    }

    function _requireValidCreateParams(address boardroom_, address tokenGrantFactory_, CreateParams calldata params)
        internal
        view
    {
        if (boardroom_ == address(0) || params.shareToken == address(0) || tokenGrantFactory_ == address(0)) {
            revert InvalidAddress();
        }
        if (params.shareAmount == 0) revert InvalidAmount();
        if (params.merkleRoot == bytes32(0)) revert InvalidMerkleRoot();
        if (params.endTime != 0 && (params.endTime <= params.startTime || uint256(params.endTime) <= block.timestamp)) {
            revert InvalidTimeWindow();
        }
    }

    function _requireClaimable(uint256 index, address account, uint256 amount, bytes32 leaf, bytes32[] calldata proof)
        internal
        view
    {
        if (account == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        if (amount > remainingShares) revert InsufficientShares(amount, remainingShares);
        if (isClaimed(index)) revert ClaimAlreadyMade(index);
        if (!MerkleProofLib.verifyCalldata(proof, merkleRoot, leaf)) revert InvalidProof();
    }

    function _nextClaimedGrantCount() internal view returns (uint16) {
        uint16 claimedGrantCount_ = claimedGrantCount;
        if (claimedGrantCount_ >= maxGrantClaims) revert TooManyGrantClaims(maxGrantClaims);
        return claimedGrantCount_ + 1;
    }

    function _createGrantFromClaim(uint256 index, address account, uint256 amount, GrantClaimParams calldata params)
        internal
        returns (address grant)
    {
        address shareToken_ = shareToken;
        address tokenGrantFactory_ = tokenGrantFactory;
        shareToken_.safeApprove(tokenGrantFactory_, amount);
        grant = TokenGrantFactory(tokenGrantFactory_)
            .createGrantFromDistribution(boardroom, _grantCreateParams(index, account, shareToken_, amount, params));
        shareToken_.safeApprove(tokenGrantFactory_, 0);
    }

    function _returnRemainingShares() internal returns (uint256 returnedShares) {
        returnedShares = remainingShares;
        remainingShares = 0;
        if (returnedShares != 0) _checkedTransfer(boardroom, returnedShares);
    }

    function _isBoardroomActive() internal view returns (bool) {
        return IMerkleAirdropBoardroom(boardroom).status() == BOARDROOM_STATUS_ACTIVE;
    }

    function _isWithinClaimWindow() internal view returns (bool) {
        return block.timestamp >= startTime && (endTime == 0 || block.timestamp <= endTime);
    }

    function _checkedTransfer(address to, uint256 expectedAmount) internal {
        ExactTransferLib.ExactDelta memory delta = ExactTransferLib.sendFromSelfTo(shareToken, to, expectedAmount);
        if (delta.senderBalanceIncreased) {
            revert UnexpectedTokenBalanceChange(shareToken, expectedAmount, 0);
        }
        if (delta.senderSpent != expectedAmount) {
            revert UnexpectedTokenBalanceChange(shareToken, expectedAmount, delta.senderSpent);
        }
        if (delta.recipientBalanceDecreased) {
            revert UnexpectedTokenBalanceChange(shareToken, expectedAmount, 0);
        }
        if (delta.recipientReceived != expectedAmount) {
            revert UnexpectedTokenBalanceChange(shareToken, expectedAmount, delta.recipientReceived);
        }
    }
}
