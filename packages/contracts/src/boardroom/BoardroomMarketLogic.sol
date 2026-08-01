// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {BoardroomController} from "./BoardroomController.sol";
import {BoardroomControllerFactory} from "./BoardroomControllerFactory.sol";
import {BoardroomToken} from "./BoardroomToken.sol";
import {IBoardroomPolicyRegistry} from "./IBoardroomPolicyRegistry.sol";
import {BoardroomAssetStorage} from "./storage/BoardroomAssetStorage.sol";
import {BoardroomCoreStorage} from "./storage/BoardroomCoreStorage.sol";
import {BoardroomLiquidityStorage} from "./storage/BoardroomLiquidityStorage.sol";
import {BoardroomObligationStorage} from "./storage/BoardroomObligationStorage.sol";
import {BoardroomPrimaryMarketStorage} from "./storage/BoardroomPrimaryMarketStorage.sol";
import {BestEffortTokenLib} from "../lib/BestEffortTokenLib.sol";

interface IBoardroomMarketCanonicalLiquidity {
    function factory() external view returns (address);

    function boardroom() external view returns (address);

    function tokenA() external view returns (address);

    function tokenB() external view returns (address);

    function poolId() external view returns (bytes32);

    function isClosed() external view returns (bool);
}

interface IBoardroomMarketCanonicalCurve {
    function liquidityFactory() external view returns (address);
}

