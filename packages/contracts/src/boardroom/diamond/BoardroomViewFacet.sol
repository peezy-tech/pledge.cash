// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {BoardroomRedemptionStorage} from "../BoardroomRedemptionStorage.sol";
import {BoardroomAssetStorage} from "../storage/BoardroomAssetStorage.sol";
import {BoardroomCoreStorage} from "../storage/BoardroomCoreStorage.sol";
import {BoardroomLiquidityStorage} from "../storage/BoardroomLiquidityStorage.sol";
import {BoardroomObligationStorage} from "../storage/BoardroomObligationStorage.sol";
import {BoardroomPrimaryMarketStorage} from "../storage/BoardroomPrimaryMarketStorage.sol";
import {BoardroomFacetBase} from "./BoardroomFacetBase.sol";
import {BoardroomFacetTypes} from "./BoardroomFacetTypes.sol";

/// @notice Native aggregate reads over Boardroom kernel storage.
contract BoardroomViewFacet is BoardroomFacetBase {
    constructor(
        address redemptionPayoutLogic_,
        address governanceLogic_,
        address controllerFactory_,
        address marketLogic_
    ) BoardroomFacetBase(redemptionPayoutLogic_, governanceLogic_, controllerFactory_, marketLogic_) {}

    function MAX_BATCH_CALLS() external pure returns (uint256) {
        return MAX_BATCH_CALLS_VALUE;
    }

    function MAX_SNAPSHOT_PAGE() external pure returns (uint256) {
        return MAX_SNAPSHOT_PAGE_VALUE;
    }

    function MIN_WIND_DOWN_DELAY() external pure returns (uint256) {
        return MIN_WIND_DOWN_DELAY_VALUE;
    }

    function MAX_WIND_DOWN_DELAY() external pure returns (uint256) {
        return MAX_WIND_DOWN_DELAY_VALUE;
    }

    function policyRegistry() external view returns (address) {
        return policyRegistryStorage;
    }

    function shareToken() external view returns (address) {
        return shareTokenStorage;
    }

    function wrappedNative() external view returns (address) {
        return wrappedNativeStorage;
    }

    function redemptionExcessRecipient() external view returns (address) {
        return redemptionExcessRecipientStorage;
    }

    function governanceLogic() external view returns (address) {
        return governanceLogicAddress;
    }

    function redemptionPayoutLogic() external view returns (address) {
        return redemptionPayoutLogicAddress;
    }

    function controllerFactory() external view returns (address) {
        return controllerFactoryAddress;
    }

    function marketLogic() external view returns (address) {
        return marketLogicAddress;
    }

    function status() external view returns (BoardroomFacetTypes.BoardroomStatus) {
        return _status();
    }

    function launched() external view returns (bool) {
        return _launched();
    }

    function controller() external view returns (address) {
        return _controller();
    }

    function controllerGeneration() external view returns (uint256) {
        return BoardroomCoreStorage.layout().controllerGeneration;
    }

    function governanceEpoch() external view returns (uint256) {
        return BoardroomCoreStorage.layout().governanceEpoch;
    }

    function windDownDelay() external view returns (uint256) {
        return BoardroomCoreStorage.layout().windDownDelay;
    }

    function windDownStartedAt() external view returns (uint256) {
        return BoardroomCoreStorage.layout().windDownStartedAt;
    }

    function protectionStaker() external view returns (address) {
        return BoardroomCoreStorage.layout().protectionStaker;
    }

    function rewardPool() external view returns (address) {
        return _rewardPool();
    }

    function requireBondingCurveForfeitureVetoPower(address account) external view {
        if (
            msg.sender != BoardroomPrimaryMarketStorage.layout().curve
                || _status() != BoardroomFacetTypes.BoardroomStatus.WindingDown
        ) {
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
        if (msg.sender != controllerFactoryAddress) return false;
        return BoardroomCoreStorage.layout().controllerDeploymentAuthorization
            == keccak256(abi.encode(expectedController, proposer, delay, gracePeriod, generation));
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
        if (size == 0 || size > MAX_SNAPSHOT_PAGE_VALUE) {
            revert InvalidSnapshotPage(size, MAX_SNAPSHOT_PAGE_VALUE);
        }
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

    function liquidityLocker() external view returns (address) {
        return _liquidityLocker();
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

    function lockedLiquidityExitAllowed() external view returns (bool) {
        return _status() == BoardroomFacetTypes.BoardroomStatus.WindingDown;
    }

    function liquidityMutationAllowed() external view returns (bool) {
        BoardroomFacetTypes.BoardroomStatus current = _status();
        return current == BoardroomFacetTypes.BoardroomStatus.Active
            || current == BoardroomFacetTypes.BoardroomStatus.WindingDown;
    }
}
