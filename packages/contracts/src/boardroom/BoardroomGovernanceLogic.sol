// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {BoardroomToken} from "./BoardroomToken.sol";
import {BoardroomGovernanceStorage} from "./BoardroomGovernanceStorage.sol";
import {IBoardroomPolicyRegistry} from "./IBoardroomPolicyRegistry.sol";
import {BoardroomRedemptionPayout} from "./BoardroomRedemptionPayout.sol";
import {BoardroomRedemptionStorage} from "./BoardroomRedemptionStorage.sol";
import {AmmPool} from "../amm/AmmPool.sol";
import {TokenGrant} from "../grants/TokenGrant.sol";
import {LockedLiquidity} from "../liquidity/LockedLiquidity.sol";
import {LockedLiquidityFactory} from "../liquidity/LockedLiquidityFactory.sol";
import {IBoardroomObligationPolicy} from "../policy/IBoardroomObligationPolicy.sol";

interface IBoardroomGovernanceDistribution {
    function factory() external view returns (address);
    function boardroom() external view returns (address);
    function shareToken() external view returns (address);
}

contract BoardroomGovernanceLogic {
    uint256 internal constant ASSET_PROBE_GAS = 30_000;
    uint256 internal constant TERMINAL_LIQUIDITY_EXIT_GAS = 1_500_000;
    uint256 internal constant MIN_TERMINAL_LIQUIDITY_DELAY = 1 days;
    error ActionAlreadyQueued(bytes32 actionHash);
    error ActionNotQueued(bytes32 actionHash);
    error ActionNotReady(bytes32 actionHash, uint256 eta, uint256 currentTime);
    error ActionExpired(bytes32 actionHash, uint256 expiresAt, uint256 currentTime);
    error ActionContextMismatch(bytes32 actionHash);
    error InsufficientHolderPower(
        address account, uint256 currentBalance, uint256 pastBalance, uint256 requiredBalance
    );
    error NoCirculatingShares();
    error NotShareholder(address account);
    error InvalidRedeemableAsset(address asset);
    error EmptyRedeemableAsset(address asset);
    error RedeemableAssetAlreadyRegistered(address asset);
    error RedeemableAssetStillValid(address asset);
    error RedeemableAssetHasBalance(address asset, uint256 balance);
    error RedeemableAssetReserved(address asset);
    error TooManyRedeemableAssets();
    error PolicyNotAllowed(address policy);
    error TooManyIssuedGrants();
    error TooManyIssuedGrantReservations(uint256 requested, uint256 available);
    error TooManyIssuedDistributions();
    error TooManyLockedLiquidityPositions();
    error NoReservedIssuedGrantSlots(address distribution);
    error InvalidIssuedGrant(address grant);
    error InvalidIssuedDistribution(address distribution);
    error InvalidLockedLiquidity(address locker);
    error IssuedGrantStillOpen(address grant);
    error IssuedDistributionStillOpen(address distribution);
    error LockedLiquidityStillOpen(address locker);
    error WindDownFinalizationNotReady(uint256 readyAt, uint256 currentTime);
    error CallFailed(address target);

    event RedeemableAssetRegistered(address indexed asset);
    event RedeemableAssetRemoved(address indexed asset);
    event RedeemableAssetQuarantined(address indexed asset);
    event BoardroomGrantRecorded(address indexed grant);
    event BoardroomGrantSlotsReserved(address indexed distribution, uint256 count);
    event BoardroomGrantSlotsReleased(address indexed distribution, uint256 count);
    event BoardroomDistributionRecorded(address indexed distribution);
    event BoardroomLockedLiquidityRecorded(address indexed locker);
    event BoardroomLockedLiquidityExited(
        address indexed locker, address indexed pool, uint256 liquidity, uint256 amountA, uint256 amountB
    );
    event BoardroomLockedLiquidityReturnedAsLp(address indexed locker, address indexed pool, uint256 liquidity);

    struct LifecycleSlots {
        uint256 redeemableAssets;
        uint256 issuedGrants;
        uint256 issuedDistributions;
        uint256 lockedLiquidityPositions;
        uint256 issuedGrantSlotReservations;
        uint256 isRedeemableAsset;
        uint256 isIssuedGrant;
        uint256 isIssuedDistribution;
        uint256 isLockedLiquidity;
        uint256 issuedGrantReservationsForDistribution;
        uint256 obligationPolicyOf;
    }

    struct LifecycleConfig {
        address policyRegistry;
        address shareToken;
        uint256 maxAssets;
        uint256 maxGrants;
        uint256 maxDistributions;
        uint256 maxLockers;
    }

    struct ExitParams {
        address redemptionPayout;
        address locker;
        uint256 amountAMin;
        uint256 amountBMin;
        uint256 deadline;
        uint256 governanceDelay;
    }

    struct ExitResult {
        address pool;
        address tokenA;
        address tokenB;
        uint256 amountA;
        uint256 amountB;
        uint256 liquidity;
        bool returnedAsLp;
    }

    function deployShareToken(string calldata name, string calldata symbol) external returns (address token) {
        token = address(new BoardroomToken(address(this), name, symbol));
    }

    function queueAction(bytes32 actionHash, uint8 status, uint256 delay, uint256 gracePeriod)
        external
        returns (uint256 eta)
    {
        BoardroomGovernanceStorage.Layout storage governance = BoardroomGovernanceStorage.layout();
        BoardroomGovernanceStorage.ActionContext storage existing = governance.actions[actionHash];
        if (existing.eta != 0 && existing.epoch == governance.epoch && block.timestamp <= existing.expiresAt) {
            revert ActionAlreadyQueued(actionHash);
        }

        eta = block.timestamp + delay;
        governance.actions[actionHash] = BoardroomGovernanceStorage.ActionContext({
            eta: uint64(eta), expiresAt: uint64(eta + gracePeriod), epoch: governance.epoch, status: status
        });
    }

    function consumeReadyAction(bytes32 actionHash, uint8 status) external {
        BoardroomGovernanceStorage.Layout storage governance = BoardroomGovernanceStorage.layout();
        BoardroomGovernanceStorage.ActionContext memory context = governance.actions[actionHash];
        if (context.eta == 0) revert ActionNotQueued(actionHash);
        if (context.epoch != governance.epoch || context.status != status) revert ActionContextMismatch(actionHash);
        if (block.timestamp < context.eta) {
            revert ActionNotReady(actionHash, context.eta, block.timestamp);
        }
        if (block.timestamp > context.expiresAt) {
            revert ActionExpired(actionHash, context.expiresAt, block.timestamp);
        }
        delete governance.actions[actionHash];
    }

    function cancelAction(bytes32 actionHash) external {
        BoardroomGovernanceStorage.Layout storage governance = BoardroomGovernanceStorage.layout();
        BoardroomGovernanceStorage.ActionContext memory context = governance.actions[actionHash];
        if (context.eta == 0) revert ActionNotQueued(actionHash);
        if (context.epoch != governance.epoch) revert ActionContextMismatch(actionHash);
        delete governance.actions[actionHash];
    }

    function advanceEpoch() external returns (uint64 epoch) {
        BoardroomGovernanceStorage.Layout storage governance = BoardroomGovernanceStorage.layout();
        epoch = governance.epoch + 1;
        governance.epoch = epoch;
    }

    function startWindDown() external returns (uint64 epoch) {
        BoardroomGovernanceStorage.Layout storage governance = BoardroomGovernanceStorage.layout();
        governance.windDownStartedAt = uint64(block.timestamp);
        epoch = governance.epoch + 1;
        governance.epoch = epoch;
    }

    function requireHolderPower(address shareToken, address account, uint256 thresholdBps, uint256 bpsDenominator)
        external
        view
    {
        if (block.number == 0) revert NoCirculatingShares();

        BoardroomToken shares = BoardroomToken(shareToken);
        if (shares.isEncumberedAccount(account)) revert NotShareholder(account);
        uint256 snapshotBlock = block.number - 1;
        uint256 currentEligible = shares.governanceEligibleSupply();
        uint256 pastEligible = shares.getPastGovernanceEligibleSupply(snapshotBlock);
        if (currentEligible == 0 || pastEligible == 0) revert NoCirculatingShares();

        uint256 currentRequired = (currentEligible * thresholdBps + bpsDenominator - 1) / bpsDenominator;
        uint256 pastRequired = (pastEligible * thresholdBps + bpsDenominator - 1) / bpsDenominator;
        // A custody transition cannot lower the denominator for either side of the prior-block power check.
        uint256 required = currentRequired > pastRequired ? currentRequired : pastRequired;
        uint256 currentBalance = shares.balanceOf(account);
        uint256 pastBalance = shares.getPastBalance(account, snapshotBlock);
        if (currentBalance < required || pastBalance < required) {
            revert InsufficientHolderPower(account, currentBalance, pastBalance, required);
        }
    }

    function validateRedeemableAsset(address asset, address shareToken, address boardroom)
        public
        view
        returns (uint256 balance)
    {
        if (asset == address(0) || asset == shareToken || asset == boardroom || asset.code.length == 0) {
            revert InvalidRedeemableAsset(asset);
        }
        bool success;
        (success, balance) = _tryBalanceOf(asset, boardroom);
        if (!success) revert InvalidRedeemableAsset(asset);
    }

    function reserveRedeemableAsset(address policyRegistry, address asset, address shareToken, uint256 maximum)
        external
        payable
    {
        LifecycleSlots memory slots = _lifecycleSlots();
        address policy = msg.sender;
        if (!IBoardroomPolicyRegistry(policyRegistry).isModulePolicy(policy)) revert PolicyNotAllowed(policy);
        validateRedeemableAsset(asset, shareToken, address(this));
        _registerAssetIfNeeded(slots, asset, shareToken, maximum);
    }

    function registerRedeemableAsset(
        address asset,
        address shareToken,
        uint256 maximum,
        bool allowExisting,
        bool requirePositiveBalance
    ) external returns (bool registered) {
        LifecycleSlots memory slots = _lifecycleSlots();
        uint256 balance = validateRedeemableAsset(asset, shareToken, address(this));
        if (requirePositiveBalance && balance == 0) revert EmptyRedeemableAsset(asset);
        if (_mappingBool(slots.isRedeemableAsset, asset)) {
            if (allowExisting) return false;
            revert RedeemableAssetAlreadyRegistered(asset);
        }

        if (_arrayLength(slots.redeemableAssets) >= maximum) revert TooManyRedeemableAssets();

        _setMappingBool(slots.isRedeemableAsset, asset, true);
        _push(slots.redeemableAssets, asset);
        emit RedeemableAssetRegistered(asset);
        return true;
    }

    function removeEmptyRedeemableAsset(address asset, address shareToken, address wrappedNative) external {
        LifecycleSlots memory slots = _lifecycleSlots();
        if (asset == wrappedNative) revert InvalidRedeemableAsset(asset);
        uint256 balance = validateRedeemableAsset(asset, shareToken, address(this));
        if (balance != 0) revert RedeemableAssetHasBalance(asset, balance);
        _removeRedeemableAsset(slots, asset, false);
    }

    function quarantineRedeemableAsset(address asset, address shareToken, address wrappedNative) external {
        LifecycleSlots memory slots = _lifecycleSlots();
        if (asset == wrappedNative || !_mappingBool(slots.isRedeemableAsset, asset)) {
            revert InvalidRedeemableAsset(asset);
        }
        (bool readable,) = _tryBalanceOf(asset, address(this));
        if (asset.code.length != 0 && asset != shareToken && readable) revert RedeemableAssetStillValid(asset);
        _removeRedeemableAsset(slots, asset, true);
    }

    function _removeRedeemableAsset(LifecycleSlots memory slots, address asset, bool quarantined) private {
        if (!_mappingBool(slots.isRedeemableAsset, asset)) revert InvalidRedeemableAsset(asset);
        if (BoardroomGovernanceStorage.layout().redeemableAssetPins[asset] != 0) {
            revert RedeemableAssetReserved(asset);
        }
        (bool found, uint256 index) = _find(slots.redeemableAssets, asset);
        if (!found) revert InvalidRedeemableAsset(asset);

        _removeAt(slots.redeemableAssets, index);
        _setMappingBool(slots.isRedeemableAsset, asset, false);
        if (quarantined) emit RedeemableAssetQuarantined(asset);
        else emit RedeemableAssetRemoved(asset);
    }

    function recordIssuedObligation(
        LifecycleConfig calldata config,
        address policy,
        address target,
        uint256 value,
        bytes calldata data,
        bytes calldata result
    ) external payable {
        IBoardroomObligationPolicy.Obligation memory obligation = IBoardroomObligationPolicy(policy)
            .obligationForCall(address(this), target, value, data, result);
        if (obligation.kind == IBoardroomObligationPolicy.ObligationKind.None) return;
        if (obligation.kind == IBoardroomObligationPolicy.ObligationKind.Grant) {
            _recordIssuedGrant(
                config.policyRegistry, config.shareToken, policy, obligation.account, config.maxAssets, config.maxGrants
            );
            return;
        }
        if (obligation.kind == IBoardroomObligationPolicy.ObligationKind.Distribution) {
            _recordIssuedDistribution(
                config.policyRegistry, config.shareToken, policy, obligation.account, config.maxDistributions
            );
            _reserveIssuedGrantSlots(obligation.account, obligation.grantSlotReservations, config.maxGrants);
            return;
        }
        _recordLockedLiquidityPosition(config, obligation.account, obligation.aux, policy);
    }

    function recordGrantFromDistribution(
        address policyRegistry,
        address shareToken,
        address grant,
        uint256 maxAssets,
        uint256 maxGrants
    ) external {
        LifecycleSlots memory slots = _lifecycleSlots();
        if (!_mappingBool(slots.isIssuedDistribution, msg.sender)) {
            revert InvalidIssuedDistribution(msg.sender);
        }
        _consumeIssuedGrantReservation(slots, msg.sender);
        _recordIssuedGrant(policyRegistry, shareToken, TokenGrant(grant).factory(), grant, maxAssets, maxGrants);
    }

    function recordLockedLiquidityFromDistribution(LifecycleConfig calldata config, address locker, address pool)
        external
    {
        LifecycleSlots memory slots = _lifecycleSlots();
        if (!_mappingBool(slots.isIssuedDistribution, msg.sender)) {
            revert InvalidIssuedDistribution(msg.sender);
        }
        _recordLockedLiquidityPosition(config, locker, pool, address(0));
    }

    function releaseGrantSlotsForLifecycleCall(address policy, address target, bytes4 selector) external payable {
        address distribution =
            IBoardroomObligationPolicy(policy).grantSlotReleaseForLifecycleCall(address(this), target, selector);
        if (distribution != address(0)) _releaseIssuedGrantSlots(distribution);
    }

    function exitLockedLiquidity(
        LifecycleConfig calldata config,
        BoardroomRedemptionPayout.ObligationSlots calldata obligationSlots,
        ExitParams calldata params
    ) external returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        LifecycleSlots memory lifecycleSlots = _lifecycleSlots();
        address locker = params.locker;
        if (!_mappingBool(lifecycleSlots.isLockedLiquidity, locker)) {
            revert InvalidLockedLiquidity(locker);
        }
        ExitResult memory exited = _exitPosition(LockedLiquidity(locker), params);
        amountA = exited.amountA;
        amountB = exited.amountB;
        liquidity = exited.liquidity;

        BoardroomGovernanceStorage.Layout storage governance = BoardroomGovernanceStorage.layout();
        governance.redeemableAssetPins[exited.pool] -= 1;
        if (exited.returnedAsLp) {
            _quarantineUnreadableAssetIfNeeded(lifecycleSlots, exited.tokenA, config.shareToken);
            _quarantineUnreadableAssetIfNeeded(lifecycleSlots, exited.tokenB, config.shareToken);
        } else {
            _registerAssetIfNeeded(lifecycleSlots, exited.tokenA, config.shareToken, config.maxAssets);
            _registerAssetIfNeeded(lifecycleSlots, exited.tokenB, config.shareToken, config.maxAssets);
            if (governance.redeemableAssetPins[exited.pool] == 0) {
                (bool readable, uint256 balance) = _tryBalanceOf(exited.pool, address(this));
                if (readable && balance == 0) _removeRedeemableAsset(lifecycleSlots, exited.pool, false);
            }
        }
        _delegate(
            params.redemptionPayout,
            abi.encodeCall(BoardroomRedemptionPayout.burnTreasuryShares, (config.shareToken, false))
        );
        _delegate(
            params.redemptionPayout,
            abi.encodeCall(BoardroomRedemptionPayout.pruneClosedObligation, (obligationSlots, locker))
        );
        if (exited.returnedAsLp) emit BoardroomLockedLiquidityReturnedAsLp(locker, exited.pool, liquidity);
        else emit BoardroomLockedLiquidityExited(locker, exited.pool, liquidity, amountA, amountB);
    }

    function _exitPosition(LockedLiquidity position, ExitParams calldata params)
        private
        returns (ExitResult memory exited)
    {
        exited.pool = position.pool();
        exited.tokenA = position.tokenA();
        exited.tokenB = position.tokenB();
        uint256 fallbackDelay = params.governanceDelay == 0 ? MIN_TERMINAL_LIQUIDITY_DELAY : params.governanceDelay;
        uint256 terminalAt = uint256(BoardroomGovernanceStorage.layout().windDownStartedAt) + fallbackDelay;
        if (block.timestamp < terminalAt) {
            (exited.amountA, exited.amountB, exited.liquidity) =
                position.exitToBoardroom(params.amountAMin, params.amountBMin, params.deadline);
            return exited;
        }

        try position.exitToBoardroom{gas: TERMINAL_LIQUIDITY_EXIT_GAS}(0, 0, block.timestamp) returns (
            uint256 amountA, uint256 amountB, uint256 liquidity
        ) {
            exited.amountA = amountA;
            exited.amountB = amountB;
            exited.liquidity = liquidity;
        } catch {
            exited.liquidity = position.returnLpToBoardroom();
            exited.returnedAsLp = true;
        }
    }

    function finalizeWindDown(
        BoardroomRedemptionPayout.ObligationSlots calldata obligationSlots,
        address redemptionPayout,
        address wrappedNative,
        address shareToken,
        address[] calldata redeemableAssets,
        uint256 governanceDelay
    ) external {
        LifecycleSlots memory lifecycleSlots = _lifecycleSlots();
        uint256 readyAt = uint256(BoardroomGovernanceStorage.layout().windDownStartedAt) + governanceDelay;
        if (block.timestamp < readyAt) revert WindDownFinalizationNotReady(readyAt, block.timestamp);

        _delegate(redemptionPayout, abi.encodeCall(BoardroomRedemptionPayout.wrapNative, (wrappedNative)));
        _delegate(redemptionPayout, abi.encodeCall(BoardroomRedemptionPayout.pruneClosedObligations, (obligationSlots)));
        if (_arrayLength(lifecycleSlots.issuedGrants) != 0) {
            revert IssuedGrantStillOpen(_arrayAt(lifecycleSlots.issuedGrants, 0));
        }
        if (_arrayLength(lifecycleSlots.issuedDistributions) != 0) {
            revert IssuedDistributionStillOpen(_arrayAt(lifecycleSlots.issuedDistributions, 0));
        }
        if (_arrayLength(lifecycleSlots.lockedLiquidityPositions) != 0) {
            revert LockedLiquidityStillOpen(_arrayAt(lifecycleSlots.lockedLiquidityPositions, 0));
        }
        _delegate(redemptionPayout, abi.encodeCall(BoardroomRedemptionPayout.burnTreasuryShares, (shareToken, false)));
        BoardroomRedemptionStorage.layout().supply = BoardroomToken(shareToken).totalSupply();
        _delegate(redemptionPayout, abi.encodeCall(BoardroomRedemptionPayout.snapshotAssets, (redeemableAssets)));
    }

    function _recordIssuedGrant(
        address policyRegistry,
        address shareToken,
        address factory,
        address grant,
        uint256 maxAssets,
        uint256 maxGrants
    ) private {
        LifecycleSlots memory slots = _lifecycleSlots();
        if (_remainingIssuedGrantSlots(slots, maxGrants) == 0) revert TooManyIssuedGrants();
        if (
            grant == address(0) || _mappingAddress(slots.obligationPolicyOf, grant) != address(0)
                || !IBoardroomPolicyRegistry(policyRegistry).isModulePolicy(factory)
        ) revert InvalidIssuedGrant(grant);

        TokenGrant tokenGrant = TokenGrant(grant);
        if (tokenGrant.issuer() != address(this) || tokenGrant.factory() != factory) revert InvalidIssuedGrant(grant);

        address grantToken = tokenGrant.token();
        if (grantToken == shareToken) BoardroomToken(shareToken).registerEncumberedAccount(grant);
        else _registerAssetIfNeeded(slots, grantToken, shareToken, maxAssets);
        address paymentToken = tokenGrant.paymentToken();
        if (paymentToken != address(0)) _registerAssetIfNeeded(slots, paymentToken, shareToken, maxAssets);
        _setMappingBool(slots.isIssuedGrant, grant, true);
        _setMappingAddress(slots.obligationPolicyOf, grant, factory);
        _push(slots.issuedGrants, grant);
        emit BoardroomGrantRecorded(grant);
    }

    function _recordIssuedDistribution(
        address policyRegistry,
        address shareToken,
        address factory,
        address distribution,
        uint256 maximum
    ) private {
        LifecycleSlots memory slots = _lifecycleSlots();
        if (_arrayLength(slots.issuedDistributions) >= maximum) revert TooManyIssuedDistributions();
        if (
            distribution == address(0) || _mappingAddress(slots.obligationPolicyOf, distribution) != address(0)
                || !IBoardroomPolicyRegistry(policyRegistry).isModulePolicy(factory)
        ) revert InvalidIssuedDistribution(distribution);

        IBoardroomGovernanceDistribution issued = IBoardroomGovernanceDistribution(distribution);
        if (issued.boardroom() != address(this) || issued.factory() != factory || issued.shareToken() != shareToken) {
            revert InvalidIssuedDistribution(distribution);
        }
        BoardroomToken(shareToken).registerEncumberedAccount(distribution);
        _setMappingBool(slots.isIssuedDistribution, distribution, true);
        _setMappingAddress(slots.obligationPolicyOf, distribution, factory);
        _push(slots.issuedDistributions, distribution);
        emit BoardroomDistributionRecorded(distribution);
    }

    function _recordLockedLiquidityPosition(
        LifecycleConfig calldata config,
        address locker,
        address pool,
        address expectedFactory
    ) private {
        LifecycleSlots memory slots = _lifecycleSlots();
        if (_arrayLength(slots.lockedLiquidityPositions) >= config.maxLockers) {
            revert TooManyLockedLiquidityPositions();
        }
        if (locker == address(0) || _mappingAddress(slots.obligationPolicyOf, locker) != address(0)) {
            revert InvalidLockedLiquidity(locker);
        }

        LockedLiquidity position = LockedLiquidity(locker);
        address factory = position.factory();
        if (expectedFactory != address(0) && factory != expectedFactory) revert InvalidLockedLiquidity(locker);
        if (!IBoardroomPolicyRegistry(config.policyRegistry).isModulePolicy(factory)) {
            revert InvalidLockedLiquidity(locker);
        }
        if (
            position.boardroom() != address(this) || position.pool() != pool
                || !LockedLiquidityFactory(factory).isLocker(locker)
        ) revert InvalidLockedLiquidity(locker);
        if (position.tokenA() != config.shareToken && position.tokenB() != config.shareToken) {
            revert InvalidLockedLiquidity(locker);
        }

        _registerAssetIfNeeded(slots, position.tokenA(), config.shareToken, config.maxAssets);
        _registerAssetIfNeeded(slots, position.tokenB(), config.shareToken, config.maxAssets);
        _registerAssetIfNeeded(slots, pool, config.shareToken, config.maxAssets);
        BoardroomGovernanceStorage.layout().redeemableAssetPins[pool] += 1;
        BoardroomToken(config.shareToken).registerEncumberedAccount(pool);
        BoardroomToken(config.shareToken).registerEncumberedAccount(AmmPool(pool).poolFees());
        _setMappingBool(slots.isLockedLiquidity, locker, true);
        _setMappingAddress(slots.obligationPolicyOf, locker, factory);
        _push(slots.lockedLiquidityPositions, locker);
        emit BoardroomLockedLiquidityRecorded(locker);
    }

    function _registerAssetIfNeeded(LifecycleSlots memory slots, address asset, address shareToken, uint256 maximum)
        private
    {
        if (asset == address(0) || asset == shareToken || asset == address(this)) return;
        if (_mappingBool(slots.isRedeemableAsset, asset)) return;
        validateRedeemableAsset(asset, shareToken, address(this));
        if (_arrayLength(slots.redeemableAssets) >= maximum) revert TooManyRedeemableAssets();
        _setMappingBool(slots.isRedeemableAsset, asset, true);
        _push(slots.redeemableAssets, asset);
        emit RedeemableAssetRegistered(asset);
    }

    function _quarantineUnreadableAssetIfNeeded(LifecycleSlots memory slots, address asset, address shareToken)
        private
    {
        if (asset == shareToken || !_mappingBool(slots.isRedeemableAsset, asset)) return;
        (bool readable,) = _tryBalanceOf(asset, address(this));
        if (asset.code.length == 0 || !readable) _removeRedeemableAsset(slots, asset, true);
    }

    function _reserveIssuedGrantSlots(address distribution, uint256 count, uint256 maximum) private {
        LifecycleSlots memory slots = _lifecycleSlots();
        if (count == 0) return;
        uint256 available = _remainingIssuedGrantSlots(slots, maximum);
        if (count > available) revert TooManyIssuedGrantReservations(count, available);
        _setMappingUint(slots.issuedGrantReservationsForDistribution, distribution, count);
        _setSlot(slots.issuedGrantSlotReservations, _slotValue(slots.issuedGrantSlotReservations) + count);
        emit BoardroomGrantSlotsReserved(distribution, count);
    }

    function _consumeIssuedGrantReservation(LifecycleSlots memory slots, address distribution) private {
        uint256 reserved = _mappingUint(slots.issuedGrantReservationsForDistribution, distribution);
        if (reserved == 0) revert NoReservedIssuedGrantSlots(distribution);
        _setMappingUint(slots.issuedGrantReservationsForDistribution, distribution, reserved - 1);
        _setSlot(slots.issuedGrantSlotReservations, _slotValue(slots.issuedGrantSlotReservations) - 1);
    }

    function _releaseIssuedGrantSlots(address distribution) private {
        LifecycleSlots memory slots = _lifecycleSlots();
        uint256 reserved = _mappingUint(slots.issuedGrantReservationsForDistribution, distribution);
        if (reserved == 0) return;
        _setMappingUint(slots.issuedGrantReservationsForDistribution, distribution, 0);
        _setSlot(slots.issuedGrantSlotReservations, _slotValue(slots.issuedGrantSlotReservations) - reserved);
        emit BoardroomGrantSlotsReleased(distribution, reserved);
    }

    function _remainingIssuedGrantSlots(LifecycleSlots memory slots, uint256 maximum) private view returns (uint256) {
        uint256 usedAndReserved = _arrayLength(slots.issuedGrants) + _slotValue(slots.issuedGrantSlotReservations);
        return usedAndReserved >= maximum ? 0 : maximum - usedAndReserved;
    }

    /// @dev Boardroom's legacy storage layout is fixed for its immutable clone implementation.
    function _lifecycleSlots() private pure returns (LifecycleSlots memory slots) {
        slots = LifecycleSlots({
            redeemableAssets: 6,
            issuedGrants: 7,
            issuedDistributions: 8,
            lockedLiquidityPositions: 9,
            issuedGrantSlotReservations: 10,
            isRedeemableAsset: 11,
            isIssuedGrant: 12,
            isIssuedDistribution: 13,
            isLockedLiquidity: 14,
            issuedGrantReservationsForDistribution: 15,
            obligationPolicyOf: 16
        });
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

    function _push(uint256 arraySlot, address account) private {
        assembly ("memory-safe") {
            let length := sload(arraySlot)
            mstore(0, arraySlot)
            sstore(add(keccak256(0, 0x20), length), account)
            sstore(arraySlot, add(length, 1))
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
        _setSlot(_mappingPosition(mappingSlot, account), value ? 1 : 0);
    }

    function _mappingAddress(uint256 mappingSlot, address account) private view returns (address value) {
        uint256 raw = _slotValue(_mappingPosition(mappingSlot, account));
        value = address(uint160(raw));
    }

    function _setMappingAddress(uint256 mappingSlot, address account, address value) private {
        _setSlot(_mappingPosition(mappingSlot, account), uint256(uint160(value)));
    }

    function _mappingUint(uint256 mappingSlot, address account) private view returns (uint256) {
        return _slotValue(_mappingPosition(mappingSlot, account));
    }

    function _setMappingUint(uint256 mappingSlot, address account, uint256 value) private {
        _setSlot(_mappingPosition(mappingSlot, account), value);
    }

    function _mappingPosition(uint256 mappingSlot, address account) private pure returns (uint256 position) {
        assembly ("memory-safe") {
            mstore(0, account)
            mstore(0x20, mappingSlot)
            position := keccak256(0, 0x40)
        }
    }

    function _slotValue(uint256 slot) private view returns (uint256 value) {
        assembly ("memory-safe") {
            value := sload(slot)
        }
    }

    function _setSlot(uint256 slot, uint256 value) private {
        assembly ("memory-safe") {
            sstore(slot, value)
        }
    }

    function _tryBalanceOf(address asset, address account) private view returns (bool success, uint256 amount) {
        assembly ("memory-safe") {
            let pointer := mload(0x40)
            mstore(pointer, shl(224, 0x70a08231))
            mstore(add(pointer, 4), account)
            success := staticcall(ASSET_PROBE_GAS, asset, pointer, 36, pointer, 32)
            success := and(success, eq(returndatasize(), 32))
            amount := mload(pointer)
        }
    }

    function _delegate(address target, bytes memory input) private returns (bytes memory result) {
        (bool success, bytes memory output) = target.delegatecall(input);
        if (!success) {
            if (output.length == 0) revert CallFailed(target);
            assembly ("memory-safe") {
                revert(add(output, 0x20), mload(output))
            }
        }
        return output;
    }
}
