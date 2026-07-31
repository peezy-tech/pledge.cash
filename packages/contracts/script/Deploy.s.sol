// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {AssetPolicy} from "../src/policy/AssetPolicy.sol";
import {BoardroomGovernanceLogic} from "../src/boardroom/BoardroomGovernanceLogic.sol";
import {BoardroomMarketLogic} from "../src/boardroom/BoardroomMarketLogic.sol";
import {BoardroomPolicyRegistry} from "../src/boardroom/BoardroomPolicyRegistry.sol";
import {BoardroomRedemptionPayout} from "../src/boardroom/BoardroomRedemptionPayout.sol";
import {BoardroomControllerFactory} from "../src/boardroom/BoardroomControllerFactory.sol";
import {BoardroomFactory} from "../src/boardroom/BoardroomFactory.sol";
import {BoardroomAuthorityFacet} from "../src/boardroom/diamond/BoardroomAuthorityFacet.sol";
import {BoardroomExecutionFacet} from "../src/boardroom/diamond/BoardroomExecutionFacet.sol";
import {BoardroomKernel} from "../src/boardroom/diamond/BoardroomKernel.sol";
import {BoardroomKernelSelectors} from "../src/boardroom/diamond/BoardroomKernelSelectors.sol";
import {BoardroomMarketFacet} from "../src/boardroom/diamond/BoardroomMarketFacet.sol";
import {BoardroomRedemptionFacet} from "../src/boardroom/diamond/BoardroomRedemptionFacet.sol";
import {BoardroomManifestHashes} from "../src/boardroom/diamond/BoardroomManifestHashes.sol";
import {BoardroomRelease} from "../src/boardroom/diamond/BoardroomRelease.sol";
import {BoardroomStorageLayouts} from "../src/boardroom/diamond/BoardroomStorageLayouts.sol";
import {BoardroomViewFacet} from "../src/boardroom/diamond/BoardroomViewFacet.sol";
import {ProtocolFacetRegistry} from "../src/boardroom/diamond/ProtocolFacetRegistry.sol";
import {ProtocolFacetTypes} from "../src/boardroom/diamond/ProtocolFacetTypes.sol";
import {BondMarketFactory} from "../src/bonds/BondMarketFactory.sol";
import {DistributionFactory} from "../src/distribution/DistributionFactory.sol";
import {PledgeCashDeploymentSalts} from "../src/deployment/PledgeCashDeploymentSalts.sol";
import {PledgeCashDeterministicDeployer} from "../src/deployment/PledgeCashDeterministicDeployer.sol";
import {ProtocolFeeRouter} from "../src/fees/ProtocolFeeRouter.sol";
import {TokenGrantFactory} from "../src/grants/TokenGrantFactory.sol";
import {BoardroomRewardsFactory} from "../src/rewards/BoardroomRewardsFactory.sol";
import {PledgeV4LiquidityFactory} from "../src/uniswap/PledgeV4LiquidityFactory.sol";

interface IOwnableDeploymentRoot {
    function owner() external view returns (address);

    function transferOwnership(address newOwner) external payable;
}

