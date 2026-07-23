// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "solady/auth/Ownable.sol";
import {Initializable} from "solady/utils/Initializable.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {BoardroomController} from "./BoardroomController.sol";
import {BoardroomControllerFactory} from "./BoardroomControllerFactory.sol";
import {BoardroomGovernanceLogic} from "./BoardroomGovernanceLogic.sol";
import {BoardroomMarketLogic} from "./BoardroomMarketLogic.sol";
import {BoardroomRedemptionPayout} from "./BoardroomRedemptionPayout.sol";
import {BoardroomRedemptionStorage} from "./BoardroomRedemptionStorage.sol";
import {BoardroomToken} from "./BoardroomToken.sol";
import {BoardroomCall} from "./IBoardroomGovernance.sol";
import {IBoardroomPolicyRegistry} from "./IBoardroomPolicyRegistry.sol";
import {BoardroomAssetStorage} from "./storage/BoardroomAssetStorage.sol";
import {BoardroomCoreStorage} from "./storage/BoardroomCoreStorage.sol";
import {BoardroomLiquidityStorage} from "./storage/BoardroomLiquidityStorage.sol";
import {BoardroomObligationStorage} from "./storage/BoardroomObligationStorage.sol";
import {BoardroomPrimaryMarketStorage} from "./storage/BoardroomPrimaryMarketStorage.sol";
import {IBoardroomObligationPolicy} from "../policy/IBoardroomObligationPolicy.sol";
import {BestEffortTokenLib} from "../lib/BestEffortTokenLib.sol";
import {LockedLiquidity} from "../liquidity/LockedLiquidity.sol";

interface ICanonicalBoardroomObligation {
    function factory() external view returns (address);

    function boardroom() external view returns (address);

    function shareToken() external view returns (address);
}

interface IClosableBoardroomObligation {
    function isClosed() external view returns (bool);
}

interface ITerminalBoardroomRewards {
    function isTerminalized() external view returns (bool);
}

interface IBoardroomLiquidityFactoryFinalizer {
    function finalizeWindDownClosure() external;
}

