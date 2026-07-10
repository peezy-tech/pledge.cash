// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "solady/auth/Ownable.sol";
import {Initializable} from "solady/utils/Initializable.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {BoardroomToken} from "./BoardroomToken.sol";
import {BoardroomGovernanceLogic} from "./BoardroomGovernanceLogic.sol";
import {BoardroomGovernanceStorage} from "./BoardroomGovernanceStorage.sol";
import {IBoardroomPolicyRegistry} from "./IBoardroomPolicyRegistry.sol";
import {BoardroomRedemptionPayout} from "./BoardroomRedemptionPayout.sol";
import {BoardroomRedemptionStorage} from "./BoardroomRedemptionStorage.sol";

contract Boardroom is Ownable, Initializable, ReentrancyGuard {
    uint256 public constant MAX_BATCH_CALLS = 16;
    uint256 public constant MAX_GOVERNANCE_DELAY = 30 days;
    uint256 internal constant MIN_GOVERNANCE_DELAY = 1 days;
    uint256 internal constant ACTION_GRACE_PERIOD = 7 days;
    uint256 internal constant GOVERNANCE_BPS_DENOMINATOR = 10_000;
    uint256 internal constant VETO_BPS = 100;
    uint256 internal constant WIND_DOWN_BPS = 1_000;
    uint256 internal constant MIN_LAUNCH_CIRCULATING_SUPPLY = 1 ether;
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
    address public immutable governanceLogic;
    address public redemptionExcessRecipient;
    BoardroomStatus public status;
    bool public launched;
    address public executor;
    uint256 public governanceDelay;

    address[] internal redeemableAssets;
    address[] internal issuedGrants;
    address[] internal issuedDistributions;
    address[] internal lockedLiquidityPositions;
    uint256 public issuedGrantSlotReservations;

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
    error InvalidLaunchSupply(uint256 circulatingSupply);
    error InvalidExecutor();
    error ActionAlreadyQueued(bytes32 actionHash);
    error ActionNotQueued(bytes32 actionHash);
    error ActionNotReady(bytes32 actionHash, uint256 eta, uint256 currentTime);
    error ActionExpired(bytes32 actionHash, uint256 expiresAt, uint256 currentTime);
    error ActionContextMismatch(bytes32 actionHash);
    error ModulePolicyRequired(address target);
    error ObligationPolicyMismatch(address target, address expectedPolicy, address actualPolicy);
    error NotShareholder(address account);
    error InsufficientHolderPower(
        address account, uint256 currentBalance, uint256 pastBalance, uint256 requiredBalance
    );
    error NoCirculatingShares();
    error WindDownFinalizationNotReady(uint256 readyAt, uint256 currentTime);
    error RedeemableAssetStillValid(address asset);
    error RedeemableAssetHasBalance(address asset, uint256 balance);
    error RedeemableAssetReserved(address asset);
    error OwnershipRenunciationDisabled();
    error NoRedemptionExcess(address asset);

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
    event BoardroomWindDownStarted(address indexed caller);
    event BoardroomRedemptionsOpened(address indexed caller);
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
    event BoardroomLockedLiquidityReturnedAsLp(address indexed locker, address indexed pool, uint256 liquidity);
    event SharesRedeemed(
        address indexed holder, address indexed recipient, uint256 shares, address[] assets, uint256[] amounts
    );
    event BoardroomLaunched(address indexed executor, uint256 governanceDelay);
    event ExecutorSet(address indexed executor);
    event BoardroomActionQueued(
        bytes32 indexed actionHash,
        address indexed executor,
        uint256 eta,
        uint256 expiresAt,
        uint256 epoch,
        bytes32 salt
    );
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
    event GovernanceEpochAdvanced(uint256 indexed epoch);
    event RedeemableAssetRemoved(address indexed asset);
    event RedeemableAssetQuarantined(address indexed asset);
    event RedemptionExcessRecipientSet(address indexed recipient);
    event RedemptionExcessSwept(address indexed asset, address indexed recipient, uint256 amount);

    constructor(address redemptionPayoutLogic_, address governanceLogic_) {
        if (redemptionPayoutLogic_ == address(0) || governanceLogic_ == address(0)) revert InvalidAddress();
        redemptionPayoutLogic = redemptionPayoutLogic_;
        governanceLogic = governanceLogic_;
        _disableInitializers();
    }

    receive() external payable {}

    function transferOwnership(address newOwner) public payable override {
        address oldOwner = owner();
        super.transferOwnership(newOwner);
        _syncExcessRecipientAfterOwnershipTransfer(oldOwner, newOwner);
        _syncExecutorAfterOwnershipTransfer(oldOwner, newOwner);
    }

    function completeOwnershipHandover(address pendingOwner) public payable override {
        address oldOwner = owner();
        super.completeOwnershipHandover(pendingOwner);
        _syncExcessRecipientAfterOwnershipTransfer(oldOwner, pendingOwner);
        _syncExecutorAfterOwnershipTransfer(oldOwner, pendingOwner);
    }

    function renounceOwnership() public payable override {
        revert OwnershipRenunciationDisabled();
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
        redemptionExcessRecipient = owner_;
        BoardroomGovernanceStorage.layout().epoch = 1;
        shareToken = address(new BoardroomToken(address(this), name_, symbol_));
        isRedeemableAsset[wrappedNative_] = true;
        redeemableAssets.push(wrappedNative_);

        emit BoardroomInitialized(owner_, policyRegistry_, shareToken, wrappedNative_, name_, symbol_);
        emit ExecutorSet(owner_);
        emit RedemptionExcessRecipientSet(owner_);
        emit RedeemableAssetRegistered(wrappedNative_);
    }

    function setExecutor(address executor_) external {
        _requireGovernanceCaller();
        _setExecutor(executor_);
    }

    function setRedemptionExcessRecipient(address recipient) external {
        _requireGovernanceCaller();
        _requireStatus(BoardroomStatus.Active);
        if (recipient == address(0) || recipient == address(this)) revert InvalidAddress();
        redemptionExcessRecipient = recipient;
        emit RedemptionExcessRecipientSet(recipient);
    }

    function launch(uint256 governanceDelay_) external {
        _requirePrelaunchOwner();
        _requireStatus(BoardroomStatus.Active);
        if (governanceDelay_ < MIN_GOVERNANCE_DELAY || governanceDelay_ > MAX_GOVERNANCE_DELAY) {
            revert InvalidGovernanceDelay();
        }

        BoardroomToken shares = BoardroomToken(shareToken);
        uint256 supply = shares.totalSupply();
        uint256 treasuryShares = shares.balanceOf(address(this));
        uint256 circulating = supply > treasuryShares ? supply - treasuryShares : 0;
        if (circulating < MIN_LAUNCH_CIRCULATING_SUPPLY) revert InvalidLaunchSupply(circulating);

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
        _requireStatus(BoardroomStatus.Active);
        _authorizeCallForStatus(status, call_.policy, call_.target, _selector(call_.data), call_.value, call_.data);

        actionHash = hashAction(call_, salt);
        eta = _queueAction(actionHash, salt);
    }

    function queueBatch(Call[] calldata calls, bytes32 salt) external returns (bytes32 actionHash, uint256 eta) {
        _requireLaunchedExecutor();
        _requireStatus(BoardroomStatus.Active);
        _requireValidBatchLength(calls.length);
        uint256 length = calls.length;
        for (uint256 i; i < length; ++i) {
            Call calldata call_ = calls[i];
            _authorizeCallForStatus(status, call_.policy, call_.target, _selector(call_.data), call_.value, call_.data);
        }

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
        _requireBoardroomLaunched();
        _requireStatus(BoardroomStatus.Active);
        _requireHolderPower(msg.sender, VETO_BPS);
        _delegateGovernance(abi.encodeCall(BoardroomGovernanceLogic.cancelAction, (actionHash)));
        emit BoardroomActionCancelled(actionHash, msg.sender);
    }

    function governanceConfig()
        external
        pure
        returns (uint256 minimumDelay, uint256 actionGracePeriod, uint256 vetoBps, uint256 windDownBps)
    {
        return (MIN_GOVERNANCE_DELAY, ACTION_GRACE_PERIOD, VETO_BPS, WIND_DOWN_BPS);
    }

    function governanceState(bytes32 actionHash)
        external
        view
        returns (uint256 currentEpoch, uint256 eta, uint256 expiresAt, uint256 actionEpoch, uint8 actionStatus)
    {
        BoardroomGovernanceStorage.Layout storage governance = BoardroomGovernanceStorage.layout();
        BoardroomGovernanceStorage.ActionContext storage context = governance.actions[actionHash];
        return (governance.epoch, context.eta, context.expiresAt, context.epoch, context.status);
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
        uint256 epoch =
            abi.decode(_delegateGovernance(abi.encodeCall(BoardroomGovernanceLogic.startWindDown, ())), (uint256));
        emit GovernanceEpochAdvanced(epoch);
        emit BoardroomWindDownStarted(msg.sender);
    }

    function wrapNativeBalance() external nonReentrant {
        if (status != BoardroomStatus.WindingDown) _requireGovernanceCaller();
        _wrapNativeBalanceForWindDown();
    }

    function registerRedeemableAsset(address asset) external {
        _requireAssetManager();
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
        BoardroomStatus currentStatus = status;
        if (currentStatus == BoardroomStatus.Active) {
            revert InvalidStatus(BoardroomStatus.WindingDown, currentStatus);
        }
        burned = _burnTreasuryShares();
    }

    function exitLockedLiquidity(address locker, uint256 amountAMin, uint256 amountBMin, uint256 deadline)
        external
        nonReentrant
        returns (uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        (amountA, amountB, liquidity) = _exitLockedLiquidity(locker, amountAMin, amountBMin, deadline);
    }

    function _exitLockedLiquidity(address locker, uint256 amountAMin, uint256 amountBMin, uint256 deadline)
        internal
        returns (uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        _requireStatus(BoardroomStatus.WindingDown);
        bytes memory result = _delegateGovernance(
            abi.encodeCall(
                BoardroomGovernanceLogic.exitLockedLiquidity,
                (
                    _lifecycleConfig(),
                    _obligationSlots(),
                    BoardroomGovernanceLogic.ExitParams({
                        redemptionPayout: redemptionPayoutLogic,
                        locker: locker,
                        amountAMin: amountAMin,
                        amountBMin: amountBMin,
                        deadline: deadline,
                        governanceDelay: governanceDelay
                    })
                )
            )
        );
        (amountA, amountB, liquidity) = abi.decode(result, (uint256, uint256, uint256));
    }

    function openRedemptions() external nonReentrant {
        _openRedemptions();
    }

    function executeWindDownCall(Call calldata call_) external nonReentrant returns (bytes memory result) {
        _requireStatus(BoardroomStatus.WindingDown);
        if (call_.value != 0 || obligationPolicyOf[call_.target] == address(0)) {
            revert CallNotAllowed(call_.policy, call_.target, _selector(call_.data));
        }
        result = _execute(call_);
    }

    function _openRedemptions() internal {
        _requireStatus(BoardroomStatus.WindingDown);
        _delegateGovernance(
            abi.encodeCall(
                BoardroomGovernanceLogic.finalizeWindDown,
                (
                    _obligationSlots(),
                    redemptionPayoutLogic,
                    wrappedNative,
                    shareToken,
                    redeemableAssets,
                    governanceDelay
                )
            )
        );
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

    function sweepRedemptionExcess(address asset) external nonReentrant returns (uint256 amount) {
        _requireStatus(BoardroomStatus.RedemptionsOpen);
        if (asset == address(0) || asset == shareToken || asset == address(this)) revert InvalidRedeemableAsset(asset);
        _wrapNativeBalanceForWindDown();
        address recipient = redemptionExcessRecipient;
        (bool success, bytes memory result) = redemptionPayoutLogic.delegatecall(
            abi.encodeCall(BoardroomRedemptionPayout.sweepExcess, (asset, recipient))
        );
        if (!success) _revertCall(redemptionPayoutLogic, result);
        amount = abi.decode(result, (uint256));
    }

    function redemptionCredits(address holder) external view returns (uint256) {
        return BoardroomRedemptionStorage.layout().credits[holder];
    }

    function allocatedRedemptionShares(address holder, address asset) external view returns (uint256) {
        return BoardroomRedemptionStorage.layout().holderAllocatedShares[holder][asset];
    }

    function redemptionAssetState(address asset) external view returns (uint256 snapshotBalance, uint256 paid) {
        BoardroomRedemptionStorage.Layout storage redemption = BoardroomRedemptionStorage.layout();
        return (redemption.snapshotBalance[asset], redemption.paid[asset]);
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
        _delegateGovernance(
            abi.encodeCall(
                BoardroomGovernanceLogic.recordLockedLiquidityFromDistribution, (_lifecycleConfig(), locker, pool)
            )
        );
    }

    function recordGrantFromDistribution(address grant) external {
        _requireStatus(BoardroomStatus.Active);
        _delegateGovernance(
            abi.encodeCall(
                BoardroomGovernanceLogic.recordGrantFromDistribution,
                (policyRegistry, shareToken, grant, MAX_REDEEMABLE_ASSETS, MAX_ISSUED_GRANTS)
            )
        );
    }

    function reserveRedeemableAsset(address asset) external {
        _requireStatus(BoardroomStatus.Active);
        _delegateGovernance(
            abi.encodeCall(
                BoardroomGovernanceLogic.reserveRedeemableAsset,
                (policyRegistry, asset, shareToken, MAX_REDEEMABLE_ASSETS)
            )
        );
    }

    function removeRedeemableAsset(address asset) external {
        if (status != BoardroomStatus.WindingDown) _requireAssetManager();
        _delegateGovernance(
            abi.encodeCall(BoardroomGovernanceLogic.removeEmptyRedeemableAsset, (asset, shareToken, wrappedNative))
        );
    }

    function quarantineRedeemableAsset(address asset) external {
        _requireStatus(BoardroomStatus.WindingDown);
        _delegateGovernance(
            abi.encodeCall(BoardroomGovernanceLogic.quarantineRedeemableAsset, (asset, shareToken, wrappedNative))
        );
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
            revert CallNotAllowed(policy, target, selector);
        }

        IBoardroomPolicyRegistry(policyRegistry)
            .authorizeCall(
                address(this), launched ? executor : msg.sender, policy, target, value, data, canonicalPolicy
            );
    }

    function _isSelfCallWithoutPolicy(address policy, address target) internal view returns (bool) {
        return policy == address(0) && target == address(this);
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
            _delegateGovernance(
                abi.encodeCall(BoardroomGovernanceLogic.releaseGrantSlotsForLifecycleCall, (policy, target, selector))
            );
            _pruneClosedObligation(target);
            return;
        }

        if (
            currentStatus == BoardroomStatus.Active && policy != address(0)
                && IBoardroomPolicyRegistry(policyRegistry).isModulePolicy(policy)
        ) {
            _delegateGovernance(
                abi.encodeCall(
                    BoardroomGovernanceLogic.recordIssuedObligation,
                    (_lifecycleConfig(), policy, target, value, data, result)
                )
            );
        }
    }

    function _registerRedeemableAsset(address asset) internal {
        _delegateGovernance(
            abi.encodeCall(
                BoardroomGovernanceLogic.registerRedeemableAsset, (asset, shareToken, MAX_REDEEMABLE_ASSETS, false)
            )
        );
    }

    function _registerRedeemableAssetIfNeeded(address asset) internal {
        if (asset == address(0) || asset == shareToken || asset == address(this) || isRedeemableAsset[asset]) return;
        _registerRedeemableAsset(asset);
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

    function _lifecycleConfig() internal view returns (BoardroomGovernanceLogic.LifecycleConfig memory config) {
        config = BoardroomGovernanceLogic.LifecycleConfig({
            policyRegistry: policyRegistry,
            shareToken: shareToken,
            maxAssets: MAX_REDEEMABLE_ASSETS,
            maxGrants: MAX_ISSUED_GRANTS,
            maxDistributions: MAX_ISSUED_DISTRIBUTIONS,
            maxLockers: MAX_LOCKED_LIQUIDITY_POSITIONS
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
        if (executor_ == address(0) || executor_ == address(this)) revert InvalidExecutor();

        executor = executor_;
        uint256 epoch =
            abi.decode(_delegateGovernance(abi.encodeCall(BoardroomGovernanceLogic.advanceEpoch, ())), (uint256));
        emit ExecutorSet(executor_);
        emit GovernanceEpochAdvanced(epoch);
    }

    function _syncExecutorAfterOwnershipTransfer(address oldOwner, address newOwner) internal {
        if (launched) return;
        if (executor != oldOwner) return;
        _setExecutor(newOwner);
    }

    function _syncExcessRecipientAfterOwnershipTransfer(address oldOwner, address newOwner) internal {
        if (launched || redemptionExcessRecipient != oldOwner) return;
        redemptionExcessRecipient = newOwner;
        emit RedemptionExcessRecipientSet(newOwner);
    }

    function _queueAction(bytes32 actionHash, bytes32 salt) internal returns (uint256 eta) {
        eta = abi.decode(
            _delegateGovernance(
                abi.encodeCall(
                    BoardroomGovernanceLogic.queueAction,
                    (actionHash, uint8(status), governanceDelay, ACTION_GRACE_PERIOD)
                )
            ),
            (uint256)
        );
        BoardroomGovernanceStorage.ActionContext storage context =
            BoardroomGovernanceStorage.layout().actions[actionHash];
        emit BoardroomActionQueued(actionHash, msg.sender, eta, context.expiresAt, context.epoch, salt);
    }

    function _consumeReadyAction(bytes32 actionHash) internal {
        _delegateGovernance(abi.encodeCall(BoardroomGovernanceLogic.consumeReadyAction, (actionHash, uint8(status))));
    }

    function _requireGovernanceCaller() internal view {
        if (msg.sender == address(this)) return;
        if (launched) revert Unauthorized();

        _requireOwner();
    }

    function _requireWindDownStarter() internal view {
        if (launched) {
            _requireHolderPower(msg.sender, WIND_DOWN_BPS);
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

    function _requireOwner() internal view {
        if (msg.sender != owner()) revert Unauthorized();
    }

    function _requireHolderPower(address account, uint256 thresholdBps) internal view {
        BoardroomGovernanceLogic(governanceLogic)
            .requireHolderPower(shareToken, address(this), account, thresholdBps, GOVERNANCE_BPS_DENOMINATOR);
    }

    function _requireAssetManager() internal view {
        BoardroomStatus currentStatus = status;
        if (currentStatus == BoardroomStatus.Active) {
            _requireGovernanceCaller();
            return;
        }
        if (currentStatus == BoardroomStatus.WindingDown && launched) {
            _requireHolderPower(msg.sender, WIND_DOWN_BPS);
            return;
        }
        if (currentStatus == BoardroomStatus.WindingDown) {
            _requireOwner();
            return;
        }
        revert InvalidStatus(BoardroomStatus.WindingDown, currentStatus);
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

    function _delegateGovernance(bytes memory input) internal returns (bytes memory result) {
        (bool success, bytes memory output) = governanceLogic.delegatecall(input);
        if (!success) _revertCall(governanceLogic, output);
        return output;
    }

    function _revertCall(address target, bytes memory returnData) internal pure {
        if (returnData.length == 0) revert CallFailed(target);

        assembly {
            revert(add(returnData, 0x20), mload(returnData))
        }
    }
}
