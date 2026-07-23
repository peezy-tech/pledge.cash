// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {LibClone} from "solady/utils/LibClone.sol";
import {BondMarket} from "./BondMarket.sol";
import {BestEffortTokenLib} from "../lib/BestEffortTokenLib.sol";
import {ExactTransferLib} from "../lib/ExactTransferLib.sol";
import {IBoardroomObligationPolicy} from "../policy/IBoardroomObligationPolicy.sol";

interface IBondMarketFactoryBoardroom {
    function shareToken() external view returns (address);
    function reserveRedeemableAsset(address asset) external;
}

interface IBondMarketFactoryBoardroomFactory {
    function isBoardroom(address boardroom) external view returns (bool);
}

interface IBondMarketFactoryAmmFactory {
    function isPool(address pool) external view returns (bool);
}

interface IBondMarketFactoryPool {
    function tokens() external view returns (address token0, address token1);
    function totalSupply() external view returns (uint256);
}

contract BondMarketFactory is IBoardroomObligationPolicy {
    uint256 internal constant CREATE_DATA_LENGTH = 4 + 32 * 11;
    uint256 public constant MAX_DISCOVERY_PAGE = 100;

    address public immutable ammFactory;
    address public immutable boardroomFactory;
    address public immutable bondMarketLogic;

    mapping(address => bool) public isBondMarket;
    mapping(address => address) public marketBoardroom;
    mapping(address => BondMarket.MarketKind) public marketKind;
    mapping(address => address[]) internal marketsForBoardroom;

    error InvalidAddress();
    error InvalidBoardroom(address boardroom);
    error InvalidQuoteToken(address quoteToken);
    error InvalidLiquidityPool(address pool);
    error InvalidDiscoveryPage(uint256 requested, uint256 maximum);
    error UnexpectedTokenBalanceChange(address token, uint256 expected, uint256 actual);

    event BondMarketCreated(
        address indexed market,
        address indexed boardroom,
        BondMarket.MarketKind indexed kind,
        address shareToken,
        address quoteToken,
        uint256 capacity,
        bytes32 salt
    );

    constructor(address ammFactory_, address boardroomFactory_) {
        if (
            ammFactory_ == address(0) || ammFactory_.code.length == 0 || boardroomFactory_ == address(0)
                || boardroomFactory_.code.length == 0
        ) revert InvalidAddress();

        ammFactory = ammFactory_;
        boardroomFactory = boardroomFactory_;
        bondMarketLogic = address(new BondMarket());
    }

    function createBondMarket(BondMarket.CreateParams calldata params) external returns (address market) {
        address boardroom = msg.sender;
        if (!IBondMarketFactoryBoardroomFactory(boardroomFactory).isBoardroom(boardroom)) {
            revert InvalidBoardroom(boardroom);
        }

        address shareToken = IBondMarketFactoryBoardroom(boardroom).shareToken();
        _validateQuoteToken(params.quoteToken, shareToken, params.kind);
        IBondMarketFactoryBoardroom(boardroom).reserveRedeemableAsset(params.quoteToken);

        market = LibClone.cloneDeterministic(bondMarketLogic, _cloneSalt(boardroom, params.salt));
        isBondMarket[market] = true;
        marketBoardroom[market] = boardroom;
        marketKind[market] = params.kind;
        marketsForBoardroom[boardroom].push(market);

        BondMarket(market).initialize(boardroom, shareToken, params);
        _checkedTransferFrom(shareToken, boardroom, market, params.capacity);

        emit BondMarketCreated(
            market, boardroom, params.kind, shareToken, params.quoteToken, params.capacity, params.salt
        );
    }

    function canCall(address boardroom, address, address target, uint256 value, bytes calldata data)
        external
        view
        returns (bool)
    {
        if (value != 0) return false;
        bytes4 selector = _selector(data);
        if (target == address(this)) {
            if (selector != BondMarketFactory.createBondMarket.selector || data.length != CREATE_DATA_LENGTH) {
                return false;
            }
            if (!IBondMarketFactoryBoardroomFactory(boardroomFactory).isBoardroom(boardroom)) return false;
            BondMarket.CreateParams memory params = abi.decode(data[4:], (BondMarket.CreateParams));
            return _canCreate(boardroom, params);
        }

        return marketBoardroom[target] == boardroom
            && (selector == BondMarket.close.selector || selector == BondMarket.finalize.selector);
    }

    function obligationForCall(address, address target, uint256, bytes calldata data, bytes calldata result)
        external
        view
        returns (Obligation memory obligation)
    {
        if (
            target != address(this) || _selector(data) != BondMarketFactory.createBondMarket.selector
                || result.length != 32
        ) return obligation;

        address market = abi.decode(result, (address));
        if (!isBondMarket[market]) return obligation;
        obligation.kind = ObligationKind.Distribution;
        obligation.account = market;
    }

    function isLifecycleCallAllowed(address boardroom, address target, bytes4 selector) external view returns (bool) {
        return marketBoardroom[target] == boardroom
            && (selector == BondMarket.close.selector || selector == BondMarket.finalize.selector);
    }

    function bondMarketCountForBoardroom(address boardroom) external view returns (uint256) {
        return marketsForBoardroom[boardroom].length;
    }

    function bondMarketForBoardroomAt(address boardroom, uint256 index) external view returns (address) {
        return marketsForBoardroom[boardroom][index];
    }

    function bondMarketPageForBoardroom(address boardroom, uint256 cursor, uint256 size)
        external
        view
        returns (address[] memory page, uint256 nextCursor)
    {
        if (size == 0 || size > MAX_DISCOVERY_PAGE) revert InvalidDiscoveryPage(size, MAX_DISCOVERY_PAGE);
        address[] storage markets = marketsForBoardroom[boardroom];
        uint256 length = markets.length;
        if (cursor >= length) return (new address[](0), length);
        uint256 end = cursor + size;
        if (end > length) end = length;
        page = new address[](end - cursor);
        for (uint256 i; i < page.length; ++i) {
            page[i] = markets[cursor + i];
        }
        nextCursor = end;
    }

    function predictBondMarketAddress(address boardroom, bytes32 salt) external view returns (address) {
        return LibClone.predictDeterministicAddress(bondMarketLogic, _cloneSalt(boardroom, salt), address(this));
    }

    function _canCreate(address boardroom, BondMarket.CreateParams memory params) internal view returns (bool) {
        address shareToken;
        try IBondMarketFactoryBoardroom(boardroom).shareToken() returns (address token) {
            shareToken = token;
        } catch {
            return false;
        }

        if (!_isValidQuoteToken(params.quoteToken, shareToken, params.kind)) return false;
        if (params.capacity == 0 || params.minimumPrice == 0 || params.initialPrice < params.minimumPrice) {
            return false;
        }
        if (params.debtBuffer < 10_000) return false;
        if (params.duration < 1 days || params.depositInterval < 1 hours || params.depositInterval > params.duration) {
            return false;
        }
        if (params.depositInterval > type(uint32).max / 5) return false;
        if (params.vesting < 1 days || params.vesting > 52 weeks * 50) return false;
        if (params.start != 0 && params.start < block.timestamp) return false;
        return uint256(params.start == 0 ? block.timestamp : params.start) + params.duration <= type(uint48).max;
    }

    function _validateQuoteToken(address quoteToken, address shareToken, BondMarket.MarketKind kind) internal view {
        if (!_isValidQuoteToken(quoteToken, shareToken, kind)) {
            if (kind == BondMarket.MarketKind.Liquidity) revert InvalidLiquidityPool(quoteToken);
            revert InvalidQuoteToken(quoteToken);
        }
    }

    function _isValidQuoteToken(address quoteToken, address shareToken, BondMarket.MarketKind kind)
        internal
        view
        returns (bool)
    {
        if (quoteToken == address(0) || quoteToken == shareToken) return false;
        (bool readable,) = BestEffortTokenLib.tryBalanceOf(quoteToken, address(this));
        if (!readable) return false;

        bool pool = IBondMarketFactoryAmmFactory(ammFactory).isPool(quoteToken);
        if (kind == BondMarket.MarketKind.Reserve) return !pool;
        if (!pool) return false;

        try IBondMarketFactoryPool(quoteToken).tokens() returns (address token0, address token1) {
            if (token0 != shareToken && token1 != shareToken) return false;
        } catch {
            return false;
        }

        try IBondMarketFactoryPool(quoteToken).totalSupply() returns (uint256 supply) {
            return supply > 1_000;
        } catch {
            return false;
        }
    }

    function _checkedTransferFrom(address token, address from, address to, uint256 expectedAmount) internal {
        ExactTransferLib.ExactDelta memory delta = ExactTransferLib.pullBetween(token, from, to, expectedAmount);
        if (delta.senderBalanceIncreased || delta.recipientBalanceDecreased) {
            revert UnexpectedTokenBalanceChange(token, expectedAmount, 0);
        }
        if (delta.senderSpent != expectedAmount) {
            revert UnexpectedTokenBalanceChange(token, expectedAmount, delta.senderSpent);
        }
        if (delta.recipientReceived != expectedAmount) {
            revert UnexpectedTokenBalanceChange(token, expectedAmount, delta.recipientReceived);
        }
    }

    function _cloneSalt(address boardroom, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encode(boardroom, salt));
    }

    function _selector(bytes calldata data) internal pure returns (bytes4 selector) {
        if (data.length < 4) return bytes4(0);
        return bytes4(data[:4]);
    }
}
