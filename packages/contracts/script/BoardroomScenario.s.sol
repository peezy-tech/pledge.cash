// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {WETH} from "solady/tokens/WETH.sol";
import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {FullMath} from "v4-core/libraries/FullMath.sol";
import {BondMarket} from "../src/bonds/BondMarket.sol";
import {BondMarketFactory} from "../src/bonds/BondMarketFactory.sol";
import {BoardroomGovernanceLogic} from "../src/boardroom/BoardroomGovernanceLogic.sol";
import {BoardroomCall} from "../src/boardroom/IBoardroomGovernance.sol";
import {BoardroomMarketLogic} from "../src/boardroom/BoardroomMarketLogic.sol";
import {BoardroomPolicyRegistry} from "../src/boardroom/BoardroomPolicyRegistry.sol";
import {BoardroomRedemptionPayout} from "../src/boardroom/BoardroomRedemptionPayout.sol";
import {DistributionFactory} from "../src/distribution/DistributionFactory.sol";
import {DutchAuctionSale} from "../src/distribution/DutchAuctionSale.sol";
import {FixedPriceSale} from "../src/distribution/FixedPriceSale.sol";
import {MerkleAirdrop} from "../src/distribution/MerkleAirdrop.sol";
import {MigratingBondingCurve} from "../src/distribution/MigratingBondingCurve.sol";
import {ProtocolFeeRouter} from "../src/fees/ProtocolFeeRouter.sol";
import {TokenGrant} from "../src/grants/TokenGrant.sol";
import {TokenGrantFactory} from "../src/grants/TokenGrantFactory.sol";
import {AssetPolicy} from "../src/policy/AssetPolicy.sol";
import {BoardroomRewards} from "../src/rewards/BoardroomRewards.sol";
import {BoardroomRewardsFactory} from "../src/rewards/BoardroomRewardsFactory.sol";
import {BoardroomAuthorityFacet} from "../src/boardroom/diamond/BoardroomAuthorityFacet.sol";
import {IBoardroom} from "../src/boardroom/IBoardroom.sol";
import {BoardroomExecutionFacet} from "../src/boardroom/diamond/BoardroomExecutionFacet.sol";
import {BoardroomFacetTypes} from "../src/boardroom/diamond/BoardroomFacetTypes.sol";
import {BoardroomKernel} from "../src/boardroom/diamond/BoardroomKernel.sol";
import {BoardroomMarketFacet} from "../src/boardroom/diamond/BoardroomMarketFacet.sol";
import {BoardroomRedemptionFacet} from "../src/boardroom/diamond/BoardroomRedemptionFacet.sol";
import {BoardroomReleaseBMigrationFacet} from "../src/boardroom/diamond/BoardroomReleaseBMigrationFacet.sol";
import {BoardroomToken} from "../src/boardroom/BoardroomToken.sol";
import {BoardroomController} from "../src/boardroom/BoardroomController.sol";
import {BoardroomControllerFactory} from "../src/boardroom/BoardroomControllerFactory.sol";
import {BoardroomFactory} from "../src/boardroom/BoardroomFactory.sol";
import {BoardroomRelease} from "../src/boardroom/diamond/BoardroomRelease.sol";
import {BoardroomViewFacet} from "../src/boardroom/diamond/BoardroomViewFacet.sol";
import {BoardroomViewFacetV2} from "../src/boardroom/diamond/BoardroomViewFacetV2.sol";
import {ProtocolFacetRegistry} from "../src/boardroom/diamond/ProtocolFacetRegistry.sol";
import {ProtocolFacetTypes} from "../src/boardroom/diamond/ProtocolFacetTypes.sol";
import {PledgeCashBoardroomScenarioSalts} from "../src/deployment/PledgeCashBoardroomScenarioSalts.sol";
import {PledgeV4LiquidityFactory} from "../src/uniswap/PledgeV4LiquidityFactory.sol";
import {V4PoolManagerMock} from "../test/helpers/V4PoolManagerMock.sol";

