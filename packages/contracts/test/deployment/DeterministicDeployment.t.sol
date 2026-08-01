// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "solady/auth/Ownable.sol";
import {WETH} from "solady/tokens/WETH.sol";
import {CREATE3} from "solady/utils/CREATE3.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {AssetPolicy} from "../../src/policy/AssetPolicy.sol";
import {BoardroomController} from "../../src/boardroom/BoardroomController.sol";
import {BoardroomControllerFactory} from "../../src/boardroom/BoardroomControllerFactory.sol";
import {BoardroomFactory} from "../../src/boardroom/BoardroomFactory.sol";
import {BoardroomGovernanceLogic} from "../../src/boardroom/BoardroomGovernanceLogic.sol";
import {IBoardroom} from "../../src/boardroom/IBoardroom.sol";
import {BoardroomMarketLogic} from "../../src/boardroom/BoardroomMarketLogic.sol";
import {BoardroomPolicyRegistry} from "../../src/boardroom/BoardroomPolicyRegistry.sol";
import {BoardroomRedemptionPayout} from "../../src/boardroom/BoardroomRedemptionPayout.sol";
import {BoardroomAuthorityFacet} from "../../src/boardroom/diamond/BoardroomAuthorityFacet.sol";
import {BoardroomExecutionFacet} from "../../src/boardroom/diamond/BoardroomExecutionFacet.sol";
import {BoardroomKernel} from "../../src/boardroom/diamond/BoardroomKernel.sol";
import {BoardroomKernelSelectors} from "../../src/boardroom/diamond/BoardroomKernelSelectors.sol";
import {BoardroomMarketFacet} from "../../src/boardroom/diamond/BoardroomMarketFacet.sol";
import {BoardroomRedemptionFacet} from "../../src/boardroom/diamond/BoardroomRedemptionFacet.sol";
import {BoardroomRelease} from "../../src/boardroom/diamond/BoardroomRelease.sol";
import {BoardroomViewFacet} from "../../src/boardroom/diamond/BoardroomViewFacet.sol";
import {ProtocolFacetRegistry} from "../../src/boardroom/diamond/ProtocolFacetRegistry.sol";
import {ProtocolFacetTypes} from "../../src/boardroom/diamond/ProtocolFacetTypes.sol";
import {BondMarketFactory} from "../../src/bonds/BondMarketFactory.sol";
import {DistributionFactory} from "../../src/distribution/DistributionFactory.sol";
import {PledgeCashDeploymentSalts} from "../../src/deployment/PledgeCashDeploymentSalts.sol";
import {PledgeCashDeterministicDeployer} from "../../src/deployment/PledgeCashDeterministicDeployer.sol";
import {ProtocolFeeRouter} from "../../src/fees/ProtocolFeeRouter.sol";
import {TokenGrantFactory} from "../../src/grants/TokenGrantFactory.sol";
import {BoardroomRewardsFactory} from "../../src/rewards/BoardroomRewardsFactory.sol";
import {PledgeV4LiquidityFactory} from "../../src/uniswap/PledgeV4LiquidityFactory.sol";
import {V4PoolManagerMock} from "../helpers/V4PoolManagerMock.sol";

