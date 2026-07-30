// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {BoardroomRedemptionPayout} from "../BoardroomRedemptionPayout.sol";
import {BoardroomRedemptionStorage} from "../BoardroomRedemptionStorage.sol";
import {BoardroomAssetStorage} from "../storage/BoardroomAssetStorage.sol";
import {BoardroomFacetBase} from "./BoardroomFacetBase.sol";
import {BoardroomFacetTypes} from "./BoardroomFacetTypes.sol";

/// @notice Native snapshot, redemption-accounting, payout, and treasury-share behavior.
contract BoardroomRedemptionFacet is BoardroomFacetBase {
    constructor(
        address redemptionPayoutLogic_,
        address governanceLogic_,
        address controllerFactory_,
        address marketLogic_
    ) BoardroomFacetBase(redemptionPayoutLogic_, governanceLogic_, controllerFactory_, marketLogic_) {}

    function beginSnapshot(bytes32) external nonReentrant {
        _delegateRedemption(
            abi.encodeCall(BoardroomRedemptionPayout.beginSnapshot, (shareTokenStorage, wrappedNativeStorage))
        );
    }

    function snapshotAssets(bytes32, uint256 maximum) external nonReentrant returns (uint256 processed) {
        processed = abi.decode(
            _delegateRedemption(
                abi.encodeCall(BoardroomRedemptionPayout.processSnapshotAssets, (maximum, MAX_SNAPSHOT_PAGE_VALUE))
            ),
            (uint256)
        );
    }

    function openRedemptions(bytes32) external {
        _delegateRedemption(abi.encodeCall(BoardroomRedemptionPayout.openRedemptions, ()));
    }

    function redeem(bytes32, uint256 shares) external nonReentrant {
        _delegateRedemption(abi.encodeCall(BoardroomRedemptionPayout.redeem, (shareTokenStorage, msg.sender, shares)));
    }

    function claimRedemptionAsset(bytes32, address asset, address recipient, uint256 minAmountOut)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        _requireStatus(BoardroomFacetTypes.BoardroomStatus.RedemptionsOpen);
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

    function sweepRedemptionExcess(bytes32, address asset) external nonReentrant returns (uint256 amount) {
        _requireStatus(BoardroomFacetTypes.BoardroomStatus.RedemptionsOpen);
        if (asset == address(0) || asset == shareTokenStorage || asset == address(this)) {
            revert InvalidRedeemableAsset(asset);
        }
        _wrapNativeBalance();
        amount = abi.decode(
            _delegateRedemption(
                abi.encodeCall(BoardroomRedemptionPayout.sweepExcess, (asset, redemptionExcessRecipientStorage))
            ),
            (uint256)
        );
    }

    function burnTreasuryShares(bytes32) external returns (uint256 burned) {
        BoardroomFacetTypes.BoardroomStatus current = _status();
        if (current == BoardroomFacetTypes.BoardroomStatus.Active) {
            revert InvalidStatus(BoardroomFacetTypes.BoardroomStatus.WindingDown, current);
        }
        burned = _burnTreasuryShares(BoardroomRedemptionStorage.layout().supplyFrozen);
    }
}
