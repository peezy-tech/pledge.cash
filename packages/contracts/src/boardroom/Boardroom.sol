// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "solady/auth/Ownable.sol";
import {Initializable} from "solady/utils/Initializable.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {BoardroomToken} from "./BoardroomToken.sol";
import {IBoardroomPolicyRegistry} from "./IBoardroomPolicyRegistry.sol";
import {TokenGrant} from "../grants/TokenGrant.sol";
import {ExactTransferLib} from "../lib/ExactTransferLib.sol";
import {LockedLiquidity} from "../liquidity/LockedLiquidity.sol";
import {LockedLiquidityFactory} from "../liquidity/LockedLiquidityFactory.sol";
import {IBoardroomCallPolicy} from "../policy/IBoardroomCallPolicy.sol";
import {IBoardroomObligationPolicy} from "../policy/IBoardroomObligationPolicy.sol";

interface IBoardroomWrappedNative {
    function deposit() external payable;
}

interface IBoardroomDistribution {
    function factory() external view returns (address);
    function boardroom() external view returns (address);
    function isClosed() external view returns (bool);
}

contract Boardroom is Ownable, Initializable, ReentrancyGuard {
    using SafeTransferLib for address;

    uint256 public constant MAX_BATCH_CALLS = 16;
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
    error InvalidExecutor();
    error ActionAlreadyQueued(bytes32 actionHash);
    error ActionNotQueued(bytes32 actionHash);
    error ActionNotReady(bytes32 actionHash, uint256 eta, uint256 currentTime);
    error ModulePolicyRequired(address target);
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

    constructor() {
        _disableInitializers();
    }

    receive() external payable {}

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

        emit BoardroomInitialized(owner_, policyRegistry_, shareToken, wrappedNative_, name_, symbol_);
        emit ExecutorSet(owner_);
    }

    function setExecutor(address executor_) external {
        _requireGovernanceCaller();
        _setExecutor(executor_);
    }

    function launch(uint256 governanceDelay_) external {
        _requirePrelaunchOwner();
        if (governanceDelay_ == 0) revert InvalidGovernanceDelay();

        launched = true;
        governanceDelay = governanceDelay_;
        emit BoardroomLaunched(executor, governanceDelay_);
    }

    function mint(address to, uint256 amount) external {
        _requireGovernanceCaller();
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
        _requireLaunchedExecutor();
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
        _requireLaunchedExecutor();
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
        if (launched) {
            _requireShareholder(msg.sender);
        } else {
            _requireOwner();
        }
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
        BoardroomStatus currentStatus = status;
        if (currentStatus == BoardroomStatus.RedemptionsOpen) {
            revert InvalidStatus(BoardroomStatus.WindingDown, currentStatus);
        }
        _registerRedeemableAsset(asset);
    }

    function burnTreasuryShares() external returns (uint256 burned) {
        _requireGovernanceCaller();
        _requireStatus(BoardroomStatus.WindingDown);
        burned = _burnTreasuryShares();
    }

    function exitLockedLiquidity(address locker, uint256 amountAMin, uint256 amountBMin, uint256 deadline)
        external
        nonReentrant
        returns (uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        _requireGovernanceCaller();
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

        emit BoardroomLockedLiquidityExited(locker, pool, liquidity, amountA, amountB);
    }

    function openRedemptions() external {
        _requireGovernanceCaller();
        _requireStatus(BoardroomStatus.WindingDown);
        _requireNoOpenIssuedGrants();
        _requireNoOpenIssuedDistributions();
        _requireNoLockedLiquidity();

        _wrapNativeBalanceForWindDown();
        _burnTreasuryShares();
        status = BoardroomStatus.RedemptionsOpen;
        emit BoardroomRedemptionsOpened(msg.sender);
    }

    function redeem(uint256 shares, address recipient, uint256[] calldata minAmountsOut)
        external
        nonReentrant
        returns (uint256[] memory amountsOut)
    {
        _requireStatus(BoardroomStatus.RedemptionsOpen);
        if (shares == 0 || recipient == address(0) || recipient == address(this)) revert InvalidRedemptionInput();

        uint256 assetsLength = redeemableAssets.length;
        if (minAmountsOut.length != assetsLength) revert InvalidRedemptionInput();

        BoardroomToken shares_ = BoardroomToken(shareToken);
        _wrapNativeBalanceForWindDown();
        _burnTreasuryShares();

        uint256 supplyBeforeBurn = shares_.totalSupply();
        if (supplyBeforeBurn == 0 || shares > shares_.balanceOf(msg.sender)) revert InvalidRedemptionInput();

        address[] memory assets = new address[](assetsLength);
        amountsOut = new uint256[](assetsLength);
        for (uint256 i; i < assetsLength; ++i) {
            address asset = redeemableAssets[i];
            assets[i] = asset;

            uint256 amountOut = SafeTransferLib.balanceOf(asset, address(this)) * shares / supplyBeforeBurn;
            if (amountOut < minAmountsOut[i]) {
                revert InsufficientRedemptionAmount(asset, amountOut, minAmountsOut[i]);
            }
            amountsOut[i] = amountOut;
        }

        shares_.burn(msg.sender, shares);

        for (uint256 i; i < assetsLength; ++i) {
            if (amountsOut[i] != 0) _checkedRedeemableAssetTransfer(assets[i], recipient, amountsOut[i]);
        }

        emit SharesRedeemed(msg.sender, recipient, shares, assets, amountsOut);
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
        if (currentStatus == BoardroomStatus.RedemptionsOpen) {
            revert InvalidStatus(BoardroomStatus.Active, currentStatus);
        }
        if (currentStatus == BoardroomStatus.WindingDown && !_isWindDownCallAllowed(policy, target, selector)) {
            revert CallNotAllowed(policy, target, selector);
        }

        if (currentStatus == BoardroomStatus.Active) {
            _authorizeActiveCall(policy, target, selector, call_.value, call_.data);
        }

        bool success;
        (success, result) = target.call{value: call_.value}(call_.data);
        if (!success) _revertCall(target, result);

        if (currentStatus == BoardroomStatus.Active) {
            _recordIssuedObligation(policy, target, call_.value, call_.data, result);
            _recordLifecycleCall(policy, target, selector);
        } else if (currentStatus == BoardroomStatus.WindingDown) {
            _recordLifecycleCall(policy, target, selector);
        }

        emit BoardroomCallExecuted(policy, target, selector, call_.value, keccak256(call_.data));
    }

    function _authorizeActiveCall(address policy, address target, bytes4 selector, uint256 value, bytes calldata data)
        internal
        view
    {
        IBoardroomPolicyRegistry registry = IBoardroomPolicyRegistry(policyRegistry);
        if (policy == address(0)) {
            if (registry.isPolicyAllowed(target)) revert ModulePolicyRequired(target);
            return;
        }

        if (registry.isPolicyAllowed(target) && policy != target) revert ModulePolicyRequired(target);
        if (!registry.isPolicyAllowed(policy)) revert PolicyNotAllowed(policy);
        if (!IBoardroomCallPolicy(policy).canCall(address(this), msg.sender, target, value, data)) {
            revert CallNotAllowed(policy, target, selector);
        }
    }

    function _isWindDownCallAllowed(address policy, address target, bytes4 selector) internal view returns (bool) {
        if (policy == address(0)) return false;
        if (!IBoardroomPolicyRegistry(policyRegistry).isPolicyLifecycleAllowed(policy)) return false;
        if (!isIssuedGrant[target] && !isIssuedDistribution[target] && !isLockedLiquidity[target]) return false;

        try IBoardroomObligationPolicy(policy).isLifecycleCallAllowed(address(this), target, selector) returns (
            bool allowed
        ) {
            return allowed;
        } catch {}

        return false;
    }

    function _recordIssuedObligation(
        address policy,
        address target,
        uint256 value,
        bytes calldata data,
        bytes memory result
    ) internal {
        if (policy == address(0)) return;

        try IBoardroomObligationPolicy(policy).obligationForCall(address(this), target, value, data, result) returns (
            IBoardroomObligationPolicy.Obligation memory obligation
        ) {
            _recordObligation(target, obligation);
        } catch {}
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
        if (policy == address(0)) return;
        try IBoardroomObligationPolicy(policy)
            .grantSlotReleaseForLifecycleCall(address(this), target, selector) returns (
            address distribution
        ) {
            if (distribution != address(0)) _releaseIssuedGrantSlots(distribution);
        } catch {}
    }

    function _recordIssuedGrant(address factory, bytes memory result) internal {
        if (_remainingIssuedGrantSlots() == 0) revert TooManyIssuedGrants();

        address grant = abi.decode(result, (address));
        if (grant == address(0) || isIssuedGrant[grant]) revert InvalidIssuedGrant(grant);

        TokenGrant tokenGrant = TokenGrant(grant);
        if (tokenGrant.issuer() != address(this) || tokenGrant.factory() != factory) revert InvalidIssuedGrant(grant);

        isIssuedGrant[grant] = true;
        issuedGrants.push(grant);
        emit BoardroomGrantRecorded(grant);
    }

    function _recordIssuedDistribution(address factory, bytes memory result) internal returns (address distribution) {
        if (issuedDistributions.length >= MAX_ISSUED_DISTRIBUTIONS) revert TooManyIssuedDistributions();

        distribution = abi.decode(result, (address));
        if (distribution == address(0) || isIssuedDistribution[distribution]) {
            revert InvalidIssuedDistribution(distribution);
        }
        if (
            IBoardroomDistribution(distribution).boardroom() != address(this)
                || IBoardroomDistribution(distribution).factory() != factory
        ) {
            revert InvalidIssuedDistribution(distribution);
        }

        isIssuedDistribution[distribution] = true;
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

        if (locker == address(0) || isLockedLiquidity[locker]) revert InvalidLockedLiquidity(locker);

        LockedLiquidity position = LockedLiquidity(locker);
        address factory = position.factory();
        if (expectedFactory != address(0) && factory != expectedFactory) revert InvalidLockedLiquidity(locker);
        if (
            position.boardroom() != address(this) || position.pool() != pool
                || !LockedLiquidityFactory(factory).isLocker(locker)
        ) {
            revert InvalidLockedLiquidity(locker);
        }

        _registerRedeemableAssetIfNeeded(position.tokenA());
        _registerRedeemableAssetIfNeeded(position.tokenB());

        isLockedLiquidity[locker] = true;
        lockedLiquidityPositions.push(locker);
        emit BoardroomLockedLiquidityRecorded(locker);
    }

    function _registerRedeemableAsset(address asset) internal {
        if (asset == address(0) || asset == shareToken || asset == address(this)) revert InvalidRedeemableAsset(asset);
        if (isRedeemableAsset[asset]) revert RedeemableAssetAlreadyRegistered(asset);
        if (redeemableAssets.length >= MAX_REDEEMABLE_ASSETS) revert TooManyRedeemableAssets();

        isRedeemableAsset[asset] = true;
        redeemableAssets.push(asset);
        emit RedeemableAssetRegistered(asset);
    }

    function _registerRedeemableAssetIfNeeded(address asset) internal {
        if (asset == address(0) || asset == shareToken || asset == address(this) || isRedeemableAsset[asset]) return;
        _registerRedeemableAsset(asset);
    }

    function _wrapNativeBalanceForWindDown() internal {
        uint256 nativeBalance = address(this).balance;
        if (nativeBalance == 0) return;

        address wrappedNative_ = wrappedNative;
        uint256 balanceBefore = SafeTransferLib.balanceOf(wrappedNative_, address(this));
        IBoardroomWrappedNative(wrappedNative_).deposit{value: nativeBalance}();
        uint256 balanceAfter = SafeTransferLib.balanceOf(wrappedNative_, address(this));
        uint256 expectedBalance = balanceBefore + nativeBalance;
        if (balanceAfter != expectedBalance) {
            revert UnexpectedWrappedNativeBalanceChange(expectedBalance, balanceAfter);
        }

        emit NativeWrappedForWindDown(wrappedNative_, nativeBalance);
    }

    function _requireNoOpenIssuedGrants() internal view {
        uint256 grantCount = issuedGrants.length;
        for (uint256 i; i < grantCount; ++i) {
            address grant = issuedGrants[i];
            if (!TokenGrant(grant).isClosed()) revert IssuedGrantStillOpen(grant);
        }
    }

    function _requireNoLockedLiquidity() internal view {
        uint256 lockerCount = lockedLiquidityPositions.length;
        for (uint256 i; i < lockerCount; ++i) {
            address locker = lockedLiquidityPositions[i];
            if (LockedLiquidity(locker).lockedLiquidity() != 0) revert LockedLiquidityStillOpen(locker);
        }
    }

    function _requireNoOpenIssuedDistributions() internal view {
        uint256 distributionCount = issuedDistributions.length;
        for (uint256 i; i < distributionCount; ++i) {
            address distribution = issuedDistributions[i];
            if (!IBoardroomDistribution(distribution).isClosed()) revert IssuedDistributionStillOpen(distribution);
        }
    }

    function _burnTreasuryShares() internal returns (uint256 burned) {
        BoardroomToken shares = BoardroomToken(shareToken);
        burned = shares.balanceOf(address(this));
        if (burned != 0) shares.burn(address(this), burned);
        emit TreasurySharesBurned(burned);
    }

    function _checkedRedeemableAssetTransfer(address asset, address recipient, uint256 expectedAmount) internal {
        ExactTransferLib.ExactDelta memory delta = ExactTransferLib.sendFromSelfTo(asset, recipient, expectedAmount);
        if (delta.senderBalanceIncreased) {
            revert UnexpectedRedeemableAssetBalanceChange(asset, expectedAmount, 0);
        }
        if (delta.senderSpent != expectedAmount) {
            revert UnexpectedRedeemableAssetBalanceChange(asset, expectedAmount, delta.senderSpent);
        }
        if (delta.recipientBalanceDecreased) {
            revert UnexpectedRedeemableAssetBalanceChange(asset, expectedAmount, 0);
        }
        if (delta.recipientReceived != expectedAmount) {
            revert UnexpectedRedeemableAssetBalanceChange(asset, expectedAmount, delta.recipientReceived);
        }
    }

    function _setExecutor(address executor_) internal {
        if (executor_ == address(0)) revert InvalidExecutor();

        executor = executor_;
        emit ExecutorSet(executor_);
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
        if (launched) {
            if (msg.sender != address(this)) revert Unauthorized();
            return;
        }

        _requireOwner();
    }

    function _requirePrelaunchOwner() internal view {
        if (launched) revert BoardroomAlreadyLaunched();
        _requireOwner();
    }

    function _requireLaunchedExecutor() internal view {
        if (!launched) revert BoardroomNotLaunched();
        if (msg.sender != executor) revert Unauthorized();
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

    function _revertCall(address target, bytes memory returnData) internal pure {
        if (returnData.length == 0) revert CallFailed(target);

        assembly {
            revert(add(returnData, 0x20), mload(returnData))
        }
    }
}
