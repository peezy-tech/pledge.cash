// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {WETH} from "solady/tokens/WETH.sol";
import {AmmFactory} from "../src/amm/AmmFactory.sol";
import {AmmRouter} from "../src/amm/AmmRouter.sol";
import {BondMarket} from "../src/bonds/BondMarket.sol";
import {BondMarketFactoryVNext} from "../src/bonds/BondMarketFactoryVNext.sol";
import {Boardroom} from "../src/boardroom/Boardroom.sol";
import {BoardroomGovernanceLogic} from "../src/boardroom/BoardroomGovernanceLogic.sol";
import {BoardroomCall} from "../src/boardroom/IBoardroomGovernance.sol";
import {BoardroomMarketLogic} from "../src/boardroom/BoardroomMarketLogic.sol";
import {BoardroomPolicyRegistry} from "../src/boardroom/BoardroomPolicyRegistry.sol";
import {BoardroomRedemptionPayout} from "../src/boardroom/BoardroomRedemptionPayout.sol";
import {DistributionFactoryVNext} from "../src/distribution/DistributionFactoryVNext.sol";
import {DutchAuctionSale} from "../src/distribution/DutchAuctionSale.sol";
import {FixedPriceSale} from "../src/distribution/FixedPriceSale.sol";
import {MerkleAirdropVNext} from "../src/distribution/MerkleAirdropVNext.sol";
import {MigratingBondingCurveVNext} from "../src/distribution/MigratingBondingCurveVNext.sol";
import {ProtocolFeeRouter} from "../src/fees/ProtocolFeeRouter.sol";
import {TokenGrant} from "../src/grants/TokenGrant.sol";
import {TokenGrantFactoryVNext} from "../src/grants/TokenGrantFactoryVNext.sol";
import {LockedLiquidityFactoryVNext} from "../src/liquidity/LockedLiquidityFactoryVNext.sol";
import {AssetPolicy} from "../src/policy/AssetPolicy.sol";
import {BoardroomRewards} from "../src/rewards/BoardroomRewards.sol";
import {BoardroomRewardsFactoryVNext} from "../src/rewards/BoardroomRewardsFactoryVNext.sol";
import {BoardroomAuthorityFacet} from "../src/boardroom/diamond/BoardroomAuthorityFacet.sol";
import {IBoardroomDiamond} from "../src/boardroom/diamond/BoardroomDiamond.sol";
import {BoardroomExecutionFacet} from "../src/boardroom/diamond/BoardroomExecutionFacet.sol";
import {BoardroomKernel} from "../src/boardroom/diamond/BoardroomKernel.sol";
import {BoardroomMarketFacet} from "../src/boardroom/diamond/BoardroomMarketFacet.sol";
import {BoardroomRedemptionFacet} from "../src/boardroom/diamond/BoardroomRedemptionFacet.sol";
import {BoardroomReleaseBMigrationFacet} from "../src/boardroom/diamond/BoardroomReleaseBMigrationFacet.sol";
import {BoardroomTokenVNext} from "../src/boardroom/diamond/BoardroomTokenVNext.sol";
import {BoardroomVNextController} from "../src/boardroom/diamond/BoardroomVNextController.sol";
import {BoardroomVNextControllerFactory} from "../src/boardroom/diamond/BoardroomVNextControllerFactory.sol";
import {BoardroomVNextFactory} from "../src/boardroom/diamond/BoardroomVNextFactory.sol";
import {BoardroomVNextRelease} from "../src/boardroom/diamond/BoardroomVNextRelease.sol";
import {BoardroomViewFacet} from "../src/boardroom/diamond/BoardroomViewFacet.sol";
import {BoardroomViewFacetV2} from "../src/boardroom/diamond/BoardroomViewFacetV2.sol";
import {ProtocolFacetRegistry} from "../src/boardroom/diamond/ProtocolFacetRegistry.sol";
import {ProtocolFacetTypes} from "../src/boardroom/diamond/ProtocolFacetTypes.sol";
import {PledgeCashBoardroomDiamondSalts} from "../src/deployment/PledgeCashBoardroomDiamondSalts.sol";

