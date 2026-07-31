// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "solady/tokens/ERC20.sol";
import {WETH} from "solady/tokens/WETH.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {AssetPolicy} from "../../src/policy/AssetPolicy.sol";
import {IBoardroom} from "../../src/boardroom/IBoardroom.sol";
import {BoardroomFacetTypes as Boardroom} from "../../src/boardroom/diamond/BoardroomFacetTypes.sol";
import {BoardroomFactory} from "../../src/boardroom/BoardroomFactory.sol";
import {BoardroomGovernanceLogic} from "../../src/boardroom/BoardroomGovernanceLogic.sol";
import {BoardroomPolicyRegistry} from "../../src/boardroom/BoardroomPolicyRegistry.sol";
import {BoardroomRedemptionPayout} from "../../src/boardroom/BoardroomRedemptionPayout.sol";
import {BoardroomToken} from "../../src/boardroom/BoardroomToken.sol";
import {BondMarket} from "../../src/bonds/BondMarket.sol";
import {BondMarketFactory} from "../../src/bonds/BondMarketFactory.sol";
import {PledgeV4LiquidityFactory} from "../../src/uniswap/PledgeV4LiquidityFactory.sol";
import {PledgeV4LiquidityVault} from "../../src/uniswap/PledgeV4LiquidityVault.sol";
import {CanonicalBoardroomTestSetup} from "../helpers/CanonicalBoardroomTestSetup.sol";
import {V4PoolManagerMock} from "../helpers/V4PoolManagerMock.sol";

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

contract BondProtocolFeeRecipient {}

