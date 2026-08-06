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
    uint256 public constant override MAX_OBLIGATION_ASSETS = 8;
    uint256 public constant MAX_PRUNE_BATCH = 32;
    uint256 public constant override MAX_SNAPSHOT_PAGE = 32;
    uint256 public constant override MIN_WIND_DOWN_DELAY = 1 days;
    uint256 internal constant ASSET_PROBE_GAS = 30_000;
    uint256 internal constant OBLIGATION_PROBE_GAS = 30_000;
    uint256 internal constant MAX_NAME_LENGTH = 64;
    uint256 internal constant MAX_SYMBOL_LENGTH = 16;

    struct ObligationRecord {
        address registrar;
        ObligationKind kind;
        bool active;
        bool everRegistered;
    }

    address public immutable override factory;
    address public immutable override wrappedNative;
    address public override shareToken;
    address public override redemptionExcessRecipient;
    Status public override status;
    bool public override launched;
    uint256 public override windDownDelay;
    uint256 public override windDownStartedAt;

    bool internal executionActive;
    address internal executionTarget;

    address[] internal assetRegistry;
    mapping(address asset => bool registered) public override isRedeemableAsset;
    mapping(address asset => bool seen) internal assetEverRegistered;
    mapping(address asset => SnapshotStatus snapshotStatus) internal assetSnapshotStatus;
    uint256 internal frozenAssetCount;
    uint256 internal assetSnapshotCursor;
    bool internal assetRegistryFrozen;

    uint256 public override activeObligationCount;
    mapping(ObligationKind kind => uint256 count) public override activeObligationCountByKind;
    mapping(address obligation => ObligationRecord record) internal obligationRecords;
    mapping(address obligation => address[] assets) internal obligationDependencies;
    mapping(address asset => uint256 count) public override assetDependencyCount;

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
    error AlreadyLaunched();
    error OwnershipRenunciationDisabled();
    error EmptyBatch();
    error TooManyCalls(uint256 requested, uint256 maximum);
    error InvalidExecutionTarget(address target);
    error InvalidExecutionContext(address caller);
    error CallFailed(address target);
    error InvalidRedeemableAsset(address asset);
    error RedeemableAssetAlreadyRegistered(address asset);
    error EmptyRedeemableAsset(address asset);
    error RedeemableAssetDependency(address asset, uint256 dependencies);
    error RedeemableAssetHasBalance(address asset, uint256 balance);
    error TreasuryContributionExpired(uint256 deadline);
    error TreasuryContributionAmountMismatch(address asset, uint256 expected, uint256 received);
    error InvalidObligation(address obligation);
    error ObligationAlreadyClosed(address obligation);
    error ObligationAlreadyRegistered(address obligation);
    error ObligationNotActive(address obligation);
    error ObligationStillOpen(address obligation);
    error InvalidObligationKind(ObligationKind kind);
    error TooManyObligationAssets(uint256 requested, uint256 maximum);
    error DuplicateObligationAsset(address asset);
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
    event BoardroomLaunched(address indexed owner);
    event BoardroomCallExecuted(
        address indexed target, bytes4 indexed selector, address indexed authority, uint256 value, bytes32 dataHash
    );
    event SharesMinted(address indexed to, uint256 amount);
    event RedemptionExcessRecipientSet(address indexed recipient);
    event BoardroomWindDownStarted(address indexed owner, uint256 startedAt, uint256 delay);
    event RedeemableAssetRegistered(address indexed asset);
    event RedeemableAssetRemoved(address indexed asset);
    event TreasuryAssetContributed(address indexed contributor, address indexed asset, uint256 amount);
    event BoardroomObligationRecorded(
        address indexed obligation, address indexed registrar, ObligationKind indexed kind
    );
    event BoardroomObligationPruned(address indexed obligation, address indexed registrar, ObligationKind indexed kind);
    event BoardroomObligationDependency(address indexed obligation, address indexed asset);
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

    function launch() external override onlyOwner {
        _requireStatus(Status.Active);
        if (launched) revert AlreadyLaunched();
        launched = true;
        emit BoardroomLaunched(msg.sender);
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

    function executeObligation(address obligation, bytes calldata data)
        external
        override
        onlyOwner
        nonReentrant
        returns (bytes memory result)
    {
        _requireStatus(Status.WindingDown);
        ObligationRecord storage record = obligationRecords[obligation];
        if (!record.active) revert ObligationNotActive(obligation);
        (bool success, bytes memory output) = obligation.call(data);
        if (!success) _revertCall(obligation, output);
        emit BoardroomCallExecuted(obligation, _selector(data), msg.sender, 0, keccak256(data));
        if (_isObligationClosed(obligation)) _deactivateObligation(obligation, record);
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

    function removeRedeemableAsset(address asset) external override onlyOwner {
        _requireStatus(Status.Active);
        if (asset == wrappedNative || !isRedeemableAsset[asset]) revert InvalidRedeemableAsset(asset);
        uint256 dependencies = assetDependencyCount[asset];
        if (dependencies != 0) revert RedeemableAssetDependency(asset, dependencies);
        (bool readable, uint256 balance) = BestEffortTokenLib.tryBalanceOf(asset, address(this));
        if (!readable) revert InvalidRedeemableAsset(asset);
        if (balance != 0) revert RedeemableAssetHasBalance(asset, balance);
        isRedeemableAsset[asset] = false;
        emit RedeemableAssetRemoved(asset);
    }

    function registerObligation(address obligation, ObligationKind kind, address[] calldata assets) external override {
        _requireExecutionTarget();
        _requireStatus(Status.Active);
        if (
            obligation == address(0) || obligation == address(this) || obligation == shareToken
                || obligation.code.length == 0
        ) revert InvalidObligation(obligation);
        if (kind != ObligationKind.Grant && kind != ObligationKind.Liquidity) revert InvalidObligationKind(kind);
        ObligationRecord storage record = obligationRecords[obligation];
        if (record.everRegistered) revert ObligationAlreadyRegistered(obligation);
        if (_isObligationClosed(obligation)) revert ObligationAlreadyClosed(obligation);
        uint256 length = assets.length;
        if (length > MAX_OBLIGATION_ASSETS) revert TooManyObligationAssets(length, MAX_OBLIGATION_ASSETS);

        record.registrar = msg.sender;
        record.kind = kind;
        record.active = true;
        record.everRegistered = true;
        activeObligationCount += 1;
        activeObligationCountByKind[kind] += 1;

        for (uint256 i; i < length; ++i) {
            address asset = assets[i];
            for (uint256 j; j < i; ++j) {
                if (assets[j] == asset) revert DuplicateObligationAsset(asset);
            }
            _registerAsset(asset);
            obligationDependencies[obligation].push(asset);
            assetDependencyCount[asset] += 1;
            emit BoardroomObligationDependency(obligation, asset);
        }
        emit BoardroomObligationRecorded(obligation, msg.sender, kind);
    }

    function pruneObligation(address obligation) external override returns (bool pruned) {
        ObligationRecord storage record = obligationRecords[obligation];
        if (!record.active) revert ObligationNotActive(obligation);
        if (!_isObligationClosed(obligation)) revert ObligationStillOpen(obligation);
        _deactivateObligation(obligation, record);
        return true;
    }

    function pruneObligations(address[] calldata obligations) external override returns (uint256 pruned) {
        uint256 length = obligations.length;
        if (length == 0) revert EmptyBatch();
        if (length > MAX_PRUNE_BATCH) revert TooManyCalls(length, MAX_PRUNE_BATCH);
        for (uint256 i; i < length; ++i) {
            ObligationRecord storage record = obligationRecords[obligations[i]];
            if (record.active && _isObligationClosed(obligations[i])) {
                _deactivateObligation(obligations[i], record);
                ++pruned;
            }
        }
    }

    function obligationOf(address obligation)
        external
        view
        override
        returns (address registrar, ObligationKind kind, bool active, bool everRegistered)
    {
        ObligationRecord storage record = obligationRecords[obligation];
        return (record.registrar, record.kind, record.active, record.everRegistered);
    }

    function isIssuedGrant(address obligation) external view override returns (bool) {
        ObligationRecord storage record = obligationRecords[obligation];
        return record.active && record.kind == ObligationKind.Grant;
    }

    function isLockedLiquidity(address obligation) external view override returns (bool) {
        ObligationRecord storage record = obligationRecords[obligation];
        return record.active && record.kind == ObligationKind.Liquidity;
    }

    function obligationDependencyCount(address obligation) external view override returns (uint256) {
        return obligationDependencies[obligation].length;
    }

    function obligationDependencyAt(address obligation, uint256 index) external view override returns (address) {
        return obligationDependencies[obligation][index];
    }

    function beginSnapshot() external override nonReentrant {
        _requireStatus(Status.WindingDown);
        if (block.timestamp < windDownStartedAt + windDownDelay || activeObligationCount != 0) {
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
            if (!isRedeemableAsset[asset]) {
                assetSnapshotStatus[asset] = SnapshotStatus.Excluded;
                continue;
            }
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

    function burnTreasuryShares() external override nonReentrant returns (uint256 burned) {
        _requireStatus(Status.WindingDown);
        return _burnTreasuryShares();
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

    function redeemableAssetPage(uint256 cursor, uint256 size)
        external
        view
        override
        returns (address[] memory page, uint256 nextCursor)
    {
        if (size == 0 || size > MAX_SNAPSHOT_PAGE) revert InvalidSnapshotPage(size, MAX_SNAPSHOT_PAGE);
        uint256 length = assetRegistry.length;
        if (cursor >= length) return (new address[](0), length);
        uint256 end = cursor + size;
        if (end > length) end = length;
        page = new address[](end - cursor);
        for (uint256 i; i < page.length; ++i) {
            page[i] = assetRegistry[cursor + i];
        }
        nextCursor = end;
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
        if (!assetEverRegistered[asset]) {
            assetEverRegistered[asset] = true;
            assetRegistry.push(asset);
        }
        if (!isRedeemableAsset[asset]) {
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

    function _deactivateObligation(address obligation, ObligationRecord storage record) internal {
        record.active = false;
        activeObligationCount -= 1;
        activeObligationCountByKind[record.kind] -= 1;
        address[] storage dependencies = obligationDependencies[obligation];
        uint256 length = dependencies.length;
        for (uint256 i; i < length; ++i) {
            assetDependencyCount[dependencies[i]] -= 1;
        }
        emit BoardroomObligationPruned(obligation, record.registrar, record.kind);
    }

    function _isObligationClosed(address obligation) internal view returns (bool closed) {
        assembly ("memory-safe") {
            let pointer := mload(0x40)
            mstore(pointer, shl(224, 0xc2b6b58c))
            let success := staticcall(OBLIGATION_PROBE_GAS, obligation, pointer, 4, pointer, 32)
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