contract BoardroomMarketLogic {
    error InvalidController(address controller);
    error InvalidExecutionContext();
    error InvalidLiquidityTransition();
    error InvalidPrimaryMarketTransition();
    error InvalidRedeemableAsset(address asset);
    error PrimaryMarketTransferRestricted(address from, address to, uint256 amount);
    error SnapshotAlreadyFrozen();

    event BondingCurvePrecommitted(address indexed curve, address indexed quoteAsset, uint256 fundingAmount);
    event PrimaryMarketModeChanged(BoardroomPrimaryMarketStorage.Mode indexed mode);
    event ProtocolLiquidityActivated(
        address indexed vault, bytes32 indexed poolId, address indexed quoteAsset, address curve
    );
    event ProtocolLiquidityClosed(address indexed vault, bytes32 indexed poolId, address indexed quoteAsset);
    event ProtocolLiquidityReservationReleased(address indexed curve, address indexed expectedVault, bytes32 salt);
    event ProtocolLiquidityReserved(
        address indexed expectedVault,
        bytes32 indexed expectedPoolId,
        address indexed quoteAsset,
        address curve,
        bytes32 salt,
        uint256 expiresAt
    );
    event RedeemableAssetRegistered(address indexed asset);

    function authorizeControllerDeployment(
        address expectedController,
        address proposer,
        uint64 delay,
        uint64 gracePeriod,
        uint64 generation
    ) external {
        BoardroomCoreStorage.layout().controllerDeploymentAuthorization =
            keccak256(abi.encode(expectedController, proposer, delay, gracePeriod, generation));
    }

    function clearControllerDeploymentAuthorization() external {
        BoardroomCoreStorage.layout().controllerDeploymentAuthorization = bytes32(0);
    }

    function verifyController(
        address controllerFactory,
        address candidate,
        address proposer,
        uint64 delay,
        uint64 gracePeriod,
        uint64 generation
    ) external view {
        BoardroomController created = BoardroomController(candidate);
        if (
            candidate.code.length == 0 || created.factory() != controllerFactory || created.boardroom() != address(this)
                || created.proposer() != proposer || created.delay() != delay || created.gracePeriod() != gracePeriod
                || created.generation() != generation || created.configurationEpoch() != 1
                || !BoardroomControllerFactory(controllerFactory).isController(candidate)
                || BoardroomControllerFactory(controllerFactory).boardroomOfController(candidate) != address(this)
                || BoardroomControllerFactory(controllerFactory).generationOfController(candidate) != generation
        ) revert InvalidController(candidate);
        (bool success, bytes memory result) =
            candidate.staticcall(abi.encodeCall(BoardroomController.isValidSignature, (bytes32(0), bytes(""))));
        if (!success || result.length != 32) revert InvalidController(candidate);
    }

    function precommitBondingCurve(address shareToken, address curve, address quoteAsset, uint256 fundingAmount)
        external
    {
        BoardroomCoreStorage.Layout storage core = BoardroomCoreStorage.layout();
        if (
            !core.executionActive || msg.sender != core.executionTarget || msg.sender != core.executionPolicy
                || core.launched || curve == address(0) || curve.code.length != 0 || fundingAmount == 0
        ) revert InvalidExecutionContext();
        BoardroomPrimaryMarketStorage.Layout storage market = BoardroomPrimaryMarketStorage.layout();
        if (
            market.mode != BoardroomPrimaryMarketStorage.Mode.Unset || market.curveEverConfigured
                || BoardroomLiquidityStorage.layout().status != BoardroomLiquidityStorage.Status.Unconfigured
        ) revert InvalidPrimaryMarketTransition();
        _registerAsset(shareToken, quoteAsset);

        market.mode = BoardroomPrimaryMarketStorage.Mode.BondingCurve;
        market.curveEverConfigured = true;
        market.curve = curve;
        market.quoteAsset = quoteAsset;
        market.authorizedBoardroomFunding = fundingAmount;
        emit PrimaryMarketModeChanged(market.mode);
        emit BondingCurvePrecommitted(curve, quoteAsset, fundingAmount);
    }

    function validatePrimaryMarketTransfer(address shareToken, address from, address to, uint256 amount) external {
        if (msg.sender != shareToken) revert InvalidExecutionContext();
        BoardroomPrimaryMarketStorage.Layout storage market = BoardroomPrimaryMarketStorage.layout();
        if (market.mode == BoardroomPrimaryMarketStorage.Mode.GeneralAvailability) return;

        if (market.mode == BoardroomPrimaryMarketStorage.Mode.Unset) {
            bool released = (from == address(this) && to != address(0) && to != address(this))
                || (from == address(0) && to != address(this));
            if (released) {
                market.mode = BoardroomPrimaryMarketStorage.Mode.GeneralAvailability;
                emit PrimaryMarketModeChanged(market.mode);
            }
            return;
        }

        if (from == address(0) || from == address(this)) {
            if (to != market.curve && to != market.migrationCustody) {
                revert PrimaryMarketTransferRestricted(from, to, amount);
            }
            uint256 authorized = market.authorizedBoardroomFunding;
            if (amount > authorized) revert PrimaryMarketTransferRestricted(from, to, amount);
            market.authorizedBoardroomFunding = authorized - amount;
            return;
        }
        if (to == address(0)) revert PrimaryMarketTransferRestricted(from, to, amount);
    }

    function precommitProtocolLiquidity(
        address policyRegistry,
        address shareToken,
        address expectedVault,
        bytes32 expectedPoolId,
        address quoteAsset,
        address curve,
        bytes32 salt,
        uint64 expiresAt
    ) external {
        BoardroomCoreStorage.Layout storage core = BoardroomCoreStorage.layout();
        if (
            core.status != BoardroomCoreStorage.Status.Active || !core.executionActive
                || !IBoardroomPolicyRegistry(policyRegistry).isModulePolicy(msg.sender) || expectedVault == address(0)
                || expectedVault.code.length != 0 || expectedPoolId == bytes32(0)
        ) revert InvalidExecutionContext();

        BoardroomPrimaryMarketStorage.Layout storage market = BoardroomPrimaryMarketStorage.layout();
        if (curve == address(0)) {
            if (core.executionTarget != msg.sender || core.executionPolicy != msg.sender) {
                revert InvalidExecutionContext();
            }
            if (market.mode == BoardroomPrimaryMarketStorage.Mode.BondingCurve) {
                revert InvalidPrimaryMarketTransition();
            }
        } else {
            if (
                market.mode != BoardroomPrimaryMarketStorage.Mode.BondingCurve || market.curve != curve
                    || core.executionTarget != core.executionPolicy
            ) revert InvalidExecutionContext();
        }
        _registerAsset(shareToken, quoteAsset);
        if (market.quoteAsset != address(0) && market.quoteAsset != quoteAsset) {
            revert InvalidPrimaryMarketTransition();
        }

        BoardroomLiquidityStorage.Layout storage liquidity = BoardroomLiquidityStorage.layout();
        if (
            liquidity.status != BoardroomLiquidityStorage.Status.Unconfigured || liquidity.vault != address(0)
                || liquidity.poolId != bytes32(0) || liquidity.pendingMigration.expectedVault != address(0)
        ) revert InvalidLiquidityTransition();
        if (liquidity.quoteAsset != address(0) && liquidity.quoteAsset != quoteAsset) {
            revert InvalidLiquidityTransition();
        }

        market.quoteAsset = quoteAsset;
        liquidity.quoteAsset = quoteAsset;
        liquidity.pendingMigration = BoardroomLiquidityStorage.MigrationReservation({
            curve: curve, expectedVault: expectedVault, expectedPoolId: expectedPoolId, salt: salt, expiresAt: expiresAt
        });
        emit ProtocolLiquidityReserved(expectedVault, expectedPoolId, quoteAsset, curve, salt, expiresAt);
    }

    function activateProtocolLiquidity(
        address policyRegistry,
        address vault,
        bytes32 poolId,
        address quoteAsset,
        address curve,
        bytes32 salt
    ) external {
        BoardroomCoreStorage.Layout storage core = BoardroomCoreStorage.layout();
        if (
            core.status != BoardroomCoreStorage.Status.Active
                || !IBoardroomPolicyRegistry(policyRegistry).isModulePolicy(msg.sender) || vault == address(0)
                || poolId == bytes32(0)
        ) revert InvalidExecutionContext();
        BoardroomLiquidityStorage.Layout storage liquidity = BoardroomLiquidityStorage.layout();
        BoardroomLiquidityStorage.MigrationReservation memory reservation = liquidity.pendingMigration;
        if (
            liquidity.status != BoardroomLiquidityStorage.Status.Unconfigured || reservation.expectedVault != vault
                || reservation.expectedPoolId != poolId || reservation.curve != curve || reservation.salt != salt
                || liquidity.quoteAsset != quoteAsset
        ) revert InvalidLiquidityTransition();

        IBoardroomMarketCanonicalLiquidity canonical = IBoardroomMarketCanonicalLiquidity(vault);
        if (
            canonical.factory() != msg.sender || canonical.boardroom() != address(this) || canonical.poolId() != poolId
                || (canonical.tokenA() != quoteAsset && canonical.tokenB() != quoteAsset)
        ) revert InvalidLiquidityTransition();
        if (curve == address(0)) {
            if (!core.executionActive || core.executionTarget != msg.sender || core.executionPolicy != msg.sender) {
                revert InvalidExecutionContext();
            }
        } else if (reservation.curve != curve) {
            revert InvalidLiquidityTransition();
        }

        BoardroomPrimaryMarketStorage.Layout storage market = BoardroomPrimaryMarketStorage.layout();
        if (curve != address(0)) {
            if (
                market.mode != BoardroomPrimaryMarketStorage.Mode.BondingCurve || market.curve != curve
                    || market.authorizedBoardroomFunding != 0
            ) revert InvalidPrimaryMarketTransition();
            market.mode = BoardroomPrimaryMarketStorage.Mode.GeneralAvailability;
            emit PrimaryMarketModeChanged(market.mode);
        } else if (market.mode != BoardroomPrimaryMarketStorage.Mode.GeneralAvailability) {
            revert InvalidPrimaryMarketTransition();
        }

        liquidity.status = BoardroomLiquidityStorage.Status.Active;
        liquidity.vault = vault;
        liquidity.poolId = poolId;
        delete liquidity.pendingMigration;
        emit ProtocolLiquidityActivated(vault, poolId, quoteAsset, curve);
    }

    function releaseProtocolLiquidityReservation(
        address policyRegistry,
        address curve,
        bytes32 expectedPoolId,
        bytes32 salt
    ) external {
        BoardroomCoreStorage.Layout storage core = BoardroomCoreStorage.layout();
        if (
            uint8(core.status) > uint8(BoardroomCoreStorage.Status.WindingDown)
                || !IBoardroomPolicyRegistry(policyRegistry).isModulePolicy(msg.sender)
        ) revert InvalidExecutionContext();
        BoardroomLiquidityStorage.Layout storage liquidity = BoardroomLiquidityStorage.layout();
        BoardroomPrimaryMarketStorage.Layout storage market = BoardroomPrimaryMarketStorage.layout();
        BoardroomLiquidityStorage.MigrationReservation memory reservation = liquidity.pendingMigration;
        if (
            liquidity.status != BoardroomLiquidityStorage.Status.Unconfigured || reservation.curve != curve
                || reservation.expectedPoolId != expectedPoolId || reservation.salt != salt || market.curve != curve
                || !BoardroomObligationStorage.layout().obligationOf[curve].active
                || IBoardroomMarketCanonicalCurve(curve).liquidityFactory() != msg.sender
        ) revert InvalidLiquidityTransition();
        delete liquidity.pendingMigration;
        emit ProtocolLiquidityReservationReleased(curve, reservation.expectedVault, salt);
    }

    function settleBondingCurve() external {
        BoardroomPrimaryMarketStorage.Layout storage market = BoardroomPrimaryMarketStorage.layout();
        BoardroomLiquidityStorage.Layout storage liquidity = BoardroomLiquidityStorage.layout();
        if (
            market.curve != msg.sender || market.authorizedBoardroomFunding != 0
                || liquidity.pendingMigration.expectedVault != address(0)
        ) revert InvalidExecutionContext();
        if (market.mode == BoardroomPrimaryMarketStorage.Mode.BondingCurve) {
            if (liquidity.status != BoardroomLiquidityStorage.Status.Unconfigured) revert InvalidExecutionContext();
            market.mode = BoardroomPrimaryMarketStorage.Mode.GeneralAvailability;
            emit PrimaryMarketModeChanged(market.mode);
        } else if (
            market.mode != BoardroomPrimaryMarketStorage.Mode.GeneralAvailability
                || liquidity.status != BoardroomLiquidityStorage.Status.Active
        ) {
            revert InvalidExecutionContext();
        }
        market.migrationCustody = address(0);
    }

    function closeProtocolLiquidity(address policyRegistry, address vault) external {
        BoardroomCoreStorage.Layout storage core = BoardroomCoreStorage.layout();
        if (
            !IBoardroomPolicyRegistry(policyRegistry).isModulePolicy(msg.sender)
                || core.status != BoardroomCoreStorage.Status.Active || !core.executionActive
                || core.executionTarget != msg.sender || core.executionPolicy != msg.sender
        ) revert InvalidExecutionContext();
        _closeProtocolLiquidity(vault);
    }

    function closeProtocolLiquidityForWindDown(address vault) external {
        if (BoardroomCoreStorage.layout().status != BoardroomCoreStorage.Status.WindingDown) {
            revert InvalidExecutionContext();
        }
        _closeProtocolLiquidity(vault);
    }

    function _closeProtocolLiquidity(address vault) internal {
        BoardroomLiquidityStorage.Layout storage liquidity = BoardroomLiquidityStorage.layout();
        if (
            liquidity.status != BoardroomLiquidityStorage.Status.Active || liquidity.vault != vault
                || liquidity.pendingMigration.expectedVault != address(0)
                || !IBoardroomMarketCanonicalLiquidity(vault).isClosed()
        ) revert InvalidLiquidityTransition();
        liquidity.status = BoardroomLiquidityStorage.Status.Closed;
        emit ProtocolLiquidityClosed(vault, liquidity.poolId, liquidity.quoteAsset);
    }

    function _registerAsset(address shareToken, address asset) internal {
        if (asset == address(0) || asset == shareToken || asset == address(this) || asset.code.length == 0) {
            revert InvalidRedeemableAsset(asset);
        }
        (bool readable,) = BestEffortTokenLib.tryBalanceOf(asset, address(this));
        if (!readable) revert InvalidRedeemableAsset(asset);

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
}
