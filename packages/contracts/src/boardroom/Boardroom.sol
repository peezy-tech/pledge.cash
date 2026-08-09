// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "solady/auth/Ownable.sol";
import {ERC20} from "solady/tokens/ERC20.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {BestEffortTokenLib} from "../lib/BestEffortTokenLib.sol";
import {ExactTransferLib} from "../lib/ExactTransferLib.sol";
import {BoardroomToken} from "./BoardroomToken.sol";
import {IBoardroom} from "./IBoardroom.sol";

interface IBoardroomWrappedNative {
    function deposit() external payable;
}

/// @notice Non-upgradeable project custodian with bounded execution, wind-down, and redemption.
contract Boardroom is IBoardroom, Ownable, ReentrancyGuard {
    uint256 public constant override MAX_BATCH_CALLS = 16;
    uint256 public constant override MAX_SNAPSHOT_PAGE = 32;
    uint256 public constant override MIN_WIND_DOWN_DELAY = 1 days;
    uint256 internal constant ASSET_PROBE_GAS = 30_000;
    uint256 internal constant ESCROW_PROBE_GAS = 30_000;
    uint256 internal constant MAX_NAME_LENGTH = 64;
    uint256 internal constant MAX_SYMBOL_LENGTH = 16;

    address public immutable override factory;
    address public immutable override wrappedNative;
    address public override shareToken;
    address public override redemptionExcessRecipient;
    Status public override status;
    uint256 public override windDownDelay;
    uint256 public override windDownStartedAt;

    bool internal executionActive;
    address internal executionTarget;

    address[] internal assetRegistry;
    mapping(address asset => bool registered) public override isRedeemableAsset;
    mapping(address asset => SnapshotStatus snapshotStatus) internal assetSnapshotStatus;
    uint256 internal frozenAssetCount;
    uint256 internal assetSnapshotCursor;
    bool internal assetRegistryFrozen;

    uint256 public override openEscrowCount;
    mapping(address escrow => EscrowState state) public override escrowState;

    uint256 internal redemptionSupply;
    bool internal redemptionSupplyFrozen;
    mapping(address holder => uint256 shares) public override redemptionCredits;
    mapping(address asset => uint256 shares) internal allocatedShares;
    mapping(address holder => mapping(address asset => uint256 shares)) public override allocatedRedemptionShares;
    mapping(address asset => uint256 amount) internal snapshotBalance;
    mapping(address asset => uint256 amount) internal paid;

    error OnlyFactory();
    error InvalidAddress(address account);
    error InvalidAmount();
    error InvalidMetadata();
    error InvalidStatus(Status expected, Status actual);
    error OwnershipRenunciationDisabled();
    error EmptyBatch();
    error TooManyCalls(uint256 requested, uint256 maximum);
    error InvalidExecutionTarget(address target);
    error InvalidExecutionContext(address caller);
    error CallFailed(address target);
    error InvalidRedeemableAsset(address asset);
    error RedeemableAssetAlreadyRegistered(address asset);
    error EmptyRedeemableAsset(address asset);
    error TreasuryContributionExpired(uint256 deadline);
    error TreasuryContributionAmountMismatch(address asset, uint256 expected, uint256 received);
    error InvalidEscrow(address escrow);
    error EscrowAlreadyClosed(address escrow);
    error EscrowAlreadyRegistered(address escrow);
    error EscrowNotOpen(address escrow);
    error EscrowStillOpen(address escrow);
    error SnapshotNotReady();
    error SnapshotAlreadyFrozen();
    error SnapshotIncomplete(uint256 cursor, uint256 count);
    error InvalidSnapshotPage(uint256 requested, uint256 maximum);
    error InvalidRedemptionInput();
    error InsufficientRedemptionAmount(address asset, uint256 amountOut, uint256 minAmountOut);
    error UnexpectedRedeemableAssetBalanceChange(address asset, uint256 expected, uint256 actual);
    error UnexpectedWrappedNativeBalanceChange(uint256 expected, uint256 actual);
    error NoRedemptionExcess(address asset);

    event BoardroomInitialized(
        address indexed owner, address indexed shareToken, address indexed wrappedNative, string name, string symbol
    );
    event BoardroomCallExecuted(
        address indexed target, bytes4 indexed selector, address indexed authority, uint256 value, bytes32 dataHash
    );
    event SharesMinted(address indexed to, uint256 amount);
    event RedemptionExcessRecipientSet(address indexed recipient);
    event BoardroomWindDownStarted(address indexed owner, uint256 startedAt, uint256 delay);
    event RedeemableAssetRegistered(address indexed asset);
    event TreasuryAssetContributed(address indexed contributor, address indexed asset, uint256 amount);
    event BoardroomEscrowOpened(address indexed escrow, address indexed registrar);
    event BoardroomEscrowClosed(address indexed escrow);
    event NativeWrappedForWindDown(address indexed wrappedNative, uint256 amount);
    event TreasurySharesBurned(uint256 amount);
    event BoardroomSnapshottingStarted(uint256 assetCount, uint256 redemptionSupply);
    event BoardroomSnapshotPageProcessed(uint256 indexed fromIndex, uint256 indexed toIndex);
    event RedeemableAssetSnapshot(address indexed asset, uint256 balance);
    event RedeemableAssetUnreadable(address indexed asset);
    event BoardroomRedemptionsOpened(address indexed caller);
    event SharesRedeemed(address indexed holder, uint256 shares);
    event RedemptionAssetClaimed(
        address indexed holder, address indexed recipient, address indexed asset, uint256 shares, uint256 amount
    );
    event RedemptionExcessSwept(address indexed asset, address indexed recipient, uint256 amount);

    constructor(address factory_, address wrappedNative_) {
        if (factory_ == address(0)) revert InvalidAddress(factory_);
        if (wrappedNative_ == address(0) || wrappedNative_.code.length == 0) {
            revert InvalidAddress(wrappedNative_);
        }
        factory = factory_;
        wrappedNative = wrappedNative_;
        _initializeOwner(address(0));
    }

    receive() external payable {}

    function owner() public view override(IBoardroom, Ownable) returns (address) {
        return super.owner();
    }

    function initialize(address owner_, string calldata name_, string calldata symbol_) external override {
        if (msg.sender != factory) revert OnlyFactory();
        if (shareToken != address(0)) revert AlreadyInitialized();
        if (owner_ == address(0)) revert InvalidAddress(owner_);
        if (
            bytes(name_).length == 0 || bytes(name_).length > MAX_NAME_LENGTH || bytes(symbol_).length == 0
                || bytes(symbol_).length > MAX_SYMBOL_LENGTH
        ) revert InvalidMetadata();

        _initializeOwner(owner_);
        BoardroomToken token = new BoardroomToken(address(this), name_, symbol_);
        shareToken = address(token);
        redemptionExcessRecipient = owner_;
        windDownDelay = MIN_WIND_DOWN_DELAY;
        _registerAsset(wrappedNative);

        emit BoardroomInitialized(owner_, address(token), wrappedNative, name_, symbol_);
        emit RedemptionExcessRecipientSet(owner_);
    }

    function mint(address to, uint256 amount) external override onlyOwner {
        _requireStatus(Status.Active);
        if (to == address(0)) revert InvalidAddress(to);
        if (amount == 0) revert InvalidAmount();
        BoardroomToken(shareToken).mint(to, amount);
        emit SharesMinted(to, amount);
    }

    function setRedemptionExcessRecipient(address recipient) external override onlyOwner {
        _requireStatus(Status.Active);
        if (recipient == address(0) || recipient == address(this)) revert InvalidAddress(recipient);
        redemptionExcessRecipient = recipient;
        emit RedemptionExcessRecipientSet(recipient);
    }

    function transferOwnership(address newOwner) public payable override onlyOwner {
        _requireStatus(Status.Active);
        address previousOwner = owner();
        super.transferOwnership(newOwner);
        if (redemptionExcessRecipient == previousOwner) {
            redemptionExcessRecipient = newOwner;
            emit RedemptionExcessRecipientSet(newOwner);
        }
    }

    function completeOwnershipHandover(address pendingOwner) public payable override onlyOwner {
        _requireStatus(Status.Active);
        address previousOwner = owner();
        super.completeOwnershipHandover(pendingOwner);
        if (redemptionExcessRecipient == previousOwner) {
            redemptionExcessRecipient = pendingOwner;
            emit RedemptionExcessRecipientSet(pendingOwner);
        }
    }

    function renounceOwnership() public payable override onlyOwner {
        revert OwnershipRenunciationDisabled();
    }

    function startWindDown() external override onlyOwner nonReentrant {
        _requireStatus(Status.Active);
        status = Status.WindingDown;
        windDownStartedAt = block.timestamp;
        _wrapNativeBalance();
        emit BoardroomWindDownStarted(msg.sender, windDownStartedAt, windDownDelay);
    }

    function execute(Call calldata call_)
        external
        payable
        override
        onlyOwner
        nonReentrant
        returns (bytes memory result)
    {
        _requireStatus(Status.Active);
        result = _executeCall(call_, msg.sender);
    }

    function executeBatch(Call[] calldata calls)
        external
        payable
        override
        onlyOwner
        nonReentrant
        returns (bytes[] memory results)
    {
        _requireStatus(Status.Active);
        uint256 length = calls.length;
        if (length == 0) revert EmptyBatch();
        if (length > MAX_BATCH_CALLS) revert TooManyCalls(length, MAX_BATCH_CALLS);
        results = new bytes[](length);
        for (uint256 i; i < length; ++i) {
            results[i] = _executeCall(calls[i], msg.sender);
        }
    }

    function executeEscrow(address escrow, bytes calldata data)
        external
        override
        onlyOwner
        nonReentrant
        returns (bytes memory result)
    {
        _requireStatus(Status.WindingDown);
        if (escrowState[escrow] != EscrowState.Open) revert EscrowNotOpen(escrow);
        (bool success, bytes memory output) = escrow.call(data);
        if (!success) _revertCall(escrow, output);
        emit BoardroomCallExecuted(escrow, _selector(data), msg.sender, 0, keccak256(data));
        if (_isEscrowClosed(escrow)) _closeEscrow(escrow);
        return output;
    }

    function wrapNativeBalance() external override nonReentrant {
        if (status == Status.Active) _checkOwner();
        _wrapNativeBalance();
    }

    function reserveRedeemableAsset(address asset) external override {
        _requireExecutionTarget();
        _requireStatus(Status.Active);
        _registerAsset(asset);
    }

    function registerRedeemableAsset(address asset) external override onlyOwner {
        if (status != Status.Active && status != Status.WindingDown) {
            revert InvalidStatus(Status.WindingDown, status);
        }
        if (isRedeemableAsset[asset]) revert RedeemableAssetAlreadyRegistered(asset);
        if (status == Status.WindingDown) {
            (bool readable, uint256 balance) = BestEffortTokenLib.tryBalanceOf(asset, address(this));
            if (!readable || balance == 0) revert EmptyRedeemableAsset(asset);
        }
        _registerAsset(asset);
    }

    function contributeTreasuryAsset(address asset, uint256 amount, uint256 deadline) external override nonReentrant {
        if (status != Status.Active && status != Status.WindingDown) {
            revert InvalidStatus(Status.WindingDown, status);
        }
        if (deadline < block.timestamp) revert TreasuryContributionExpired(deadline);
        if (!isRedeemableAsset[asset]) revert InvalidRedeemableAsset(asset);
        if (amount == 0) revert InvalidAmount();
        ExactTransferLib.RecipientDelta memory delta = ExactTransferLib.pullTo(asset, msg.sender, address(this), amount);
        if (delta.balanceDecreased || delta.received != amount) {
            revert TreasuryContributionAmountMismatch(asset, amount, delta.received);
        }
        emit TreasuryAssetContributed(msg.sender, asset, amount);
    }

    function registerEscrow(address escrow) external override {
        _requireExecutionTarget();
        _requireStatus(Status.Active);
        if (escrow == address(0) || escrow == address(this) || escrow == shareToken || escrow.code.length == 0) {
            revert InvalidEscrow(escrow);
        }
        if (escrowState[escrow] != EscrowState.None) revert EscrowAlreadyRegistered(escrow);
        if (_isEscrowClosed(escrow)) revert EscrowAlreadyClosed(escrow);

        escrowState[escrow] = EscrowState.Open;
        openEscrowCount += 1;
        emit BoardroomEscrowOpened(escrow, msg.sender);
    }

    function pruneEscrow(address escrow) external override returns (bool pruned) {
        if (escrowState[escrow] != EscrowState.Open) revert EscrowNotOpen(escrow);
        if (!_isEscrowClosed(escrow)) revert EscrowStillOpen(escrow);
        _closeEscrow(escrow);
        return true;
    }

    function beginSnapshot() external override nonReentrant {
        _requireStatus(Status.WindingDown);
        if (block.timestamp < windDownStartedAt + windDownDelay || openEscrowCount != 0) {
            revert SnapshotNotReady();
        }
        if (assetRegistryFrozen) revert SnapshotAlreadyFrozen();

        status = Status.Snapshotting;
        _wrapNativeBalance();
        _burnTreasuryShares();
        redemptionSupply = ERC20(shareToken).totalSupply();
        if (redemptionSupply == 0) revert SnapshotNotReady();
        redemptionSupplyFrozen = true;
        assetRegistryFrozen = true;
        frozenAssetCount = assetRegistry.length;
        emit BoardroomSnapshottingStarted(frozenAssetCount, redemptionSupply);
    }

    function snapshotAssets(uint256 maximum) external override returns (uint256 processed) {
        _requireStatus(Status.Snapshotting);
        if (maximum == 0 || maximum > MAX_SNAPSHOT_PAGE) {
            revert InvalidSnapshotPage(maximum, MAX_SNAPSHOT_PAGE);
        }
        uint256 cursor = assetSnapshotCursor;
        uint256 end = cursor + maximum;
        if (end > frozenAssetCount) end = frozenAssetCount;
        for (uint256 i = cursor; i < end; ++i) {
            address asset = assetRegistry[i];
            (bool readable, uint256 balance) = _tryBoundedBalanceOf(asset, address(this));
            if (readable) {
                snapshotBalance[asset] = balance;
                assetSnapshotStatus[asset] = SnapshotStatus.Included;
                emit RedeemableAssetSnapshot(asset, balance);
            } else {
                assetSnapshotStatus[asset] = SnapshotStatus.Unreadable;
                emit RedeemableAssetUnreadable(asset);
            }
        }
        assetSnapshotCursor = end;
        processed = end - cursor;
        emit BoardroomSnapshotPageProcessed(cursor, end);
    }

    function openRedemptions() external override {
        _requireStatus(Status.Snapshotting);
        if (assetSnapshotCursor != frozenAssetCount) {
            revert SnapshotIncomplete(assetSnapshotCursor, frozenAssetCount);
        }
        status = Status.RedemptionsOpen;
        emit BoardroomRedemptionsOpened(msg.sender);
    }

    function redeem(uint256 shares) external override nonReentrant {
        _requireStatus(Status.RedemptionsOpen);
        if (shares == 0 || shares > ERC20(shareToken).balanceOf(msg.sender)) revert InvalidRedemptionInput();
        BoardroomToken(shareToken).burn(msg.sender, shares);
        redemptionCredits[msg.sender] += shares;
        emit SharesRedeemed(msg.sender, shares);
    }

    function claimRedemptionAsset(address asset, address recipient, uint256 minAmountOut)
        external
        override
        nonReentrant
        returns (uint256 amountOut)
    {
        _requireStatus(Status.RedemptionsOpen);
        if (
            recipient == address(0) || recipient == address(this)
                || assetSnapshotStatus[asset] != SnapshotStatus.Included
        ) revert InvalidRedemptionInput();

        uint256 allocated = allocatedRedemptionShares[msg.sender][asset];
        uint256 shares = redemptionCredits[msg.sender] - allocated;
        if (shares == 0) revert InvalidRedemptionInput();
        uint256 totalAllocated = allocatedShares[asset];
        uint256 remainingShares = redemptionSupply - totalAllocated;
        if (shares > remainingShares) revert InvalidRedemptionInput();
        uint256 remainingBalance = snapshotBalance[asset] - paid[asset];
        amountOut = FixedPointMathLib.fullMulDiv(remainingBalance, shares, remainingShares);
        if (amountOut < minAmountOut) {
            revert InsufficientRedemptionAmount(asset, amountOut, minAmountOut);
        }

        allocatedRedemptionShares[msg.sender][asset] = allocated + shares;
        allocatedShares[asset] = totalAllocated + shares;
        paid[asset] += amountOut;
        if (amountOut != 0) _checkedTransfer(asset, recipient, amountOut);
        emit RedemptionAssetClaimed(msg.sender, recipient, asset, shares, amountOut);
    }

    function sweepRedemptionExcess(address asset) external override nonReentrant returns (uint256 amount) {
        _requireStatus(Status.RedemptionsOpen);
        if (asset == address(0) || asset == shareToken || asset == address(this)) {
            revert InvalidRedeemableAsset(asset);
        }
        uint256 reserved = allocatedShares[asset] == redemptionSupply ? 0 : snapshotBalance[asset] - paid[asset];
        uint256 balance = _boundedBalanceOf(asset, address(this));
        if (balance <= reserved) revert NoRedemptionExcess(asset);
        amount = balance - reserved;
        _checkedTransfer(asset, redemptionExcessRecipient, amount);
        emit RedemptionExcessSwept(asset, redemptionExcessRecipient, amount);
    }

    function redemptionAssetState(address asset) external view override returns (uint256 balance, uint256 amountPaid) {
        return (snapshotBalance[asset], paid[asset]);
    }

    function redeemableAssetCount() external view override returns (uint256) {
        return assetRegistry.length;
    }

    function redeemableAssetAt(uint256 index) external view override returns (address) {
        return assetRegistry[index];
    }

    function redeemableAssetSnapshotStatus(address asset) external view override returns (SnapshotStatus) {
        return assetSnapshotStatus[asset];
    }

    function assetSnapshotProgress() external view override returns (uint256 frozenCount, uint256 cursor, bool frozen) {
        return (frozenAssetCount, assetSnapshotCursor, assetRegistryFrozen);
    }

    function redemptionSupplyState() external view override returns (uint256 supply, bool frozen) {
        return (redemptionSupply, redemptionSupplyFrozen);
    }

    function lockedLiquidityExitAllowed() external view override returns (bool) {
        return status == Status.WindingDown;
    }

    function liquidityMutationAllowed() external view override returns (bool) {
        return status == Status.Active || status == Status.WindingDown;
    }

    function _executeCall(Call calldata call_, address authority) internal returns (bytes memory result) {
        address target = call_.target;
        if (target == address(0) || target == address(this) || target == shareToken) {
            revert InvalidExecutionTarget(target);
        }
        executionActive = true;
        executionTarget = target;
        (bool success, bytes memory output) = target.call{value: call_.value}(call_.data);
        executionTarget = address(0);
        executionActive = false;
        if (!success) _revertCall(target, output);
        emit BoardroomCallExecuted(target, _selector(call_.data), authority, call_.value, keccak256(call_.data));
        return output;
    }

    function _registerAsset(address asset) internal {
        _validateAsset(asset);
        if (assetRegistryFrozen) revert SnapshotAlreadyFrozen();
        if (!isRedeemableAsset[asset]) {
            assetRegistry.push(asset);
            isRedeemableAsset[asset] = true;
            emit RedeemableAssetRegistered(asset);
        }
    }

    function _validateAsset(address asset) internal view {
        if (asset == address(0) || asset == shareToken || asset == address(this) || asset.code.length == 0) {
            revert InvalidRedeemableAsset(asset);
        }
        (bool readable,) = BestEffortTokenLib.tryBalanceOf(asset, address(this));
        if (!readable) revert InvalidRedeemableAsset(asset);
    }

    function _closeEscrow(address escrow) internal {
        escrowState[escrow] = EscrowState.Closed;
        openEscrowCount -= 1;
        emit BoardroomEscrowClosed(escrow);
    }

    function _isEscrowClosed(address escrow) internal view returns (bool closed) {
        assembly ("memory-safe") {
            let pointer := mload(0x40)
            mstore(pointer, shl(224, 0xc2b6b58c))
            let success := staticcall(ESCROW_PROBE_GAS, escrow, pointer, 4, pointer, 32)
            closed := and(and(success, eq(returndatasize(), 32)), eq(mload(pointer), 1))
        }
    }

    function _wrapNativeBalance() internal {
        uint256 nativeBalance = address(this).balance;
        if (nativeBalance == 0) return;
        uint256 balanceBefore = SafeTransferLib.balanceOf(wrappedNative, address(this));
        IBoardroomWrappedNative(wrappedNative).deposit{value: nativeBalance}();
        uint256 balanceAfter = SafeTransferLib.balanceOf(wrappedNative, address(this));
        uint256 expected = balanceBefore + nativeBalance;
        if (balanceAfter != expected) revert UnexpectedWrappedNativeBalanceChange(expected, balanceAfter);
        emit NativeWrappedForWindDown(wrappedNative, nativeBalance);
    }

    function _burnTreasuryShares() internal returns (uint256 burned) {
        burned = ERC20(shareToken).balanceOf(address(this));
        if (burned != 0) BoardroomToken(shareToken).burn(address(this), burned);
        emit TreasurySharesBurned(burned);
    }

    function _checkedTransfer(address asset, address recipient, uint256 expectedAmount) internal {
        ExactTransferLib.ExactDelta memory delta = ExactTransferLib.sendFromSelfTo(asset, recipient, expectedAmount);
        if (delta.senderBalanceIncreased || delta.recipientBalanceDecreased) {
            revert UnexpectedRedeemableAssetBalanceChange(asset, expectedAmount, 0);
        }
        if (delta.senderSpent != expectedAmount) {
            revert UnexpectedRedeemableAssetBalanceChange(asset, expectedAmount, delta.senderSpent);
        }
        if (delta.recipientReceived != expectedAmount) {
            revert UnexpectedRedeemableAssetBalanceChange(asset, expectedAmount, delta.recipientReceived);
        }
    }

    function _boundedBalanceOf(address asset, address account) internal view returns (uint256 amount) {
        (bool success, uint256 balance) = _tryBoundedBalanceOf(asset, account);
        if (!success) revert InvalidRedeemableAsset(asset);
        return balance;
    }

    function _tryBoundedBalanceOf(address asset, address account) internal view returns (bool success, uint256 amount) {
        assembly ("memory-safe") {
            let pointer := mload(0x40)
            mstore(pointer, shl(224, 0x70a08231))
            mstore(add(pointer, 4), account)
            success := staticcall(ASSET_PROBE_GAS, asset, pointer, 36, pointer, 32)
            success := and(success, eq(returndatasize(), 32))
            amount := mload(pointer)
        }
    }

    function _requireExecutionTarget() internal view {
        if (!executionActive || msg.sender != executionTarget) revert InvalidExecutionContext(msg.sender);
    }

    function _requireStatus(Status expected) internal view {
        if (status != expected) revert InvalidStatus(expected, status);
    }

    function _selector(bytes calldata data) internal pure returns (bytes4 selector) {
        if (data.length < 4) return bytes4(0);
        return bytes4(data[:4]);
    }

    function _revertCall(address target, bytes memory returnData) internal pure {
        if (returnData.length == 0) revert CallFailed(target);
        assembly ("memory-safe") {
            revert(add(returnData, 0x20), mload(returnData))
        }
    }

    function _guardInitializeOwner() internal pure override returns (bool) {
        return true;
    }
}