contract DeterministicDeploymentTest is Test {
    address internal owner = address(0xA11CE);
    address internal stranger = address(0xB0B);

    PledgeCashDeterministicDeployer internal deployer;
    WETH internal wrappedNative;
    BoardroomPolicyRegistry internal policyRegistry;
    ProtocolFacetRegistry internal facetRegistry;
    BoardroomKernel internal kernel;
    BoardroomGovernanceLogic internal governanceLogic;
    BoardroomRedemptionPayout internal redemptionPayout;
    BoardroomMarketLogic internal marketLogic;
    BoardroomFactory internal boardroomFactory;
    BoardroomRelease.Facets internal facets;
    bytes32 internal releaseHash;

    function setUp() public {
        deployer = new PledgeCashDeterministicDeployer(owner);
        wrappedNative = new WETH();
    }

    function testDeployerRejectsZeroOwnerAndEmptyInitCode() public {
        vm.expectRevert(PledgeCashDeterministicDeployer.InvalidAddress.selector);
        new PledgeCashDeterministicDeployer(address(0));

        vm.prank(owner);
        vm.expectRevert(PledgeCashDeterministicDeployer.EmptyInitCode.selector);
        deployer.deploy(PledgeCashDeploymentSalts.tokenGrantFactory(), "");
    }

    function testDeployerOwnerComesFromConstructorNotBroadcastOrigin() public {
        vm.prank(stranger, stranger);
        PledgeCashDeterministicDeployer strangerDeployer = new PledgeCashDeterministicDeployer(owner);

        assertEq(deployer.owner(), owner);
        assertEq(strangerDeployer.owner(), owner);
    }

    function testDeterministicDeployerCreate2AddressBindsExplicitOwner() public pure {
        bytes memory initCodeA =
            abi.encodePacked(type(PledgeCashDeterministicDeployer).creationCode, abi.encode(address(0xA11CE)));
        bytes memory initCodeB =
            abi.encodePacked(type(PledgeCashDeterministicDeployer).creationCode, abi.encode(address(0xB0B)));
        address create2Factory = address(0x4e59b44847b379578588920cA78FbF26c0B4956C);
        bytes32 salt = PledgeCashDeploymentSalts.deterministicDeployer();

        address ownerA = vm.computeCreate2Address(salt, keccak256(initCodeA), create2Factory);
        address ownerB = vm.computeCreate2Address(salt, keccak256(initCodeB), create2Factory);

        assertNotEq(ownerA, ownerB);
    }

    function testOnlyOwnerCanDeployDeterministicContracts() public {
        bytes memory initCode = abi.encodePacked(type(ProtocolFeeRouter).creationCode, abi.encode(owner, owner));

        vm.prank(stranger);
        vm.expectRevert(Ownable.Unauthorized.selector);
        deployer.deploy(PledgeCashDeploymentSalts.protocolFeeRouter(), initCode);
    }

    function testCreate3PredictionDoesNotDependOnConstructorArguments() public view {
        bytes memory initCodeA = abi.encodePacked(type(ProtocolFeeRouter).creationCode, abi.encode(owner, owner));
        bytes memory initCodeB = abi.encodePacked(type(ProtocolFeeRouter).creationCode, abi.encode(owner, stranger));
        bytes32 salt = PledgeCashDeploymentSalts.protocolFeeRouter();

        assertNotEq(keccak256(initCodeA), keccak256(initCodeB));
        assertEq(deployer.predict(salt), CREATE3.predictDeterministicAddress(salt, address(deployer)));
    }

    function testCreate3DeploymentDoesNotDependOnConstructorArguments() public {
        bytes memory initCodeA = abi.encodePacked(type(ProtocolFeeRouter).creationCode, abi.encode(owner, owner));
        bytes memory initCodeB = abi.encodePacked(type(ProtocolFeeRouter).creationCode, abi.encode(owner, stranger));
        bytes32 salt = PledgeCashDeploymentSalts.protocolFeeRouter();

        uint256 snapshotId = vm.snapshotState();
        address deployedA = _deploy(salt, initCodeA);

        assertTrue(vm.revertToState(snapshotId));
        address deployedB = _deploy(salt, initCodeB);

        assertEq(deployedA, deployedB);
    }

    function testCanonicalRootSaltsAreMechanicallyCoupledToCreationCode() public pure {
        assertEq(PledgeCashDeploymentSalts.version(), "pledge.cash.protocol.v1");
        _assertSalt(
            PledgeCashDeploymentSalts.deterministicDeployer(),
            "PledgeCashDeterministicDeployer",
            keccak256(type(PledgeCashDeterministicDeployer).creationCode)
        );
        _assertSalt(
            PledgeCashDeploymentSalts.protocolFacetRegistry(),
            "ProtocolFacetRegistry",
            keccak256(type(ProtocolFacetRegistry).creationCode)
        );
        _assertSalt(
            PledgeCashDeploymentSalts.boardroomKernel(),
            "BoardroomKernel",
            keccak256(type(BoardroomKernel).creationCode)
        );
        _assertSalt(
            PledgeCashDeploymentSalts.boardroomPolicyRegistry(),
            "BoardroomPolicyRegistry",
            keccak256(type(BoardroomPolicyRegistry).creationCode)
        );
        _assertSalt(PledgeCashDeploymentSalts.assetPolicy(), "AssetPolicy", keccak256(type(AssetPolicy).creationCode));
        _assertSalt(
            PledgeCashDeploymentSalts.boardroomGovernanceLogic(),
            "BoardroomGovernanceLogic",
            keccak256(type(BoardroomGovernanceLogic).creationCode)
        );
        _assertSalt(
            PledgeCashDeploymentSalts.boardroomRedemptionPayout(),
            "BoardroomRedemptionPayout",
            keccak256(type(BoardroomRedemptionPayout).creationCode)
        );
        _assertSalt(
            PledgeCashDeploymentSalts.boardroomMarketLogic(),
            "BoardroomMarketLogic",
            keccak256(type(BoardroomMarketLogic).creationCode)
        );
        _assertSalt(
            PledgeCashDeploymentSalts.boardroomFactory(),
            "BoardroomFactory",
            keccak256(type(BoardroomFactory).creationCode)
        );
        _assertSalt(
            PledgeCashDeploymentSalts.boardroomAuthorityFacet(),
            "BoardroomAuthorityFacet",
            keccak256(type(BoardroomAuthorityFacet).creationCode)
        );
        _assertSalt(
            PledgeCashDeploymentSalts.boardroomExecutionFacet(),
            "BoardroomExecutionFacet",
            keccak256(type(BoardroomExecutionFacet).creationCode)
        );
        _assertSalt(
            PledgeCashDeploymentSalts.boardroomMarketFacet(),
            "BoardroomMarketFacet",
            keccak256(type(BoardroomMarketFacet).creationCode)
        );
        _assertSalt(
            PledgeCashDeploymentSalts.boardroomRedemptionFacet(),
            "BoardroomRedemptionFacet",
            keccak256(type(BoardroomRedemptionFacet).creationCode)
        );
        _assertSalt(
            PledgeCashDeploymentSalts.boardroomViewFacet(),
            "BoardroomViewFacet",
            keccak256(type(BoardroomViewFacet).creationCode)
        );
        _assertModuleSalts();
    }

    function testReleaseCodeHashCommitsToCanonicalArchitecture() public pure {
        bytes32 boardroomArchitectureCodeHash = keccak256(
            abi.encode(
                keccak256(type(ProtocolFacetRegistry).creationCode),
                keccak256(type(BoardroomKernel).creationCode),
                keccak256(type(BoardroomFactory).creationCode),
                keccak256(type(BoardroomControllerFactory).creationCode),
                keccak256(type(BoardroomController).creationCode),
                keccak256(type(BoardroomGovernanceLogic).creationCode),
                keccak256(type(BoardroomMarketLogic).creationCode),
                keccak256(type(BoardroomRedemptionPayout).creationCode),
                keccak256(type(BoardroomAuthorityFacet).creationCode),
                keccak256(type(BoardroomExecutionFacet).creationCode),
                keccak256(type(BoardroomMarketFacet).creationCode),
                keccak256(type(BoardroomRedemptionFacet).creationCode),
                keccak256(type(BoardroomViewFacet).creationCode)
            )
        );
        bytes32 moduleArchitectureCodeHash = keccak256(
            abi.encode(
                keccak256(type(BoardroomPolicyRegistry).creationCode),
                keccak256(type(AssetPolicy).creationCode),
                keccak256(type(ProtocolFeeRouter).creationCode),
                keccak256(type(TokenGrantFactory).creationCode),
                keccak256(type(PledgeV4LiquidityFactory).creationCode),
                keccak256(type(DistributionFactory).creationCode),
                keccak256(type(BoardroomRewardsFactory).creationCode),
                keccak256(type(BondMarketFactory).creationCode)
            )
        );

        assertEq(PledgeCashDeploymentSalts.boardroomArchitectureCodeHash(), boardroomArchitectureCodeHash);
        assertEq(PledgeCashDeploymentSalts.moduleArchitectureCodeHash(), moduleArchitectureCodeHash);
        assertEq(
            PledgeCashDeploymentSalts.releaseCodeHash(),
            keccak256(
                abi.encode(
                    keccak256(type(PledgeCashDeterministicDeployer).creationCode),
                    boardroomArchitectureCodeHash,
                    moduleArchitectureCodeHash
                )
            )
        );
    }

    function testDeploysCanonicalBoardroomGraphAndActivatesReleaseA() public {
        _deployCanonicalBoardroomGraph();

        assertEq(address(kernel.facetRegistry()), address(facetRegistry));
        assertEq(kernel.kernelSelectorSetHash(), BoardroomKernelSelectors.selectorSetHash());
        assertEq(facetRegistry.kernelSelectorSetHash(), BoardroomKernelSelectors.selectorSetHash());
        assertEq(facetRegistry.activeFacetSetHash(), releaseHash);
        assertEq(facetRegistry.activeRelease(), 1);
        assertEq(facetRegistry.activeStorageVersion(), 1);
        assertEq(address(boardroomFactory.facetRegistry()), address(facetRegistry));
        assertEq(boardroomFactory.boardroomKernelLogic(), address(kernel));
        assertEq(boardroomFactory.policyRegistry(), address(policyRegistry));
        assertEq(boardroomFactory.wrappedNative(), address(wrappedNative));
        assertEq(boardroomFactory.governanceLogic(), address(governanceLogic));
        assertEq(boardroomFactory.redemptionPayoutLogic(), address(redemptionPayout));
        assertEq(boardroomFactory.marketLogic(), address(marketLogic));

        BoardroomControllerFactory controllerFactory = BoardroomControllerFactory(boardroomFactory.controllerFactory());
        assertEq(controllerFactory.boardroomFactory(), address(boardroomFactory));
        assertGt(controllerFactory.controllerImplementation().code.length, 0);

        address boardroomAddress =
            boardroomFactory.createBoardroom(releaseHash, owner, "Canonical Boardroom", "CBR", keccak256("test"));
        IBoardroom boardroom = IBoardroom(boardroomAddress);
        assertEq(boardroom.facetSetHash(), releaseHash);
        assertEq(boardroom.appliedStorageVersion(), 1);
        assertFalse(boardroom.migrationRequired());
        assertEq(boardroom.owner(), owner);
        assertEq(boardroom.policyRegistry(), address(policyRegistry));
        assertEq(boardroom.wrappedNative(), address(wrappedNative));
        assertGt(boardroom.shareToken().code.length, 0);
    }

    function testDeploysCanonicalModuleGraphAtPredictedAddresses() public {
        _deployCanonicalBoardroomGraph();

        AssetPolicy assetPolicy = AssetPolicy(
            _deploy(
                PledgeCashDeploymentSalts.assetPolicy(),
                abi.encodePacked(type(AssetPolicy).creationCode, abi.encode(owner, address(wrappedNative)))
            )
        );
        ProtocolFeeRouter protocolFeeRouter = ProtocolFeeRouter(
            payable(_deploy(
                    PledgeCashDeploymentSalts.protocolFeeRouter(),
                    abi.encodePacked(type(ProtocolFeeRouter).creationCode, abi.encode(owner, owner))
                ))
        );
        TokenGrantFactory tokenGrantFactory = TokenGrantFactory(
            _deploy(
                PledgeCashDeploymentSalts.tokenGrantFactory(),
                abi.encodePacked(type(TokenGrantFactory).creationCode, abi.encode(owner, address(boardroomFactory)))
            )
        );
        V4PoolManagerMock poolManager = new V4PoolManagerMock();
        PledgeV4LiquidityFactory liquidityFactory = PledgeV4LiquidityFactory(
            _deploy(
                PledgeCashDeploymentSalts.pledgeV4LiquidityFactory(),
                abi.encodePacked(
                    type(PledgeV4LiquidityFactory).creationCode,
                    abi.encode(
                        IPoolManager(address(poolManager)), address(boardroomFactory), address(protocolFeeRouter), owner
                    )
                )
            )
        );
        bytes32 hookSalt = _mineHookSalt(liquidityFactory);
        vm.prank(owner);
        address hook = liquidityFactory.deployHook(hookSalt);
        DistributionFactory distributionFactory = DistributionFactory(
            _deploy(
                PledgeCashDeploymentSalts.distributionFactory(),
                abi.encodePacked(
                    type(DistributionFactory).creationCode,
                    abi.encode(address(liquidityFactory), address(tokenGrantFactory))
                )
            )
        );
        BoardroomRewardsFactory rewardsFactory = BoardroomRewardsFactory(
            _deploy(
                PledgeCashDeploymentSalts.boardroomRewardsFactory(),
                abi.encodePacked(type(BoardroomRewardsFactory).creationCode, abi.encode(address(boardroomFactory)))
            )
        );
        BondMarketFactory bondFactory = BondMarketFactory(
            _deploy(
                PledgeCashDeploymentSalts.bondMarketFactory(),
                abi.encodePacked(
                    type(BondMarketFactory).creationCode,
                    abi.encode(address(liquidityFactory), address(boardroomFactory))
                )
            )
        );

        assertEq(assetPolicy.owner(), owner);
        assertEq(protocolFeeRouter.owner(), owner);
        assertEq(tokenGrantFactory.boardroomFactory(), address(boardroomFactory));
        assertEq(address(liquidityFactory.poolManager()), address(poolManager));
        assertEq(address(liquidityFactory.hook()), hook);
        assertEq(liquidityFactory.hookSalt(), hookSalt);
        assertEq(liquidityFactory.boardroomFactory(), address(boardroomFactory));
        assertEq(distributionFactory.liquidityFactory(), address(liquidityFactory));
        assertEq(distributionFactory.tokenGrantFactory(), address(tokenGrantFactory));
        assertEq(distributionFactory.boardroomFactory(), address(boardroomFactory));
        assertEq(rewardsFactory.boardroomFactory(), address(boardroomFactory));
        assertEq(bondFactory.liquidityFactory(), address(liquidityFactory));
        assertEq(bondFactory.boardroomFactory(), address(boardroomFactory));
    }

    function testRepeatedDeployReturnsExistingAddress() public {
        bytes memory initCode = abi.encodePacked(type(ProtocolFeeRouter).creationCode, abi.encode(owner, owner));
        bytes32 salt = PledgeCashDeploymentSalts.protocolFeeRouter();
        address predicted = deployer.predict(salt);

        address first = _deploy(salt, initCode);
        address second = _deploy(salt, initCode);

        assertEq(first, predicted);
        assertEq(second, predicted);
    }

    function testRepeatedDeployRejectsMismatchedInitCode() public {
        bytes memory initCode = abi.encodePacked(type(ProtocolFeeRouter).creationCode, abi.encode(owner, owner));
        bytes memory mismatchedInitCode =
            abi.encodePacked(type(ProtocolFeeRouter).creationCode, abi.encode(owner, stranger));
        bytes32 salt = PledgeCashDeploymentSalts.protocolFeeRouter();

        _deploy(salt, initCode);

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                PledgeCashDeterministicDeployer.InitCodeHashMismatch.selector,
                salt,
                keccak256(initCode),
                keccak256(mismatchedInitCode)
            )
        );
        deployer.deploy(salt, mismatchedInitCode);
    }

    function _deployCanonicalBoardroomGraph() internal {
        policyRegistry = BoardroomPolicyRegistry(
            _deploy(
                PledgeCashDeploymentSalts.boardroomPolicyRegistry(),
                abi.encodePacked(type(BoardroomPolicyRegistry).creationCode, abi.encode(owner))
            )
        );
        facetRegistry = ProtocolFacetRegistry(
            _deploy(
                PledgeCashDeploymentSalts.protocolFacetRegistry(),
                abi.encodePacked(
                    type(ProtocolFacetRegistry).creationCode, abi.encode(owner, BoardroomKernelSelectors.selectors())
                )
            )
        );
        kernel = BoardroomKernel(
            payable(_deploy(
                    PledgeCashDeploymentSalts.boardroomKernel(),
                    abi.encodePacked(type(BoardroomKernel).creationCode, abi.encode(address(facetRegistry)))
                ))
        );
        governanceLogic = BoardroomGovernanceLogic(
            _deploy(PledgeCashDeploymentSalts.boardroomGovernanceLogic(), type(BoardroomGovernanceLogic).creationCode)
        );
        redemptionPayout = BoardroomRedemptionPayout(
            _deploy(PledgeCashDeploymentSalts.boardroomRedemptionPayout(), type(BoardroomRedemptionPayout).creationCode)
        );
        marketLogic = BoardroomMarketLogic(
            _deploy(PledgeCashDeploymentSalts.boardroomMarketLogic(), type(BoardroomMarketLogic).creationCode)
        );
        boardroomFactory = BoardroomFactory(
            _deploy(
                PledgeCashDeploymentSalts.boardroomFactory(),
                abi.encodePacked(
                    type(BoardroomFactory).creationCode,
                    abi.encode(
                        address(facetRegistry),
                        address(policyRegistry),
                        address(wrappedNative),
                        address(kernel),
                        address(redemptionPayout),
                        address(governanceLogic),
                        address(marketLogic)
                    )
                )
            )
        );
        _deployFacets();

        ProtocolFacetTypes.FacetSetManifest memory manifest = BoardroomRelease.releaseA(facets);
        vm.startPrank(owner);
        releaseHash = facetRegistry.publishFacetSet(manifest);
        facetRegistry.activateFacetSet(releaseHash);
        vm.stopPrank();
    }

    function _deployFacets() internal {
        address controllerFactory = boardroomFactory.controllerFactory();
        facets.authority = _deploy(
            PledgeCashDeploymentSalts.boardroomAuthorityFacet(),
            _facetInitCode(type(BoardroomAuthorityFacet).creationCode, controllerFactory)
        );
        facets.execution = _deploy(
            PledgeCashDeploymentSalts.boardroomExecutionFacet(),
            _facetInitCode(type(BoardroomExecutionFacet).creationCode, controllerFactory)
        );
        facets.market = _deploy(
            PledgeCashDeploymentSalts.boardroomMarketFacet(),
            _facetInitCode(type(BoardroomMarketFacet).creationCode, controllerFactory)
        );
        facets.redemption = _deploy(
            PledgeCashDeploymentSalts.boardroomRedemptionFacet(),
            _facetInitCode(type(BoardroomRedemptionFacet).creationCode, controllerFactory)
        );
        facets.viewFacet = _deploy(
            PledgeCashDeploymentSalts.boardroomViewFacet(),
            _facetInitCode(type(BoardroomViewFacet).creationCode, controllerFactory)
        );
    }

    function _facetInitCode(bytes memory creationCode, address controllerFactory) internal view returns (bytes memory) {
        return abi.encodePacked(
            creationCode,
            abi.encode(address(redemptionPayout), address(governanceLogic), controllerFactory, address(marketLogic))
        );
    }

    function _deploy(bytes32 salt, bytes memory initCode) internal returns (address deployed) {
        address predicted = deployer.predict(salt);

        vm.prank(owner);
        deployed = deployer.deploy(salt, initCode);

        assertEq(deployed, predicted);
        assertEq(deployer.initCodeHashForSalt(salt), keccak256(initCode));
        assertGt(deployed.code.length, 0);
    }

    function _assertModuleSalts() internal pure {
        _assertSalt(
            PledgeCashDeploymentSalts.protocolFeeRouter(),
            "ProtocolFeeRouter",
            keccak256(type(ProtocolFeeRouter).creationCode)
        );
        _assertSalt(
            PledgeCashDeploymentSalts.tokenGrantFactory(),
            "TokenGrantFactory",
            keccak256(type(TokenGrantFactory).creationCode)
        );
        _assertSalt(
            PledgeCashDeploymentSalts.pledgeV4LiquidityFactory(),
            "PledgeV4LiquidityFactory",
            keccak256(type(PledgeV4LiquidityFactory).creationCode)
        );
        _assertSalt(
            PledgeCashDeploymentSalts.distributionFactory(),
            "DistributionFactory",
            keccak256(type(DistributionFactory).creationCode)
        );
        _assertSalt(
            PledgeCashDeploymentSalts.boardroomRewardsFactory(),
            "BoardroomRewardsFactory",
            keccak256(type(BoardroomRewardsFactory).creationCode)
        );
        _assertSalt(
            PledgeCashDeploymentSalts.bondMarketFactory(),
            "BondMarketFactory",
            keccak256(type(BondMarketFactory).creationCode)
        );
    }

    function _assertSalt(bytes32 actual, string memory contractName, bytes32 creationCodeHash) internal pure {
        assertEq(actual, _releaseSalt(contractName, creationCodeHash));
    }

    function _mineHookSalt(PledgeV4LiquidityFactory factory) internal view returns (bytes32 salt) {
        for (uint256 candidate; candidate < 100_000; ++candidate) {
            salt = bytes32(candidate);
            if (uint160(factory.predictHookAddress(salt)) & ((1 << 14) - 1) == (1 << 13)) return salt;
        }
        revert("hook salt");
    }

    function _releaseSalt(string memory contractName, bytes32 creationCodeHash) internal pure returns (bytes32) {
        return keccak256(abi.encode("pledge.cash.protocol.v1", contractName, creationCodeHash));
    }
}