/// @notice Local release-A to release-B protocol scenario.
/// @dev It never writes chain deployment artifacts and has no broadcast command.
contract BoardroomScenario is Script {
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
    WETH internal wrappedNative;
    BoardroomPolicyRegistry internal policyRegistry;
    ProtocolFacetRegistry internal registry;
    BoardroomKernel internal kernel;
    BoardroomFactory internal factory;
    IBoardroom internal boardroom;
    BoardroomToken internal shares;
    IBoardroom internal curveBoardroom;
    BoardroomToken internal curveShares;
    IBoardroom internal graduatedCurveBoardroom;
    BoardroomToken internal graduatedCurveShares;
    AssetPolicy internal assetPolicy;
    ProtocolFeeRouter internal protocolFeeRouter;
    V4PoolManagerMock internal poolManager;
    TokenGrantFactory internal tokenGrantFactory;
    PledgeV4LiquidityFactory internal liquidityFactory;
    DistributionFactory internal distributionFactory;
    BoardroomRewardsFactory internal rewardsFactory;
    BondMarketFactory internal bondMarketFactory;
    BoardroomRewards internal rewards;
    FixedPriceSale internal fixedSale;
    DutchAuctionSale internal dutchAuction;
    MerkleAirdrop internal merkleAirdrop;
    TokenGrant internal directGrant;
    TokenGrant internal airdropGrant;
    MigratingBondingCurve internal migratingCurve;
    MigratingBondingCurve internal graduatedCurve;
    BondMarket internal bondMarket;
    BoardroomController internal controller;
    address internal liquidityVault;
    bytes32 internal liquidityPoolId;
    address internal graduatedCurveVault;
    bytes32 internal graduatedCurvePoolId;
    BoardroomRelease.Facets internal facets;
    bytes32 internal releaseAHash;
    bytes32 internal releaseBHash;
    uint256 internal governanceEta;
    uint256 internal bondPositionId;

    function run() external {
        uint256 deployerKey = vm.envOr("PLEDGE_CASH_BOARDROOM_DEPLOYER_KEY", DEFAULT_DEPLOYER_KEY);
        uint256 holderKey = vm.envOr("PLEDGE_CASH_BOARDROOM_HOLDER_KEY", DEFAULT_HOLDER_KEY);
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
        console2.log("Boardroom registry", address(registry));
        console2.log("Boardroom factory", address(factory));
        console2.log("Boardroom", address(boardroom));
        console2.logBytes32(releaseAHash);
        console2.logBytes32(releaseBHash);
    }

    function _deployRoots(address bootstrapAuthority) internal {
        wrappedNative = new WETH{salt: PledgeCashBoardroomScenarioSalts.WRAPPED_NATIVE}();
        policyRegistry =
            new BoardroomPolicyRegistry{salt: PledgeCashBoardroomScenarioSalts.POLICY_REGISTRY}(bootstrapAuthority);
        registry = new ProtocolFacetRegistry{salt: PledgeCashBoardroomScenarioSalts.FACET_REGISTRY}(
            bootstrapAuthority, _reservedKernelSelectors()
        );
        kernel = new BoardroomKernel{salt: PledgeCashBoardroomScenarioSalts.KERNEL}(address(registry));
        BoardroomGovernanceLogic governanceLogic =
            new BoardroomGovernanceLogic{salt: PledgeCashBoardroomScenarioSalts.GOVERNANCE_LOGIC}();
        BoardroomMarketLogic marketLogic =
            new BoardroomMarketLogic{salt: PledgeCashBoardroomScenarioSalts.MARKET_LOGIC}();
        BoardroomRedemptionPayout redemptionLogic =
            new BoardroomRedemptionPayout{salt: PledgeCashBoardroomScenarioSalts.REDEMPTION_LOGIC}();
        factory = new BoardroomFactory{salt: PledgeCashBoardroomScenarioSalts.FACTORY}(
            address(registry),
            address(policyRegistry),
            address(wrappedNative),
            address(kernel),
            address(redemptionLogic),
            address(governanceLogic),
            address(marketLogic)
        );

        address controllerFactory = factory.controllerFactory();
        facets.authority = address(
            new BoardroomAuthorityFacet{salt: PledgeCashBoardroomScenarioSalts.AUTHORITY_FACET}(
                address(redemptionLogic), address(governanceLogic), controllerFactory, address(marketLogic)
            )
        );
        facets.execution = address(
            new BoardroomExecutionFacet{salt: PledgeCashBoardroomScenarioSalts.EXECUTION_FACET}(
                address(redemptionLogic), address(governanceLogic), controllerFactory, address(marketLogic)
            )
        );
        facets.market = address(
            new BoardroomMarketFacet{salt: PledgeCashBoardroomScenarioSalts.MARKET_FACET}(
                address(redemptionLogic), address(governanceLogic), controllerFactory, address(marketLogic)
            )
        );
        facets.redemption = address(
            new BoardroomRedemptionFacet{salt: PledgeCashBoardroomScenarioSalts.REDEMPTION_FACET}(
                address(redemptionLogic), address(governanceLogic), controllerFactory, address(marketLogic)
            )
        );
        facets.viewFacet = address(
            new BoardroomViewFacet{salt: PledgeCashBoardroomScenarioSalts.VIEW_FACET}(
                address(redemptionLogic), address(governanceLogic), controllerFactory, address(marketLogic)
            )
        );
        facets.migration =
            address(new BoardroomReleaseBMigrationFacet{salt: PledgeCashBoardroomScenarioSalts.RELEASE_B_MIGRATION}());
        facets.viewV2 = address(new BoardroomViewFacetV2{salt: PledgeCashBoardroomScenarioSalts.RELEASE_B_VIEW}());

        assetPolicy = new AssetPolicy{salt: PledgeCashBoardroomScenarioSalts.ASSET_POLICY}(
            bootstrapAuthority, address(wrappedNative)
        );
        protocolFeeRouter = new ProtocolFeeRouter{salt: PledgeCashBoardroomScenarioSalts.PROTOCOL_FEE_ROUTER}(
            bootstrapAuthority, protocolTreasury
        );
        tokenGrantFactory = new TokenGrantFactory{salt: PledgeCashBoardroomScenarioSalts.TOKEN_GRANT_FACTORY}(
            bootstrapAuthority, address(factory)
        );
        poolManager = new V4PoolManagerMock{salt: PledgeCashBoardroomScenarioSalts.V4_POOL_MANAGER}();
        liquidityFactory = new PledgeV4LiquidityFactory{salt: PledgeCashBoardroomScenarioSalts.V4_LIQUIDITY_FACTORY}(
            IPoolManager(address(poolManager)), address(factory), address(protocolFeeRouter), bootstrapAuthority
        );
        liquidityFactory.deployHook(_mineHookSalt(liquidityFactory));
        distributionFactory = new DistributionFactory{salt: PledgeCashBoardroomScenarioSalts.DISTRIBUTION_FACTORY}(
            address(liquidityFactory), address(tokenGrantFactory)
        );
        rewardsFactory =
            new BoardroomRewardsFactory{salt: PledgeCashBoardroomScenarioSalts.REWARDS_FACTORY}(address(factory));
        bondMarketFactory = new BondMarketFactory{salt: PledgeCashBoardroomScenarioSalts.BOND_MARKET_FACTORY}(
            address(liquidityFactory), address(factory)
        );

        tokenGrantFactory.setFeeRecipient(address(protocolFeeRouter));
        assetPolicy.setApprovalSpenderAllowed(address(tokenGrantFactory), true);
        assetPolicy.setApprovalSpenderAllowed(address(distributionFactory), true);
        assetPolicy.setApprovalSpenderAllowed(address(rewardsFactory), true);
        assetPolicy.setApprovalSpenderAllowed(address(bondMarketFactory), true);
        assetPolicy.setApprovalSpenderAllowed(address(liquidityFactory), true);
        policyRegistry.setPolicyAllowed(address(assetPolicy), true);
        policyRegistry.registerModulePolicy(address(tokenGrantFactory));
        policyRegistry.registerModulePolicy(address(distributionFactory));
        policyRegistry.registerModulePolicy(address(rewardsFactory));
        policyRegistry.registerModulePolicy(address(bondMarketFactory));
        policyRegistry.registerModulePolicy(address(liquidityFactory));
    }

    function _loadAuthorityConfiguration(address bootstrapAuthority) internal {
        protocolGovernance = vm.envOr("PLEDGE_CASH_PROTOCOL_GOVERNANCE", bootstrapAuthority);
        protocolTreasury = vm.envOr("PLEDGE_CASH_PROTOCOL_TREASURY", bootstrapAuthority);
        require(protocolGovernance != address(0), "protocol-governance");
        require(protocolTreasury != address(0), "protocol-treasury");
    }

    function _handoffRootOwnership(address bootstrapAuthority) internal {
        if (protocolGovernance == bootstrapAuthority) return;
        registry.transferOwnership(protocolGovernance);
        policyRegistry.transferOwnership(protocolGovernance);
        assetPolicy.transferOwnership(protocolGovernance);
        protocolFeeRouter.transferOwnership(protocolGovernance);
        tokenGrantFactory.transferOwnership(protocolGovernance);
    }

    function _publishReleaseAAndCreate(address bootstrapAuthority) internal {
        BoardroomRelease.Facets memory releaseFacets = facets;
        ProtocolFacetTypes.FacetSetManifest memory releaseA = BoardroomRelease.releaseA(releaseFacets);
        releaseAHash = registry.publishFacetSet(releaseA);
        registry.activateFacetSet(releaseAHash);

        boardroom = IBoardroom(
            factory.createBoardroom(
                releaseAHash, bootstrapAuthority, "Local Diamond Boardroom", "LDBR", bytes32("local")
            )
        );
        shares = BoardroomToken(boardroom.shareToken());
    }

    function _preparePrelaunch(address bootstrapAuthority) internal {
        boardroom.mint(releaseAHash, holder, 200 ether);
        boardroom.mint(releaseAHash, address(boardroom), 600 ether);
        assetPolicy.setAssetAllowed(address(shares), true);
        vm.deal(bootstrapAuthority, 200 ether);
        wrappedNative.deposit{value: 200 ether}();
        require(wrappedNative.transfer(address(boardroom), 100 ether), "weth-transfer");
        require(wrappedNative.transfer(holder, 100 ether), "holder-weth-transfer");

        BoardroomFacetTypes.Call memory createRewards = BoardroomFacetTypes.Call({
            policy: address(rewardsFactory),
            target: address(rewardsFactory),
            value: 0,
            data: abi.encodeCall(
                BoardroomRewardsFactory.createRewards, (uint64(1 days), keccak256("protocol-local-rewards"))
            )
        });
        rewards = BoardroomRewards(abi.decode(boardroom.execute(releaseAHash, createRewards), (address)));
        _fundRewards();
        _createFixedSale();
        _createDutchAuction();
        _createMerkleAirdropAndGrant();
        _createDirectTreasuryGrant();
        _createBondMarket();
        _createProtocolLiquidity();
        _createAuxiliaryCurve(bootstrapAuthority);
        _createGraduatingCurve(bootstrapAuthority);
        require(boardroom.activeObligationCount() == 8, "real-obligations-not-recorded");
        require(curveBoardroom.activeObligationCount() == 1, "curve-obligation-not-recorded");
        require(graduatedCurveBoardroom.activeObligationCount() == 1, "graduated-curve-obligation-not-recorded");
        require(boardroom.rewardPool() == address(rewards), "reward-pool-not-recorded");
        require(boardroom.liquidityVault() == liquidityVault, "liquidity-not-recorded");
    }

    function _fundRewards() internal {
        BoardroomFacetTypes.Call[] memory calls = new BoardroomFacetTypes.Call[](2);
        calls[0] = _approvalCall(address(wrappedNative), address(rewardsFactory), 10 ether);
        calls[1] = BoardroomFacetTypes.Call({
            policy: address(rewardsFactory),
            target: address(rewardsFactory),
            value: 0,
            data: abi.encodeCall(
                BoardroomRewardsFactory.fundReward, (address(rewards), address(wrappedNative), 10 ether, 7 days)
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
            salt: keccak256("protocol-local-fixed-sale")
        });
        BoardroomFacetTypes.Call[] memory calls = new BoardroomFacetTypes.Call[](2);
        calls[0] = _approvalCall(address(shares), address(distributionFactory), params.shareAmount);
        calls[1] = BoardroomFacetTypes.Call({
            policy: address(distributionFactory),
            target: address(distributionFactory),
            value: 0,
            data: abi.encodeCall(DistributionFactory.createFixedPriceSale, (params))
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
            salt: keccak256("protocol-local-dutch-auction")
        });
        BoardroomFacetTypes.Call[] memory calls = new BoardroomFacetTypes.Call[](2);
        calls[0] = _approvalCall(address(shares), address(distributionFactory), params.shareAmount);
        calls[1] = BoardroomFacetTypes.Call({
            policy: address(distributionFactory),
            target: address(distributionFactory),
            value: 0,
            data: abi.encodeCall(DistributionFactory.createDutchAuction, (params))
        });
        bytes[] memory results = boardroom.executeBatch(releaseAHash, calls);
        dutchAuction = DutchAuctionSale(abi.decode(results[1], (address)));
        require(
            address(dutchAuction) == distributionFactory.predictDutchAuctionAddress(address(boardroom), params.salt),
            "dutch-auction-prediction"
        );
    }

    function _createMerkleAirdropAndGrant() internal {
        bytes32 airdropSalt = keccak256("protocol-local-merkle-airdrop");
        address predictedAirdrop = distributionFactory.predictMerkleAirdropAddress(address(boardroom), airdropSalt);
        MerkleAirdrop.GrantClaimParams memory grantParams = MerkleAirdrop.GrantClaimParams({
            paymentToken: address(0),
            price: 0,
            expiry: block.timestamp + 60 days,
            vestingCliff: block.timestamp + 30 days,
            vestingEnd: block.timestamp + 45 days,
            transferable: false,
            transferUnlockTime: 0,
            salt: keccak256("protocol-local-airdrop-grant")
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
        MerkleAirdrop.CreateParams memory params = MerkleAirdrop.CreateParams({
            shareToken: address(shares),
            shareAmount: 20 ether,
            merkleRoot: root,
            startTime: uint64(block.timestamp),
            endTime: uint64(block.timestamp + 30 days),
            maxGrantClaims: 1,
            salt: airdropSalt
        });
        BoardroomFacetTypes.Call[] memory calls = new BoardroomFacetTypes.Call[](2);
        calls[0] = _approvalCall(address(shares), address(distributionFactory), params.shareAmount);
        calls[1] = BoardroomFacetTypes.Call({
            policy: address(distributionFactory),
            target: address(distributionFactory),
            value: 0,
            data: abi.encodeCall(DistributionFactory.createMerkleAirdrop, (params))
        });
        bytes[] memory results = boardroom.executeBatch(releaseAHash, calls);
        merkleAirdrop = MerkleAirdrop(abi.decode(results[1], (address)));
        require(address(merkleAirdrop) == predictedAirdrop, "merkle-airdrop-prediction");

        bytes32[] memory grantProof = new bytes32[](1);
        grantProof[0] = directLeaf;
        airdropGrant = TokenGrant(merkleAirdrop.claimGrant(releaseAHash, 0, holder, 10 ether, grantParams, grantProof));
        bytes32[] memory directProof = new bytes32[](1);
        directProof[0] = grantLeaf;
        merkleAirdrop.claim(releaseAHash, 1, holder, 5 ether, directProof);
        require(boardroom.isIssuedGrant(address(airdropGrant)), "airdrop-grant-not-recorded");
    }

    function _createDirectTreasuryGrant() internal {
        BoardroomFacetTypes.Call[] memory calls = new BoardroomFacetTypes.Call[](2);
        calls[0] = _approvalCall(address(wrappedNative), address(tokenGrantFactory), 5 ether);
        calls[1] = BoardroomFacetTypes.Call({
            policy: address(tokenGrantFactory),
            target: address(tokenGrantFactory),
            value: 0,
            data: abi.encodeCall(
                TokenGrantFactory.createGrant,
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
                    keccak256("protocol-local-direct-grant")
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
            salt: keccak256("protocol-local-reserve-bond")
        });
        BoardroomFacetTypes.Call[] memory calls = new BoardroomFacetTypes.Call[](2);
        calls[0] = _approvalCall(address(shares), address(bondMarketFactory), params.capacity);
        calls[1] = BoardroomFacetTypes.Call({
            policy: address(bondMarketFactory),
            target: address(bondMarketFactory),
            value: 0,
            data: abi.encodeCall(BondMarketFactory.createBondMarket, (params))
        });
        bytes[] memory results = boardroom.executeBatch(releaseAHash, calls);
        bondMarket = BondMarket(abi.decode(results[1], (address)));
        require(
            address(bondMarket) == bondMarketFactory.predictBondMarketAddress(address(boardroom), params.salt),
            "bond-market-prediction"
        );
    }

    function _createProtocolLiquidity() internal {
        PledgeV4LiquidityFactory.CreateParams memory params = PledgeV4LiquidityFactory.CreateParams({
            tokenA: address(shares),
            tokenB: address(wrappedNative),
            amountADesired: 100 ether,
            amountBDesired: 20 ether,
            amountAMin: 95 ether,
            amountBMin: 19 ether,
            sqrtPriceX96: _sqrtPriceX96(address(shares), address(wrappedNative), 100 ether, 20 ether),
            deadline: block.timestamp + 1 hours,
            salt: keccak256("protocol-local-locked-liquidity")
        });
        BoardroomFacetTypes.Call[] memory calls = new BoardroomFacetTypes.Call[](3);
        calls[0] = _approvalCall(address(shares), address(liquidityFactory), params.amountADesired);
        calls[1] = _approvalCall(address(wrappedNative), address(liquidityFactory), params.amountBDesired);
        calls[2] = BoardroomFacetTypes.Call({
            policy: address(liquidityFactory),
            target: address(liquidityFactory),
            value: 0,
            data: abi.encodeCall(PledgeV4LiquidityFactory.createProtocolLiquidity, (params))
        });
        bytes[] memory results = boardroom.executeBatch(releaseAHash, calls);
        (liquidityVault, liquidityPoolId,,,) = abi.decode(results[2], (address, bytes32, uint256, uint256, uint256));
        require(
            liquidityVault == liquidityFactory.predictLiquidityVaultAddress(address(boardroom), params.salt),
            "liquidity-vault-prediction"
        );
        require(
            liquidityPoolId == liquidityFactory.poolIdFor(address(shares), address(wrappedNative)), "liquidity-pool"
        );
    }

    function _createAuxiliaryCurve(address bootstrapAuthority) internal {
        curveBoardroom = IBoardroom(
            factory.createBoardroom(
                releaseAHash, bootstrapAuthority, "Local Migrating Curve Boardroom", "LCURVE", bytes32("local-curve")
            )
        );
        curveShares = BoardroomToken(curveBoardroom.shareToken());
        assetPolicy.setAssetAllowed(address(curveShares), true);

        uint256 saleSupply = 3_600 ether;
        uint256 migrationSupply = 1_400 ether;
        curveBoardroom.mint(releaseAHash, address(curveBoardroom), saleSupply + migrationSupply);
        MigratingBondingCurve.CreateParams memory params = MigratingBondingCurve.CreateParams({
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
            migrationSalt: keccak256("protocol-local-curve-migration"),
            salt: keccak256("protocol-local-curve")
        });
        BoardroomFacetTypes.Call[] memory calls = new BoardroomFacetTypes.Call[](2);
        calls[0] = BoardroomFacetTypes.Call({
            policy: address(assetPolicy),
            target: address(curveShares),
            value: 0,
            data: abi.encodeWithSignature(
                "approve(address,uint256)", address(distributionFactory), saleSupply + migrationSupply
            )
        });
        calls[1] = BoardroomFacetTypes.Call({
            policy: address(distributionFactory),
            target: address(distributionFactory),
            value: 0,
            data: abi.encodeCall(DistributionFactory.createMigratingBondingCurve, (params))
        });
        bytes[] memory results = curveBoardroom.executeBatch(releaseAHash, calls);
        migratingCurve = MigratingBondingCurve(abi.decode(results[1], (address)));
        require(
            address(migratingCurve)
                == distributionFactory.predictMigratingBondingCurveAddress(address(curveBoardroom), params.salt),
            "migrating-curve-prediction"
        );
    }

    function _createGraduatingCurve(address bootstrapAuthority) internal {
        graduatedCurveBoardroom = IBoardroom(
            factory.createBoardroom(
                releaseAHash,
                bootstrapAuthority,
                "Local Graduating Curve Boardroom",
                "LGRAD",
                bytes32("local-graduated-curve")
            )
        );
        graduatedCurveShares = BoardroomToken(graduatedCurveBoardroom.shareToken());
        assetPolicy.setAssetAllowed(address(graduatedCurveShares), true);

        uint256 saleSupply = 10 ether;
        uint256 migrationSupply = 10 ether;
        graduatedCurveBoardroom.mint(releaseAHash, address(graduatedCurveBoardroom), saleSupply + migrationSupply);
        MigratingBondingCurve.CreateParams memory params = MigratingBondingCurve.CreateParams({
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
            migrationSalt: keccak256("protocol-local-graduated-curve-migration"),
            salt: keccak256("protocol-local-graduated-curve")
        });
        BoardroomFacetTypes.Call[] memory calls = new BoardroomFacetTypes.Call[](2);
        calls[0] = BoardroomFacetTypes.Call({
            policy: address(assetPolicy),
            target: address(graduatedCurveShares),
            value: 0,
            data: abi.encodeWithSignature(
                "approve(address,uint256)", address(distributionFactory), saleSupply + migrationSupply
            )
        });
        calls[1] = BoardroomFacetTypes.Call({
            policy: address(distributionFactory),
            target: address(distributionFactory),
            value: 0,
            data: abi.encodeCall(DistributionFactory.createMigratingBondingCurve, (params))
        });
        bytes[] memory results = graduatedCurveBoardroom.executeBatch(releaseAHash, calls);
        graduatedCurve = MigratingBondingCurve(abi.decode(results[1], (address)));
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
            BoardroomFacetTypes.Call({
                policy: address(distributionFactory),
                target: address(migratingCurve),
                value: 0,
                data: abi.encodeCall(MigratingBondingCurve.cancel, ())
            })
        );
    }

    function _startGraduatedCurveWindDown() internal {
        require(
            graduatedCurve.curveStatus() == MigratingBondingCurve.CurvePhase.Migrated, "graduated-curve-not-migrated"
        );
        graduatedCurveBoardroom.startWindDown(releaseAHash);
        require(
            uint8(graduatedCurveBoardroom.status()) == uint8(BoardroomFacetTypes.BoardroomStatus.WindingDown),
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
        (graduatedCurveVault, graduatedCurvePoolId, migratedShares, migratedQuote, migratedLiquidity) =
            graduatedCurve.migrate(
                graduatedCurveBoardroom.facetSetHash(), 5 ether, 5 ether, 1 << 96, block.timestamp + 1 hours
            );
        require(migratedShares == 5 ether && migratedQuote == 5 ether, "graduated-migration-amounts");
        require(migratedLiquidity != 0, "graduated-migration-liquidity");
        require(graduatedCurveBoardroom.liquidityVault() == graduatedCurveVault, "graduated-liquidity-not-activated");
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
        returns (BoardroomFacetTypes.Call memory)
    {
        return BoardroomFacetTypes.Call({
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
        BoardroomControllerFactory controllerFactory = BoardroomControllerFactory(boardroom.controllerFactory());
        address predictedController = controllerFactory.predictControllerAddress(address(boardroom), 1);
        boardroom.launch(
            releaseAHash,
            BoardroomFacetTypes.LaunchConfig({
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
        controller = BoardroomController(predictedController);
    }

    function _scheduleGovernance(address bootstrapAuthority) internal {
        BoardroomCall[] memory calls = new BoardroomCall[](1);
        calls[0] = BoardroomCall({
            policy: address(0),
            target: address(boardroom),
            value: 0,
            data: abi.encodeCall(IBoardroom.setRedemptionExcessRecipient, (releaseAHash, holder))
        });
        (, governanceEta) = controller.scheduleBoardroomOperation(
            releaseAHash,
            calls,
            keccak256("protocol-local-governance"),
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
            data: abi.encodeCall(IBoardroom.setRedemptionExcessRecipient, (releaseAHash, holder))
        });
        controller.executeBoardroomOperation(
            releaseAHash,
            calls,
            keccak256("protocol-local-governance"),
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
            BoardroomFacetTypes.Call({
                policy: address(rewardsFactory),
                target: address(rewards),
                value: 0,
                data: abi.encodeCall(BoardroomRewards.terminalize, ())
            })
        );
        boardroom.executeWindDownCall(
            releaseAHash,
            BoardroomFacetTypes.Call({
                policy: address(distributionFactory),
                target: address(fixedSale),
                value: 0,
                data: abi.encodeCall(FixedPriceSale.close, ())
            })
        );
        boardroom.executeWindDownCall(
            releaseAHash,
            BoardroomFacetTypes.Call({
                policy: address(distributionFactory),
                target: address(dutchAuction),
                value: 0,
                data: abi.encodeCall(DutchAuctionSale.close, ())
            })
        );
        boardroom.executeWindDownCall(
            releaseAHash,
            BoardroomFacetTypes.Call({
                policy: address(tokenGrantFactory),
                target: address(directGrant),
                value: 0,
                data: abi.encodeCall(TokenGrant.stopVestingAndWithdrawUnvested, ())
            })
        );
        boardroom.executeWindDownCall(
            releaseAHash,
            BoardroomFacetTypes.Call({
                policy: address(tokenGrantFactory),
                target: address(airdropGrant),
                value: 0,
                data: abi.encodeCall(TokenGrant.stopVestingAndWithdrawUnvested, ())
            })
        );
        boardroom.executeWindDownCall(
            releaseAHash,
            BoardroomFacetTypes.Call({
                policy: address(distributionFactory),
                target: address(merkleAirdrop),
                value: 0,
                data: abi.encodeCall(MerkleAirdrop.close, ())
            })
        );
        require(boardroom.activeObligationCount() == 2, "first-terminal-obligations");
    }

    function _activateReleaseB(bool proveMigrationGate) internal {
        BoardroomRelease.Facets memory releaseFacets = facets;
        ProtocolFacetTypes.FacetSetManifest memory releaseB = BoardroomRelease.releaseB(releaseFacets, releaseAHash);
        releaseBHash = registry.publishFacetSet(releaseB);
        registry.activateFacetSet(releaseBHash);
        require(boardroom.facetSetHash() == releaseBHash, "release-b-not-routed");
        require(boardroom.appliedStorageVersion() == 1, "premature-storage-version");
        require(boardroom.migrationRequired(), "migration-not-required");
        require(
            uint8(boardroom.status()) == uint8(BoardroomFacetTypes.BoardroomStatus.WindingDown),
            "unsafe-migration-status"
        );
        (bytes32 migrationMarker,, uint64 migratedFromVersion) = boardroom.releaseBMigrationState();
        require(migrationMarker == bytes32(0) && migratedFromVersion == 0, "unsafe-pre-migration-release-b-view");

        if (proveMigrationGate) {
            (bool writeSucceeded, bytes memory revertData) =
                address(boardroom).call(abi.encodeCall(IBoardroom.returnProtocolLiquidityClaims, (releaseBHash)));
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
            BoardroomFacetTypes.Call({
                policy: address(bondMarketFactory),
                target: address(bondMarket),
                value: 0,
                data: abi.encodeCall(BondMarket.close, ())
            })
        );
        require(boardroom.returnProtocolLiquidityClaims(releaseBHash) != 0, "claims-not-returned");
        boardroom.closeProtocolLiquidityAfterWindDown(releaseBHash);
        require(boardroom.activeObligationCount() == 0, "resumed-terminal-obligations");
    }

    function _finalizeAuxiliaryCurve() internal {
        curveBoardroom.migrateBoardroom(releaseBHash);
        migratingCurve.finalizeUnwind(curveBoardroom.facetSetHash());
        require(curveBoardroom.activeObligationCount() == 0, "curve-terminal-obligation");
        require(!curveBoardroom.migrationRequired(), "curve-migration");
    }

    function _finalizeGraduatedCurveLiquidity() internal {
        graduatedCurveBoardroom.migrateBoardroom(releaseBHash);
        require(
            graduatedCurveBoardroom.returnProtocolLiquidityClaims(releaseBHash) != 0, "graduated-claims-not-returned"
        );
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
        require(protocolFeeRouter.feeRecipient() == protocolTreasury, "fee-router-recipient");
        require(tokenGrantFactory.feeRecipient() == address(protocolFeeRouter), "grant-fee-recipient");
        require(tokenGrantFactory.creationFee() == 0, "grant-creation-fee");
        require(address(liquidityFactory.poolManager()) == address(poolManager), "v4-pool-manager");
        require(liquidityFactory.protocolFeeRecipient() == address(protocolFeeRouter), "v4-fee-recipient");
        require(liquidityFactory.boardroomFactory() == address(factory), "v4-boardroom-factory");
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
        require(factory.controllerFactory().code.length != 0, "factory-controller-code");
        require(factory.governanceLogic().code.length != 0, "factory-governance-code");
        require(factory.marketLogic().code.length != 0, "factory-market-code");
        require(factory.redemptionPayoutLogic().code.length != 0, "factory-redemption-code");
        require(boardroom.controllerFactory() == factory.controllerFactory(), "boardroom-controller-binding");
        require(boardroom.governanceLogic() == factory.governanceLogic(), "boardroom-governance-binding");
        require(boardroom.marketLogic() == factory.marketLogic(), "boardroom-market-binding");
        require(boardroom.redemptionPayoutLogic() == factory.redemptionPayoutLogic(), "boardroom-redemption-binding");
        require(
            BoardroomControllerFactory(factory.controllerFactory()).boardroomFactory() == address(factory),
            "controller-factory-binding"
        );
        require(boardroom.appliedStorageVersion() == 2, "boardroom-storage-version");
        require(!boardroom.migrationRequired(), "boardroom-migration");
        require(curveBoardroom.appliedStorageVersion() == 2, "curve-boardroom-storage-version");
        require(graduatedCurveBoardroom.appliedStorageVersion() == 2, "graduated-boardroom-storage-version");
        require(graduatedCurveBoardroom.activeObligationCount() == 0, "graduated-boardroom-obligations");
    }

    function _mineHookSalt(PledgeV4LiquidityFactory factory_) internal view returns (bytes32 salt) {
        for (uint256 candidate; candidate < 100_000; ++candidate) {
            salt = bytes32(candidate);
            if (uint160(factory_.predictHookAddress(salt)) & ((1 << 14) - 1) == (1 << 13)) return salt;
        }
        revert("hook salt");
    }

    function _sqrtPriceX96(address tokenA, address tokenB, uint256 amountA, uint256 amountB)
        internal
        pure
        returns (uint160 result)
    {
        (uint256 amount0, uint256 amount1) = tokenA < tokenB ? (amountA, amountB) : (amountB, amountA);
        uint256 ratioX192 = FullMath.mulDiv(amount1, uint256(1) << 192, amount0);
        uint256 sqrtRatioX96 = FixedPointMathLib.sqrt(ratioX192);
        require(sqrtRatioX96 <= type(uint160).max, "sqrt-price-overflow");
        result = uint160(sqrtRatioX96);
    }

    function _revertSelector(bytes memory revertData) internal pure returns (bytes4 selector) {
        if (revertData.length < 4) return bytes4(0);
        assembly ("memory-safe") {
            selector := mload(add(revertData, 0x20))
        }
    }

    function _reservedKernelSelectors() internal pure returns (bytes4[] memory reserved) {
        reserved = new bytes4[](8);
        reserved[0] = bytes4(keccak256("facetRegistry()"));
        reserved[1] = bytes4(keccak256("facetSetHash()"));
        reserved[2] = BoardroomKernel.initialize.selector;
        reserved[3] = BoardroomKernel.appliedStorageVersion.selector;
        reserved[4] = BoardroomKernel.migrationRequired.selector;
        reserved[5] = bytes4(keccak256("viewDispatcher()"));
        reserved[6] = BoardroomKernel.appliedStorageLayoutHash.selector;
        reserved[7] = BoardroomKernel.kernelSelectorSetHash.selector;
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
