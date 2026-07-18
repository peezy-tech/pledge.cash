// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {AmmFactory} from "../src/amm/AmmFactory.sol";
import {AmmPool} from "../src/amm/AmmPool.sol";
import {AmmRouter} from "../src/amm/AmmRouter.sol";
import {AssetPolicy} from "../src/policy/AssetPolicy.sol";
import {Boardroom} from "../src/boardroom/Boardroom.sol";
import {BoardroomFactory} from "../src/boardroom/BoardroomFactory.sol";
import {BoardroomToken} from "../src/boardroom/BoardroomToken.sol";
import {DistributionFactory} from "../src/distribution/DistributionFactory.sol";
import {FixedPriceSale} from "../src/distribution/FixedPriceSale.sol";
import {LockedLiquidity} from "../src/liquidity/LockedLiquidity.sol";
import {MigratingBondingCurve} from "../src/distribution/MigratingBondingCurve.sol";
import {TokenGrant} from "../src/grants/TokenGrant.sol";
import {TokenGrantFactory} from "../src/grants/TokenGrantFactory.sol";
import {BoardroomRewards} from "../src/rewards/BoardroomRewards.sol";
import {BoardroomRewardsFactory} from "../src/rewards/BoardroomRewardsFactory.sol";

contract SeedToken {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) {
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract SeedLocal is Script {
    using stdJson for string;

    error ScenarioInvariantFailed(string label);

    uint256 internal constant DEPLOYER_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 internal constant ISSUER_KEY = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    uint256 internal constant HOLDER_KEY = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;
    uint256 internal constant NEW_HOLDER_KEY = 0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6;
    uint256 internal constant BOARDROOM_OWNER_KEY = 0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a;
    uint256 internal constant CONTRACTOR_KEY = 0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba;
    uint256 internal constant INVESTOR_KEY = 0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e;

    uint256 internal constant DAY = 1 days;
    uint256 internal constant PLEDGE = 1 ether;
    uint256 internal constant CASH = 1e6;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant FEE_INDEX_SCALE = 1e18;
    uint256 internal constant BOARDROOM_TREASURY_SHARES = 12_000 * PLEDGE;
    uint256 internal constant CURVE_SALE_SUPPLY = 4_000 * PLEDGE;
    uint256 internal constant CURVE_MIGRATION_SUPPLY = 2_000 * PLEDGE;
    uint256 internal constant CURVE_BUYER_ONE_SHARES = 1_250 * PLEDGE;
    uint256 internal constant CURVE_BUYER_TWO_SHARES = 1_750 * PLEDGE;
    uint256 internal constant CURVE_BASE_PRICE = 2 * CASH;
    uint256 internal constant CURVE_SLOPE = 1;
    uint256 internal constant CURVE_GRADUATION_TARGET = 6_000 * CASH;
    uint16 internal constant CURVE_QUOTE_TO_LP_BPS = 10_000;
    uint256 internal constant POST_MIGRATION_BUY_ONE = 250 * CASH;
    uint256 internal constant POST_MIGRATION_BUY_TWO = 375 * CASH;
    uint256 internal constant POST_MIGRATION_BUY_THREE = 125 * CASH;
    uint256 internal constant FIXED_ACTIVE_SALE_SUPPLY = 2_400 * PLEDGE;
    uint256 internal constant FIXED_ACTIVE_BUY_ONE = 700 * PLEDGE;
    uint256 internal constant FIXED_ACTIVE_BUY_TWO = 450 * PLEDGE;
    uint256 internal constant FIXED_ACTIVE_PRICE = 3 * CASH;
    uint256 internal constant ACTIVE_CURVE_SALE_SUPPLY = 3_600 * PLEDGE;
    uint256 internal constant ACTIVE_CURVE_MIGRATION_SUPPLY = 1_400 * PLEDGE;
    uint256 internal constant ACTIVE_CURVE_BUY_ONE = 450 * PLEDGE;
    uint256 internal constant ACTIVE_CURVE_BUY_TWO = 350 * PLEDGE;
    uint256 internal constant ACTIVE_CURVE_BUY_THREE = 250 * PLEDGE;
    uint256 internal constant ACTIVE_CURVE_SELL = 100 * PLEDGE;
    uint256 internal constant ACTIVE_CURVE_BASE_PRICE = 15 * CASH / 10;
    uint256 internal constant ACTIVE_CURVE_SLOPE = 1;
    uint256 internal constant ACTIVE_CURVE_GRADUATION_TARGET = 12_000 * CASH;
    uint16 internal constant ACTIVE_CURVE_QUOTE_TO_LP_BPS = 7_500;
    uint256 internal constant FIXED_CLOSED_SALE_SUPPLY = 1_800 * PLEDGE;
    uint256 internal constant FIXED_CLOSED_BUY_ONE = 600 * PLEDGE;
    uint256 internal constant FIXED_CLOSED_BUY_TWO = 300 * PLEDGE;
    uint256 internal constant FIXED_CLOSED_PRICE = 4 * CASH;
    uint64 internal constant REWARD_COOLDOWN = 7 days;
    uint256 internal constant REWARD_AMOUNT = 3_000 * CASH;
    uint256 internal constant REWARD_DURATION = 30 days;
    uint256 internal constant REWARD_STAKE = 1_000 * PLEDGE;

    struct Deployment {
        BoardroomFactory boardroomFactory;
        AssetPolicy assetPolicy;
        TokenGrantFactory tokenGrantFactory;
        DistributionFactory distributionFactory;
        BoardroomRewardsFactory boardroomRewardsFactory;
        AmmFactory ammFactory;
        AmmRouter ammRouter;
        address protocolFeeRouter;
    }

    struct Actors {
        address deployer;
        address issuer;
        address holder;
        address newHolder;
        address boardroomOwner;
        address contractor;
        address investor;
    }

    struct GrantSpec {
        uint256 issuerKey;
        address holder;
        address token;
        address paymentToken;
        uint256 amount;
        uint256 price;
        uint256 expiry;
        uint256 vestingCliff;
        uint256 vestingEnd;
        bool transferable;
        uint256 transferUnlockTime;
        bytes32 salt;
    }

    struct SeededGrants {
        TokenGrant directPartiallySettled;
        TokenGrant directTransferredPaid;
        TokenGrant directHalted;
        TokenGrant employeeLeadOption;
        TokenGrant employeeEngineerOption;
        TokenGrant employeeAdvisorOption;
    }

    struct LaunchScenario {
        MigratingBondingCurve curve;
        address pool;
        address locker;
        uint256 buyerOneQuotePaid;
        uint256 buyerTwoQuotePaid;
        uint256 quoteReserveAtMigration;
        uint256 sharesToLiquidity;
        uint256 quoteToLiquidity;
        uint256 lockedLiquidity;
        uint256 optionStrikePrice;
        uint256 postMigrationBuyCount;
        uint256 postMigrationBuyInput;
        uint256 postMigrationBuyOutput;
        uint256 claimableLockerFee0;
        uint256 claimableLockerFee1;
    }

    struct SeededBoardroom {
        Boardroom boardroom;
        string name;
        string symbol;
        string path;
        string status;
        string distributionKind;
        address shareToken;
        address distribution;
        address pool;
        address locker;
        uint256 soldShares;
        uint256 cashRaised;
        uint256 treasuryCash;
        uint256 buyerCount;
    }

    Deployment internal deployment;
    Actors internal actors;
    SeedToken internal equity;
    SeedToken internal cash;
    Boardroom internal boardroom;
    SeededGrants internal grants;
    LaunchScenario internal launch;
    FixedPriceSale internal activeFixedSale;
    MigratingBondingCurve internal activeCurve;
    FixedPriceSale internal closedFixedSale;
    BoardroomRewards internal boardroomRewards;
    SeededBoardroom[] internal seededBoardrooms;
    uint256 internal seedNonce;
    uint256 internal deployerKey;
    uint256 internal creationFee;

    function run() external {
        if (block.chainid != 31337) revert("SeedLocal only targets local Anvil chain 31337");

        deployerKey = vm.envOr("PRIVATE_KEY", DEPLOYER_KEY);
        seedNonce = vm.envOr("LOCAL_SEED_NONCE", block.number);

        _setActors(deployerKey);
        _readDeployment();
        _deploySeedTokens(deployerKey);
        _seedDirectGrants();
        _seedBoardroom();
        _seedAdditionalBoardrooms();
        _assertScenario();
        _writeSeedArtifact();
        _logSeed();
    }

    function _setActors(uint256 deployerKey_) internal {
        actors = Actors({
            deployer: vm.addr(deployerKey_),
            issuer: vm.addr(ISSUER_KEY),
            holder: vm.addr(HOLDER_KEY),
            newHolder: vm.addr(NEW_HOLDER_KEY),
            boardroomOwner: vm.addr(BOARDROOM_OWNER_KEY),
            contractor: vm.addr(CONTRACTOR_KEY),
            investor: vm.addr(INVESTOR_KEY)
        });
    }

    function _readDeployment() internal {
        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        string memory json = vm.readFile(path);
        BoardroomFactory boardroomFactory = BoardroomFactory(json.readAddress(".boardroomFactory"));
        AssetPolicy assetPolicy = AssetPolicy(json.readAddress(".assetPolicy"));
        TokenGrantFactory tokenGrantFactory = TokenGrantFactory(json.readAddress(".tokenGrantFactory"));
        DistributionFactory distributionFactory = DistributionFactory(json.readAddress(".distributionFactory"));
        BoardroomRewardsFactory boardroomRewardsFactory =
            BoardroomRewardsFactory(json.readAddress(".boardroomRewardsFactory"));
        AmmFactory ammFactory = AmmFactory(json.readAddress(".ammFactory"));
        AmmRouter ammRouter = AmmRouter(payable(json.readAddress(".ammRouter")));
        address protocolFeeRouter = json.readAddress(".protocolFeeRouter");
        deployment = Deployment({
            boardroomFactory: boardroomFactory,
            assetPolicy: assetPolicy,
            tokenGrantFactory: tokenGrantFactory,
            distributionFactory: distributionFactory,
            boardroomRewardsFactory: boardroomRewardsFactory,
            ammFactory: ammFactory,
            ammRouter: ammRouter,
            protocolFeeRouter: protocolFeeRouter
        });
        creationFee = tokenGrantFactory.creationFee();
    }

    function _deploySeedTokens(uint256 deployerKey_) internal {
        vm.startBroadcast(deployerKey_);
        equity = new SeedToken("Seed Equity Token", "EQTY", 18);
        cash = new SeedToken("Seed Cash", "CASH", 6);

        equity.mint(actors.issuer, 20_000 * PLEDGE);
        cash.mint(actors.holder, 25_000 * CASH);
        cash.mint(actors.newHolder, 25_000 * CASH);
        cash.mint(actors.investor, 25_000 * CASH);
        cash.mint(actors.contractor, 25_000 * CASH);
        vm.stopBroadcast();
    }

    function _seedDirectGrants() internal {
        _seedDirectPartiallySettled();
        _seedDirectTransferredPaid();
        _seedDirectHalted();
    }

    function _seedDirectPartiallySettled() internal {
        uint256 now_ = block.timestamp;
        GrantSpec memory spec;
        spec.issuerKey = ISSUER_KEY;
        spec.holder = actors.holder;
        spec.token = address(equity);
        spec.paymentToken = address(0);
        spec.amount = 1_000 * PLEDGE;
        spec.price = 0;
        spec.expiry = now_ + 60 * DAY;
        spec.vestingCliff = now_ - 14 * DAY;
        spec.vestingEnd = now_ + 14 * DAY;
        spec.transferable = false;
        spec.transferUnlockTime = 0;
        spec.salt = _salt("direct-partially-settled");

        grants.directPartiallySettled = _createDirectGrant(spec);

        vm.startBroadcast(HOLDER_KEY);
        grants.directPartiallySettled.settle(100 * PLEDGE);
        vm.stopBroadcast();
    }

    function _seedDirectTransferredPaid() internal {
        uint256 now_ = block.timestamp;
        GrantSpec memory spec;
        spec.issuerKey = ISSUER_KEY;
        spec.holder = actors.holder;
        spec.token = address(equity);
        spec.paymentToken = address(cash);
        spec.amount = 800 * PLEDGE;
        spec.price = 2 * CASH;
        spec.expiry = now_ + 90 * DAY;
        spec.vestingCliff = now_ - 30 * DAY;
        spec.vestingEnd = now_ - 1;
        spec.transferable = true;
        spec.transferUnlockTime = now_ - 1;
        spec.salt = _salt("direct-transferred-paid");

        grants.directTransferredPaid = _createDirectGrant(spec);

        vm.startBroadcast(HOLDER_KEY);
        deployment.tokenGrantFactory
            .transferFrom(actors.holder, actors.newHolder, grants.directTransferredPaid.tokenId());
        vm.stopBroadcast();

        uint256 settlement = 100 * PLEDGE;
        uint256 cost = grants.directTransferredPaid.getSettlementCost(settlement);
        vm.startBroadcast(NEW_HOLDER_KEY);
        cash.approve(address(grants.directTransferredPaid), cost);
        grants.directTransferredPaid.settle(settlement);
        vm.stopBroadcast();
    }

    function _seedDirectHalted() internal {
        uint256 now_ = block.timestamp;
        GrantSpec memory spec;
        spec.issuerKey = ISSUER_KEY;
        spec.holder = actors.contractor;
        spec.token = address(equity);
        spec.paymentToken = address(0);
        spec.amount = 500 * PLEDGE;
        spec.price = 0;
        spec.expiry = now_ + 120 * DAY;
        spec.vestingCliff = now_ + 7 * DAY;
        spec.vestingEnd = now_ + 37 * DAY;
        spec.transferable = false;
        spec.transferUnlockTime = 0;
        spec.salt = _salt("direct-halted-before-cliff");

        grants.directHalted = _createDirectGrant(spec);

        vm.startBroadcast(ISSUER_KEY);
        grants.directHalted.stopVestingAndWithdrawUnvested();
        vm.stopBroadcast();
    }

    function _seedBoardroom() internal {
        boardroom = _createBoardroom("Seed Labs Common", "SEED", "seed-boardroom", BOARDROOM_TREASURY_SHARES);

        _seedBoardroomLaunch();
        _seedBoardroomEmployeeOptions();
        _seedBoardroomRewards();
        _recordSeededBoardroom(
            boardroom,
            "Seed Labs",
            "SEED",
            "Migrated curve + AMM",
            "Live AMM",
            "migrating-bonding-curve",
            address(launch.curve),
            launch.pool,
            launch.locker,
            CURVE_BUYER_ONE_SHARES + CURVE_BUYER_TWO_SHARES + launch.postMigrationBuyOutput,
            launch.quoteReserveAtMigration + launch.postMigrationBuyInput,
            cash.balanceOf(address(boardroom)),
            5
        );
    }

    function _seedBoardroomRewards() internal {
        Boardroom.Call memory createCall = Boardroom.Call({
            policy: address(deployment.boardroomRewardsFactory),
            target: address(deployment.boardroomRewardsFactory),
            value: 0,
            data: abi.encodeCall(BoardroomRewardsFactory.createRewards, (REWARD_COOLDOWN, _salt("seed-rewards")))
        });

        vm.startBroadcast(BOARDROOM_OWNER_KEY);
        bytes memory createResult = boardroom.execute(createCall);
        vm.stopBroadcast();
        boardroomRewards = BoardroomRewards(abi.decode(createResult, (address)));

        vm.startBroadcast(deployerKey);
        cash.mint(address(boardroom), REWARD_AMOUNT);
        vm.stopBroadcast();

        Boardroom.Call[] memory fundingCalls = new Boardroom.Call[](2);
        fundingCalls[0] = Boardroom.Call({
            policy: address(deployment.assetPolicy),
            target: address(cash),
            value: 0,
            data: abi.encodeCall(SeedToken.approve, (address(deployment.boardroomRewardsFactory), REWARD_AMOUNT))
        });
        fundingCalls[1] = Boardroom.Call({
            policy: address(deployment.boardroomRewardsFactory),
            target: address(deployment.boardroomRewardsFactory),
            value: 0,
            data: abi.encodeCall(
                BoardroomRewardsFactory.fundReward,
                (address(boardroomRewards), address(cash), REWARD_AMOUNT, REWARD_DURATION)
            )
        });

        vm.startBroadcast(BOARDROOM_OWNER_KEY);
        boardroom.executeBatch(fundingCalls);
        vm.stopBroadcast();

        vm.startBroadcast(INVESTOR_KEY);
        boardroomRewards.stake(REWARD_STAKE);
        vm.stopBroadcast();
    }

    function _seedAdditionalBoardrooms() internal {
        _seedActiveFixedPriceBoardroom();
        _seedActiveCurveBoardroom();
        _seedClosedFixedPriceBoardroom();
    }

    function _seedActiveFixedPriceBoardroom() internal {
        Boardroom target = _createBoardroom("Atlas Payroll Common", "ATLS", "atlas-boardroom", 900 * PLEDGE);
        activeFixedSale = _createFixedPriceSale(
            target, FIXED_ACTIVE_SALE_SUPPLY, FIXED_ACTIVE_PRICE, 1_500 * PLEDGE, "atlas-fixed-sale"
        );

        uint256 raised;
        raised += _buyFixedPriceSale(activeFixedSale, HOLDER_KEY, actors.holder, FIXED_ACTIVE_BUY_ONE);
        raised += _buyFixedPriceSale(activeFixedSale, CONTRACTOR_KEY, actors.contractor, FIXED_ACTIVE_BUY_TWO);

        _recordSeededBoardroom(
            target,
            "Atlas Payroll",
            "ATLS",
            "Fixed price sale",
            "Active sale",
            "fixed-price-sale",
            address(activeFixedSale),
            address(0),
            address(0),
            FIXED_ACTIVE_BUY_ONE + FIXED_ACTIVE_BUY_TWO,
            raised,
            cash.balanceOf(address(target)),
            2
        );
    }

    function _seedActiveCurveBoardroom() internal {
        Boardroom target = _createBoardroom("Northstar Robotics Common", "NOVA", "northstar-boardroom", 1_200 * PLEDGE);
        activeCurve = _createMigratingCurveFor(
            target,
            ACTIVE_CURVE_SALE_SUPPLY,
            ACTIVE_CURVE_MIGRATION_SUPPLY,
            ACTIVE_CURVE_BASE_PRICE,
            ACTIVE_CURVE_SLOPE,
            ACTIVE_CURVE_GRADUATION_TARGET,
            ACTIVE_CURVE_QUOTE_TO_LP_BPS,
            "northstar-curve"
        );

        _buyCurve(activeCurve, INVESTOR_KEY, actors.investor, ACTIVE_CURVE_BUY_ONE);
        _buyCurve(activeCurve, HOLDER_KEY, actors.holder, ACTIVE_CURVE_BUY_TWO);
        _buyCurve(activeCurve, CONTRACTOR_KEY, actors.contractor, ACTIVE_CURVE_BUY_THREE);
        _sellCurveShares(activeCurve, INVESTOR_KEY, actors.investor, ACTIVE_CURVE_SELL);

        _recordSeededBoardroom(
            target,
            "Northstar Robotics",
            "NOVA",
            "Bonding curve",
            "Open curve",
            "migrating-bonding-curve",
            address(activeCurve),
            address(0),
            address(0),
            activeCurve.soldShares(),
            activeCurve.quoteReserve(),
            cash.balanceOf(address(target)),
            3
        );
    }

    function _seedClosedFixedPriceBoardroom() internal {
        Boardroom target = _createBoardroom("Harbor Analytics Common", "HARB", "harbor-boardroom", 1_100 * PLEDGE);
        closedFixedSale = _createFixedPriceSale(
            target, FIXED_CLOSED_SALE_SUPPLY, FIXED_CLOSED_PRICE, 1_000 * PLEDGE, "harbor-fixed-sale"
        );

        uint256 raised;
        raised += _buyFixedPriceSale(closedFixedSale, INVESTOR_KEY, actors.investor, FIXED_CLOSED_BUY_ONE);
        raised += _buyFixedPriceSale(closedFixedSale, NEW_HOLDER_KEY, actors.newHolder, FIXED_CLOSED_BUY_TWO);
        _closeFixedPriceSale(target, closedFixedSale);

        _recordSeededBoardroom(
            target,
            "Harbor Analytics",
            "HARB",
            "Fixed price sale",
            "Closed sale",
            "fixed-price-sale",
            address(closedFixedSale),
            address(0),
            address(0),
            FIXED_CLOSED_BUY_ONE + FIXED_CLOSED_BUY_TWO,
            raised,
            cash.balanceOf(address(target)),
            2
        );
    }

    function _createBoardroom(string memory name, string memory symbol, string memory saltLabel, uint256 treasuryShares)
        internal
        returns (Boardroom created)
    {
        vm.startBroadcast(BOARDROOM_OWNER_KEY);
        address boardroomAddress =
            deployment.boardroomFactory.createBoardroom(actors.boardroomOwner, name, symbol, _salt(saltLabel));
        created = Boardroom(payable(boardroomAddress));
        if (treasuryShares != 0) created.mint(address(created), treasuryShares);
        vm.stopBroadcast();

        vm.startBroadcast(deployerKey);
        deployment.assetPolicy.setAssetAllowed(created.shareToken(), true);
        deployment.assetPolicy.setAssetAllowed(address(cash), true);
        vm.stopBroadcast();
    }

    function _createFixedPriceSale(
        Boardroom target,
        uint256 shareAmount,
        uint256 price,
        uint256 maxPerBuyer,
        string memory saltLabel
    ) internal returns (FixedPriceSale sale) {
        bytes32 saleSalt = _salt(saltLabel);
        address predictedSale = deployment.distributionFactory.predictFixedPriceSaleAddress(address(target), saleSalt);
        FixedPriceSale.CreateParams memory params = FixedPriceSale.CreateParams({
            shareToken: target.shareToken(),
            paymentToken: address(cash),
            shareAmount: shareAmount,
            price: price,
            maxPerBuyer: maxPerBuyer,
            startTime: uint64(block.timestamp),
            endTime: 0,
            salt: saleSalt
        });

        Boardroom.Call[] memory calls = new Boardroom.Call[](2);
        calls[0] = Boardroom.Call({
            policy: address(deployment.assetPolicy),
            target: target.shareToken(),
            value: 0,
            data: abi.encodeWithSignature(
                "approve(address,uint256)", address(deployment.distributionFactory), shareAmount
            )
        });
        calls[1] = Boardroom.Call({
            policy: address(deployment.distributionFactory),
            target: address(deployment.distributionFactory),
            value: 0,
            data: abi.encodeCall(DistributionFactory.createFixedPriceSale, (params))
        });

        vm.startBroadcast(BOARDROOM_OWNER_KEY);
        target.mint(address(target), shareAmount);
        bytes[] memory results = target.executeBatch(calls);
        vm.stopBroadcast();

        address createdSale = abi.decode(results[1], (address));
        if (createdSale != predictedSale) revert ScenarioInvariantFailed("fixed-sale-prediction");
        sale = FixedPriceSale(createdSale);
    }

    function _buyFixedPriceSale(FixedPriceSale sale, uint256 buyerKey, address buyer, uint256 shareAmount)
        internal
        returns (uint256 payment)
    {
        payment = sale.getPaymentAmount(shareAmount);

        vm.startBroadcast(buyerKey);
        cash.approve(address(sale), payment);
        uint256 actualPayment = sale.buy(shareAmount, buyer, payment, block.timestamp + 1 hours);
        vm.stopBroadcast();

        if (actualPayment != payment) revert ScenarioInvariantFailed("fixed-sale-payment");
    }

    function _closeFixedPriceSale(Boardroom target, FixedPriceSale sale) internal {
        Boardroom.Call memory call = Boardroom.Call({
            policy: address(deployment.distributionFactory),
            target: address(sale),
            value: 0,
            data: abi.encodeCall(FixedPriceSale.close, ())
        });

        vm.startBroadcast(BOARDROOM_OWNER_KEY);
        target.execute(call);
        vm.stopBroadcast();
    }

    function _createMigratingCurveFor(
        Boardroom target,
        uint256 saleSupply,
        uint256 migrationSupply,
        uint256 basePrice,
        uint256 slope,
        uint256 graduationQuoteTarget,
        uint16 quoteToLpBps,
        string memory saltLabel
    ) internal returns (MigratingBondingCurve curve) {
        bytes32 curveSalt = _salt(saltLabel);
        address predictedCurve =
            deployment.distributionFactory.predictMigratingBondingCurveAddress(address(target), curveSalt);
        MigratingBondingCurve.CreateParams memory params = MigratingBondingCurve.CreateParams({
            shareToken: target.shareToken(),
            quoteToken: address(cash),
            saleSupply: saleSupply,
            migrationSupply: migrationSupply,
            basePrice: basePrice,
            slope: slope,
            graduationQuoteTarget: graduationQuoteTarget,
            quoteToLpBps: quoteToLpBps,
            startTime: uint64(block.timestamp),
            endTime: 0,
            migrationSalt: _salt(string.concat(saltLabel, "-migration")),
            salt: curveSalt
        });

        uint256 totalCurveShares = saleSupply + migrationSupply;
        Boardroom.Call[] memory calls = new Boardroom.Call[](2);
        calls[0] = Boardroom.Call({
            policy: address(deployment.assetPolicy),
            target: target.shareToken(),
            value: 0,
            data: abi.encodeWithSignature(
                "approve(address,uint256)", address(deployment.distributionFactory), totalCurveShares
            )
        });
        calls[1] = Boardroom.Call({
            policy: address(deployment.distributionFactory),
            target: address(deployment.distributionFactory),
            value: 0,
            data: abi.encodeCall(DistributionFactory.createMigratingBondingCurve, (params))
        });

        vm.startBroadcast(BOARDROOM_OWNER_KEY);
        target.mint(address(target), totalCurveShares);
        bytes[] memory results = target.executeBatch(calls);
        vm.stopBroadcast();

        address createdCurve = abi.decode(results[1], (address));
        if (createdCurve != predictedCurve) revert ScenarioInvariantFailed("curve-prediction");
        curve = MigratingBondingCurve(createdCurve);
    }

    function _recordSeededBoardroom(
        Boardroom target,
        string memory name,
        string memory symbol,
        string memory path,
        string memory status,
        string memory distributionKind,
        address distribution,
        address pool,
        address locker,
        uint256 soldShares,
        uint256 cashRaised,
        uint256 treasuryCash,
        uint256 buyerCount
    ) internal {
        seededBoardrooms.push(
            SeededBoardroom({
                boardroom: target,
                name: name,
                symbol: symbol,
                path: path,
                status: status,
                distributionKind: distributionKind,
                shareToken: target.shareToken(),
                distribution: distribution,
                pool: pool,
                locker: locker,
                soldShares: soldShares,
                cashRaised: cashRaised,
                treasuryCash: treasuryCash,
                buyerCount: buyerCount
            })
        );
    }

    function _seedBoardroomLaunch() internal {
        _createMigratingCurve();
        launch.buyerOneQuotePaid = _buyCurve(launch.curve, INVESTOR_KEY, actors.investor, CURVE_BUYER_ONE_SHARES);
        launch.buyerTwoQuotePaid = _buyCurve(launch.curve, NEW_HOLDER_KEY, actors.newHolder, CURVE_BUYER_TWO_SHARES);
        _migrateCurve();
        _seedPostMigrationSwap();
    }

    function _createMigratingCurve() internal {
        uint256 totalCurveShares = CURVE_SALE_SUPPLY + CURVE_MIGRATION_SUPPLY;
        bytes32 curveSalt = _salt("seed-curve");
        address predictedCurve =
            deployment.distributionFactory.predictMigratingBondingCurveAddress(address(boardroom), curveSalt);
        MigratingBondingCurve.CreateParams memory params = MigratingBondingCurve.CreateParams({
            shareToken: boardroom.shareToken(),
            quoteToken: address(cash),
            saleSupply: CURVE_SALE_SUPPLY,
            migrationSupply: CURVE_MIGRATION_SUPPLY,
            basePrice: CURVE_BASE_PRICE,
            slope: CURVE_SLOPE,
            graduationQuoteTarget: CURVE_GRADUATION_TARGET,
            quoteToLpBps: CURVE_QUOTE_TO_LP_BPS,
            startTime: uint64(block.timestamp),
            endTime: 0,
            migrationSalt: _salt("seed-curve-migration"),
            salt: curveSalt
        });

        Boardroom.Call[] memory calls = new Boardroom.Call[](2);
        calls[0] = Boardroom.Call({
            policy: address(deployment.assetPolicy),
            target: boardroom.shareToken(),
            value: 0,
            data: abi.encodeWithSignature(
                "approve(address,uint256)", address(deployment.distributionFactory), totalCurveShares
            )
        });
        calls[1] = Boardroom.Call({
            policy: address(deployment.distributionFactory),
            target: address(deployment.distributionFactory),
            value: 0,
            data: abi.encodeCall(DistributionFactory.createMigratingBondingCurve, (params))
        });

        vm.startBroadcast(BOARDROOM_OWNER_KEY);
        bytes[] memory results = boardroom.executeBatch(calls);
        vm.stopBroadcast();

        address createdCurve = abi.decode(results[1], (address));
        if (createdCurve != predictedCurve) revert("curve prediction mismatch");
        launch.curve = MigratingBondingCurve(createdCurve);
    }

    function _buyCurve(MigratingBondingCurve curve, uint256 buyerKey, address buyer, uint256 shareAmount)
        internal
        returns (uint256 quotePaid)
    {
        quotePaid = curve.getBuyQuote(shareAmount);

        vm.startBroadcast(buyerKey);
        cash.approve(address(curve), quotePaid);
        uint256 actualQuotePaid = curve.buy(shareAmount, buyer, quotePaid, block.timestamp + 1 hours);
        vm.stopBroadcast();

        if (actualQuotePaid != quotePaid) revert("curve buy quote mismatch");
    }

    function _sellCurveShares(MigratingBondingCurve curve, uint256 sellerKey, address recipient, uint256 shareAmount)
        internal
        returns (uint256 quoteOut)
    {
        vm.startBroadcast(sellerKey);
        BoardroomToken(curve.shareToken()).approve(address(curve), shareAmount);
        quoteOut = curve.sell(shareAmount, recipient, 1, block.timestamp + 1 hours);
        vm.stopBroadcast();
    }

    function _migrateCurve() internal {
        launch.quoteReserveAtMigration = launch.curve.quoteReserve();
        launch.sharesToLiquidity = launch.curve.migrationSupply() + launch.curve.remainingSaleShares();
        uint256 quoteToLiquidity = launch.quoteReserveAtMigration * CURVE_QUOTE_TO_LP_BPS / BPS;

        Boardroom.Call memory call = Boardroom.Call({
            policy: address(deployment.distributionFactory),
            target: address(launch.curve),
            value: 0,
            data: abi.encodeCall(
                MigratingBondingCurve.migrate, (launch.sharesToLiquidity, quoteToLiquidity, block.timestamp + 1 hours)
            )
        });

        vm.startBroadcast(BOARDROOM_OWNER_KEY);
        bytes memory result = boardroom.execute(call);
        vm.stopBroadcast();

        uint256 amountShares;
        (launch.locker, launch.pool, amountShares, launch.quoteToLiquidity, launch.lockedLiquidity) =
            abi.decode(result, (address, address, uint256, uint256, uint256));
        if (amountShares != launch.sharesToLiquidity) revert("curve share liquidity mismatch");
        launch.optionStrikePrice = launch.quoteToLiquidity * PLEDGE / launch.sharesToLiquidity;
    }

    function _seedPostMigrationSwap() internal {
        address[] memory path = new address[](2);
        path[0] = address(cash);
        path[1] = boardroom.shareToken();

        _swapCashForShares(INVESTOR_KEY, actors.investor, path, POST_MIGRATION_BUY_ONE);
        _swapCashForShares(CONTRACTOR_KEY, actors.contractor, path, POST_MIGRATION_BUY_TWO);
        _swapCashForShares(NEW_HOLDER_KEY, actors.newHolder, path, POST_MIGRATION_BUY_THREE);

        (launch.claimableLockerFee0, launch.claimableLockerFee1) = _pendingPoolFees(launch.pool, launch.locker);
    }

    function _swapCashForShares(uint256 buyerKey, address buyer, address[] memory path, uint256 amountIn) internal {
        vm.startBroadcast(buyerKey);
        cash.approve(address(deployment.ammRouter), amountIn);
        uint256[] memory amounts =
            deployment.ammRouter.swapExactTokensForTokens(amountIn, 1, path, buyer, block.timestamp + 1 hours);
        vm.stopBroadcast();

        launch.postMigrationBuyCount += 1;
        launch.postMigrationBuyInput += amounts[0];
        launch.postMigrationBuyOutput += amounts[1];
    }

    function _pendingPoolFees(address pool, address account)
        internal
        view
        returns (uint256 pending0, uint256 pending1)
    {
        AmmPool pool_ = AmmPool(pool);
        uint256 balance = pool_.balanceOf(account);
        pending0 = pool_.claimable0(account) + _pendingFee(balance, pool_.index0(), pool_.supplyIndex0(account));
        pending1 = pool_.claimable1(account) + _pendingFee(balance, pool_.index1(), pool_.supplyIndex1(account));
    }

    function _pendingFee(uint256 balance, uint256 index, uint256 supplyIndex) internal pure returns (uint256) {
        return index > supplyIndex ? balance * (index - supplyIndex) / FEE_INDEX_SCALE : 0;
    }

    function _seedBoardroomEmployeeOptions() internal {
        _seedLeadOption();
        _seedEngineerOption();
        _seedAdvisorOption();
    }

    function _seedLeadOption() internal {
        uint256 now_ = block.timestamp;
        GrantSpec memory spec;
        spec.holder = actors.holder;
        spec.token = boardroom.shareToken();
        spec.paymentToken = address(cash);
        spec.amount = 500 * PLEDGE;
        spec.price = launch.optionStrikePrice;
        spec.expiry = now_ + 120 * DAY;
        spec.vestingCliff = now_ - 30 * DAY;
        spec.vestingEnd = now_ + 30 * DAY;
        spec.transferable = false;
        spec.transferUnlockTime = 0;
        spec.salt = _salt("employee-lead-option");

        grants.employeeLeadOption = _createBoardroomGrant(spec);

        vm.startBroadcast(HOLDER_KEY);
        cash.approve(address(grants.employeeLeadOption), grants.employeeLeadOption.getSettlementCost(40 * PLEDGE));
        grants.employeeLeadOption.settle(40 * PLEDGE);
        vm.stopBroadcast();
    }

    function _seedEngineerOption() internal {
        uint256 now_ = block.timestamp;
        GrantSpec memory spec;
        spec.holder = actors.contractor;
        spec.token = boardroom.shareToken();
        spec.paymentToken = address(cash);
        spec.amount = 300 * PLEDGE;
        spec.price = launch.optionStrikePrice;
        spec.expiry = now_ + 450 * DAY;
        spec.vestingCliff = now_ + 30 * DAY;
        spec.vestingEnd = now_ + 390 * DAY;
        spec.transferable = false;
        spec.transferUnlockTime = 0;
        spec.salt = _salt("employee-engineer-option");

        grants.employeeEngineerOption = _createBoardroomGrant(spec);
    }

    function _seedAdvisorOption() internal {
        uint256 now_ = block.timestamp;
        GrantSpec memory spec;
        spec.holder = actors.newHolder;
        spec.token = boardroom.shareToken();
        spec.paymentToken = address(cash);
        spec.amount = 150 * PLEDGE;
        spec.price = launch.optionStrikePrice;
        spec.expiry = now_ + 120 * DAY;
        spec.vestingCliff = now_ - 1;
        spec.vestingEnd = now_ - 1;
        spec.transferable = false;
        spec.transferUnlockTime = 0;
        spec.salt = _salt("employee-advisor-option");

        grants.employeeAdvisorOption = _createBoardroomGrant(spec);

        uint256 settlement = 25 * PLEDGE;
        uint256 cost = grants.employeeAdvisorOption.getSettlementCost(settlement);

        vm.startBroadcast(NEW_HOLDER_KEY);
        cash.approve(address(grants.employeeAdvisorOption), cost);
        grants.employeeAdvisorOption.settle(settlement);
        vm.stopBroadcast();
    }

    function _createDirectGrant(GrantSpec memory spec) internal returns (TokenGrant grant) {
        address issuer = vm.addr(spec.issuerKey);

        vm.startBroadcast(spec.issuerKey);
        SeedToken(spec.token).approve(address(deployment.tokenGrantFactory), spec.amount);
        (bool success, bytes memory result) =
            address(deployment.tokenGrantFactory).call{value: creationFee}(_createGrantData(spec));
        vm.stopBroadcast();
        if (!success) _revertGrantCreation(result);

        grant = TokenGrant(abi.decode(result, (address)));
        if (grant.issuer() != issuer) revert("direct grant issuer mismatch");
    }

    function _createBoardroomGrant(GrantSpec memory spec) internal returns (TokenGrant grant) {
        uint256 fee = creationFee;
        Boardroom.Call[] memory calls = new Boardroom.Call[](2);
        calls[0] = Boardroom.Call({
            policy: address(deployment.assetPolicy),
            target: spec.token,
            value: 0,
            data: abi.encodeWithSignature(
                "approve(address,uint256)", address(deployment.tokenGrantFactory), spec.amount
            )
        });
        calls[1] = Boardroom.Call({
            policy: address(deployment.tokenGrantFactory),
            target: address(deployment.tokenGrantFactory),
            value: fee,
            data: _createGrantData(spec)
        });

        vm.startBroadcast(BOARDROOM_OWNER_KEY);
        bytes[] memory results = boardroom.executeBatch{value: fee}(calls);
        vm.stopBroadcast();

        grant = TokenGrant(abi.decode(results[1], (address)));
        if (grant.issuer() != address(boardroom)) revert("boardroom grant issuer mismatch");
    }

    function _assertScenario() internal view {
        _assertDirectGrantMatrix();
        _assertLaunchScenario();
        _assertEmployeeOptions();
        _assertBoardroomRewards();
        _assertSeededBoardrooms();
    }

    function _assertBoardroomRewards() internal view {
        BoardroomToken shares = BoardroomToken(boardroom.shareToken());
        _check(boardroom.rewardPool() == address(boardroomRewards), "boardroom-reward-pool");
        _check(
            deployment.boardroomRewardsFactory.rewardsForBoardroom(address(boardroom)) == address(boardroomRewards),
            "factory-boardroom-rewards"
        );
        _check(boardroomRewards.rewardAssetCount() == 1, "boardroom-reward-asset-count");
        _check(boardroomRewards.rewardAssetAt(0) == address(cash), "boardroom-reward-asset");
        _check(boardroomRewards.totalActiveStake() == REWARD_STAKE, "boardroom-reward-total-stake");
        _check(boardroomRewards.activeStakeOf(actors.investor) == REWARD_STAKE, "boardroom-reward-investor-stake");
        _check(shares.lockedStakeBalance(actors.investor) == REWARD_STAKE, "boardroom-share-locked-stake");
    }

    function _assertDirectGrantMatrix() internal view {
        _check(grants.directPartiallySettled.issuer() == actors.issuer, "direct-partial-issuer");
        _check(grants.directPartiallySettled.holder() == actors.holder, "direct-partial-holder");
        _check(grants.directPartiallySettled.paymentToken() == address(0), "direct-partial-free");
        _check(grants.directPartiallySettled.settledAmount() == 100 * PLEDGE, "direct-partial-settled");
        _check(!grants.directPartiallySettled.isClosed(), "direct-partial-open");

        _check(grants.directTransferredPaid.holder() == actors.newHolder, "direct-paid-transferred-holder");
        _check(
            deployment.tokenGrantFactory.ownerOf(grants.directTransferredPaid.tokenId()) == actors.newHolder,
            "direct-paid-transferred-owner"
        );
        _check(grants.directTransferredPaid.paymentToken() == address(cash), "direct-paid-payment");
        _check(grants.directTransferredPaid.settledAmount() == 100 * PLEDGE, "direct-paid-settled");

        _check(grants.directHalted.holder() == address(0), "direct-halted-holder-burned");
        _check(grants.directHalted.isHalted(), "direct-halted-state");
        _check(grants.directHalted.isClosed(), "direct-halted-closed");
        _check(grants.directHalted.claimable() == 0, "direct-halted-claimable");
    }

    function _assertLaunchScenario() internal view {
        BoardroomToken shares = BoardroomToken(boardroom.shareToken());
        LockedLiquidity locker = LockedLiquidity(launch.locker);

        _check(deployment.ammFactory.protocolFeeRecipient() == deployment.protocolFeeRouter, "amm-protocol-fee-router");
        _check(address(launch.curve) != address(0), "curve-created");
        _check(launch.curve.curveStatus() == MigratingBondingCurve.CurveStatus.Migrated, "curve-migrated");
        _check(launch.curve.pool() == launch.pool, "curve-pool");
        _check(launch.curve.locker() == launch.locker, "curve-locker");
        _check(launch.buyerOneQuotePaid > 0, "curve-buyer-one-paid");
        _check(launch.buyerTwoQuotePaid > 0, "curve-buyer-two-paid");
        _check(
            launch.quoteReserveAtMigration >= CURVE_GRADUATION_TARGET
                || CURVE_BUYER_ONE_SHARES + CURVE_BUYER_TWO_SHARES == CURVE_SALE_SUPPLY,
            "curve-graduated"
        );
        _check(
            launch.sharesToLiquidity
                == CURVE_MIGRATION_SUPPLY + CURVE_SALE_SUPPLY - CURVE_BUYER_ONE_SHARES - CURVE_BUYER_TWO_SHARES,
            "curve-liquidity-shares"
        );
        _check(
            launch.quoteToLiquidity == launch.quoteReserveAtMigration * CURVE_QUOTE_TO_LP_BPS / BPS,
            "curve-liquidity-quote"
        );
        _check(launch.lockedLiquidity > 0, "curve-locked-liquidity");
        _check(locker.lockedLiquidity() == launch.lockedLiquidity, "locker-liquidity");
        _check(boardroom.issuedDistributionCount() == 0, "boardroom-distribution-count");
        _check(!boardroom.isIssuedDistribution(address(launch.curve)), "boardroom-distribution-pruned");
        _check(boardroom.lockedLiquidityCount() == 1, "boardroom-locker-count");
        _check(boardroom.lockedLiquidityAt(0) == launch.locker, "boardroom-locker");
        _check(launch.optionStrikePrice == launch.quoteToLiquidity * PLEDGE / launch.sharesToLiquidity, "option-strike");
        _check(launch.postMigrationBuyCount == 3, "post-migration-buy-count");
        _check(
            launch.postMigrationBuyInput == POST_MIGRATION_BUY_ONE + POST_MIGRATION_BUY_TWO + POST_MIGRATION_BUY_THREE,
            "post-migration-buy-input"
        );
        _check(launch.postMigrationBuyOutput > 0, "post-migration-buy-output");
        _check(launch.claimableLockerFee0 + launch.claimableLockerFee1 > 0, "claimable-locker-fees");
        _check(shares.balanceOf(actors.investor) > CURVE_BUYER_ONE_SHARES, "investor-share-balance");
    }

    function _assertEmployeeOptions() internal view {
        uint256 now_ = block.timestamp;

        _check(boardroom.issuedGrantCount() == 3, "boardroom-grant-count");
        _check(boardroom.issuedGrantAt(0) == address(grants.employeeLeadOption), "boardroom-lead-option");
        _check(boardroom.issuedGrantAt(1) == address(grants.employeeEngineerOption), "boardroom-engineer-option");
        _check(boardroom.issuedGrantAt(2) == address(grants.employeeAdvisorOption), "boardroom-advisor-option");

        _assertBoardroomOption(grants.employeeLeadOption, actors.holder, 500 * PLEDGE, 40 * PLEDGE, "lead-option");
        _check(grants.employeeLeadOption.vestingCliff() < now_, "lead-option-started");
        _check(grants.employeeLeadOption.vestingEnd() > now_, "lead-option-active");

        _assertBoardroomOption(grants.employeeEngineerOption, actors.contractor, 300 * PLEDGE, 0, "engineer-option");
        _check(grants.employeeEngineerOption.vestingCliff() > now_, "engineer-option-future-cliff");

        _assertBoardroomOption(
            grants.employeeAdvisorOption, actors.newHolder, 150 * PLEDGE, 25 * PLEDGE, "advisor-option"
        );
        _check(grants.employeeAdvisorOption.vestingEnd() < now_, "advisor-option-vested");
    }

    function _assertBoardroomOption(
        TokenGrant grant,
        address holder,
        uint256 grantSize,
        uint256 settledAmount,
        string memory label
    ) internal view {
        _check(grant.issuer() == address(boardroom), label);
        _check(grant.holder() == holder, label);
        _check(grant.token() == boardroom.shareToken(), label);
        _check(grant.paymentToken() == address(cash), label);
        _check(grant.grantSize() == grantSize, label);
        _check(grant.price() == launch.optionStrikePrice, label);
        _check(grant.settledAmount() == settledAmount, label);
        _check(!grant.isClosed(), label);
    }

    function _assertSeededBoardrooms() internal view {
        _check(seededBoardrooms.length == 4, "seeded-boardroom-count");

        _check(seededBoardrooms[0].boardroom == boardroom, "seeded-primary-boardroom");
        _check(seededBoardrooms[0].distribution == address(launch.curve), "seeded-primary-distribution");
        _check(seededBoardrooms[0].pool == launch.pool, "seeded-primary-pool");
        _check(seededBoardrooms[0].locker == launch.locker, "seeded-primary-locker");

        _check(activeFixedSale.saleStatus() == FixedPriceSale.SaleStatus.Active, "active-fixed-sale-status");
        _check(
            activeFixedSale.remainingShares() == FIXED_ACTIVE_SALE_SUPPLY - FIXED_ACTIVE_BUY_ONE - FIXED_ACTIVE_BUY_TWO,
            "active-fixed-sale-remaining"
        );
        _check(cash.balanceOf(activeFixedSale.boardroom()) == seededBoardrooms[1].cashRaised, "active-fixed-sale-cash");

        _check(activeCurve.curveStatus() == MigratingBondingCurve.CurveStatus.Active, "active-curve-status");
        _check(
            activeCurve.soldShares()
                == ACTIVE_CURVE_BUY_ONE + ACTIVE_CURVE_BUY_TWO + ACTIVE_CURVE_BUY_THREE - ACTIVE_CURVE_SELL,
            "active-curve-sold"
        );
        _check(activeCurve.quoteReserve() == seededBoardrooms[2].cashRaised, "active-curve-raised");
        _check(activeCurve.quoteReserve() < ACTIVE_CURVE_GRADUATION_TARGET, "active-curve-not-graduated");

        _check(closedFixedSale.saleStatus() == FixedPriceSale.SaleStatus.Closed, "closed-fixed-sale-status");
        _check(closedFixedSale.remainingShares() == 0, "closed-fixed-sale-remaining");
        _check(cash.balanceOf(closedFixedSale.boardroom()) == seededBoardrooms[3].cashRaised, "closed-fixed-sale-cash");
    }

    function _createGrantData(GrantSpec memory spec) internal pure returns (bytes memory) {
        return abi.encodeCall(
            TokenGrantFactory.createGrant,
            (
                spec.holder,
                spec.token,
                spec.paymentToken,
                spec.amount,
                spec.price,
                spec.expiry,
                spec.vestingCliff,
                spec.vestingEnd,
                spec.transferable,
                spec.transferUnlockTime,
                spec.salt
            )
        );
    }

    function _revertGrantCreation(bytes memory returnData) internal pure {
        if (returnData.length == 0) revert("grant creation failed");

        assembly {
            revert(add(returnData, 0x20), mload(returnData))
        }
    }

    function _writeSeedArtifact() internal {
        string memory json = "seed";
        json.serialize("chainId", block.chainid);
        json.serialize("seedNonce", seedNonce);
        json.serialize("deployer", actors.deployer);
        json.serialize("issuer", actors.issuer);
        json.serialize("holder", actors.holder);
        json.serialize("newHolder", actors.newHolder);
        json.serialize("boardroomOwner", actors.boardroomOwner);
        json.serialize("contractor", actors.contractor);
        json.serialize("investor", actors.investor);
        json.serialize("equityToken", address(equity));
        json.serialize("cashToken", address(cash));
        json.serialize("boardroom", address(boardroom));
        json.serialize("boardroomShareToken", boardroom.shareToken());
        json.serialize("boardroomRewards", address(boardroomRewards));
        json.serialize("boardroomRewardAsset", address(cash));
        json.serialize("boardroomRewardStaker", actors.investor);
        json.serialize("boardroomRewardAmount", vm.toString(REWARD_AMOUNT));
        json.serialize("boardroomRewardDuration", REWARD_DURATION);
        json.serialize("boardroomRewardCooldown", REWARD_COOLDOWN);
        json.serialize("boardroomRewardStake", vm.toString(REWARD_STAKE));
        json.serialize("migratingCurve", address(launch.curve));
        json.serialize("curvePool", launch.pool);
        json.serialize("curveLocker", launch.locker);
        json.serialize("curveBuyerOne", actors.investor);
        json.serialize("curveBuyerTwo", actors.newHolder);
        json.serialize("curveSaleSupply", vm.toString(CURVE_SALE_SUPPLY));
        json.serialize("curveMigrationSupply", vm.toString(CURVE_MIGRATION_SUPPLY));
        json.serialize("curveBuyerOneShares", vm.toString(CURVE_BUYER_ONE_SHARES));
        json.serialize("curveBuyerTwoShares", vm.toString(CURVE_BUYER_TWO_SHARES));
        json.serialize("curveBuyerOneQuotePaid", vm.toString(launch.buyerOneQuotePaid));
        json.serialize("curveBuyerTwoQuotePaid", vm.toString(launch.buyerTwoQuotePaid));
        json.serialize("curveBasePrice", vm.toString(CURVE_BASE_PRICE));
        json.serialize("curveSlope", vm.toString(CURVE_SLOPE));
        json.serialize("curveGraduationQuoteTarget", vm.toString(CURVE_GRADUATION_TARGET));
        json.serialize("curveQuoteToLpBps", CURVE_QUOTE_TO_LP_BPS);
        json.serialize("curveQuoteReserveAtMigration", vm.toString(launch.quoteReserveAtMigration));
        json.serialize("curveSharesToLiquidity", vm.toString(launch.sharesToLiquidity));
        json.serialize("curveQuoteToLiquidity", vm.toString(launch.quoteToLiquidity));
        json.serialize("curveLockedLiquidity", vm.toString(launch.lockedLiquidity));
        json.serialize("employeeOptionStrikePrice", vm.toString(launch.optionStrikePrice));
        json.serialize("postMigrationBuyCount", launch.postMigrationBuyCount);
        json.serialize("postMigrationBuyInput", vm.toString(launch.postMigrationBuyInput));
        json.serialize("postMigrationBuyOutput", vm.toString(launch.postMigrationBuyOutput));
        json.serialize("claimableLockerFee0", vm.toString(launch.claimableLockerFee0));
        json.serialize("claimableLockerFee1", vm.toString(launch.claimableLockerFee1));
        json.serialize("directPartiallySettledGrant", address(grants.directPartiallySettled));
        json.serialize("directTransferredPaidGrant", address(grants.directTransferredPaid));
        json.serialize("directHaltedGrant", address(grants.directHalted));
        json.serialize("employeeLeadOptionGrant", address(grants.employeeLeadOption));
        json.serialize("employeeEngineerOptionGrant", address(grants.employeeEngineerOption));
        json.serialize("employeeAdvisorOptionGrant", address(grants.employeeAdvisorOption));
        json.serialize("boardroomShareGrant", address(grants.employeeLeadOption));
        json.serialize("boardroomShareSaleGrant", address(grants.employeeEngineerOption));
        json.serialize("boardroomPayrollGrant", address(grants.employeeAdvisorOption));
        string memory output = _serializeSeededBoardrooms(json);

        vm.writeJson(output, string.concat("deployments/", vm.toString(block.chainid), ".seed.json"));
    }

    function _serializeSeededBoardrooms(string memory json) internal returns (string memory output) {
        _serializeSeededBoardroomAddresses(json);
        _serializeSeededBoardroomLabels(json);
        output = _serializeSeededBoardroomMetrics(json);
    }

    function _serializeSeededBoardroomAddresses(string memory json) internal {
        uint256 count = seededBoardrooms.length;
        address[] memory boardrooms = new address[](count);
        address[] memory shareTokens = new address[](count);
        address[] memory distributions = new address[](count);
        address[] memory pools = new address[](count);
        address[] memory lockers = new address[](count);

        for (uint256 i = 0; i < count; i++) {
            SeededBoardroom storage entry = seededBoardrooms[i];
            boardrooms[i] = address(entry.boardroom);
            shareTokens[i] = entry.shareToken;
            distributions[i] = entry.distribution;
            pools[i] = entry.pool;
            lockers[i] = entry.locker;
        }

        json.serialize("localBoardrooms", boardrooms);
        json.serialize("localBoardroomShareTokens", shareTokens);
        json.serialize("localBoardroomDistributions", distributions);
        json.serialize("localBoardroomPools", pools);
        json.serialize("localBoardroomLockers", lockers);
    }

    function _serializeSeededBoardroomLabels(string memory json) internal {
        uint256 count = seededBoardrooms.length;
        string[] memory names = new string[](count);
        string[] memory symbols = new string[](count);
        string[] memory paths = new string[](count);
        string[] memory statuses = new string[](count);
        string[] memory distributionKinds = new string[](count);

        for (uint256 i = 0; i < count; i++) {
            SeededBoardroom storage entry = seededBoardrooms[i];
            names[i] = entry.name;
            symbols[i] = entry.symbol;
            paths[i] = entry.path;
            statuses[i] = entry.status;
            distributionKinds[i] = entry.distributionKind;
        }

        json.serialize("localBoardroomNames", names);
        json.serialize("localBoardroomSymbols", symbols);
        json.serialize("localBoardroomPaths", paths);
        json.serialize("localBoardroomStatuses", statuses);
        json.serialize("localBoardroomDistributionKinds", distributionKinds);
    }

    function _serializeSeededBoardroomMetrics(string memory json) internal returns (string memory output) {
        uint256 count = seededBoardrooms.length;
        string[] memory soldShares = new string[](count);
        string[] memory cashRaised = new string[](count);
        string[] memory treasuryCash = new string[](count);
        uint256[] memory buyerCounts = new uint256[](count);

        for (uint256 i = 0; i < count; i++) {
            SeededBoardroom storage entry = seededBoardrooms[i];
            soldShares[i] = vm.toString(entry.soldShares);
            cashRaised[i] = vm.toString(entry.cashRaised);
            treasuryCash[i] = vm.toString(entry.treasuryCash);
            buyerCounts[i] = entry.buyerCount;
        }

        json.serialize("localBoardroomSoldShares", soldShares);
        json.serialize("localBoardroomCashRaised", cashRaised);
        json.serialize("localBoardroomTreasuryCash", treasuryCash);
        output = json.serialize("localBoardroomBuyerCounts", buyerCounts);
    }

    function _logSeed() internal view {
        console2.log("Seed nonce", seedNonce);
        console2.log("Issuer", actors.issuer);
        console2.log("Holder", actors.holder);
        console2.log("New holder", actors.newHolder);
        console2.log("Boardroom owner", actors.boardroomOwner);
        console2.log("Contractor", actors.contractor);
        console2.log("Investor", actors.investor);
        console2.log("Equity token", address(equity));
        console2.log("Cash token", address(cash));
        console2.log("Boardroom", address(boardroom));
        console2.log("Boardroom share token", boardroom.shareToken());
        console2.log("Boardroom rewards", address(boardroomRewards));
        console2.log("Boardroom reward amount", REWARD_AMOUNT);
        console2.log("Boardroom reward stake", REWARD_STAKE);
        console2.log("Migrating curve", address(launch.curve));
        console2.log("Curve pool", launch.pool);
        console2.log("Curve locker", launch.locker);
        console2.log("Curve buyer one quote paid", launch.buyerOneQuotePaid);
        console2.log("Curve buyer two quote paid", launch.buyerTwoQuotePaid);
        console2.log("Curve quote reserve at migration", launch.quoteReserveAtMigration);
        console2.log("Curve quote to liquidity", launch.quoteToLiquidity);
        console2.log("Curve locked LP", launch.lockedLiquidity);
        console2.log("Employee option strike price", launch.optionStrikePrice);
        console2.log("Post migration buy count", launch.postMigrationBuyCount);
        console2.log("Post migration buy input", launch.postMigrationBuyInput);
        console2.log("Post migration buy output", launch.postMigrationBuyOutput);
        console2.log("Claimable locker fee 0", launch.claimableLockerFee0);
        console2.log("Claimable locker fee 1", launch.claimableLockerFee1);
        console2.log("Direct partially settled grant", address(grants.directPartiallySettled));
        console2.log("Direct transferred paid grant", address(grants.directTransferredPaid));
        console2.log("Direct halted grant", address(grants.directHalted));
        console2.log("Employee lead option grant", address(grants.employeeLeadOption));
        console2.log("Employee engineer option grant", address(grants.employeeEngineerOption));
        console2.log("Employee advisor option grant", address(grants.employeeAdvisorOption));
        console2.log("Seeded boardrooms", seededBoardrooms.length);
        for (uint256 i = 0; i < seededBoardrooms.length; i++) {
            console2.log("Seeded boardroom index", i);
            console2.log("Seeded boardroom name", seededBoardrooms[i].name);
            console2.log("Seeded boardroom address", address(seededBoardrooms[i].boardroom));
            console2.log("Seeded boardroom path", seededBoardrooms[i].path);
            console2.log("Seeded boardroom status", seededBoardrooms[i].status);
            console2.log("Seeded boardroom cash raised", seededBoardrooms[i].cashRaised);
        }
    }

    function _salt(string memory label) internal view returns (bytes32) {
        return keccak256(abi.encode("pledge.cash.local.seed", seedNonce, label));
    }

    function _check(bool condition, string memory label) internal pure {
        if (!condition) revert ScenarioInvariantFailed(label);
    }
}
