// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "solady/tokens/ERC20.sol";
import {WETH} from "solady/tokens/WETH.sol";
import {AmmFactory} from "../../src/amm/AmmFactory.sol";
import {AmmPool} from "../../src/amm/AmmPool.sol";
import {AmmRouter} from "../../src/amm/AmmRouter.sol";
import {AssetPolicy} from "../../src/policy/AssetPolicy.sol";
import {Boardroom} from "../../src/boardroom/Boardroom.sol";
import {BoardroomFactory} from "../../src/boardroom/BoardroomFactory.sol";
import {BoardroomGovernanceLogic} from "../../src/boardroom/BoardroomGovernanceLogic.sol";
import {BoardroomPolicyRegistry} from "../../src/boardroom/BoardroomPolicyRegistry.sol";
import {BoardroomRedemptionPayout} from "../../src/boardroom/BoardroomRedemptionPayout.sol";
import {BoardroomToken} from "../../src/boardroom/BoardroomToken.sol";
import {BondMarket} from "../../src/bonds/BondMarket.sol";
import {BondMarketFactory} from "../../src/bonds/BondMarketFactory.sol";

contract BondTestToken is ERC20 {
    string internal tokenName;
    string internal tokenSymbol;
    uint8 internal tokenDecimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) {
        tokenName = name_;
        tokenSymbol = symbol_;
        tokenDecimals = decimals_;
    }

    function name() public view override returns (string memory) {
        return tokenName;
    }

    function symbol() public view override returns (string memory) {
        return tokenSymbol;
    }

    function decimals() public view override returns (uint8) {
        return tokenDecimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract BondFeeToken {
    string public constant name = "Fee Token";
    string public constant symbol = "FEE";
    uint8 public constant decimals = 6;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        uint256 fee = amount / 100;
        balanceOf[from] -= amount;
        balanceOf[to] += amount - fee;
        totalSupply -= fee;
    }
}

