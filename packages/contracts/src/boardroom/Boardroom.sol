// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "solady/auth/Ownable.sol";
import {Initializable} from "solady/utils/Initializable.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {BoardroomToken} from "./BoardroomToken.sol";
import {IBoardroomPolicyRegistry} from "./IBoardroomPolicyRegistry.sol";
import {BoardroomRedemptionPayout} from "./BoardroomRedemptionPayout.sol";
import {BoardroomRedemptionStorage} from "./BoardroomRedemptionStorage.sol";
import {TokenGrant} from "../grants/TokenGrant.sol";
import {LockedLiquidity} from "../liquidity/LockedLiquidity.sol";
import {LockedLiquidityFactory} from "../liquidity/LockedLiquidityFactory.sol";
import {IBoardroomObligationPolicy} from "../policy/IBoardroomObligationPolicy.sol";

interface IBoardroomDistribution {
    function factory() external view returns (address);
    function boardroom() external view returns (address);
    function isClosed() external view returns (bool);
}

contract Boardroom is Ownable, Initializable, ReentrancyGuard {
    uint256 public constant MAX_BATCH_CALLS = 16;
    uint256 public constant MAX_GOVERNANCE_DELAY = 30 days;
    uint256 public constant MAX_REDEEMABLE_ASSETS = 32;
    uint256 public constant MAX_ISSUED_GRANTS = 128;
    uint256 public constant MAX_ISSUED_DISTRIBUTIONS = 128;
    uint256 public constant MAX_LOCKED_LIQUIDITY_POSITIONS = 32;

    enum BoardroomStatus {
        Active,
        WindingDown,
        RedemptionsOpen
    }

    struct Call {
        address policy;
        address target;
        uint256 value;
        bytes data;
    }

    address public policyRegistry;
    address public shareToken;
    address public wrappedNative;
    address public immutable redemptionPayoutLogic;
    BoardroomStatus public status;
    bool public launched;
    address public executor;
    uint256 public governanceDelay;

    address[] internal redeemableAssets;
    address[] internal issuedGrants;
    address[] internal issuedDistributions;
    address[] internal lockedLiquidityPositions;
    uint256 public issuedGrantSlotReservations;

    mapping(bytes32 => uint256) public queuedActionEta;
    mapping(address => bool) public isRedeemableAsset;
    mapping(address => bool) public isIssuedGrant;
    mapping(address => bool) public isIssuedDistribution;
    mapping(address => bool) public isLockedLiquidity;
    mapping(address => uint256) public issuedGrantReservationsForDistribution;
    mapping(address => address) public obligationPolicyOf;

    error InvalidAddress();
    error InvalidAmount();
    error InvalidStatus(BoardroomStatus expected, BoardroomStatus actual);
    error InvalidRedemptionInput();
    error ZeroRedemptionAmount(address asset);
    error RedeemableAssetAlreadyRegistered(address asset);
    error TooManyRedeemableAssets();
    error TooManyIssuedGrants();
    error TooManyIssuedGrantReservations(uint256 requested, uint256 available);
    error TooManyIssuedDistributions();
    error TooManyLockedLiquidityPositions();
    error NoReservedIssuedGrantSlots(address distribution);
    error InvalidRedeemableAsset(address asset);
    error InvalidIssuedGrant(address grant);
    error InvalidIssuedDistribution(address distribution);
    error InvalidLockedLiquidity(address locker);
    error IssuedGrantStillOpen(address grant);
    error IssuedDistributionStillOpen(address distribution);
    error LockedLiquidityStillOpen(address locker);
    error InsufficientRedemptionAmount(address asset, uint256 amountOut, uint256 minAmountOut);
    error UnexpectedRedeemableAssetBalanceChange(address asset, uint256 expected, uint256 actual);
    error EmptyBatch();
    error TooManyCalls(uint256 requested, uint256 maximum);
    error PolicyNotAllowed(address policy);
    error CallNotAllowed(address policy, address target, bytes4 selector);
    error CallFailed(address target);
    error UnexpectedWrappedNativeBalanceChange(uint256 expected, uint256 actual);
    error BoardroomAlreadyLaunched();
    error BoardroomNotLaunched();
    error InvalidGovernanceDelay();
    error InvalidExecutor();
    error ActionAlreadyQueued(bytes32 actionHash);
    error ActionNotQueued(bytes32 actionHash);
    error ActionNotReady(bytes32 actionHash, uint256 eta, uint256 currentTime);
    error ModulePolicyRequired(address target);
    error ObligationPolicyMismatch(address target, address expectedPolicy, address actualPolicy);
    error NotShareholder(address account);

    event BoardroomInitialized(
        address indexed owner,
        address indexed policyRegistry,
        address indexed shareToken,
        address wrappedNative,
        string name,
        string symbol
    );
    event SharesMinted(address indexed to, uint256 amount);
    event NativeWrappedForWindDown(address indexed wrappedNative, uint256 amount);
    event BoardroomWindDownStarted(address indexed owner);
    event BoardroomRedemptionsOpened(address indexed owner);
    event RedeemableAssetRegistered(address indexed asset);
    event TreasurySharesBurned(uint256 amount);
    event BoardroomGrantRecorded(address indexed grant);
    event BoardroomGrantSlotsReserved(address indexed distribution, uint256 count);
    event BoardroomGrantSlotsReleased(address indexed distribution, uint256 count);
    event BoardroomDistributionRecorded(address indexed distribution);
    event BoardroomLockedLiquidityRecorded(address indexed locker);
    event BoardroomLockedLiquidityExited(
        address indexed locker, address indexed pool, uint256 liquidity, uint256 amountA, uint256 amountB
    );
    event SharesRedeemed(
        address indexed holder, address indexed recipient, uint256 shares, address[] assets, uint256[] amounts
    );
    event BoardroomLaunched(address indexed executor, uint256 governanceDelay);
    event ExecutorSet(address indexed executor);
    event BoardroomActionQueued(bytes32 indexed actionHash, address indexed executor, uint256 eta, bytes32 salt);
    event BoardroomActionCancelled(bytes32 indexed actionHash, address indexed caller);
    event BoardroomActionExecuted(bytes32 indexed actionHash, address indexed caller);
    event BoardroomCallExecuted(
        address indexed policy, address indexed target, bytes4 indexed selector, uint256 value, bytes32 dataHash
    );
    event BoardroomGrantPruned(address indexed grant);
    event BoardroomDistributionPruned(address indexed distribution);
    event BoardroomLockedLiquidityPruned(address indexed locker);
    event RedemptionAssetClaimed(
        address indexed holder, address indexed recipient, address indexed asset, uint256 shares, uint256 amount
    );
    event RedemptionAssetClaimFailed(address indexed holder, address indexed recipient, address indexed asset);

    constructor(address redemptionPayoutLogic_) {
        if (redemptionPayoutLogic_ == address(0)) revert InvalidAddress();
        redemptionPayoutLogic = redemptionPayoutLogic_;
        _disableInitializers();
    }

    receive() external payable {}

    function transferOwnership(address newOwner) public payable override {
        address oldOwner = owner();
        super.transferOwnership(newOwner);
        _syncExecutorAfterOwnershipTransfer(oldOwner, newOwner);
    }

    function completeOwnershipHandover(address pendingOwner) public payable override {
        address oldOwner = owner();
        super.completeOwnershipHandover(pendingOwner);
        _syncExecutorAfterOwnershipTransfer(oldOwner, pendingOwner);
    }

    function initialize(
        address owner_,
        address policyRegistry_,
        address wrappedNative_,
        string calldata name_,
        string calldata symbol_
    ) external initializer {
        if (owner_ == address(0) || policyRegistry_ == address(0) || wrappedNative_ == address(0)) {
            revert InvalidAddress();
        }

        _initializeOwner(owner_);
        policyRegistry = policyRegistry_;
        wrappedNative = wrappedNative_;
        executor = owner_;
        shareToken = address(new BoardroomToken(address(this), name_, symbol_));
        isRedeemableAsset[wrappedNative_] = true;
        redeemableAssets.push(wrappedNative_);

        emit BoardroomInitialized(owner_, policyRegistry_, shareToken, wrappedNative_, name_, symbol_);
        emit ExecutorSet(owner_);
        emit RedeemableAssetRegistered(wrappedNative_);
    }

    function setExecutor(address executor_) external {
        _requireGovernanceCaller();
        _setExecutor(executor_);
    }

    function launch(uint256 governanceDelay_) external {
        _requirePrelaunchOwner();
        if (governanceDelay_ == 0 || governanceDelay_ > MAX_GOVERNANCE_DELAY) revert InvalidGovernanceDelay();

        launched = true;
        governanceDelay = governanceDelay_;
        emit BoardroomLaunched(executor, governanceDelay_);
    }

    function mint(address to, uint256 amount) external {
        _requireGovernanceCaller();
        _mintShares(to, amount);
    }

    function _mintShares(address to, uint256 amount) internal {
        _requireStatus(BoardroomStatus.Active);
        if (to == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();

        BoardroomToken(shareToken).mint(to, amount);
        emit SharesMinted(to, amount);
    }

    function execute(Call calldata call_) external payable nonReentrant returns (bytes memory result) {
        _requirePrelaunchOwner();
        result = _execute(call_);
    }

    function executeBatch(Call[] calldata calls) external payable nonReentrant returns (bytes[] memory results) {
        _requirePrelaunchOwner();
        results = _executeBatch(calls);
    }

    function queueAction(Call calldata call_, bytes32 salt) external returns (bytes32 actionHash, uint256 eta) {
        _requireLaunchedExecutor();
        _requireNotRedemptionsOpen();

        actionHash = hashAction(call_, salt);
        eta = _queueAction(actionHash, salt);
    }

    function queueBatch(Call[] calldata calls, bytes32 salt) external returns (bytes32 actionHash, uint256 eta) {
        _requireLaunchedExecutor();
        _requireNotRedemptionsOpen();
        _requireValidBatchLength(calls.length);

        actionHash = hashBatch(calls, salt);
        eta = _queueAction(actionHash, salt);
    }

    function executeQueuedAction(Call calldata call_, bytes32 salt)
        external
        payable
        nonReentrant
        returns (bytes memory result)
    {
        _requireBoardroomLaunched();
        bytes32 actionHash = hashAction(call_, salt);
        _consumeReadyAction(actionHash);
        result = _execute(call_);
        emit BoardroomActionExecuted(actionHash, msg.sender);
    }

    function executeQueuedBatch(Call[] calldata calls, bytes32 salt)
        external
        payable
        nonReentrant
        returns (bytes[] memory results)
    {
        _requireBoardroomLaunched();
        _requireValidBatchLength(calls.length);
        bytes32 actionHash = hashBatch(calls, salt);
        _consumeReadyAction(actionHash);
        results = _executeBatch(calls);
        emit BoardroomActionExecuted(actionHash, msg.sender);
    }

    function cancelAction(bytes32 actionHash) external {
        _requireLaunchedShareholder();

        if (queuedActionEta[actionHash] == 0) revert ActionNotQueued(actionHash);
        delete queuedActionEta[actionHash];
        emit BoardroomActionCancelled(actionHash, msg.sender);
    }

    function hashAction(Call calldata call_, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encode(_hashCall(call_), salt));
    }

    function hashBatch(Call[] calldata calls, bytes32 salt) public pure returns (bytes32 actionHash) {
        uint256 length = calls.length;
        bytes32[] memory callHashes = new bytes32[](length);
        for (uint256 i; i < length; ++i) {
            callHashes[i] = _hashCall(calls[i]);
        }

        actionHash = keccak256(abi.encode(callHashes, salt));
    }

    function startWindDown() external nonReentrant {
        _requireWindDownStarter();
        _startWindDown();
    }

    function _executeBatch(Call[] calldata calls) internal returns (bytes[] memory results) {
        uint256 length = calls.length;
        _requireValidBatchLength(length);

        results = new bytes[](length);
        for (uint256 i; i < length; ++i) {
            results[i] = _execute(calls[i]);
        }
    }

    function _startWindDown() internal {
        _requireStatus(BoardroomStatus.Active);

        _wrapNativeBalanceForWindDown();
        status = BoardroomStatus.WindingDown;
        emit BoardroomWindDownStarted(msg.sender);
    }

    function wrapNativeBalance() external nonReentrant {
        _requireGovernanceCaller();
        _wrapNativeBalanceForWindDown();
    }

    function registerRedeemableAsset(address asset) external {
        _requireGovernanceCaller();
        _registerRedeemableAssetGoverned(asset);
    }

    function _registerRedeemableAssetGoverned(address asset) internal {
        BoardroomStatus currentStatus = status;
        if (currentStatus == BoardroomStatus.RedemptionsOpen) {
            revert InvalidStatus(BoardroomStatus.WindingDown, currentStatus);
        }
        _registerRedeemableAsset(asset);
    }

    function burnTreasuryShares() external returns (uint256 burned) {
        _requireGovernanceCaller();
        burned = _burnTreasurySharesGoverned();
    }

    function _burnTreasurySharesGoverned() internal returns (uint256 burned) {
        _requireStatus(BoardroomStatus.WindingDown);
        burned = _burnTreasuryShares();
    }

    function exitLockedLiquidity(address locker, uint256 amountAMin, uint256 amountBMin, uint256 deadline)
        external
        returns (uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        _requireGovernanceCaller();
        (amountA, amountB, liquidity) = _exitLockedLiquidity(locker, amountAMin, amountBMin, deadline);
    }

    function _exitLockedLiquidity(address locker, uint256 amountAMin, uint256 amountBMin, uint256 deadline)
        internal
        returns (uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        _requireStatus(BoardroomStatus.WindingDown);
        if (!isLockedLiquidity[locker]) revert InvalidLockedLiquidity(locker);

        LockedLiquidity position = LockedLiquidity(locker);
        address tokenA = position.tokenA();
        address tokenB = position.tokenB();
        address pool = position.pool();

        (amountA, amountB, liquidity) = position.exitToBoardroom(amountAMin, amountBMin, deadline);

        _registerRedeemableAssetIfNeeded(tokenA);
        _registerRedeemableAssetIfNeeded(tokenB);
        _burnTreasuryShares();
        _pruneClosedObligation(locker);

        emit BoardroomLockedLiquidityExited(locker, pool, liquidity, amountA, amountB);
    }

    function openRedemptions() external {
        _requireGovernanceCaller();
        _openRedemptions();
    }

    function _openRedemptions() internal {
        _requireStatus(BoardroomStatus.WindingDown);
        _wrapNativeBalanceForWindDown();
        _pruneClosedObligations();
        if (issuedGrants.length != 0) revert IssuedGrantStillOpen(issuedGrants[0]);
        if (issuedDistributions.length != 0) revert IssuedDistributionStillOpen(issuedDistributions[0]);
        if (lockedLiquidityPositions.length != 0) revert LockedLiquidityStillOpen(lockedLiquidityPositions[0]);

        _registerRedeemableAssetIfNeeded(wrappedNative);
        _burnTreasuryShares();
        BoardroomRedemptionStorage.layout().supply = BoardroomToken(shareToken).totalSupply();
        status = BoardroomStatus.RedemptionsOpen;
        emit BoardroomRedemptionsOpened(msg.sender);
    }

    function redeem(uint256 shares, address recipient, uint256[] calldata minAmountsOut)
        external
        nonReentrant
        returns (uint256[] memory amountsOut)
    {
        _requireStatus(BoardroomStatus.RedemptionsOpen);
        _wrapNativeBalanceForWindDown();
        _burnTreasuryShares();
        bytes memory input = abi.encodeCall(
            BoardroomRedemptionPayout.redeem,
            (shareToken, msg.sender, shares, recipient, redeemableAssets, minAmountsOut)
        );
        (bool success, bytes memory result) = redemptionPayoutLogic.delegatecall(input);
        if (!success) _revertCall(redemptionPayoutLogic, result);
        amountsOut = abi.decode(result, (uint256[]));
    }

    /// @dev Self-call endpoint used by the bounded-gas redemption coordinator.
    function payoutRedemptionAsset(address holder, address asset, address recipient, uint256 minAmountOut)
        external
        returns (uint256 amountOut)
    {
        if (msg.sender != address(this)) revert Unauthorized();
        (bool success, bytes memory result) =
            _delegateRedemptionPayout(holder, asset, recipient, minAmountOut, gasleft());
        if (!success) _revertCall(redemptionPayoutLogic, result);
        amountOut = abi.decode(result, (uint256));
    }

    /// @notice Retries one asset claim retained from an earlier partial redemption.
    function claimRedemptionAsset(address asset, address recipient, uint256 minAmountOut)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        _requireStatus(BoardroomStatus.RedemptionsOpen);
        if (!isRedeemableAsset[asset] || recipient == address(0) || recipient == address(this)) {
            revert InvalidRedemptionInput();
        }

        _wrapNativeBalanceForWindDown();
        _burnTreasuryShares();
        (bool success, bytes memory result) =
            _delegateRedemptionPayout(msg.sender, asset, recipient, minAmountOut, gasleft());
        if (!success) _revertCall(redemptionPayoutLogic, result);
        amountOut = abi.decode(result, (uint256));
    }

    function redemptionCredits(address holder) external view returns (uint256) {
        return BoardroomRedemptionStorage.layout().credits[holder];
    }

    function allocatedRedemptionShares(address holder, address asset) external view returns (uint256) {
        return BoardroomRedemptionStorage.layout().holderAllocatedShares[holder][asset];
    }

    function redeemableAssetCount() external view returns (uint256) {
        return redeemableAssets.length;
    }

    function redeemableAssetAt(uint256 index) external view returns (address) {
        return redeemableAssets[index];
    }

    function getRedeemableAssets() external view returns (address[] memory) {
        return redeemableAssets;
    }

    function issuedGrantCount() external view returns (uint256) {
        return issuedGrants.length;
    }

    function issuedGrantAt(uint256 index) external view returns (address) {
        return issuedGrants[index];
    }

    function getIssuedGrants() external view returns (address[] memory) {
        return issuedGrants;
    }

    function issuedDistributionCount() external view returns (uint256) {
        return issuedDistributions.length;
    }

    function issuedDistributionAt(uint256 index) external view returns (address) {
        return issuedDistributions[index];
    }

    function getIssuedDistributions() external view returns (address[] memory) {
        return issuedDistributions;
    }

    function lockedLiquidityCount() external view returns (uint256) {
        return lockedLiquidityPositions.length;
    }

    function lockedLiquidityAt(uint256 index) external view returns (address) {
        return lockedLiquidityPositions[index];
    }

    function getLockedLiquidityPositions() external view returns (address[] memory) {
        return lockedLiquidityPositions;
    }

    /// @notice Permissionlessly removes closed obligations from the bounded active sets.
    function pruneClosedObligations() external nonReentrant {
        _pruneClosedObligations();
    }

    function lockedLiquidityExitAllowed() external view returns (bool) {
        return status == BoardroomStatus.WindingDown;
    }

    function recordLockedLiquidityFromDistribution(address locker, address pool) external {
        BoardroomStatus currentStatus = status;
        if (currentStatus == BoardroomStatus.RedemptionsOpen) {
            revert InvalidStatus(BoardroomStatus.Active, currentStatus);
        }
        if (!isIssuedDistribution[msg.sender]) revert InvalidIssuedDistribution(msg.sender);

        _recordLockedLiquidityPosition(locker, pool, address(0));
    }

    function recordGrantFromDistribution(address grant) external {
        _requireStatus(BoardroomStatus.Active);
        if (!isIssuedDistribution[msg.sender]) revert InvalidIssuedDistribution(msg.sender);
        _consumeIssuedGrantReservation(msg.sender);

        _recordIssuedGrant(TokenGrant(grant).factory(), abi.encode(grant));
    }

    function _execute(Call calldata call_) internal returns (bytes memory result) {
        address policy = call_.policy;
        address target = call_.target;
        if (target == address(0)) revert InvalidAddress();

        bytes4 selector = _selector(call_.data);
        BoardroomStatus currentStatus = status;
        _authorizeCallForStatus(currentStatus, policy, target, selector, call_.value, call_.data);

        if (_isSelfCallWithoutPolicy(policy, target) && selector == Boardroom.wrapNativeBalance.selector) {
            if (call_.value != 0) revert CallNotAllowed(policy, target, selector);
            _wrapNativeBalanceForWindDown();
        } else {
            result = _executeExternalCall(call_);
        }

        _recordPostCallEffects(currentStatus, policy, target, selector, call_.value, call_.data, result);

        emit BoardroomCallExecuted(policy, target, selector, call_.value, keccak256(call_.data));
    }

    function _authorizeCallForStatus(
        BoardroomStatus currentStatus,
        address policy,
        address target,
        bytes4 selector,
        uint256 value,
        bytes calldata data
    ) internal view {
        if (currentStatus == BoardroomStatus.RedemptionsOpen) {
            revert InvalidStatus(BoardroomStatus.Active, currentStatus);
        }

        address canonicalPolicy = obligationPolicyOf[target];
        if (currentStatus == BoardroomStatus.WindingDown && canonicalPolicy == address(0)) {
            if (!_isBoardroomWindDownGovernanceCall(policy, target, selector)) {
                revert CallNotAllowed(policy, target, selector);
            }
            return;
        }

        IBoardroomPolicyRegistry(policyRegistry)
            .authorizeCall(address(this), msg.sender, policy, target, value, data, canonicalPolicy);
    }

    function _isBoardroomWindDownGovernanceCall(address policy, address target, bytes4 selector)
        internal
        view
        returns (bool)
    {
        if (!_isSelfCallWithoutPolicy(policy, target)) return false;
        return _isWindDownGovernanceSelector(selector);
    }

    function _isSelfCallWithoutPolicy(address policy, address target) internal view returns (bool) {
        return policy == address(0) && target == address(this);
    }

    function _isWindDownGovernanceSelector(bytes4 selector) internal pure returns (bool) {
        return selector == Boardroom.setExecutor.selector || selector == Boardroom.wrapNativeBalance.selector
            || selector == Boardroom.registerRedeemableAsset.selector
            || selector == Boardroom.burnTreasuryShares.selector || selector == Boardroom.exitLockedLiquidity.selector
            || selector == Boardroom.openRedemptions.selector;
    }

    function _executeExternalCall(Call calldata call_) internal returns (bytes memory result) {
        bool success;
        (success, result) = call_.target.call{value: call_.value}(call_.data);
        if (!success) _revertCall(call_.target, result);
    }

    function _recordPostCallEffects(
        BoardroomStatus currentStatus,
        address policy,
        address target,
        bytes4 selector,
        uint256 value,
        bytes calldata data,
        bytes memory result
    ) internal {
        if (obligationPolicyOf[target] != address(0)) {
            _recordLifecycleCall(policy, target, selector);
            return;
        }

        if (
            currentStatus == BoardroomStatus.Active && policy != address(0)
                && IBoardroomPolicyRegistry(policyRegistry).isModulePolicy(policy)
        ) {
            _recordIssuedObligation(policy, target, value, data, result);
        }
    }

    function _recordIssuedObligation(
        address policy,
        address target,
        uint256 value,
        bytes calldata data,
        bytes memory result
    ) internal {
        IBoardroomObligationPolicy.Obligation memory obligation = IBoardroomObligationPolicy(policy)
            .obligationForCall(address(this), target, value, data, result);
        _recordObligation(policy, obligation);
    }

    function _recordObligation(address factory, IBoardroomObligationPolicy.Obligation memory obligation) internal {
        if (obligation.kind == IBoardroomObligationPolicy.ObligationKind.None) {
            return;
        }
        if (obligation.kind == IBoardroomObligationPolicy.ObligationKind.Grant) {
            _recordIssuedGrant(factory, abi.encode(obligation.account));
            return;
        }
        if (obligation.kind == IBoardroomObligationPolicy.ObligationKind.Distribution) {
            _recordIssuedDistribution(factory, abi.encode(obligation.account));
            _reserveIssuedGrantSlots(obligation.account, obligation.grantSlotReservations);
            return;
        }
        if (obligation.kind == IBoardroomObligationPolicy.ObligationKind.LockedLiquidity) {
            _recordLockedLiquidityPosition(obligation.account, obligation.aux, factory);
        }
    }

    function _recordLifecycleCall(address policy, address target, bytes4 selector) internal {
        address distribution =
            IBoardroomObligationPolicy(policy).grantSlotReleaseForLifecycleCall(address(this), target, selector);
        if (distribution != address(0)) _releaseIssuedGrantSlots(distribution);
        _pruneClosedObligation(target);
    }

    function _recordIssuedGrant(address factory, bytes memory result) internal {
        if (_remainingIssuedGrantSlots() == 0) revert TooManyIssuedGrants();

        address grant = abi.decode(result, (address));
        if (
            grant == address(0) || obligationPolicyOf[grant] != address(0)
                || !IBoardroomPolicyRegistry(policyRegistry).isModulePolicy(factory)
        ) revert InvalidIssuedGrant(grant);

        TokenGrant tokenGrant = TokenGrant(grant);
        if (tokenGrant.issuer() != address(this) || tokenGrant.factory() != factory) revert InvalidIssuedGrant(grant);

        isIssuedGrant[grant] = true;
        obligationPolicyOf[grant] = factory;
        issuedGrants.push(grant);
        emit BoardroomGrantRecorded(grant);
    }

    function _recordIssuedDistribution(address factory, bytes memory result) internal returns (address distribution) {
        if (issuedDistributions.length >= MAX_ISSUED_DISTRIBUTIONS) revert TooManyIssuedDistributions();

        distribution = abi.decode(result, (address));
        if (
            distribution == address(0) || obligationPolicyOf[distribution] != address(0)
                || !IBoardroomPolicyRegistry(policyRegistry).isModulePolicy(factory)
        ) {
            revert InvalidIssuedDistribution(distribution);
        }

        IBoardroomDistribution issuedDistribution = IBoardroomDistribution(distribution);
        if (issuedDistribution.boardroom() != address(this) || issuedDistribution.factory() != factory) {
            revert InvalidIssuedDistribution(distribution);
        }

        isIssuedDistribution[distribution] = true;
        obligationPolicyOf[distribution] = factory;
        issuedDistributions.push(distribution);
        emit BoardroomDistributionRecorded(distribution);
    }

    function _reserveIssuedGrantSlots(address distribution, uint256 count) internal {
        if (count == 0) return;

        uint256 available = _remainingIssuedGrantSlots();
        if (count > available) revert TooManyIssuedGrantReservations(count, available);

        issuedGrantReservationsForDistribution[distribution] = count;
        issuedGrantSlotReservations += count;
        emit BoardroomGrantSlotsReserved(distribution, count);
    }

    function _consumeIssuedGrantReservation(address distribution) internal {
        uint256 reserved = issuedGrantReservationsForDistribution[distribution];
        if (reserved == 0) revert NoReservedIssuedGrantSlots(distribution);

        issuedGrantReservationsForDistribution[distribution] = reserved - 1;
        issuedGrantSlotReservations -= 1;
    }

    function _releaseIssuedGrantSlots(address distribution) internal {
        uint256 reserved = issuedGrantReservationsForDistribution[distribution];
        if (reserved == 0) return;

        issuedGrantReservationsForDistribution[distribution] = 0;
        issuedGrantSlotReservations -= reserved;
        emit BoardroomGrantSlotsReleased(distribution, reserved);
    }

    function _remainingIssuedGrantSlots() internal view returns (uint256) {
        uint256 usedAndReserved = issuedGrants.length + issuedGrantSlotReservations;
        if (usedAndReserved >= MAX_ISSUED_GRANTS) return 0;
        return MAX_ISSUED_GRANTS - usedAndReserved;
    }

    function _recordLockedLiquidityPosition(address locker, address pool, address expectedFactory) internal {
        if (lockedLiquidityPositions.length >= MAX_LOCKED_LIQUIDITY_POSITIONS) {
            revert TooManyLockedLiquidityPositions();
        }

        if (locker == address(0) || obligationPolicyOf[locker] != address(0)) revert InvalidLockedLiquidity(locker);

        LockedLiquidity position = LockedLiquidity(locker);
        address factory = position.factory();
        if (expectedFactory != address(0) && factory != expectedFactory) revert InvalidLockedLiquidity(locker);
        if (!IBoardroomPolicyRegistry(policyRegistry).isModulePolicy(factory)) revert InvalidLockedLiquidity(locker);

        bool lockerMatchesBoardroom = position.boardroom() == address(this);
        bool lockerMatchesPool = position.pool() == pool;
        bool lockerIsFromFactory = LockedLiquidityFactory(factory).isLocker(locker);
        if (!lockerMatchesBoardroom || !lockerMatchesPool || !lockerIsFromFactory) {
            revert InvalidLockedLiquidity(locker);
        }

        _registerRedeemableAssetIfNeeded(position.tokenA());
        _registerRedeemableAssetIfNeeded(position.tokenB());

        isLockedLiquidity[locker] = true;
        obligationPolicyOf[locker] = factory;
        lockedLiquidityPositions.push(locker);
        emit BoardroomLockedLiquidityRecorded(locker);
    }

    function _registerRedeemableAsset(address asset) internal {
        if (!_isValidRedeemableAsset(asset)) revert InvalidRedeemableAsset(asset);
        if (isRedeemableAsset[asset]) revert RedeemableAssetAlreadyRegistered(asset);
        if (redeemableAssets.length >= MAX_REDEEMABLE_ASSETS) revert TooManyRedeemableAssets();

        isRedeemableAsset[asset] = true;
        redeemableAssets.push(asset);
        emit RedeemableAssetRegistered(asset);
    }

    function _registerRedeemableAssetIfNeeded(address asset) internal {
        if (!_isValidRedeemableAsset(asset) || isRedeemableAsset[asset]) return;
        _registerRedeemableAsset(asset);
    }

    function _isValidRedeemableAsset(address asset) internal view returns (bool) {
        return asset != address(0) && asset != shareToken && asset != address(this);
    }

    function _wrapNativeBalanceForWindDown() internal {
        (bool success, bytes memory result) =
            redemptionPayoutLogic.delegatecall(abi.encodeCall(BoardroomRedemptionPayout.wrapNative, (wrappedNative)));
        if (!success) _revertCall(redemptionPayoutLogic, result);
    }

    function _pruneClosedObligations() internal {
        (bool success, bytes memory result) = redemptionPayoutLogic.delegatecall(
            abi.encodeCall(BoardroomRedemptionPayout.pruneClosedObligations, (_obligationSlots()))
        );
        if (!success) _revertCall(redemptionPayoutLogic, result);
    }

    function _pruneClosedObligation(address target) internal {
        (bool success, bytes memory result) = redemptionPayoutLogic.delegatecall(
            abi.encodeCall(BoardroomRedemptionPayout.pruneClosedObligation, (_obligationSlots(), target))
        );
        if (!success) _revertCall(redemptionPayoutLogic, result);
    }

    function _obligationSlots() internal pure returns (BoardroomRedemptionPayout.ObligationSlots memory slots) {
        uint256 issuedGrantsSlot;
        uint256 issuedDistributionsSlot;
        uint256 lockedLiquidityPositionsSlot;
        uint256 issuedGrantSlotReservationsSlot;
        uint256 isIssuedGrantSlot;
        uint256 isIssuedDistributionSlot;
        uint256 isLockedLiquiditySlot;
        uint256 reservationsForDistributionSlot;
        assembly ("memory-safe") {
            issuedGrantsSlot := issuedGrants.slot
            issuedDistributionsSlot := issuedDistributions.slot
            lockedLiquidityPositionsSlot := lockedLiquidityPositions.slot
            issuedGrantSlotReservationsSlot := issuedGrantSlotReservations.slot
            isIssuedGrantSlot := isIssuedGrant.slot
            isIssuedDistributionSlot := isIssuedDistribution.slot
            isLockedLiquiditySlot := isLockedLiquidity.slot
            reservationsForDistributionSlot := issuedGrantReservationsForDistribution.slot
        }
        slots = BoardroomRedemptionPayout.ObligationSlots({
            issuedGrants: issuedGrantsSlot,
            issuedDistributions: issuedDistributionsSlot,
            lockedLiquidityPositions: lockedLiquidityPositionsSlot,
            issuedGrantSlotReservations: issuedGrantSlotReservationsSlot,
            isIssuedGrant: isIssuedGrantSlot,
            isIssuedDistribution: isIssuedDistributionSlot,
            isLockedLiquidity: isLockedLiquiditySlot,
            reservationsForDistribution: reservationsForDistributionSlot
        });
    }

    function _burnTreasuryShares() internal returns (uint256 burned) {
        (bool success, bytes memory result) = redemptionPayoutLogic.delegatecall(
            abi.encodeCall(
                BoardroomRedemptionPayout.burnTreasuryShares, (shareToken, status == BoardroomStatus.RedemptionsOpen)
            )
        );
        if (!success) _revertCall(redemptionPayoutLogic, result);
        burned = abi.decode(result, (uint256));
    }

    function _setExecutor(address executor_) internal {
        if (executor_ == address(0)) revert InvalidExecutor();

        executor = executor_;
        emit ExecutorSet(executor_);
    }

    function _syncExecutorAfterOwnershipTransfer(address oldOwner, address newOwner) internal {
        if (launched) return;
        if (executor != oldOwner) return;
        _setExecutor(newOwner);
    }

    function _queueAction(bytes32 actionHash, bytes32 salt) internal returns (uint256 eta) {
        if (queuedActionEta[actionHash] != 0) revert ActionAlreadyQueued(actionHash);

        eta = block.timestamp + governanceDelay;
        queuedActionEta[actionHash] = eta;
        emit BoardroomActionQueued(actionHash, msg.sender, eta, salt);
    }

    function _consumeReadyAction(bytes32 actionHash) internal {
        uint256 eta = queuedActionEta[actionHash];
        if (eta == 0) revert ActionNotQueued(actionHash);
        if (block.timestamp < eta) revert ActionNotReady(actionHash, eta, block.timestamp);

        delete queuedActionEta[actionHash];
    }

    function _requireGovernanceCaller() internal view {
        if (msg.sender == address(this)) return;
        if (launched) revert Unauthorized();

        _requireOwner();
    }

    function _requireWindDownStarter() internal view {
        if (launched) {
            _requireShareholder(msg.sender);
            return;
        }

        _requireOwner();
    }

    function _requirePrelaunchOwner() internal view {
        if (launched) revert BoardroomAlreadyLaunched();
        _requireOwner();
    }

    function _requireLaunchedExecutor() internal view {
        _requireBoardroomLaunched();
        if (msg.sender != executor) revert Unauthorized();
    }

    function _requireBoardroomLaunched() internal view {
        if (!launched) revert BoardroomNotLaunched();
    }

    function _requireLaunchedShareholder() internal view {
        if (!launched) revert BoardroomNotLaunched();
        _requireShareholder(msg.sender);
    }

    function _requireOwner() internal view {
        if (msg.sender != owner()) revert Unauthorized();
    }

    function _requireShareholder(address account) internal view {
        if (BoardroomToken(shareToken).balanceOf(account) == 0) revert NotShareholder(account);
    }

    function _requireNotRedemptionsOpen() internal view {
        BoardroomStatus currentStatus = status;
        if (currentStatus == BoardroomStatus.RedemptionsOpen) {
            revert InvalidStatus(BoardroomStatus.Active, currentStatus);
        }
    }

    function _requireValidBatchLength(uint256 length) internal pure {
        if (length == 0) revert EmptyBatch();
        if (length > MAX_BATCH_CALLS) revert TooManyCalls(length, MAX_BATCH_CALLS);
    }

    function _requireStatus(BoardroomStatus expected) internal view {
        BoardroomStatus currentStatus = status;
        if (currentStatus != expected) revert InvalidStatus(expected, currentStatus);
    }

    function _hashCall(Call calldata call_) internal pure returns (bytes32) {
        return keccak256(abi.encode(call_.policy, call_.target, call_.value, keccak256(call_.data)));
    }

    function _selector(bytes calldata data) internal pure returns (bytes4 selector) {
        if (data.length < 4) return bytes4(0);
        return bytes4(data[:4]);
    }

    function _delegateRedemptionPayout(
        address holder,
        address asset,
        address recipient,
        uint256 minAmountOut,
        uint256 gasLimit
    ) internal returns (bool success, bytes memory result) {
        bytes memory input = abi.encodeCall(BoardroomRedemptionPayout.payout, (holder, asset, recipient, minAmountOut));
        address logic = redemptionPayoutLogic;
        assembly ("memory-safe") {
            success := delegatecall(gasLimit, logic, add(input, 0x20), mload(input), 0, 0)

            let size := returndatasize()
            let cap := 0x100
            if success { cap := 0x20 }
            if gt(size, cap) { size := cap }

            result := mload(0x40)
            mstore(result, size)
            returndatacopy(add(result, 0x20), 0, size)
            mstore(0x40, and(add(add(result, 0x3f), size), not(0x1f)))
        }
    }

    function _revertCall(address target, bytes memory returnData) internal pure {
        if (returnData.length == 0) revert CallFailed(target);

        assembly {
            revert(add(returnData, 0x20), mload(returnData))
        }
    }
}
