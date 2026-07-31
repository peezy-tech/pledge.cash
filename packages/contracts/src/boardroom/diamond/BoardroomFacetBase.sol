// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "solady/auth/Ownable.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {BoardroomGovernanceLogic} from "../BoardroomGovernanceLogic.sol";
import {BoardroomMarketLogic} from "../BoardroomMarketLogic.sol";
import {BoardroomRedemptionPayout} from "../BoardroomRedemptionPayout.sol";
import {BoardroomRedemptionStorage} from "../BoardroomRedemptionStorage.sol";
import {BoardroomAssetStorage} from "../storage/BoardroomAssetStorage.sol";
import {BoardroomCoreStorage} from "../storage/BoardroomCoreStorage.sol";
import {BoardroomLiquidityStorage} from "../storage/BoardroomLiquidityStorage.sol";
import {BoardroomObligationStorage} from "../storage/BoardroomObligationStorage.sol";
import {BoardroomPrimaryMarketStorage} from "../storage/BoardroomPrimaryMarketStorage.sol";
import {BestEffortTokenLib} from "../../lib/BestEffortTokenLib.sol";
import {BoardroomFacetTypes} from "./BoardroomFacetTypes.sol";

/// @notice Shared storage layout, errors, events, dependencies, and helpers for native Boardroom facets.
/// @dev The four ordinary storage fields are shared by every facet at slots 0 through 3.
abstract contract BoardroomFacetBase is Ownable, ReentrancyGuard {
    uint256 internal constant MAX_BATCH_CALLS_VALUE = 16;
    uint256 internal constant MAX_SNAPSHOT_PAGE_VALUE = 32;
    uint64 internal constant MIN_WIND_DOWN_DELAY_VALUE = 1 days;
    uint64 internal constant MAX_WIND_DOWN_DELAY_VALUE = 30 days;
    uint256 internal constant GOVERNANCE_BPS_DENOMINATOR = 10_000;
    uint256 internal constant VETO_BPS = 100;
    uint256 internal constant WIND_DOWN_BPS = 1_000;
    uint256 internal constant MIN_LAUNCH_CIRCULATING_SUPPLY = 1 ether;

    address internal policyRegistryStorage;
    address internal shareTokenStorage;
    address internal wrappedNativeStorage;
    address internal redemptionExcessRecipientStorage;

    address internal immutable redemptionPayoutLogicAddress;
    address internal immutable governanceLogicAddress;
    address internal immutable controllerFactoryAddress;
    address internal immutable marketLogicAddress;

    error InvalidAddress();
    error InvalidAmount();
    error InvalidStatus(BoardroomFacetTypes.BoardroomStatus expected, BoardroomFacetTypes.BoardroomStatus actual);
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
    error TreasuryContributionExpired(uint256 deadline);
    error TreasuryContributionAmountMismatch(address asset, uint256 expected, uint256 received);

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
    event TreasuryAssetContributed(address indexed contributor, address indexed asset, uint256 amount);
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
        address indexed expectedVault,
        bytes32 indexed expectedPoolId,
        address indexed quoteAsset,
        address curve,
        bytes32 salt,
        uint256 expiresAt
    );
    event ProtocolLiquidityActivated(
        address indexed vault, bytes32 indexed poolId, address indexed quoteAsset, address curve
    );
    event ProtocolLiquidityClosed(address indexed vault, bytes32 indexed poolId, address indexed quoteAsset);
    event ProtocolLiquidityReservationReleased(address indexed curve, address indexed expectedVault, bytes32 salt);

    constructor(
        address redemptionPayoutLogic_,
        address governanceLogic_,
        address controllerFactory_,
        address marketLogic_
    ) {
        if (
            redemptionPayoutLogic_ == address(0) || redemptionPayoutLogic_.code.length == 0
                || governanceLogic_ == address(0) || governanceLogic_.code.length == 0
                || controllerFactory_ == address(0) || controllerFactory_.code.length == 0 || marketLogic_ == address(0)
                || marketLogic_.code.length == 0
        ) revert InvalidAddress();
        redemptionPayoutLogicAddress = redemptionPayoutLogic_;
        governanceLogicAddress = governanceLogic_;
        controllerFactoryAddress = controllerFactory_;
        marketLogicAddress = marketLogic_;
    }

    function _status() internal view returns (BoardroomFacetTypes.BoardroomStatus) {
        return BoardroomFacetTypes.BoardroomStatus(uint8(BoardroomCoreStorage.layout().status));
    }

    function _launched() internal view returns (bool) {
        return BoardroomCoreStorage.layout().launched;
    }

    function _controller() internal view returns (address) {
        return BoardroomCoreStorage.layout().controller;
    }

    function _rewardPool() internal view returns (address) {
        return BoardroomObligationStorage.layout().rewardPool;
    }

    function _liquidityVault() internal view returns (address) {
        return BoardroomLiquidityStorage.layout().vault;
    }

    function _executeCall(address policy, address target, uint256 value, bytes calldata data, address authority)
        internal
        returns (bytes memory result)
    {
        result = abi.decode(
            _delegateGovernance(
                abi.encodeCall(
                    BoardroomGovernanceLogic.executeCall,
                    (policyRegistryStorage, shareTokenStorage, uint8(_status()), authority, policy, target, value, data)
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
        if (asset == address(0) || asset == shareTokenStorage || asset == address(this) || asset.code.length == 0) {
            revert InvalidRedeemableAsset(asset);
        }
        (bool readable,) = BestEffortTokenLib.tryBalanceOf(asset, address(this));
        if (!readable) revert InvalidRedeemableAsset(asset);
    }

    function _burnTreasuryShares(bool forfeit) internal returns (uint256 burned) {
        burned = abi.decode(
            _delegateRedemption(
                abi.encodeCall(BoardroomRedemptionPayout.burnTreasuryShares, (shareTokenStorage, forfeit))
            ),
            (uint256)
        );
    }

    function _wrapNativeBalance() internal {
        _delegateRedemption(abi.encodeCall(BoardroomRedemptionPayout.wrapNative, (wrappedNativeStorage)));
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
        if (_launched()) revert BoardroomAlreadyLaunched();
        _requireOwner();
    }

    function _requireOwner() internal view {
        if (msg.sender != owner()) revert Unauthorized();
    }

    function _requireStakerPower(address account, uint256 thresholdBps) internal view {
        if (account == address(0)) revert InvalidProtectionStaker(account);
        BoardroomGovernanceLogic(governanceLogicAddress)
            .requireStakerPower(shareTokenStorage, _rewardPool(), account, thresholdBps, GOVERNANCE_BPS_DENOMINATOR);
    }

    function _requireStatus(BoardroomFacetTypes.BoardroomStatus expected) internal view {
        BoardroomFacetTypes.BoardroomStatus actual = _status();
        if (actual != expected) revert InvalidStatus(expected, actual);
    }

    function _requireValidBatchLength(uint256 length) internal pure {
        if (length == 0) revert EmptyBatch();
        if (length > MAX_BATCH_CALLS_VALUE) revert TooManyCalls(length, MAX_BATCH_CALLS_VALUE);
    }

    function _selector(bytes calldata data) internal pure returns (bytes4 selector) {
        if (data.length < 4) return bytes4(0);
        return bytes4(data[:4]);
    }

    function _delegateGovernance(bytes memory input) internal returns (bytes memory result) {
        address target = governanceLogicAddress;
        (bool success, bytes memory output) = target.delegatecall(input);
        if (!success) _revertCall(target, output);
        return output;
    }

    function _delegateMarket(bytes memory input) internal returns (bytes memory result) {
        address target = marketLogicAddress;
        (bool success, bytes memory output) = target.delegatecall(input);
        if (!success) _revertCall(target, output);
        return output;
    }

    function _delegateRedemption(bytes memory input) internal returns (bytes memory result) {
        address target = redemptionPayoutLogicAddress;
        (bool success, bytes memory output) = target.delegatecall(input);
        if (!success) _revertCall(target, output);
        return output;
    }

    function _revertCall(address target, bytes memory returnData) internal pure {
        if (returnData.length == 0) revert CallFailed(target);
        assembly ("memory-safe") {
            revert(add(returnData, 0x20), mload(returnData))
        }
    }
}