contract BondMarketTest is CanonicalBoardroomTestSetup {
    BoardroomPolicyRegistry internal policyRegistry;
    AssetPolicy internal assetPolicy;
    BoardroomFactory internal boardroomFactory;
    V4PoolManagerMock internal poolManager;
    PledgeV4LiquidityFactory internal liquidityFactory;
    BondMarketFactory internal bondMarketFactory;
    IBoardroom internal boardroom;
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
        boardroomFactory = _deployCanonicalBoardroomFactory(policyRegistry, address(wrappedNative));
        poolManager = new V4PoolManagerMock();
        BondProtocolFeeRecipient feeRecipient = new BondProtocolFeeRecipient();
        liquidityFactory = new PledgeV4LiquidityFactory(
            IPoolManager(address(poolManager)), address(boardroomFactory), address(feeRecipient), address(this)
        );
        liquidityFactory.deployHook(_mineHookSalt());
        bondMarketFactory = new BondMarketFactory(address(liquidityFactory), address(boardroomFactory));
        quoteToken = new BondTestToken("USD Coin", "USDC", 6);

        policyRegistry.setPolicyAllowed(address(assetPolicy), true);
        policyRegistry.registerModulePolicy(address(liquidityFactory));
        policyRegistry.registerModulePolicy(address(bondMarketFactory));
        assetPolicy.setApprovalSpenderAllowed(address(liquidityFactory), true);
        assetPolicy.setApprovalSpenderAllowed(address(bondMarketFactory), true);

        boardroom =
            _createCanonicalBoardroom(boardroomFactory, owner, "Bond Boardroom", "BOND", keccak256("bond-boardroom"));
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
        assertTrue(boardroom.isIssuedDistribution(address(market)));
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
            _expectedFacetSetHash(boardroom),
            _policyCall(address(bondMarketFactory), address(market), 0, abi.encodeCall(BondMarket.close, ()))
        );

        assertEq(market.capacity(), 0);
        assertEq(market.returnedPayout(), CAPACITY - payout);
        assertEq(shareToken.balanceOf(address(market)), payout);
        assertFalse(market.isClosed());
        assertTrue(boardroom.isIssuedDistribution(address(market)));

        (,, uint48 maturity,) = market.positions(positionId);
        vm.warp(maturity);
        market.redeem(positionId);
        assertTrue(market.isClosed());

        boardroom.pruneObligation(_expectedFacetSetHash(boardroom), address(market));
        assertFalse(boardroom.isIssuedDistribution(address(market)));
        assertEq(bondMarketFactory.bondMarketCountForBoardroom(address(boardroom)), 1);
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
        assetPolicy.setAssetAllowed(address(pairedToken), true);
        vm.startPrank(owner);
        boardroom.mint(_expectedFacetSetHash(boardroom), address(boardroom), 500 ether);
        pairedToken.mint(address(boardroom), 500 ether);
        PledgeV4LiquidityFactory.CreateParams memory liquidityParams = PledgeV4LiquidityFactory.CreateParams({
            tokenA: address(shareToken),
            tokenB: address(pairedToken),
            amountADesired: 500 ether,
            amountBDesired: 500 ether,
            amountAMin: 475 ether,
            amountBMin: 475 ether,
            sqrtPriceX96: 1 << 96,
            deadline: block.timestamp,
            salt: keccak256("lp-market-vault")
        });
        Boardroom.Call[] memory liquidityCalls = new Boardroom.Call[](3);
        liquidityCalls[0] = _policyCall(
            address(assetPolicy),
            address(shareToken),
            0,
            abi.encodeWithSignature("approve(address,uint256)", address(liquidityFactory), 500 ether)
        );
        liquidityCalls[1] = _policyCall(
            address(assetPolicy),
            address(pairedToken),
            0,
            abi.encodeWithSignature("approve(address,uint256)", address(liquidityFactory), 500 ether)
        );
        liquidityCalls[2] = _policyCall(
            address(liquidityFactory),
            address(liquidityFactory),
            0,
            abi.encodeCall(PledgeV4LiquidityFactory.createProtocolLiquidity, (liquidityParams))
        );
        bytes[] memory results = boardroom.executeBatch(_expectedFacetSetHash(boardroom), liquidityCalls);
        (address vaultAddress,,,,) = abi.decode(results[2], (address, bytes32, uint256, uint256, uint256));
        PledgeV4LiquidityVault vault = PledgeV4LiquidityVault(vaultAddress);

        boardroom.mint(_expectedFacetSetHash(boardroom), owner, 100 ether);
        pairedToken.mint(owner, 100 ether);
        shareToken.approve(vaultAddress, 100 ether);
        pairedToken.approve(vaultAddress, 100 ether);
        (,, uint128 liquidity) =
            vault.depositLiquidityForClaims(100 ether, 100 ether, 95 ether, 95 ether, owner, block.timestamp);
        assertTrue(vault.transfer(address(boardroom), liquidity));
        vm.stopPrank();

        assetPolicy.setAssetAllowed(vaultAddress, true);
        BondMarket.CreateParams memory params = _params(vaultAddress, keccak256("lp-market"));
        params.kind = BondMarket.MarketKind.Liquidity;
        BondMarket market = _createMarket(params);

        assertEq(uint256(market.marketKind()), uint256(BondMarket.MarketKind.Liquidity));
        assertEq(market.quoteToken(), vaultAddress);
        assertEq(vault.balanceOf(address(boardroom)), liquidity);
        assertTrue(boardroom.isRedeemableAsset(vaultAddress));
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
        boardroom.mint(_expectedFacetSetHash(boardroom), address(boardroom), CAPACITY);

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
        bytes[] memory results = boardroom.executeBatch(_expectedFacetSetHash(boardroom), calls);
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

    function _mineHookSalt() internal view returns (bytes32 salt) {
        for (uint256 candidate; candidate < 100_000; ++candidate) {
            salt = bytes32(candidate);
            if (uint160(liquidityFactory.predictHookAddress(salt)) & ((1 << 14) - 1) == (1 << 13)) return salt;
        }
        revert("hook salt");
    }

    function _policyCall(address policy, address target, uint256 value, bytes memory data)
        internal
        pure
        returns (Boardroom.Call memory call_)
    {
        call_ = Boardroom.Call({policy: policy, target: target, value: value, data: data});
    }
}
