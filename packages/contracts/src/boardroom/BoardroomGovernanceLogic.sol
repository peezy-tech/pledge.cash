// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {BoardroomToken} from "./BoardroomToken.sol";
import {IBoardroomPolicyRegistry} from "./IBoardroomPolicyRegistry.sol";
import {BoardroomAssetStorage} from "./storage/BoardroomAssetStorage.sol";
import {BoardroomCoreStorage} from "./storage/BoardroomCoreStorage.sol";
import {BoardroomLiquidityStorage} from "./storage/BoardroomLiquidityStorage.sol";
import {BoardroomObligationStorage} from "./storage/BoardroomObligationStorage.sol";
import {BestEffortTokenLib} from "../lib/BestEffortTokenLib.sol";
import {ExactTransferLib} from "../lib/ExactTransferLib.sol";
import {IBoardroomObligationPolicy} from "../policy/IBoardroomObligationPolicy.sol";

interface IBoardroomGovernanceRewards {
    function activeStakeOf(address account) external view returns (uint256);

    function getPastActiveStake(address account, uint256 blockNumber) external view returns (uint256);
}

interface IBoardroomCanonicalObligation {
    function factory() external view returns (address);

    function boardroom() external view returns (address);

    function shareToken() external view returns (address);
}

interface IBoardroomCanonicalGrant {
    function factory() external view returns (address);

    function issuer() external view returns (address);

    function token() external view returns (address);
}

interface IBoardroomCanonicalLiquidity {
    function factory() external view returns (address);

    function boardroom() external view returns (address);

    function tokenA() external view returns (address);

    function tokenB() external view returns (address);

    function poolId() external view returns (bytes32);

    function poolManager() external view returns (address);

    function isClosed() external view returns (bool);
}

interface IBoardroomCanonicalLiquidityPolicy {
    function poolManager() external view returns (address);
}

interface IBoardroomClosableObligation {
    function isClosed() external view returns (bool);
}

interface IBoardroomTerminalRewards {
    function isTerminalized() external view returns (bool);
}

