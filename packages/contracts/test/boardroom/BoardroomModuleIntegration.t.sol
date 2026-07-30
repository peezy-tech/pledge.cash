// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "solady/tokens/ERC20.sol";
import {WETH} from "solady/tokens/WETH.sol";
import {AmmFactory} from "../../src/amm/AmmFactory.sol";
import {AmmRouter} from "../../src/amm/AmmRouter.sol";
import {BondMarket} from "../../src/bonds/BondMarket.sol";
import {BondMarketFactory} from "../../src/bonds/BondMarketFactory.sol";
import {DutchAuctionSale} from "../../src/distribution/DutchAuctionSale.sol";
import {DistributionFactory} from "../../src/distribution/DistributionFactory.sol";
import {FixedPriceSale} from "../../src/distribution/FixedPriceSale.sol";
import {MerkleAirdrop} from "../../src/distribution/MerkleAirdrop.sol";
import {MigratingBondingCurve} from "../../src/distribution/MigratingBondingCurve.sol";
import {TokenGrant} from "../../src/grants/TokenGrant.sol";
import {TokenGrantFactory} from "../../src/grants/TokenGrantFactory.sol";
import {LockedLiquidity} from "../../src/liquidity/LockedLiquidity.sol";
import {LockedLiquidityFactory} from "../../src/liquidity/LockedLiquidityFactory.sol";
import {BoardroomCallbackLib, IBoardroomCallbackTarget} from "../../src/policy/BoardroomCallbackLib.sol";
import {BoardroomRewards} from "../../src/rewards/BoardroomRewards.sol";
import {BoardroomRewardsFactory} from "../../src/rewards/BoardroomRewardsFactory.sol";

contract ModuleCallbackTargetMock is IBoardroomCallbackTarget {
    bytes32 public facetSetHash;
    address public shareToken;
    address public policyRegistry;
    address public redemptionExcessRecipient;
    uint8 public status;
    uint8 public primaryMarketMode;
    uint256 public windDownStartedAt;
    bool public launched;
    bool public lockedLiquidityExitAllowed;
    bool public liquidityMutationAllowed = true;
    mapping(address => bool) public isIssuedDistribution;

    bytes4 public lastSelector;
    bytes32 public lastExpectedFacetSetHash;
    address public lastCaller;
    address public addressArg0;
    address public addressArg1;
    address public addressArg2;
    address public addressArg3;
    bytes32 public bytes32Arg0;
    bytes32 public bytes32Arg1;
    uint256 public uint256Arg;
    uint64 public uint64Arg;
    uint256 public callbackCount;

    error FacetSetHashMismatch(bytes32 expected, bytes32 actual);

    constructor(bytes32 facetSetHash_) {
        facetSetHash = facetSetHash_;
    }

    function setFacetSetHash(bytes32 nextFacetSetHash) external {
        facetSetHash = nextFacetSetHash;
    }

    function setShareToken(address shareToken_) external {
        shareToken = shareToken_;
    }

    function setPolicyRegistry(address policyRegistry_) external {
        policyRegistry = policyRegistry_;
    }

    function setIssuedDistribution(address distribution, bool issued) external {
        isIssuedDistribution[distribution] = issued;
    }

    function setStatus(uint8 status_, uint256 windDownStartedAt_) external {
        status = status_;
        windDownStartedAt = windDownStartedAt_;
    }

    function setPrimaryMarketState(bool launched_, uint8 primaryMarketMode_) external {
        launched = launched_;
        primaryMarketMode = primaryMarketMode_;
    }

    function setLiquidityPermissions(bool mutationAllowed, bool exitAllowed) external {
        liquidityMutationAllowed = mutationAllowed;
        lockedLiquidityExitAllowed = exitAllowed;
    }

    function setRedemptionExcessRecipient(address recipient) external {
        redemptionExcessRecipient = recipient;
    }

    function requireBondingCurveForfeitureVetoPower(address) external pure {}

    function reserveRedeemableAsset(bytes32 expectedFacetSetHash, address asset) external {
        _record(this.reserveRedeemableAsset.selector, expectedFacetSetHash);
        addressArg0 = asset;
    }

    function precommitBondingCurve(
        bytes32 expectedFacetSetHash,
        address curve,
        address quoteAsset,
        uint256 fundingAmount
    ) external {
        _record(this.precommitBondingCurve.selector, expectedFacetSetHash);
        addressArg0 = curve;
        addressArg1 = quoteAsset;
        uint256Arg = fundingAmount;
    }

    function recordGrantFromDistribution(bytes32 expectedFacetSetHash, address grant) external {
        _record(this.recordGrantFromDistribution.selector, expectedFacetSetHash);
        addressArg0 = grant;
    }

    function recordLockedLiquidityFromDistribution(bytes32 expectedFacetSetHash, address locker, address pool)
        external
    {
        _record(this.recordLockedLiquidityFromDistribution.selector, expectedFacetSetHash);
        addressArg0 = locker;
        addressArg1 = pool;
    }

    function settleBondingCurve(bytes32 expectedFacetSetHash) external {
        _record(this.settleBondingCurve.selector, expectedFacetSetHash);
    }

    function precommitProtocolLiquidity(
        bytes32 expectedFacetSetHash,
        address expectedLocker,
        address quoteAsset,
        address curve,
        bytes32 pairKey,
        bytes32 salt,
        uint64 expiresAt
    ) external {
        _record(this.precommitProtocolLiquidity.selector, expectedFacetSetHash);
        addressArg0 = expectedLocker;
        addressArg1 = quoteAsset;
        addressArg2 = curve;
        bytes32Arg0 = pairKey;
        bytes32Arg1 = salt;
        uint64Arg = expiresAt;
    }

    function activateProtocolLiquidity(
        bytes32 expectedFacetSetHash,
        address locker,
        address pool,
        address quoteAsset,
        address curve,
        bytes32 pairKey,
        bytes32 salt
    ) external {
        _record(this.activateProtocolLiquidity.selector, expectedFacetSetHash);
        addressArg0 = locker;
        addressArg1 = pool;
        addressArg2 = quoteAsset;
        addressArg3 = curve;
        bytes32Arg0 = pairKey;
        bytes32Arg1 = salt;
    }

    function releaseProtocolLiquidityReservation(
        bytes32 expectedFacetSetHash,
        address curve,
        bytes32 pairKey,
        bytes32 salt
    ) external {
        _record(this.releaseProtocolLiquidityReservation.selector, expectedFacetSetHash);
        addressArg0 = curve;
        bytes32Arg0 = pairKey;
        bytes32Arg1 = salt;
    }

    function closeProtocolLiquidityFromFactory(bytes32 expectedFacetSetHash, address locker) external {
        _record(this.closeProtocolLiquidityFromFactory.selector, expectedFacetSetHash);
        addressArg0 = locker;
    }

    function _record(bytes4 selector, bytes32 expectedFacetSetHash) internal {
        bytes32 actualFacetSetHash = facetSetHash;
        if (expectedFacetSetHash != actualFacetSetHash) {
            revert FacetSetHashMismatch(expectedFacetSetHash, actualFacetSetHash);
        }

        lastSelector = selector;
        lastExpectedFacetSetHash = expectedFacetSetHash;
        lastCaller = msg.sender;
        addressArg0 = address(0);
        addressArg1 = address(0);
        addressArg2 = address(0);
        addressArg3 = address(0);
        bytes32Arg0 = bytes32(0);
        bytes32Arg1 = bytes32(0);
        uint256Arg = 0;
        uint64Arg = 0;
        ++callbackCount;
    }
}

