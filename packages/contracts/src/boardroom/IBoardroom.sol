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

    enum ObligationKind {
        None,
        Grant,
        Liquidity
    }

    enum SnapshotStatus {
        Unprocessed,
        Included,
        Unreadable,
        Excluded
    }

    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    function MAX_BATCH_CALLS() external view returns (uint256);

    function MAX_OBLIGATION_ASSETS() external view returns (uint256);

    function MAX_SNAPSHOT_PAGE() external view returns (uint256);

    function MIN_WIND_DOWN_DELAY() external view returns (uint256);

    function factory() external view returns (address);

    function owner() external view returns (address);

    function shareToken() external view returns (address);

    function wrappedNative() external view returns (address);

    function redemptionExcessRecipient() external view returns (address);

    function status() external view returns (Status);

    function launched() external view returns (bool);

    function windDownDelay() external view returns (uint256);

    function windDownStartedAt() external view returns (uint256);

    function initialize(address owner, string calldata name, string calldata symbol) external;

    function launch() external;

    function mint(address to, uint256 amount) external;

    function setRedemptionExcessRecipient(address recipient) external;

    function startWindDown() external;

    function execute(Call calldata call_) external payable returns (bytes memory result);

    function executeBatch(Call[] calldata calls) external payable returns (bytes[] memory results);

    function executeObligation(address obligation, bytes calldata data) external returns (bytes memory result);

    function wrapNativeBalance() external;

    function reserveRedeemableAsset(address asset) external;

    function registerRedeemableAsset(address asset) external;

    function contributeTreasuryAsset(address asset, uint256 amount, uint256 deadline) external;

    function removeRedeemableAsset(address asset) external;

    function registerObligation(address obligation, ObligationKind kind, address[] calldata assets) external;

    function pruneObligation(address obligation) external returns (bool pruned);

    function pruneObligations(address[] calldata obligations) external returns (uint256 pruned);

    function obligationOf(address obligation)
        external
        view
        returns (address registrar, ObligationKind kind, bool active, bool everRegistered);

    function isIssuedGrant(address obligation) external view returns (bool);

    function isLockedLiquidity(address obligation) external view returns (bool);

    function activeObligationCount() external view returns (uint256);

    function activeObligationCountByKind(ObligationKind kind) external view returns (uint256);

    function assetDependencyCount(address asset) external view returns (uint256);

    function obligationDependencyCount(address obligation) external view returns (uint256);

    function obligationDependencyAt(address obligation, uint256 index) external view returns (address);

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

    function redeemableAssetPage(uint256 cursor, uint256 size)
        external
        view
        returns (address[] memory page, uint256 nextCursor);

    function isRedeemableAsset(address asset) external view returns (bool);

    function redeemableAssetSnapshotStatus(address asset) external view returns (SnapshotStatus);

    function assetSnapshotProgress() external view returns (uint256 frozenCount, uint256 cursor, bool frozen);

    function redemptionSupplyState() external view returns (uint256 supply, bool frozen);

    function lockedLiquidityExitAllowed() external view returns (bool);

    function liquidityMutationAllowed() external view returns (bool);
}