/// @notice Deterministically deploys and attests the sole canonical pledge.cash protocol.
/// @dev Every protocol root except the externally supplied wrapped-native token is deployed
/// through the CREATE3 root. Re-running with the original deployment authority is safe:
/// every CREATE3 salt is bound to its first init-code hash and every configuration mutation
/// is skipped once its postcondition already holds.
contract Deploy is Script {
    using stdJson for string;

    address internal constant DEFAULT_CREATE2_FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    uint64 internal constant RELEASE_A = 1;
    uint64 internal constant STORAGE_VERSION_A = 1;

    error MissingWrappedNativeAddress();
    error MissingDeterministicDeployerOwner();
    error MissingProtocolGovernance();
    error MissingProtocolTreasury();
    error MissingUniswapV4Contract(bytes32 field);
    error HookSaltNotFound(uint256 start);
    error MissingDeterministicDeployer(address deterministicDeployer);
    error MissingContract(address account);
    error DeterministicDeployerMismatch(address expected, address actual);
    error DeterministicDeployerOwnerMismatch(address expected, address actual);
    error DeterministicDeployerCodeHashMismatch(bytes32 expected, bytes32 actual);
    error DeterministicDeployerOperatorMismatch(address owner, address broadcaster);
    error DeterministicAddressMismatch(bytes32 salt, address expected, address actual);
    error DeterministicInitCodeMismatch(bytes32 salt, bytes32 expected, bytes32 actual);
    error RootOwnerMismatch(address root, address expected, address actual);
    error RootConfigurationRequiresBootstrapOwner(address root, address actualOwner);
    error DeploymentAddressAttestationFailed(bytes32 field, address expected, address actual);
    error DeploymentBytes32AttestationFailed(bytes32 field, bytes32 expected, bytes32 actual);
    error DeploymentUintAttestationFailed(bytes32 field, uint256 expected, uint256 actual);
    error ReleaseOwnerRequired(address expected, address actual);
    error ReleaseHashMismatch(bytes32 expected, bytes32 actual);
    error ReleaseStateConflict(uint64 activeRelease, bytes32 activeFacetSetHash);
    error ReleaseRouteMismatch(bytes4 selector);

    struct DeployState {
        address deployer;
        address deterministicDeployerOwner;
        address create2Factory;
        address wrappedNative;
        address protocolGovernance;
        address protocolTreasury;
        address poolManager;
        address universalRouter;
        address quoter;
        address stateView;
        address positionManager;
        address permit2;
        PledgeCashDeterministicDeployer deterministicDeployer;
        ProtocolFacetRegistry protocolFacetRegistry;
        BoardroomKernel boardroomKernel;
        BoardroomPolicyRegistry boardroomPolicyRegistry;
        AssetPolicy assetPolicy;
        ProtocolFeeRouter protocolFeeRouter;
        TokenGrantFactory tokenGrantFactory;
        PledgeV4LiquidityFactory liquidityFactory;
        address pledgeV4Hook;
        bytes32 pledgeV4HookSalt;
        DistributionFactory distributionFactory;
        BoardroomRewardsFactory boardroomRewardsFactory;
        BondMarketFactory bondMarketFactory;
        BoardroomFactory boardroomFactory;
        BoardroomGovernanceLogic boardroomGovernanceLogic;
        BoardroomRedemptionPayout boardroomRedemptionPayout;
        BoardroomMarketLogic boardroomMarketLogic;
        BoardroomRelease.Facets facets;
        bytes32 activeFacetSetHash;
    }

    function run() external {
        uint256 deployerKey = vm.envOr("PRIVATE_KEY", uint256(0));
        DeployState memory state;
        state.deployer = deployerKey == 0 ? msg.sender : vm.addr(deployerKey);
        state.deterministicDeployerOwner = vm.envOr("PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER", address(0));
        if (state.deterministicDeployerOwner == address(0)) revert MissingDeterministicDeployerOwner();
        if (state.deterministicDeployerOwner != state.deployer) {
            revert DeterministicDeployerOperatorMismatch(state.deterministicDeployerOwner, state.deployer);
        }
        state.wrappedNative = vm.envOr("WRAPPED_NATIVE_ADDRESS", address(0));
        if (state.wrappedNative == address(0)) revert MissingWrappedNativeAddress();
        if (state.wrappedNative.code.length == 0) revert MissingContract(state.wrappedNative);
        state.protocolGovernance = vm.envOr("PLEDGE_CASH_PROTOCOL_GOVERNANCE", address(0));
        if (state.protocolGovernance == address(0)) revert MissingProtocolGovernance();
        state.protocolTreasury = vm.envOr("PLEDGE_CASH_PROTOCOL_TREASURY", address(0));
        if (state.protocolTreasury == address(0)) revert MissingProtocolTreasury();
        state.poolManager = vm.envOr("UNISWAP_V4_POOL_MANAGER", address(0));
        state.universalRouter = vm.envOr("UNISWAP_UNIVERSAL_ROUTER", address(0));
        state.quoter = vm.envOr("UNISWAP_V4_QUOTER", address(0));
        state.stateView = vm.envOr("UNISWAP_V4_STATE_VIEW", address(0));
        state.positionManager = vm.envOr("UNISWAP_V4_POSITION_MANAGER", address(0));
        state.permit2 = vm.envOr("PERMIT2_ADDRESS", address(0));
        _requireExternalContract("uniswap.poolManager", state.poolManager);
        _requireExternalContract("uniswap.universalRouter", state.universalRouter);
        _requireExternalContract("uniswap.quoter", state.quoter);
        _requireExternalContract("uniswap.stateView", state.stateView);
        _requireExternalContract("uniswap.positionManager", state.positionManager);
        _requireExternalContract("uniswap.permit2", state.permit2);

        if (deployerKey == 0) {
            vm.startBroadcast();
        } else {
            vm.startBroadcast(deployerKey);
        }

        _deployProtocol(state);
        _publishAndActivateReleaseA(state);
        _deployModules(state);
        _configureProtocol(state);
        _handoffRootOwnership(state);
        _attestDeployment(state);

        vm.stopBroadcast();

        string memory output = _deploymentJson(state);
        if (vm.envOr("WRITE_DEPLOYMENT_STATE", true)) {
            vm.createDir("deployments", true);
            string memory defaultPath = string.concat("deployments/", vm.toString(block.chainid), ".json");
            vm.writeJson(output, vm.envOr("DEPLOYMENT_ARTIFACT_PATH", defaultPath));
        }
        _logDeployment(state);
    }

    function _deployProtocol(DeployState memory state) internal {
        _ensureDeterministicDeployer(state);

        state.boardroomPolicyRegistry = BoardroomPolicyRegistry(
            _deployDeterministic(
                state,
                PledgeCashDeploymentSalts.boardroomPolicyRegistry(),
                abi.encodePacked(type(BoardroomPolicyRegistry).creationCode, abi.encode(state.deployer))
            )
        );
        state.protocolFacetRegistry = ProtocolFacetRegistry(
            _deployDeterministic(
                state,
                PledgeCashDeploymentSalts.protocolFacetRegistry(),
                abi.encodePacked(
                    type(ProtocolFacetRegistry).creationCode,
                    abi.encode(state.deployer, BoardroomKernelSelectors.selectors())
                )
            )
        );
        state.boardroomKernel = BoardroomKernel(
            payable(_deployDeterministic(
                    state,
                    PledgeCashDeploymentSalts.boardroomKernel(),
                    abi.encodePacked(
                        type(BoardroomKernel).creationCode, abi.encode(address(state.protocolFacetRegistry))
                    )
                ))
        );
        state.boardroomGovernanceLogic = BoardroomGovernanceLogic(
            _deployDeterministic(
                state, PledgeCashDeploymentSalts.boardroomGovernanceLogic(), type(BoardroomGovernanceLogic).creationCode
            )
        );
        state.boardroomRedemptionPayout = BoardroomRedemptionPayout(
            _deployDeterministic(
                state,
                PledgeCashDeploymentSalts.boardroomRedemptionPayout(),
                type(BoardroomRedemptionPayout).creationCode
            )
        );
        state.boardroomMarketLogic = BoardroomMarketLogic(
            _deployDeterministic(
                state, PledgeCashDeploymentSalts.boardroomMarketLogic(), type(BoardroomMarketLogic).creationCode
            )
        );
        state.boardroomFactory = BoardroomFactory(
            _deployDeterministic(
                state,
                PledgeCashDeploymentSalts.boardroomFactory(),
                abi.encodePacked(
                    type(BoardroomFactory).creationCode,
                    abi.encode(
                        address(state.protocolFacetRegistry),
                        address(state.boardroomPolicyRegistry),
                        state.wrappedNative,
                        address(state.boardroomKernel),
                        address(state.boardroomRedemptionPayout),
                        address(state.boardroomGovernanceLogic),
                        address(state.boardroomMarketLogic)
                    )
                )
            )
        );

        address controllerFactory = state.boardroomFactory.controllerFactory();
        state.facets.authority = _deployDeterministic(
            state,
            PledgeCashDeploymentSalts.boardroomAuthorityFacet(),
            _facetInitCode(
                type(BoardroomAuthorityFacet).creationCode,
                state.boardroomRedemptionPayout,
                state.boardroomGovernanceLogic,
                controllerFactory,
                state.boardroomMarketLogic
            )
        );
        state.facets.execution = _deployDeterministic(
            state,
            PledgeCashDeploymentSalts.boardroomExecutionFacet(),
            _facetInitCode(
                type(BoardroomExecutionFacet).creationCode,
                state.boardroomRedemptionPayout,
                state.boardroomGovernanceLogic,
                controllerFactory,
                state.boardroomMarketLogic
            )
        );
        state.facets.market = _deployDeterministic(
            state,
            PledgeCashDeploymentSalts.boardroomMarketFacet(),
            _facetInitCode(
                type(BoardroomMarketFacet).creationCode,
                state.boardroomRedemptionPayout,
                state.boardroomGovernanceLogic,
                controllerFactory,
                state.boardroomMarketLogic
            )
        );
        state.facets.redemption = _deployDeterministic(
            state,
            PledgeCashDeploymentSalts.boardroomRedemptionFacet(),
            _facetInitCode(
                type(BoardroomRedemptionFacet).creationCode,
                state.boardroomRedemptionPayout,
                state.boardroomGovernanceLogic,
                controllerFactory,
                state.boardroomMarketLogic
            )
        );
        state.facets.viewFacet = _deployDeterministic(
            state,
            PledgeCashDeploymentSalts.boardroomViewFacet(),
            _facetInitCode(
                type(BoardroomViewFacet).creationCode,
                state.boardroomRedemptionPayout,
                state.boardroomGovernanceLogic,
                controllerFactory,
                state.boardroomMarketLogic
            )
        );
    }

    function _facetInitCode(
        bytes memory creationCode,
        BoardroomRedemptionPayout redemptionPayout,
        BoardroomGovernanceLogic governanceLogic,
        address controllerFactory,
        BoardroomMarketLogic marketLogic
    ) internal pure returns (bytes memory) {
        return abi.encodePacked(
            creationCode,
            abi.encode(address(redemptionPayout), address(governanceLogic), controllerFactory, address(marketLogic))
        );
    }

    function _publishAndActivateReleaseA(DeployState memory state) internal {
        ProtocolFacetTypes.FacetSetManifest memory manifest = BoardroomRelease.releaseA(state.facets);
        bytes32 expectedFacetSetHash = state.protocolFacetRegistry.computeFacetSetHash(manifest);
        bytes32 publishedHash = state.protocolFacetRegistry.facetSetHashForRelease(RELEASE_A);

        if (publishedHash == bytes32(0)) {
            _requireRegistryBootstrapOwner(state);
            bytes32 actualFacetSetHash = state.protocolFacetRegistry.publishFacetSet(manifest);
            if (actualFacetSetHash != expectedFacetSetHash) {
                revert ReleaseHashMismatch(expectedFacetSetHash, actualFacetSetHash);
            }
        } else if (publishedHash != expectedFacetSetHash) {
            revert ReleaseHashMismatch(expectedFacetSetHash, publishedHash);
        }

        bytes32 activeHash = state.protocolFacetRegistry.activeFacetSetHash();
        uint64 activeRelease = state.protocolFacetRegistry.activeRelease();
        if (activeHash == bytes32(0) && activeRelease == 0) {
            _requireRegistryBootstrapOwner(state);
            state.protocolFacetRegistry.activateFacetSet(expectedFacetSetHash);
        } else if (activeHash != expectedFacetSetHash || activeRelease != RELEASE_A) {
            revert ReleaseStateConflict(activeRelease, activeHash);
        }
        state.activeFacetSetHash = expectedFacetSetHash;
    }

    function _requireRegistryBootstrapOwner(DeployState memory state) internal view {
        address actualOwner = state.protocolFacetRegistry.owner();
        if (actualOwner != state.deployer) revert ReleaseOwnerRequired(state.deployer, actualOwner);
    }

    function _deployModules(DeployState memory state) internal {
        state.assetPolicy = AssetPolicy(
            _deployDeterministic(
                state,
                PledgeCashDeploymentSalts.assetPolicy(),
                abi.encodePacked(type(AssetPolicy).creationCode, abi.encode(state.deployer, state.wrappedNative))
            )
        );
        state.protocolFeeRouter = ProtocolFeeRouter(
            payable(_deployDeterministic(
                    state,
                    PledgeCashDeploymentSalts.protocolFeeRouter(),
                    abi.encodePacked(
                        type(ProtocolFeeRouter).creationCode, abi.encode(state.deployer, state.protocolTreasury)
                    )
                ))
        );
        state.tokenGrantFactory = TokenGrantFactory(
            _deployDeterministic(
                state,
                PledgeCashDeploymentSalts.tokenGrantFactory(),
                abi.encodePacked(
                    type(TokenGrantFactory).creationCode, abi.encode(state.deployer, address(state.boardroomFactory))
                )
            )
        );
        state.liquidityFactory = PledgeV4LiquidityFactory(
            _deployDeterministic(
                state,
                PledgeCashDeploymentSalts.pledgeV4LiquidityFactory(),
                abi.encodePacked(
                    type(PledgeV4LiquidityFactory).creationCode,
                    abi.encode(
                        IPoolManager(state.poolManager),
                        address(state.boardroomFactory),
                        address(state.protocolFeeRouter),
                        state.deployer
                    )
                )
            )
        );
        _ensurePledgeV4Hook(state);
        state.distributionFactory = DistributionFactory(
            _deployDeterministic(
                state,
                PledgeCashDeploymentSalts.distributionFactory(),
                abi.encodePacked(
                    type(DistributionFactory).creationCode,
                    abi.encode(address(state.liquidityFactory), address(state.tokenGrantFactory))
                )
            )
        );
        state.boardroomRewardsFactory = BoardroomRewardsFactory(
            _deployDeterministic(
                state,
                PledgeCashDeploymentSalts.boardroomRewardsFactory(),
                abi.encodePacked(
                    type(BoardroomRewardsFactory).creationCode, abi.encode(address(state.boardroomFactory))
                )
            )
        );
        state.bondMarketFactory = BondMarketFactory(
            _deployDeterministic(
                state,
                PledgeCashDeploymentSalts.bondMarketFactory(),
                abi.encodePacked(
                    type(BondMarketFactory).creationCode,
                    abi.encode(address(state.liquidityFactory), address(state.boardroomFactory))
                )
            )
        );
    }

    function _ensurePledgeV4Hook(DeployState memory state) internal {
        address deployedHook = address(state.liquidityFactory.hook());
        if (deployedHook == address(0)) {
            uint256 start = vm.envOr("PLEDGE_V4_HOOK_SALT_START", uint256(0));
            bytes32 salt = _minePledgeV4HookSalt(state.liquidityFactory, start);
            deployedHook = state.liquidityFactory.deployHook(salt);
        }
        state.pledgeV4Hook = deployedHook;
        state.pledgeV4HookSalt = state.liquidityFactory.hookSalt();
    }

    function _minePledgeV4HookSalt(PledgeV4LiquidityFactory factory, uint256 start)
        internal
        view
        returns (bytes32 salt)
    {
        uint160 allFlags = (1 << 14) - 1;
        uint160 requiredFlags = factory.REQUIRED_HOOK_FLAGS();
        uint256 end = start + 1_000_000;
        for (uint256 candidate = start; candidate < end; ++candidate) {
            salt = bytes32(candidate);
            if (uint160(factory.predictHookAddress(salt)) & allFlags == requiredFlags) return salt;
        }
        revert HookSaltNotFound(start);
    }

    function _ensureDeterministicDeployer(DeployState memory state) internal {
        state.create2Factory = vm.envOr("CREATE2_FACTORY_ADDRESS", DEFAULT_CREATE2_FACTORY);
        bytes memory initCode = abi.encodePacked(
            type(PledgeCashDeterministicDeployer).creationCode, abi.encode(state.deterministicDeployerOwner)
        );
        bytes32 salt = PledgeCashDeploymentSalts.deterministicDeployer();
        address expectedDeployer = vm.computeCreate2Address(salt, keccak256(initCode), state.create2Factory);
        address configuredDeployer = vm.envOr("PLEDGE_CASH_DETERMINISTIC_DEPLOYER", address(0));
        if (configuredDeployer != address(0)) {
            if (configuredDeployer != expectedDeployer) {
                revert DeterministicDeployerMismatch(expectedDeployer, configuredDeployer);
            }
            if (configuredDeployer.code.length == 0) revert MissingDeterministicDeployer(configuredDeployer);
            state.deterministicDeployer = PledgeCashDeterministicDeployer(configuredDeployer);
            _requireDeterministicDeployerOwner(state);
            return;
        }

        if (expectedDeployer.code.length == 0) {
            state.deterministicDeployer =
                new PledgeCashDeterministicDeployer{salt: salt}(state.deterministicDeployerOwner);
            if (address(state.deterministicDeployer) != expectedDeployer) {
                revert DeterministicDeployerMismatch(expectedDeployer, address(state.deterministicDeployer));
            }
        } else {
            state.deterministicDeployer = PledgeCashDeterministicDeployer(expectedDeployer);
        }
        _requireDeterministicDeployerOwner(state);
    }

    function _requireDeterministicDeployerOwner(DeployState memory state) internal view {
        bytes32 expectedCodeHash = keccak256(type(PledgeCashDeterministicDeployer).runtimeCode);
        bytes32 actualCodeHash = address(state.deterministicDeployer).codehash;
        if (actualCodeHash != expectedCodeHash) {
            revert DeterministicDeployerCodeHashMismatch(expectedCodeHash, actualCodeHash);
        }
        address actualOwner = state.deterministicDeployer.owner();
        if (actualOwner != state.deterministicDeployerOwner) {
            revert DeterministicDeployerOwnerMismatch(state.deterministicDeployerOwner, actualOwner);
        }
    }

    function _deployDeterministic(DeployState memory state, bytes32 salt, bytes memory initCode)
        internal
        returns (address deployed)
    {
        address expected = state.deterministicDeployer.predict(salt);
        bytes32 expectedInitCodeHash = keccak256(initCode);
        deployed = state.deterministicDeployer.deploy(salt, initCode);
        if (deployed != expected) revert DeterministicAddressMismatch(salt, expected, deployed);
        if (deployed.code.length == 0) revert MissingContract(deployed);
        bytes32 actualInitCodeHash = state.deterministicDeployer.initCodeHashForSalt(salt);
        if (actualInitCodeHash != expectedInitCodeHash) {
            revert DeterministicInitCodeMismatch(salt, expectedInitCodeHash, actualInitCodeHash);
        }
    }

    function _configureProtocol(DeployState memory state) internal {
        _configureApprovalSpender(state, address(state.tokenGrantFactory));
        _configureApprovalSpender(state, address(state.distributionFactory));
        _configureApprovalSpender(state, address(state.bondMarketFactory));
        _configureApprovalSpender(state, address(state.liquidityFactory));
        _configureApprovalSpender(state, address(state.boardroomRewardsFactory));

        if (!state.boardroomPolicyRegistry.isPolicyAllowed(address(state.assetPolicy))) {
            _requireBootstrapOwner(address(state.boardroomPolicyRegistry), state);
            state.boardroomPolicyRegistry.setPolicyAllowed(address(state.assetPolicy), true);
        }
        _configureModulePolicy(state, address(state.tokenGrantFactory));
        _configureModulePolicy(state, address(state.distributionFactory));
        _configureModulePolicy(state, address(state.bondMarketFactory));
        _configureModulePolicy(state, address(state.liquidityFactory));
        _configureModulePolicy(state, address(state.boardroomRewardsFactory));

        uint256 creationFee = vm.envOr("TOKEN_GRANT_CREATION_FEE_WEI", uint256(0));
        if (state.tokenGrantFactory.creationFee() != creationFee) {
            _requireBootstrapOwner(address(state.tokenGrantFactory), state);
            state.tokenGrantFactory.setCreationFee(creationFee);
        }
        if (state.protocolFeeRouter.feeRecipient() != state.protocolTreasury) {
            _requireBootstrapOwner(address(state.protocolFeeRouter), state);
            state.protocolFeeRouter.setFeeRecipient(state.protocolTreasury);
        }
        if (state.tokenGrantFactory.feeRecipient() != address(state.protocolFeeRouter)) {
            _requireBootstrapOwner(address(state.tokenGrantFactory), state);
            state.tokenGrantFactory.setFeeRecipient(address(state.protocolFeeRouter));
        }
    }

    function _configureApprovalSpender(DeployState memory state, address spender) internal {
        if (state.assetPolicy.isApprovalSpenderAllowed(spender)) return;
        _requireBootstrapOwner(address(state.assetPolicy), state);
        state.assetPolicy.setApprovalSpenderAllowed(spender, true);
    }

    function _configureModulePolicy(DeployState memory state, address policy) internal {
        BoardroomPolicyRegistry registry = state.boardroomPolicyRegistry;
        if (!registry.isModulePolicy(policy)) {
            _requireBootstrapOwner(address(registry), state);
            registry.registerModulePolicy(policy);
        } else if (!registry.isPolicyAllowed(policy)) {
            _requireBootstrapOwner(address(registry), state);
            registry.setPolicyAllowed(policy, true);
        }
    }

    function _handoffRootOwnership(DeployState memory state) internal {
        _handoffRoot(address(state.protocolFacetRegistry), state);
        _handoffRoot(address(state.boardroomPolicyRegistry), state);
        _handoffRoot(address(state.assetPolicy), state);
        _handoffRoot(address(state.protocolFeeRouter), state);
        _handoffRoot(address(state.tokenGrantFactory), state);
    }

    function _handoffRoot(address root, DeployState memory state) internal {
        address actualOwner = IOwnableDeploymentRoot(root).owner();
        if (actualOwner == state.protocolGovernance) return;
        if (actualOwner != state.deployer) {
            revert RootOwnerMismatch(root, state.protocolGovernance, actualOwner);
        }
        IOwnableDeploymentRoot(root).transferOwnership(state.protocolGovernance);
    }

    function _requireBootstrapOwner(address root, DeployState memory state) internal view {
        address actualOwner = IOwnableDeploymentRoot(root).owner();
        if (actualOwner != state.deployer) revert RootConfigurationRequiresBootstrapOwner(root, actualOwner);
    }

    function _attestDeployment(DeployState memory state) internal view {
        _attestAddress("registry.owner", state.protocolGovernance, state.protocolFacetRegistry.owner());
        _attestAddress("policy.owner", state.protocolGovernance, state.boardroomPolicyRegistry.owner());
        _attestAddress("asset.owner", state.protocolGovernance, state.assetPolicy.owner());
        _attestAddress("feeRouter.owner", state.protocolGovernance, state.protocolFeeRouter.owner());
        _attestAddress("grantFactory.owner", state.protocolGovernance, state.tokenGrantFactory.owner());
        _attestAddress(
            "kernel.registry", address(state.protocolFacetRegistry), address(state.boardroomKernel.facetRegistry())
        );
        _attestBytes32(
            "registry.kernelSelectors",
            BoardroomKernelSelectors.selectorSetHash(),
            state.protocolFacetRegistry.kernelSelectorSetHash()
        );
        _attestBytes32(
            "kernel.selectorSet",
            BoardroomKernelSelectors.selectorSetHash(),
            state.boardroomKernel.kernelSelectorSetHash()
        );
        _attestAddress(
            "factory.registry", address(state.protocolFacetRegistry), address(state.boardroomFactory.facetRegistry())
        );
        _attestAddress(
            "factory.policyRegistry", address(state.boardroomPolicyRegistry), state.boardroomFactory.policyRegistry()
        );
        _attestAddress("factory.wrappedNative", state.wrappedNative, state.boardroomFactory.wrappedNative());
        _attestAddress("factory.kernel", address(state.boardroomKernel), state.boardroomFactory.boardroomKernelLogic());
        _attestAddress(
            "factory.payout", address(state.boardroomRedemptionPayout), state.boardroomFactory.redemptionPayoutLogic()
        );
        _attestAddress(
            "factory.governance", address(state.boardroomGovernanceLogic), state.boardroomFactory.governanceLogic()
        );
        _attestAddress("factory.market", address(state.boardroomMarketLogic), state.boardroomFactory.marketLogic());
        address controllerFactory = state.boardroomFactory.controllerFactory();
        _requireCode(controllerFactory);
        _attestAddress(
            "controllerFactory.factory",
            address(state.boardroomFactory),
            BoardroomControllerFactory(controllerFactory).boardroomFactory()
        );
        _requireCode(BoardroomControllerFactory(controllerFactory).controllerImplementation());

        _attestReleaseA(state);
        _attestModuleConfiguration(state);
    }

    function _attestReleaseA(DeployState memory state) internal view {
        _attestBytes32(
            "registry.activeHash", state.activeFacetSetHash, state.protocolFacetRegistry.activeFacetSetHash()
        );
        _attestUint("registry.activeRelease", RELEASE_A, state.protocolFacetRegistry.activeRelease());
        _attestUint("registry.storageVersion", STORAGE_VERSION_A, state.protocolFacetRegistry.activeStorageVersion());
        _attestBytes32(
            "registry.storageLayout",
            BoardroomStorageLayouts.RELEASE_A,
            state.protocolFacetRegistry.activeStorageLayoutHash()
        );
        _attestReleaseMetadata(state.protocolFacetRegistry, state.activeFacetSetHash);

        ProtocolFacetTypes.FacetSetManifest memory manifest = BoardroomRelease.releaseA(state.facets);
        bytes4[] memory publishedSelectors = state.protocolFacetRegistry.facetSetSelectors(state.activeFacetSetHash);
        _attestUint("release.selectorCount", manifest.routes.length, publishedSelectors.length);
        for (uint256 i; i < manifest.routes.length; ++i) {
            _attestReleaseRoute(state.protocolFacetRegistry, state.activeFacetSetHash, manifest.routes[i]);
        }
    }

    function _attestReleaseMetadata(ProtocolFacetRegistry registry, bytes32 facetSetHash) internal view {
        (
            bool published,
            uint64 release,
            uint64 storageVersion,
            bytes32 predecessor,
            bytes32 storageLayoutHash,
            bytes32 manifestHash,
            address migrationFacet,
            bytes4 migrationSelector,
            uint256 selectorCount
        ) = registry.facetSetMetadata(facetSetHash);
        if (!published) revert ReleaseHashMismatch(facetSetHash, bytes32(0));
        _attestUint("release.number", RELEASE_A, release);
        _attestUint("release.storageVersion", STORAGE_VERSION_A, storageVersion);
        _attestBytes32("release.predecessor", bytes32(0), predecessor);
        _attestBytes32("release.storageLayout", BoardroomStorageLayouts.RELEASE_A, storageLayoutHash);
        _attestBytes32("release.manifest", BoardroomManifestHashes.RELEASE_A, manifestHash);
        _attestAddress("release.migrationFacet", address(0), migrationFacet);
        _attestBytes32("release.migrationSelector", bytes32(0), bytes32(migrationSelector));
        bytes4[] memory selectors = registry.facetSetSelectors(facetSetHash);
        _attestUint("release.metadataSelectors", selectors.length, selectorCount);
    }

    function _attestReleaseRoute(
        ProtocolFacetRegistry registry,
        bytes32 facetSetHash,
        ProtocolFacetTypes.RouteDefinition memory definition
    ) internal view {
        {
            (address publishedFacet, bytes32 publishedCodeHash, uint8 publishedKind) =
                registry.facetSetRoute(facetSetHash, definition.selector);
            if (
                publishedFacet != definition.facet || publishedCodeHash != definition.codeHash
                    || publishedKind != uint8(definition.kind)
            ) revert ReleaseRouteMismatch(definition.selector);
        }
        {
            (address activeFacet, bytes32 activeCodeHash, uint8 activeKind, uint64 routeVersion) =
                registry.route(definition.selector);
            if (
                activeFacet != definition.facet || activeCodeHash != definition.codeHash
                    || activeKind != uint8(definition.kind) || routeVersion != STORAGE_VERSION_A
            ) revert ReleaseRouteMismatch(definition.selector);
        }
    }

    function _attestModuleConfiguration(DeployState memory state) internal view {
        _attestAddress("feeRouter.recipient", state.protocolTreasury, state.protocolFeeRouter.feeRecipient());
        _attestAddress(
            "grantFactory.recipient", address(state.protocolFeeRouter), state.tokenGrantFactory.feeRecipient()
        );
        _attestAddress("liquidity.poolManager", state.poolManager, address(state.liquidityFactory.poolManager()));
        _attestAddress(
            "liquidity.recipient", address(state.protocolFeeRouter), state.liquidityFactory.protocolFeeRecipient()
        );
        _attestAddress(
            "liquidity.boardroom", address(state.boardroomFactory), state.liquidityFactory.boardroomFactory()
        );
        _attestAddress("liquidity.hook", state.pledgeV4Hook, address(state.liquidityFactory.hook()));
        _attestBytes32("liquidity.hookSalt", state.pledgeV4HookSalt, state.liquidityFactory.hookSalt());
        _attestAddress(
            "grantFactory.boardroom", address(state.boardroomFactory), state.tokenGrantFactory.boardroomFactory()
        );
        _attestAddress(
            "rewards.boardroom", address(state.boardroomFactory), state.boardroomRewardsFactory.boardroomFactory()
        );
        _attestAddress(
            "bond.liquidityFactory", address(state.liquidityFactory), state.bondMarketFactory.liquidityFactory()
        );
        _attestAddress("bond.boardroom", address(state.boardroomFactory), state.bondMarketFactory.boardroomFactory());
        _attestAddress(
            "distribution.liquidityFactory",
            address(state.liquidityFactory),
            state.distributionFactory.liquidityFactory()
        );
        _attestAddress(
            "distribution.grants", address(state.tokenGrantFactory), state.distributionFactory.tokenGrantFactory()
        );
        _attestAddress(
            "distribution.boardroom", address(state.boardroomFactory), state.distributionFactory.boardroomFactory()
        );
        if (!state.assetPolicy.isAssetAllowed(state.wrappedNative)) {
            revert DeploymentAddressAttestationFailed(keccak256("asset.wrappedNative"), state.wrappedNative, address(0));
        }
        if (!state.boardroomPolicyRegistry.isPolicyAllowed(address(state.assetPolicy))) {
            revert DeploymentAddressAttestationFailed(
                keccak256("policy.assetAllowed"), address(state.assetPolicy), address(0)
            );
        }
        _requireModulePolicy(state, address(state.tokenGrantFactory));
        _requireModulePolicy(state, address(state.distributionFactory));
        _requireModulePolicy(state, address(state.bondMarketFactory));
        _requireModulePolicy(state, address(state.liquidityFactory));
        _requireModulePolicy(state, address(state.boardroomRewardsFactory));
    }

    function _requireModulePolicy(DeployState memory state, address module) internal view {
        if (
            !state.boardroomPolicyRegistry.isModulePolicy(module)
                || !state.boardroomPolicyRegistry.isPolicyAllowed(module)
                || !state.assetPolicy.isApprovalSpenderAllowed(module)
        ) {
            revert DeploymentAddressAttestationFailed(keccak256("module.policy"), module, address(0));
        }
    }

    function _attestAddress(bytes32 field, address expected, address actual) internal pure {
        if (actual != expected) revert DeploymentAddressAttestationFailed(field, expected, actual);
    }

    function _attestBytes32(bytes32 field, bytes32 expected, bytes32 actual) internal pure {
        if (actual != expected) revert DeploymentBytes32AttestationFailed(field, expected, actual);
    }

    function _attestUint(bytes32 field, uint256 expected, uint256 actual) internal pure {
        if (actual != expected) revert DeploymentUintAttestationFailed(field, expected, actual);
    }

    function _requireCode(address account) internal view {
        if (account.code.length == 0) revert MissingContract(account);
    }

    function _requireExternalContract(bytes32 field, address account) internal view {
        if (account == address(0) || account.code.length == 0) revert MissingUniswapV4Contract(field);
    }

    function _deploymentJson(DeployState memory state) internal returns (string memory output) {
        string memory json = "deployment";
        json.serialize("chainId", block.chainid);
        json.serialize("protocolVersion", PledgeCashDeploymentSalts.version());
        json.serialize("protocolReleaseCodeHash", PledgeCashDeploymentSalts.releaseCodeHash());
        json.serialize("deterministicDeploymentVersion", PledgeCashDeploymentSalts.version());
        json.serialize("deterministicReleaseCodeHash", PledgeCashDeploymentSalts.releaseCodeHash());
        json.serialize("deterministicDeployment", true);
        json.serialize("create2Factory", state.create2Factory);
        json.serialize("deterministicDeployer", address(state.deterministicDeployer));
        json.serialize("deterministicDeployerOwner", state.deterministicDeployerOwner);
        json.serialize("wrappedNative", state.wrappedNative);
        json.serialize("protocolGovernance", state.protocolGovernance);
        json.serialize("protocolTreasury", state.protocolTreasury);
        json.serialize("uniswapV4PoolManager", state.poolManager);
        json.serialize("uniswapUniversalRouter", state.universalRouter);
        json.serialize("uniswapV4Quoter", state.quoter);
        json.serialize("uniswapV4StateView", state.stateView);
        json.serialize("uniswapV4PositionManager", state.positionManager);
        json.serialize("permit2", state.permit2);
        _serializeProtocolAddresses(json, state);
        _serializeModuleAddresses(json, state);
        _serializeRelease(json, state);
        _serializeOwnership(json, state);
        _serializeCodeHashes(json, state);
        json.serialize("deploymentBlock", block.number);
        json.serialize("deploymentTimestamp", block.timestamp);
        output = json.serialize("deployer", state.deployer);
    }

    function _serializeProtocolAddresses(string memory json, DeployState memory state) internal {
        json.serialize("protocolFacetRegistry", address(state.protocolFacetRegistry));
        json.serialize("boardroomKernel", address(state.boardroomKernel));
        json.serialize("boardroomPolicyRegistry", address(state.boardroomPolicyRegistry));
        json.serialize("boardroomFactory", address(state.boardroomFactory));
        json.serialize("boardroomControllerFactory", state.boardroomFactory.controllerFactory());
        json.serialize(
            "boardroomControllerLogic",
            BoardroomControllerFactory(state.boardroomFactory.controllerFactory()).controllerImplementation()
        );
        json.serialize("boardroomGovernanceLogic", address(state.boardroomGovernanceLogic));
        json.serialize("boardroomRedemptionPayout", address(state.boardroomRedemptionPayout));
        json.serialize("boardroomMarketLogic", address(state.boardroomMarketLogic));
        json.serialize("authorityFacet", state.facets.authority);
        json.serialize("executionFacet", state.facets.execution);
        json.serialize("marketFacet", state.facets.market);
        json.serialize("redemptionFacet", state.facets.redemption);
        json.serialize("viewFacet", state.facets.viewFacet);
    }

    function _serializeModuleAddresses(string memory json, DeployState memory state) internal {
        json.serialize("assetPolicy", address(state.assetPolicy));
        json.serialize("protocolFeeRouter", address(state.protocolFeeRouter));
        json.serialize("tokenGrantFactory", address(state.tokenGrantFactory));
        json.serialize("tokenGrantLogic", state.tokenGrantFactory.tokenGrantLogic());
        json.serialize("pledgeV4LiquidityFactory", address(state.liquidityFactory));
        json.serialize("pledgeV4LiquidityVaultImplementation", state.liquidityFactory.vaultImplementation());
        json.serialize("pledgeV4Hook", state.pledgeV4Hook);
        json.serialize("pledgeV4HookSalt", state.pledgeV4HookSalt);
        json.serialize("distributionFactory", address(state.distributionFactory));
        json.serialize("fixedPriceSaleLogic", state.distributionFactory.fixedPriceSaleLogic());
        json.serialize("dutchAuctionLogic", state.distributionFactory.dutchAuctionLogic());
        json.serialize("migratingBondingCurveLogic", state.distributionFactory.migratingBondingCurveLogic());
        json.serialize("merkleAirdropLogic", state.distributionFactory.merkleAirdropLogic());
        json.serialize("boardroomRewardsFactory", address(state.boardroomRewardsFactory));
        json.serialize("boardroomRewardsLogic", state.boardroomRewardsFactory.rewardsLogic());
        json.serialize("bondMarketFactory", address(state.bondMarketFactory));
        json.serialize("bondMarketLogic", state.bondMarketFactory.bondMarketLogic());
    }

    function _serializeRelease(string memory json, DeployState memory state) internal {
        json.serialize("activeFacetSetHash", state.activeFacetSetHash);
        json.serialize("activeRelease", state.protocolFacetRegistry.activeRelease());
        json.serialize("requiredStorageVersion", state.protocolFacetRegistry.activeStorageVersion());
        json.serialize("requiredStorageLayoutHash", state.protocolFacetRegistry.activeStorageLayoutHash());
        json.serialize("manifestHash", BoardroomManifestHashes.RELEASE_A);
        json.serialize("kernelSelectorSetHash", BoardroomKernelSelectors.selectorSetHash());
        json.serialize("selectorCount", state.protocolFacetRegistry.facetSetSelectors(state.activeFacetSetHash).length);
    }

    function _serializeOwnership(string memory json, DeployState memory state) internal {
        json.serialize("protocolFacetRegistryOwner", state.protocolFacetRegistry.owner());
        json.serialize("boardroomPolicyRegistryOwner", state.boardroomPolicyRegistry.owner());
        json.serialize("assetPolicyOwner", state.assetPolicy.owner());
        json.serialize("protocolFeeRouterOwner", state.protocolFeeRouter.owner());
        json.serialize("tokenGrantFactoryOwner", state.tokenGrantFactory.owner());
        json.serialize("protocolFeeRouterRecipient", state.protocolFeeRouter.feeRecipient());
        json.serialize("tokenGrantFeeRecipient", state.tokenGrantFactory.feeRecipient());
        json.serialize("pledgeV4ProtocolFeeRecipient", state.liquidityFactory.protocolFeeRecipient());
        json.serialize("creationFee", state.tokenGrantFactory.creationFee());
    }

    function _serializeCodeHashes(string memory json, DeployState memory state) internal {
        json.serialize("deterministicDeployerCodeHash", address(state.deterministicDeployer).codehash);
        json.serialize("protocolFacetRegistryCodeHash", address(state.protocolFacetRegistry).codehash);
        json.serialize("boardroomKernelCodeHash", address(state.boardroomKernel).codehash);
        json.serialize("boardroomPolicyRegistryCodeHash", address(state.boardroomPolicyRegistry).codehash);
        json.serialize("boardroomFactoryCodeHash", address(state.boardroomFactory).codehash);
        json.serialize("boardroomControllerFactoryCodeHash", state.boardroomFactory.controllerFactory().codehash);
        json.serialize(
            "boardroomControllerLogicCodeHash",
            BoardroomControllerFactory(state.boardroomFactory.controllerFactory()).controllerImplementation().codehash
        );
        json.serialize("boardroomGovernanceLogicCodeHash", address(state.boardroomGovernanceLogic).codehash);
        json.serialize("boardroomRedemptionPayoutCodeHash", address(state.boardroomRedemptionPayout).codehash);
        json.serialize("boardroomMarketLogicCodeHash", address(state.boardroomMarketLogic).codehash);
        json.serialize("authorityFacetCodeHash", state.facets.authority.codehash);
        json.serialize("executionFacetCodeHash", state.facets.execution.codehash);
        json.serialize("marketFacetCodeHash", state.facets.market.codehash);
        json.serialize("redemptionFacetCodeHash", state.facets.redemption.codehash);
        json.serialize("viewFacetCodeHash", state.facets.viewFacet.codehash);
        json.serialize("assetPolicyCodeHash", address(state.assetPolicy).codehash);
        json.serialize("protocolFeeRouterCodeHash", address(state.protocolFeeRouter).codehash);
        json.serialize("tokenGrantFactoryCodeHash", address(state.tokenGrantFactory).codehash);
        json.serialize("tokenGrantLogicCodeHash", state.tokenGrantFactory.tokenGrantLogic().codehash);
        json.serialize("pledgeV4LiquidityFactoryCodeHash", address(state.liquidityFactory).codehash);
        json.serialize(
            "pledgeV4LiquidityVaultImplementationCodeHash", state.liquidityFactory.vaultImplementation().codehash
        );
        json.serialize("pledgeV4HookCodeHash", state.pledgeV4Hook.codehash);
        json.serialize("uniswapV4PoolManagerCodeHash", state.poolManager.codehash);
        json.serialize("uniswapUniversalRouterCodeHash", state.universalRouter.codehash);
        json.serialize("uniswapV4QuoterCodeHash", state.quoter.codehash);
        json.serialize("uniswapV4StateViewCodeHash", state.stateView.codehash);
        json.serialize("uniswapV4PositionManagerCodeHash", state.positionManager.codehash);
        json.serialize("permit2CodeHash", state.permit2.codehash);
        json.serialize("distributionFactoryCodeHash", address(state.distributionFactory).codehash);
        json.serialize("fixedPriceSaleLogicCodeHash", state.distributionFactory.fixedPriceSaleLogic().codehash);
        json.serialize("dutchAuctionLogicCodeHash", state.distributionFactory.dutchAuctionLogic().codehash);
        json.serialize(
            "migratingBondingCurveLogicCodeHash", state.distributionFactory.migratingBondingCurveLogic().codehash
        );
        json.serialize("merkleAirdropLogicCodeHash", state.distributionFactory.merkleAirdropLogic().codehash);
        json.serialize("boardroomRewardsFactoryCodeHash", address(state.boardroomRewardsFactory).codehash);
        json.serialize("boardroomRewardsLogicCodeHash", state.boardroomRewardsFactory.rewardsLogic().codehash);
        json.serialize("bondMarketFactoryCodeHash", address(state.bondMarketFactory).codehash);
        json.serialize("bondMarketLogicCodeHash", state.bondMarketFactory.bondMarketLogic().codehash);
        json.serialize("wrappedNativeCodeHash", state.wrappedNative.codehash);
    }

    function _logDeployment(DeployState memory state) internal view {
        console2.log("ProtocolVersion", PledgeCashDeploymentSalts.version());
        console2.log("DeterministicDeployer", address(state.deterministicDeployer));
        console2.log("ProtocolFacetRegistry", address(state.protocolFacetRegistry));
        console2.log("BoardroomKernel", address(state.boardroomKernel));
        console2.log("BoardroomFactory", address(state.boardroomFactory));
        console2.log("BoardroomControllerFactory", state.boardroomFactory.controllerFactory());
        console2.log("ProtocolGovernance", state.protocolGovernance);
        console2.log("WrappedNative", state.wrappedNative);
        console2.log("ActiveRelease", uint256(state.protocolFacetRegistry.activeRelease()));
        console2.log("ActiveStorageVersion", uint256(state.protocolFacetRegistry.activeStorageVersion()));
        console2.logBytes32(state.activeFacetSetHash);
        console2.log("Deployment chain", block.chainid);
    }
}