contract BoardroomCallbackHarness {
    function reserveRedeemableAsset(address boardroom, address asset) external {
        BoardroomCallbackLib.reserveRedeemableAsset(boardroom, asset);
    }

    function precommitBondingCurve(address boardroom, address curve, address quoteAsset, uint256 fundingAmount)
        external
    {
        BoardroomCallbackLib.precommitBondingCurve(boardroom, curve, quoteAsset, fundingAmount);
    }

    function recordGrantFromDistribution(address boardroom, address grant) external {
        BoardroomCallbackLib.recordGrantFromDistribution(boardroom, grant);
    }

    function recordLockedLiquidityFromDistribution(address boardroom, address locker, address pool) external {
        BoardroomCallbackLib.recordLockedLiquidityFromDistribution(boardroom, locker, pool);
    }

    function settleBondingCurve(address boardroom) external {
        BoardroomCallbackLib.settleBondingCurve(boardroom);
    }

    function precommitProtocolLiquidity(
        address boardroom,
        address expectedLocker,
        address quoteAsset,
        address curve,
        bytes32 pairKey,
        bytes32 salt,
        uint64 expiresAt
    ) external {
        BoardroomCallbackLib.precommitProtocolLiquidity(
            boardroom, expectedLocker, quoteAsset, curve, pairKey, salt, expiresAt
        );
    }

    function activateProtocolLiquidity(
        address boardroom,
        address locker,
        address pool,
        address quoteAsset,
        address curve,
        bytes32 pairKey,
        bytes32 salt
    ) external {
        BoardroomCallbackLib.activateProtocolLiquidity(boardroom, locker, pool, quoteAsset, curve, pairKey, salt);
    }

    function releaseProtocolLiquidityReservation(address boardroom, address curve, bytes32 pairKey, bytes32 salt)
        external
    {
        BoardroomCallbackLib.releaseProtocolLiquidityReservation(boardroom, curve, pairKey, salt);
    }

    function closeProtocolLiquidityFromFactory(address boardroom, address locker) external {
        BoardroomCallbackLib.closeProtocolLiquidityFromFactory(boardroom, locker);
    }
}

contract ModuleCanonicalFactoryMock {
    mapping(address => bool) public isBoardroom;
    mapping(address => bool) public isShareToken;

    function setBoardroom(address boardroom, bool canonical) external {
        isBoardroom[boardroom] = canonical;
    }

    function setShareToken(address shareToken, bool canonical) external {
        isShareToken[shareToken] = canonical;
    }
}

contract ModulePolicyRegistryMock {
    mapping(address => bool) public isModulePolicy;

    function setModulePolicy(address module, bool allowed) external {
        isModulePolicy[module] = allowed;
    }
}

