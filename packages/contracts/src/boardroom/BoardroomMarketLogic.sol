// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {BoardroomController} from "./BoardroomController.sol";
import {BoardroomControllerFactory} from "./BoardroomControllerFactory.sol";
import {BoardroomToken} from "./BoardroomToken.sol";
import {IBoardroomPolicyRegistry} from "./IBoardroomPolicyRegistry.sol";
import {BoardroomAssetStorage} from "./storage/BoardroomAssetStorage.sol";
import {BoardroomCoreStorage} from "./storage/BoardroomCoreStorage.sol";
import {BoardroomLiquidityStorage} from "./storage/BoardroomLiquidityStorage.sol";
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

contract BoardroomMarketLogic {
    error InvalidController(address controller);
    error InvalidExecutionContext();
    error InvalidLiquidityTransition();
    error InvalidPrimaryMarketTransition();
    error InvalidRedeemableAsset(address asset);
    error PrimaryMarketTransferRestricted(address from, address to, uint256 amount);
    error SnapshotAlreadyFrozen();

    event PrimaryMarketModeChanged(BoardroomPrimaryMarketStorage.Mode indexed mode);
    event ProtocolLiquidityActivated(address indexed vault, bytes32 indexed poolId, address indexed quoteAsset);
    event ProtocolLiquidityClosed(address indexed vault, bytes32 indexed poolId, address indexed quoteAsset);
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

    function activateProtocolLiquidity(
        address policyRegistry,
        address shareToken,
        address vault,
        bytes32 poolId,
        address quoteAsset
    ) external {
        BoardroomCoreStorage.Layout storage core = BoardroomCoreStorage.layout();
        if (
            core.status != BoardroomCoreStorage.Status.Active || !core.executionActive
                || core.executionTarget != msg.sender || core.executionPolicy != msg.sender
                || !IBoardroomPolicyRegistry(policyRegistry).isModulePolicy(msg.sender) || vault == address(0)
                || poolId == bytes32(0) || quoteAsset == address(0)
        ) revert InvalidExecutionContext();
        BoardroomLiquidityStorage.Layout storage liquidity = BoardroomLiquidityStorage.layout();
        if (
            liquidity.status != BoardroomLiquidityStorage.Status.Unconfigured || liquidity.vault != address(0)
                || liquidity.poolId != bytes32(0)
                || (liquidity.quoteAsset != address(0) && liquidity.quoteAsset != quoteAsset)
        ) revert InvalidLiquidityTransition();

        IBoardroomMarketCanonicalLiquidity canonical = IBoardroomMarketCanonicalLiquidity(vault);
        if (
            canonical.factory() != msg.sender || canonical.boardroom() != address(this) || canonical.poolId() != poolId
                || (canonical.tokenA() != quoteAsset && canonical.tokenB() != quoteAsset)
        ) revert InvalidLiquidityTransition();

        BoardroomPrimaryMarketStorage.Layout storage market = BoardroomPrimaryMarketStorage.layout();
        if (market.mode != BoardroomPrimaryMarketStorage.Mode.GeneralAvailability) {
            revert InvalidPrimaryMarketTransition();
        }
        _registerAsset(shareToken, quoteAsset);
        market.quoteAsset = quoteAsset;

        liquidity.status = BoardroomLiquidityStorage.Status.Active;
        liquidity.vault = vault;
        liquidity.poolId = poolId;
        liquidity.quoteAsset = quoteAsset;
        emit ProtocolLiquidityActivated(vault, poolId, quoteAsset);
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
