// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Stable interface for a non-upgradeable pledge.cash Boardroom custodian.
interface IBoardroom {
    enum Status {
        Active,
        WindingDown,
        Snapshotting,
        RedemptionsOpen
    }

    enum EscrowState {
        None,
        Open,
        Closed
    }

    enum SnapshotStatus {
        Unprocessed,
        Included,
        Unreadable
    }

    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    function MAX_BATCH_CALLS() external view returns (uint256);

    function MAX_SNAPSHOT_PAGE() external view returns (uint256);

    function MIN_WIND_DOWN_DELAY() external view returns (uint256);

    function factory() external view returns (address);

    function owner() external view returns (address);

    function shareToken() external view returns (address);

    function wrappedNative() external view returns (address);

    function redemptionExcessRecipient() external view returns (address);

    function status() external view returns (Status);

    function windDownDelay() external view returns (uint256);

    function windDownStartedAt() external view returns (uint256);

    function initialize(address owner, string calldata name, string calldata symbol) external;

    function mint(address to, uint256 amount) external;

    function setRedemptionExcessRecipient(address recipient) external;

    function startWindDown() external;

    function execute(Call calldata call_) external payable returns (bytes memory result);

    function executeBatch(Call[] calldata calls) external payable returns (bytes[] memory results);

    function executeEscrow(address escrow, bytes calldata data) external returns (bytes memory result);

    function wrapNativeBalance() external;

    function reserveRedeemableAsset(address asset) external;

    function registerRedeemableAsset(address asset) external;

    function contributeTreasuryAsset(address asset, uint256 amount, uint256 deadline) external;

    function registerEscrow(address escrow) external;

    function pruneEscrow(address escrow) external returns (bool pruned);

    function escrowState(address escrow) external view returns (EscrowState);

    function openEscrowCount() external view returns (uint256);

    function beginSnapshot() external;

    function snapshotAssets(uint256 maximum) external returns (uint256 processed);

    function openRedemptions() external;

    function redeem(uint256 shares) external;

    function claimRedemptionAsset(address asset, address recipient, uint256 minAmountOut)
        external
        returns (uint256 amountOut);

    function sweepRedemptionExcess(address asset) external returns (uint256 amount);

    function burnTreasuryShares() external returns (uint256 burned);

    function redemptionCredits(address holder) external view returns (uint256);

    function allocatedRedemptionShares(address holder, address asset) external view returns (uint256);

    function redemptionAssetState(address asset) external view returns (uint256 snapshotBalance, uint256 paid);

    function redeemableAssetCount() external view returns (uint256);

    function redeemableAssetAt(uint256 index) external view returns (address);

    function isRedeemableAsset(address asset) external view returns (bool);

    function redeemableAssetSnapshotStatus(address asset) external view returns (SnapshotStatus);

    function assetSnapshotProgress() external view returns (uint256 frozenCount, uint256 cursor, bool frozen);

    function redemptionSupplyState() external view returns (uint256 supply, bool frozen);

    function lockedLiquidityExitAllowed() external view returns (bool);

    function liquidityMutationAllowed() external view returns (bool);
}
