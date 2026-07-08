// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {LibClone} from "solady/utils/LibClone.sol";
import {FixedPriceSale} from "./FixedPriceSale.sol";
import {MigratingBondingCurve} from "./MigratingBondingCurve.sol";
import {ExactTransferLib} from "../lib/ExactTransferLib.sol";
import {IBoardroomCallPolicy} from "../policy/IBoardroomCallPolicy.sol";

interface IDistributionBoardroom {
    function shareToken() external view returns (address);
}

contract DistributionFactory is IBoardroomCallPolicy {
    uint256 internal constant FIXED_PRICE_SALE_CREATE_DATA_LENGTH = 4 + 32 * 8;
    uint256 internal constant MIGRATING_CURVE_CREATE_DATA_LENGTH = 4 + 32 * 12;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant MAX_CURVE_SUPPLY = 1e36;
    uint256 public constant MAX_DISTRIBUTIONS_PER_BOARDROOM = 128;

    enum DistributionKind {
        FixedPriceSale,
        MigratingBondingCurve
    }

    address public immutable lockedLiquidityFactory;
    address public immutable fixedPriceSaleLogic;
    address public immutable migratingBondingCurveLogic;

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

    constructor(address lockedLiquidityFactory_) {
        lockedLiquidityFactory = lockedLiquidityFactory_;
        fixedPriceSaleLogic = address(new FixedPriceSale());
        migratingBondingCurveLogic = address(new MigratingBondingCurve());
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

    function canCall(address boardroom, address, address target, uint256 value, bytes calldata data)
        external
        view
        returns (bool)
    {
        if (value != 0) return false;

        bytes4 selector = _selector(data);
        if (target == address(this)) {
            if (selector == DistributionFactory.createMigratingBondingCurve.selector) {
                return _canCreateMigratingBondingCurve(boardroom, data);
            }

            return
                selector == DistributionFactory.createFixedPriceSale.selector
                    && _canCreateFixedPriceSale(boardroom, data);
        }

        if (distributionBoardroom[target] != boardroom) return false;

        DistributionKind kind = distributionKind[target];
        if (kind == DistributionKind.FixedPriceSale) {
            return selector == FixedPriceSale.close.selector || selector == FixedPriceSale.cancel.selector;
        }
        if (kind == DistributionKind.MigratingBondingCurve) {
            return
                selector == MigratingBondingCurve.cancel.selector || selector == MigratingBondingCurve.migrate.selector;
        }

        return false;
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

    function _createDistribution(
        address implementation,
        address boardroom,
        address shareToken,
        address paymentToken,
        uint256 shareAmount,
        bytes32 salt,
        DistributionKind kind
    ) internal returns (address distribution) {
        if (boardroom == address(0) || shareToken == address(0) || paymentToken == address(0)) {
            revert InvalidAddress();
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
        ExactTransferLib.RecipientDelta memory delta = ExactTransferLib.pullTo(token, from, to, expectedAmount);
        if (delta.balanceDecreased) {
            revert UnexpectedTokenBalanceChange(token, expectedAmount, 0);
        }
        if (delta.received != expectedAmount) {
            revert UnexpectedTokenBalanceChange(token, expectedAmount, delta.received);
        }
    }

    function _hasValidTimeWindow(uint64 startTime, uint64 endTime) internal pure returns (bool) {
        return endTime == 0 || endTime >= startTime;
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
