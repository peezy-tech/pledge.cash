// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "solady/auth/Ownable.sol";
import {Initializable} from "solady/utils/Initializable.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {BoardroomToken} from "./BoardroomToken.sol";
import {DistributionFactory} from "./DistributionFactory.sol";
import {ExactTransferLib} from "./ExactTransferLib.sol";
import {FixedPriceSale} from "./FixedPriceSale.sol";
import {IBoardroomMintPolicy} from "./IBoardroomMintPolicy.sol";
import {IBoardroomCallPolicy} from "./IBoardroomCallPolicy.sol";
import {IBoardroomPolicyRegistry} from "./IBoardroomPolicyRegistry.sol";
import {IStagedBoardroomImplementation} from "./IStagedBoardroomImplementation.sol";
import {LockedLiquidity} from "./LockedLiquidity.sol";
import {LockedLiquidityFactory} from "./LockedLiquidityFactory.sol";
import {MigratingBondingCurve} from "./MigratingBondingCurve.sol";
import {StagedBoardroomSlots} from "./StagedBoardroomSlots.sol";
import {TokenGrant} from "./TokenGrant.sol";
import {TokenGrantFactory} from "./TokenGrantFactory.sol";

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

    bytes32 public constant STAGE_ID_PRE_LAUNCH = keccak256("pledge.cash.boardroom.stage.preLaunch");
    bytes32 public constant STAGE_ID_LAUNCH_FINALIZATION = keccak256("pledge.cash.boardroom.stage.launchFinalization");
    bytes32 public constant STAGE_ID_POST_LAUNCH_GOVERNANCE =
        keccak256("pledge.cash.boardroom.stage.postLaunchGovernance");
    bytes32 public constant STAGE_ID_FINAL = keccak256("pledge.cash.boardroom.stage.final");

    uint256 public constant BOARDROOM_STORAGE_VERSION = 1;

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

    enum LaunchStage {
        PreLaunch,
        LaunchFinalization,
        PostLaunchGovernance,
        Final
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
    LaunchStage public launchStage;
    address public postLaunchMintPolicy;

    address[] internal redeemableAssets;
    address[] internal issuedGrants;
    address[] internal issuedDistributions;
    address[] internal lockedLiquidityPositions;

    mapping(address => bool) public isRedeemableAsset;
    mapping(address => bool) public isIssuedGrant;
    mapping(address => bool) public isIssuedDistribution;
    mapping(address => bool) public isLockedLiquidity;

    error InvalidAddress();
    error InvalidAmount();
    error InvalidStatus(BoardroomStatus expected, BoardroomStatus actual);
    error InvalidRedemptionInput();
    error RedeemableAssetAlreadyRegistered(address asset);
    error TooManyRedeemableAssets();
    error TooManyIssuedGrants();
    error TooManyIssuedDistributions();
    error TooManyLockedLiquidityPositions();
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
    error InvalidImplementation();
    error NoNextImplementation();
    error InvalidNextImplementation(address expected, address actual);
    error InvalidPreviousImplementation(address expected, address actual);
    error InvalidStageOrder(uint8 expected, uint8 actual);
    error InvalidStorageVersion(uint256 expected, uint256 actual);
    error ImplementationCodeHashMismatch(address implementation, bytes32 expected, bytes32 actual);
    error UpgradeNotAllowed(address implementation);
    error MigrationNotAllowed(address implementation);
    error MintingFrozen(LaunchStage stage);
    error MintPolicyNotSet();
    error MintPolicyRejected(address policy, address to, uint256 amount);
    error ShareTransferLocked(address operator, address from, address to);

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
    event BoardroomDistributionRecorded(address indexed distribution);
    event BoardroomLockedLiquidityRecorded(address indexed locker);
    event BoardroomLockedLiquidityExited(
        address indexed locker, address indexed pool, uint256 liquidity, uint256 amountA, uint256 amountB
    );
    event SharesRedeemed(
        address indexed holder, address indexed recipient, uint256 shares, address[] assets, uint256[] amounts
    );
    event BoardroomCallExecuted(
        address indexed policy, address indexed target, bytes4 indexed selector, uint256 value, bytes32 dataHash
    );
    event BoardroomImplementationUpgraded(
        address indexed previousImplementation,
        address indexed nextImplementation,
        bytes32 indexed stageId,
        uint8 stageOrder,
        bytes32 dataHash
    );
    event BoardroomLaunchStageAdvanced(LaunchStage indexed previousStage, LaunchStage indexed nextStage);
    event PostLaunchMintPolicySet(address indexed policy);

    address internal immutable implementationSelf;
    address internal immutable implementationNext;
    uint8 internal immutable implementationStageOrder;
    bytes32 internal immutable implementationStageId;
    address internal immutable implementationLinker;
    address internal linkedPreviousImplementation;

    constructor(address nextImplementation_, uint8 stageOrder_, bytes32 stageId_) {
        _disableInitializers();
        implementationSelf = address(this);
        implementationNext = nextImplementation_;
        implementationStageOrder = stageOrder_;
        implementationStageId = stageId_;
        implementationLinker = msg.sender;
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
        launchStage = LaunchStage.PreLaunch;
        shareToken = address(new BoardroomToken(address(this), name_, symbol_));

        emit BoardroomInitialized(owner_, policyRegistry_, shareToken, wrappedNative_, name_, symbol_);
    }

    function mint(address to, uint256 amount) external virtual onlyOwner {
        _requireStatus(BoardroomStatus.Active);
        if (to == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();

        _mintShares(to, amount);
    }

    function upgradeToNext(bytes calldata data, bytes32 expectedNextCodeHash)
        external
        onlyOwner
        nonReentrant
        returns (address next)
    {
        _requireStatus(BoardroomStatus.Active);
        _requireActiveImplementation();

        address current = implementationSelf;
        next = implementationNext;
        bytes32 dataHash = keccak256(data);
        uint8 nextStageOrder;
        bytes32 nextStageId;
        if (next == address(0)) revert NoNextImplementation();
        if (next.code.length == 0) revert InvalidImplementation();
        if (expectedNextCodeHash != bytes32(0)) {
            bytes32 actualCodeHash = next.codehash;
            if (actualCodeHash != expectedNextCodeHash) {
                revert ImplementationCodeHashMismatch(next, expectedNextCodeHash, actualCodeHash);
            }
        }

        if (IStagedBoardroomImplementation(current).nextImplementation() != next) {
            revert InvalidNextImplementation(next, IStagedBoardroomImplementation(current).nextImplementation());
        }
        address previous = IStagedBoardroomImplementation(next).previousImplementation();
        if (previous != current) revert InvalidPreviousImplementation(current, previous);

        uint8 expectedStageOrder = implementationStageOrder + 1;
        nextStageOrder = IStagedBoardroomImplementation(next).stageOrder();
        if (nextStageOrder != expectedStageOrder) revert InvalidStageOrder(expectedStageOrder, nextStageOrder);

        uint256 nextStorageVersion = IStagedBoardroomImplementation(next).storageVersion();
        if (nextStorageVersion != BOARDROOM_STORAGE_VERSION) {
            revert InvalidStorageVersion(BOARDROOM_STORAGE_VERSION, nextStorageVersion);
        }
        if (!canUpgrade(data)) revert UpgradeNotAllowed(current);

        StagedBoardroomSlots.setMigrationImplementation(next);
        StagedBoardroomSlots.setImplementation(next);

        (bool success, bytes memory result) =
            next.delegatecall(abi.encodeCall(IStagedBoardroomImplementation.migrateFromPrevious, (data)));
        StagedBoardroomSlots.setMigrationImplementation(address(0));
        if (!success) _revertCall(next, result);

        nextStageId = IStagedBoardroomImplementation(next).stageId();
        emit BoardroomImplementationUpgraded(current, next, nextStageId, nextStageOrder, dataHash);
    }

    function stageId() external view returns (bytes32) {
        return implementationStageId;
    }

    function stageOrder() external view returns (uint8) {
        return implementationStageOrder;
    }

    function previousImplementation() external view returns (address) {
        if (address(this) != implementationSelf) {
            return IStagedBoardroomImplementation(implementationSelf).previousImplementation();
        }
        return linkedPreviousImplementation;
    }

    function nextImplementation() external view returns (address) {
        return implementationNext;
    }

    function storageVersion() public pure returns (uint256) {
        return BOARDROOM_STORAGE_VERSION;
    }

    function canUpgrade(bytes calldata data) public view virtual returns (bool) {
        return status == BoardroomStatus.Active && data.length == 0;
    }

    function migrateFromPrevious(bytes calldata) external virtual {
        _requireMigrationImplementation();
    }

    function canTransferShares(address operator, address from, address to, uint256) external view returns (bool) {
        if (from == address(0) || to == address(0)) return true;
        if (status != BoardroomStatus.Active) return true;
        if (launchStage != LaunchStage.PreLaunch) return true;
        if (operator == address(this) || from == address(this) || to == address(this)) return true;
        if (isIssuedGrant[from] || isIssuedGrant[to]) return true;
        if (isIssuedDistribution[from] || isIssuedDistribution[to]) return true;
        if (isLockedLiquidity[from] || isLockedLiquidity[to]) return true;
        return false;
    }

    function setPostLaunchMintPolicy(address) external virtual onlyOwner {
        revert MintingFrozen(launchStage);
    }

    function linkPreviousImplementation(address previousImplementation_) external {
        if (address(this) != implementationSelf || msg.sender != implementationLinker) revert InvalidImplementation();
        if (linkedPreviousImplementation != address(0)) {
            revert InvalidPreviousImplementation(address(0), linkedPreviousImplementation);
        }
        linkedPreviousImplementation = previousImplementation_;
    }

    function execute(Call calldata call_) external payable onlyOwner nonReentrant returns (bytes memory result) {
        result = _execute(call_);
    }

    function executeBatch(Call[] calldata calls)
        external
        payable
        onlyOwner
        nonReentrant
        returns (bytes[] memory results)
    {
        uint256 length = calls.length;
        if (length == 0) revert EmptyBatch();
        if (length > MAX_BATCH_CALLS) revert TooManyCalls(length, MAX_BATCH_CALLS);

        results = new bytes[](length);
        for (uint256 i; i < length; ++i) {
            results[i] = _execute(calls[i]);
        }
    }

    function startWindDown() external onlyOwner nonReentrant {
        _requireStatus(BoardroomStatus.Active);

        _wrapNativeBalanceForWindDown();
        status = BoardroomStatus.WindingDown;
        emit BoardroomWindDownStarted(msg.sender);
    }

    function wrapNativeBalance() external onlyOwner nonReentrant {
        _wrapNativeBalanceForWindDown();
    }

    function registerRedeemableAsset(address asset) external onlyOwner {
        BoardroomStatus currentStatus = status;
        if (currentStatus == BoardroomStatus.RedemptionsOpen) {
            revert InvalidStatus(BoardroomStatus.WindingDown, currentStatus);
        }
        _registerRedeemableAsset(asset);
    }

    function burnTreasuryShares() external onlyOwner returns (uint256 burned) {
        _requireStatus(BoardroomStatus.WindingDown);
        burned = _burnTreasuryShares();
    }

    function exitLockedLiquidity(address locker, uint256 amountAMin, uint256 amountBMin, uint256 deadline)
        external
        onlyOwner
        nonReentrant
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

        emit BoardroomLockedLiquidityExited(locker, pool, liquidity, amountA, amountB);
    }

    function openRedemptions() external onlyOwner {
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

    function _execute(Call calldata call_) internal returns (bytes memory result) {
        address policy = call_.policy;
        address target = call_.target;
        if (policy == address(0) || target == address(0)) revert InvalidAddress();

        bytes4 selector = _selector(call_.data);
        BoardroomStatus currentStatus = status;
        if (currentStatus == BoardroomStatus.RedemptionsOpen) {
            revert InvalidStatus(BoardroomStatus.Active, currentStatus);
        }
        if (currentStatus == BoardroomStatus.WindingDown && !_isWindDownCallAllowed(target, selector)) {
            revert CallNotAllowed(policy, target, selector);
        }

        if (!IBoardroomPolicyRegistry(policyRegistry).isPolicyAllowed(policy)) {
            revert PolicyNotAllowed(policy);
        }
        if (!IBoardroomCallPolicy(policy).canCall(address(this), msg.sender, target, call_.value, call_.data)) {
            revert CallNotAllowed(policy, target, selector);
        }

        bool success;
        (success, result) = target.call{value: call_.value}(call_.data);
        if (!success) _revertCall(target, result);

        if (currentStatus == BoardroomStatus.Active) _recordIssuedObligation(policy, target, selector, result);

        emit BoardroomCallExecuted(policy, target, selector, call_.value, keccak256(call_.data));
    }

    function _isWindDownCallAllowed(address target, bytes4 selector) internal view returns (bool) {
        if (isIssuedGrant[target]) {
            return selector == TokenGrant.stopVestingAndWithdrawUnvested.selector
                || selector == TokenGrant.withdrawExpiredTokens.selector;
        }
        if (isIssuedDistribution[target]) {
            return selector == FixedPriceSale.close.selector || selector == FixedPriceSale.cancel.selector
                || selector == MigratingBondingCurve.cancel.selector
                || selector == MigratingBondingCurve.migrate.selector;
        }
        if (isLockedLiquidity[target]) {
            return selector == LockedLiquidity.claimFees.selector;
        }
        return false;
    }

    function _recordIssuedObligation(address, address target, bytes4 selector, bytes memory result) internal {
        if (selector == TokenGrantFactory.createGrant.selector) {
            _recordIssuedGrant(target, result);
            return;
        }

        if (selector == DistributionFactory.createFixedPriceSale.selector) {
            _recordIssuedDistribution(target, result);
            return;
        }

        if (selector == DistributionFactory.createMigratingBondingCurve.selector) {
            _recordIssuedDistribution(target, result);
            return;
        }

        if (selector == LockedLiquidityFactory.createLockedLiquidity.selector) {
            _recordLockedLiquidity(target, result);
        }
    }

    function _recordIssuedGrant(address factory, bytes memory result) internal {
        if (issuedGrants.length >= MAX_ISSUED_GRANTS) revert TooManyIssuedGrants();

        address grant = abi.decode(result, (address));
        if (grant == address(0) || isIssuedGrant[grant]) revert InvalidIssuedGrant(grant);

        TokenGrant tokenGrant = TokenGrant(grant);
        if (tokenGrant.issuer() != address(this) || tokenGrant.factory() != factory) revert InvalidIssuedGrant(grant);

        isIssuedGrant[grant] = true;
        issuedGrants.push(grant);
        emit BoardroomGrantRecorded(grant);
    }

    function _recordIssuedDistribution(address factory, bytes memory result) internal {
        if (issuedDistributions.length >= MAX_ISSUED_DISTRIBUTIONS) revert TooManyIssuedDistributions();

        address distribution = abi.decode(result, (address));
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

    function _recordLockedLiquidity(address factory, bytes memory result) internal {
        (address locker, address pool,,,) = abi.decode(result, (address, address, uint256, uint256, uint256));
        _recordLockedLiquidityPosition(locker, pool, factory);
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

    function _mintShares(address to, uint256 amount) internal {
        BoardroomToken(shareToken).mint(to, amount);
        emit SharesMinted(to, amount);
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

    function _requireStatus(BoardroomStatus expected) internal view {
        BoardroomStatus currentStatus = status;
        if (currentStatus != expected) revert InvalidStatus(expected, currentStatus);
    }

    function _requireActiveImplementation() internal view {
        if (StagedBoardroomSlots.implementation() != implementationSelf) revert InvalidImplementation();
    }

    function _requireMigrationImplementation() internal view {
        if (StagedBoardroomSlots.migrationImplementation() != implementationSelf) {
            revert MigrationNotAllowed(implementationSelf);
        }
    }

    function _advanceLaunchStage(LaunchStage nextStage) internal {
        LaunchStage previousStage = launchStage;
        if (uint8(nextStage) != uint8(previousStage) + 1) {
            revert InvalidStageOrder(uint8(previousStage) + 1, uint8(nextStage));
        }
        launchStage = nextStage;
        emit BoardroomLaunchStageAdvanced(previousStage, nextStage);
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