contract BondMarketTest is Test {
    BoardroomPolicyRegistry internal policyRegistry;
    AssetPolicy internal assetPolicy;
    BoardroomFactory internal boardroomFactory;
    AmmFactory internal ammFactory;
    AmmRouter internal ammRouter;
    BondMarketFactory internal bondMarketFactory;
    Boardroom internal boardroom;
    BoardroomToken internal shareToken;
    BondTestToken internal quoteToken;

    address internal owner = address(0xA11CE);
    address internal buyer = address(0xB0B);
    address internal keeper = address(0xC0FFEE);

    uint256 internal constant CAPACITY = 1_000 ether;
    uint256 internal constant INITIAL_PRICE = 2_000000;
    uint256 internal constant MINIMUM_PRICE = 1_000000;

    function setUp() public {
        WETH wrappedNative = new WETH();
        policyRegistry = new BoardroomPolicyRegistry(address(this));
        assetPolicy = new AssetPolicy(address(this), address(wrappedNative));
        boardroomFactory = new BoardroomFactory(
            address(policyRegistry),
            address(wrappedNative),
            address(new BoardroomRedemptionPayout()),
            address(new BoardroomGovernanceLogic())
        );
        ammFactory = new AmmFactory(address(this), address(boardroomFactory));
        ammRouter = new AmmRouter(address(ammFactory), address(wrappedNative));
        ammFactory.setLiquidityRouter(address(ammRouter));
        ammFactory.setReservationManager(address(this));
        bondMarketFactory = new BondMarketFactory(address(ammFactory), address(boardroomFactory));
        quoteToken = new BondTestToken("USD Coin", "USDC", 6);

        policyRegistry.setPolicyAllowed(address(assetPolicy), true);
        policyRegistry.registerModulePolicy(address(bondMarketFactory));
        assetPolicy.setApprovalSpenderAllowed(address(bondMarketFactory), true);

        boardroom = Boardroom(
            payable(boardroomFactory.createBoardroom(owner, "Bond Boardroom", "BOND", keccak256("bond-boardroom")))
        );
        shareToken = BoardroomToken(boardroom.shareToken());
        assetPolicy.setAssetAllowed(address(shareToken), true);
        quoteToken.mint(buyer, 10_000_000000);
    }

    function testBoardroomCreatesPrefundedReserveMarketAndRecordsObligation() public {
        BondMarket market = _createReserveMarket(address(quoteToken), keccak256("reserve-market"));

        assertEq(market.boardroom(), address(boardroom));
        assertEq(market.shareToken(), address(shareToken));
        assertEq(market.quoteToken(), address(quoteToken));
        assertEq(uint256(market.marketKind()), uint256(BondMarket.MarketKind.Reserve));
        assertEq(shareToken.balanceOf(address(market)), CAPACITY);
        assertEq(market.capacity(), CAPACITY);
        assertEq(bondMarketFactory.bondMarketCountForBoardroom(address(boardroom)), 1);
        assertEq(boardroom.issuedDistributionCount(), 1);
        assertEq(boardroom.issuedDistributionAt(0), address(market));
        assertEq(boardroom.obligationPolicyOf(address(market)), address(bondMarketFactory));
        assertTrue(boardroom.isRedeemableAsset(address(quoteToken)));
        assertTrue(shareToken.isEncumberedAccount(address(market)));
        assertEq(shareToken.encumberedSupply(), CAPACITY);
    }

    function testPurchaseCreatesImmutablePositionAndPermissionlessRedemptionPaysOwner() public {
        BondMarket market = _createReserveMarket(address(quoteToken), keccak256("purchase-market"));
        uint256 quoteAmount = 100_000000;
        uint256 quotedPayout = market.payoutFor(quoteAmount);
        assertApproxEqAbs(quotedPayout, 50 ether, 1, "six-decimal quote price must pay eighteen-decimal shares");

        vm.startPrank(buyer);
        quoteToken.approve(address(market), quoteAmount);
        (uint256 positionId, uint256 payout, uint256 price) =
            market.purchase(quoteAmount, quotedPayout, block.timestamp);
        vm.stopPrank();

        assertEq(positionId, 0);
        assertEq(payout, quotedPayout);
        assertGe(price, MINIMUM_PRICE);
        assertEq(quoteToken.balanceOf(address(boardroom)), quoteAmount);
        assertEq(market.outstandingPayout(), payout);

        (address positionOwner, uint256 positionPayout, uint48 maturity, bool redeemed) = market.positions(positionId);
        assertEq(positionOwner, buyer);
        assertEq(positionPayout, payout);
        assertEq(maturity, block.timestamp + 7 days);
        assertFalse(redeemed);

        vm.expectRevert(abi.encodeWithSelector(BondMarket.PositionNotMature.selector, positionId, maturity));
        market.redeem(positionId);

        vm.warp(maturity);
        vm.prank(keeper);
        market.redeem(positionId);

        assertEq(shareToken.balanceOf(buyer), payout);
        assertEq(shareToken.balanceOf(keeper), 0);
        assertEq(market.outstandingPayout(), 0);
        (positionOwner, positionPayout, maturity, redeemed) = market.positions(positionId);
        assertEq(positionOwner, buyer);
        assertTrue(redeemed);

        vm.expectRevert(abi.encodeWithSelector(BondMarket.PositionAlreadyRedeemed.selector, positionId));
        market.redeem(positionId);
    }

    function testDemandRaisesPriceAndInactivityDecaysToFloor() public {
        BondMarket market = _createReserveMarket(address(quoteToken), keccak256("price-market"));
        uint256 beforePurchase = market.marketPrice();

        vm.startPrank(buyer);
        quoteToken.approve(address(market), 20_000000);
        market.purchase(20_000000, 0, block.timestamp);
        vm.stopPrank();

        assertGt(market.marketPrice(), beforePurchase);
        vm.warp(block.timestamp + 4 days);
        assertEq(market.marketPrice(), MINIMUM_PRICE);
    }

    function testPurchaseAfterFullDebtDecayReanchorsNewDemandAtCurrentTime() public {
        BondMarket market = _createReserveMarket(address(quoteToken), keccak256("reanchor-market"));
        vm.warp(block.timestamp + 6 days);
        assertEq(market.currentDebt(), 0);
        assertEq(market.marketPrice(), MINIMUM_PRICE);

        vm.startPrank(buyer);
        quoteToken.approve(address(market), 20_000000);
        market.purchase(20_000000, 0, block.timestamp);
        vm.stopPrank();

        assertGt(market.currentDebt(), 0, "fresh demand must not inherit a fully decayed timestamp");
        (, uint48 lastDecay,,,,,,,) = market.metadata();
        assertGt(lastDecay, block.timestamp, "new demand must advance decay from the purchase time");
    }

    function testSdaReferenceVectorUsesFiveDepositIntervalsForDebtDecay() public {
        BondMarket market = _createReserveMarket(address(quoteToken), keccak256("reference-market"));
        assertApproxEqAbs(market.marketPrice(), INITIAL_PRICE, 1);

        vm.warp(block.timestamp + 1 days);
        assertApproxEqAbs(market.marketPrice(), 1_600000, 2);

        vm.warp(block.timestamp + 4 days);
        assertEq(market.marketPrice(), MINIMUM_PRICE);
    }

    function testFuzzPurchasePreservesPrefundedAccounting(uint96 rawQuoteAmount) public {
        BondMarket market = _createReserveMarket(address(quoteToken), keccak256("fuzz-market"));
        uint256 quoteAmount = bound(uint256(rawQuoteAmount), 1, market.maxAmountAccepted());

        vm.startPrank(buyer);
        quoteToken.approve(address(market), quoteAmount);
        (, uint256 payout,) = market.purchase(quoteAmount, 0, block.timestamp);
        vm.stopPrank();

        assertEq(market.initialCapacity(), market.capacity() + market.sold() + market.returnedPayout());
        assertEq(market.sold(), payout);
        assertEq(market.outstandingPayout(), payout);
        assertEq(shareToken.balanceOf(address(market)), market.capacity() + market.outstandingPayout());
        assertEq(quoteToken.balanceOf(address(boardroom)), quoteAmount);
    }

    function testCloseReturnsOnlyUnsoldCapacityAndWaitsForOutstandingPosition() public {
        BondMarket market = _createReserveMarket(address(quoteToken), keccak256("close-market"));

        vm.startPrank(buyer);
        quoteToken.approve(address(market), 100_000000);
        (uint256 positionId, uint256 payout,) = market.purchase(100_000000, 0, block.timestamp);
        vm.stopPrank();

        vm.prank(owner);
        boardroom.execute(
            _policyCall(address(bondMarketFactory), address(market), 0, abi.encodeCall(BondMarket.close, ()))
        );

        assertEq(market.capacity(), 0);
        assertEq(market.returnedPayout(), CAPACITY - payout);
        assertEq(shareToken.balanceOf(address(market)), payout);
        assertFalse(market.isClosed());
        assertEq(boardroom.issuedDistributionCount(), 1);

        (,, uint48 maturity,) = market.positions(positionId);
        vm.warp(maturity);
        market.redeem(positionId);
        assertTrue(market.isClosed());

        boardroom.pruneClosedObligations();
        assertEq(boardroom.issuedDistributionCount(), 0);
        assertEq(bondMarketFactory.pruneClosedBondMarkets(address(boardroom)), 1);
    }

    function testAnyoneCanFinalizeElapsedMarket() public {
        BondMarket market = _createReserveMarket(address(quoteToken), keccak256("finalize-market"));
        vm.warp(market.conclusion());

        vm.prank(keeper);
        uint256 returned = market.finalize();

        assertEq(returned, CAPACITY);
        assertTrue(market.isClosed());
        assertEq(shareToken.balanceOf(address(boardroom)), CAPACITY);
    }

    function testFeeOnTransferQuoteIsRejectedAtomically() public {
        BondFeeToken feeToken = new BondFeeToken();
        feeToken.mint(buyer, 1_000_000000);
        BondMarket market = _createReserveMarket(address(feeToken), keccak256("fee-market"));

        vm.startPrank(buyer);
        feeToken.approve(address(market), 100_000000);
        vm.expectRevert(
            abi.encodeWithSelector(
                BondMarket.UnexpectedTokenBalanceChange.selector, address(feeToken), 100_000000, 99_000000
            )
        );
        market.purchase(100_000000, 0, block.timestamp);
        vm.stopPrank();

        assertEq(market.sold(), 0);
        assertEq(market.outstandingPayout(), 0);
        assertEq(market.nextPositionId(), 0);
    }

    function testPolicyRejectsUnregisteredLiquidityToken() public view {
        BondMarket.CreateParams memory params = _params(address(quoteToken), keccak256("not-lp"));
        params.kind = BondMarket.MarketKind.Liquidity;
        assertFalse(
            bondMarketFactory.canCall(
                address(boardroom),
                owner,
                address(bondMarketFactory),
                0,
                abi.encodeCall(BondMarketFactory.createBondMarket, (params))
            )
        );
    }

    function testPolicyRejectsDepositIntervalThatWouldOverflowDebtDecay() public view {
        BondMarket.CreateParams memory params = _params(address(quoteToken), keccak256("overflowing-decay"));
        params.duration = type(uint32).max;
        params.depositInterval = type(uint32).max / 5 + 1;

        assertFalse(
            bondMarketFactory.canCall(
                address(boardroom),
                owner,
                address(bondMarketFactory),
                0,
                abi.encodeCall(BondMarketFactory.createBondMarket, (params))
            )
        );
    }

    function testBoardroomCreatesLiquidityBondForFundedCanonicalSharePool() public {
        BondTestToken pairedToken = new BondTestToken("Paired Asset", "PAIR", 18);
        vm.prank(owner);
        boardroom.mint(owner, 1_000 ether);
        pairedToken.mint(owner, 1_000 ether);

        address pool =
            ammFactory.reserveInitialLiquidity(address(shareToken), address(pairedToken), owner, owner, owner);
        vm.startPrank(owner);
        shareToken.approve(address(ammRouter), 500 ether);
        pairedToken.approve(address(ammRouter), 500 ether);
        (,, uint256 liquidity) = ammRouter.addLiquidity(
            address(shareToken),
            address(pairedToken),
            500 ether,
            500 ether,
            500 ether,
            500 ether,
            owner,
            block.timestamp
        );
        assertTrue(AmmPool(pool).transfer(address(boardroom), liquidity));
        vm.stopPrank();

        assetPolicy.setAssetAllowed(pool, true);
        BondMarket.CreateParams memory params = _params(pool, keccak256("lp-market"));
        params.kind = BondMarket.MarketKind.Liquidity;
        BondMarket market = _createMarket(params);

        assertEq(uint256(market.marketKind()), uint256(BondMarket.MarketKind.Liquidity));
        assertEq(market.quoteToken(), pool);
        assertEq(AmmPool(pool).balanceOf(address(boardroom)), liquidity);
        assertTrue(boardroom.isRedeemableAsset(pool));
    }

    function testRejectsTransferableReceiptSelectors() public {
        BondMarket market = _createReserveMarket(address(quoteToken), keccak256("no-transfer-market"));
        (bool transferSuccess,) =
            address(market).call(abi.encodeWithSignature("transferFrom(address,address,uint256)", buyer, keeper, 0));
        (bool approvalSuccess,) =
            address(market).call(abi.encodeWithSignature("setApprovalForAll(address,bool)", keeper, true));

        assertFalse(transferSuccess);
        assertFalse(approvalSuccess);
    }

    function _createReserveMarket(address quote, bytes32 salt) internal returns (BondMarket market) {
        BondMarket.CreateParams memory params = _params(quote, salt);
        return _createMarket(params);
    }

    function _createMarket(BondMarket.CreateParams memory params) internal returns (BondMarket market) {
        vm.startPrank(owner);
        boardroom.mint(address(boardroom), CAPACITY);

        Boardroom.Call[] memory calls = new Boardroom.Call[](2);
        calls[0] = _policyCall(
            address(assetPolicy),
            address(shareToken),
            0,
            abi.encodeWithSignature("approve(address,uint256)", address(bondMarketFactory), CAPACITY)
        );
        calls[1] = _policyCall(
            address(bondMarketFactory),
            address(bondMarketFactory),
            0,
            abi.encodeCall(BondMarketFactory.createBondMarket, (params))
        );
        bytes[] memory results = boardroom.executeBatch(calls);
        vm.stopPrank();

        market = BondMarket(abi.decode(results[1], (address)));
        assertEq(address(market), bondMarketFactory.predictBondMarketAddress(address(boardroom), params.salt));
    }

    function _params(address quote, bytes32 salt) internal pure returns (BondMarket.CreateParams memory params) {
        params = BondMarket.CreateParams({
            quoteToken: quote,
            kind: BondMarket.MarketKind.Reserve,
            capacity: CAPACITY,
            initialPrice: INITIAL_PRICE,
            minimumPrice: MINIMUM_PRICE,
            debtBuffer: 25_000,
            vesting: 7 days,
            start: 0,
            duration: 10 days,
            depositInterval: 1 days,
            salt: salt
        });
    }

    function _policyCall(address policy, address target, uint256 value, bytes memory data)
        internal
        pure
        returns (Boardroom.Call memory call_)
    {
        call_ = Boardroom.Call({policy: policy, target: target, value: value, data: data});
    }
}