contract ModuleToken is ERC20 {
    address public immutable boardroom;
    string internal tokenName;
    string internal tokenSymbol;
    uint8 internal tokenDecimals;

    mapping(address => bool) public isEncumberedAccount;
    mapping(address => uint256) public lockedStakeBalance;

    constructor(string memory name_, string memory symbol_, uint8 decimals_, address boardroom_) {
        tokenName = name_;
        tokenSymbol = symbol_;
        tokenDecimals = decimals_;
        boardroom = boardroom_;
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

    function lockStake(address account, uint256 amount) external {
        lockedStakeBalance[account] += amount;
    }

    function unlockStake(address account, uint256 amount) external {
        lockedStakeBalance[account] -= amount;
    }
}

contract ModuleAmmFactoryIdentityMock {
    address public immutable boardroomFactory;

    constructor(address boardroomFactory_) {
        boardroomFactory = boardroomFactory_;
    }

    function isPool(address) external pure returns (bool) {
        return false;
    }
}

contract ModuleAmmRouterIdentityMock {
    address public immutable factory;

    constructor(address factory_) {
        factory = factory_;
    }

    function poolFor(address, address) external pure returns (address) {
        return address(0);
    }
}

contract BoardroomModuleIntegrationTest is Test {
    bytes32 internal constant RELEASE_A = keccak256("release-a");
    bytes32 internal constant RELEASE_B = keccak256("release-b");

    address internal constant ASSET = address(0xA55E7);
    address internal constant CURVE = address(0xC0A0E);
    address internal constant GRANT = address(0x6A4A7);
    address internal constant LOCKER = address(0x10CC);
    address internal constant POOL = address(0xB001);
    address internal constant QUOTE_ASSET = address(0x9007E);
    bytes32 internal constant PAIR_KEY = keccak256("pair");
    bytes32 internal constant SALT = keccak256("salt");

    ModuleCallbackTargetMock internal target;
    BoardroomCallbackHarness internal harness;

    function setUp() public {
        target = new ModuleCallbackTargetMock(RELEASE_A);
        harness = new BoardroomCallbackHarness();
    }

    function testAssetAndDistributionCallbacksBindCurrentHashAndPreserveCaller() public {
        harness.reserveRedeemableAsset(address(target), ASSET);
        _assertCallback(ModuleCallbackTargetMock.reserveRedeemableAsset.selector, RELEASE_A, 1);
        assertEq(target.addressArg0(), ASSET);

        target.setFacetSetHash(RELEASE_B);
        harness.precommitBondingCurve(address(target), CURVE, QUOTE_ASSET, 42 ether);
        _assertCallback(ModuleCallbackTargetMock.precommitBondingCurve.selector, RELEASE_B, 2);
        assertEq(target.addressArg0(), CURVE);
        assertEq(target.addressArg1(), QUOTE_ASSET);
        assertEq(target.uint256Arg(), 42 ether);

        harness.recordGrantFromDistribution(address(target), GRANT);
        _assertCallback(ModuleCallbackTargetMock.recordGrantFromDistribution.selector, RELEASE_B, 3);
        assertEq(target.addressArg0(), GRANT);

        harness.recordLockedLiquidityFromDistribution(address(target), LOCKER, POOL);
        _assertCallback(ModuleCallbackTargetMock.recordLockedLiquidityFromDistribution.selector, RELEASE_B, 4);
        assertEq(target.addressArg0(), LOCKER);
        assertEq(target.addressArg1(), POOL);

        harness.settleBondingCurve(address(target));
        _assertCallback(ModuleCallbackTargetMock.settleBondingCurve.selector, RELEASE_B, 5);
    }

    function testLiquidityCallbacksBindCurrentHashAndPreserveCaller() public {
        harness.precommitProtocolLiquidity(
            address(target), LOCKER, QUOTE_ASSET, CURVE, PAIR_KEY, SALT, uint64(block.timestamp + 1 days)
        );
        _assertCallback(ModuleCallbackTargetMock.precommitProtocolLiquidity.selector, RELEASE_A, 1);
        assertEq(target.addressArg0(), LOCKER);
        assertEq(target.addressArg1(), QUOTE_ASSET);
        assertEq(target.addressArg2(), CURVE);
        assertEq(target.bytes32Arg0(), PAIR_KEY);
        assertEq(target.bytes32Arg1(), SALT);
        assertEq(target.uint64Arg(), uint64(block.timestamp + 1 days));

        target.setFacetSetHash(RELEASE_B);
        harness.activateProtocolLiquidity(address(target), LOCKER, POOL, QUOTE_ASSET, CURVE, PAIR_KEY, SALT);
        _assertCallback(ModuleCallbackTargetMock.activateProtocolLiquidity.selector, RELEASE_B, 2);
        assertEq(target.addressArg0(), LOCKER);
        assertEq(target.addressArg1(), POOL);
        assertEq(target.addressArg2(), QUOTE_ASSET);
        assertEq(target.addressArg3(), CURVE);
        assertEq(target.bytes32Arg0(), PAIR_KEY);
        assertEq(target.bytes32Arg1(), SALT);

        harness.releaseProtocolLiquidityReservation(address(target), CURVE, PAIR_KEY, SALT);
        _assertCallback(ModuleCallbackTargetMock.releaseProtocolLiquidityReservation.selector, RELEASE_B, 3);
        assertEq(target.addressArg0(), CURVE);
        assertEq(target.bytes32Arg0(), PAIR_KEY);
        assertEq(target.bytes32Arg1(), SALT);

        harness.closeProtocolLiquidityFromFactory(address(target), LOCKER);
        _assertCallback(ModuleCallbackTargetMock.closeProtocolLiquidityFromFactory.selector, RELEASE_B, 4);
        assertEq(target.addressArg0(), LOCKER);
    }

    function testFactoriesAcceptOneCoherentBoardroomIdentity() public {
        ModuleCanonicalFactoryMock canonicalFactory = new ModuleCanonicalFactoryMock();
        ModuleAmmFactoryIdentityMock ammFactory = new ModuleAmmFactoryIdentityMock(address(canonicalFactory));
        ModuleAmmRouterIdentityMock ammRouter = new ModuleAmmRouterIdentityMock(address(ammFactory));

        LockedLiquidityFactory liquidityFactory =
            new LockedLiquidityFactory(address(ammRouter), address(canonicalFactory));
        TokenGrantFactory grantFactory = new TokenGrantFactory(address(this), address(canonicalFactory));
        DistributionFactory distributionFactory =
            new DistributionFactory(address(liquidityFactory), address(grantFactory));
        BondMarketFactory bondFactory = new BondMarketFactory(address(ammFactory), address(canonicalFactory));
        BoardroomRewardsFactory rewardsFactory = new BoardroomRewardsFactory(address(canonicalFactory));

        assertEq(liquidityFactory.boardroomFactory(), address(canonicalFactory));
        assertEq(grantFactory.boardroomFactory(), address(canonicalFactory));
        assertEq(distributionFactory.boardroomFactory(), address(canonicalFactory));
        assertEq(bondFactory.boardroomFactory(), address(canonicalFactory));
        assertEq(rewardsFactory.boardroomFactory(), address(canonicalFactory));
        assertGt(liquidityFactory.lockedLiquidityLogic().code.length, 0);
        assertGt(grantFactory.tokenGrantLogic().code.length, 0);
        assertGt(distributionFactory.migratingBondingCurveLogic().code.length, 0);
        assertGt(distributionFactory.merkleAirdropLogic().code.length, 0);
        assertGt(bondFactory.bondMarketLogic().code.length, 0);
        assertGt(rewardsFactory.rewardsLogic().code.length, 0);
    }

    function testFactoriesRejectMixedBoardroomIdentities() public {
        ModuleCanonicalFactoryMock canonicalFactory = new ModuleCanonicalFactoryMock();
        ModuleCanonicalFactoryMock otherFactory = new ModuleCanonicalFactoryMock();
        ModuleAmmFactoryIdentityMock ammFactory = new ModuleAmmFactoryIdentityMock(address(canonicalFactory));
        ModuleAmmRouterIdentityMock ammRouter = new ModuleAmmRouterIdentityMock(address(ammFactory));

        vm.expectRevert(
            abi.encodeWithSelector(
                BondMarketFactory.IncoherentFactoryIdentity.selector, address(otherFactory), address(canonicalFactory)
            )
        );
        new BondMarketFactory(address(ammFactory), address(otherFactory));

        vm.expectRevert(
            abi.encodeWithSelector(
                LockedLiquidityFactory.IncoherentFactoryIdentity.selector,
                address(otherFactory),
                address(canonicalFactory)
            )
        );
        new LockedLiquidityFactory(address(ammRouter), address(otherFactory));

        LockedLiquidityFactory liquidityFactory =
            new LockedLiquidityFactory(address(ammRouter), address(canonicalFactory));
        TokenGrantFactory grantFactory = new TokenGrantFactory(address(this), address(otherFactory));
        vm.expectRevert(
            abi.encodeWithSelector(
                DistributionFactory.IncoherentFactoryIdentity.selector, address(otherFactory), address(canonicalFactory)
            )
        );
        new DistributionFactory(address(liquidityFactory), address(grantFactory));
    }

    function _assertCallback(bytes4 selector, bytes32 expectedFacetSetHash, uint256 expectedCount) internal view {
        assertEq(target.lastSelector(), selector);
        assertEq(target.lastExpectedFacetSetHash(), expectedFacetSetHash);
        assertEq(target.lastCaller(), address(harness));
        assertEq(target.callbackCount(), expectedCount);
    }
}

contract BoardroomRealModuleIntegrationTest is Test {
    bytes32 internal constant RELEASE_HASH = keccak256("module-parity-release");
    bytes32 internal constant RELEASE_B_HASH = keccak256("module-parity-release-b");
    bytes32 internal constant DIRECT_CLAIM_TYPEHASH = keccak256(
        "MerkleAirdropDirectClaim(bytes32 expectedFacetSetHash,uint256 chainId,uint256 index,address airdrop,address boardroom,address shareToken,address account,uint256 amount)"
    );
    bytes32 internal constant GRANT_CLAIM_TYPEHASH = keccak256(
        "MerkleAirdropGrantClaim(bytes32 expectedFacetSetHash,uint256 chainId,uint256 index,address airdrop,address boardroom,address shareToken,address tokenGrantFactory,address account,uint256 amount,bytes32 termsHash)"
    );
    bytes32 internal constant GRANT_TERMS_TYPEHASH = keccak256(
        "MerkleAirdropGrantTerms(address paymentToken,uint256 price,uint256 expiry,uint256 vestingCliff,uint256 vestingEnd,bool transferable,uint256 transferUnlockTime,bytes32 salt)"
    );

    uint256 internal constant SALE_SHARES = 1_000 ether;
    uint256 internal constant PRICE = 2 ether;
    uint256 internal constant CURVE_SALE_SHARES = 500 ether;
    uint256 internal constant CURVE_MIGRATION_SHARES = 500 ether;
    uint256 internal constant CURVE_GRADUATION_TARGET = 500 ether;

    address internal buyer = address(0xB0B);
    address internal recipient = address(0xC0FFEE);
    address internal keeper = address(0xCAFE);

    ModuleCallbackTargetMock internal boardroom;
    ModuleCanonicalFactoryMock internal canonicalFactory;
    ModulePolicyRegistryMock internal policyRegistry;
    ModuleToken internal shares;
    ModuleToken internal quote;
    WETH internal wrappedNative;
    AmmFactory internal ammFactory;
    AmmRouter internal ammRouter;
    LockedLiquidityFactory internal liquidityFactory;
    TokenGrantFactory internal grantFactory;
    DistributionFactory internal distributionFactory;
    BondMarketFactory internal bondFactory;
    BoardroomRewardsFactory internal rewardsFactory;

    function setUp() public {
        boardroom = new ModuleCallbackTargetMock(RELEASE_HASH);
        canonicalFactory = new ModuleCanonicalFactoryMock();
        policyRegistry = new ModulePolicyRegistryMock();
        shares = new ModuleToken("Boardroom Share", "SHARE", 18, address(boardroom));
        quote = new ModuleToken("Quote Asset", "QUOTE", 18, address(0));
        wrappedNative = new WETH();

        boardroom.setShareToken(address(shares));
        boardroom.setPolicyRegistry(address(policyRegistry));
        boardroom.setRedemptionExcessRecipient(address(0xEACE55));
        canonicalFactory.setBoardroom(address(boardroom), true);
        canonicalFactory.setShareToken(address(shares), true);

        ammFactory = new AmmFactory(address(this), address(canonicalFactory));
        ammRouter = new AmmRouter(address(ammFactory), address(wrappedNative));
        liquidityFactory = new LockedLiquidityFactory(address(ammRouter), address(canonicalFactory));
        ammFactory.setLiquidityRouter(address(ammRouter));
        ammFactory.setReservationManager(address(liquidityFactory));

        grantFactory = new TokenGrantFactory(address(this), address(canonicalFactory));
        distributionFactory = new DistributionFactory(address(liquidityFactory), address(grantFactory));
        bondFactory = new BondMarketFactory(address(ammFactory), address(canonicalFactory));
        rewardsFactory = new BoardroomRewardsFactory(address(canonicalFactory));
        policyRegistry.setModulePolicy(address(distributionFactory), true);

        shares.mint(address(boardroom), 100_000 ether);
        shares.mint(recipient, 1_000 ether);
        quote.mint(address(boardroom), 100_000 ether);
        quote.mint(buyer, 100_000 ether);
        quote.mint(recipient, 100_000 ether);
    }

    function testRealFixedPriceAndDutchAuctionCreateTradeAndClose() public {
        _approveAsBoardroom(address(shares), address(distributionFactory), 2 * SALE_SHARES);

        FixedPriceSale.CreateParams memory fixedParams = FixedPriceSale.CreateParams({
            shareToken: address(shares),
            paymentToken: address(quote),
            shareAmount: SALE_SHARES,
            price: PRICE,
            maxPerBuyer: 0,
            startTime: uint64(block.timestamp),
            endTime: 0,
            salt: keccak256("real-fixed")
        });
        vm.prank(address(boardroom));
        FixedPriceSale sale = FixedPriceSale(distributionFactory.createFixedPriceSale(fixedParams));

        vm.startPrank(buyer);
        quote.approve(address(sale), 20 ether);
        uint256 fixedPayment = sale.buy(10 ether, buyer, 20 ether, block.timestamp);
        vm.stopPrank();
        assertEq(fixedPayment, 20 ether);
        assertEq(shares.balanceOf(buyer), 10 ether);

        vm.prank(address(boardroom));
        sale.close();
        assertTrue(sale.isClosed());
        assertEq(sale.factory(), address(distributionFactory));

        DutchAuctionSale.CreateParams memory auctionParams = DutchAuctionSale.CreateParams({
            shareToken: address(shares),
            paymentToken: address(quote),
            shareAmount: SALE_SHARES,
            startPrice: 4 ether,
            floorPrice: 2 ether,
            maxPerBuyer: 0,
            startTime: uint64(block.timestamp),
            endTime: uint64(block.timestamp + 10 days),
            salt: keccak256("real-auction")
        });
        vm.prank(address(boardroom));
        DutchAuctionSale auction = DutchAuctionSale(distributionFactory.createDutchAuction(auctionParams));

        vm.startPrank(buyer);
        quote.approve(address(auction), 40 ether);
        uint256 auctionPayment = auction.buy(10 ether, buyer, 40 ether, block.timestamp);
        vm.stopPrank();
        assertEq(auctionPayment, 40 ether);

        vm.warp(auction.endTime());
        auction.finalize();
        assertTrue(auction.isClosed());
        assertEq(auction.factory(), address(distributionFactory));
        assertEq(boardroom.lastSelector(), ModuleCallbackTargetMock.reserveRedeemableAsset.selector);
        assertEq(boardroom.lastCaller(), address(distributionFactory));
        assertEq(boardroom.lastExpectedFacetSetHash(), RELEASE_HASH);
    }

    function testDistributionFactoryRejectsBoardroomShapedNonCanonicalCaller() public {
        canonicalFactory.setBoardroom(address(boardroom), false);
        FixedPriceSale.CreateParams memory params = FixedPriceSale.CreateParams({
            shareToken: address(shares),
            paymentToken: address(quote),
            shareAmount: SALE_SHARES,
            price: PRICE,
            maxPerBuyer: 0,
            startTime: uint64(block.timestamp),
            endTime: 0,
            salt: keccak256("noncanonical-fixed")
        });

        vm.prank(address(boardroom));
        vm.expectRevert(abi.encodeWithSelector(DistributionFactory.InvalidBoardroom.selector, address(boardroom)));
        distributionFactory.createFixedPriceSale(params);
    }

    function testRealMerkleGrantClaimSettlesAndCloses() public {
        uint256 grantShares = 125 ether;
        uint256 airdropShares = 300 ether;
        bytes32 salt = keccak256("real-airdrop");
        address predicted = distributionFactory.predictMerkleAirdropAddress(address(boardroom), salt);
        MerkleAirdrop.GrantClaimParams memory grantParams = MerkleAirdrop.GrantClaimParams({
            paymentToken: address(quote),
            price: PRICE,
            expiry: block.timestamp + 2 days,
            vestingCliff: block.timestamp,
            vestingEnd: block.timestamp,
            transferable: false,
            transferUnlockTime: 0,
            salt: keccak256("real-airdrop-grant")
        });
        bytes32 root = _grantClaimLeaf(predicted, RELEASE_HASH, 0, recipient, grantShares, grantParams);
        MerkleAirdrop.CreateParams memory params = MerkleAirdrop.CreateParams({
            shareToken: address(shares),
            shareAmount: airdropShares,
            merkleRoot: root,
            startTime: uint64(block.timestamp),
            endTime: 0,
            maxGrantClaims: 1,
            salt: salt
        });

        _approveAsBoardroom(address(shares), address(distributionFactory), airdropShares);
        vm.prank(address(boardroom));
        MerkleAirdrop airdrop = MerkleAirdrop(distributionFactory.createMerkleAirdrop(params));
        boardroom.setIssuedDistribution(address(airdrop), true);

        vm.prank(recipient);
        TokenGrant grant =
            TokenGrant(airdrop.claimGrant(RELEASE_HASH, 0, recipient, grantShares, grantParams, new bytes32[](0)));
        assertEq(grant.factory(), address(grantFactory));
        assertEq(grant.issuer(), address(boardroom));
        assertEq(grant.holder(), recipient);
        assertEq(shares.balanceOf(address(grant)), grantShares);
        assertEq(boardroom.lastSelector(), ModuleCallbackTargetMock.recordGrantFromDistribution.selector);
        assertEq(boardroom.lastCaller(), address(airdrop));
        assertEq(boardroom.lastExpectedFacetSetHash(), RELEASE_HASH);

        vm.startPrank(recipient);
        quote.approve(address(grant), 250 ether);
        grant.settle(grantShares);
        vm.stopPrank();
        assertTrue(grant.isClosed());
        assertEq(shares.balanceOf(recipient), 1_000 ether + grantShares);
        assertEq(quote.balanceOf(address(boardroom)), 100_000 ether + 250 ether);

        vm.prank(address(boardroom));
        airdrop.close();
        assertTrue(airdrop.isClosed());
        assertEq(shares.balanceOf(address(airdrop)), 0);

        assertEq(airdrop.DIRECT_CLAIM_TYPEHASH(), DIRECT_CLAIM_TYPEHASH);
        assertEq(airdrop.GRANT_CLAIM_TYPEHASH(), GRANT_CLAIM_TYPEHASH);
        assertEq(airdrop.GRANT_TERMS_TYPEHASH(), GRANT_TERMS_TYPEHASH);
    }

    function testMerkleDirectClaimRejectsStaleReleaseProofAndAcceptsCurrentReleaseProof() public {
        uint256 claimShares = 25 ether;
        bytes32 salt = keccak256("release-bound-direct-airdrop");
        address predicted = distributionFactory.predictMerkleAirdropAddress(address(boardroom), salt);
        bytes32 releaseALeaf = _directClaimLeaf(predicted, RELEASE_HASH, 0, recipient, claimShares);
        bytes32 releaseBLeaf = _directClaimLeaf(predicted, RELEASE_B_HASH, 1, recipient, claimShares);
        MerkleAirdrop.CreateParams memory params = MerkleAirdrop.CreateParams({
            shareToken: address(shares),
            shareAmount: 2 * claimShares,
            merkleRoot: _hashPair(releaseALeaf, releaseBLeaf),
            startTime: uint64(block.timestamp),
            endTime: 0,
            maxGrantClaims: 0,
            salt: salt
        });

        _approveAsBoardroom(address(shares), address(distributionFactory), params.shareAmount);
        vm.prank(address(boardroom));
        MerkleAirdrop airdrop = MerkleAirdrop(distributionFactory.createMerkleAirdrop(params));
        boardroom.setFacetSetHash(RELEASE_B_HASH);

        bytes32[] memory releaseAProof = new bytes32[](1);
        releaseAProof[0] = releaseBLeaf;
        uint256 recipientBalanceBefore = shares.balanceOf(recipient);
        vm.expectRevert(
            abi.encodeWithSelector(MerkleAirdrop.FacetSetHashMismatch.selector, RELEASE_HASH, RELEASE_B_HASH)
        );
        airdrop.claim(RELEASE_HASH, 0, recipient, claimShares, releaseAProof);

        assertFalse(airdrop.isClaimed(0));
        assertEq(airdrop.claimedShares(), 0);
        assertEq(airdrop.remainingShares(), params.shareAmount);
        assertEq(shares.balanceOf(recipient), recipientBalanceBefore);

        bytes32[] memory releaseBProof = new bytes32[](1);
        releaseBProof[0] = releaseALeaf;
        airdrop.claim(RELEASE_B_HASH, 1, recipient, claimShares, releaseBProof);

        assertTrue(airdrop.isClaimed(1));
        assertEq(airdrop.claimedShares(), claimShares);
        assertEq(airdrop.remainingShares(), claimShares);
        assertEq(shares.balanceOf(recipient), recipientBalanceBefore + claimShares);
    }

    function testMerkleGrantClaimRejectsStaleReleaseBeforeGrantOrObligationSideEffects() public {
        uint256 grantShares = 40 ether;
        MerkleAirdrop.GrantClaimParams memory grantParams = MerkleAirdrop.GrantClaimParams({
            paymentToken: address(quote),
            price: PRICE,
            expiry: block.timestamp + 2 days,
            vestingCliff: block.timestamp,
            vestingEnd: block.timestamp,
            transferable: false,
            transferUnlockTime: 0,
            salt: keccak256("release-bound-grant")
        });
        (MerkleAirdrop airdrop, bytes32 releaseALeaf, bytes32 releaseBLeaf) =
            _createReleaseBoundGrantAirdrop(grantShares, grantParams);
        boardroom.setIssuedDistribution(address(airdrop), true);
        boardroom.setFacetSetHash(RELEASE_B_HASH);

        _assertStaleGrantClaimHasNoSideEffects(airdrop, grantShares, grantParams, releaseBLeaf);

        uint256 callbackCountBefore = boardroom.callbackCount();
        bytes32[] memory releaseBProof = new bytes32[](1);
        releaseBProof[0] = releaseALeaf;
        TokenGrant grant =
            TokenGrant(airdrop.claimGrant(RELEASE_B_HASH, 1, recipient, grantShares, grantParams, releaseBProof));

        assertTrue(airdrop.isClaimed(1));
        assertEq(airdrop.claimedGrantCount(), 1);
        assertEq(shares.balanceOf(address(grant)), grantShares);
        assertEq(boardroom.callbackCount(), callbackCountBefore + 1);
        assertEq(boardroom.lastExpectedFacetSetHash(), RELEASE_B_HASH);
        assertEq(boardroom.lastSelector(), ModuleCallbackTargetMock.recordGrantFromDistribution.selector);
    }

    function _assertStaleGrantClaimHasNoSideEffects(
        MerkleAirdrop airdrop,
        uint256 grantShares,
        MerkleAirdrop.GrantClaimParams memory grantParams,
        bytes32 releaseBLeaf
    ) internal {
        bytes32 releaseAGrantSalt = airdrop.getGrantSalt(0, recipient, grantParams.salt);
        address predictedReleaseAGrant = grantFactory.predictGrantAddress(address(boardroom), releaseAGrantSalt);
        bytes32[] memory releaseAProof = new bytes32[](1);
        releaseAProof[0] = releaseBLeaf;
        uint256 callbackCountBefore = boardroom.callbackCount();
        vm.expectRevert(
            abi.encodeWithSelector(MerkleAirdrop.FacetSetHashMismatch.selector, RELEASE_HASH, RELEASE_B_HASH)
        );
        airdrop.claimGrant(RELEASE_HASH, 0, recipient, grantShares, grantParams, releaseAProof);

        assertFalse(airdrop.isClaimed(0));
        assertEq(airdrop.claimedGrantCount(), 0);
        assertEq(airdrop.claimedShares(), 0);
        assertEq(airdrop.remainingShares(), 2 * grantShares);
        assertEq(predictedReleaseAGrant.code.length, 0);
        assertEq(boardroom.callbackCount(), callbackCountBefore);
    }

    function testRealBondMarketPurchasesRedeemsAndCloses() public {
        uint256 capacity = 1_000 ether;
        BondMarket.CreateParams memory params = BondMarket.CreateParams({
            quoteToken: address(quote),
            kind: BondMarket.MarketKind.Reserve,
            capacity: capacity,
            initialPrice: PRICE,
            minimumPrice: 1 ether,
            debtBuffer: 10_000,
            vesting: uint48(1 days),
            start: 0,
            duration: uint32(5 days),
            depositInterval: uint32(1 days),
            salt: keccak256("real-bond")
        });

        _approveAsBoardroom(address(shares), address(bondFactory), capacity);
        vm.prank(address(boardroom));
        BondMarket market = BondMarket(bondFactory.createBondMarket(params));
        assertEq(market.factory(), address(bondFactory));
        assertEq(shares.balanceOf(address(market)), capacity);
        assertEq(boardroom.lastSelector(), ModuleCallbackTargetMock.reserveRedeemableAsset.selector);
        assertEq(boardroom.lastCaller(), address(bondFactory));

        vm.startPrank(buyer);
        quote.approve(address(market), 20 ether);
        (uint256 positionId, uint256 payout,) = market.purchase(20 ether, 0, block.timestamp);
        vm.stopPrank();
        assertGt(payout, 0);

        vm.prank(address(boardroom));
        market.close();
        (,, uint48 maturity,) = market.positions(positionId);
        vm.warp(maturity);
        vm.prank(keeper);
        market.redeem(positionId);

        assertTrue(market.isClosed());
        assertEq(shares.balanceOf(buyer), payout);
        assertEq(quote.balanceOf(address(boardroom)), 100_000 ether + 20 ether);
    }

    function testRealRewardsFundAccrueClaimAndTerminalize() public {
        vm.prank(address(boardroom));
        BoardroomRewards rewards =
            BoardroomRewards(rewardsFactory.createRewards(uint64(7 days), keccak256("real-rewards")));

        uint256 funded = 86_400 ether;
        _approveAsBoardroom(address(quote), address(rewardsFactory), funded);
        vm.prank(address(boardroom));
        rewardsFactory.fundReward(address(rewards), address(quote), funded, 1 days);
        assertEq(boardroom.lastSelector(), ModuleCallbackTargetMock.reserveRedeemableAsset.selector);
        assertEq(boardroom.lastCaller(), address(rewardsFactory));

        vm.prank(recipient);
        rewards.stake(100 ether);
        vm.warp(block.timestamp + 100);
        assertEq(rewards.earned(recipient, address(quote)), 100 ether);

        boardroom.setStatus(1, block.timestamp);
        rewards.terminalize();
        assertTrue(rewards.terminalized());

        vm.prank(recipient);
        uint256 claimed = rewards.claim(address(quote), recipient);
        assertEq(claimed, 100 ether);
        assertEq(rewards.factory(), address(rewardsFactory));
        assertEq(shares.lockedStakeBalance(recipient), 100 ether);
    }

    function testRealLockedLiquidityCreatesAddsRemovesAndCloses() public {
        uint256 seed = 100 ether;
        _approveAsBoardroom(address(shares), address(liquidityFactory), seed);
        _approveAsBoardroom(address(quote), address(liquidityFactory), seed);
        LockedLiquidityFactory.CreateParams memory createParams = LockedLiquidityFactory.CreateParams({
            tokenA: address(shares),
            tokenB: address(quote),
            amountADesired: seed,
            amountBDesired: seed,
            amountAMin: seed,
            amountBMin: seed,
            deadline: block.timestamp,
            salt: keccak256("real-liquidity")
        });

        vm.prank(address(boardroom));
        (address lockerAddress, address pool, uint256 amountA, uint256 amountB, uint256 liquidity) =
            liquidityFactory.createLockedLiquidity(createParams);
        LockedLiquidity locker = LockedLiquidity(lockerAddress);
        assertEq(amountA, seed);
        assertEq(amountB, seed);
        assertEq(locker.lockedLiquidity(), liquidity);
        assertEq(locker.pool(), pool);
        assertEq(boardroom.callbackCount(), 2);
        assertEq(boardroom.lastSelector(), ModuleCallbackTargetMock.activateProtocolLiquidity.selector);
        assertEq(boardroom.lastCaller(), address(liquidityFactory));
        assertEq(boardroom.addressArg0(), lockerAddress);
        assertEq(boardroom.addressArg1(), pool);

        uint256 added = 10 ether;
        _approveAsBoardroom(address(shares), address(liquidityFactory), added);
        _approveAsBoardroom(address(quote), address(liquidityFactory), added);
        LockedLiquidityFactory.AddParams memory addParams = LockedLiquidityFactory.AddParams({
            tokenA: address(shares),
            tokenB: address(quote),
            amountADesired: added,
            amountBDesired: added,
            amountAMin: added,
            amountBMin: added,
            deadline: block.timestamp
        });
        vm.prank(address(boardroom));
        liquidityFactory.addLockedLiquidity(addParams);

        uint256 allLiquidity = locker.lockedLiquidity();
        vm.prank(address(boardroom));
        liquidityFactory.removeLockedLiquidity(
            LockedLiquidityFactory.RemoveParams({
                liquidity: allLiquidity, amountAMin: 0, amountBMin: 0, deadline: block.timestamp
            })
        );
        assertEq(locker.lockedLiquidity(), 0);

        vm.prank(address(boardroom));
        liquidityFactory.closeLockedLiquidity();
        assertTrue(locker.isClosed());
        (,,, LockedLiquidityFactory.PositionStatus status) = liquidityFactory.positionOfBoardroom(address(boardroom));
        assertEq(uint256(status), uint256(LockedLiquidityFactory.PositionStatus.Closed));
        assertEq(boardroom.lastSelector(), ModuleCallbackTargetMock.closeProtocolLiquidityFromFactory.selector);
        assertEq(boardroom.lastCaller(), address(liquidityFactory));
    }

    function testRealMigratingCurveCreatesTradesCancelsAndSettles() public {
        uint256 totalShares = CURVE_SALE_SHARES + CURVE_MIGRATION_SHARES;
        bytes32 salt = keccak256("real-curve");
        MigratingBondingCurve.CreateParams memory params = MigratingBondingCurve.CreateParams({
            shareToken: address(shares),
            quoteToken: address(quote),
            saleSupply: CURVE_SALE_SHARES,
            migrationSupply: CURVE_MIGRATION_SHARES,
            basePrice: PRICE,
            slope: 0,
            graduationQuoteTarget: CURVE_GRADUATION_TARGET,
            quoteToLpBps: 5_000,
            startTime: uint64(block.timestamp),
            endTime: uint64(block.timestamp + 30 days),
            migrationSalt: keccak256(abi.encodePacked(salt, "migration")),
            salt: salt
        });

        _approveAsBoardroom(address(shares), address(distributionFactory), totalShares);
        vm.prank(address(boardroom));
        MigratingBondingCurve curve = MigratingBondingCurve(distributionFactory.createMigratingBondingCurve(params));
        boardroom.setIssuedDistribution(address(curve), true);
        assertEq(curve.factory(), address(distributionFactory));
        assertEq(shares.balanceOf(address(curve)), totalShares);
        assertEq(boardroom.lastSelector(), ModuleCallbackTargetMock.precommitProtocolLiquidity.selector);
        assertEq(boardroom.lastCaller(), address(liquidityFactory));

        vm.startPrank(buyer);
        quote.approve(address(curve), 20 ether);
        uint256 paid = curve.buy(10 ether, buyer, 20 ether, block.timestamp);
        vm.stopPrank();
        assertEq(paid, 20 ether);
        assertEq(curve.outstandingCurveShareLiability(), 10 ether);

        vm.prank(address(boardroom));
        curve.cancel();
        assertEq(uint256(curve.curveStatus()), uint256(MigratingBondingCurve.CurvePhase.Unwinding));

        vm.warp(curve.phaseEndsAt() + 1);
        curve.finalizeUnwind();
        assertTrue(curve.isClosed());
        assertFalse(curve.migrationReservationHeld());
        assertEq(boardroom.lastSelector(), ModuleCallbackTargetMock.settleBondingCurve.selector);
        assertEq(boardroom.lastCaller(), address(curve));
        assertEq(boardroom.lastExpectedFacetSetHash(), RELEASE_HASH);

        (address reservedCurve,,,,,,) = liquidityFactory.migrationReservationOf(address(boardroom));
        assertEq(reservedCurve, address(0));
    }

    function _approveAsBoardroom(address token, address spender, uint256 amount) internal {
        vm.prank(address(boardroom));
        ERC20(token).approve(spender, amount);
    }

    function _createReleaseBoundGrantAirdrop(uint256 grantShares, MerkleAirdrop.GrantClaimParams memory grantParams)
        internal
        returns (MerkleAirdrop airdrop, bytes32 releaseALeaf, bytes32 releaseBLeaf)
    {
        bytes32 salt = keccak256("release-bound-grant-airdrop");
        address predicted = distributionFactory.predictMerkleAirdropAddress(address(boardroom), salt);
        releaseALeaf = _grantClaimLeaf(predicted, RELEASE_HASH, 0, recipient, grantShares, grantParams);
        releaseBLeaf = _grantClaimLeaf(predicted, RELEASE_B_HASH, 1, recipient, grantShares, grantParams);
        MerkleAirdrop.CreateParams memory params = MerkleAirdrop.CreateParams({
            shareToken: address(shares),
            shareAmount: 2 * grantShares,
            merkleRoot: _hashPair(releaseALeaf, releaseBLeaf),
            startTime: uint64(block.timestamp),
            endTime: 0,
            maxGrantClaims: 1,
            salt: salt
        });

        _approveAsBoardroom(address(shares), address(distributionFactory), params.shareAmount);
        vm.prank(address(boardroom));
        airdrop = MerkleAirdrop(distributionFactory.createMerkleAirdrop(params));
    }

    function _grantClaimLeaf(
        address airdrop,
        bytes32 expectedFacetSetHash,
        uint256 index,
        address account,
        uint256 amount,
        MerkleAirdrop.GrantClaimParams memory params
    ) internal view returns (bytes32) {
        bytes32 termsHash = keccak256(
            abi.encode(
                GRANT_TERMS_TYPEHASH,
                params.paymentToken,
                params.price,
                params.expiry,
                params.vestingCliff,
                params.vestingEnd,
                params.transferable,
                params.transferUnlockTime,
                params.salt
            )
        );
        return keccak256(
            abi.encode(
                GRANT_CLAIM_TYPEHASH,
                expectedFacetSetHash,
                block.chainid,
                index,
                airdrop,
                address(boardroom),
                address(shares),
                address(grantFactory),
                account,
                amount,
                termsHash
            )
        );
    }

    function _directClaimLeaf(
        address airdrop,
        bytes32 expectedFacetSetHash,
        uint256 index,
        address account,
        uint256 amount
    ) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                DIRECT_CLAIM_TYPEHASH,
                expectedFacetSetHash,
                block.chainid,
                index,
                airdrop,
                address(boardroom),
                address(shares),
                account,
                amount
            )
        );
    }

    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }
}
