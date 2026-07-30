// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {LibClone} from "solady/utils/LibClone.sol";
import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";
import {DutchAuctionSale} from "./DutchAuctionSale.sol";
import {FixedPriceSale} from "./FixedPriceSale.sol";
import {MerkleAirdrop} from "./MerkleAirdrop.sol";
import {MigratingBondingCurve} from "./MigratingBondingCurve.sol";
import {LockedLiquidityFactory} from "../liquidity/LockedLiquidityFactory.sol";
import {BestEffortTokenLib} from "../lib/BestEffortTokenLib.sol";
import {ExactTransferLib} from "../lib/ExactTransferLib.sol";
import {IBoardroomObligationPolicy} from "../policy/IBoardroomObligationPolicy.sol";
import {BoardroomCallbackLib} from "../policy/BoardroomCallbackLib.sol";

interface IDistributionBoardroom {
    function launched() external view returns (bool);

    function primaryMarketMode() external view returns (uint8);

    function shareToken() external view returns (address);
}

interface IDistributionBoundFactory {
    function boardroomFactory() external view returns (address);
}

interface IDistributionBoardroomFactory {
    function isBoardroom(address boardroom) external view returns (bool);
}

contract DistributionFactory is IBoardroomObligationPolicy {
    uint256 internal constant FIXED_PRICE_SALE_CREATE_DATA_LENGTH = 4 + 32 * 8;
    uint256 internal constant DUTCH_AUCTION_CREATE_DATA_LENGTH = 4 + 32 * 9;
    uint256 internal constant MIGRATING_CURVE_CREATE_DATA_LENGTH = 4 + 32 * 12;
    uint256 internal constant MERKLE_AIRDROP_CREATE_DATA_LENGTH = 4 + 32 * 7;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant WAD = 1e18;
    uint256 internal constant MINIMUM_MIGRATION_FILL_BPS = 9_500;
    uint256 internal constant AMM_MINIMUM_LIQUIDITY = 1_000;
    uint256 internal constant MAX_CURVE_LIFETIME = 90 days;
    uint256 internal constant MAX_DUTCH_AUCTION_LIFETIME = 90 days;
    uint256 internal constant MAX_CURVE_SUPPLY = type(uint112).max;
    uint256 public constant MAX_DISCOVERY_PAGE = 100;

    enum DistributionKind {
        FixedPriceSale,
        MigratingBondingCurve,
        MerkleAirdrop,
        DutchAuction
    }

    address public immutable lockedLiquidityFactory;
    address public immutable tokenGrantFactory;
    address public immutable boardroomFactory;
    address public immutable fixedPriceSaleLogic;
    address public immutable dutchAuctionLogic;
    address public immutable migratingBondingCurveLogic;
    address public immutable merkleAirdropLogic;

    mapping(address => bool) public isDistribution;
    mapping(address => address) public distributionBoardroom;
    mapping(address => DistributionKind) public distributionKind;
    mapping(address => address) public bondingCurveOfBoardroom;
    mapping(address => address[]) internal distributionsForBoardroom;

    error InvalidAddress();
    error IncoherentFactoryIdentity(address expected, address actual);
    error BondingCurveAlreadyConfigured(address boardroom, address curve);
    error InvalidBoardroom(address boardroom);
    error InvalidShareToken(address expected, address actual);
    error InvalidPrimaryMarketState(address boardroom);
    error InvalidDiscoveryPage(uint256 requested, uint256 maximum);
    error UnexpectedTokenBalanceChange(address token, uint256 expected, uint256 actual);
    error InvalidAsset(address asset);

    event DistributionCreated(
        address indexed distribution,
        address indexed boardroom,
        DistributionKind indexed kind,
        address shareToken,
        address paymentToken,
        uint256 shareAmount,
        bytes32 salt
    );

    constructor(address lockedLiquidityFactory_, address tokenGrantFactory_) {
        if (
            lockedLiquidityFactory_ == address(0) || lockedLiquidityFactory_.code.length == 0
                || tokenGrantFactory_ == address(0) || tokenGrantFactory_.code.length == 0
        ) revert InvalidAddress();
        address expectedBoardroomFactory = IDistributionBoundFactory(tokenGrantFactory_).boardroomFactory();
        address liquidityBoardroomFactory = IDistributionBoundFactory(lockedLiquidityFactory_).boardroomFactory();
        if (expectedBoardroomFactory == address(0) || liquidityBoardroomFactory != expectedBoardroomFactory) {
            revert IncoherentFactoryIdentity(expectedBoardroomFactory, liquidityBoardroomFactory);
        }
        lockedLiquidityFactory = lockedLiquidityFactory_;
        tokenGrantFactory = tokenGrantFactory_;
        boardroomFactory = expectedBoardroomFactory;
        fixedPriceSaleLogic = address(new FixedPriceSale());
        dutchAuctionLogic = address(new DutchAuctionSale());
        migratingBondingCurveLogic = address(new MigratingBondingCurve());
        merkleAirdropLogic = address(new MerkleAirdrop());
    }

    function createFixedPriceSale(FixedPriceSale.CreateParams calldata params) external returns (address sale) {
        _requireBoardroomShareToken(msg.sender, params.shareToken);
        _requireAsset(params.paymentToken);
        // Boardroom-initiated frame: the outer mutating route already bound the caller's release hash.
        BoardroomCallbackLib.reserveRedeemableAsset(
            msg.sender, BoardroomCallbackLib.boundFacetSetHash(msg.sender), params.paymentToken
        );

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

    function createDutchAuction(DutchAuctionSale.CreateParams calldata params) external returns (address auction) {
        _requireBoardroomShareToken(msg.sender, params.shareToken);
        if (params.paymentToken == params.shareToken) revert InvalidAsset(params.paymentToken);
        _requireAsset(params.paymentToken);
        // Boardroom-initiated frame: the outer mutating route already bound the caller's release hash.
        BoardroomCallbackLib.reserveRedeemableAsset(
            msg.sender, BoardroomCallbackLib.boundFacetSetHash(msg.sender), params.paymentToken
        );

        auction = _createDistribution(
            dutchAuctionLogic,
            msg.sender,
            params.shareToken,
            params.paymentToken,
            params.shareAmount,
            params.salt,
            DistributionKind.DutchAuction
        );

        DutchAuctionSale(auction).initialize(msg.sender, params);
        _checkedTransferFrom(params.shareToken, msg.sender, auction, params.shareAmount);
    }

    function createMigratingBondingCurve(MigratingBondingCurve.CreateParams calldata params)
        external
        returns (address curve)
    {
        if (lockedLiquidityFactory == address(0)) revert InvalidAddress();
        if (
            IDistributionBoardroom(msg.sender).launched() || IDistributionBoardroom(msg.sender).primaryMarketMode() != 0
        ) {
            revert InvalidPrimaryMarketState(msg.sender);
        }
        address existingCurve = bondingCurveOfBoardroom[msg.sender];
        if (existingCurve != address(0)) revert BondingCurveAlreadyConfigured(msg.sender, existingCurve);
        _requireBoardroomShareToken(msg.sender, params.shareToken);
        _requireAsset(params.quoteToken);
        // Boardroom-initiated frame: the outer mutating route already bound the caller's release hash.
        bytes32 expectedFacetSetHash = BoardroomCallbackLib.boundFacetSetHash(msg.sender);
        BoardroomCallbackLib.reserveRedeemableAsset(msg.sender, expectedFacetSetHash, params.quoteToken);

        uint256 shareAmount = params.saleSupply + params.migrationSupply;
        address predictedCurve = LibClone.predictDeterministicAddress(
            migratingBondingCurveLogic,
            _cloneSalt(msg.sender, DistributionKind.MigratingBondingCurve, params.salt),
            address(this)
        );
        bondingCurveOfBoardroom[msg.sender] = predictedCurve;
        BoardroomCallbackLib.precommitBondingCurve(
            msg.sender, expectedFacetSetHash, predictedCurve, params.quoteToken, shareAmount
        );
        curve = _createDistribution(
            migratingBondingCurveLogic,
            msg.sender,
            params.shareToken,
            params.quoteToken,
            shareAmount,
            params.salt,
            DistributionKind.MigratingBondingCurve
        );
        if (curve != predictedCurve) revert InvalidAddress();

        MigratingBondingCurve(curve).initialize(msg.sender, lockedLiquidityFactory, params);
        LockedLiquidityFactory(lockedLiquidityFactory)
            .reserveMigration(
                expectedFacetSetHash, msg.sender, curve, params.shareToken, params.quoteToken, params.migrationSalt
            );
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
    }

    function isLifecycleCallAllowed(address boardroom, address target, bytes4 selector) external view returns (bool) {
        return _canCallDistributionLifecycle(boardroom, target, selector);
    }

    function distributionCountForBoardroom(address boardroom) external view returns (uint256) {
        return distributionsForBoardroom[boardroom].length;
    }

    function distributionForBoardroomAt(address boardroom, uint256 index) external view returns (address) {
        return distributionsForBoardroom[boardroom][index];
    }

    function distributionPageForBoardroom(address boardroom, uint256 cursor, uint256 size)
        external
        view
        returns (address[] memory page, uint256 nextCursor)
    {
        if (size == 0 || size > MAX_DISCOVERY_PAGE) revert InvalidDiscoveryPage(size, MAX_DISCOVERY_PAGE);
        address[] storage distributions = distributionsForBoardroom[boardroom];
        uint256 length = distributions.length;
        if (cursor >= length) return (new address[](0), length);
        uint256 end = cursor + size;
        if (end > length) end = length;
        page = new address[](end - cursor);
        for (uint256 i; i < page.length; ++i) {
            page[i] = distributions[cursor + i];
        }
        nextCursor = end;
    }

    function predictFixedPriceSaleAddress(address boardroom, bytes32 salt) external view returns (address) {
        return LibClone.predictDeterministicAddress(
            fixedPriceSaleLogic, _cloneSalt(boardroom, DistributionKind.FixedPriceSale, salt), address(this)
        );
    }

    function predictDutchAuctionAddress(address boardroom, bytes32 salt) external view returns (address) {
        return LibClone.predictDeterministicAddress(
            dutchAuctionLogic, _cloneSalt(boardroom, DistributionKind.DutchAuction, salt), address(this)
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
        if (selector == DistributionFactory.createDutchAuction.selector) {
            return _canCreateDutchAuction(boardroom, data);
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
        if (kind == DistributionKind.DutchAuction) {
            return _isDutchAuctionLifecycleSelector(selector);
        }

        return false;
    }

    function _canCreateFixedPriceSale(address boardroom, bytes calldata data) internal view returns (bool) {
        if (data.length != FIXED_PRICE_SALE_CREATE_DATA_LENGTH) return false;

        FixedPriceSale.CreateParams memory params = abi.decode(data[4:], (FixedPriceSale.CreateParams));
        if (params.shareToken != IDistributionBoardroom(boardroom).shareToken()) return false;
        if (params.paymentToken == address(0)) return false;
        if (!_isAsset(params.paymentToken)) return false;
        if (params.shareAmount == 0 || params.price == 0) return false;
        return _hasValidTimeWindow(params.startTime, params.endTime);
    }

    function _canCreateMigratingBondingCurve(address boardroom, bytes calldata data) internal view returns (bool) {
        if (lockedLiquidityFactory == address(0)) return false;
        if (bondingCurveOfBoardroom[boardroom] != address(0)) return false;
        if (data.length != MIGRATING_CURVE_CREATE_DATA_LENGTH) return false;
        try IDistributionBoardroom(boardroom).launched() returns (bool isLaunched) {
            if (isLaunched) return false;
        } catch {
            return false;
        }
        try IDistributionBoardroom(boardroom).primaryMarketMode() returns (uint8 mode) {
            if (mode != 0) return false;
        } catch {
            return false;
        }

        MigratingBondingCurve.CreateParams memory params = abi.decode(data[4:], (MigratingBondingCurve.CreateParams));
        if (params.shareToken != IDistributionBoardroom(boardroom).shareToken()) return false;
        if (params.quoteToken == address(0) || params.quoteToken == params.shareToken) return false;
        if (!_isAsset(params.quoteToken)) return false;
        if (params.saleSupply == 0 || params.migrationSupply == 0) return false;
        if (params.saleSupply > MAX_CURVE_SUPPLY || params.migrationSupply > MAX_CURVE_SUPPLY - params.saleSupply) {
            return false;
        }
        if (params.basePrice > type(uint112).max || params.slope > type(uint112).max) return false;
        if (params.basePrice == 0 || params.graduationQuoteTarget == 0) return false;
        if (params.quoteToLpBps == 0 || params.quoteToLpBps > BPS) return false;
        if (!_hasFeasibleCurveMigration(params)) return false;
        if (params.endTime == 0 || !_hasValidTimeWindow(params.startTime, params.endTime)) return false;
        return uint256(params.endTime) - uint256(params.startTime) <= MAX_CURVE_LIFETIME
            && uint256(params.endTime) <= block.timestamp + MAX_CURVE_LIFETIME;
    }

    function _canCreateMerkleAirdrop(address boardroom, bytes calldata data) internal view returns (bool) {
        if (data.length != MERKLE_AIRDROP_CREATE_DATA_LENGTH) return false;

        MerkleAirdrop.CreateParams memory params = abi.decode(data[4:], (MerkleAirdrop.CreateParams));
        if (params.shareToken != IDistributionBoardroom(boardroom).shareToken()) return false;
        if (params.shareAmount == 0 || params.merkleRoot == bytes32(0)) return false;
        return _hasValidTimeWindow(params.startTime, params.endTime);
    }

    function _canCreateDutchAuction(address boardroom, bytes calldata data) internal view returns (bool) {
        if (data.length != DUTCH_AUCTION_CREATE_DATA_LENGTH) return false;

        DutchAuctionSale.CreateParams memory params = abi.decode(data[4:], (DutchAuctionSale.CreateParams));
        if (params.shareToken != IDistributionBoardroom(boardroom).shareToken()) return false;
        if (
            params.paymentToken == address(0) || params.paymentToken == params.shareToken
                || !_isAsset(params.paymentToken)
        ) return false;
        if (params.shareAmount == 0 || params.startPrice <= params.floorPrice || params.floorPrice == 0) return false;

        uint256 effectiveStartTime = params.startTime == 0 ? block.timestamp : params.startTime;
        if (params.endTime <= effectiveStartTime || uint256(params.endTime) <= block.timestamp) return false;
        return uint256(params.endTime) - effectiveStartTime <= MAX_DUTCH_AUCTION_LIFETIME
            && uint256(params.endTime) <= block.timestamp + MAX_DUTCH_AUCTION_LIFETIME;
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

    function _hasFeasibleCurveMigration(MigratingBondingCurve.CreateParams memory params) internal pure returns (bool) {
        uint256 linearQuote = FixedPointMathLib.fullMulDivUp(params.basePrice, params.saleSupply, WAD);
        uint256 slopeNumerator = params.saleSupply * params.saleSupply;
        uint256 slopeQuote = FixedPointMathLib.fullMulDivUp(params.slope, slopeNumerator, 2 * WAD * WAD);
        uint256 fullSaleQuote = linearQuote + slopeQuote;
        uint256 quoteToLiquidity = FixedPointMathLib.fullMulDiv(fullSaleQuote, params.quoteToLpBps, BPS);
        uint256 terminalPrice = params.basePrice + FixedPointMathLib.fullMulDiv(params.slope, params.saleSupply, WAD);
        uint256 sharesToLiquidity = FixedPointMathLib.fullMulDiv(quoteToLiquidity, WAD, terminalPrice);
        uint256 minimumShares = FixedPointMathLib.fullMulDivUp(sharesToLiquidity, MINIMUM_MIGRATION_FILL_BPS, BPS);
        uint256 minimumQuote = FixedPointMathLib.fullMulDivUp(quoteToLiquidity, MINIMUM_MIGRATION_FILL_BPS, BPS);
        return sharesToLiquidity != 0 && sharesToLiquidity <= params.migrationSupply
            && sharesToLiquidity <= type(uint112).max && quoteToLiquidity != 0 && quoteToLiquidity <= type(uint112).max
            && FixedPointMathLib.sqrt(minimumShares * minimumQuote) > AMM_MINIMUM_LIQUIDITY;
    }

    function _requireAsset(address asset) internal view {
        if (!_isAsset(asset)) revert InvalidAsset(asset);
    }

    function _isAsset(address asset) internal view returns (bool) {
        (bool readable,) = BestEffortTokenLib.tryBalanceOf(asset, address(this));
        return readable;
    }

    function _isCreateDistributionSelector(bytes4 selector) internal pure returns (bool) {
        return selector == DistributionFactory.createFixedPriceSale.selector
            || selector == DistributionFactory.createMigratingBondingCurve.selector
            || selector == DistributionFactory.createMerkleAirdrop.selector
            || selector == DistributionFactory.createDutchAuction.selector;
    }

    function _isFixedPriceSaleLifecycleSelector(bytes4 selector) internal pure returns (bool) {
        return selector == FixedPriceSale.close.selector || selector == FixedPriceSale.cancel.selector;
    }

    function _isMigratingBondingCurveLifecycleSelector(bytes4 selector) internal pure returns (bool) {
        return selector == MigratingBondingCurve.cancel.selector;
    }

    function _isMerkleAirdropLifecycleSelector(bytes4 selector) internal pure returns (bool) {
        return selector == MerkleAirdrop.close.selector || selector == MerkleAirdrop.cancel.selector;
    }

    function _isDutchAuctionLifecycleSelector(bytes4 selector) internal pure returns (bool) {
        return selector == DutchAuctionSale.close.selector || selector == DutchAuctionSale.cancel.selector;
    }

    function _requireBoardroomShareToken(address boardroom, address shareToken) internal view {
        try IDistributionBoardroomFactory(boardroomFactory).isBoardroom(boardroom) returns (bool canonical) {
            if (!canonical) revert InvalidBoardroom(boardroom);
        } catch {
            revert InvalidBoardroom(boardroom);
        }
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
