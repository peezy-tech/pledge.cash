// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
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
import {DistributionFactory} from "../../src/distribution/DistributionFactory.sol";
import {FixedPriceSale} from "../../src/distribution/FixedPriceSale.sol";
import {IBoardroomCallPolicy} from "../../src/policy/IBoardroomCallPolicy.sol";
import {LockedLiquidity} from "../../src/liquidity/LockedLiquidity.sol";
import {LockedLiquidityFactory} from "../../src/liquidity/LockedLiquidityFactory.sol";
import {MerkleAirdrop} from "../../src/distribution/MerkleAirdrop.sol";
import {MigratingBondingCurve} from "../../src/distribution/MigratingBondingCurve.sol";
import {TokenGrant} from "../../src/grants/TokenGrant.sol";
import {TokenGrantFactory} from "../../src/grants/TokenGrantFactory.sol";

contract DistributionCurrency {
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

    function transfer(address to, uint256 amount) public virtual returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public virtual returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }

        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract FeeOnTransferDistributionCurrency is DistributionCurrency {
    uint256 internal immutable feeBps;

    constructor(string memory name_, string memory symbol_, uint8 decimals_, uint256 feeBps_)
        DistributionCurrency(name_, symbol_, decimals_)
    {
        feeBps = feeBps_;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        uint256 fee = amount * feeBps / 10_000;
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount - fee;
        totalSupply -= fee;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }

        uint256 fee = amount * feeBps / 10_000;
        balanceOf[from] -= amount;
        balanceOf[to] += amount - fee;
        totalSupply -= fee;
        return true;
    }
}

contract SenderSurchargeDistributionCurrency is DistributionCurrency {
    uint256 internal immutable surchargeBps;

    constructor(string memory name_, string memory symbol_, uint8 decimals_, uint256 surchargeBps_)
        DistributionCurrency(name_, symbol_, decimals_)
    {
        surchargeBps = surchargeBps_;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        _moveWithSenderSurcharge(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }

        _moveWithSenderSurcharge(from, to, amount);
        return true;
    }

    function _moveWithSenderSurcharge(address from, address to, uint256 amount) internal {
        uint256 surcharge = amount * surchargeBps / 10_000;
        balanceOf[from] -= amount + surcharge;
        balanceOf[to] += amount;
        totalSupply -= surcharge;
    }
}

