// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {ExactTransferLib} from "../lib/ExactTransferLib.sol";
import {TokenGrant} from "../grants/TokenGrant.sol";
import {LockedLiquidity} from "../liquidity/LockedLiquidity.sol";
import {BoardroomRedemptionStorage} from "./BoardroomRedemptionStorage.sol";

interface IBoardroomPrunableDistribution {
    function isClosed() external view returns (bool);
}

interface IBoardroomRedemptionShares {
    function balanceOf(address account) external view returns (uint256);
    function burn(address from, uint256 amount) external;
}

interface IBoardroomRedemptionWrappedNative {
    function deposit() external payable;
}

interface IBoardroomRedemptionCallback {
    function payoutRedemptionAsset(address holder, address asset, address recipient, uint256 minAmountOut)
        external
        returns (uint256 amountOut);
}

/// @notice Delegate-call payout logic kept outside Boardroom's EIP-170-constrained runtime.
contract BoardroomRedemptionPayout {
    uint256 internal constant PAYOUT_GAS = 200_000;
    uint256 internal constant ASSET_PROBE_GAS = 30_000;

    error InvalidRedemptionInput();
    error ZeroRedemptionAmount(address asset);
    error InsufficientRedemptionAmount(address asset, uint256 amountOut, uint256 minAmountOut);
    error UnexpectedRedeemableAssetBalanceChange(address asset, uint256 expected, uint256 actual);
    error UnexpectedWrappedNativeBalanceChange(uint256 expected, uint256 actual);
    error NoRedemptionExcess(address asset);
    error InvalidRedeemableAsset(address asset);

    struct ObligationSlots {
        uint256 issuedGrants;
        uint256 issuedDistributions;
        uint256 lockedLiquidityPositions;
        uint256 issuedGrantSlotReservations;
        uint256 isIssuedGrant;
        uint256 isIssuedDistribution;
        uint256 isLockedLiquidity;
        uint256 reservationsForDistribution;
    }

    event RedemptionAssetClaimed(
        address indexed holder, address indexed recipient, address indexed asset, uint256 shares, uint256 amount
    );
    event RedemptionAssetClaimFailed(address indexed holder, address indexed recipient, address indexed asset);
    event SharesRedeemed(
        address indexed holder, address indexed recipient, uint256 shares, address[] assets, uint256[] amounts
    );
    event NativeWrappedForWindDown(address indexed wrappedNative, uint256 amount);
    event TreasurySharesBurned(uint256 amount);
    event BoardroomGrantPruned(address indexed grant);
    event BoardroomDistributionPruned(address indexed distribution);
    event BoardroomLockedLiquidityPruned(address indexed locker);
    event BoardroomGrantSlotsReleased(address indexed distribution, uint256 count);
    event RedemptionExcessSwept(address indexed asset, address indexed recipient, uint256 amount);

    function wrapNative(address wrappedNative) external payable {
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
        IBoardroomRedemptionShares shares = IBoardroomRedemptionShares(shareToken);
        burned = shares.balanceOf(address(this));
        if (burned != 0) {
            shares.burn(address(this), burned);
            if (forfeit) BoardroomRedemptionStorage.layout().forfeitedShares += burned;
        }
        emit TreasurySharesBurned(burned);
    }

    function snapshotAssets(address[] calldata assets) external {
        BoardroomRedemptionStorage.Layout storage redemption = BoardroomRedemptionStorage.layout();
        uint256 length = assets.length;
        for (uint256 i; i < length; ++i) {
            redemption.snapshotBalance[assets[i]] = _boundedBalanceOf(assets[i], address(this));
        }
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

    function pruneClosedObligations(ObligationSlots calldata slots) external {
        uint256 i;
        while (i < _arrayLength(slots.issuedGrants)) {
            if (TokenGrant(_arrayAt(slots.issuedGrants, i)).isClosed()) {
                _removeGrantAt(slots, i);
            } else {
                ++i;
            }
        }

        i = 0;
        while (i < _arrayLength(slots.issuedDistributions)) {
            if (IBoardroomPrunableDistribution(_arrayAt(slots.issuedDistributions, i)).isClosed()) {
                _removeDistributionAt(slots, i);
            } else {
                ++i;
            }
        }

        i = 0;
        while (i < _arrayLength(slots.lockedLiquidityPositions)) {
            if (LockedLiquidity(_arrayAt(slots.lockedLiquidityPositions, i)).lockedLiquidity() == 0) {
                _removeLockerAt(slots, i);
            } else {
                ++i;
            }
        }
    }

    function pruneClosedObligation(ObligationSlots calldata slots, address target) external {
        if (_mappingBool(slots.isIssuedGrant, target) && TokenGrant(target).isClosed()) {
            (bool found, uint256 index) = _find(slots.issuedGrants, target);
            if (found) _removeGrantAt(slots, index);
            return;
        }
        if (_mappingBool(slots.isIssuedDistribution, target) && IBoardroomPrunableDistribution(target).isClosed()) {
            (bool found, uint256 index) = _find(slots.issuedDistributions, target);
            if (found) _removeDistributionAt(slots, index);
            return;
        }
        if (_mappingBool(slots.isLockedLiquidity, target) && LockedLiquidity(target).lockedLiquidity() == 0) {
            (bool found, uint256 index) = _find(slots.lockedLiquidityPositions, target);
            if (found) _removeLockerAt(slots, index);
        }
    }

    function redeem(
        address shareToken,
        address holder,
        uint256 shares,
        address recipient,
        address[] calldata assets,
        uint256[] calldata minAmountsOut
    ) external returns (uint256[] memory amountsOut) {
        uint256 assetsLength = assets.length;
        if (
            shares == 0 || recipient == address(0) || recipient == address(this) || minAmountsOut.length != assetsLength
        ) revert InvalidRedemptionInput();

        IBoardroomRedemptionShares shares_ = IBoardroomRedemptionShares(shareToken);
        if (shares > shares_.balanceOf(holder)) revert InvalidRedemptionInput();
        shares_.burn(holder, shares);
        BoardroomRedemptionStorage.layout().credits[holder] += shares;

        amountsOut = new uint256[](assetsLength);
        for (uint256 i; i < assetsLength; ++i) {
            address asset = assets[i];
            (bool success, bytes memory result) = address(this).call{gas: PAYOUT_GAS}(
                abi.encodeCall(
                    IBoardroomRedemptionCallback.payoutRedemptionAsset, (holder, asset, recipient, minAmountsOut[i])
                )
            );
            if (success) {
                amountsOut[i] = abi.decode(result, (uint256));
            } else {
                emit RedemptionAssetClaimFailed(holder, recipient, asset);
            }
        }

        emit SharesRedeemed(holder, recipient, shares, assets, amountsOut);
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
        if (amountOut == 0) revert ZeroRedemptionAmount(asset);
        if (amountOut < minAmountOut) {
            revert InsufficientRedemptionAmount(asset, amountOut, minAmountOut);
        }

        redemption.holderAllocatedShares[holder][asset] = allocated + shares;
        redemption.allocatedShares[asset] = totalAllocated + shares;
        redemption.paid[asset] += amountOut;
        _checkedTransfer(asset, recipient, amountOut);

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
        bool success;
        assembly ("memory-safe") {
            let pointer := mload(0x40)
            mstore(pointer, shl(224, 0x70a08231))
            mstore(add(pointer, 4), account)
            success := staticcall(ASSET_PROBE_GAS, asset, pointer, 36, pointer, 32)
            success := and(success, eq(returndatasize(), 32))
            amount := mload(pointer)
        }
        if (!success) revert InvalidRedeemableAsset(asset);
    }

    function _removeGrantAt(ObligationSlots calldata slots, uint256 index) private {
        address grant = _removeAt(slots.issuedGrants, index);
        _setMappingBool(slots.isIssuedGrant, grant, false);
        emit BoardroomGrantPruned(grant);
    }

    function _removeDistributionAt(ObligationSlots calldata slots, uint256 index) private {
        address distribution = _removeAt(slots.issuedDistributions, index);
        _setMappingBool(slots.isIssuedDistribution, distribution, false);

        uint256 reservationPosition = _mappingPosition(slots.reservationsForDistribution, distribution);
        uint256 reserved;
        assembly ("memory-safe") {
            reserved := sload(reservationPosition)
            sstore(reservationPosition, 0)
        }
        if (reserved != 0) {
            uint256 totalSlot = slots.issuedGrantSlotReservations;
            assembly ("memory-safe") {
                sstore(totalSlot, sub(sload(totalSlot), reserved))
            }
            emit BoardroomGrantSlotsReleased(distribution, reserved);
        }

        emit BoardroomDistributionPruned(distribution);
    }

    function _removeLockerAt(ObligationSlots calldata slots, uint256 index) private {
        address locker = _removeAt(slots.lockedLiquidityPositions, index);
        _setMappingBool(slots.isLockedLiquidity, locker, false);
        emit BoardroomLockedLiquidityPruned(locker);
    }

    function _find(uint256 arraySlot, address account) private view returns (bool found, uint256 index) {
        uint256 length = _arrayLength(arraySlot);
        for (; index < length; ++index) {
            if (_arrayAt(arraySlot, index) == account) return (true, index);
        }
    }

    function _arrayLength(uint256 arraySlot) private view returns (uint256 length) {
        assembly ("memory-safe") {
            length := sload(arraySlot)
        }
    }

    function _arrayAt(uint256 arraySlot, uint256 index) private view returns (address account) {
        assembly ("memory-safe") {
            mstore(0, arraySlot)
            account := sload(add(keccak256(0, 0x20), index))
        }
    }

    function _removeAt(uint256 arraySlot, uint256 index) private returns (address account) {
        assembly ("memory-safe") {
            let length := sload(arraySlot)
            mstore(0, arraySlot)
            let dataSlot := keccak256(0, 0x20)
            let lastIndex := sub(length, 1)
            account := sload(add(dataSlot, index))
            sstore(add(dataSlot, index), sload(add(dataSlot, lastIndex)))
            sstore(add(dataSlot, lastIndex), 0)
            sstore(arraySlot, lastIndex)
        }
    }

    function _mappingBool(uint256 mappingSlot, address account) private view returns (bool value) {
        uint256 position = _mappingPosition(mappingSlot, account);
        assembly ("memory-safe") {
            value := sload(position)
        }
    }

    function _setMappingBool(uint256 mappingSlot, address account, bool value) private {
        uint256 position = _mappingPosition(mappingSlot, account);
        assembly ("memory-safe") {
            sstore(position, value)
        }
    }

    function _mappingPosition(uint256 mappingSlot, address account) private pure returns (uint256 position) {
        assembly ("memory-safe") {
            mstore(0, account)
            mstore(0x20, mappingSlot)
            position := keccak256(0, 0x40)
        }
    }
}
