// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {LibClone} from "solady/utils/LibClone.sol";
import {FixedPriceSale} from "./FixedPriceSale.sol";
import {MerkleAirdrop} from "./MerkleAirdrop.sol";
import {MigratingBondingCurve} from "./MigratingBondingCurve.sol";
import {ExactTransferLib} from "../lib/ExactTransferLib.sol";
import {IBoardroomObligationPolicy} from "../policy/IBoardroomObligationPolicy.sol";

interface IDistributionBoardroom {
    function shareToken() external view returns (address);
}

interface IDistributionLifecycle {
    function isClosed() external view returns (bool);
}

contract DistributionFactory is IBoardroomObligationPolicy {
    uint256 internal constant FIXED_PRICE_SALE_CREATE_DATA_LENGTH = 4 + 32 * 8;
    uint256 internal constant MIGRATING_CURVE_CREATE_DATA_LENGTH = 4 + 32 * 12;
    uint256 internal constant MERKLE_AIRDROP_CREATE_DATA_LENGTH = 4 + 32 * 7;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant MAX_CURVE_SUPPLY = 1e36;
    uint256 public constant MAX_DISTRIBUTIONS_PER_BOARDROOM = 128;

    enum DistributionKind {
        FixedPriceSale,
        MigratingBondingCurve,
        MerkleAirdrop
    }

    address public immutable lockedLiquidityFactory;
    address public immutable tokenGrantFactory;
    address public immutable fixedPriceSaleLogic;
    address public immutable migratingBondingCurveLogic;
    address public immutable merkleAirdropLogic;

    mapping(address => bool) public isDistribution;
    mapping(address => address) public distributionBoardroom;
    mapping(address => DistributionKind) public distributionKind;
    mapping(address => address[]) internal distributionsForBoardroom;

    error InvalidAddress();
    error InvalidBoardroom(address boardroom);
    error InvalidShareToken(address expected, address actual);
    error TooManyBoardroomDistributions(address boardroom);
    error UnexpectedTokenBalanceChange(address token, uint256 expected, uint256 actual);

    event DistributionCreated(
        address indexed distribution,
        address indexed boardroom,
        DistributionKind indexed kind,
        address shareToken,
        address paymentToken,
        uint256 shareAmount,
        bytes32 salt
    );
    event ClosedDistributionsPruned(address indexed boardroom, uint256 count);

    constructor(address lockedLiquidityFactory_, address tokenGrantFactory_) {
        if (tokenGrantFactory_ == address(0)) revert InvalidAddress();
        lockedLiquidityFactory = lockedLiquidityFactory_;
        tokenGrantFactory = tokenGrantFactory_;
        fixedPriceSaleLogic = address(new FixedPriceSale());
        migratingBondingCurveLogic = address(new MigratingBondingCurve());
        merkleAirdropLogic = address(new MerkleAirdrop());
    }

    function createFixedPriceSale(FixedPriceSale.CreateParams calldata params) external returns (address sale) {
        _requireBoardroomShareToken(msg.sender, params.shareToken);

        sale = _createDistribution(
            fixedPriceSaleLogic,
            msg.sender,
            params.shareToken,
            params.paymentToken,
            params.shareAmount,
            params.salt,
            DistributionKind.FixedPriceSale
        );

        FixedPriceSale(sale).initialize(msg.sender, params);
        _checkedTransferFrom(params.shareToken, msg.sender, sale, params.shareAmount);
    }

    function createMigratingBondingCurve(MigratingBondingCurve.CreateParams calldata params)
        external
        returns (address curve)
    {
        if (lockedLiquidityFactory == address(0)) revert InvalidAddress();
        _requireBoardroomShareToken(msg.sender, params.shareToken);

        uint256 shareAmount = params.saleSupply + params.migrationSupply;
        curve = _createDistribution(
            migratingBondingCurveLogic,
            msg.sender,
            params.shareToken,
            params.quoteToken,
            shareAmount,
            params.salt,
            DistributionKind.MigratingBondingCurve
        );

        MigratingBondingCurve(curve).initialize(msg.sender, lockedLiquidityFactory, params);
        _checkedTransferFrom(params.shareToken, msg.sender, curve, shareAmount);
    }

    function createMerkleAirdrop(MerkleAirdrop.CreateParams calldata params) external returns (address airdrop) {
        _requireBoardroomShareToken(msg.sender, params.shareToken);

        airdrop = _createDistribution(
            merkleAirdropLogic,
            msg.sender,
            params.shareToken,
            address(0),
            params.shareAmount,
            params.salt,
            DistributionKind.MerkleAirdrop
        );

        MerkleAirdrop(airdrop).initialize(msg.sender, tokenGrantFactory, params);
        _checkedTransferFrom(params.shareToken, msg.sender, airdrop, params.shareAmount);
    }

    function canCall(address boardroom, address, address target, uint256 value, bytes calldata data)
        external
        view
        returns (bool)
    {
        if (value != 0) return false;

        bytes4 selector = _selector(data);
        if (target == address(this)) {
            return _canCreateDistribution(boardroom, selector, data);
        }

        return _canCallDistributionLifecycle(boardroom, target, selector);
    }

    function obligationForCall(address, address target, uint256, bytes calldata data, bytes calldata result)
        external
        view
        returns (Obligation memory obligation)
    {
        if (target != address(this) || result.length != 32) return obligation;

        bytes4 selector = _selector(data);
        if (!_isCreateDistributionSelector(selector)) return obligation;

        address distribution = abi.decode(result, (address));
        obligation.kind = ObligationKind.Distribution;
        obligation.account = distribution;
        if (selector == DistributionFactory.createMerkleAirdrop.selector) {
            obligation.grantSlotReservations = MerkleAirdrop(distribution).maxGrantClaims();
        }
    }

    function isLifecycleCallAllowed(address boardroom, address target, bytes4 selector) external view returns (bool) {
        return _canCallDistributionLifecycle(boardroom, target, selector);
    }

    function grantSlotReleaseForLifecycleCall(address boardroom, address target, bytes4 selector)
        external
        view
        returns (address distribution)
    {
        if (distributionBoardroom[target] != boardroom) return address(0);
        if (distributionKind[target] != DistributionKind.MerkleAirdrop) return address(0);
        if (!_isMerkleAirdropLifecycleSelector(selector)) return address(0);
        return target;
    }

    function distributionCountForBoardroom(address boardroom) external view returns (uint256) {
        return distributionsForBoardroom[boardroom].length;
    }

    function distributionForBoardroomAt(address boardroom, uint256 index) external view returns (address) {
        return distributionsForBoardroom[boardroom][index];
    }

    function getDistributionsForBoardroom(address boardroom) external view returns (address[] memory) {
        return distributionsForBoardroom[boardroom];
    }

    /// @notice Removes closed entries from the Boardroom's bounded active-distribution index.
    /// @dev Distribution identity mappings remain permanent so historical addresses stay attributable.
    function pruneClosedDistributions(address boardroom) public returns (uint256 pruned) {
        address[] storage distributions = distributionsForBoardroom[boardroom];
        uint256 index;

        while (index < distributions.length) {
            if (!_isClosedDistribution(distributions[index])) {
                unchecked {
                    ++index;
                }
                continue;
            }

            distributions[index] = distributions[distributions.length - 1];
            distributions.pop();
            unchecked {
                ++pruned;
            }
        }

        if (pruned != 0) emit ClosedDistributionsPruned(boardroom, pruned);
    }

    function predictFixedPriceSaleAddress(address boardroom, bytes32 salt) external view returns (address) {
        return LibClone.predictDeterministicAddress(
            fixedPriceSaleLogic, _cloneSalt(boardroom, DistributionKind.FixedPriceSale, salt), address(this)
        );
    }

    function predictMigratingBondingCurveAddress(address boardroom, bytes32 salt) external view returns (address) {
        return LibClone.predictDeterministicAddress(
            migratingBondingCurveLogic,
            _cloneSalt(boardroom, DistributionKind.MigratingBondingCurve, salt),
            address(this)
        );
    }

    function predictMerkleAirdropAddress(address boardroom, bytes32 salt) external view returns (address) {
        return LibClone.predictDeterministicAddress(
            merkleAirdropLogic, _cloneSalt(boardroom, DistributionKind.MerkleAirdrop, salt), address(this)
        );
    }

    function _canCreateDistribution(address boardroom, bytes4 selector, bytes calldata data)
        internal
        view
        returns (bool)
    {
        if (selector == DistributionFactory.createFixedPriceSale.selector) {
            return _canCreateFixedPriceSale(boardroom, data);
        }
        if (selector == DistributionFactory.createMigratingBondingCurve.selector) {
            return _canCreateMigratingBondingCurve(boardroom, data);
        }
        if (selector == DistributionFactory.createMerkleAirdrop.selector) {
            return _canCreateMerkleAirdrop(boardroom, data);
        }

        return false;
    }

    function _canCallDistributionLifecycle(address boardroom, address target, bytes4 selector)
        internal
        view
        returns (bool)
    {
        if (distributionBoardroom[target] != boardroom) return false;

        DistributionKind kind = distributionKind[target];
        if (kind == DistributionKind.FixedPriceSale) {
            return _isFixedPriceSaleLifecycleSelector(selector);
        }
        if (kind == DistributionKind.MigratingBondingCurve) {
            return _isMigratingBondingCurveLifecycleSelector(selector);
        }
        if (kind == DistributionKind.MerkleAirdrop) {
            return _isMerkleAirdropLifecycleSelector(selector);
        }

        return false;
    }

    function _canCreateFixedPriceSale(address boardroom, bytes calldata data) internal view returns (bool) {
        if (data.length != FIXED_PRICE_SALE_CREATE_DATA_LENGTH) return false;

        FixedPriceSale.CreateParams memory params = abi.decode(data[4:], (FixedPriceSale.CreateParams));
        if (params.shareToken != IDistributionBoardroom(boardroom).shareToken()) return false;
        if (params.paymentToken == address(0)) return false;
        if (params.shareAmount == 0 || params.price == 0) return false;
        return _hasValidTimeWindow(params.startTime, params.endTime);
    }

    function _canCreateMigratingBondingCurve(address boardroom, bytes calldata data) internal view returns (bool) {
        if (lockedLiquidityFactory == address(0)) return false;
        if (data.length != MIGRATING_CURVE_CREATE_DATA_LENGTH) return false;

        MigratingBondingCurve.CreateParams memory params = abi.decode(data[4:], (MigratingBondingCurve.CreateParams));
        if (params.shareToken != IDistributionBoardroom(boardroom).shareToken()) return false;
        if (params.quoteToken == address(0) || params.quoteToken == params.shareToken) return false;
        if (params.saleSupply == 0 || params.migrationSupply == 0) return false;
        if (params.saleSupply > MAX_CURVE_SUPPLY || params.migrationSupply > MAX_CURVE_SUPPLY - params.saleSupply) {
            return false;
        }
        if (params.basePrice == 0 || params.graduationQuoteTarget == 0) return false;
        if (params.quoteToLpBps == 0 || params.quoteToLpBps > BPS) return false;
        return _hasValidTimeWindow(params.startTime, params.endTime);
    }

    function _canCreateMerkleAirdrop(address boardroom, bytes calldata data) internal view returns (bool) {
        if (data.length != MERKLE_AIRDROP_CREATE_DATA_LENGTH) return false;

        MerkleAirdrop.CreateParams memory params = abi.decode(data[4:], (MerkleAirdrop.CreateParams));
        if (params.shareToken != IDistributionBoardroom(boardroom).shareToken()) return false;
        if (params.shareAmount == 0 || params.merkleRoot == bytes32(0)) return false;
        return _hasValidTimeWindow(params.startTime, params.endTime);
    }

    function _createDistribution(
        address implementation,
        address boardroom,
        address shareToken,
        address paymentToken,
        uint256 shareAmount,
        bytes32 salt,
        DistributionKind kind
    ) internal returns (address distribution) {
        if (boardroom == address(0) || shareToken == address(0)) {
            revert InvalidAddress();
        }
        if (distributionsForBoardroom[boardroom].length >= MAX_DISTRIBUTIONS_PER_BOARDROOM) {
            pruneClosedDistributions(boardroom);
        }
        if (distributionsForBoardroom[boardroom].length >= MAX_DISTRIBUTIONS_PER_BOARDROOM) {
            revert TooManyBoardroomDistributions(boardroom);
        }

        distribution = LibClone.cloneDeterministic(implementation, _cloneSalt(boardroom, kind, salt));
        isDistribution[distribution] = true;
        distributionBoardroom[distribution] = boardroom;
        distributionKind[distribution] = kind;
        distributionsForBoardroom[boardroom].push(distribution);

        emit DistributionCreated(distribution, boardroom, kind, shareToken, paymentToken, shareAmount, salt);
    }

    function _checkedTransferFrom(address token, address from, address to, uint256 expectedAmount) internal {
        ExactTransferLib.ExactDelta memory delta = ExactTransferLib.pullBetween(token, from, to, expectedAmount);
        if (delta.senderBalanceIncreased) {
            revert UnexpectedTokenBalanceChange(token, expectedAmount, 0);
        }
        if (delta.senderSpent != expectedAmount) {
            revert UnexpectedTokenBalanceChange(token, expectedAmount, delta.senderSpent);
        }
        if (delta.recipientBalanceDecreased) {
            revert UnexpectedTokenBalanceChange(token, expectedAmount, 0);
        }
        if (delta.recipientReceived != expectedAmount) {
            revert UnexpectedTokenBalanceChange(token, expectedAmount, delta.recipientReceived);
        }
    }

    function _hasValidTimeWindow(uint64 startTime, uint64 endTime) internal view returns (bool) {
        return endTime == 0 || (endTime > startTime && uint256(endTime) > block.timestamp);
    }

    function _isClosedDistribution(address distribution) internal view returns (bool) {
        try IDistributionLifecycle(distribution).isClosed() returns (bool closed) {
            return closed;
        } catch {
            return false;
        }
    }

    function _isCreateDistributionSelector(bytes4 selector) internal pure returns (bool) {
        return selector == DistributionFactory.createFixedPriceSale.selector
            || selector == DistributionFactory.createMigratingBondingCurve.selector
            || selector == DistributionFactory.createMerkleAirdrop.selector;
    }

    function _isFixedPriceSaleLifecycleSelector(bytes4 selector) internal pure returns (bool) {
        return selector == FixedPriceSale.close.selector || selector == FixedPriceSale.cancel.selector;
    }

    function _isMigratingBondingCurveLifecycleSelector(bytes4 selector) internal pure returns (bool) {
        return selector == MigratingBondingCurve.cancel.selector || selector == MigratingBondingCurve.migrate.selector;
    }

    function _isMerkleAirdropLifecycleSelector(bytes4 selector) internal pure returns (bool) {
        return selector == MerkleAirdrop.close.selector || selector == MerkleAirdrop.cancel.selector;
    }

    function _requireBoardroomShareToken(address boardroom, address shareToken) internal view {
        try IDistributionBoardroom(boardroom).shareToken() returns (address expectedShareToken) {
            if (shareToken != expectedShareToken) revert InvalidShareToken(expectedShareToken, shareToken);
        } catch {
            revert InvalidBoardroom(boardroom);
        }
    }

    function _cloneSalt(address boardroom, DistributionKind kind, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encode(boardroom, kind, salt));
    }

    function _selector(bytes calldata data) internal pure returns (bytes4 selector) {
        if (data.length < 4) return bytes4(0);
        return bytes4(data[:4]);
    }
}