contract MutableDistributionCurrency {
    string public constant name = "Mutable Quote";
    string public constant symbol = "MQUOTE";
    uint8 public constant decimals = 6;
    uint256 public totalSupply;
    bool public balanceReadsFail;
    bool public transfersFail;
    bool public balanceReadsBurnGas;
    bool public transfersBurnGas;

    mapping(address => uint256) internal balances;
    mapping(address => mapping(address => uint256)) public allowance;

    function setFailureMode(bool balanceReadsFail_, bool transfersFail_) external {
        balanceReadsFail = balanceReadsFail_;
        transfersFail = transfersFail_;
    }

    function setGasBurnMode(bool balanceReadsBurnGas_, bool transfersBurnGas_) external {
        balanceReadsBurnGas = balanceReadsBurnGas_;
        transfersBurnGas = transfersBurnGas_;
    }

    function balanceOf(address account) external view returns (uint256) {
        if (balanceReadsBurnGas) {
            assembly {
                for {} 1 {} {}
            }
        }
        require(!balanceReadsFail, "balance disabled");
        return balances[account];
    }

    function mint(address to, uint256 amount) external {
        balances[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (transfersBurnGas) {
            assembly {
                for {} 1 {} {}
            }
        }
        if (transfersFail) return false;
        balances[msg.sender] -= amount;
        balances[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (transfersFail) return false;
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        balances[from] -= amount;
        balances[to] += amount;
        return true;
    }
}

contract MalformedDistributionAsset {
    function balanceOf(address) external pure {}
}

contract DistributionTestAllowAllPolicy is IBoardroomCallPolicy {
    function canCall(address, address, address, uint256, bytes calldata) external pure returns (bool) {
        return true;
    }
}

contract FakeDistributionGrantCaller {
    function isIssuedDistribution(address) external pure returns (bool) {
        return true;
    }

    function createGrant(TokenGrantFactory factory, address issuer, TokenGrantFactory.GrantCreateParams calldata params)
        external
        returns (address)
    {
        return factory.createGrantFromDistribution(issuer, params);
    }
}

contract DistributionTest is Test {
    bytes32 internal constant DIRECT_CLAIM_TYPEHASH = keccak256(
        "MerkleAirdropDirectClaim(uint256 chainId,uint256 index,address airdrop,address boardroom,address shareToken,address account,uint256 amount)"
    );
    bytes32 internal constant GRANT_CLAIM_TYPEHASH = keccak256(
        "MerkleAirdropGrantClaim(uint256 chainId,uint256 index,address airdrop,address boardroom,address shareToken,address tokenGrantFactory,address account,uint256 amount,bytes32 termsHash)"
    );
    bytes32 internal constant GRANT_TERMS_TYPEHASH = keccak256(
        "MerkleAirdropGrantTerms(address paymentToken,uint256 price,uint256 expiry,uint256 vestingCliff,uint256 vestingEnd,bool transferable,uint256 transferUnlockTime,bytes32 salt)"
    );

    BoardroomPolicyRegistry internal policyRegistry;
    AssetPolicy internal assetPolicy;
    BoardroomFactory internal boardroomFactory;
    AmmFactory internal ammFactory;
    WETH internal wrappedNative;
    AmmRouter internal ammRouter;
    LockedLiquidityFactory internal lockedLiquidityFactory;
    TokenGrantFactory internal tokenGrantFactory;
    DistributionFactory internal distributionFactory;
    DistributionCurrency internal paymentToken;

    address internal owner = address(0xA11CE);
    address internal buyer = address(0xB0B);
    address internal recipient = address(0xC0FFEE);

    uint256 internal constant SALE_SHARES = 1_000 ether;
    uint256 internal constant PRICE = 2_000000;
    uint256 internal constant BUY_SHARES = 250 ether;
    uint256 internal constant BUY_PAYMENT = 500_000000;
    uint256 internal constant CURVE_SALE_SHARES = 500 ether;
    uint256 internal constant CURVE_MIGRATION_SHARES = 500 ether;
    uint256 internal constant CURVE_BUY_SHARES = 200 ether;
    uint256 internal constant CURVE_BUY_PAYMENT = 400_000000;
    uint256 internal constant CURVE_SELL_SHARES = 50 ether;
    uint256 internal constant CURVE_SELL_REFUND = 100_000000;
    uint256 internal constant CURVE_GRADUATION_TARGET = 500_000000;
    uint256 internal constant AIRDROP_SHARES = 300 ether;
    uint256 internal constant AIRDROP_CLAIM_SHARES = 125 ether;

    function setUp() public {
        wrappedNative = new WETH();
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
        lockedLiquidityFactory = new LockedLiquidityFactory(address(ammRouter), address(boardroomFactory));
        ammFactory.setLiquidityRouter(address(ammRouter));
        ammFactory.setReservationManager(address(lockedLiquidityFactory));
        tokenGrantFactory = new TokenGrantFactory(address(this), address(boardroomFactory));
        distributionFactory = new DistributionFactory(address(lockedLiquidityFactory), address(tokenGrantFactory));
        paymentToken = new DistributionCurrency("USD Coin", "USDC", 6);

        assetPolicy.setApprovalSpenderAllowed(address(distributionFactory), true);
        assetPolicy.setApprovalSpenderAllowed(address(tokenGrantFactory), true);
        policyRegistry.setPolicyAllowed(address(assetPolicy), true);
        policyRegistry.registerModulePolicy(address(tokenGrantFactory));
        policyRegistry.registerModulePolicy(address(distributionFactory));
        policyRegistry.registerModulePolicy(address(lockedLiquidityFactory));
        paymentToken.mint(buyer, 10_000_000000);
    }

    function testBoardroomCanCreateFixedPriceSaleAndBuyerCanPurchase() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("fixed-sale");
        FixedPriceSale sale = _createFixedPriceSale(boardroom, shareToken, paymentToken, "fixed-sale-create");

        assertEq(sale.boardroom(), address(boardroom));
        assertEq(sale.shareToken(), address(shareToken));
        assertEq(sale.paymentToken(), address(paymentToken));
        assertEq(sale.saleSupply(), SALE_SHARES);
        assertEq(sale.remainingShares(), SALE_SHARES);
        assertEq(shareToken.balanceOf(address(sale)), SALE_SHARES);
        assertEq(shareToken.allowance(address(boardroom), address(distributionFactory)), 0);
        assertEq(distributionFactory.distributionCountForBoardroom(address(boardroom)), 1);
        assertEq(distributionFactory.distributionForBoardroomAt(address(boardroom), 0), address(sale));
        assertTrue(distributionFactory.isDistribution(address(sale)));
        assertTrue(boardroom.isRedeemableAsset(address(paymentToken)));
        assertTrue(shareToken.isEncumberedAccount(address(sale)));
        assertEq(shareToken.encumberedSupply(), SALE_SHARES);
        assertEq(shareToken.governanceEligibleSupply(), 0);

        vm.prank(buyer);
        paymentToken.approve(address(sale), BUY_PAYMENT);

        vm.prank(buyer);
        uint256 payment = sale.buy(BUY_SHARES, recipient, BUY_PAYMENT, block.timestamp);

        assertEq(payment, BUY_PAYMENT);
        assertEq(shareToken.balanceOf(recipient), BUY_SHARES);
        assertEq(paymentToken.balanceOf(address(boardroom)), BUY_PAYMENT);
        assertEq(paymentToken.balanceOf(buyer), 10_000_000000 - BUY_PAYMENT);
        assertEq(sale.remainingShares(), SALE_SHARES - BUY_SHARES);
        assertEq(sale.purchasedBy(buyer), BUY_SHARES);
        assertEq(shareToken.encumberedSupply(), SALE_SHARES - BUY_SHARES);
        assertEq(shareToken.governanceEligibleSupply(), BUY_SHARES);
    }

    function testExecutorLossWindDownExcludesCanonicalDistributionInventory() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("distribution-executor-loss");
        FixedPriceSale sale =
            _createFixedPriceSale(boardroom, shareToken, paymentToken, "distribution-executor-loss-sale");
        address lostExecutor = address(0xDEAD);

        vm.startPrank(owner);
        boardroom.mint(recipient, 10 ether);
        boardroom.setExecutor(lostExecutor);
        boardroom.launch(1 days);
        vm.stopPrank();
        vm.roll(block.number + 1);

        assertTrue(shareToken.isEncumberedAccount(address(sale)));
        assertEq(shareToken.encumberedSupply(), SALE_SHARES);
        assertEq(shareToken.governanceEligibleSupply(), 10 ether);

        vm.prank(recipient);
        boardroom.startWindDown();

        assertEq(uint8(boardroom.status()), uint8(Boardroom.BoardroomStatus.WindingDown));
    }

    function testBoardroomOwnedGrantFactoryAdminCallsWorkThroughCanonicalPolicyWithoutObligation() public {
        (Boardroom boardroom,) = _createBoardroom("grant-factory-admin");
        tokenGrantFactory.transferOwnership(address(boardroom));

        vm.prank(owner);
        boardroom.execute(
            _policyCall(
                address(tokenGrantFactory),
                address(tokenGrantFactory),
                0,
                abi.encodeCall(TokenGrantFactory.setCreationFee, (0.02 ether))
            )
        );

        assertEq(tokenGrantFactory.creationFee(), 0.02 ether);
        assertEq(boardroom.issuedGrantCount(), 0);
        assertEq(boardroom.issuedDistributionCount(), 0);
        assertEq(boardroom.obligationPolicyOf(address(tokenGrantFactory)), address(0));

        vm.prank(owner);
        boardroom.execute(
            _policyCall(
                address(tokenGrantFactory),
                address(tokenGrantFactory),
                0,
                abi.encodeWithSignature("transferOwnership(address)", recipient)
            )
        );

        assertEq(tokenGrantFactory.owner(), recipient);
        assertEq(boardroom.issuedGrantCount(), 0);
        assertEq(boardroom.issuedDistributionCount(), 0);
        assertEq(boardroom.obligationPolicyOf(address(tokenGrantFactory)), address(0));
    }

    function testBoardroomCanCreateMerkleAirdropAndRecipientCanClaimShares() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("airdrop-direct");
        bytes32 salt = keccak256("airdrop-direct-create");
        address predictedAirdrop = distributionFactory.predictMerkleAirdropAddress(address(boardroom), salt);
        bytes32 recipientLeaf =
            _directClaimLeaf(predictedAirdrop, boardroom, shareToken, 0, recipient, AIRDROP_CLAIM_SHARES);
        bytes32 buyerLeaf = _directClaimLeaf(predictedAirdrop, boardroom, shareToken, 1, buyer, 75 ether);
        bytes32 root = _hashPair(recipientLeaf, buyerLeaf);

        MerkleAirdrop airdrop = _createMerkleAirdrop(boardroom, shareToken, root, AIRDROP_SHARES, salt);

        assertEq(address(airdrop), predictedAirdrop);
        assertEq(airdrop.boardroom(), address(boardroom));
        assertEq(airdrop.shareToken(), address(shareToken));
        assertEq(airdrop.tokenGrantFactory(), address(tokenGrantFactory));
        assertEq(airdrop.airdropSupply(), AIRDROP_SHARES);
        assertEq(airdrop.remainingShares(), AIRDROP_SHARES);
        assertEq(airdrop.merkleRoot(), root);
        assertEq(shareToken.balanceOf(address(airdrop)), AIRDROP_SHARES);
        assertEq(distributionFactory.distributionCountForBoardroom(address(boardroom)), 1);
        assertEq(distributionFactory.distributionForBoardroomAt(address(boardroom), 0), address(airdrop));
        assertTrue(distributionFactory.isDistribution(address(airdrop)));
        assertTrue(boardroom.isIssuedDistribution(address(airdrop)));
        assertTrue(shareToken.isEncumberedAccount(address(airdrop)));
        assertEq(shareToken.encumberedSupply(), AIRDROP_SHARES);

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = buyerLeaf;

        vm.prank(recipient);
        airdrop.claim(0, recipient, AIRDROP_CLAIM_SHARES, proof);

        assertEq(shareToken.balanceOf(recipient), AIRDROP_CLAIM_SHARES);
        assertEq(shareToken.balanceOf(address(airdrop)), AIRDROP_SHARES - AIRDROP_CLAIM_SHARES);
        assertEq(airdrop.claimedShares(), AIRDROP_CLAIM_SHARES);
        assertEq(airdrop.remainingShares(), AIRDROP_SHARES - AIRDROP_CLAIM_SHARES);
        assertTrue(airdrop.isClaimed(0));
        assertEq(shareToken.encumberedSupply(), AIRDROP_SHARES - AIRDROP_CLAIM_SHARES);
        assertEq(shareToken.governanceEligibleSupply(), AIRDROP_CLAIM_SHARES);

        vm.prank(recipient);
        vm.expectRevert(abi.encodeWithSelector(MerkleAirdrop.ClaimAlreadyMade.selector, 0));
        airdrop.claim(0, recipient, AIRDROP_CLAIM_SHARES, proof);
    }

    function testMerkleAirdropClaimLeavesAreBoundToChainId() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("airdrop-chain-domain");
        bytes32 salt = keccak256("airdrop-chain-domain-create");
        address predictedAirdrop = distributionFactory.predictMerkleAirdropAddress(address(boardroom), salt);
        bytes32 root = _directClaimLeaf(predictedAirdrop, boardroom, shareToken, 0, recipient, AIRDROP_CLAIM_SHARES);
        MerkleAirdrop airdrop = _createMerkleAirdrop(boardroom, shareToken, root, AIRDROP_SHARES, salt);

        bytes32 originalLeaf = airdrop.getDirectClaimLeaf(0, recipient, AIRDROP_CLAIM_SHARES);
        vm.chainId(block.chainid + 1);
        bytes32 otherChainLeaf = airdrop.getDirectClaimLeaf(0, recipient, AIRDROP_CLAIM_SHARES);

        assertNotEq(otherChainLeaf, originalLeaf);
        vm.expectRevert(MerkleAirdrop.InvalidProof.selector);
        airdrop.claim(0, recipient, AIRDROP_CLAIM_SHARES, new bytes32[](0));
        assertEq(airdrop.claimedShares(), 0);
        assertEq(airdrop.remainingShares(), AIRDROP_SHARES);
    }

    function testMerkleAirdropCapsAggregateClaimsAtEscrowedSupply() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("airdrop-aggregate-cap");
        bytes32 salt = keccak256("airdrop-aggregate-cap-create");
        address predictedAirdrop = distributionFactory.predictMerkleAirdropAddress(address(boardroom), salt);
        uint256 claimAmount = 200 ether;
        bytes32 firstLeaf = _directClaimLeaf(predictedAirdrop, boardroom, shareToken, 0, recipient, claimAmount);
        bytes32 secondLeaf = _directClaimLeaf(predictedAirdrop, boardroom, shareToken, 1, buyer, claimAmount);
        MerkleAirdrop airdrop =
            _createMerkleAirdrop(boardroom, shareToken, _hashPair(firstLeaf, secondLeaf), AIRDROP_SHARES, salt);

        bytes32[] memory firstProof = new bytes32[](1);
        firstProof[0] = secondLeaf;
        airdrop.claim(0, recipient, claimAmount, firstProof);

        bytes32[] memory secondProof = new bytes32[](1);
        secondProof[0] = firstLeaf;
        vm.expectRevert(
            abi.encodeWithSelector(MerkleAirdrop.InsufficientShares.selector, claimAmount, AIRDROP_SHARES - claimAmount)
        );
        airdrop.claim(1, buyer, claimAmount, secondProof);

        assertEq(airdrop.claimedShares(), claimAmount);
        assertEq(airdrop.remainingShares(), AIRDROP_SHARES - claimAmount);
        assertFalse(airdrop.isClaimed(1));
    }

    function testMerkleAirdropClaimCanCreateBoardroomIssuedGrant() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("airdrop-grant");
        bytes32 salt = keccak256("airdrop-grant-create");
        address predictedAirdrop = distributionFactory.predictMerkleAirdropAddress(address(boardroom), salt);
        MerkleAirdrop.GrantClaimParams memory grantParams = _grantClaimParams("airdrop-grant-claim");
        grantParams.paymentToken = address(paymentToken);
        grantParams.price = PRICE;
        bytes32 root =
            _grantClaimLeaf(predictedAirdrop, boardroom, shareToken, 0, recipient, AIRDROP_CLAIM_SHARES, grantParams);

        MerkleAirdrop airdrop = _createMerkleAirdrop(boardroom, shareToken, root, AIRDROP_SHARES, salt, 1);
        bytes32[] memory proof = new bytes32[](0);
        bytes32 grantSalt = _grantSalt(predictedAirdrop, 0, recipient, grantParams.salt);
        address predictedGrant = tokenGrantFactory.predictGrantAddress(address(boardroom), grantSalt);

        assertEq(airdrop.maxGrantClaims(), 1);
        assertEq(boardroom.issuedGrantSlotReservations(), 1);
        assertEq(boardroom.issuedGrantReservationsForDistribution(address(airdrop)), 1);

        vm.prank(recipient);
        address grantAddress = airdrop.claimGrant(0, recipient, AIRDROP_CLAIM_SHARES, grantParams, proof);

        TokenGrant grant = TokenGrant(grantAddress);
        uint256 grantTokenId = uint256(uint160(grantAddress));

        assertEq(grantAddress, predictedGrant);
        assertEq(grant.issuer(), address(boardroom));
        assertEq(grant.holder(), recipient);
        assertEq(grant.token(), address(shareToken));
        assertEq(grant.paymentToken(), address(paymentToken));
        assertEq(grant.grantSize(), AIRDROP_CLAIM_SHARES);
        assertEq(grant.price(), PRICE);
        assertEq(grant.vestingCliff(), grantParams.vestingCliff);
        assertEq(grant.vestingEnd(), grantParams.vestingEnd);
        assertEq(grant.expiry(), grantParams.expiry);
        assertEq(tokenGrantFactory.ownerOf(grantTokenId), recipient);
        assertEq(shareToken.balanceOf(address(grant)), AIRDROP_CLAIM_SHARES);
        assertEq(shareToken.balanceOf(recipient), 0);
        assertEq(airdrop.claimedShares(), AIRDROP_CLAIM_SHARES);
        assertEq(airdrop.remainingShares(), AIRDROP_SHARES - AIRDROP_CLAIM_SHARES);
        assertEq(airdrop.claimedGrantCount(), 1);
        assertEq(boardroom.issuedGrantSlotReservations(), 0);
        assertEq(boardroom.issuedGrantReservationsForDistribution(address(airdrop)), 0);
        assertEq(boardroom.issuedGrantCount(), 1);
        assertEq(boardroom.issuedGrantAt(0), grantAddress);
        assertTrue(boardroom.isIssuedGrant(grantAddress));
        assertTrue(boardroom.isRedeemableAsset(address(paymentToken)));
        assertTrue(shareToken.isEncumberedAccount(address(airdrop)));
        assertTrue(shareToken.isEncumberedAccount(grantAddress));
        assertEq(shareToken.encumberedSupply(), AIRDROP_SHARES);
        assertEq(shareToken.governanceEligibleSupply(), 0);
    }

    function testMerkleAirdropGrantClaimIsExemptFromMutableFactoryFee() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("airdrop-grant-fee-exempt");
        bytes32 salt = keccak256("airdrop-grant-fee-exempt-create");
        address predictedAirdrop = distributionFactory.predictMerkleAirdropAddress(address(boardroom), salt);
        MerkleAirdrop.GrantClaimParams memory grantParams = _grantClaimParams("airdrop-grant-fee-exempt-claim");
        bytes32 root =
            _grantClaimLeaf(predictedAirdrop, boardroom, shareToken, 0, recipient, AIRDROP_CLAIM_SHARES, grantParams);
        MerkleAirdrop airdrop = _createMerkleAirdrop(boardroom, shareToken, root, AIRDROP_SHARES, salt, 1);

        tokenGrantFactory.setCreationFee(0.01 ether);
        uint256 feeRecipientBalanceBefore = address(this).balance;

        address grant = airdrop.claimGrant(0, recipient, AIRDROP_CLAIM_SHARES, grantParams, new bytes32[](0));

        assertNotEq(grant, address(0));
        assertEq(address(this).balance, feeRecipientBalanceBefore);
        assertEq(address(tokenGrantFactory).balance, 0);
        assertEq(airdrop.claimedGrantCount(), 1);
    }

    function testFakeIssuerCannotSelfReportDistributionAndBypassCreationFee() public {
        FakeDistributionGrantCaller fakeIssuer = new FakeDistributionGrantCaller();
        tokenGrantFactory.setCreationFee(0.01 ether);
        TokenGrantFactory.GrantCreateParams memory params = _feeBypassGrantParams("fake-issuer-fee-bypass");

        vm.expectRevert(
            abi.encodeWithSelector(
                TokenGrantFactory.UnauthorizedGrantIssuer.selector, address(fakeIssuer), address(fakeIssuer)
            )
        );
        fakeIssuer.createGrant(tokenGrantFactory, address(fakeIssuer), params);

        assertEq(address(tokenGrantFactory).balance, 0);
    }

    function testUntrackedCallerCannotUseAuthenticBoardroomToBypassCreationFee() public {
        (Boardroom boardroom,) = _createBoardroom("authentic-boardroom-fake-distribution");
        FakeDistributionGrantCaller fakeDistribution = new FakeDistributionGrantCaller();
        tokenGrantFactory.setCreationFee(0.01 ether);
        TokenGrantFactory.GrantCreateParams memory params = _feeBypassGrantParams("fake-distribution-fee-bypass");

        vm.expectRevert(
            abi.encodeWithSelector(
                TokenGrantFactory.UnauthorizedGrantIssuer.selector, address(boardroom), address(fakeDistribution)
            )
        );
        fakeDistribution.createGrant(tokenGrantFactory, address(boardroom), params);

        assertFalse(boardroom.isIssuedDistribution(address(fakeDistribution)));
        assertEq(address(tokenGrantFactory).balance, 0);
    }

    function testMerkleAirdropGrantClaimsCannotExceedReservedSlots() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("airdrop-grant-cap");
        bytes32 salt = keccak256("airdrop-grant-cap-create");
        address predictedAirdrop = distributionFactory.predictMerkleAirdropAddress(address(boardroom), salt);
        MerkleAirdrop.GrantClaimParams memory firstGrantParams = _grantClaimParams("airdrop-grant-cap-first");
        MerkleAirdrop.GrantClaimParams memory secondGrantParams = _grantClaimParams("airdrop-grant-cap-second");
        bytes32 firstLeaf = _grantClaimLeaf(
            predictedAirdrop, boardroom, shareToken, 0, recipient, AIRDROP_CLAIM_SHARES, firstGrantParams
        );
        bytes32 secondLeaf =
            _grantClaimLeaf(predictedAirdrop, boardroom, shareToken, 1, buyer, AIRDROP_CLAIM_SHARES, secondGrantParams);
        bytes32 root = _hashPair(firstLeaf, secondLeaf);

        MerkleAirdrop airdrop = _createMerkleAirdrop(boardroom, shareToken, root, AIRDROP_SHARES, salt, 1);
        bytes32[] memory firstProof = new bytes32[](1);
        firstProof[0] = secondLeaf;
        bytes32[] memory secondProof = new bytes32[](1);
        secondProof[0] = firstLeaf;

        vm.prank(recipient);
        airdrop.claimGrant(0, recipient, AIRDROP_CLAIM_SHARES, firstGrantParams, firstProof);

        assertEq(airdrop.claimedGrantCount(), 1);
        assertEq(boardroom.issuedGrantSlotReservations(), 0);

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(MerkleAirdrop.TooManyGrantClaims.selector, 1));
        airdrop.claimGrant(1, buyer, AIRDROP_CLAIM_SHARES, secondGrantParams, secondProof);
    }

    function testMerkleAirdropCreationRejectsGrantReservationOverflow() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("airdrop-grant-overflow");
        bytes32 salt = keccak256("airdrop-grant-overflow-create");
        address predictedAirdrop = distributionFactory.predictMerkleAirdropAddress(address(boardroom), salt);
        MerkleAirdrop.GrantClaimParams memory grantParams = _grantClaimParams("airdrop-grant-overflow-claim");
        bytes32 root =
            _grantClaimLeaf(predictedAirdrop, boardroom, shareToken, 0, recipient, AIRDROP_CLAIM_SHARES, grantParams);
        MerkleAirdrop.CreateParams memory params = _airdropParams(address(shareToken), AIRDROP_SHARES, root, salt);
        params.maxGrantClaims = 129;

        vm.startPrank(owner);
        boardroom.mint(address(boardroom), AIRDROP_SHARES);

        Boardroom.Call[] memory calls = new Boardroom.Call[](2);
        calls[0] = _policyCall(
            address(assetPolicy),
            address(shareToken),
            0,
            abi.encodeWithSignature("approve(address,uint256)", address(distributionFactory), AIRDROP_SHARES)
        );
        calls[1] = _policyCall(
            address(distributionFactory),
            address(distributionFactory),
            0,
            abi.encodeCall(DistributionFactory.createMerkleAirdrop, (params))
        );

        vm.expectRevert(abi.encodeWithSelector(Boardroom.TooManyIssuedGrantReservations.selector, 129, 128));
        boardroom.executeBatch(calls);
        vm.stopPrank();
    }

    function testMerkleAirdropCloseReleasesUnusedGrantReservations() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("airdrop-grant-release");
        bytes32 salt = keccak256("airdrop-grant-release-create");
        address predictedAirdrop = distributionFactory.predictMerkleAirdropAddress(address(boardroom), salt);
        MerkleAirdrop.GrantClaimParams memory grantParams = _grantClaimParams("airdrop-grant-release-claim");
        bytes32 root =
            _grantClaimLeaf(predictedAirdrop, boardroom, shareToken, 0, recipient, AIRDROP_CLAIM_SHARES, grantParams);

        MerkleAirdrop airdrop = _createMerkleAirdrop(boardroom, shareToken, root, AIRDROP_SHARES, salt, 2);

        assertEq(boardroom.issuedGrantSlotReservations(), 2);
        assertEq(boardroom.issuedGrantReservationsForDistribution(address(airdrop)), 2);

        vm.prank(owner);
        boardroom.execute(
            _policyCall(address(distributionFactory), address(airdrop), 0, abi.encodeCall(MerkleAirdrop.close, ()))
        );

        assertEq(boardroom.issuedGrantSlotReservations(), 0);
        assertEq(boardroom.issuedGrantReservationsForDistribution(address(airdrop)), 0);
    }

    function testMerkleAirdropCloseRequiresCanonicalPolicyAndReleasesReservationAtomically() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("airdrop-canonical-close");
        bytes32 salt = keccak256("airdrop-canonical-close-create");
        bytes32 root = keccak256("airdrop-canonical-close-root");
        MerkleAirdrop airdrop = _createMerkleAirdrop(boardroom, shareToken, root, AIRDROP_SHARES, salt, 2);

        assertEq(boardroom.obligationPolicyOf(address(airdrop)), address(distributionFactory));
        assertEq(boardroom.issuedGrantSlotReservations(), 2);

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                Boardroom.ObligationPolicyMismatch.selector, address(airdrop), address(distributionFactory), address(0)
            )
        );
        boardroom.execute(_policyCall(address(0), address(airdrop), 0, abi.encodeCall(MerkleAirdrop.close, ())));

        assertEq(uint8(airdrop.airdropStatus()), uint8(MerkleAirdrop.AirdropStatus.Active));
        assertEq(airdrop.remainingShares(), AIRDROP_SHARES);
        assertEq(boardroom.issuedGrantSlotReservations(), 2);

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                Boardroom.ObligationPolicyMismatch.selector,
                address(airdrop),
                address(distributionFactory),
                address(tokenGrantFactory)
            )
        );
        boardroom.execute(
            _policyCall(address(tokenGrantFactory), address(airdrop), 0, abi.encodeCall(MerkleAirdrop.close, ()))
        );

        assertEq(uint8(airdrop.airdropStatus()), uint8(MerkleAirdrop.AirdropStatus.Active));
        assertEq(airdrop.remainingShares(), AIRDROP_SHARES);
        assertEq(boardroom.issuedGrantSlotReservations(), 2);

        vm.prank(owner);
        boardroom.execute(
            _policyCall(address(distributionFactory), address(airdrop), 0, abi.encodeCall(MerkleAirdrop.close, ()))
        );

        assertEq(uint8(airdrop.airdropStatus()), uint8(MerkleAirdrop.AirdropStatus.Closed));
        assertEq(boardroom.issuedGrantSlotReservations(), 0);
        assertEq(boardroom.issuedGrantReservationsForDistribution(address(airdrop)), 0);
    }

    function testMerkleAirdropWindDownCloseReleasesUnusedGrantReservations() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("airdrop-grant-wind-down-release");
        bytes32 salt = keccak256("airdrop-grant-wind-down-release-create");
        address predictedAirdrop = distributionFactory.predictMerkleAirdropAddress(address(boardroom), salt);
        MerkleAirdrop.GrantClaimParams memory grantParams = _grantClaimParams("airdrop-grant-wind-down-release-claim");
        bytes32 root =
            _grantClaimLeaf(predictedAirdrop, boardroom, shareToken, 0, recipient, AIRDROP_CLAIM_SHARES, grantParams);

        MerkleAirdrop airdrop = _createMerkleAirdrop(boardroom, shareToken, root, AIRDROP_SHARES, salt, 2);

        assertEq(boardroom.issuedGrantSlotReservations(), 2);
        assertEq(boardroom.issuedGrantReservationsForDistribution(address(airdrop)), 2);

        vm.prank(owner);
        boardroom.startWindDown();

        vm.prank(owner);
        boardroom.execute(
            _policyCall(address(distributionFactory), address(airdrop), 0, abi.encodeCall(MerkleAirdrop.close, ()))
        );

        assertTrue(airdrop.isClosed());
        assertEq(boardroom.issuedGrantSlotReservations(), 0);
        assertEq(boardroom.issuedGrantReservationsForDistribution(address(airdrop)), 0);

        vm.prank(owner);
        boardroom.openRedemptions();

        assertEq(uint8(boardroom.status()), uint8(Boardroom.BoardroomStatus.RedemptionsOpen));
    }

    function testBoardroomRedemptionsWaitForMerkleAirdropToClose() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("airdrop-wind-down");
        bytes32 salt = keccak256("airdrop-wind-down-create");
        address predictedAirdrop = distributionFactory.predictMerkleAirdropAddress(address(boardroom), salt);
        bytes32 root = _directClaimLeaf(predictedAirdrop, boardroom, shareToken, 0, recipient, AIRDROP_CLAIM_SHARES);
        MerkleAirdrop airdrop = _createMerkleAirdrop(boardroom, shareToken, root, AIRDROP_SHARES, salt);

        assertEq(boardroom.issuedDistributionCount(), 1);
        assertEq(boardroom.issuedDistributionAt(0), address(airdrop));
        assertTrue(boardroom.isIssuedDistribution(address(airdrop)));

        vm.prank(owner);
        boardroom.startWindDown();

        bytes32[] memory proof = new bytes32[](0);
        vm.prank(recipient);
        vm.expectRevert(MerkleAirdrop.AirdropNotOpen.selector);
        airdrop.claim(0, recipient, AIRDROP_CLAIM_SHARES, proof);

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Boardroom.IssuedDistributionStillOpen.selector, address(airdrop)));
        boardroom.openRedemptions();

        vm.prank(owner);
        boardroom.execute(
            _policyCall(address(distributionFactory), address(airdrop), 0, abi.encodeCall(MerkleAirdrop.close, ()))
        );

        assertTrue(airdrop.isClosed());
        assertEq(airdrop.remainingShares(), 0);
        assertEq(shareToken.balanceOf(address(boardroom)), AIRDROP_SHARES);

        vm.prank(owner);
        boardroom.openRedemptions();

        assertEq(uint8(boardroom.status()), uint8(Boardroom.BoardroomStatus.RedemptionsOpen));
    }

    function testFixedPriceSaleRoundsPaymentUpForDustPurchase() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("fixed-sale-dust");
        FixedPriceSale sale = _createFixedPriceSale(boardroom, shareToken, paymentToken, "fixed-sale-dust-create");

        vm.prank(buyer);
        paymentToken.approve(address(sale), 1);

        vm.prank(buyer);
        uint256 payment = sale.buy(1, buyer, 1, block.timestamp);

        assertEq(payment, 1);
        assertEq(shareToken.balanceOf(buyer), 1);
        assertEq(paymentToken.balanceOf(address(boardroom)), 1);
        assertEq(sale.remainingShares(), SALE_SHARES - 1);
    }

    function testBoardroomCanCloseFixedPriceSaleAndRecoverUnsoldShares() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("fixed-sale-close");
        FixedPriceSale sale = _createFixedPriceSale(boardroom, shareToken, paymentToken, "fixed-sale-close-create");

        vm.prank(buyer);
        paymentToken.approve(address(sale), BUY_PAYMENT);

        vm.prank(buyer);
        sale.buy(BUY_SHARES, buyer, BUY_PAYMENT, block.timestamp);

        vm.prank(owner);
        boardroom.execute(
            _policyCall(address(distributionFactory), address(sale), 0, abi.encodeCall(FixedPriceSale.close, ()))
        );

        assertTrue(sale.isClosed());
        assertEq(sale.remainingShares(), 0);
        assertEq(shareToken.balanceOf(address(boardroom)), SALE_SHARES - BUY_SHARES);
        assertEq(shareToken.encumberedSupply(), 0);
        assertEq(shareToken.governanceEligibleSupply(), BUY_SHARES);

        vm.prank(buyer);
        vm.expectRevert(FixedPriceSale.SaleNotActive.selector);
        sale.buy(1 ether, buyer, PRICE, block.timestamp);
    }

    function testDistributionFactoryPrunesClosedDistributionsWithoutErasingIdentity() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("fixed-sale-prune");
        FixedPriceSale sale = _createFixedPriceSale(boardroom, shareToken, paymentToken, "fixed-sale-prune-create");

        vm.prank(owner);
        boardroom.execute(
            _policyCall(address(distributionFactory), address(sale), 0, abi.encodeCall(FixedPriceSale.close, ()))
        );

        assertEq(distributionFactory.distributionCountForBoardroom(address(boardroom)), 1);
        uint256 pruned = distributionFactory.pruneClosedDistributions(address(boardroom));

        assertEq(pruned, 1);
        assertEq(distributionFactory.distributionCountForBoardroom(address(boardroom)), 0);
        assertTrue(distributionFactory.isDistribution(address(sale)));
        assertEq(distributionFactory.distributionBoardroom(address(sale)), address(boardroom));
        assertEq(
            uint8(distributionFactory.distributionKind(address(sale))),
            uint8(DistributionFactory.DistributionKind.FixedPriceSale)
        );
    }

    function testBoardroomCanCancelFixedPriceSaleAndRecoverInventory() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("fixed-sale-cancel");
        FixedPriceSale sale = _createFixedPriceSale(boardroom, shareToken, paymentToken, "fixed-sale-cancel-create");

        vm.prank(owner);
        boardroom.execute(
            _policyCall(address(distributionFactory), address(sale), 0, abi.encodeCall(FixedPriceSale.cancel, ()))
        );

        assertTrue(sale.isClosed());
        assertEq(sale.remainingShares(), 0);
        assertEq(shareToken.balanceOf(address(boardroom)), SALE_SHARES);
        assertEq(shareToken.encumberedSupply(), 0);
        assertEq(shareToken.governanceEligibleSupply(), 0);
    }

    function testBoardroomRedemptionsWaitForFixedPriceSaleToClose() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("fixed-sale-wind-down");
        FixedPriceSale sale = _createFixedPriceSale(boardroom, shareToken, paymentToken, "fixed-sale-wind-down-create");

        assertEq(boardroom.issuedDistributionCount(), 1);
        assertEq(boardroom.issuedDistributionAt(0), address(sale));
        assertTrue(boardroom.isIssuedDistribution(address(sale)));

        vm.prank(owner);
        boardroom.startWindDown();

        vm.prank(buyer);
        paymentToken.approve(address(sale), BUY_PAYMENT);

        vm.prank(buyer);
        vm.expectRevert(FixedPriceSale.SaleNotOpen.selector);
        sale.buy(BUY_SHARES, buyer, BUY_PAYMENT, block.timestamp);

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Boardroom.IssuedDistributionStillOpen.selector, address(sale)));
        boardroom.openRedemptions();

        vm.prank(owner);
        boardroom.execute(
            _policyCall(address(distributionFactory), address(sale), 0, abi.encodeCall(FixedPriceSale.close, ()))
        );

        assertTrue(sale.isClosed());

        vm.prank(owner);
        boardroom.openRedemptions();

        assertEq(uint8(boardroom.status()), uint8(Boardroom.BoardroomStatus.RedemptionsOpen));
    }

    function testBoardroomRejectsWrapperPolicyForDistributionCreation() public {
        DistributionTestAllowAllPolicy wrapperPolicy = new DistributionTestAllowAllPolicy();
        policyRegistry.setPolicyAllowed(address(wrapperPolicy), true);

        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("fixed-sale-wrapper-policy");

        vm.startPrank(owner);
        boardroom.mint(address(boardroom), SALE_SHARES);

        bytes32 salt = keccak256("fixed-sale-wrapper-policy-create");
        FixedPriceSale.CreateParams memory params =
            _saleParams(address(shareToken), address(paymentToken), SALE_SHARES, PRICE, salt);

        Boardroom.Call[] memory calls = new Boardroom.Call[](2);
        calls[0] = Boardroom.Call({
            policy: address(wrapperPolicy),
            target: address(shareToken),
            value: 0,
            data: abi.encodeWithSignature("approve(address,uint256)", address(distributionFactory), SALE_SHARES)
        });
        calls[1] = Boardroom.Call({
            policy: address(wrapperPolicy),
            target: address(distributionFactory),
            value: 0,
            data: abi.encodeCall(DistributionFactory.createFixedPriceSale, (params))
        });

        vm.expectRevert(abi.encodeWithSelector(Boardroom.ModulePolicyRequired.selector, address(distributionFactory)));
        boardroom.executeBatch(calls);
        vm.stopPrank();
    }

    function testFixedPriceSaleRejectsFeeOnTransferPaymentToken() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("fixed-fee-token");
        FeeOnTransferDistributionCurrency feeToken = new FeeOnTransferDistributionCurrency("Fee USD", "FUSD", 6, 100);
        feeToken.mint(buyer, 1_000_000000);

        FixedPriceSale sale = _createFixedPriceSale(boardroom, shareToken, feeToken, "fixed-fee-token-create");

        vm.prank(buyer);
        feeToken.approve(address(sale), 100_000000);

        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(
                FixedPriceSale.UnexpectedTokenBalanceChange.selector, address(feeToken), 100_000000, 99_000000
            )
        );
        sale.buy(50 ether, buyer, 100_000000, block.timestamp);

        assertEq(feeToken.balanceOf(address(boardroom)), 0);
        assertEq(shareToken.balanceOf(buyer), 0);
        assertEq(sale.remainingShares(), SALE_SHARES);
    }

    function testFixedPriceSaleRejectsSenderSurchargePaymentTokenAtomically() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("fixed-sender-surcharge-token");
        SenderSurchargeDistributionCurrency surchargeToken =
            new SenderSurchargeDistributionCurrency("Surcharge USD", "SUSD", 6, 100);
        uint256 buyerBalance = 1_000_000000;
        surchargeToken.mint(buyer, buyerBalance);

        FixedPriceSale sale =
            _createFixedPriceSale(boardroom, shareToken, surchargeToken, "fixed-sender-surcharge-token-create");

        vm.prank(buyer);
        surchargeToken.approve(address(sale), 100_000000);

        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(
                FixedPriceSale.UnexpectedTokenBalanceChange.selector, address(surchargeToken), 100_000000, 101_000000
            )
        );
        sale.buy(50 ether, buyer, 100_000000, block.timestamp);

        assertEq(surchargeToken.balanceOf(buyer), buyerBalance);
        assertEq(surchargeToken.balanceOf(address(boardroom)), 0);
        assertEq(shareToken.balanceOf(buyer), 0);
        assertEq(sale.remainingShares(), SALE_SHARES);
        assertEq(sale.purchasedBy(buyer), 0);
    }

    function testMigratingBondingCurveBuySellMigrateAndRedeemCycle() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("curve-cycle");
        MigratingBondingCurve curve = _createMigratingCurve(boardroom, shareToken, "curve-cycle-create");

        assertTrue(shareToken.isEncumberedAccount(address(curve)));
        assertEq(shareToken.encumberedSupply(), CURVE_SALE_SHARES + CURVE_MIGRATION_SHARES);
        assertEq(shareToken.governanceEligibleSupply(), 0);

        vm.prank(buyer);
        paymentToken.approve(address(curve), CURVE_BUY_PAYMENT);

        vm.prank(buyer);
        uint256 buyCost = curve.buy(CURVE_BUY_SHARES, buyer, CURVE_BUY_PAYMENT, block.timestamp);
        assertEq(buyCost, CURVE_BUY_PAYMENT);
        assertEq(shareToken.balanceOf(buyer), CURVE_BUY_SHARES);
        assertEq(curve.sellableSharesBy(buyer), CURVE_BUY_SHARES);
        assertEq(curve.quoteReserve(), CURVE_BUY_PAYMENT);
        assertEq(shareToken.encumberedSupply(), CURVE_SALE_SHARES + CURVE_MIGRATION_SHARES - CURVE_BUY_SHARES);
        assertEq(shareToken.governanceEligibleSupply(), CURVE_BUY_SHARES);

        vm.prank(buyer);
        shareToken.approve(address(curve), CURVE_SELL_SHARES);

        vm.prank(buyer);
        uint256 sellRefund = curve.sell(CURVE_SELL_SHARES, buyer, CURVE_SELL_REFUND, block.timestamp);
        assertEq(sellRefund, CURVE_SELL_REFUND);
        assertEq(shareToken.balanceOf(buyer), CURVE_BUY_SHARES - CURVE_SELL_SHARES);
        assertEq(curve.sellableSharesBy(buyer), CURVE_BUY_SHARES - CURVE_SELL_SHARES);
        assertEq(curve.quoteReserve(), 300_000000);
        assertFalse(curve.canMigrate());
        assertEq(
            shareToken.encumberedSupply(),
            CURVE_SALE_SHARES + CURVE_MIGRATION_SHARES - CURVE_BUY_SHARES + CURVE_SELL_SHARES
        );
        assertEq(shareToken.governanceEligibleSupply(), CURVE_BUY_SHARES - CURVE_SELL_SHARES);

        vm.prank(buyer);
        paymentToken.approve(address(curve), 200_000000);
        vm.prank(buyer);
        curve.buy(100 ether, buyer, 200_000000, block.timestamp);

        assertEq(curve.quoteReserve(), CURVE_GRADUATION_TARGET);
        assertTrue(curve.graduationLatched());
        assertTrue(curve.canMigrate());
        assertEq(shareToken.governanceEligibleSupply(), CURVE_BUY_SHARES - CURVE_SELL_SHARES + 100 ether);

        uint256 minShareLiquidity = 712.5 ether;
        uint256 minQuoteLiquidity = 237_500000;

        vm.prank(buyer);
        vm.expectRevert(MigratingBondingCurve.OnlyBoardroom.selector);
        curve.migrate(minShareLiquidity, minQuoteLiquidity, block.timestamp);

        vm.prank(owner);
        bytes memory migrationResult = boardroom.execute(
            _policyCall(
                address(distributionFactory),
                address(curve),
                0,
                abi.encodeCall(MigratingBondingCurve.migrate, (minShareLiquidity, minQuoteLiquidity, block.timestamp))
            )
        );
        (address lockerAddress, address poolAddress,, uint256 quoteToLiquidity, uint256 liquidity) =
            abi.decode(migrationResult, (address, address, uint256, uint256, uint256));
        LockedLiquidity locker = LockedLiquidity(lockerAddress);
        AmmPool pool = AmmPool(poolAddress);

        assertTrue(lockedLiquidityFactory.isLocker(lockerAddress));
        assertEq(locker.boardroom(), address(boardroom));
        assertEq(locker.factory(), address(lockedLiquidityFactory));
        assertEq(curve.locker(), lockerAddress);
        assertEq(curve.pool(), poolAddress);
        assertGt(liquidity, 0);
        assertGt(quoteToLiquidity, 0);
        assertEq(pool.balanceOf(lockerAddress), liquidity);
        assertEq(shareToken.balanceOf(address(curve)), 0);
        assertEq(paymentToken.balanceOf(address(curve)), 0);
        assertEq(boardroom.issuedDistributionCount(), 0);
        assertFalse(boardroom.isIssuedDistribution(address(curve)));
        assertEq(boardroom.lockedLiquidityCount(), 1);
        assertEq(boardroom.lockedLiquidityAt(0), lockerAddress);
        assertTrue(boardroom.isLockedLiquidity(lockerAddress));
        assertTrue(boardroom.isRedeemableAsset(address(paymentToken)));
        assertTrue(curve.isClosed());
        assertTrue(shareToken.isEncumberedAccount(poolAddress));
        assertEq(shareToken.encumberedSupply(), shareToken.balanceOf(poolAddress));
        assertEq(shareToken.governanceEligibleSupply(), shareToken.balanceOf(buyer));

        _windDownAndRedeemAfterMigration(boardroom, shareToken, lockerAddress);
    }

    function testMigratingBondingCurveRejectsSellingSharesWithoutCurveSellRights() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("curve-sell-rights");
        MigratingBondingCurve curve = _createMigratingCurve(boardroom, shareToken, "curve-sell-rights-create");

        vm.prank(buyer);
        paymentToken.approve(address(curve), CURVE_BUY_PAYMENT);

        vm.prank(buyer);
        curve.buy(CURVE_BUY_SHARES, buyer, CURVE_BUY_PAYMENT, block.timestamp);

        vm.prank(owner);
        boardroom.mint(recipient, CURVE_SELL_SHARES);

        vm.prank(recipient);
        shareToken.approve(address(curve), CURVE_SELL_SHARES);

        vm.prank(recipient);
        vm.expectRevert(
            abi.encodeWithSelector(
                MigratingBondingCurve.InsufficientSellableShares.selector, recipient, CURVE_SELL_SHARES, 0
            )
        );
        curve.sell(CURVE_SELL_SHARES, recipient, CURVE_SELL_REFUND, block.timestamp);

        assertEq(curve.sellableSharesBy(buyer), CURVE_BUY_SHARES);
        assertEq(curve.remainingSaleShares(), CURVE_SALE_SHARES - CURVE_BUY_SHARES);
        assertEq(curve.quoteReserve(), CURVE_BUY_PAYMENT);
    }

    function testWindDownCanCancelActiveMigratingCurveBeforeRedemptions() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("curve-cancel");
        MigratingBondingCurve curve = _createMigratingCurve(boardroom, shareToken, "curve-cancel-create");

        vm.startPrank(owner);
        boardroom.startWindDown();

        vm.expectRevert(abi.encodeWithSelector(Boardroom.IssuedDistributionStillOpen.selector, address(curve)));
        boardroom.openRedemptions();

        boardroom.execute(
            _policyCall(
                address(distributionFactory), address(curve), 0, abi.encodeCall(MigratingBondingCurve.cancel, ())
            )
        );
        assertEq(shareToken.encumberedSupply(), 0);
        assertEq(shareToken.governanceEligibleSupply(), 0);
        boardroom.openRedemptions();
        vm.stopPrank();

        assertTrue(curve.isClosed());
        assertEq(uint256(boardroom.status()), uint256(Boardroom.BoardroomStatus.RedemptionsOpen));
        assertEq(shareToken.balanceOf(address(boardroom)), 0);
    }

    function testWindDownCannotMigrateGraduatedCurve() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("curve-wind-down-migration");
        MigratingBondingCurve curve = _createMigratingCurve(boardroom, shareToken, "curve-wind-down-migration-create");

        vm.prank(buyer);
        paymentToken.approve(address(curve), CURVE_GRADUATION_TARGET);
        vm.prank(buyer);
        curve.buy(250 ether, buyer, CURVE_GRADUATION_TARGET, block.timestamp);
        assertTrue(curve.canMigrate());

        vm.startPrank(owner);
        boardroom.startWindDown();
        vm.expectRevert(MigratingBondingCurve.BoardroomNotActive.selector);
        boardroom.execute(
            _policyCall(
                address(distributionFactory),
                address(curve),
                0,
                abi.encodeCall(MigratingBondingCurve.migrate, (712.5 ether, 237_500000, block.timestamp))
            )
        );
        boardroom.execute(
            _policyCall(
                address(distributionFactory), address(curve), 0, abi.encodeCall(MigratingBondingCurve.cancel, ())
            )
        );
        vm.stopPrank();

        assertTrue(curve.isClosed());
        assertEq(boardroom.lockedLiquidityCount(), 0);
    }

    function testMigratingBondingCurveRoundsBuyQuoteUpAndSellQuoteDown() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("curve-rounding");
        MigratingBondingCurve curve = _createMigratingCurve(boardroom, shareToken, "curve-rounding-create");

        assertEq(curve.getBuyQuote(1), 1);
        assertEq(curve.getSellQuote(0), 0);
    }

    function testMigratingBondingCurveRejectsUnseedableLpConfigurationAtCreation() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("curve-zero-lp-allocation");
        MigratingBondingCurve.CreateParams memory params =
            _curveParams(address(shareToken), address(paymentToken), keccak256("curve-zero-lp-allocation-create"));
        params.saleSupply = 1;
        params.migrationSupply = 1;
        params.basePrice = 1 ether;
        params.graduationQuoteTarget = 1;
        params.quoteToLpBps = 1;

        vm.startPrank(owner);
        boardroom.mint(address(boardroom), 2);
        Boardroom.Call[] memory calls = new Boardroom.Call[](2);
        calls[0] = _policyCall(
            address(assetPolicy),
            address(shareToken),
            0,
            abi.encodeWithSignature("approve(address,uint256)", address(distributionFactory), 2)
        );
        calls[1] = _policyCall(
            address(distributionFactory),
            address(distributionFactory),
            0,
            abi.encodeCall(DistributionFactory.createMigratingBondingCurve, (params))
        );
        vm.expectRevert(
            abi.encodeWithSelector(
                Boardroom.CallNotAllowed.selector,
                address(distributionFactory),
                address(distributionFactory),
                DistributionFactory.createMigratingBondingCurve.selector
            )
        );
        boardroom.executeBatch(calls);
        vm.stopPrank();
    }

    function testMigratingBondingCurveRejectsFeeOnTransferQuoteToken() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("curve-fee-token");
        FeeOnTransferDistributionCurrency feeToken = new FeeOnTransferDistributionCurrency("Fee USD", "FUSD", 6, 100);
        feeToken.mint(buyer, 1_000_000000);

        MigratingBondingCurve curve = _createMigratingCurve(boardroom, shareToken, feeToken, "curve-fee-token-create");

        vm.prank(buyer);
        feeToken.approve(address(curve), 100_000000);

        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(
                MigratingBondingCurve.UnexpectedTokenBalanceChange.selector, address(feeToken), 100_000000, 99_000000
            )
        );
        curve.buy(50 ether, buyer, 100_000000, block.timestamp);

        assertEq(feeToken.balanceOf(address(curve)), 0);
        assertEq(shareToken.balanceOf(buyer), 0);
        assertEq(curve.remainingSaleShares(), CURVE_SALE_SHARES);
    }

    function testDistributionPolicyRejectsNonContractAndMalformedPaymentAssets() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("invalid-distribution-assets");
        MalformedDistributionAsset malformed = new MalformedDistributionAsset();
        address nonContract = address(0xBADCAFE);

        FixedPriceSale.CreateParams memory saleParams =
            _saleParams(address(shareToken), nonContract, SALE_SHARES, PRICE, keccak256("invalid-sale-asset"));
        assertFalse(
            distributionFactory.canCall(
                address(boardroom),
                owner,
                address(distributionFactory),
                0,
                abi.encodeCall(DistributionFactory.createFixedPriceSale, (saleParams))
            )
        );

        saleParams.paymentToken = address(malformed);
        assertFalse(
            distributionFactory.canCall(
                address(boardroom),
                owner,
                address(distributionFactory),
                0,
                abi.encodeCall(DistributionFactory.createFixedPriceSale, (saleParams))
            )
        );

        MigratingBondingCurve.CreateParams memory curveParams =
            _curveParams(address(shareToken), nonContract, keccak256("invalid-curve-asset"));
        assertFalse(
            distributionFactory.canCall(
                address(boardroom),
                owner,
                address(distributionFactory),
                0,
                abi.encodeCall(DistributionFactory.createMigratingBondingCurve, (curveParams))
            )
        );

        curveParams.quoteToken = address(malformed);
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                Boardroom.CallNotAllowed.selector,
                address(distributionFactory),
                address(distributionFactory),
                DistributionFactory.createMigratingBondingCurve.selector
            )
        );
        boardroom.execute(
            _policyCall(
                address(distributionFactory),
                address(distributionFactory),
                0,
                abi.encodeCall(DistributionFactory.createMigratingBondingCurve, (curveParams))
            )
        );
    }

    function testDistributionPolicyAcceptsWellFormedPaymentAndQuoteAssets() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("valid-distribution-assets");
        FixedPriceSale.CreateParams memory saleParams =
            _saleParams(address(shareToken), address(paymentToken), SALE_SHARES, PRICE, keccak256("valid-sale-asset"));
        assertTrue(
            distributionFactory.canCall(
                address(boardroom),
                owner,
                address(distributionFactory),
                0,
                abi.encodeCall(DistributionFactory.createFixedPriceSale, (saleParams))
            )
        );

        MigratingBondingCurve.CreateParams memory curveParams =
            _curveParams(address(shareToken), address(paymentToken), keccak256("valid-curve-asset"));
        assertTrue(
            distributionFactory.canCall(
                address(boardroom),
                owner,
                address(distributionFactory),
                0,
                abi.encodeCall(DistributionFactory.createMigratingBondingCurve, (curveParams))
            )
        );
    }

    function testMigratingBondingCurveFreezesTradingAtGraduationAndRequiresNinetyFivePercentMinima() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("curve-graduation-latch");
        MigratingBondingCurve curve = _createMigratingCurve(boardroom, shareToken, "curve-graduation-latch-create");

        vm.prank(buyer);
        paymentToken.approve(address(curve), 600_000000);
        vm.prank(buyer);
        curve.buy(250 ether, buyer, 500_000000, block.timestamp);

        assertTrue(curve.graduationLatched());
        assertTrue(curve.canMigrate());
        assertEq(curve.quoteReserve(), 500_000000);

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(MigratingBondingCurve.MigrationMinimumTooLow.selector, 0, 712.5 ether));
        boardroom.execute(
            _policyCall(
                address(distributionFactory),
                address(curve),
                0,
                abi.encodeCall(MigratingBondingCurve.migrate, (0, 0, block.timestamp))
            )
        );

        vm.prank(buyer);
        vm.expectRevert(MigratingBondingCurve.GraduationLatched.selector);
        curve.buy(1 ether, buyer, 2_000000, block.timestamp);

        vm.prank(buyer);
        shareToken.approve(address(curve), 1 ether);
        vm.prank(buyer);
        vm.expectRevert(MigratingBondingCurve.GraduationLatched.selector);
        curve.sell(1 ether, buyer, 0, block.timestamp);

        assertTrue(curve.graduationLatched());
        assertEq(curve.quoteReserve(), 500_000000);
        assertEq(curve.remainingSaleShares(), 250 ether);
        assertEq(curve.sellableSharesBy(buyer), 250 ether);
    }

    function testMigratingBondingCurveCancellationQuarantinesHostileQuoteAndCanRecoverAfterRedemptionsOpen() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("curve-hostile-quote-cancel");
        MutableDistributionCurrency mutableQuote = new MutableDistributionCurrency();
        mutableQuote.mint(buyer, 1_000_000000);
        MigratingBondingCurve curve =
            _createMigratingCurve(boardroom, shareToken, mutableQuote, "curve-hostile-quote-cancel-create");

        vm.prank(buyer);
        mutableQuote.approve(address(curve), 200_000000);
        vm.prank(buyer);
        curve.buy(100 ether, buyer, 200_000000, block.timestamp);

        mutableQuote.setGasBurnMode(true, false);
        vm.startPrank(owner);
        boardroom.startWindDown();
        boardroom.execute(
            _policyCall(
                address(distributionFactory), address(curve), 0, abi.encodeCall(MigratingBondingCurve.cancel, ())
            )
        );
        boardroom.quarantineRedeemableAsset(address(mutableQuote));
        boardroom.openRedemptions();
        vm.stopPrank();

        assertTrue(curve.isClosed());
        assertTrue(curve.quoteQuarantined());
        assertEq(curve.unrecoveredQuote(), 200_000000);
        assertEq(curve.quoteReserve(), 0);
        assertEq(shareToken.balanceOf(address(curve)), 0);
        assertEq(uint8(boardroom.status()), uint8(Boardroom.BoardroomStatus.RedemptionsOpen));

        mutableQuote.setGasBurnMode(false, true);
        vm.prank(recipient);
        assertEq(curve.recoverQuarantinedQuote(), 0);
        assertTrue(curve.quoteQuarantined());
        assertEq(curve.unrecoveredQuote(), 200_000000);

        mutableQuote.setGasBurnMode(false, false);
        vm.prank(recipient);
        assertEq(curve.recoverQuarantinedQuote(), 200_000000);

        assertFalse(curve.quoteQuarantined());
        assertEq(curve.unrecoveredQuote(), 0);
        assertEq(mutableQuote.balanceOf(address(curve)), 0);
        assertEq(mutableQuote.balanceOf(address(boardroom)), 200_000000);
        assertFalse(boardroom.isRedeemableAsset(address(mutableQuote)));

        vm.prank(recipient);
        assertEq(boardroom.sweepRedemptionExcess(address(mutableQuote)), 200_000000);
        assertEq(mutableQuote.balanceOf(address(boardroom)), 0);
        assertEq(mutableQuote.balanceOf(owner), 200_000000);
    }

    function testMigratingBondingCurvePolicyRejectsAmmInfeasibleBounds() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("curve-amm-bounds");
        MigratingBondingCurve.CreateParams memory params =
            _curveParams(address(shareToken), address(paymentToken), keccak256("curve-supply-overflow"));

        params.saleSupply = uint256(type(uint112).max);
        params.migrationSupply = 1;
        assertFalse(
            distributionFactory.canCall(
                address(boardroom),
                owner,
                address(distributionFactory),
                0,
                abi.encodeCall(DistributionFactory.createMigratingBondingCurve, (params))
            )
        );

        params.saleSupply = 1 ether;
        params.migrationSupply = 1 ether;
        params.basePrice = uint256(type(uint112).max);
        params.slope = uint256(type(uint112).max);
        params.quoteToLpBps = 10_000;
        assertFalse(
            distributionFactory.canCall(
                address(boardroom),
                owner,
                address(distributionFactory),
                0,
                abi.encodeCall(DistributionFactory.createMigratingBondingCurve, (params))
            )
        );
    }

    function testDistributionPolicyRejectsNonShareTokenApproval() public {
        (Boardroom boardroom,) = _createBoardroom("reject-non-share-approval");

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                Boardroom.CallNotAllowed.selector,
                address(distributionFactory),
                address(paymentToken),
                DistributionCurrency.approve.selector
            )
        );
        boardroom.execute(
            _policyCall(
                address(distributionFactory),
                address(paymentToken),
                0,
                abi.encodeCall(DistributionCurrency.approve, (address(distributionFactory), 1))
            )
        );
    }

    function testDistributionPolicyRejectsPastAndZeroWidthFiniteWindows() public {
        vm.warp(100);
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("distribution-time-windows");

        FixedPriceSale.CreateParams memory saleParams = _saleParams(
            address(shareToken), address(paymentToken), SALE_SHARES, PRICE, keccak256("invalid-window-sale")
        );
        saleParams.startTime = 100;
        saleParams.endTime = 100;
        assertFalse(
            distributionFactory.canCall(
                address(boardroom),
                owner,
                address(distributionFactory),
                0,
                abi.encodeCall(DistributionFactory.createFixedPriceSale, (saleParams))
            )
        );
        saleParams.startTime = 1;
        assertFalse(
            distributionFactory.canCall(
                address(boardroom),
                owner,
                address(distributionFactory),
                0,
                abi.encodeCall(DistributionFactory.createFixedPriceSale, (saleParams))
            )
        );

        MigratingBondingCurve.CreateParams memory curveParams =
            _curveParams(address(shareToken), address(paymentToken), keccak256("invalid-window-curve"));
        curveParams.startTime = 100;
        curveParams.endTime = 100;
        assertFalse(
            distributionFactory.canCall(
                address(boardroom),
                owner,
                address(distributionFactory),
                0,
                abi.encodeCall(DistributionFactory.createMigratingBondingCurve, (curveParams))
            )
        );
        curveParams.startTime = 1;
        assertFalse(
            distributionFactory.canCall(
                address(boardroom),
                owner,
                address(distributionFactory),
                0,
                abi.encodeCall(DistributionFactory.createMigratingBondingCurve, (curveParams))
            )
        );

        MerkleAirdrop.CreateParams memory airdropParams = _airdropParams(
            address(shareToken), AIRDROP_SHARES, keccak256("invalid-window-root"), keccak256("invalid-window-airdrop")
        );
        airdropParams.startTime = 100;
        airdropParams.endTime = 100;
        assertFalse(
            distributionFactory.canCall(
                address(boardroom),
                owner,
                address(distributionFactory),
                0,
                abi.encodeCall(DistributionFactory.createMerkleAirdrop, (airdropParams))
            )
        );
        airdropParams.startTime = 1;
        assertFalse(
            distributionFactory.canCall(
                address(boardroom),
                owner,
                address(distributionFactory),
                0,
                abi.encodeCall(DistributionFactory.createMerkleAirdrop, (airdropParams))
            )
        );
    }

    function testDistributionPolicyRejectsSaleOwnedByAnotherBoardroom() public {
        (Boardroom firstBoardroom, BoardroomToken firstShareToken) = _createBoardroom("first-boardroom");
        (Boardroom secondBoardroom,) = _createBoardroom("second-boardroom");
        FixedPriceSale sale =
            _createFixedPriceSale(firstBoardroom, firstShareToken, paymentToken, "foreign-sale-create");

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                Boardroom.CallNotAllowed.selector,
                address(distributionFactory),
                address(sale),
                FixedPriceSale.close.selector
            )
        );
        secondBoardroom.execute(
            _policyCall(address(distributionFactory), address(sale), 0, abi.encodeCall(FixedPriceSale.close, ()))
        );
    }

    function testDistributionPolicyRejectsSaleForWrongShareToken() public {
        (Boardroom boardroom,) = _createBoardroom("wrong-share-token-sale");
        DistributionCurrency wrongShareToken = new DistributionCurrency("Wrong", "WRONG", 18);
        wrongShareToken.mint(address(boardroom), SALE_SHARES);

        FixedPriceSale.CreateParams memory params = _saleParams(
            address(wrongShareToken),
            address(paymentToken),
            SALE_SHARES,
            PRICE,
            keccak256("wrong-share-token-sale-create")
        );

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                Boardroom.CallNotAllowed.selector,
                address(distributionFactory),
                address(distributionFactory),
                DistributionFactory.createFixedPriceSale.selector
            )
        );
        boardroom.execute(
            _policyCall(
                address(distributionFactory),
                address(distributionFactory),
                0,
                abi.encodeCall(DistributionFactory.createFixedPriceSale, (params))
            )
        );
    }

    function testDistributionFactoryRejectsWrongShareTokenEvenWhenApproved() public {
        (Boardroom boardroom,) = _createBoardroom("distribution-wrong-share-token");
        uint256 amount = 1 ether;

        vm.deal(address(this), amount);
        wrappedNative.deposit{value: amount}();
        assertTrue(wrappedNative.transfer(address(boardroom), amount));

        vm.startPrank(owner);
        boardroom.execute(
            _policyCall(
                address(assetPolicy),
                address(wrappedNative),
                0,
                abi.encodeWithSignature("approve(address,uint256)", address(distributionFactory), amount)
            )
        );

        FixedPriceSale.CreateParams memory saleParams = _saleParams(
            address(wrappedNative), address(paymentToken), amount, PRICE, keccak256("distribution-wrong-share-sale")
        );
        vm.expectRevert(
            abi.encodeWithSelector(
                Boardroom.CallNotAllowed.selector,
                address(distributionFactory),
                address(distributionFactory),
                DistributionFactory.createFixedPriceSale.selector
            )
        );
        boardroom.execute(
            _policyCall(
                address(distributionFactory),
                address(distributionFactory),
                0,
                abi.encodeCall(DistributionFactory.createFixedPriceSale, (saleParams))
            )
        );

        MigratingBondingCurve.CreateParams memory curveParams =
            _curveParams(address(wrappedNative), address(paymentToken), keccak256("distribution-wrong-share-curve"));
        vm.expectRevert(
            abi.encodeWithSelector(
                Boardroom.CallNotAllowed.selector,
                address(distributionFactory),
                address(distributionFactory),
                DistributionFactory.createMigratingBondingCurve.selector
            )
        );
        boardroom.execute(
            _policyCall(
                address(distributionFactory),
                address(distributionFactory),
                0,
                abi.encodeCall(DistributionFactory.createMigratingBondingCurve, (curveParams))
            )
        );

        MerkleAirdrop.CreateParams memory airdropParams = _airdropParams(
            address(wrappedNative),
            amount,
            keccak256("distribution-wrong-share-airdrop-root"),
            keccak256("distribution-wrong-share-airdrop")
        );
        vm.expectRevert(
            abi.encodeWithSelector(
                Boardroom.CallNotAllowed.selector,
                address(distributionFactory),
                address(distributionFactory),
                DistributionFactory.createMerkleAirdrop.selector
            )
        );
        boardroom.execute(
            _policyCall(
                address(distributionFactory),
                address(distributionFactory),
                0,
                abi.encodeCall(DistributionFactory.createMerkleAirdrop, (airdropParams))
            )
        );
        vm.stopPrank();
    }

    function testDistributionPolicyRejectsMigratingCurveWithoutLockedLiquidityFactory() public {
        DistributionFactory factoryWithoutLocker = new DistributionFactory(address(0), address(tokenGrantFactory));
        policyRegistry.registerModulePolicy(address(factoryWithoutLocker));
        assetPolicy.setApprovalSpenderAllowed(address(factoryWithoutLocker), true);

        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("curve-no-locker");
        uint256 totalShares = CURVE_SALE_SHARES + CURVE_MIGRATION_SHARES;

        vm.startPrank(owner);
        boardroom.mint(address(boardroom), totalShares);
        boardroom.execute(
            _policyCall(
                address(assetPolicy),
                address(shareToken),
                0,
                abi.encodeWithSignature("approve(address,uint256)", address(factoryWithoutLocker), totalShares)
            )
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                Boardroom.CallNotAllowed.selector,
                address(factoryWithoutLocker),
                address(factoryWithoutLocker),
                DistributionFactory.createMigratingBondingCurve.selector
            )
        );
        boardroom.execute(
            _policyCall(
                address(factoryWithoutLocker),
                address(factoryWithoutLocker),
                0,
                abi.encodeCall(
                    DistributionFactory.createMigratingBondingCurve,
                    (_curveParams(address(shareToken), address(paymentToken), keccak256("curve-no-locker-create")))
                )
            )
        );
        vm.stopPrank();
    }

    function _createBoardroom(string memory saltLabel)
        internal
        returns (Boardroom boardroom, BoardroomToken shareToken)
    {
        address boardroomAddress =
            boardroomFactory.createBoardroom(owner, "Distribution Common", "DIST", keccak256(bytes(saltLabel)));
        boardroom = Boardroom(payable(boardroomAddress));
        shareToken = BoardroomToken(boardroom.shareToken());
        assetPolicy.setAssetAllowed(address(shareToken), true);
    }

    function _createFixedPriceSale(
        Boardroom boardroom,
        BoardroomToken shareToken,
        DistributionCurrency paymentToken_,
        string memory saltLabel
    ) internal returns (FixedPriceSale sale) {
        vm.startPrank(owner);
        boardroom.mint(address(boardroom), SALE_SHARES);

        bytes32 salt = keccak256(bytes(saltLabel));
        address predictedSale = distributionFactory.predictFixedPriceSaleAddress(address(boardroom), salt);
        FixedPriceSale.CreateParams memory params =
            _saleParams(address(shareToken), address(paymentToken_), SALE_SHARES, PRICE, salt);

        Boardroom.Call[] memory calls = new Boardroom.Call[](2);
        calls[0] = _policyCall(
            address(assetPolicy),
            address(shareToken),
            0,
            abi.encodeWithSignature("approve(address,uint256)", address(distributionFactory), SALE_SHARES)
        );
        calls[1] = _policyCall(
            address(distributionFactory),
            address(distributionFactory),
            0,
            abi.encodeCall(DistributionFactory.createFixedPriceSale, (params))
        );

        bytes[] memory results = boardroom.executeBatch(calls);
        vm.stopPrank();

        address createdSale = abi.decode(results[1], (address));
        assertEq(createdSale, predictedSale);
        sale = FixedPriceSale(createdSale);
    }

    function _createMigratingCurve(Boardroom boardroom, BoardroomToken shareToken, string memory saltLabel)
        internal
        returns (MigratingBondingCurve curve)
    {
        return _createMigratingCurve(boardroom, shareToken, paymentToken, saltLabel);
    }

    function _createMigratingCurve(
        Boardroom boardroom,
        BoardroomToken shareToken,
        DistributionCurrency quoteToken,
        string memory saltLabel
    ) internal returns (MigratingBondingCurve curve) {
        return _createMigratingCurve(boardroom, shareToken, address(quoteToken), saltLabel);
    }

    function _createMigratingCurve(
        Boardroom boardroom,
        BoardroomToken shareToken,
        MutableDistributionCurrency quoteToken,
        string memory saltLabel
    ) internal returns (MigratingBondingCurve curve) {
        return _createMigratingCurve(boardroom, shareToken, address(quoteToken), saltLabel);
    }

    function _createMigratingCurve(
        Boardroom boardroom,
        BoardroomToken shareToken,
        address quoteToken,
        string memory saltLabel
    ) internal returns (MigratingBondingCurve curve) {
        uint256 totalShares = CURVE_SALE_SHARES + CURVE_MIGRATION_SHARES;

        vm.startPrank(owner);
        boardroom.mint(address(boardroom), totalShares);

        bytes32 salt = keccak256(bytes(saltLabel));
        address predictedCurve = distributionFactory.predictMigratingBondingCurveAddress(address(boardroom), salt);
        MigratingBondingCurve.CreateParams memory params = _curveParams(address(shareToken), quoteToken, salt);

        Boardroom.Call[] memory calls = new Boardroom.Call[](2);
        calls[0] = _policyCall(
            address(assetPolicy),
            address(shareToken),
            0,
            abi.encodeWithSignature("approve(address,uint256)", address(distributionFactory), totalShares)
        );
        calls[1] = _policyCall(
            address(distributionFactory),
            address(distributionFactory),
            0,
            abi.encodeCall(DistributionFactory.createMigratingBondingCurve, (params))
        );

        bytes[] memory results = boardroom.executeBatch(calls);
        vm.stopPrank();

        address createdCurve = abi.decode(results[1], (address));
        assertEq(createdCurve, predictedCurve);
        curve = MigratingBondingCurve(createdCurve);
        assertEq(curve.boardroom(), address(boardroom));
        assertEq(curve.shareToken(), address(shareToken));
        assertEq(curve.quoteToken(), quoteToken);
        assertEq(shareToken.balanceOf(address(curve)), totalShares);
        assertEq(shareToken.allowance(address(boardroom), address(distributionFactory)), 0);
        assertEq(distributionFactory.distributionCountForBoardroom(address(boardroom)), 1);
        assertEq(distributionFactory.distributionForBoardroomAt(address(boardroom), 0), address(curve));
        assertEq(boardroom.issuedDistributionCount(), 1);
        assertEq(boardroom.issuedDistributionAt(0), address(curve));
        assertTrue(boardroom.isIssuedDistribution(address(curve)));
        assertTrue(boardroom.isRedeemableAsset(quoteToken));
    }

    function _createMerkleAirdrop(
        Boardroom boardroom,
        BoardroomToken shareToken,
        bytes32 root,
        uint256 shareAmount,
        bytes32 salt
    ) internal returns (MerkleAirdrop airdrop) {
        return _createMerkleAirdrop(boardroom, shareToken, root, shareAmount, salt, 0);
    }

    function _createMerkleAirdrop(
        Boardroom boardroom,
        BoardroomToken shareToken,
        bytes32 root,
        uint256 shareAmount,
        bytes32 salt,
        uint16 maxGrantClaims
    ) internal returns (MerkleAirdrop airdrop) {
        vm.startPrank(owner);
        boardroom.mint(address(boardroom), shareAmount);

        address predictedAirdrop = distributionFactory.predictMerkleAirdropAddress(address(boardroom), salt);
        MerkleAirdrop.CreateParams memory params = _airdropParams(address(shareToken), shareAmount, root, salt);
        params.maxGrantClaims = maxGrantClaims;

        Boardroom.Call[] memory calls = new Boardroom.Call[](2);
        calls[0] = _policyCall(
            address(assetPolicy),
            address(shareToken),
            0,
            abi.encodeWithSignature("approve(address,uint256)", address(distributionFactory), shareAmount)
        );
        calls[1] = _policyCall(
            address(distributionFactory),
            address(distributionFactory),
            0,
            abi.encodeCall(DistributionFactory.createMerkleAirdrop, (params))
        );

        bytes[] memory results = boardroom.executeBatch(calls);
        vm.stopPrank();

        address createdAirdrop = abi.decode(results[1], (address));
        assertEq(createdAirdrop, predictedAirdrop);
        airdrop = MerkleAirdrop(createdAirdrop);
    }

    function _saleParams(address shareToken, address paymentToken_, uint256 shareAmount, uint256 price, bytes32 salt)
        internal
        view
        returns (FixedPriceSale.CreateParams memory params)
    {
        params = FixedPriceSale.CreateParams({
            shareToken: shareToken,
            paymentToken: paymentToken_,
            shareAmount: shareAmount,
            price: price,
            maxPerBuyer: 0,
            startTime: uint64(block.timestamp),
            endTime: 0,
            salt: salt
        });
    }

    function _curveParams(address shareToken, address quoteToken, bytes32 salt)
        internal
        view
        returns (MigratingBondingCurve.CreateParams memory params)
    {
        params = MigratingBondingCurve.CreateParams({
            shareToken: shareToken,
            quoteToken: quoteToken,
            saleSupply: CURVE_SALE_SHARES,
            migrationSupply: CURVE_MIGRATION_SHARES,
            basePrice: PRICE,
            slope: 0,
            graduationQuoteTarget: CURVE_GRADUATION_TARGET,
            quoteToLpBps: 5_000,
            startTime: uint64(block.timestamp),
            endTime: 0,
            migrationSalt: keccak256(abi.encodePacked(salt, "migration")),
            salt: salt
        });
    }

    function _airdropParams(address shareToken, uint256 shareAmount, bytes32 root, bytes32 salt)
        internal
        view
        returns (MerkleAirdrop.CreateParams memory params)
    {
        params = MerkleAirdrop.CreateParams({
            shareToken: shareToken,
            shareAmount: shareAmount,
            merkleRoot: root,
            startTime: uint64(block.timestamp),
            endTime: 0,
            maxGrantClaims: 0,
            salt: salt
        });
    }

    function _grantClaimParams(string memory saltLabel)
        internal
        view
        returns (MerkleAirdrop.GrantClaimParams memory params)
    {
        params = MerkleAirdrop.GrantClaimParams({
            paymentToken: address(0),
            price: 0,
            expiry: block.timestamp + 365 days,
            vestingCliff: block.timestamp + 30 days,
            vestingEnd: block.timestamp + 180 days,
            transferable: false,
            transferUnlockTime: 0,
            salt: keccak256(bytes(saltLabel))
        });
    }

    function _feeBypassGrantParams(string memory saltLabel)
        internal
        view
        returns (TokenGrantFactory.GrantCreateParams memory params)
    {
        params = TokenGrantFactory.GrantCreateParams({
            holder: recipient,
            token: address(paymentToken),
            paymentToken: address(0),
            amount: 1,
            price: 0,
            expiry: block.timestamp + 365 days,
            vestingCliff: block.timestamp,
            vestingEnd: block.timestamp + 30 days,
            transferable: false,
            transferUnlockTime: 0,
            salt: keccak256(bytes(saltLabel))
        });
    }

    function _directClaimLeaf(
        address airdrop,
        Boardroom boardroom,
        BoardroomToken shareToken,
        uint256 index,
        address account,
        uint256 amount
    ) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                DIRECT_CLAIM_TYPEHASH,
                block.chainid,
                index,
                airdrop,
                address(boardroom),
                address(shareToken),
                account,
                amount
            )
        );
    }

    function _grantClaimLeaf(
        address airdrop,
        Boardroom boardroom,
        BoardroomToken shareToken,
        uint256 index,
        address account,
        uint256 amount,
        MerkleAirdrop.GrantClaimParams memory params
    ) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                GRANT_CLAIM_TYPEHASH,
                block.chainid,
                index,
                airdrop,
                address(boardroom),
                address(shareToken),
                address(tokenGrantFactory),
                account,
                amount,
                _grantTermsHash(params)
            )
        );
    }

    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function _grantSalt(address airdrop, uint256 index, address account, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encode(airdrop, index, account, salt));
    }

    function _grantTermsHash(MerkleAirdrop.GrantClaimParams memory params) internal pure returns (bytes32) {
        return keccak256(
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
    }

    function _windDownAndRedeemAfterMigration(Boardroom boardroom, BoardroomToken shareToken, address lockerAddress)
        internal
    {
        uint256 buyerShares = shareToken.balanceOf(buyer);

        vm.startPrank(owner);
        boardroom.startWindDown();
        boardroom.exitLockedLiquidity(lockerAddress, 1, 1, block.timestamp);
        boardroom.openRedemptions();
        vm.stopPrank();

        assertEq(uint256(boardroom.status()), uint256(Boardroom.BoardroomStatus.RedemptionsOpen));
        assertEq(shareToken.balanceOf(address(boardroom)), 0);

        uint256 expectedQuote = paymentToken.balanceOf(address(boardroom)) * buyerShares / shareToken.totalSupply();
        uint256 assetCount = boardroom.redeemableAssetCount();
        uint256 paymentTokenIndex;
        bool foundPaymentToken;
        uint256[] memory minAmountsOut = new uint256[](assetCount);
        for (uint256 i; i < assetCount; ++i) {
            if (boardroom.redeemableAssetAt(i) != address(paymentToken)) continue;
            paymentTokenIndex = i;
            foundPaymentToken = true;
            minAmountsOut[i] = expectedQuote;
        }
        assertTrue(foundPaymentToken);

        vm.prank(buyer);
        uint256[] memory amountsOut = boardroom.redeem(buyerShares, buyer, minAmountsOut);

        assertEq(amountsOut[paymentTokenIndex], expectedQuote);
        assertEq(shareToken.balanceOf(buyer), 0);
    }

    function _policyCall(address policy, address target, uint256 value, bytes memory data)
        internal
        pure
        returns (Boardroom.Call memory call_)
    {
        call_ = Boardroom.Call({policy: policy, target: target, value: value, data: data});
    }
}
