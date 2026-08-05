// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {BoardroomGovernanceLogic} from "../BoardroomGovernanceLogic.sol";
import {BoardroomCall} from "../IBoardroomGovernance.sol";
import {IBoardroomPolicyRegistry} from "../IBoardroomPolicyRegistry.sol";
import {BoardroomAssetStorage} from "../storage/BoardroomAssetStorage.sol";
import {BoardroomCoreStorage} from "../storage/BoardroomCoreStorage.sol";
import {BoardroomObligationStorage} from "../storage/BoardroomObligationStorage.sol";
import {BestEffortTokenLib} from "../../lib/BestEffortTokenLib.sol";
import {BoardroomFacetBase} from "./BoardroomFacetBase.sol";
import {BoardroomFacetTypes} from "./BoardroomFacetTypes.sol";
import {BoardroomController} from "../BoardroomController.sol";

/// @notice Native treasury execution, asset, obligation, and child-callback behavior.
contract BoardroomExecutionFacet is BoardroomFacetBase {
    bytes4 internal constant REPLACE_CONTROLLER_SELECTOR =
        bytes4(keccak256("replaceController(bytes32,address,address,address,uint64,uint64,uint64)"));

    constructor(
        address redemptionPayoutLogic_,
        address governanceLogic_,
        address controllerFactory_,
        address marketLogic_
    ) BoardroomFacetBase(redemptionPayoutLogic_, governanceLogic_, controllerFactory_, marketLogic_) {}

    function execute(bytes32, BoardroomFacetTypes.Call calldata call_)
        external
        payable
        nonReentrant
        returns (bytes memory result)
    {
        _requirePrelaunchOwner();
        result = _executeCall(call_.policy, call_.target, call_.value, call_.data, msg.sender);
    }

    function executeBatch(bytes32, BoardroomFacetTypes.Call[] calldata calls)
        external
        payable
        nonReentrant
        returns (bytes[] memory results)
    {
        _requirePrelaunchOwner();
        uint256 length = calls.length;
        _requireValidBatchLength(length);
        results = new bytes[](length);
        for (uint256 i; i < length; ++i) {
            results[i] = _executeCall(calls[i].policy, calls[i].target, calls[i].value, calls[i].data, msg.sender);
        }
    }

    function executeGovernance(bytes32, uint256 expectedEpoch, address authority, BoardroomCall[] calldata calls)
        external
        nonReentrant
        returns (bytes[] memory results)
    {
        BoardroomCoreStorage.Layout storage core = BoardroomCoreStorage.layout();
        if (!core.launched) revert BoardroomNotLaunched();
        if (msg.sender != core.controller || msg.sender != owner()) revert Unauthorized();
        _requireStatus(BoardroomFacetTypes.BoardroomStatus.Active);
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

    function executeWindDownCall(bytes32, BoardroomFacetTypes.Call calldata call_)
        external
        nonReentrant
        returns (bytes memory result)
    {
        _requireStatus(BoardroomFacetTypes.BoardroomStatus.WindingDown);
        BoardroomObligationStorage.Record storage record =
            BoardroomObligationStorage.layout().obligationOf[call_.target];
        if (!record.active || record.policy != call_.policy || call_.value != 0) {
            revert CallNotAllowed(call_.policy, call_.target, _selector(call_.data));
        }
        result = _executeCall(call_.policy, call_.target, call_.value, call_.data, msg.sender);
    }

    function wrapNativeBalance(bytes32) external nonReentrant {
        BoardroomFacetTypes.BoardroomStatus current = _status();
        if (current == BoardroomFacetTypes.BoardroomStatus.Active) {
            _requireGovernanceCaller();
        } else if (current == BoardroomFacetTypes.BoardroomStatus.RedemptionsOpen) {
            revert InvalidStatus(BoardroomFacetTypes.BoardroomStatus.Snapshotting, current);
        }
        _wrapNativeBalance();
    }

    function reserveRedeemableAsset(bytes32, address asset) external {
        if (!IBoardroomPolicyRegistry(policyRegistryStorage).isModulePolicy(msg.sender)) {
            revert InvalidObligationPolicy(msg.sender);
        }
        if (!BoardroomCoreStorage.layout().executionActive) revert InvalidExecutionContext();
        _requireStatus(BoardroomFacetTypes.BoardroomStatus.Active);
        _registerAsset(asset);

        BoardroomObligationStorage.Layout storage obligations = BoardroomObligationStorage.layout();
        BoardroomObligationStorage.Record storage rewardsRecord = obligations.obligationOf[obligations.rewardPool];
        if (rewardsRecord.active && rewardsRecord.policy == msg.sender) {
            _delegateGovernance(
                abi.encodeCall(
                    BoardroomGovernanceLogic.addObligationDependency, (shareTokenStorage, obligations.rewardPool, asset)
                )
            );
        }
    }

    function registerRedeemableAsset(bytes32, address asset) external {
        _requireGovernanceCaller();
        BoardroomFacetTypes.BoardroomStatus current = _status();
        if (
            current != BoardroomFacetTypes.BoardroomStatus.Active
                && current != BoardroomFacetTypes.BoardroomStatus.WindingDown
        ) {
            revert InvalidStatus(BoardroomFacetTypes.BoardroomStatus.WindingDown, current);
        }
        if (current == BoardroomFacetTypes.BoardroomStatus.WindingDown) {
            (bool readable, uint256 balance) = BestEffortTokenLib.tryBalanceOf(asset, address(this));
            if (!readable || balance == 0) revert EmptyRedeemableAsset(asset);
        }
        if (BoardroomAssetStorage.layout().isRegistered[asset]) {
            revert RedeemableAssetAlreadyRegistered(asset);
        }
        _registerAsset(asset);
    }

    function contributeTreasuryAsset(bytes32, address asset, uint256 amount, uint256 deadline) external nonReentrant {
        _delegateGovernance(abi.encodeCall(BoardroomGovernanceLogic.contributeTreasuryAsset, (asset, amount, deadline)));
    }

    function removeRedeemableAsset(bytes32, address asset) external {
        _requireGovernanceCaller();
        _requireStatus(BoardroomFacetTypes.BoardroomStatus.Active);
        if (asset == wrappedNativeStorage) revert InvalidRedeemableAsset(asset);
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

    function pruneObligation(bytes32, address obligation) external nonReentrant returns (bool pruned) {
        pruned = abi.decode(
            _delegateGovernance(
                abi.encodeCall(BoardroomGovernanceLogic.pruneObligation, (shareTokenStorage, obligation))
            ),
            (bool)
        );
    }

    function pruneObligations(bytes32, address[] calldata obligations) external nonReentrant returns (uint256 pruned) {
        pruned = abi.decode(
            _delegateGovernance(
                abi.encodeCall(BoardroomGovernanceLogic.pruneObligations, (shareTokenStorage, obligations))
            ),
            (uint256)
        );
    }

    function _containsControllerReplacement(BoardroomCall[] calldata calls) internal view returns (bool) {
        uint256 length = calls.length;
        for (uint256 i; i < length; ++i) {
            if (calls[i].target == address(this) && _selector(calls[i].data) == REPLACE_CONTROLLER_SELECTOR) {
                return true;
            }
        }
        return false;
    }
}
