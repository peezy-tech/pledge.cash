// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.30;

import {console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {WETH} from "solady/tokens/WETH.sol";
import {AmmFactory} from "../src/amm/AmmFactory.sol";
import {AmmRouter} from "../src/amm/AmmRouter.sol";
import {BondMarket} from "../src/bonds/BondMarket.sol";
import {BondMarketFactoryVNext} from "../src/bonds/BondMarketFactoryVNext.sol";
import {BoardroomPolicyRegistry} from "../src/boardroom/BoardroomPolicyRegistry.sol";
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
import {IBoardroomDiamond} from "../src/boardroom/diamond/BoardroomDiamond.sol";
import {BoardroomKernel} from "../src/boardroom/diamond/BoardroomKernel.sol";
import {BoardroomTokenVNext} from "../src/boardroom/diamond/BoardroomTokenVNext.sol";
import {BoardroomVNextController} from "../src/boardroom/diamond/BoardroomVNextController.sol";
import {BoardroomVNextFactory} from "../src/boardroom/diamond/BoardroomVNextFactory.sol";
import {BoardroomVNextRelease} from "../src/boardroom/diamond/BoardroomVNextRelease.sol";
import {ProtocolFacetRegistry} from "../src/boardroom/diamond/ProtocolFacetRegistry.sol";
import {BoardroomDiamondVNextScenario} from "./BoardroomDiamondVNextScenario.s.sol";

/// @notice Four-phase broadcast harness for a real Anvil vNext lifecycle.
/// @dev Run the phases through run-boardroom-diamond-vnext-local.sh so Anvil time
/// advances happen outside Forge's simulation and are reflected onchain.
contract BoardroomDiamondVNextLocal is BoardroomDiamondVNextScenario {
    using stdJson for string;

    uint256 internal constant DEFAULT_ANVIL_DEPLOYER_KEY =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 internal constant DEFAULT_ANVIL_HOLDER_KEY =
        0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;

    error WrongChain(uint256 expected, uint256 actual);
    error WrongCheckpointAuthority(address expected, address actual);

    function runDeploy() external {
        uint256 deployerKey = _deployerKey();
        uint256 holderKey = _holderKey();
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

        _writeCheckpoint("prelaunch-staked");
        console2.log("vNext local prelaunch checkpoint", _checkpointPath());
        console2.log("vNext boardroom", address(boardroom));
    }

    function runLaunch() external {
        _loadCheckpoint();
        uint256 deployerKey = _deployerKey();
        address bootstrapAuthority = vm.addr(deployerKey);
        vm.startBroadcast(deployerKey);
        _launch(bootstrapAuthority);
        _scheduleGovernance(bootstrapAuthority);
        vm.stopBroadcast();

        _writeCheckpoint("governance-scheduled");
        console2.log("governance ETA", governanceEta);
    }

    function runWindDown() external {
        _loadCheckpoint();
        uint256 deployerKey = _deployerKey();
        uint256 holderKey = _holderKey();
        address bootstrapAuthority = vm.addr(deployerKey);
        if (controller.proposer() != bootstrapAuthority) {
            revert WrongCheckpointAuthority(bootstrapAuthority, controller.proposer());
        }

        vm.startBroadcast(deployerKey);
        _executeGovernance(bootstrapAuthority);
        vm.stopBroadcast();

        vm.startBroadcast(holderKey);
        _startWindDownAndCloseFirstObligations();
        vm.stopBroadcast();

        vm.startBroadcast(deployerKey);
        _activateReleaseB(false);
        vm.stopBroadcast();

        _writeCheckpoint("release-b-migration-required");
        console2.log("vNext release B active; migration required", address(boardroom));
        console2.logBytes32(releaseBHash);
    }

    function runRedeem() external {
        _loadCheckpoint();
        uint256 deployerKey = _deployerKey();
        uint256 holderKey = _holderKey();

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
        _handoffRootOwnership(vm.addr(deployerKey));
        vm.stopBroadcast();

        _verifyDeployment(protocolGovernance);
        _writeCheckpoint("complete");
        console2.log("vNext local scenario complete", address(boardroom));
    }

    function _deployerKey() internal view returns (uint256) {
        return vm.envOr("PLEDGE_CASH_VNEXT_DEPLOYER_KEY", DEFAULT_ANVIL_DEPLOYER_KEY);
    }

    function _holderKey() internal view returns (uint256) {
        return vm.envOr("PLEDGE_CASH_VNEXT_HOLDER_KEY", DEFAULT_ANVIL_HOLDER_KEY);
    }

    function _checkpointPath() internal view returns (string memory) {
        return vm.envOr("PLEDGE_CASH_VNEXT_DEPLOYMENT_PATH", string("deployments/31337.diamond-vnext.local.json"));
    }

    function _writeCheckpoint(string memory phase) internal {
        string memory objectKey = "boardroomDiamondVNextLocal";
        vm.serializeUint(objectKey, "chainId", block.chainid);
        vm.serializeString(objectKey, "phase", phase);
        vm.serializeAddress(objectKey, "holder", holder);
        vm.serializeAddress(objectKey, "protocolGovernance", protocolGovernance);
        vm.serializeAddress(objectKey, "protocolTreasury", protocolTreasury);
        vm.serializeAddress(objectKey, "ammFeeManager", ammFeeManager);
        vm.serializeAddress(objectKey, "wrappedNative", address(wrappedNative));
        vm.serializeAddress(objectKey, "policyRegistry", address(policyRegistry));
        vm.serializeAddress(objectKey, "facetRegistry", address(registry));
        vm.serializeAddress(objectKey, "kernel", address(kernel));
        vm.serializeAddress(objectKey, "factory", address(factory));
        vm.serializeAddress(objectKey, "boardroom", address(boardroom));
        vm.serializeAddress(objectKey, "shareToken", address(shares));
        vm.serializeAddress(objectKey, "curveBoardroom", address(curveBoardroom));
        vm.serializeAddress(objectKey, "curveShareToken", address(curveShares));
        vm.serializeAddress(objectKey, "graduatedCurveBoardroom", address(graduatedCurveBoardroom));
        vm.serializeAddress(objectKey, "graduatedCurveShareToken", address(graduatedCurveShares));
        vm.serializeAddress(objectKey, "assetPolicy", address(assetPolicy));
        vm.serializeAddress(objectKey, "protocolFeeRouter", address(protocolFeeRouter));
        vm.serializeAddress(objectKey, "ammFactory", address(ammFactory));
        vm.serializeAddress(objectKey, "ammRouter", address(ammRouter));
        vm.serializeAddress(objectKey, "tokenGrantFactory", address(tokenGrantFactory));
        vm.serializeAddress(objectKey, "lockedLiquidityFactory", address(lockedLiquidityFactory));
        vm.serializeAddress(objectKey, "distributionFactory", address(distributionFactory));
        vm.serializeAddress(objectKey, "boardroomRewardsFactory", address(rewardsFactory));
        vm.serializeAddress(objectKey, "bondMarketFactory", address(bondMarketFactory));
        vm.serializeAddress(objectKey, "rewards", address(rewards));
        vm.serializeAddress(objectKey, "fixedPriceSale", address(fixedSale));
        vm.serializeAddress(objectKey, "dutchAuction", address(dutchAuction));
        vm.serializeAddress(objectKey, "merkleAirdrop", address(merkleAirdrop));
        vm.serializeAddress(objectKey, "directGrant", address(directGrant));
        vm.serializeAddress(objectKey, "airdropGrant", address(airdropGrant));
        vm.serializeAddress(objectKey, "migratingCurve", address(migratingCurve));
        vm.serializeAddress(objectKey, "graduatedCurve", address(graduatedCurve));
        vm.serializeAddress(objectKey, "bondMarket", address(bondMarket));
        vm.serializeAddress(objectKey, "controller", address(controller));
        vm.serializeAddress(objectKey, "liquidityLocker", liquidityLocker);
        vm.serializeAddress(objectKey, "liquidityPool", liquidityPool);
        vm.serializeAddress(objectKey, "graduatedCurveLocker", graduatedCurveLocker);
        vm.serializeAddress(objectKey, "graduatedCurvePool", graduatedCurvePool);
        vm.serializeAddress(objectKey, "authorityFacet", facets.authority);
        vm.serializeAddress(objectKey, "executionFacet", facets.execution);
        vm.serializeAddress(objectKey, "marketFacet", facets.market);
        vm.serializeAddress(objectKey, "redemptionFacet", facets.redemption);
        vm.serializeAddress(objectKey, "viewFacet", facets.viewFacet);
        vm.serializeAddress(objectKey, "migrationFacet", facets.migration);
        vm.serializeAddress(objectKey, "viewFacetV2", facets.viewV2);
        vm.serializeBytes32(objectKey, "releaseAHash", releaseAHash);
        vm.serializeBytes32(objectKey, "releaseBHash", releaseBHash);
        vm.serializeUint(objectKey, "governanceEta", governanceEta);
        string memory output = vm.serializeUint(objectKey, "bondPositionId", bondPositionId);

        vm.createDir("deployments", true);
        vm.writeJson(output, _checkpointPath());
    }

    function _loadCheckpoint() internal {
        string memory json = vm.readFile(_checkpointPath());
        uint256 checkpointChainId = json.readUint(".chainId");
        if (checkpointChainId != block.chainid) revert WrongChain(checkpointChainId, block.chainid);

        holder = json.readAddress(".holder");
        protocolGovernance = json.readAddress(".protocolGovernance");
        protocolTreasury = json.readAddress(".protocolTreasury");
        ammFeeManager = json.readAddress(".ammFeeManager");
        wrappedNative = WETH(payable(json.readAddress(".wrappedNative")));
        policyRegistry = BoardroomPolicyRegistry(json.readAddress(".policyRegistry"));
        registry = ProtocolFacetRegistry(json.readAddress(".facetRegistry"));
        kernel = BoardroomKernel(payable(json.readAddress(".kernel")));
        factory = BoardroomVNextFactory(json.readAddress(".factory"));
        boardroom = IBoardroomDiamond(json.readAddress(".boardroom"));
        shares = BoardroomTokenVNext(json.readAddress(".shareToken"));
        curveBoardroom = IBoardroomDiamond(json.readAddress(".curveBoardroom"));
        curveShares = BoardroomTokenVNext(json.readAddress(".curveShareToken"));
        graduatedCurveBoardroom = IBoardroomDiamond(json.readAddress(".graduatedCurveBoardroom"));
        graduatedCurveShares = BoardroomTokenVNext(json.readAddress(".graduatedCurveShareToken"));
        assetPolicy = AssetPolicy(json.readAddress(".assetPolicy"));
        protocolFeeRouter = ProtocolFeeRouter(payable(json.readAddress(".protocolFeeRouter")));
        ammFactory = AmmFactory(json.readAddress(".ammFactory"));
        ammRouter = AmmRouter(payable(json.readAddress(".ammRouter")));
        tokenGrantFactory = TokenGrantFactoryVNext(json.readAddress(".tokenGrantFactory"));
        lockedLiquidityFactory = LockedLiquidityFactoryVNext(json.readAddress(".lockedLiquidityFactory"));
        distributionFactory = DistributionFactoryVNext(json.readAddress(".distributionFactory"));
        rewardsFactory = BoardroomRewardsFactoryVNext(json.readAddress(".boardroomRewardsFactory"));
        bondMarketFactory = BondMarketFactoryVNext(json.readAddress(".bondMarketFactory"));
        rewards = BoardroomRewards(json.readAddress(".rewards"));
        fixedSale = FixedPriceSale(json.readAddress(".fixedPriceSale"));
        dutchAuction = DutchAuctionSale(json.readAddress(".dutchAuction"));
        merkleAirdrop = MerkleAirdropVNext(json.readAddress(".merkleAirdrop"));
        directGrant = TokenGrant(json.readAddress(".directGrant"));
        airdropGrant = TokenGrant(json.readAddress(".airdropGrant"));
        migratingCurve = MigratingBondingCurveVNext(json.readAddress(".migratingCurve"));
        graduatedCurve = MigratingBondingCurveVNext(json.readAddress(".graduatedCurve"));
        bondMarket = BondMarket(json.readAddress(".bondMarket"));
        controller = BoardroomVNextController(json.readAddress(".controller"));
        liquidityLocker = json.readAddress(".liquidityLocker");
        liquidityPool = json.readAddress(".liquidityPool");
        graduatedCurveLocker = json.readAddress(".graduatedCurveLocker");
        graduatedCurvePool = json.readAddress(".graduatedCurvePool");
        facets = BoardroomVNextRelease.Facets({
            authority: json.readAddress(".authorityFacet"),
            execution: json.readAddress(".executionFacet"),
            market: json.readAddress(".marketFacet"),
            redemption: json.readAddress(".redemptionFacet"),
            viewFacet: json.readAddress(".viewFacet"),
            migration: json.readAddress(".migrationFacet"),
            viewV2: json.readAddress(".viewFacetV2")
        });
        releaseAHash = json.readBytes32(".releaseAHash");
        releaseBHash = json.readBytes32(".releaseBHash");
        governanceEta = json.readUint(".governanceEta");
        bondPositionId = json.readUint(".bondPositionId");
    }
}
