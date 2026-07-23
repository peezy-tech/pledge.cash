// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {ExactTransferLib} from "../lib/ExactTransferLib.sol";
import {BoardroomRedemptionStorage} from "./BoardroomRedemptionStorage.sol";
import {BoardroomToken} from "./BoardroomToken.sol";
import {BoardroomAssetStorage} from "./storage/BoardroomAssetStorage.sol";
import {BoardroomCoreStorage} from "./storage/BoardroomCoreStorage.sol";
import {BoardroomLiquidityStorage} from "./storage/BoardroomLiquidityStorage.sol";
import {BoardroomObligationStorage} from "./storage/BoardroomObligationStorage.sol";

interface IBoardroomRedemptionShares {
    function balanceOf(address account) external view returns (uint256);

    function burn(address from, uint256 amount) external;
}

interface IBoardroomRedemptionWrappedNative {
    function deposit() external payable;
}

/// @notice Delegate-call payout arithmetic kept outside Boardroom's EIP-170-constrained runtime.
contract BoardroomRedemptionPayout {
    uint256 internal constant ASSET_PROBE_GAS = 30_000;

    error InvalidRedemptionInput();
    error InsufficientRedemptionAmount(address asset, uint256 amountOut, uint256 minAmountOut);
    error UnexpectedRedeemableAssetBalanceChange(address asset, uint256 expected, uint256 actual);
    error UnexpectedWrappedNativeBalanceChange(uint256 expected, uint256 actual);
    error NoRedemptionExcess(address asset);
    error InvalidRedeemableAsset(address asset);
    error InvalidLifecycleStatus(uint8 expected, uint8 actual);
    error SnapshotNotReady();
    error SnapshotAlreadyFrozen();
    error SnapshotIncomplete(uint256 cursor, uint256 count);
    error InvalidSnapshotPage(uint256 requested, uint256 maximum);

    event RedemptionAssetClaimed(
        address indexed holder, address indexed recipient, address indexed asset, uint256 shares, uint256 amount
    );
    event NativeWrappedForWindDown(address indexed wrappedNative, uint256 amount);
    event TreasurySharesBurned(uint256 amount);
    event RedemptionExcessSwept(address indexed asset, address indexed recipient, uint256 amount);
    event BoardroomSnapshottingStarted(uint256 assetCount, uint256 redemptionSupply);
    event BoardroomSnapshotPageProcessed(uint256 indexed fromIndex, uint256 indexed toIndex);
    event BoardroomRedemptionsOpened(address indexed caller);
    event RedeemableAssetSnapshot(address indexed asset, uint256 balance);
    event RedeemableAssetUnreadable(address indexed asset);

    function beginSnapshot(address shareToken, address wrappedNative) external {
        BoardroomCoreStorage.Layout storage core = BoardroomCoreStorage.layout();
        if (core.status != BoardroomCoreStorage.Status.WindingDown) {
            revert InvalidLifecycleStatus(uint8(BoardroomCoreStorage.Status.WindingDown), uint8(core.status));
        }
        if (block.timestamp < uint256(core.windDownStartedAt) + core.windDownDelay) revert SnapshotNotReady();
        if (BoardroomObligationStorage.layout().activeCount != 0) revert SnapshotNotReady();

        BoardroomLiquidityStorage.Layout storage liquidity = BoardroomLiquidityStorage.layout();
        if (
            liquidity.status == BoardroomLiquidityStorage.Status.Active
                || liquidity.pendingMigration.curve != address(0)
        ) revert SnapshotNotReady();

        _wrapNative(wrappedNative);
        _burnTreasuryShares(shareToken, false);
        BoardroomRedemptionStorage.Layout storage redemption = BoardroomRedemptionStorage.layout();
        redemption.supply = BoardroomToken(shareToken).totalSupply();
        redemption.supplyFrozen = true;

        BoardroomAssetStorage.Layout storage assets = BoardroomAssetStorage.layout();
        if (assets.frozen) revert SnapshotAlreadyFrozen();
        assets.frozen = true;
        assets.frozenCount = assets.registry.length;
        core.status = BoardroomCoreStorage.Status.Snapshotting;
        emit BoardroomSnapshottingStarted(assets.frozenCount, redemption.supply);
    }

    function processSnapshotAssets(uint256 maximum, uint256 maximumPage) external returns (uint256 processed) {
        BoardroomCoreStorage.Layout storage core = BoardroomCoreStorage.layout();
        if (core.status != BoardroomCoreStorage.Status.Snapshotting) {
            revert InvalidLifecycleStatus(uint8(BoardroomCoreStorage.Status.Snapshotting), uint8(core.status));
        }
        if (maximum == 0 || maximum > maximumPage) revert InvalidSnapshotPage(maximum, maximumPage);
        BoardroomAssetStorage.Layout storage assets = BoardroomAssetStorage.layout();
        uint256 cursor = assets.snapshotCursor;
        uint256 end = cursor + maximum;
        if (end > assets.frozenCount) end = assets.frozenCount;

        BoardroomRedemptionStorage.Layout storage redemption = BoardroomRedemptionStorage.layout();
        for (uint256 i = cursor; i < end; ++i) {
            address asset = assets.registry[i];
            if (!assets.isRegistered[asset]) {
                assets.snapshotStatus[asset] = BoardroomAssetStorage.SnapshotStatus.Excluded;
                continue;
            }
            (bool readable, uint256 balance) = _tryBoundedBalanceOf(asset, address(this));
            if (readable) {
                redemption.snapshotBalance[asset] = balance;
                assets.snapshotStatus[asset] = BoardroomAssetStorage.SnapshotStatus.Included;
                emit RedeemableAssetSnapshot(asset, balance);
            } else {
                assets.snapshotStatus[asset] = BoardroomAssetStorage.SnapshotStatus.Unreadable;
                emit RedeemableAssetUnreadable(asset);
            }
        }
        assets.snapshotCursor = end;
        processed = end - cursor;
        emit BoardroomSnapshotPageProcessed(cursor, end);
    }

    function openRedemptions() external {
        BoardroomCoreStorage.Layout storage core = BoardroomCoreStorage.layout();
        if (core.status != BoardroomCoreStorage.Status.Snapshotting) {
            revert InvalidLifecycleStatus(uint8(BoardroomCoreStorage.Status.Snapshotting), uint8(core.status));
        }
        BoardroomAssetStorage.Layout storage assets = BoardroomAssetStorage.layout();
        if (assets.snapshotCursor != assets.frozenCount) {
            revert SnapshotIncomplete(assets.snapshotCursor, assets.frozenCount);
        }
        core.status = BoardroomCoreStorage.Status.RedemptionsOpen;
        emit BoardroomRedemptionsOpened(msg.sender);
    }

    function redeem(address shareToken, address holder, uint256 shares) external {
        BoardroomCoreStorage.Layout storage core = BoardroomCoreStorage.layout();
        if (core.status != BoardroomCoreStorage.Status.RedemptionsOpen) {
            revert InvalidLifecycleStatus(uint8(BoardroomCoreStorage.Status.RedemptionsOpen), uint8(core.status));
        }
        if (shares == 0 || shares > BoardroomToken(shareToken).balanceOf(holder)) {
            revert InvalidRedemptionInput();
        }
        BoardroomToken(shareToken).burn(holder, shares);
        BoardroomRedemptionStorage.layout().credits[holder] += shares;
    }

    function wrapNative(address wrappedNative) external payable {
        _wrapNative(wrappedNative);
    }

    function _wrapNative(address wrappedNative) internal {
        uint256 nativeBalance = address(this).balance;
        if (nativeBalance == 0) return;

        uint256 balanceBefore = SafeTransferLib.balanceOf(wrappedNative, address(this));
        IBoardroomRedemptionWrappedNative(wrappedNative).deposit{value: nativeBalance}();
        uint256 balanceAfter = SafeTransferLib.balanceOf(wrappedNative, address(this));
        uint256 expectedBalance = balanceBefore + nativeBalance;
        if (balanceAfter != expectedBalance) {
            revert UnexpectedWrappedNativeBalanceChange(expectedBalance, balanceAfter);
        }
        emit NativeWrappedForWindDown(wrappedNative, nativeBalance);
    }

    function burnTreasuryShares(address shareToken, bool forfeit) external returns (uint256 burned) {
        burned = _burnTreasuryShares(shareToken, forfeit);
    }

    function _burnTreasuryShares(address shareToken, bool forfeit) internal returns (uint256 burned) {
        IBoardroomRedemptionShares shares = IBoardroomRedemptionShares(shareToken);
        burned = shares.balanceOf(address(this));
        if (burned != 0) {
            shares.burn(address(this), burned);
            if (forfeit) BoardroomRedemptionStorage.layout().forfeitedShares += burned;
        }
        emit TreasurySharesBurned(burned);
    }

    function sweepExcess(address asset, address recipient) external returns (uint256 amount) {
        BoardroomRedemptionStorage.Layout storage redemption = BoardroomRedemptionStorage.layout();
        uint256 allocatedAndForfeited = redemption.allocatedShares[asset] + redemption.forfeitedShares;
        uint256 reserved =
            allocatedAndForfeited == redemption.supply ? 0 : redemption.snapshotBalance[asset] - redemption.paid[asset];
        uint256 balance = _boundedBalanceOf(asset, address(this));
        if (balance <= reserved) revert NoRedemptionExcess(asset);

        amount = balance - reserved;
        _checkedTransfer(asset, recipient, amount);
        emit RedemptionExcessSwept(asset, recipient, amount);
    }

    function payout(address holder, address asset, address recipient, uint256 minAmountOut)
        external
        returns (uint256 amountOut)
    {
        BoardroomRedemptionStorage.Layout storage redemption = BoardroomRedemptionStorage.layout();
        uint256 allocated = redemption.holderAllocatedShares[holder][asset];
        uint256 shares = redemption.credits[holder] - allocated;
        if (shares == 0) revert InvalidRedemptionInput();

        uint256 totalAllocated = redemption.allocatedShares[asset];
        uint256 remainingShares = redemption.supply - redemption.forfeitedShares - totalAllocated;
        if (shares > remainingShares) revert InvalidRedemptionInput();

        uint256 remainingBalance = redemption.snapshotBalance[asset] - redemption.paid[asset];
        amountOut = FixedPointMathLib.fullMulDiv(remainingBalance, shares, remainingShares);
        if (amountOut < minAmountOut) {
            revert InsufficientRedemptionAmount(asset, amountOut, minAmountOut);
        }

        redemption.holderAllocatedShares[holder][asset] = allocated + shares;
        redemption.allocatedShares[asset] = totalAllocated + shares;
        redemption.paid[asset] += amountOut;
        if (amountOut != 0) _checkedTransfer(asset, recipient, amountOut);
        emit RedemptionAssetClaimed(holder, recipient, asset, shares, amountOut);
    }

    function _checkedTransfer(address asset, address recipient, uint256 expectedAmount) private {
        ExactTransferLib.ExactDelta memory delta = ExactTransferLib.sendFromSelfTo(asset, recipient, expectedAmount);
        if (delta.senderBalanceIncreased || delta.recipientBalanceDecreased) {
            revert UnexpectedRedeemableAssetBalanceChange(asset, expectedAmount, 0);
        }
        if (delta.senderSpent != expectedAmount) {
            revert UnexpectedRedeemableAssetBalanceChange(asset, expectedAmount, delta.senderSpent);
        }
        if (delta.recipientReceived != expectedAmount) {
            revert UnexpectedRedeemableAssetBalanceChange(asset, expectedAmount, delta.recipientReceived);
        }
    }

    function _boundedBalanceOf(address asset, address account) private view returns (uint256 amount) {
        (bool success, uint256 balance) = _tryBoundedBalanceOf(asset, account);
        if (!success) revert InvalidRedeemableAsset(asset);
        return balance;
    }

    function _tryBoundedBalanceOf(address asset, address account) private view returns (bool success, uint256 amount) {
        assembly ("memory-safe") {
            let pointer := mload(0x40)
            mstore(pointer, shl(224, 0x70a08231))
            mstore(add(pointer, 4), account)
            success := staticcall(ASSET_PROBE_GAS, asset, pointer, 36, pointer, 32)
            success := and(success, eq(returndatasize(), 32))
            amount := mload(pointer)
        }
    }
}