/// @notice EIP-170 helper logic shared by Boardroom clones.
/// @dev Governance scheduling deliberately does not live here. It is owned by each external controller.
contract BoardroomGovernanceLogic {
    uint256 internal constant ASSET_PROBE_GAS = 30_000;
    uint256 internal constant MAX_OBLIGATION_DEPENDENCIES = 12;
    uint256 internal constant MAX_PRUNE_BATCH = 32;

    error InsufficientStakerPower(address account, uint256 currentStake, uint256 pastStake, uint256 requiredStake);
    error NoCirculatingShares();
    error NotActiveStaker(address account);
    error InvalidAddress();
    error InvalidExecutionStatus(uint8 status);
    error CallNotAllowed(address policy, address target, bytes4 selector);
    error CallFailed(address target);
    error InvalidObligation(address obligation);
    error ObligationAlreadyRegistered(address obligation);
    error ObligationNotActive(address obligation);
    error InvalidRedeemableAsset(address asset);
    error SnapshotAlreadyFrozen();
    error TooManyObligationDependencies(uint256 requested, uint256 maximum);
    error TooManyCalls(uint256 requested, uint256 maximum);
    error InvalidParentTransition(address parent);
    error InvalidExecutionContext();
    error InvalidAmount();
    error TreasuryContributionExpired(uint256 deadline);
    error TreasuryContributionAmountMismatch(address asset, uint256 expected, uint256 received);

    event BoardroomCallExecuted(
        address indexed policy,
        address indexed target,
        bytes4 indexed selector,
        address authority,
        uint256 value,
        bytes32 dataHash
    );
    event BoardroomObligationRecorded(
        address indexed obligation, address indexed policy, BoardroomObligationStorage.Kind indexed kind
    );
    event BoardroomObligationPruned(
        address indexed obligation, address indexed policy, BoardroomObligationStorage.Kind indexed kind
    );
    event BoardroomObligationDependency(address indexed obligation, address indexed asset);
    event RedeemableAssetRegistered(address indexed asset);
    event TreasuryAssetContributed(address indexed contributor, address indexed asset, uint256 amount);

    function deployShareToken(string calldata name, string calldata symbol) external returns (address token) {
        token = address(new BoardroomToken(address(this), name, symbol));
    }

    function contributeTreasuryAsset(address asset, uint256 amount, uint256 deadline) external {
        if (deadline < block.timestamp) revert TreasuryContributionExpired(deadline);
        uint8 currentStatus = uint8(BoardroomCoreStorage.layout().status);
        if (currentStatus != uint8(BoardroomCoreStorage.Status.Active)) {
            revert InvalidExecutionStatus(currentStatus);
        }
        if (!BoardroomAssetStorage.layout().isRegistered[asset]) revert InvalidRedeemableAsset(asset);
        if (amount == 0) revert InvalidAmount();

        ExactTransferLib.RecipientDelta memory delta = ExactTransferLib.pullTo(asset, msg.sender, address(this), amount);
        if (delta.balanceDecreased || delta.received != amount) {
            revert TreasuryContributionAmountMismatch(asset, amount, delta.received);
        }
        emit TreasuryAssetContributed(msg.sender, asset, amount);
    }

    function requireStakerPower(
        address shareToken,
        address rewardPool,
        address account,
        uint256 thresholdBps,
        uint256 bpsDenominator
    ) external view {
        if (block.number == 0) revert NoCirculatingShares();
        if (rewardPool == address(0)) revert NotActiveStaker(account);

        BoardroomToken shares = BoardroomToken(shareToken);
        if (shares.isEncumberedAccount(account)) revert NotActiveStaker(account);
        IBoardroomGovernanceRewards rewards = IBoardroomGovernanceRewards(rewardPool);
        uint256 snapshotBlock = block.number - 1;
        uint256 currentEligible = shares.governanceEligibleSupply();
        uint256 pastEligible = shares.getPastGovernanceEligibleSupply(snapshotBlock);
        if (currentEligible == 0 || pastEligible == 0) revert NoCirculatingShares();

        uint256 currentRequired = (currentEligible * thresholdBps + bpsDenominator - 1) / bpsDenominator;
        uint256 pastRequired = (pastEligible * thresholdBps + bpsDenominator - 1) / bpsDenominator;
        uint256 required = currentRequired > pastRequired ? currentRequired : pastRequired;
        uint256 currentStake = rewards.activeStakeOf(account);
        uint256 pastStake = rewards.getPastActiveStake(account, snapshotBlock);
        if (currentStake < required || pastStake < required) {
            revert InsufficientStakerPower(account, currentStake, pastStake, required);
        }
    }

    function executeCall(
        address policyRegistry,
        address shareToken,
        uint8 currentStatus,
        address authority,
        address policy,
        address target,
        uint256 value,
        bytes calldata data
    ) external payable returns (bytes memory result) {
        if (target == address(0)) revert InvalidAddress();
        if (currentStatus > uint8(BoardroomCoreStorage.Status.WindingDown)) {
            revert InvalidExecutionStatus(currentStatus);
        }

        BoardroomObligationStorage.Record storage record = BoardroomObligationStorage.layout().obligationOf[target];
        address canonicalPolicy = record.active ? record.policy : address(0);
        if (currentStatus == uint8(BoardroomCoreStorage.Status.WindingDown) && canonicalPolicy == address(0)) {
            revert CallNotAllowed(policy, target, _selector(data));
        }
        IBoardroomPolicyRegistry(policyRegistry)
            .authorizeCall(address(this), authority, policy, target, value, data, canonicalPolicy);

        BoardroomCoreStorage.Layout storage core = BoardroomCoreStorage.layout();
        core.executionActive = true;
        core.executionAuthority = authority;
        core.executionPolicy = policy;
        core.executionTarget = target;
        (bool success, bytes memory output) = target.call{value: value}(data);
        core.executionActive = false;
        core.executionAuthority = address(0);
        core.executionPolicy = address(0);
        core.executionTarget = address(0);
        if (!success) _revertCall(target, output);
        result = output;

        if (canonicalPolicy != address(0)) {
            _pruneObligation(shareToken, target);
        } else if (currentStatus == uint8(BoardroomCoreStorage.Status.Active) && policy != address(0)) {
            _recordPostCallObligation(policyRegistry, shareToken, policy, target, value, data, result);
        }
        emit BoardroomCallExecuted(policy, target, _selector(data), authority, value, keccak256(data));
    }

    function pruneObligation(address shareToken, address obligation) external returns (bool pruned) {
        pruned = _pruneObligation(shareToken, obligation);
    }

    function pruneObligations(address shareToken, address[] calldata obligations) external returns (uint256 pruned) {
        uint256 length = obligations.length;
        if (length == 0 || length > MAX_PRUNE_BATCH) revert TooManyCalls(length, MAX_PRUNE_BATCH);
        for (uint256 i; i < length; ++i) {
            if (_pruneObligation(shareToken, obligations[i])) ++pruned;
        }
    }

    function addObligationDependency(address shareToken, address obligation, address asset) external {
        BoardroomObligationStorage.Record storage record = BoardroomObligationStorage.layout().obligationOf[obligation];
        if (!record.active) revert ObligationNotActive(obligation);
        _addDependency(shareToken, obligation, asset);
    }

    function _recordPostCallObligation(
        address policyRegistry,
        address shareToken,
        address policy,
        address target,
        uint256 value,
        bytes calldata data,
        bytes memory result
    ) internal {
        if (!IBoardroomPolicyRegistry(policyRegistry).isModulePolicy(policy)) return;
        IBoardroomObligationPolicy.Obligation memory obligation =
            IBoardroomObligationPolicy(policy).obligationForCall(address(this), target, value, data, result);
        BoardroomObligationStorage.Kind kind = _obligationKind(obligation.kind);
        if (kind == BoardroomObligationStorage.Kind.None) return;
        _registerObligation(policyRegistry, shareToken, policy, obligation.account, kind, obligation.aux);
    }

    function _registerObligation(
        address policyRegistry,
        address shareToken,
        address policy,
        address obligation,
        BoardroomObligationStorage.Kind kind,
        address auxiliary
    ) internal {
        if (
            policy == address(0) || obligation == address(0) || obligation.code.length == 0
                || kind == BoardroomObligationStorage.Kind.None
                || !IBoardroomPolicyRegistry(policyRegistry).isModulePolicy(policy)
        ) revert InvalidObligation(obligation);

        BoardroomObligationStorage.Layout storage obligations = BoardroomObligationStorage.layout();
        BoardroomObligationStorage.Record storage record = obligations.obligationOf[obligation];
        if (record.everRegistered) revert ObligationAlreadyRegistered(obligation);
        _requireCanonicalObligation(policy, shareToken, obligation, kind, auxiliary);
        if (kind == BoardroomObligationStorage.Kind.Reward && obligations.rewardPool != address(0)) {
            revert ObligationAlreadyRegistered(obligations.rewardPool);
        }

        record.policy = policy;
        record.kind = kind;
        record.active = true;
        record.everRegistered = true;
        ++obligations.activeCount;
        ++obligations.activeByKind[kind];
        BoardroomToken shares = BoardroomToken(shareToken);
        if (kind == BoardroomObligationStorage.Kind.Reward) {
            obligations.rewardPool = obligation;
            shares.registerRewardLocker(obligation);
        } else if (
            (kind != BoardroomObligationStorage.Kind.Grant
                    || IBoardroomCanonicalGrant(obligation).token() == shareToken)
                && !shares.isEncumberedAccount(obligation)
        ) {
            shares.registerEncumberedAccount(obligation);
        }
        if (kind == BoardroomObligationStorage.Kind.Liquidity) {
            address poolManager = IBoardroomCanonicalLiquidity(obligation).poolManager();
            if (!shares.isEncumberedAccount(poolManager)) shares.registerEncumberedAccount(poolManager);
        }
        if (auxiliary != address(0)) {
            if (!shares.isEncumberedAccount(auxiliary)) shares.registerEncumberedAccount(auxiliary);
            _addDependency(shareToken, obligation, auxiliary);
        }
        _discoverDependencies(shareToken, obligation, kind);
        emit BoardroomObligationRecorded(obligation, policy, kind);
    }

    function _requireCanonicalObligation(
        address policy,
        address shareToken,
        address obligation,
        BoardroomObligationStorage.Kind kind,
        address auxiliary
    ) internal view {
        if (kind == BoardroomObligationStorage.Kind.Grant) {
            IBoardroomCanonicalGrant grant = IBoardroomCanonicalGrant(obligation);
            address token = grant.token();
            if (
                grant.factory() != policy || grant.issuer() != address(this) || token == address(0)
                    || token.code.length == 0
            ) {
                revert InvalidObligation(obligation);
            }
            return;
        }
        if (kind == BoardroomObligationStorage.Kind.Liquidity) {
            IBoardroomCanonicalLiquidity liquidity = IBoardroomCanonicalLiquidity(obligation);
            address tokenA = liquidity.tokenA();
            address tokenB = liquidity.tokenB();
            BoardroomLiquidityStorage.Layout storage canonicalLiquidity = BoardroomLiquidityStorage.layout();
            if (
                liquidity.factory() != policy || liquidity.boardroom() != address(this)
                    || (tokenA != shareToken && tokenB != shareToken) || auxiliary != address(0)
                    || liquidity.poolId() == bytes32(0) || canonicalLiquidity.vault != obligation
                    || canonicalLiquidity.poolId != liquidity.poolId()
                    || liquidity.poolManager() != IBoardroomCanonicalLiquidityPolicy(policy).poolManager()
            ) revert InvalidObligation(obligation);
            return;
        }
        IBoardroomCanonicalObligation canonical = IBoardroomCanonicalObligation(obligation);
        if (
            canonical.factory() != policy || canonical.boardroom() != address(this)
                || canonical.shareToken() != shareToken
        ) revert InvalidObligation(obligation);
    }

    function _discoverDependencies(address shareToken, address obligation, BoardroomObligationStorage.Kind kind)
        internal
    {
        if (kind == BoardroomObligationStorage.Kind.Grant) {
            _addDependencyIfAsset(shareToken, obligation, _readAddress(obligation, bytes4(keccak256("token()"))));
            _addDependencyIfAsset(shareToken, obligation, _readAddress(obligation, bytes4(keccak256("paymentToken()"))));
            return;
        }
        if (kind == BoardroomObligationStorage.Kind.Distribution) {
            _addDependencyIfAsset(shareToken, obligation, _readAddress(obligation, bytes4(keccak256("paymentToken()"))));
            _addDependencyIfAsset(shareToken, obligation, _readAddress(obligation, bytes4(keccak256("quoteToken()"))));
            return;
        }
        if (kind == BoardroomObligationStorage.Kind.Liquidity) {
            _addDependency(shareToken, obligation, obligation);
            _addDependencyIfAsset(shareToken, obligation, _readAddress(obligation, bytes4(keccak256("tokenA()"))));
            _addDependencyIfAsset(shareToken, obligation, _readAddress(obligation, bytes4(keccak256("tokenB()"))));
        }
    }

    function _addDependencyIfAsset(address shareToken, address obligation, address asset) internal {
        if (asset == address(0) || asset == shareToken || asset == address(this)) return;
        _addDependency(shareToken, obligation, asset);
    }

    function _addDependency(address shareToken, address obligation, address asset) internal {
        _validateAsset(shareToken, asset);
        BoardroomObligationStorage.Layout storage obligations = BoardroomObligationStorage.layout();
        address[] storage dependencies = obligations.dependenciesOf[obligation];
        uint256 length = dependencies.length;
        for (uint256 i; i < length; ++i) {
            if (dependencies[i] == asset) return;
        }
        if (length >= MAX_OBLIGATION_DEPENDENCIES) {
            revert TooManyObligationDependencies(length + 1, MAX_OBLIGATION_DEPENDENCIES);
        }
        dependencies.push(asset);
        ++obligations.assetDependencyCount[asset];
        _registerAsset(shareToken, asset);
        emit BoardroomObligationDependency(obligation, asset);
    }

    function _pruneObligation(address, address obligation) internal returns (bool pruned) {
        BoardroomObligationStorage.Record storage record = BoardroomObligationStorage.layout().obligationOf[obligation];
        if (!record.active) return false;
        bool terminal;
        if (record.kind == BoardroomObligationStorage.Kind.Reward) {
            try IBoardroomTerminalRewards(obligation).isTerminalized() returns (bool closed) {
                terminal = closed;
            } catch {}
        } else {
            try IBoardroomClosableObligation(obligation).isClosed() returns (bool closed) {
                terminal = closed;
            } catch {}
        }
        if (!terminal) return false;
        _deactivateObligation(obligation);
        return true;
    }

    function _deactivateObligation(address obligation) internal {
        BoardroomObligationStorage.Layout storage obligations = BoardroomObligationStorage.layout();
        BoardroomObligationStorage.Record storage record = obligations.obligationOf[obligation];
        if (!record.active) revert ObligationNotActive(obligation);
        record.active = false;
        --obligations.activeCount;
        --obligations.activeByKind[record.kind];
        address[] storage dependencies = obligations.dependenciesOf[obligation];
        uint256 length = dependencies.length;
        for (uint256 i; i < length; ++i) {
            --obligations.assetDependencyCount[dependencies[i]];
        }
        emit BoardroomObligationPruned(obligation, record.policy, record.kind);
    }

    function _registerAsset(address shareToken, address asset) internal {
        _validateAsset(shareToken, asset);
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

    function _validateAsset(address shareToken, address asset) internal view {
        if (asset == address(0) || asset == shareToken || asset == address(this) || asset.code.length == 0) {
            revert InvalidRedeemableAsset(asset);
        }
        (bool readable,) = BestEffortTokenLib.tryBalanceOf(asset, address(this));
        if (!readable) revert InvalidRedeemableAsset(asset);
    }

    function _obligationKind(IBoardroomObligationPolicy.ObligationKind kind)
        internal
        pure
        returns (BoardroomObligationStorage.Kind)
    {
        if (kind == IBoardroomObligationPolicy.ObligationKind.Grant) return BoardroomObligationStorage.Kind.Grant;
        if (kind == IBoardroomObligationPolicy.ObligationKind.Distribution) {
            return BoardroomObligationStorage.Kind.Distribution;
        }
        if (kind == IBoardroomObligationPolicy.ObligationKind.Liquidity) {
            return BoardroomObligationStorage.Kind.Liquidity;
        }
        if (kind == IBoardroomObligationPolicy.ObligationKind.Reward) return BoardroomObligationStorage.Kind.Reward;
        return BoardroomObligationStorage.Kind.None;
    }

    function _readAddress(address target, bytes4 selector) internal view returns (address value) {
        (bool success, bytes memory result) = target.staticcall{gas: ASSET_PROBE_GAS}(abi.encodeWithSelector(selector));
        if (success && result.length == 32) value = abi.decode(result, (address));
    }

    function _selector(bytes calldata data) internal pure returns (bytes4 selector) {
        if (data.length < 4) return bytes4(0);
        return bytes4(data[:4]);
    }

    function _revertCall(address target, bytes memory returnData) internal pure {
        if (returnData.length == 0) revert CallFailed(target);
        assembly ("memory-safe") {
            revert(add(returnData, 0x20), mload(returnData))
        }
    }
}