contract Boardroom is Ownable, Initializable, ReentrancyGuard {
    uint256 public constant MAX_BATCH_CALLS = 16;
    uint256 public constant MAX_SNAPSHOT_PAGE = 32;
    uint256 public constant MIN_WIND_DOWN_DELAY = 1 days;
    uint256 public constant MAX_WIND_DOWN_DELAY = 30 days;
    uint256 internal constant GOVERNANCE_BPS_DENOMINATOR = 10_000;
    uint256 internal constant VETO_BPS = 100;
    uint256 internal constant WIND_DOWN_BPS = 1_000;
    uint256 internal constant MIN_LAUNCH_CIRCULATING_SUPPLY = 1 ether;

    enum BoardroomStatus {
        Active,
        WindingDown,
        Snapshotting,
        RedemptionsOpen
    }

    struct Call {
        address policy;
        address target;
        uint256 value;
        bytes data;
    }

    struct LaunchConfig {
        address proposer;
        address predictedController;
        address protectionStaker;
        address expectedRewardPool;
        address expectedRedemptionExcessRecipient;
        uint64 controllerDelay;
        uint64 windDownDelay;
        uint64 gracePeriod;
        uint64 generation;
    }

    address public policyRegistry;
    address public shareToken;
    address public wrappedNative;
    address public redemptionExcessRecipient;
    address public immutable redemptionPayoutLogic;
    address public immutable governanceLogic;
    address public immutable controllerFactory;
    address public immutable marketLogic;

    error InvalidAddress();
    error InvalidAmount();
    error InvalidStatus(BoardroomStatus expected, BoardroomStatus actual);
    error EmptyBatch();
    error TooManyCalls(uint256 requested, uint256 maximum);
    error CallFailed(address target);
    error CallNotAllowed(address policy, address target, bytes4 selector);
    error BoardroomAlreadyLaunched();
    error BoardroomNotLaunched();
    error InvalidLaunchConfiguration();
    error InvalidLaunchSupply(uint256 circulatingSupply);
    error InvalidController(address controller);
    error ControllerAlreadyDeployed(address controller);
    error OwnershipLockedAfterLaunch();
    error OwnershipRenunciationDisabled();
    error GovernanceEpochMismatch(uint256 expected, uint256 actual);
    error InvalidProtectionStaker(address staker);
    error InvalidObligation(address obligation);
    error ObligationAlreadyRegistered(address obligation);
    error ObligationNotActive(address obligation);
    error ObligationStillOpen(address obligation);
    error InvalidObligationPolicy(address policy);
    error TooManyObligationDependencies(uint256 requested, uint256 maximum);
    error InvalidRedeemableAsset(address asset);
    error RedeemableAssetAlreadyRegistered(address asset);
    error EmptyRedeemableAsset(address asset);
    error RedeemableAssetDependency(address asset, uint256 dependencies);
    error RedeemableAssetHasBalance(address asset, uint256 balance);
    error SnapshotNotReady();
    error SnapshotAlreadyFrozen();
    error SnapshotIncomplete(uint256 cursor, uint256 count);
    error InvalidSnapshotPage(uint256 requested, uint256 maximum);
    error InvalidRedemptionInput();
    error NoRedemptionExcess(address asset);
    error InvalidPrimaryMarketTransition();
    error PrimaryMarketTransferRestricted(address from, address to, uint256 amount);
    error InvalidExecutionContext();
    error InvalidControllerReplacement();

    event BoardroomInitialized(
        address indexed owner,
        address indexed policyRegistry,
        address indexed shareToken,
        address wrappedNative,
        string name,
        string symbol
    );
    event BoardroomLaunched(
        address indexed controller,
        address indexed proposer,
        address indexed protectionStaker,
        uint256 controllerGeneration,
        uint256 controllerDelay,
        uint256 windDownDelay,
        uint256 gracePeriod
    );
    event BoardroomControllerReplaced(
        address indexed oldController,
        address indexed newController,
        uint256 indexed generation,
        address proposer,
        uint256 controllerDelay,
        uint256 gracePeriod
    );
    event GovernanceEpochAdvanced(uint256 indexed epoch);
    event BoardroomOperationVetoed(bytes32 indexed operationId, address indexed staker);
    event BoardroomCallExecuted(
        address indexed policy,
        address indexed target,
        bytes4 indexed selector,
        address authority,
        uint256 value,
        bytes32 dataHash
    );
    event SharesMinted(address indexed to, uint256 amount);
    event RedemptionExcessRecipientSet(address indexed recipient);
    event BoardroomWindDownStarted(address indexed caller, uint256 indexed epoch, uint256 windDownDelay);
    event BoardroomSnapshottingStarted(uint256 assetCount, uint256 redemptionSupply);
    event BoardroomSnapshotPageProcessed(uint256 indexed fromIndex, uint256 indexed toIndex);
    event BoardroomRedemptionsOpened(address indexed caller);
    event RedeemableAssetRegistered(address indexed asset);
    event RedeemableAssetRemoved(address indexed asset);
    event RedeemableAssetSnapshot(address indexed asset, uint256 balance);
    event RedeemableAssetUnreadable(address indexed asset);
    event BoardroomObligationRecorded(
        address indexed obligation, address indexed policy, BoardroomObligationStorage.Kind indexed kind
    );
    event BoardroomObligationPruned(
        address indexed obligation, address indexed policy, BoardroomObligationStorage.Kind indexed kind
    );
    event BoardroomObligationDependency(address indexed obligation, address indexed asset);
    event PrimaryMarketModeChanged(BoardroomPrimaryMarketStorage.Mode indexed mode);
    event BondingCurvePrecommitted(address indexed curve, address indexed quoteAsset, uint256 fundingAmount);
    event ProtocolLiquidityReserved(
        address indexed expectedLocker,
        address indexed quoteAsset,
        address indexed curve,
        bytes32 pairKey,
        bytes32 salt,
        uint256 expiresAt
    );
    event ProtocolLiquidityActivated(
        address indexed locker, address indexed pool, address indexed quoteAsset, address curve
    );
    event ProtocolLiquidityClosed(address indexed locker, address indexed pool, address indexed quoteAsset);
    event ProtocolLiquidityReservationReleased(address indexed curve, address indexed expectedLocker, bytes32 salt);

    constructor(
        address redemptionPayoutLogic_,
        address governanceLogic_,
        address controllerFactory_,
        address marketLogic_
    ) {
        if (
            redemptionPayoutLogic_ == address(0) || governanceLogic_ == address(0) || controllerFactory_ == address(0)
                || marketLogic_ == address(0)
        ) revert InvalidAddress();
        redemptionPayoutLogic = redemptionPayoutLogic_;
        governanceLogic = governanceLogic_;
        controllerFactory = controllerFactory_;
        marketLogic = marketLogic_;
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
        redemptionExcessRecipient = owner_;
        BoardroomCoreStorage.Layout storage core = BoardroomCoreStorage.layout();
        core.governanceEpoch = 1;
        core.windDownDelay = uint64(MIN_WIND_DOWN_DELAY);
        shareToken = abi.decode(
            _delegateGovernance(abi.encodeCall(BoardroomGovernanceLogic.deployShareToken, (name_, symbol_))), (address)
        );
        _registerAsset(wrappedNative_);

        emit BoardroomInitialized(owner_, policyRegistry_, shareToken, wrappedNative_, name_, symbol_);
        emit RedemptionExcessRecipientSet(owner_);
    }

    function transferOwnership(address newOwner) public payable override {
        if (launched()) revert OwnershipLockedAfterLaunch();
        address oldOwner = owner();
        super.transferOwnership(newOwner);
        if (redemptionExcessRecipient == oldOwner) {
            redemptionExcessRecipient = newOwner;
            emit RedemptionExcessRecipientSet(newOwner);
        }
    }

    function completeOwnershipHandover(address pendingOwner) public payable override {
        if (launched()) revert OwnershipLockedAfterLaunch();
        address oldOwner = owner();
        super.completeOwnershipHandover(pendingOwner);
        if (redemptionExcessRecipient == oldOwner) {
            redemptionExcessRecipient = pendingOwner;
            emit RedemptionExcessRecipientSet(pendingOwner);
        }
    }

    function requestOwnershipHandover() public payable override {
        if (launched()) revert OwnershipLockedAfterLaunch();
        super.requestOwnershipHandover();
    }

    function cancelOwnershipHandover() public payable override {
        if (launched()) revert OwnershipLockedAfterLaunch();
        super.cancelOwnershipHandover();
    }

    function renounceOwnership() public payable override {
        revert OwnershipRenunciationDisabled();
    }

    function status() public view returns (BoardroomStatus) {
        return BoardroomStatus(uint8(BoardroomCoreStorage.layout().status));
    }

    function launched() public view returns (bool) {
        return BoardroomCoreStorage.layout().launched;
    }

    function controller() public view returns (address) {
        return BoardroomCoreStorage.layout().controller;
    }

    function controllerGeneration() public view returns (uint256) {
        return BoardroomCoreStorage.layout().controllerGeneration;
    }

    function governanceEpoch() public view returns (uint256) {
        return BoardroomCoreStorage.layout().governanceEpoch;
    }

    function windDownDelay() public view returns (uint256) {
        return BoardroomCoreStorage.layout().windDownDelay;
    }

    function windDownStartedAt() external view returns (uint256) {
        return BoardroomCoreStorage.layout().windDownStartedAt;
    }

    function protectionStaker() external view returns (address) {
        return BoardroomCoreStorage.layout().protectionStaker;
    }

    function launch(LaunchConfig calldata config) external nonReentrant {
        _requirePrelaunchOwner();
        _requireStatus(BoardroomStatus.Active);
        if (
            config.proposer == address(0) || config.predictedController == address(0)
                || config.protectionStaker == address(0) || config.generation != 1
                || config.expectedRewardPool != rewardPool()
                || config.expectedRedemptionExcessRecipient != redemptionExcessRecipient
                || config.windDownDelay < MIN_WIND_DOWN_DELAY || config.windDownDelay > MAX_WIND_DOWN_DELAY
        ) revert InvalidLaunchConfiguration();
        if (config.predictedController.code.length != 0) {
            revert ControllerAlreadyDeployed(config.predictedController);
        }
        address predicted = BoardroomControllerFactory(controllerFactory).predictControllerAddress(address(this), 1);
        if (predicted != config.predictedController) revert InvalidController(config.predictedController);

        uint256 circulating = BoardroomToken(shareToken).governanceEligibleSupply();
        if (circulating < MIN_LAUNCH_CIRCULATING_SUPPLY) revert InvalidLaunchSupply(circulating);
        _requireStakerPower(config.protectionStaker, WIND_DOWN_BPS);

        _authorizeControllerDeployment(
            config.predictedController, config.proposer, config.controllerDelay, config.gracePeriod, config.generation
        );
        address deployed = BoardroomControllerFactory(controllerFactory)
            .deployController(
                config.predictedController,
                config.proposer,
                config.controllerDelay,
                config.gracePeriod,
                config.generation
            );
        _clearControllerDeploymentAuthorization();
        _delegateMarket(
            abi.encodeCall(
                BoardroomMarketLogic.verifyController,
                (
                    controllerFactory,
                    deployed,
                    config.proposer,
                    config.controllerDelay,
                    config.gracePeriod,
                    config.generation
                )
            )
        );

        BoardroomCoreStorage.Layout storage core = BoardroomCoreStorage.layout();
        core.launched = true;
        core.controller = deployed;
        core.controllerGeneration = config.generation;
        core.protectionStaker = config.protectionStaker;
        core.windDownDelay = config.windDownDelay;
        _setOwner(deployed);

        BoardroomPrimaryMarketStorage.Layout storage market = BoardroomPrimaryMarketStorage.layout();
        if (market.mode == BoardroomPrimaryMarketStorage.Mode.Unset) {
            market.mode = BoardroomPrimaryMarketStorage.Mode.GeneralAvailability;
            emit PrimaryMarketModeChanged(market.mode);
        }

        emit BoardroomLaunched(
            deployed,
            config.proposer,
            config.protectionStaker,
            config.generation,
            config.controllerDelay,
            config.windDownDelay,
            config.gracePeriod
        );
    }

    function replaceController(
        address expectedCurrentController,
        address expectedNextController,
        address nextProposer,
        uint64 nextDelay,
        uint64 nextGracePeriod,
        uint64 nextGeneration
    ) external {
        if (msg.sender != address(this)) revert Unauthorized();
        _requireStatus(BoardroomStatus.Active);
        BoardroomCoreStorage.Layout storage core = BoardroomCoreStorage.layout();
        if (
            !core.launched || expectedCurrentController != core.controller
                || nextGeneration != core.controllerGeneration + 1 || expectedNextController.code.length != 0
                || BoardroomControllerFactory(controllerFactory).predictControllerAddress(address(this), nextGeneration)
                    != expectedNextController
        ) revert InvalidControllerReplacement();

        _authorizeControllerDeployment(expectedNextController, nextProposer, nextDelay, nextGracePeriod, nextGeneration);
        address nextController = BoardroomControllerFactory(controllerFactory)
            .deployController(expectedNextController, nextProposer, nextDelay, nextGracePeriod, nextGeneration);
        _clearControllerDeploymentAuthorization();
        _delegateMarket(
            abi.encodeCall(
                BoardroomMarketLogic.verifyController,
                (controllerFactory, nextController, nextProposer, nextDelay, nextGracePeriod, nextGeneration)
            )
        );

        address oldController = core.controller;
        core.controller = nextController;
        core.controllerGeneration = nextGeneration;
        uint64 nextEpoch = core.governanceEpoch + 1;
        core.governanceEpoch = nextEpoch;
        _setOwner(nextController);

        emit GovernanceEpochAdvanced(nextEpoch);
        emit BoardroomControllerReplaced(
            oldController, nextController, nextGeneration, nextProposer, nextDelay, nextGracePeriod
        );
    }

    function veto(bytes32 operationId) external {
        if (!launched()) revert BoardroomNotLaunched();
        _requireStatus(BoardroomStatus.Active);
        _requireStakerPower(msg.sender, VETO_BPS);
        BoardroomController(controller()).cancelOperation(operationId);
        emit BoardroomOperationVetoed(operationId, msg.sender);
    }

    /// @notice Authenticates the approved one-percent veto for a quarantined canonical curve.
    function requireBondingCurveForfeitureVetoPower(address account) external view {
        if (msg.sender != BoardroomPrimaryMarketStorage.layout().curve || status() != BoardroomStatus.WindingDown) {
            revert InvalidExecutionContext();
        }
        _requireStakerPower(account, VETO_BPS);
    }

    function isControllerDeploymentAuthorized(
        address expectedController,
        address proposer,
        uint64 delay,
        uint64 gracePeriod,
        uint64 generation
    ) external view returns (bool) {
        if (msg.sender != controllerFactory) return false;
        return BoardroomCoreStorage.layout().controllerDeploymentAuthorization
            == keccak256(abi.encode(expectedController, proposer, delay, gracePeriod, generation));
    }

    function execute(Call calldata call_) external payable nonReentrant returns (bytes memory result) {
        _requirePrelaunchOwner();
        result = _executeCall(call_.policy, call_.target, call_.value, call_.data, msg.sender);
    }

    function executeBatch(Call[] calldata calls) external payable nonReentrant returns (bytes[] memory results) {
        _requirePrelaunchOwner();
        uint256 length = calls.length;
        _requireValidBatchLength(length);
        results = new bytes[](length);
        for (uint256 i; i < length; ++i) {
            results[i] = _executeCall(calls[i].policy, calls[i].target, calls[i].value, calls[i].data, msg.sender);
        }
    }

    function executeGovernance(uint256 expectedEpoch, address authority, BoardroomCall[] calldata calls)
        external
        nonReentrant
        returns (bytes[] memory results)
    {
        BoardroomCoreStorage.Layout storage core = BoardroomCoreStorage.layout();
        if (!core.launched) revert BoardroomNotLaunched();
        if (msg.sender != core.controller || msg.sender != owner()) revert Unauthorized();
        _requireStatus(BoardroomStatus.Active);
        if (expectedEpoch != core.governanceEpoch) {
            revert GovernanceEpochMismatch(expectedEpoch, core.governanceEpoch);
        }
        if (authority != BoardroomController(msg.sender).proposer()) revert InvalidExecutionContext();

        uint256 length = calls.length;
        _requireValidBatchLength(length);
        if (_containsControllerReplacement(calls) && length != 1) revert InvalidControllerReplacement();
        results = new bytes[](length);
        for (uint256 i; i < length; ++i) {
            if (
                core.controller != msg.sender || core.governanceEpoch != expectedEpoch
                    || core.status != BoardroomCoreStorage.Status.Active
            ) revert InvalidControllerReplacement();
            results[i] = _executeCall(calls[i].policy, calls[i].target, calls[i].value, calls[i].data, authority);
        }
    }

    function mint(address to, uint256 amount) external {
        _requireGovernanceCaller();
        _requireStatus(BoardroomStatus.Active);
        if (to == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        BoardroomToken(shareToken).mint(to, amount);
        emit SharesMinted(to, amount);
    }

    function setRedemptionExcessRecipient(address recipient) external {
        _requireGovernanceCaller();
        _requireStatus(BoardroomStatus.Active);
        if (recipient == address(0) || recipient == address(this)) revert InvalidAddress();
        redemptionExcessRecipient = recipient;
        emit RedemptionExcessRecipientSet(recipient);
    }

    function startWindDown() external nonReentrant {
        BoardroomCoreStorage.Layout storage core = BoardroomCoreStorage.layout();
        if (core.launched) _requireStakerPower(msg.sender, WIND_DOWN_BPS);
        else _requireOwner();
        _requireStatus(BoardroomStatus.Active);

        _wrapNativeBalance();
        BoardroomToken(shareToken).disableRewardLocks();
        core.status = BoardroomCoreStorage.Status.WindingDown;
        core.windDownStartedAt = uint64(block.timestamp);
        uint64 nextEpoch = core.governanceEpoch + 1;
        core.governanceEpoch = nextEpoch;
        emit GovernanceEpochAdvanced(nextEpoch);
        emit BoardroomWindDownStarted(msg.sender, nextEpoch, core.windDownDelay);
    }

    function executeWindDownCall(Call calldata call_) external nonReentrant returns (bytes memory result) {
        _requireStatus(BoardroomStatus.WindingDown);
        BoardroomObligationStorage.Record storage record =
            BoardroomObligationStorage.layout().obligationOf[call_.target];
        if (!record.active || record.policy != call_.policy || call_.value != 0) {
            revert CallNotAllowed(call_.policy, call_.target, _selector(call_.data));
        }
        result = _executeCall(call_.policy, call_.target, call_.value, call_.data, msg.sender);
    }

    function wrapNativeBalance() external nonReentrant {
        BoardroomStatus current = status();
        if (current == BoardroomStatus.Active) _requireGovernanceCaller();
        else if (current == BoardroomStatus.RedemptionsOpen) revert InvalidStatus(BoardroomStatus.Snapshotting, current);
        _wrapNativeBalance();
    }

    function reserveRedeemableAsset(address asset) external {
        if (!IBoardroomPolicyRegistry(policyRegistry).isModulePolicy(msg.sender)) {
            revert InvalidObligationPolicy(msg.sender);
        }
        if (!BoardroomCoreStorage.layout().executionActive) revert InvalidExecutionContext();
        _requireStatus(BoardroomStatus.Active);
        _registerAsset(asset);

        BoardroomObligationStorage.Layout storage obligations = BoardroomObligationStorage.layout();
        BoardroomObligationStorage.Record storage rewardsRecord = obligations.obligationOf[obligations.rewardPool];
        if (rewardsRecord.active && rewardsRecord.policy == msg.sender) {
            _delegateGovernance(
                abi.encodeCall(
                    BoardroomGovernanceLogic.addObligationDependency, (shareToken, obligations.rewardPool, asset)
                )
            );
        }
    }

    function registerRedeemableAsset(address asset) external {
        _requireGovernanceCaller();
        BoardroomStatus current = status();
        if (current != BoardroomStatus.Active && current != BoardroomStatus.WindingDown) {
            revert InvalidStatus(BoardroomStatus.WindingDown, current);
        }
        if (current == BoardroomStatus.WindingDown) {
            (bool readable, uint256 balance) = BestEffortTokenLib.tryBalanceOf(asset, address(this));
            if (!readable || balance == 0) revert EmptyRedeemableAsset(asset);
        }
        if (BoardroomAssetStorage.layout().isRegistered[asset]) {
            revert RedeemableAssetAlreadyRegistered(asset);
        }
        _registerAsset(asset);
    }

    function removeRedeemableAsset(address asset) external {
        _requireGovernanceCaller();
        _requireStatus(BoardroomStatus.Active);
        if (asset == wrappedNative) revert InvalidRedeemableAsset(asset);
        BoardroomAssetStorage.Layout storage assets = BoardroomAssetStorage.layout();
        if (!assets.isRegistered[asset]) revert InvalidRedeemableAsset(asset);
        uint256 dependencies = BoardroomObligationStorage.layout().assetDependencyCount[asset];
        if (dependencies != 0) revert RedeemableAssetDependency(asset, dependencies);
        (bool readable, uint256 balance) = BestEffortTokenLib.tryBalanceOf(asset, address(this));
        if (!readable) revert InvalidRedeemableAsset(asset);
        if (balance != 0) revert RedeemableAssetHasBalance(asset, balance);
        assets.isRegistered[asset] = false;
        emit RedeemableAssetRemoved(asset);
    }

    function obligationOf(address obligation)
        external
        view
        returns (address policy, BoardroomObligationStorage.Kind kind, bool active, bool everRegistered)
    {
        BoardroomObligationStorage.Record storage record = BoardroomObligationStorage.layout().obligationOf[obligation];
        return (record.policy, record.kind, record.active, record.everRegistered);
    }

    function obligationPolicyOf(address obligation) external view returns (address) {
        return BoardroomObligationStorage.layout().obligationOf[obligation].policy;
    }

    function isIssuedGrant(address obligation) external view returns (bool) {
        BoardroomObligationStorage.Record storage record = BoardroomObligationStorage.layout().obligationOf[obligation];
        return record.active && record.kind == BoardroomObligationStorage.Kind.Grant;
    }

    function isIssuedDistribution(address obligation) external view returns (bool) {
        BoardroomObligationStorage.Record storage record = BoardroomObligationStorage.layout().obligationOf[obligation];
        return record.active && record.kind == BoardroomObligationStorage.Kind.Distribution;
    }

    function isLockedLiquidity(address obligation) external view returns (bool) {
        BoardroomObligationStorage.Record storage record = BoardroomObligationStorage.layout().obligationOf[obligation];
        return record.active && record.kind == BoardroomObligationStorage.Kind.Liquidity;
    }

    function activeObligationCount() external view returns (uint256) {
        return BoardroomObligationStorage.layout().activeCount;
    }

    function activeObligationCountByKind(BoardroomObligationStorage.Kind kind) external view returns (uint256) {
        return BoardroomObligationStorage.layout().activeByKind[kind];
    }

    function assetDependencyCount(address asset) external view returns (uint256) {
        return BoardroomObligationStorage.layout().assetDependencyCount[asset];
    }

    function obligationDependencyCount(address obligation) external view returns (uint256) {
        return BoardroomObligationStorage.layout().dependenciesOf[obligation].length;
    }

    function obligationDependencyAt(address obligation, uint256 index) external view returns (address) {
        return BoardroomObligationStorage.layout().dependenciesOf[obligation][index];
    }

    function rewardPool() public view returns (address) {
        return BoardroomObligationStorage.layout().rewardPool;
    }

    function pruneObligation(address obligation) public nonReentrant returns (bool pruned) {
        pruned = abi.decode(
            _delegateGovernance(abi.encodeCall(BoardroomGovernanceLogic.pruneObligation, (shareToken, obligation))),
            (bool)
        );
    }

    function pruneObligations(address[] calldata obligations) external nonReentrant returns (uint256 pruned) {
        pruned = abi.decode(
            _delegateGovernance(abi.encodeCall(BoardroomGovernanceLogic.pruneObligations, (shareToken, obligations))),
            (uint256)
        );
    }

    function recordGrantFromDistribution(address grant) external {
        _delegateGovernance(
            abi.encodeCall(BoardroomGovernanceLogic.recordGrantFromDistribution, (policyRegistry, shareToken, grant))
        );
    }

    function recordLockedLiquidityFromDistribution(address locker, address pool) external {
        _delegateGovernance(
            abi.encodeCall(
                BoardroomGovernanceLogic.recordLockedLiquidityFromDistribution,
                (policyRegistry, shareToken, locker, pool)
            )
        );
    }

    function beginSnapshot() external nonReentrant {
        _delegateRedemption(abi.encodeCall(BoardroomRedemptionPayout.beginSnapshot, (shareToken, wrappedNative)));
    }

    function snapshotAssets(uint256 maximum) external nonReentrant returns (uint256 processed) {
        processed = abi.decode(
            _delegateRedemption(
                abi.encodeCall(BoardroomRedemptionPayout.processSnapshotAssets, (maximum, MAX_SNAPSHOT_PAGE))
            ),
            (uint256)
        );
    }

    function openRedemptions() external {
        _delegateRedemption(abi.encodeCall(BoardroomRedemptionPayout.openRedemptions, ()));
    }

    function redeem(uint256 shares) external nonReentrant {
        _delegateRedemption(abi.encodeCall(BoardroomRedemptionPayout.redeem, (shareToken, msg.sender, shares)));
    }

    function claimRedemptionAsset(address asset, address recipient, uint256 minAmountOut)
        public
        nonReentrant
        returns (uint256 amountOut)
    {
        _requireStatus(BoardroomStatus.RedemptionsOpen);
        if (
            recipient == address(0) || recipient == address(this)
                || BoardroomAssetStorage.layout().snapshotStatus[asset] != BoardroomAssetStorage.SnapshotStatus.Included
        ) revert InvalidRedemptionInput();
        amountOut = abi.decode(
            _delegateRedemption(
                abi.encodeCall(BoardroomRedemptionPayout.payout, (msg.sender, asset, recipient, minAmountOut))
            ),
            (uint256)
        );
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

    function sweepRedemptionExcess(address asset) external nonReentrant returns (uint256 amount) {
        _requireStatus(BoardroomStatus.RedemptionsOpen);
        if (asset == address(0) || asset == shareToken || asset == address(this)) revert InvalidRedeemableAsset(asset);
        _wrapNativeBalance();
        amount = abi.decode(
            _delegateRedemption(
                abi.encodeCall(BoardroomRedemptionPayout.sweepExcess, (asset, redemptionExcessRecipient))
            ),
            (uint256)
        );
    }

    function redeemableAssetCount() external view returns (uint256) {
        return BoardroomAssetStorage.layout().registry.length;
    }

    function redeemableAssetAt(uint256 index) external view returns (address) {
        return BoardroomAssetStorage.layout().registry[index];
    }

    function redeemableAssetPage(uint256 cursor, uint256 size)
        external
        view
        returns (address[] memory page, uint256 nextCursor)
    {
        if (size == 0 || size > MAX_SNAPSHOT_PAGE) revert InvalidSnapshotPage(size, MAX_SNAPSHOT_PAGE);
        BoardroomAssetStorage.Layout storage assets = BoardroomAssetStorage.layout();
        uint256 length = assets.registry.length;
        if (cursor >= length) return (new address[](0), length);
        uint256 end = cursor + size;
        if (end > length) end = length;
        page = new address[](end - cursor);
        for (uint256 i; i < page.length; ++i) {
            page[i] = assets.registry[cursor + i];
        }
        nextCursor = end;
    }

    function isRedeemableAsset(address asset) external view returns (bool) {
        return BoardroomAssetStorage.layout().isRegistered[asset];
    }

    function redeemableAssetSnapshotStatus(address asset) external view returns (BoardroomAssetStorage.SnapshotStatus) {
        return BoardroomAssetStorage.layout().snapshotStatus[asset];
    }

    function assetSnapshotProgress() external view returns (uint256 frozenCount, uint256 cursor, bool frozen) {
        BoardroomAssetStorage.Layout storage assets = BoardroomAssetStorage.layout();
        return (assets.frozenCount, assets.snapshotCursor, assets.frozen);
    }

    function redemptionSupplyState() external view returns (uint256 supply, bool frozen) {
        BoardroomRedemptionStorage.Layout storage redemption = BoardroomRedemptionStorage.layout();
        return (redemption.supply, redemption.supplyFrozen);
    }

    function primaryMarketMode() external view returns (BoardroomPrimaryMarketStorage.Mode) {
        return BoardroomPrimaryMarketStorage.layout().mode;
    }

    function bondingCurve() external view returns (address) {
        return BoardroomPrimaryMarketStorage.layout().curve;
    }

    function primaryMarketQuoteAsset() external view returns (address) {
        return BoardroomPrimaryMarketStorage.layout().quoteAsset;
    }

    function liquidityStatus() external view returns (BoardroomLiquidityStorage.Status) {
        return BoardroomLiquidityStorage.layout().status;
    }

    function liquidityLocker() public view returns (address) {
        return BoardroomLiquidityStorage.layout().locker;
    }

    function liquidityPool() external view returns (address) {
        return BoardroomLiquidityStorage.layout().pool;
    }

    function liquidityQuoteAsset() external view returns (address) {
        return BoardroomLiquidityStorage.layout().quoteAsset;
    }

    function liquidityReservation()
        external
        view
        returns (address curve, address expectedLocker, bytes32 pairKey, bytes32 salt, uint256 expiresAt)
    {
        BoardroomLiquidityStorage.MigrationReservation storage reservation =
        BoardroomLiquidityStorage.layout().pendingMigration;
        return
            (
                reservation.curve,
                reservation.expectedLocker,
                reservation.pairKey,
                reservation.salt,
                reservation.expiresAt
            );
    }

    function precommitBondingCurve(address curve, address quoteAsset, uint256 fundingAmount) external {
        _delegateMarket(
            abi.encodeCall(BoardroomMarketLogic.precommitBondingCurve, (shareToken, curve, quoteAsset, fundingAmount))
        );
    }

    function validatePrimaryMarketTransfer(address from, address to, uint256 amount) external {
        _delegateMarket(
            abi.encodeCall(BoardroomMarketLogic.validatePrimaryMarketTransfer, (shareToken, from, to, amount))
        );
    }

    function precommitProtocolLiquidity(
        address expectedLocker,
        address quoteAsset,
        address curve,
        bytes32 pairKey,
        bytes32 salt,
        uint64 expiresAt
    ) external {
        _delegateMarket(
            abi.encodeCall(
                BoardroomMarketLogic.precommitProtocolLiquidity,
                (policyRegistry, shareToken, expectedLocker, quoteAsset, curve, pairKey, salt, expiresAt)
            )
        );
    }

    function activateProtocolLiquidity(
        address locker,
        address pool,
        address quoteAsset,
        address curve,
        bytes32 pairKey,
        bytes32 salt
    ) external {
        _delegateMarket(
            abi.encodeCall(
                BoardroomMarketLogic.activateProtocolLiquidity,
                (policyRegistry, locker, pool, quoteAsset, curve, pairKey, salt)
            )
        );
    }

    function releaseProtocolLiquidityReservation(address curve, bytes32 pairKey, bytes32 salt) external {
        _delegateMarket(
            abi.encodeCall(
                BoardroomMarketLogic.releaseProtocolLiquidityReservation, (policyRegistry, curve, pairKey, salt)
            )
        );
    }

    function settleBondingCurve() external {
        _delegateMarket(abi.encodeCall(BoardroomMarketLogic.settleBondingCurve, ()));
        _delegateGovernance(abi.encodeCall(BoardroomGovernanceLogic.pruneObligation, (shareToken, msg.sender)));
    }

    function closeProtocolLiquidityFromFactory(address locker) external {
        _delegateMarket(abi.encodeCall(BoardroomMarketLogic.closeProtocolLiquidity, (policyRegistry, locker)));
        _delegateGovernance(abi.encodeCall(BoardroomGovernanceLogic.pruneObligation, (shareToken, locker)));
    }

    function lockedLiquidityExitAllowed() external view returns (bool) {
        return status() == BoardroomStatus.WindingDown;
    }

    function liquidityMutationAllowed() external view returns (bool) {
        BoardroomStatus current = status();
        return current == BoardroomStatus.Active || current == BoardroomStatus.WindingDown;
    }

    function burnTreasuryShares() external returns (uint256 burned) {
        BoardroomStatus current = status();
        if (current == BoardroomStatus.Active) revert InvalidStatus(BoardroomStatus.WindingDown, current);
        burned = _burnTreasuryShares(BoardroomRedemptionStorage.layout().supplyFrozen);
    }

    function exitProtocolLiquidity(uint256 amountAMin, uint256 amountBMin, uint256 deadline)
        external
        nonReentrant
        returns (uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        _requireStatus(BoardroomStatus.WindingDown);
        address locker = liquidityLocker();
        if (locker == address(0)) revert ObligationNotActive(locker);
        (amountA, amountB, liquidity) = LockedLiquidity(locker).exitToBoardroom(amountAMin, amountBMin, deadline);
    }

    function returnProtocolLiquidityAsLp() external nonReentrant returns (uint256 liquidity) {
        _requireStatus(BoardroomStatus.WindingDown);
        address locker = liquidityLocker();
        if (locker == address(0)) revert ObligationNotActive(locker);
        liquidity = LockedLiquidity(locker).returnLpToBoardroom();
    }

    function closeProtocolLiquidityAfterWindDown() external nonReentrant {
        _requireStatus(BoardroomStatus.WindingDown);
        address locker = liquidityLocker();
        if (locker == address(0)) revert ObligationNotActive(locker);
        LockedLiquidity(locker).close();
        IBoardroomLiquidityFactoryFinalizer(LockedLiquidity(locker).factory()).finalizeWindDownClosure();
        _delegateMarket(abi.encodeCall(BoardroomMarketLogic.closeProtocolLiquidityForWindDown, (locker)));
        _delegateGovernance(abi.encodeCall(BoardroomGovernanceLogic.pruneObligation, (shareToken, locker)));
    }

    function _executeCall(address policy, address target, uint256 value, bytes calldata data, address authority)
        internal
        returns (bytes memory result)
    {
        result = abi.decode(
            _delegateGovernance(
                abi.encodeCall(
                    BoardroomGovernanceLogic.executeCall,
                    (policyRegistry, shareToken, uint8(status()), authority, policy, target, value, data)
                )
            ),
            (bytes)
        );
    }

    function _registerAsset(address asset) internal {
        _validateAsset(asset);
        BoardroomAssetStorage.Layout storage assets = BoardroomAssetStorage.layout();
        if (assets.frozen) revert SnapshotAlreadyFrozen();
        if (!assets.everRegistered[asset]) {
            assets.everRegistered[asset] = true;
            assets.registry.push(asset);
        }
        if (!assets.isRegistered[asset]) {
            assets.isRegistered[asset] = true;
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

    function _burnTreasuryShares(bool forfeit) internal returns (uint256 burned) {
        burned = abi.decode(
            _delegateRedemption(abi.encodeCall(BoardroomRedemptionPayout.burnTreasuryShares, (shareToken, forfeit))),
            (uint256)
        );
    }

    function _wrapNativeBalance() internal {
        _delegateRedemption(abi.encodeCall(BoardroomRedemptionPayout.wrapNative, (wrappedNative)));
    }

    function _containsControllerReplacement(BoardroomCall[] calldata calls) internal view returns (bool) {
        uint256 length = calls.length;
        for (uint256 i; i < length; ++i) {
            if (calls[i].target == address(this) && _selector(calls[i].data) == Boardroom.replaceController.selector) {
                return true;
            }
        }
        return false;
    }

    function _authorizeControllerDeployment(
        address expectedController,
        address proposer,
        uint64 delay,
        uint64 gracePeriod,
        uint64 generation
    ) internal {
        _delegateMarket(
            abi.encodeCall(
                BoardroomMarketLogic.authorizeControllerDeployment,
                (expectedController, proposer, delay, gracePeriod, generation)
            )
        );
    }

    function _clearControllerDeploymentAuthorization() internal {
        _delegateMarket(abi.encodeCall(BoardroomMarketLogic.clearControllerDeploymentAuthorization, ()));
    }

    function _requireGovernanceCaller() internal view {
        if (msg.sender == address(this)) return;
        _requirePrelaunchOwner();
    }

    function _requirePrelaunchOwner() internal view {
        if (launched()) revert BoardroomAlreadyLaunched();
        _requireOwner();
    }

    function _requireOwner() internal view {
        if (msg.sender != owner()) revert Unauthorized();
    }

    function _requireStakerPower(address account, uint256 thresholdBps) internal view {
        if (account == address(0)) revert InvalidProtectionStaker(account);
        BoardroomGovernanceLogic(governanceLogic)
            .requireStakerPower(shareToken, rewardPool(), account, thresholdBps, GOVERNANCE_BPS_DENOMINATOR);
    }

    function _requireStatus(BoardroomStatus expected) internal view {
        BoardroomStatus actual = status();
        if (actual != expected) revert InvalidStatus(expected, actual);
    }

    function _requireValidBatchLength(uint256 length) internal pure {
        if (length == 0) revert EmptyBatch();
        if (length > MAX_BATCH_CALLS) revert TooManyCalls(length, MAX_BATCH_CALLS);
    }

    function _selector(bytes calldata data) internal pure returns (bytes4 selector) {
        if (data.length < 4) return bytes4(0);
        return bytes4(data[:4]);
    }

    function _delegateGovernance(bytes memory input) internal returns (bytes memory result) {
        (bool success, bytes memory output) = governanceLogic.delegatecall(input);
        if (!success) _revertCall(governanceLogic, output);
        return output;
    }

    function _delegateMarket(bytes memory input) internal returns (bytes memory result) {
        (bool success, bytes memory output) = marketLogic.delegatecall(input);
        if (!success) _revertCall(marketLogic, output);
        return output;
    }

    function _delegateRedemption(bytes memory input) internal returns (bytes memory result) {
        (bool success, bytes memory output) = redemptionPayoutLogic.delegatecall(input);
        if (!success) _revertCall(redemptionPayoutLogic, output);
        return output;
    }

    function _revertCall(address target, bytes memory returnData) internal pure {
        if (returnData.length == 0) revert CallFailed(target);
        assembly ("memory-safe") {
            revert(add(returnData, 0x20), mload(returnData))
        }
    }
}
