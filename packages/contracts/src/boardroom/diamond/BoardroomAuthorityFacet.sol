// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {BoardroomCoreStorage} from "../storage/BoardroomCoreStorage.sol";
import {BoardroomPrimaryMarketStorage} from "../storage/BoardroomPrimaryMarketStorage.sol";
import {BoardroomMarketLogic} from "../BoardroomMarketLogic.sol";
import {BestEffortTokenLib} from "../../lib/BestEffortTokenLib.sol";
import {BoardroomDiamondStorage} from "./BoardroomDiamondStorage.sol";
import {BoardroomFacetBase} from "./BoardroomFacetBase.sol";
import {BoardroomFacetTypes} from "./BoardroomFacetTypes.sol";
import {BoardroomToken} from "../BoardroomToken.sol";
import {BoardroomController} from "../BoardroomController.sol";
import {BoardroomControllerFactory} from "../BoardroomControllerFactory.sol";

/// @notice Native ownership, launch, controller, issuance, and wind-down behavior.
contract BoardroomAuthorityFacet is BoardroomFacetBase {
    error InvalidInitializationContext();

    constructor(
        address redemptionPayoutLogic_,
        address governanceLogic_,
        address controllerFactory_,
        address marketLogic_
    ) BoardroomFacetBase(redemptionPayoutLogic_, governanceLogic_, controllerFactory_, marketLogic_) {}

    function initializeBoardroom(bytes32, bytes calldata initializationData) external {
        if (!BoardroomDiamondStorage.layout().initializing) revert InvalidInitializationContext();
        (address owner_, address policyRegistry_, address wrappedNative_, string memory name_, string memory symbol_) =
            abi.decode(initializationData, (address, address, address, string, string));
        if (
            owner_ == address(0) || policyRegistry_ == address(0) || policyRegistry_.code.length == 0
                || wrappedNative_ == address(0) || wrappedNative_.code.length == 0
        ) revert InvalidAddress();

        _initializeOwner(owner_);
        policyRegistryStorage = policyRegistry_;
        wrappedNativeStorage = wrappedNative_;
        redemptionExcessRecipientStorage = owner_;
        BoardroomToken token = new BoardroomToken(address(this), name_, symbol_);
        shareTokenStorage = address(token);

        BoardroomCoreStorage.Layout storage core = BoardroomCoreStorage.layout();
        core.governanceEpoch = 1;
        core.windDownDelay = MIN_WIND_DOWN_DELAY_VALUE;
        (bool readable,) = BestEffortTokenLib.tryBalanceOf(wrappedNative_, address(this));
        if (!readable) revert InvalidRedeemableAsset(wrappedNative_);
        _registerAsset(wrappedNative_);

        emit BoardroomInitialized(owner_, policyRegistry_, address(token), wrappedNative_, name_, symbol_);
        emit RedemptionExcessRecipientSet(owner_);
    }

    function transferOwnership(bytes32, address newOwner) external payable {
        if (_launched()) revert OwnershipLockedAfterLaunch();
        address oldOwner = owner();
        super.transferOwnership(newOwner);
        if (redemptionExcessRecipientStorage == oldOwner) {
            redemptionExcessRecipientStorage = newOwner;
            emit RedemptionExcessRecipientSet(newOwner);
        }
    }

    function completeOwnershipHandover(bytes32, address pendingOwner) external payable {
        if (_launched()) revert OwnershipLockedAfterLaunch();
        address oldOwner = owner();
        super.completeOwnershipHandover(pendingOwner);
        if (redemptionExcessRecipientStorage == oldOwner) {
            redemptionExcessRecipientStorage = pendingOwner;
            emit RedemptionExcessRecipientSet(pendingOwner);
        }
    }

    function requestOwnershipHandover(bytes32) external payable {
        if (_launched()) revert OwnershipLockedAfterLaunch();
        super.requestOwnershipHandover();
    }

    function cancelOwnershipHandover(bytes32) external payable {
        if (_launched()) revert OwnershipLockedAfterLaunch();
        super.cancelOwnershipHandover();
    }

    function renounceOwnership(bytes32) external payable {
        revert OwnershipRenunciationDisabled();
    }

    function launch(bytes32, BoardroomFacetTypes.LaunchConfig calldata config) external nonReentrant {
        _requirePrelaunchOwner();
        _requireStatus(BoardroomFacetTypes.BoardroomStatus.Active);
        if (
            config.proposer == address(0) || config.predictedController == address(0)
                || config.protectionStaker == address(0) || config.generation != 1
                || config.expectedRewardPool != _rewardPool()
                || config.expectedRedemptionExcessRecipient != redemptionExcessRecipientStorage
                || config.windDownDelay < MIN_WIND_DOWN_DELAY_VALUE || config.windDownDelay > MAX_WIND_DOWN_DELAY_VALUE
        ) revert InvalidLaunchConfiguration();
        if (config.predictedController.code.length != 0) {
            revert ControllerAlreadyDeployed(config.predictedController);
        }
        address predicted =
            BoardroomControllerFactory(controllerFactoryAddress).predictControllerAddress(address(this), 1);
        if (predicted != config.predictedController) revert InvalidController(config.predictedController);

        uint256 circulating = BoardroomToken(shareTokenStorage).governanceEligibleSupply();
        if (circulating < MIN_LAUNCH_CIRCULATING_SUPPLY) revert InvalidLaunchSupply(circulating);
        _requireStakerPower(config.protectionStaker, WIND_DOWN_BPS);

        _authorizeControllerDeployment(
            config.predictedController, config.proposer, config.controllerDelay, config.gracePeriod, config.generation
        );
        address deployed = BoardroomControllerFactory(controllerFactoryAddress)
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
                    controllerFactoryAddress,
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
        bytes32,
        address expectedCurrentController,
        address expectedNextController,
        address nextProposer,
        uint64 nextDelay,
        uint64 nextGracePeriod,
        uint64 nextGeneration
    ) external {
        if (msg.sender != address(this)) revert Unauthorized();
        _requireStatus(BoardroomFacetTypes.BoardroomStatus.Active);
        BoardroomCoreStorage.Layout storage core = BoardroomCoreStorage.layout();
        if (
            !core.launched || expectedCurrentController != core.controller
                || nextGeneration != core.controllerGeneration + 1 || expectedNextController.code.length != 0
                || BoardroomControllerFactory(controllerFactoryAddress)
                        .predictControllerAddress(address(this), nextGeneration) != expectedNextController
        ) revert InvalidControllerReplacement();

        _authorizeControllerDeployment(expectedNextController, nextProposer, nextDelay, nextGracePeriod, nextGeneration);
        address nextController = BoardroomControllerFactory(controllerFactoryAddress)
            .deployController(expectedNextController, nextProposer, nextDelay, nextGracePeriod, nextGeneration);
        _clearControllerDeploymentAuthorization();
        _delegateMarket(
            abi.encodeCall(
                BoardroomMarketLogic.verifyController,
                (controllerFactoryAddress, nextController, nextProposer, nextDelay, nextGracePeriod, nextGeneration)
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

    function veto(bytes32, bytes32 operationId) external {
        if (!_launched()) revert BoardroomNotLaunched();
        _requireStatus(BoardroomFacetTypes.BoardroomStatus.Active);
        _requireStakerPower(msg.sender, VETO_BPS);
        BoardroomController(_controller()).cancelOperation(operationId);
        emit BoardroomOperationVetoed(operationId, msg.sender);
    }

    function mint(bytes32, address to, uint256 amount) external {
        _requireGovernanceCaller();
        _requireStatus(BoardroomFacetTypes.BoardroomStatus.Active);
        if (to == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        BoardroomToken(shareTokenStorage).mint(to, amount);
        emit SharesMinted(to, amount);
    }

    function setRedemptionExcessRecipient(bytes32, address recipient) external {
        _requireGovernanceCaller();
        _requireStatus(BoardroomFacetTypes.BoardroomStatus.Active);
        if (recipient == address(0) || recipient == address(this)) revert InvalidAddress();
        redemptionExcessRecipientStorage = recipient;
        emit RedemptionExcessRecipientSet(recipient);
    }

    function startWindDown(bytes32) external nonReentrant {
        BoardroomCoreStorage.Layout storage core = BoardroomCoreStorage.layout();
        if (core.launched) _requireStakerPower(msg.sender, WIND_DOWN_BPS);
        else _requireOwner();
        _requireStatus(BoardroomFacetTypes.BoardroomStatus.Active);

        _wrapNativeBalance();
        BoardroomToken(shareTokenStorage).disableRewardLocks();
        core.status = BoardroomCoreStorage.Status.WindingDown;
        core.windDownStartedAt = uint64(block.timestamp);
        uint64 nextEpoch = core.governanceEpoch + 1;
        core.governanceEpoch = nextEpoch;
        emit GovernanceEpochAdvanced(nextEpoch);
        emit BoardroomWindDownStarted(msg.sender, nextEpoch, core.windDownDelay);
    }
}