/// @notice Local, proof-only release-A to release-B scenario.
/// @dev It never writes chain deployment artifacts and has no broadcast command.
contract BoardroomDiamondVNextScenario is Script {
    uint256 internal constant DEFAULT_DEPLOYER_KEY = 0xA11CE;
    uint256 internal constant DEFAULT_HOLDER_KEY = 0xB0B;
    bytes32 internal constant GRANT_CLAIM_TYPEHASH = keccak256(
        "MerkleAirdropGrantClaim(uint256 chainId,uint256 index,address airdrop,address boardroom,address shareToken,address tokenGrantFactory,address account,uint256 amount,bytes32 termsHash)"
    );
    bytes32 internal constant GRANT_TERMS_TYPEHASH = keccak256(
        "MerkleAirdropGrantTerms(address paymentToken,uint256 price,uint256 expiry,uint256 vestingCliff,uint256 vestingEnd,bool transferable,uint256 transferUnlockTime,bytes32 salt)"
    );

    address internal holder;
    address internal protocolGovernance;
    address internal protocolTreasury;
    address internal ammFeeManager;
    WETH internal wrappedNative;
    BoardroomPolicyRegistry internal policyRegistry;
    ProtocolFacetRegistry internal registry;
    BoardroomKernel internal kernel;
    BoardroomVNextFactory internal factory;
    IBoardroomDiamond internal boardroom;
    BoardroomTokenVNext internal shares;
    IBoardroomDiamond internal curveBoardroom;
    BoardroomTokenVNext internal curveShares;
    IBoardroomDiamond internal graduatedCurveBoardroom;
    BoardroomTokenVNext internal graduatedCurveShares;
    AssetPolicy internal assetPolicy;
    ProtocolFeeRouter internal protocolFeeRouter;
    AmmFactory internal ammFactory;
    AmmRouter internal ammRouter;
    TokenGrantFactoryVNext internal tokenGrantFactory;
    LockedLiquidityFactoryVNext internal lockedLiquidityFactory;
    DistributionFactoryVNext internal distributionFactory;
    BoardroomRewardsFactoryVNext internal rewardsFactory;
    BondMarketFactoryVNext internal bondMarketFactory;
    BoardroomRewards internal rewards;
    FixedPriceSale internal fixedSale;
    DutchAuctionSale internal dutchAuction;
    MerkleAirdropVNext internal merkleAirdrop;
    TokenGrant internal directGrant;
    TokenGrant internal airdropGrant;
    MigratingBondingCurveVNext internal migratingCurve;
    MigratingBondingCurveVNext internal graduatedCurve;
    BondMarket internal bondMarket;
    BoardroomVNextController internal controller;
    address internal liquidityLocker;
    address internal liquidityPool;
    address internal graduatedCurveLocker;
    address internal graduatedCurvePool;
    BoardroomVNextRelease.Facets internal facets;
    bytes32 internal releaseAHash;
    bytes32 internal releaseBHash;
    uint256 internal governanceEta;
    uint256 internal bondPositionId;

    function run() external {
        uint256 deployerKey = vm.envOr("PLEDGE_CASH_VNEXT_DEPLOYER_KEY", DEFAULT_DEPLOYER_KEY);
        uint256 holderKey = vm.envOr("PLEDGE_CASH_VNEXT_HOLDER_KEY", DEFAULT_HOLDER_KEY);
        address bootstrapAuthority = vm.addr(deployerKey);
        holder = vm.addr(holderKey);
        _loadAuthorityConfiguration(bootstrapAuthority);

        vm.startBroadcast(deployerKey);
        _deployRoots(bootstrapAuthority);
        _publishReleaseAAndCreate(bootstrapAuthority);
        _preparePrelaunch(bootstrapAuthority);
        vm.stopBroadcast();

        vm.startBroadcast(holderKey);
        _exerciseModulesAsHolder();
        vm.stopBroadcast();

        vm.startBroadcast(deployerKey);
        _cancelAuxiliaryCurve();
        _startGraduatedCurveWindDown();
        vm.stopBroadcast();

        vm.startBroadcast(holderKey);
        _unwindAuxiliaryCurveAsHolder();
        _stakeForProtection();
        vm.stopBroadcast();
        vm.roll(block.number + 1);

        vm.startBroadcast(deployerKey);
        _launch(bootstrapAuthority);
        _scheduleGovernance(bootstrapAuthority);
        vm.stopBroadcast();

        vm.warp(governanceEta);
        vm.startBroadcast(deployerKey);
        _executeGovernance(bootstrapAuthority);
        vm.stopBroadcast();

        vm.startBroadcast(holderKey);
        _startWindDownAndCloseFirstObligations();
        vm.stopBroadcast();

        vm.startBroadcast(deployerKey);
        _activateReleaseB(true);
        vm.stopBroadcast();

        vm.warp(block.timestamp + 31 days);
        vm.startBroadcast(holderKey);
        _migrateAndResumeWindDown();
        _finalizeAuxiliaryCurve();
        _finalizeGraduatedCurveLiquidity();
        vm.stopBroadcast();

        vm.startBroadcast(deployerKey);
        _snapshot();
        vm.stopBroadcast();

        vm.startBroadcast(holderKey);
        _redeem();
        vm.stopBroadcast();

        vm.startBroadcast(deployerKey);
        _handoffRootOwnership(bootstrapAuthority);
        vm.stopBroadcast();
        _verifyDeployment(protocolGovernance);
        console2.log("vNext registry", address(registry));
        console2.log("vNext factory", address(factory));
        console2.log("vNext boardroom", address(boardroom));
        console2.logBytes32(releaseAHash);
        console2.logBytes32(releaseBHash);
    }

    function _deployRoots(address bootstrapAuthority) internal {
        wrappedNative = new WETH{salt: PledgeCashBoardroomDiamondSalts.WRAPPED_NATIVE}();
        policyRegistry =
            new BoardroomPolicyRegistry{salt: PledgeCashBoardroomDiamondSalts.POLICY_REGISTRY}(bootstrapAuthority);
        registry = new ProtocolFacetRegistry{salt: PledgeCashBoardroomDiamondSalts.FACET_REGISTRY}(
            bootstrapAuthority, _reservedKernelSelectors()
        );
        kernel = new BoardroomKernel{salt: PledgeCashBoardroomDiamondSalts.KERNEL}(address(registry));
        BoardroomGovernanceLogic governanceLogic =
            new BoardroomGovernanceLogic{salt: PledgeCashBoardroomDiamondSalts.GOVERNANCE_LOGIC}();
        BoardroomMarketLogic marketLogic =
            new BoardroomMarketLogic{salt: PledgeCashBoardroomDiamondSalts.MARKET_LOGIC}();
        BoardroomRedemptionPayout redemptionLogic =
            new BoardroomRedemptionPayout{salt: PledgeCashBoardroomDiamondSalts.REDEMPTION_LOGIC}();
        factory = new BoardroomVNextFactory{salt: PledgeCashBoardroomDiamondSalts.FACTORY}(
            address(registry),
            address(policyRegistry),
            address(wrappedNative),
            address(kernel),
            address(redemptionLogic),
            address(governanceLogic),
            address(marketLogic)
        );

        address legacy = factory.legacyBoardroomLogic();
        facets.authority =
            address(new BoardroomAuthorityFacet{salt: PledgeCashBoardroomDiamondSalts.AUTHORITY_FACET}(legacy));
        facets.execution =
            address(new BoardroomExecutionFacet{salt: PledgeCashBoardroomDiamondSalts.EXECUTION_FACET}(legacy));
        facets.market = address(new BoardroomMarketFacet{salt: PledgeCashBoardroomDiamondSalts.MARKET_FACET}(legacy));
        facets.redemption =
            address(new BoardroomRedemptionFacet{salt: PledgeCashBoardroomDiamondSalts.REDEMPTION_FACET}(legacy));
        facets.viewFacet = address(new BoardroomViewFacet{salt: PledgeCashBoardroomDiamondSalts.VIEW_FACET}(legacy));
        facets.migration =
            address(new BoardroomReleaseBMigrationFacet{salt: PledgeCashBoardroomDiamondSalts.RELEASE_B_MIGRATION}());
        facets.viewV2 = address(new BoardroomViewFacetV2{salt: PledgeCashBoardroomDiamondSalts.RELEASE_B_VIEW}());

        assetPolicy = new AssetPolicy{salt: PledgeCashBoardroomDiamondSalts.ASSET_POLICY}(
            bootstrapAuthority, address(wrappedNative)
        );
        protocolFeeRouter = new ProtocolFeeRouter{salt: PledgeCashBoardroomDiamondSalts.PROTOCOL_FEE_ROUTER}(
            bootstrapAuthority, protocolTreasury
        );
        tokenGrantFactory = new TokenGrantFactoryVNext{salt: PledgeCashBoardroomDiamondSalts.TOKEN_GRANT_FACTORY}(
            bootstrapAuthority, address(factory)
        );
        ammFactory =
            new AmmFactory{salt: PledgeCashBoardroomDiamondSalts.AMM_FACTORY}(bootstrapAuthority, address(factory));
        ammRouter = new AmmRouter{salt: PledgeCashBoardroomDiamondSalts.AMM_ROUTER}(
            address(ammFactory), address(wrappedNative)
        );
        lockedLiquidityFactory = new LockedLiquidityFactoryVNext{
            salt: PledgeCashBoardroomDiamondSalts.LOCKED_LIQUIDITY_FACTORY
        }(
            address(ammRouter), address(factory)
        );
        distributionFactory = new DistributionFactoryVNext{salt: PledgeCashBoardroomDiamondSalts.DISTRIBUTION_FACTORY}(
            address(lockedLiquidityFactory), address(tokenGrantFactory)
        );
        rewardsFactory =
            new BoardroomRewardsFactoryVNext{salt: PledgeCashBoardroomDiamondSalts.REWARDS_FACTORY}(address(factory));
        bondMarketFactory = new BondMarketFactoryVNext{salt: PledgeCashBoardroomDiamondSalts.BOND_MARKET_FACTORY}(
            address(ammFactory), address(factory)
        );

        tokenGrantFactory.setFeeRecipient(address(protocolFeeRouter));
        ammFactory.setFeeManager(ammFeeManager);
        ammFactory.setProtocolFeeRecipient(address(protocolFeeRouter));
        ammFactory.setLiquidityRouter(address(ammRouter));
        ammFactory.setReservationManager(address(lockedLiquidityFactory));
        assetPolicy.setApprovalSpenderAllowed(address(tokenGrantFactory), true);
        assetPolicy.setApprovalSpenderAllowed(address(distributionFactory), true);
        assetPolicy.setApprovalSpenderAllowed(address(rewardsFactory), true);
        assetPolicy.setApprovalSpenderAllowed(address(bondMarketFactory), true);
        assetPolicy.setApprovalSpenderAllowed(address(lockedLiquidityFactory), true);
        policyRegistry.setPolicyAllowed(address(assetPolicy), true);
        policyRegistry.registerModulePolicy(address(tokenGrantFactory));
        policyRegistry.registerModulePolicy(address(distributionFactory));
        policyRegistry.registerModulePolicy(address(rewardsFactory));
        policyRegistry.registerModulePolicy(address(bondMarketFactory));
        policyRegistry.registerModulePolicy(address(lockedLiquidityFactory));
    }

    function _loadAuthorityConfiguration(address bootstrapAuthority) internal {
        protocolGovernance = vm.envOr("PLEDGE_CASH_PROTOCOL_GOVERNANCE", bootstrapAuthority);
        protocolTreasury = vm.envOr("PLEDGE_CASH_PROTOCOL_TREASURY", bootstrapAuthority);
        ammFeeManager = vm.envOr("PLEDGE_CASH_AMM_FEE_MANAGER", bootstrapAuthority);
        require(protocolGovernance != address(0), "protocol-governance");
        require(protocolTreasury != address(0), "protocol-treasury");
        require(ammFeeManager != address(0), "amm-fee-manager");
    }

    function _handoffRootOwnership(address bootstrapAuthority) internal {
        if (protocolGovernance == bootstrapAuthority) return;
        registry.transferOwnership(protocolGovernance);
        policyRegistry.transferOwnership(protocolGovernance);
        assetPolicy.transferOwnership(protocolGovernance);
        protocolFeeRouter.transferOwnership(protocolGovernance);
        tokenGrantFactory.transferOwnership(protocolGovernance);
        ammFactory.transferOwnership(protocolGovernance);
    }

    function _publishReleaseAAndCreate(address bootstrapAuthority) internal {
        BoardroomVNextRelease.Facets memory releaseFacets = facets;
        ProtocolFacetTypes.FacetSetManifest memory releaseA = BoardroomVNextRelease.releaseA(releaseFacets);
        releaseAHash = registry.publishFacetSet(releaseA);
        registry.activateFacetSet(releaseAHash);

        boardroom = IBoardroomDiamond(
            factory.createBoardroom(
                releaseAHash, bootstrapAuthority, "Local Diamond Boardroom", "LDBR", bytes32("local")
            )
        );
        shares = BoardroomTokenVNext(boardroom.shareToken());
    }

    function _preparePrelaunch(address bootstrapAuthority) internal {
        boardroom.mint(releaseAHash, holder, 200 ether);
        boardroom.mint(releaseAHash, address(boardroom), 600 ether);
        assetPolicy.setAssetAllowed(address(shares), true);
        vm.deal(bootstrapAuthority, 200 ether);
        wrappedNative.deposit{value: 200 ether}();
        require(wrappedNative.transfer(address(boardroom), 100 ether), "weth-transfer");
        require(wrappedNative.transfer(holder, 100 ether), "holder-weth-transfer");

        Boardroom.Call memory createRewards = Boardroom.Call({
            policy: address(rewardsFactory),
            target: address(rewardsFactory),
            value: 0,
            data: abi.encodeCall(
                BoardroomRewardsFactoryVNext.createRewards, (uint64(1 days), keccak256("vnext-local-rewards"))
            )
        });
        rewards = BoardroomRewards(abi.decode(boardroom.execute(releaseAHash, createRewards), (address)));
        _fundRewards();
        _createFixedSale();
        _createDutchAuction();
        _createMerkleAirdropAndGrant();
        _createDirectTreasuryGrant();
        _createBondMarket();
        _createLockedLiquidity();
        _createAuxiliaryCurve(bootstrapAuthority);
        _createGraduatingCurve(bootstrapAuthority);
        require(boardroom.activeObligationCount() == 8, "real-obligations-not-recorded");
        require(curveBoardroom.activeObligationCount() == 1, "curve-obligation-not-recorded");
        require(graduatedCurveBoardroom.activeObligationCount() == 1, "graduated-curve-obligation-not-recorded");
        require(boardroom.rewardPool() == address(rewards), "reward-pool-not-recorded");
        require(boardroom.liquidityLocker() == liquidityLocker, "liquidity-not-recorded");
    }

    function _fundRewards() internal {
        Boardroom.Call[] memory calls = new Boardroom.Call[](2);
        calls[0] = _approvalCall(address(wrappedNative), address(rewardsFactory), 10 ether);
        calls[1] = Boardroom.Call({
            policy: address(rewardsFactory),
            target: address(rewardsFactory),
            value: 0,
            data: abi.encodeCall(
                BoardroomRewardsFactoryVNext.fundReward, (address(rewards), address(wrappedNative), 10 ether, 7 days)
            )
        });
        boardroom.executeBatch(releaseAHash, calls);
        require(rewards.rewardAssetAt(0) == address(wrappedNative), "reward-asset");
    }

    function _createFixedSale() internal {
        FixedPriceSale.CreateParams memory params = FixedPriceSale.CreateParams({
            shareToken: address(shares),
            paymentToken: address(wrappedNative),
            shareAmount: 100 ether,
            price: 0.2 ether,
            maxPerBuyer: 0,
            startTime: uint64(block.timestamp),
            endTime: uint64(block.timestamp + 7 days),
            salt: keccak256("vnext-local-fixed-sale")
        });
        Boardroom.Call[] memory calls = new Boardroom.Call[](2);
        calls[0] = _approvalCall(address(shares), address(distributionFactory), params.shareAmount);
        calls[1] = Boardroom.Call({
            policy: address(distributionFactory),
            target: address(distributionFactory),
            value: 0,
            data: abi.encodeCall(DistributionFactoryVNext.createFixedPriceSale, (params))
        });
        bytes[] memory results = boardroom.executeBatch(releaseAHash, calls);
        fixedSale = FixedPriceSale(abi.decode(results[1], (address)));
        require(
            address(fixedSale) == distributionFactory.predictFixedPriceSaleAddress(address(boardroom), params.salt),
            "fixed-sale-prediction"
        );
    }

    function _createDutchAuction() internal {
        DutchAuctionSale.CreateParams memory params = DutchAuctionSale.CreateParams({
            shareToken: address(shares),
            paymentToken: address(wrappedNative),
            shareAmount: 40 ether,
            startPrice: 0.4 ether,
            floorPrice: 0.1 ether,
            maxPerBuyer: 0,
            startTime: uint64(block.timestamp),
            endTime: uint64(block.timestamp + 7 days),
            salt: keccak256("vnext-local-dutch-auction")
        });
        Boardroom.Call[] memory calls = new Boardroom.Call[](2);
        calls[0] = _approvalCall(address(shares), address(distributionFactory), params.shareAmount);
        calls[1] = Boardroom.Call({
            policy: address(distributionFactory),
            target: address(distributionFactory),
            value: 0,
            data: abi.encodeCall(DistributionFactoryVNext.createDutchAuction, (params))
        });
        bytes[] memory results = boardroom.executeBatch(releaseAHash, calls);
        dutchAuction = DutchAuctionSale(abi.decode(results[1], (address)));
        require(
            address(dutchAuction) == distributionFactory.predictDutchAuctionAddress(address(boardroom), params.salt),
            "dutch-auction-prediction"
        );
    }

    function _createMerkleAirdropAndGrant() internal {
        bytes32 airdropSalt = keccak256("vnext-local-merkle-airdrop");
        address predictedAirdrop = distributionFactory.predictMerkleAirdropAddress(address(boardroom), airdropSalt);
        MerkleAirdropVNext.GrantClaimParams memory grantParams = MerkleAirdropVNext.GrantClaimParams({
            paymentToken: address(0),
            price: 0,
            expiry: block.timestamp + 60 days,
            vestingCliff: block.timestamp + 30 days,
            vestingEnd: block.timestamp + 45 days,
            transferable: false,
            transferUnlockTime: 0,
            salt: keccak256("vnext-local-airdrop-grant")
        });
        bytes32 termsHash = keccak256(
            abi.encode(
                GRANT_TERMS_TYPEHASH,
                grantParams.paymentToken,
                grantParams.price,
                grantParams.expiry,
                grantParams.vestingCliff,
                grantParams.vestingEnd,
                grantParams.transferable,
                grantParams.transferUnlockTime,
                grantParams.salt
            )
        );
        bytes32 grantLeaf = keccak256(
            abi.encode(
                GRANT_CLAIM_TYPEHASH,
                block.chainid,
                uint256(0),
                predictedAirdrop,
                address(boardroom),
                address(shares),
                address(tokenGrantFactory),
                holder,
                10 ether,
                termsHash
            )
        );
        bytes32 directLeaf = keccak256(
            abi.encode(
                keccak256(
                    "MerkleAirdropDirectClaim(uint256 chainId,uint256 index,address airdrop,address boardroom,address shareToken,address account,uint256 amount)"
                ),
                block.chainid,
                uint256(1),
                predictedAirdrop,
                address(boardroom),
                address(shares),
                holder,
                5 ether
            )
        );
        bytes32 root = _hashPair(grantLeaf, directLeaf);
        MerkleAirdropVNext.CreateParams memory params = MerkleAirdropVNext.CreateParams({
            shareToken: address(shares),
            shareAmount: 20 ether,
            merkleRoot: root,
            startTime: uint64(block.timestamp),
            endTime: uint64(block.timestamp + 30 days),
            maxGrantClaims: 1,
            salt: airdropSalt
        });
        Boardroom.Call[] memory calls = new Boardroom.Call[](2);
        calls[0] = _approvalCall(address(shares), address(distributionFactory), params.shareAmount);
        calls[1] = Boardroom.Call({
            policy: address(distributionFactory),
            target: address(distributionFactory),
            value: 0,
            data: abi.encodeCall(DistributionFactoryVNext.createMerkleAirdrop, (params))
        });
        bytes[] memory results = boardroom.executeBatch(releaseAHash, calls);
        merkleAirdrop = MerkleAirdropVNext(abi.decode(results[1], (address)));
        require(address(merkleAirdrop) == predictedAirdrop, "merkle-airdrop-prediction");

        bytes32[] memory grantProof = new bytes32[](1);
        grantProof[0] = directLeaf;
        airdropGrant = TokenGrant(merkleAirdrop.claimGrant(0, holder, 10 ether, grantParams, grantProof));
        bytes32[] memory directProof = new bytes32[](1);
        directProof[0] = grantLeaf;
        merkleAirdrop.claim(1, holder, 5 ether, directProof);
        require(boardroom.isIssuedGrant(address(airdropGrant)), "airdrop-grant-not-recorded");
    }

    function _createDirectTreasuryGrant() internal {
        Boardroom.Call[] memory calls = new Boardroom.Call[](2);
        calls[0] = _approvalCall(address(wrappedNative), address(tokenGrantFactory), 5 ether);
        calls[1] = Boardroom.Call({
            policy: address(tokenGrantFactory),
            target: address(tokenGrantFactory),
            value: 0,
            data: abi.encodeCall(
                TokenGrantFactoryVNext.createGrant,
                (
                    holder,
                    address(wrappedNative),
                    address(0),
                    5 ether,
                    0,
                    block.timestamp + 60 days,
                    block.timestamp + 30 days,
                    block.timestamp + 45 days,
                    false,
                    0,
                    keccak256("vnext-local-direct-grant")
                )
            )
        });
        bytes[] memory results = boardroom.executeBatch(releaseAHash, calls);
        directGrant = TokenGrant(abi.decode(results[1], (address)));
        require(boardroom.isIssuedGrant(address(directGrant)), "direct-grant-not-recorded");
    }

    function _createBondMarket() internal {
        BondMarket.CreateParams memory params = BondMarket.CreateParams({
            quoteToken: address(wrappedNative),
            kind: BondMarket.MarketKind.Reserve,
            capacity: 50 ether,
            initialPrice: 1 ether,
            minimumPrice: 0.5 ether,
            debtBuffer: 25_000,
            vesting: uint48(7 days),
            start: 0,
            duration: uint32(30 days),
            depositInterval: uint32(1 days),
            salt: keccak256("vnext-local-reserve-bond")
        });
        Boardroom.Call[] memory calls = new Boardroom.Call[](2);
        calls[0] = _approvalCall(address(shares), address(bondMarketFactory), params.capacity);
        calls[1] = Boardroom.Call({
            policy: address(bondMarketFactory),
            target: address(bondMarketFactory),
            value: 0,
            data: abi.encodeCall(BondMarketFactoryVNext.createBondMarket, (params))
        });
        bytes[] memory results = boardroom.executeBatch(releaseAHash, calls);
        bondMarket = BondMarket(abi.decode(results[1], (address)));
        require(
            address(bondMarket) == bondMarketFactory.predictBondMarketAddress(address(boardroom), params.salt),
            "bond-market-prediction"
        );
    }

    function _createLockedLiquidity() internal {
        LockedLiquidityFactoryVNext.CreateParams memory params = LockedLiquidityFactoryVNext.CreateParams({
            tokenA: address(shares),
            tokenB: address(wrappedNative),
            amountADesired: 100 ether,
            amountBDesired: 20 ether,
            amountAMin: 95 ether,
            amountBMin: 19 ether,
            deadline: block.timestamp + 1 hours,
            salt: keccak256("vnext-local-locked-liquidity")
        });
        Boardroom.Call[] memory calls = new Boardroom.Call[](3);
        calls[0] = _approvalCall(address(shares), address(lockedLiquidityFactory), params.amountADesired);
        calls[1] = _approvalCall(address(wrappedNative), address(lockedLiquidityFactory), params.amountBDesired);
        calls[2] = Boardroom.Call({
            policy: address(lockedLiquidityFactory),
            target: address(lockedLiquidityFactory),
            value: 0,
            data: abi.encodeCall(LockedLiquidityFactoryVNext.createLockedLiquidity, (params))
        });
        bytes[] memory results = boardroom.executeBatch(releaseAHash, calls);
        (liquidityLocker, liquidityPool,,,) = abi.decode(results[2], (address, address, uint256, uint256, uint256));
        require(
            liquidityLocker == lockedLiquidityFactory.predictLockedLiquidityAddress(address(boardroom), params.salt),
            "liquidity-locker-prediction"
        );
        require(ammFactory.isPool(liquidityPool), "liquidity-pool");
    }

    function _createAuxiliaryCurve(address bootstrapAuthority) internal {
        curveBoardroom = IBoardroomDiamond(
            factory.createBoardroom(
                releaseAHash, bootstrapAuthority, "Local Migrating Curve Boardroom", "LCURVE", bytes32("local-curve")
            )
        );
        curveShares = BoardroomTokenVNext(curveBoardroom.shareToken());
        assetPolicy.setAssetAllowed(address(curveShares), true);

        uint256 saleSupply = 3_600 ether;
        uint256 migrationSupply = 1_400 ether;
        curveBoardroom.mint(releaseAHash, address(curveBoardroom), saleSupply + migrationSupply);
        MigratingBondingCurveVNext.CreateParams memory params = MigratingBondingCurveVNext.CreateParams({
            shareToken: address(curveShares),
            quoteToken: address(wrappedNative),
            saleSupply: saleSupply,
            migrationSupply: migrationSupply,
            basePrice: 1.5 ether,
            slope: 1,
            graduationQuoteTarget: 12_000 ether,
            quoteToLpBps: 3_500,
            startTime: uint64(block.timestamp),
            endTime: uint64(block.timestamp + 30 days),
            migrationSalt: keccak256("vnext-local-curve-migration"),
            salt: keccak256("vnext-local-curve")
        });
        Boardroom.Call[] memory calls = new Boardroom.Call[](2);
        calls[0] = Boardroom.Call({
            policy: address(assetPolicy),
            target: address(curveShares),
            value: 0,
            data: abi.encodeWithSignature(
                "approve(address,uint256)", address(distributionFactory), saleSupply + migrationSupply
            )
        });
        calls[1] = Boardroom.Call({
            policy: address(distributionFactory),
            target: address(distributionFactory),
            value: 0,
            data: abi.encodeCall(DistributionFactoryVNext.createMigratingBondingCurve, (params))
        });
        bytes[] memory results = curveBoardroom.executeBatch(releaseAHash, calls);
        migratingCurve = MigratingBondingCurveVNext(abi.decode(results[1], (address)));
        require(
            address(migratingCurve)
                == distributionFactory.predictMigratingBondingCurveAddress(address(curveBoardroom), params.salt),
            "migrating-curve-prediction"
        );
    }

    function _createGraduatingCurve(address bootstrapAuthority) internal {
        graduatedCurveBoardroom = IBoardroomDiamond(
            factory.createBoardroom(
                releaseAHash,
                bootstrapAuthority,
                "Local Graduating Curve Boardroom",
                "LGRAD",
                bytes32("local-graduated-curve")
            )
        );
        graduatedCurveShares = BoardroomTokenVNext(graduatedCurveBoardroom.shareToken());
        assetPolicy.setAssetAllowed(address(graduatedCurveShares), true);

        uint256 saleSupply = 10 ether;
        uint256 migrationSupply = 10 ether;
        graduatedCurveBoardroom.mint(releaseAHash, address(graduatedCurveBoardroom), saleSupply + migrationSupply);
        MigratingBondingCurveVNext.CreateParams memory params = MigratingBondingCurveVNext.CreateParams({
            shareToken: address(graduatedCurveShares),
            quoteToken: address(wrappedNative),
            saleSupply: saleSupply,
            migrationSupply: migrationSupply,
            basePrice: 1 ether,
            slope: 0,
            graduationQuoteTarget: 10 ether,
            quoteToLpBps: 5_000,
            startTime: uint64(block.timestamp),
            endTime: uint64(block.timestamp + 30 days),
            migrationSalt: keccak256("vnext-local-graduated-curve-migration"),
            salt: keccak256("vnext-local-graduated-curve")
        });
        Boardroom.Call[] memory calls = new Boardroom.Call[](2);
        calls[0] = Boardroom.Call({
            policy: address(assetPolicy),
            target: address(graduatedCurveShares),
            value: 0,
            data: abi.encodeWithSignature(
                "approve(address,uint256)", address(distributionFactory), saleSupply + migrationSupply
            )
        });
        calls[1] = Boardroom.Call({
            policy: address(distributionFactory),
            target: address(distributionFactory),
            value: 0,
            data: abi.encodeCall(DistributionFactoryVNext.createMigratingBondingCurve, (params))
        });
        bytes[] memory results = graduatedCurveBoardroom.executeBatch(releaseAHash, calls);
        graduatedCurve = MigratingBondingCurveVNext(abi.decode(results[1], (address)));
        require(
            address(graduatedCurve)
                == distributionFactory.predictMigratingBondingCurveAddress(
                    address(graduatedCurveBoardroom), params.salt
                ),
            "graduated-curve-prediction"
        );
    }

    function _cancelAuxiliaryCurve() internal {
        curveBoardroom.execute(
            releaseAHash,
            Boardroom.Call({
                policy: address(distributionFactory),
                target: address(migratingCurve),
                value: 0,
                data: abi.encodeCall(MigratingBondingCurveVNext.cancel, ())
            })
        );
    }

    function _startGraduatedCurveWindDown() internal {
        require(
            graduatedCurve.curveStatus() == MigratingBondingCurveVNext.CurvePhase.Migrated,
            "graduated-curve-not-migrated"
        );
        graduatedCurveBoardroom.startWindDown(releaseAHash);
        require(
            uint8(graduatedCurveBoardroom.status()) == uint8(Boardroom.BoardroomStatus.WindingDown),
            "graduated-boardroom-wind-down"
        );
    }

    function _exerciseModulesAsHolder() internal {
        wrappedNative.approve(address(fixedSale), 2 ether);
        fixedSale.buy(5 ether, holder, 2 ether, block.timestamp + 1 hours);

        wrappedNative.approve(address(dutchAuction), 3 ether);
        dutchAuction.buy(5 ether, holder, 3 ether, block.timestamp + 1 hours);

        wrappedNative.approve(address(bondMarket), 1 ether);
        (bondPositionId,,) = bondMarket.purchase(1 ether, 1, block.timestamp + 1 hours);

        uint256 curveSharesToBuy = 10 ether;
        uint256 quote = migratingCurve.getBuyQuote(curveSharesToBuy);
        wrappedNative.approve(address(migratingCurve), quote);
        migratingCurve.buy(curveSharesToBuy, holder, quote, block.timestamp + 1 hours);

        uint256 graduatingSharesToBuy = 10 ether;
        uint256 graduatingQuote = graduatedCurve.getBuyQuote(graduatingSharesToBuy);
        wrappedNative.approve(address(graduatedCurve), graduatingQuote);
        graduatedCurve.buy(graduatingSharesToBuy, holder, graduatingQuote, block.timestamp + 1 hours);
        require(graduatedCurve.graduationLatched(), "graduation-not-latched");
        uint256 migratedShares;
        uint256 migratedQuote;
        uint256 migratedLiquidity;
        (graduatedCurveLocker, graduatedCurvePool, migratedShares, migratedQuote, migratedLiquidity) =
            graduatedCurve.migrate(5 ether, 5 ether, block.timestamp + 1 hours);
        require(migratedShares == 5 ether && migratedQuote == 5 ether, "graduated-migration-amounts");
        require(migratedLiquidity != 0, "graduated-migration-liquidity");
        require(graduatedCurveBoardroom.liquidityLocker() == graduatedCurveLocker, "graduated-liquidity-not-activated");
        (,, bool curveObligationActive,) = graduatedCurveBoardroom.obligationOf(address(graduatedCurve));
        require(
            graduatedCurveBoardroom.activeObligationCount() == 1 && !curveObligationActive,
            "graduated-obligation-not-replaced"
        );
    }

    function _unwindAuxiliaryCurveAsHolder() internal {
        uint256 curveSharesToSell = 10 ether;
        curveShares.approve(address(migratingCurve), curveSharesToSell);
        migratingCurve.sell(curveSharesToSell, holder, 1, block.timestamp + 1 hours);
    }

    function _approvalCall(address token, address spender, uint256 amount)
        internal
        view
        returns (Boardroom.Call memory)
    {
        return Boardroom.Call({
            policy: address(assetPolicy),
            target: token,
            value: 0,
            data: abi.encodeWithSignature("approve(address,uint256)", spender, amount)
        });
    }

    function _hashPair(bytes32 first, bytes32 second) internal pure returns (bytes32) {
        return first < second ? keccak256(abi.encodePacked(first, second)) : keccak256(abi.encodePacked(second, first));
    }

    function _stakeForProtection() internal {
        shares.approve(address(rewards), 200 ether);
        rewards.stake(200 ether);
    }

    function _launch(address bootstrapAuthority) internal {
        BoardroomVNextControllerFactory controllerFactory =
            BoardroomVNextControllerFactory(boardroom.controllerFactory());
        address predictedController = controllerFactory.predictControllerAddress(address(boardroom), 1);
        boardroom.launch(
            releaseAHash,
            Boardroom.LaunchConfig({
                proposer: bootstrapAuthority,
                predictedController: predictedController,
                protectionStaker: holder,
                expectedRewardPool: address(rewards),
                expectedRedemptionExcessRecipient: bootstrapAuthority,
                controllerDelay: 1 days,
                windDownDelay: 1 days,
                gracePeriod: 1 days,
                generation: 1
            })
        );
        controller = BoardroomVNextController(predictedController);
    }

    function _scheduleGovernance(address bootstrapAuthority) internal {
        BoardroomCall[] memory calls = new BoardroomCall[](1);
        calls[0] = BoardroomCall({
            policy: address(0),
            target: address(boardroom),
            value: 0,
            data: abi.encodeCall(IBoardroomDiamond.setRedemptionExcessRecipient, (releaseAHash, holder))
        });
        (, governanceEta) = controller.scheduleBoardroomOperation(
            releaseAHash,
            calls,
            keccak256("vnext-local-governance"),
            boardroom.governanceEpoch(),
            controller.configurationEpoch()
        );
        require(controller.proposer() == bootstrapAuthority, "controller-proposer");
    }

    function _executeGovernance(address bootstrapAuthority) internal {
        BoardroomCall[] memory calls = new BoardroomCall[](1);
        calls[0] = BoardroomCall({
            policy: address(0),
            target: address(boardroom),
            value: 0,
            data: abi.encodeCall(IBoardroomDiamond.setRedemptionExcessRecipient, (releaseAHash, holder))
        });
        controller.executeBoardroomOperation(
            releaseAHash,
            calls,
            keccak256("vnext-local-governance"),
            boardroom.governanceEpoch(),
            controller.configurationEpoch(),
            bootstrapAuthority
        );
        require(boardroom.redemptionExcessRecipient() == holder, "governance-not-executed");
    }

    function _startWindDownAndCloseFirstObligations() internal {
        uint256 rewardBalanceBefore = wrappedNative.balanceOf(holder);
        rewards.claim(address(wrappedNative), holder);
        require(wrappedNative.balanceOf(holder) > rewardBalanceBefore, "reward-not-claimed");
        boardroom.startWindDown(releaseAHash);
        boardroom.executeWindDownCall(
            releaseAHash,
            Boardroom.Call({
                policy: address(rewardsFactory),
                target: address(rewards),
                value: 0,
                data: abi.encodeCall(BoardroomRewards.terminalize, ())
            })
        );
        boardroom.executeWindDownCall(
            releaseAHash,
            Boardroom.Call({
                policy: address(distributionFactory),
                target: address(fixedSale),
                value: 0,
                data: abi.encodeCall(FixedPriceSale.close, ())
            })
        );
        boardroom.executeWindDownCall(
            releaseAHash,
            Boardroom.Call({
                policy: address(distributionFactory),
                target: address(dutchAuction),
                value: 0,
                data: abi.encodeCall(DutchAuctionSale.close, ())
            })
        );
        boardroom.executeWindDownCall(
            releaseAHash,
            Boardroom.Call({
                policy: address(tokenGrantFactory),
                target: address(directGrant),
                value: 0,
                data: abi.encodeCall(TokenGrant.stopVestingAndWithdrawUnvested, ())
            })
        );
        boardroom.executeWindDownCall(
            releaseAHash,
            Boardroom.Call({
                policy: address(tokenGrantFactory),
                target: address(airdropGrant),
                value: 0,
                data: abi.encodeCall(TokenGrant.stopVestingAndWithdrawUnvested, ())
            })
        );
        boardroom.executeWindDownCall(
            releaseAHash,
            Boardroom.Call({
                policy: address(distributionFactory),
                target: address(merkleAirdrop),
                value: 0,
                data: abi.encodeCall(MerkleAirdropVNext.close, ())
            })
        );
        require(boardroom.activeObligationCount() == 2, "first-terminal-obligations");
    }

    function _activateReleaseB(bool proveMigrationGate) internal {
        BoardroomVNextRelease.Facets memory releaseFacets = facets;
        ProtocolFacetTypes.FacetSetManifest memory releaseB =
            BoardroomVNextRelease.releaseB(releaseFacets, releaseAHash);
        releaseBHash = registry.publishFacetSet(releaseB);
        registry.activateFacetSet(releaseBHash);
        require(boardroom.facetSetHash() == releaseBHash, "release-b-not-routed");
        require(boardroom.appliedStorageVersion() == 1, "premature-storage-version");
        require(boardroom.migrationRequired(), "migration-not-required");
        require(uint8(boardroom.status()) == uint8(Boardroom.BoardroomStatus.WindingDown), "unsafe-migration-status");
        (bytes32 migrationMarker,, uint64 migratedFromVersion) = boardroom.releaseBMigrationState();
        require(migrationMarker == bytes32(0) && migratedFromVersion == 0, "unsafe-pre-migration-release-b-view");

        if (proveMigrationGate) {
            (bool writeSucceeded, bytes memory revertData) =
                address(boardroom).call(abi.encodeCall(IBoardroomDiamond.returnProtocolLiquidityAsLp, (releaseBHash)));
            require(
                !writeSucceeded && _revertSelector(revertData) == BoardroomKernel.StorageMigrationRequired.selector,
                "pre-migration-write-not-blocked"
            );
        }
    }

    function _migrateAndResumeWindDown() internal {
        boardroom.migrateBoardroom(releaseBHash);
        require(bondMarket.redeem(bondPositionId) != 0, "bond-not-redeemed");
        boardroom.executeWindDownCall(
            releaseBHash,
            Boardroom.Call({
                policy: address(bondMarketFactory),
                target: address(bondMarket),
                value: 0,
                data: abi.encodeCall(BondMarket.close, ())
            })
        );
        require(boardroom.returnProtocolLiquidityAsLp(releaseBHash) != 0, "lp-not-returned");
        boardroom.closeProtocolLiquidityAfterWindDown(releaseBHash);
        require(boardroom.activeObligationCount() == 0, "resumed-terminal-obligations");
    }

    function _finalizeAuxiliaryCurve() internal {
        curveBoardroom.migrateBoardroom(releaseBHash);
        migratingCurve.finalizeUnwind();
        require(curveBoardroom.activeObligationCount() == 0, "curve-terminal-obligation");
        require(!curveBoardroom.migrationRequired(), "curve-migration");
    }

    function _finalizeGraduatedCurveLiquidity() internal {
        graduatedCurveBoardroom.migrateBoardroom(releaseBHash);
        require(graduatedCurveBoardroom.returnProtocolLiquidityAsLp(releaseBHash) != 0, "graduated-lp-not-returned");
        graduatedCurveBoardroom.closeProtocolLiquidityAfterWindDown(releaseBHash);
        require(graduatedCurveBoardroom.activeObligationCount() == 0, "graduated-terminal-obligation");
        require(!graduatedCurveBoardroom.migrationRequired(), "graduated-boardroom-migration");
    }

    function _snapshot() internal {
        boardroom.beginSnapshot(releaseBHash);
        boardroom.snapshotAssets(releaseBHash, 32);
        boardroom.openRedemptions(releaseBHash);
    }

    function _redeem() internal {
        boardroom.redeem(releaseBHash, 50 ether);
        boardroom.claimRedemptionAsset(releaseBHash, address(wrappedNative), holder, 1);
        require(wrappedNative.balanceOf(holder) != 0, "redemption-payout");
    }

    function _verifyDeployment(address expectedProtocolGovernance) internal view {
        require(registry.owner() == expectedProtocolGovernance, "registry-owner");
        require(policyRegistry.owner() == expectedProtocolGovernance, "policy-registry-owner");
        require(assetPolicy.owner() == expectedProtocolGovernance, "asset-policy-owner");
        require(protocolFeeRouter.owner() == expectedProtocolGovernance, "fee-router-owner");
        require(tokenGrantFactory.owner() == expectedProtocolGovernance, "grant-factory-owner");
        require(ammFactory.owner() == expectedProtocolGovernance, "amm-factory-owner");
        require(protocolFeeRouter.feeRecipient() == protocolTreasury, "fee-router-recipient");
        require(tokenGrantFactory.feeRecipient() == address(protocolFeeRouter), "grant-fee-recipient");
        require(tokenGrantFactory.creationFee() == 0, "grant-creation-fee");
        require(ammFactory.feeManager() == ammFeeManager, "amm-fee-manager");
        require(ammFactory.protocolFeeRecipient() == address(protocolFeeRouter), "amm-fee-recipient");
        require(ammFactory.liquidityRouter() == address(ammRouter), "amm-router");
        require(ammFactory.reservationManager() == address(lockedLiquidityFactory), "amm-reservation-manager");
        require(ammFactory.boardroomFactory() == address(factory), "amm-boardroom-factory");
        require(tokenGrantFactory.boardroomFactory() == address(factory), "grant-boardroom-factory");
        require(registry.activeFacetSetHash() == releaseBHash, "active-release-hash");
        require(registry.activeRelease() == 2, "active-release-number");
        require(registry.facetAddress(BoardroomAuthorityFacet.mint.selector) == facets.authority, "mint-route");
        (address mintFacet, bytes32 mintCodeHash,) =
            registry.facetSetRoute(releaseBHash, BoardroomAuthorityFacet.mint.selector);
        require(mintFacet == facets.authority, "published-mint-facet");
        require(mintCodeHash == facets.authority.codehash, "published-mint-codehash");
        require(address(factory.facetRegistry()) == address(registry), "factory-registry");
        require(factory.boardroomKernelLogic() == address(kernel), "factory-kernel");
        require(address(kernel.facetRegistry()) == address(registry), "kernel-registry");
        Boardroom compatibilityLogic = Boardroom(payable(factory.legacyBoardroomLogic()));
        require(factory.controllerFactory().code.length != 0, "factory-controller-code");
        require(factory.governanceLogic().code.length != 0, "factory-governance-code");
        require(factory.marketLogic().code.length != 0, "factory-market-code");
        require(factory.redemptionPayoutLogic().code.length != 0, "factory-redemption-code");
        require(
            BoardroomVNextControllerFactory(factory.controllerFactory()).boardroomFactory() == address(factory),
            "controller-factory-binding"
        );
        require(compatibilityLogic.controllerFactory() == factory.controllerFactory(), "legacy-controller-binding");
        require(compatibilityLogic.governanceLogic() == factory.governanceLogic(), "legacy-governance-binding");
        require(compatibilityLogic.marketLogic() == factory.marketLogic(), "legacy-market-binding");
        require(
            compatibilityLogic.redemptionPayoutLogic() == factory.redemptionPayoutLogic(), "legacy-redemption-binding"
        );
        require(boardroom.appliedStorageVersion() == 2, "boardroom-storage-version");
        require(!boardroom.migrationRequired(), "boardroom-migration");
        require(curveBoardroom.appliedStorageVersion() == 2, "curve-boardroom-storage-version");
        require(graduatedCurveBoardroom.appliedStorageVersion() == 2, "graduated-boardroom-storage-version");
        require(graduatedCurveBoardroom.activeObligationCount() == 0, "graduated-boardroom-obligations");
    }

    function _revertSelector(bytes memory revertData) internal pure returns (bytes4 selector) {
        if (revertData.length < 4) return bytes4(0);
        assembly ("memory-safe") {
            selector := mload(add(revertData, 0x20))
        }
    }

    function _reservedKernelSelectors() internal pure returns (bytes4[] memory reserved) {
        reserved = new bytes4[](7);
        reserved[0] = bytes4(keccak256("facetRegistry()"));
        reserved[1] = bytes4(keccak256("facetSetHash()"));
        reserved[2] = BoardroomKernel.initialize.selector;
        reserved[3] = BoardroomKernel.appliedStorageVersion.selector;
        reserved[4] = BoardroomKernel.migrationRequired.selector;
        reserved[5] = BoardroomKernel.dispatchViewAndRollback.selector;
        reserved[6] = BoardroomKernel.appliedStorageLayoutHash.selector;
        for (uint256 i = 1; i < reserved.length; ++i) {
            bytes4 current = reserved[i];
            uint256 j = i;
            while (j != 0 && reserved[j - 1] > current) {
                reserved[j] = reserved[j - 1];
                --j;
            }
            reserved[j] = current;
        }
    }
}
