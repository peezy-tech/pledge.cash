// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {AmmFactory} from "../src/amm/AmmFactory.sol";
import {AmmRouter} from "../src/amm/AmmRouter.sol";
import {AssetPolicy} from "../src/policy/AssetPolicy.sol";
import {BondMarketFactory} from "../src/bonds/BondMarketFactory.sol";
import {Boardroom} from "../src/boardroom/Boardroom.sol";
import {BoardroomController} from "../src/boardroom/BoardroomController.sol";
import {BoardroomControllerFactory} from "../src/boardroom/BoardroomControllerFactory.sol";
import {BoardroomFactory} from "../src/boardroom/BoardroomFactory.sol";
import {BoardroomGovernanceLogic} from "../src/boardroom/BoardroomGovernanceLogic.sol";
import {BoardroomMarketLogic} from "../src/boardroom/BoardroomMarketLogic.sol";
import {BoardroomPolicyRegistry} from "../src/boardroom/BoardroomPolicyRegistry.sol";
import {BoardroomRedemptionPayout} from "../src/boardroom/BoardroomRedemptionPayout.sol";
import {DistributionFactory} from "../src/distribution/DistributionFactory.sol";
import {ProtocolFeeRouter} from "../src/fees/ProtocolFeeRouter.sol";
import {LockedLiquidityFactory} from "../src/liquidity/LockedLiquidityFactory.sol";
import {PledgeCashDeploymentSalts} from "../src/deployment/PledgeCashDeploymentSalts.sol";
import {PledgeCashDeterministicDeployer} from "../src/deployment/PledgeCashDeterministicDeployer.sol";
import {TokenGrantFactory} from "../src/grants/TokenGrantFactory.sol";
import {BoardroomRewardsFactory} from "../src/rewards/BoardroomRewardsFactory.sol";

interface IOwnableDeploymentRoot {
    function owner() external view returns (address);
    function transferOwnership(address newOwner) external payable;
}

contract Deploy is Script {
    using stdJson for string;

    address internal constant DEFAULT_CREATE2_FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    error MissingWrappedNativeAddress();
    error MissingDeterministicDeployerOwner();
    error MissingProtocolGovernance();
    error MissingProtocolTreasury();
    error MissingAmmFeeManager();
    error MissingDeterministicDeployer(address deterministicDeployer);
    error DeterministicDeployerMismatch(address expected, address actual);
    error DeterministicDeployerOwnerMismatch(address expected, address actual);
    error DeterministicDeployerOperatorMismatch(address owner, address broadcaster);
    error RootOwnerMismatch(address root, address expected, address actual);
    error RootConfigurationRequiresBootstrapOwner(address root, address actualOwner);
    error DeploymentAttestationFailed(bytes32 field, address expected, address actual);

    struct DeployState {
        address deployer;
        address deterministicDeployerOwner;
        address create2Factory;
        address wrappedNative;
        address protocolGovernance;
        address protocolTreasury;
        address ammFeeManager;
        address ammProtocolFeeRecipient;
        PledgeCashDeterministicDeployer deterministicDeployer;
        BoardroomPolicyRegistry boardroomPolicyRegistry;
        AssetPolicy assetPolicy;
        ProtocolFeeRouter protocolFeeRouter;
        TokenGrantFactory tokenGrantFactory;
        AmmFactory ammFactory;
        AmmRouter ammRouter;
        LockedLiquidityFactory lockedLiquidityFactory;
        DistributionFactory distributionFactory;
        BoardroomRewardsFactory boardroomRewardsFactory;
        BondMarketFactory bondMarketFactory;
        BoardroomFactory boardroomFactory;
        BoardroomGovernanceLogic boardroomGovernanceLogic;
        BoardroomRedemptionPayout boardroomRedemptionPayout;
        Boardroom boardroomLogic;
        BoardroomControllerFactory boardroomControllerFactory;
        BoardroomController boardroomControllerLogic;
        BoardroomMarketLogic boardroomMarketLogic;
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
        state.protocolGovernance = vm.envOr("PLEDGE_CASH_PROTOCOL_GOVERNANCE", address(0));
        if (state.protocolGovernance == address(0)) revert MissingProtocolGovernance();
        state.protocolTreasury = vm.envOr("PLEDGE_CASH_PROTOCOL_TREASURY", address(0));
        if (state.protocolTreasury == address(0)) revert MissingProtocolTreasury();
        state.ammFeeManager = vm.envOr("PLEDGE_CASH_AMM_FEE_MANAGER", address(0));
        if (state.ammFeeManager == address(0)) revert MissingAmmFeeManager();

        if (deployerKey == 0) {
            vm.startBroadcast();
        } else {
            vm.startBroadcast(deployerKey);
        }

        _deployContracts(state);
        _configurePolicies(state);
        _configureCreationFee(state);
        _configureFeeAuthorities(state);
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

    function _deployContracts(DeployState memory state) internal {
        _ensureDeterministicDeployer(state);

        state.boardroomPolicyRegistry = BoardroomPolicyRegistry(
            _deployDeterministic(
                state,
                PledgeCashDeploymentSalts.boardroomPolicyRegistry(),
                abi.encodePacked(type(BoardroomPolicyRegistry).creationCode, abi.encode(state.deployer))
            )
        );
        state.assetPolicy = AssetPolicy(
            _deployDeterministic(
                state,
                PledgeCashDeploymentSalts.assetPolicy(),
                abi.encodePacked(type(AssetPolicy).creationCode, abi.encode(state.deployer, state.wrappedNative))
            )
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
        state.boardroomFactory = BoardroomFactory(
            _deployDeterministic(
                state,
                PledgeCashDeploymentSalts.boardroomFactory(),
                abi.encodePacked(
                    type(BoardroomFactory).creationCode,
                    abi.encode(
                        address(state.boardroomPolicyRegistry),
                        state.wrappedNative,
                        address(state.boardroomRedemptionPayout),
                        address(state.boardroomGovernanceLogic)
                    )
                )
            )
        );
        state.boardroomLogic = Boardroom(payable(state.boardroomFactory.boardroomLogic()));
        state.boardroomControllerFactory = BoardroomControllerFactory(state.boardroomFactory.controllerFactory());
        state.boardroomControllerLogic =
            BoardroomController(state.boardroomControllerFactory.controllerImplementation());
        state.boardroomMarketLogic = BoardroomMarketLogic(state.boardroomFactory.marketLogic());
        state.protocolFeeRouter = ProtocolFeeRouter(
            payable(_deployDeterministic(
                    state,
                    PledgeCashDeploymentSalts.protocolFeeRouter(),
                    abi.encodePacked(type(ProtocolFeeRouter).creationCode, abi.encode(state.deployer, state.deployer))
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
        state.ammFactory = AmmFactory(
            _deployDeterministic(
                state,
                PledgeCashDeploymentSalts.ammFactory(),
                abi.encodePacked(
                    type(AmmFactory).creationCode, abi.encode(state.deployer, address(state.boardroomFactory))
                )
            )
        );
        state.ammProtocolFeeRecipient = address(state.protocolFeeRouter);

        state.ammRouter = AmmRouter(
            payable(_deployDeterministic(
                    state,
                    PledgeCashDeploymentSalts.ammRouter(),
                    abi.encodePacked(
                        type(AmmRouter).creationCode, abi.encode(address(state.ammFactory), state.wrappedNative)
                    )
                ))
        );
        state.lockedLiquidityFactory = LockedLiquidityFactory(
            _deployDeterministic(
                state,
                PledgeCashDeploymentSalts.lockedLiquidityFactory(),
                abi.encodePacked(
                    type(LockedLiquidityFactory).creationCode,
                    abi.encode(address(state.ammRouter), address(state.boardroomFactory))
                )
            )
        );
        state.distributionFactory = DistributionFactory(
            _deployDeterministic(
                state,
                PledgeCashDeploymentSalts.distributionFactory(),
                abi.encodePacked(
                    type(DistributionFactory).creationCode,
                    abi.encode(address(state.lockedLiquidityFactory), address(state.tokenGrantFactory))
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
                    abi.encode(address(state.ammFactory), address(state.boardroomFactory))
                )
            )
        );
    }

    function _ensureDeterministicDeployer(DeployState memory state) internal {
        state.create2Factory = vm.envOr("CREATE2_FACTORY_ADDRESS", DEFAULT_CREATE2_FACTORY);
        address configuredDeployer = vm.envOr("PLEDGE_CASH_DETERMINISTIC_DEPLOYER", address(0));
        if (configuredDeployer != address(0)) {
            if (configuredDeployer.code.length == 0) revert MissingDeterministicDeployer(configuredDeployer);
            state.deterministicDeployer = PledgeCashDeterministicDeployer(configuredDeployer);
            _requireDeterministicDeployerOwner(state);
            return;
        }

        bytes memory initCode = abi.encodePacked(
            type(PledgeCashDeterministicDeployer).creationCode, abi.encode(state.deterministicDeployerOwner)
        );
        address expectedDeployer = vm.computeCreate2Address(
            PledgeCashDeploymentSalts.deterministicDeployer(), keccak256(initCode), state.create2Factory
        );
        if (expectedDeployer.code.length == 0) {
            state.deterministicDeployer = new PledgeCashDeterministicDeployer{
                salt: PledgeCashDeploymentSalts.deterministicDeployer()
            }(
                state.deterministicDeployerOwner
            );
            if (address(state.deterministicDeployer) != expectedDeployer) {
                revert DeterministicDeployerMismatch(expectedDeployer, address(state.deterministicDeployer));
            }
        } else {
            state.deterministicDeployer = PledgeCashDeterministicDeployer(expectedDeployer);
        }

        _requireDeterministicDeployerOwner(state);
    }

    function _requireDeterministicDeployerOwner(DeployState memory state) internal view {
        address actualOwner = state.deterministicDeployer.owner();
        if (actualOwner != state.deterministicDeployerOwner) {
            revert DeterministicDeployerOwnerMismatch(state.deterministicDeployerOwner, actualOwner);
        }
    }

    function _deployDeterministic(DeployState memory state, bytes32 salt, bytes memory initCode)
        internal
        returns (address)
    {
        return state.deterministicDeployer.deploy(salt, initCode);
    }

    function _configurePolicies(DeployState memory state) internal {
        _configureApprovalSpender(state, address(state.tokenGrantFactory));
        _configureApprovalSpender(state, address(state.distributionFactory));
        _configureApprovalSpender(state, address(state.bondMarketFactory));
        _configureApprovalSpender(state, address(state.lockedLiquidityFactory));
        _configureApprovalSpender(state, address(state.boardroomRewardsFactory));
        if (!state.boardroomPolicyRegistry.isPolicyAllowed(address(state.assetPolicy))) {
            _requireBootstrapOwner(address(state.boardroomPolicyRegistry), state);
            state.boardroomPolicyRegistry.setPolicyAllowed(address(state.assetPolicy), true);
        }
        _configureModulePolicy(state, address(state.tokenGrantFactory));
        _configureModulePolicy(state, address(state.distributionFactory));
        _configureModulePolicy(state, address(state.bondMarketFactory));
        _configureModulePolicy(state, address(state.lockedLiquidityFactory));
        _configureModulePolicy(state, address(state.boardroomRewardsFactory));
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
            return;
        }
        if (!registry.isPolicyAllowed(policy)) {
            _requireBootstrapOwner(address(registry), state);
            registry.setPolicyAllowed(policy, true);
        }
    }

    function _configureCreationFee(DeployState memory state) internal {
        uint256 creationFee = vm.envOr("TOKEN_GRANT_CREATION_FEE_WEI", uint256(0));
        if (creationFee == 0) {
            creationFee = vm.envOr("GRANT_CREATION_FEE_WEI", uint256(0));
        }
        if (state.tokenGrantFactory.creationFee() == creationFee) return;

        _requireBootstrapOwner(address(state.tokenGrantFactory), state);
        state.tokenGrantFactory.setCreationFee(creationFee);
    }

    function _configureFeeAuthorities(DeployState memory state) internal {
        if (state.protocolFeeRouter.feeRecipient() != state.protocolTreasury) {
            _requireBootstrapOwner(address(state.protocolFeeRouter), state);
            state.protocolFeeRouter.setFeeRecipient(state.protocolTreasury);
        }
        if (state.tokenGrantFactory.feeRecipient() != address(state.protocolFeeRouter)) {
            _requireBootstrapOwner(address(state.tokenGrantFactory), state);
            state.tokenGrantFactory.setFeeRecipient(address(state.protocolFeeRouter));
        }
        if (state.ammFactory.feeManager() != state.ammFeeManager) {
            _requireBootstrapOwner(address(state.ammFactory), state);
            state.ammFactory.setFeeManager(state.ammFeeManager);
        }
        if (state.ammFactory.protocolFeeRecipient() != address(state.protocolFeeRouter)) {
            _requireBootstrapOwner(address(state.ammFactory), state);
            state.ammFactory.setProtocolFeeRecipient(address(state.protocolFeeRouter));
        }
        if (state.ammFactory.liquidityRouter() != address(state.ammRouter)) {
            _requireBootstrapOwner(address(state.ammFactory), state);
            state.ammFactory.setLiquidityRouter(address(state.ammRouter));
        }
        if (state.ammFactory.reservationManager() != address(state.lockedLiquidityFactory)) {
            _requireBootstrapOwner(address(state.ammFactory), state);
            state.ammFactory.setReservationManager(address(state.lockedLiquidityFactory));
        }
    }

    function _handoffRootOwnership(DeployState memory state) internal {
        _handoffRoot(address(state.boardroomPolicyRegistry), state);
        _handoffRoot(address(state.assetPolicy), state);
        _handoffRoot(address(state.protocolFeeRouter), state);
        _handoffRoot(address(state.tokenGrantFactory), state);
        _handoffRoot(address(state.ammFactory), state);
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
        _attestAddress("registry.owner", state.protocolGovernance, state.boardroomPolicyRegistry.owner());
        _attestAddress("asset.owner", state.protocolGovernance, state.assetPolicy.owner());
        _attestAddress("feeRouter.owner", state.protocolGovernance, state.protocolFeeRouter.owner());
        _attestAddress("grantFactory.owner", state.protocolGovernance, state.tokenGrantFactory.owner());
        _attestAddress("ammFactory.owner", state.protocolGovernance, state.ammFactory.owner());
        _attestAddress("feeRouter.recipient", state.protocolTreasury, state.protocolFeeRouter.feeRecipient());
        _attestAddress(
            "grantFactory.recipient", address(state.protocolFeeRouter), state.tokenGrantFactory.feeRecipient()
        );
        _attestAddress("ammFactory.manager", state.ammFeeManager, state.ammFactory.feeManager());
        _attestAddress(
            "ammFactory.recipient", address(state.protocolFeeRouter), state.ammFactory.protocolFeeRecipient()
        );
        _attestAddress("ammFactory.router", address(state.ammRouter), state.ammFactory.liquidityRouter());
        _attestAddress("ammFactory.boardroom", address(state.boardroomFactory), state.ammFactory.boardroomFactory());
        _attestAddress(
            "ammFactory.reserveMgr", address(state.lockedLiquidityFactory), state.ammFactory.reservationManager()
        );
        _attestAddress(
            "factory.registry", address(state.boardroomPolicyRegistry), state.boardroomFactory.policyRegistry()
        );
        _attestAddress("factory.wrappedNative", state.wrappedNative, state.boardroomFactory.wrappedNative());
        _attestAddress(
            "factory.payoutLogic",
            address(state.boardroomRedemptionPayout),
            state.boardroomFactory.redemptionPayoutLogic()
        );
        _attestAddress(
            "factory.governanceLogic", address(state.boardroomGovernanceLogic), state.boardroomFactory.governanceLogic()
        );
        _attestAddress("factory.boardroomLogic", address(state.boardroomLogic), state.boardroomFactory.boardroomLogic());
        _attestAddress(
            "factory.controllerFactory",
            address(state.boardroomControllerFactory),
            state.boardroomFactory.controllerFactory()
        );
        _attestAddress("factory.marketLogic", address(state.boardroomMarketLogic), state.boardroomFactory.marketLogic());
        _attestAddress(
            "ctrlFactory.boardroomFactory",
            address(state.boardroomFactory),
            state.boardroomControllerFactory.boardroomFactory()
        );
        _attestAddress(
            "ctrlFactory.controllerLogic",
            address(state.boardroomControllerLogic),
            state.boardroomControllerFactory.controllerImplementation()
        );
        _attestAddress(
            "boardroom.payoutLogic",
            address(state.boardroomRedemptionPayout),
            state.boardroomLogic.redemptionPayoutLogic()
        );
        _attestAddress(
            "boardroom.governanceLogic", address(state.boardroomGovernanceLogic), state.boardroomLogic.governanceLogic()
        );
        _attestAddress(
            "boardroom.controllerFactory",
            address(state.boardroomControllerFactory),
            state.boardroomLogic.controllerFactory()
        );
        _attestAddress("boardroom.marketLogic", address(state.boardroomMarketLogic), state.boardroomLogic.marketLogic());
        _attestAddress(
            "locker.boardroomFactory", address(state.boardroomFactory), state.lockedLiquidityFactory.boardroomFactory()
        );
        _attestAddress(
            "grantFactory.boardroom", address(state.boardroomFactory), state.tokenGrantFactory.boardroomFactory()
        );
        _attestAddress(
            "rewardsFactory.boardroom",
            address(state.boardroomFactory),
            state.boardroomRewardsFactory.boardroomFactory()
        );
        _attestAddress("locker.ammRouter", address(state.ammRouter), state.lockedLiquidityFactory.ammRouter());
        _attestAddress("bondFactory.ammFactory", address(state.ammFactory), state.bondMarketFactory.ammFactory());
        _attestAddress(
            "bondFactory.boardroom", address(state.boardroomFactory), state.bondMarketFactory.boardroomFactory()
        );
    }

    function _attestAddress(bytes32 field, address expected, address actual) internal pure {
        if (actual != expected) revert DeploymentAttestationFailed(field, expected, actual);
    }

    function _deploymentJson(DeployState memory state) internal returns (string memory output) {
        uint256 chainId = block.chainid;
        string memory json = "deployment";
        json.serialize("chainId", chainId);
        _serializeAddresses(json, state);
        _serializePolicyState(json, state);
        _serializeOwnershipState(json, state);
        _serializeCodeHashes(json, state);
        json.serialize("deploymentBlock", block.number);
        json.serialize("deploymentTimestamp", block.timestamp);
        output = json.serialize("deployer", state.deployer);
    }

    function _serializeAddresses(string memory json, DeployState memory state) internal {
        json.serialize("deterministicDeployment", true);
        json.serialize("deterministicDeploymentVersion", PledgeCashDeploymentSalts.version());
        json.serialize("deterministicReleaseCodeHash", PledgeCashDeploymentSalts.releaseCodeHash());
        json.serialize("create2Factory", state.create2Factory);
        json.serialize("deterministicDeployer", address(state.deterministicDeployer));
        json.serialize("deterministicDeployerOwner", state.deterministicDeployerOwner);
        json.serialize("boardroomPolicyRegistry", address(state.boardroomPolicyRegistry));
        json.serialize("assetPolicy", address(state.assetPolicy));
        json.serialize("protocolFeeRouter", address(state.protocolFeeRouter));
        json.serialize("boardroomFactory", address(state.boardroomFactory));
        json.serialize("boardroomGovernanceLogic", address(state.boardroomGovernanceLogic));
        json.serialize("boardroomRedemptionPayout", address(state.boardroomRedemptionPayout));
        json.serialize("boardroomLogic", address(state.boardroomLogic));
        json.serialize("boardroomControllerFactory", address(state.boardroomControllerFactory));
        json.serialize("boardroomControllerLogic", address(state.boardroomControllerLogic));
        json.serialize("boardroomMarketLogic", address(state.boardroomMarketLogic));
        json.serialize("distributionFactory", address(state.distributionFactory));
        json.serialize("fixedPriceSaleLogic", state.distributionFactory.fixedPriceSaleLogic());
        json.serialize("dutchAuctionLogic", state.distributionFactory.dutchAuctionLogic());
        json.serialize("migratingBondingCurveLogic", state.distributionFactory.migratingBondingCurveLogic());
        json.serialize("merkleAirdropLogic", state.distributionFactory.merkleAirdropLogic());
        json.serialize("boardroomRewardsFactory", address(state.boardroomRewardsFactory));
        json.serialize("boardroomRewardsLogic", state.boardroomRewardsFactory.rewardsLogic());
        json.serialize("bondMarketFactory", address(state.bondMarketFactory));
        json.serialize("bondMarketLogic", state.bondMarketFactory.bondMarketLogic());
        json.serialize("ammFactory", address(state.ammFactory));
        json.serialize("ammPoolImplementation", state.ammFactory.poolImplementation());
        json.serialize("ammProtocolFeeRecipient", state.ammFactory.protocolFeeRecipient());
        json.serialize("wrappedNative", state.wrappedNative);
        json.serialize("ammRouter", address(state.ammRouter));
        json.serialize("lockedLiquidityFactory", address(state.lockedLiquidityFactory));
        json.serialize("lockedLiquidityLogic", state.lockedLiquidityFactory.lockedLiquidityLogic());
        json.serialize("tokenGrantFactory", address(state.tokenGrantFactory));
        json.serialize("tokenGrantLogic", state.tokenGrantFactory.tokenGrantLogic());
    }

    function _serializePolicyState(string memory json, DeployState memory state) internal {
        json.serialize("assetPolicyAllowed", state.boardroomPolicyRegistry.isPolicyAllowed(address(state.assetPolicy)));
        json.serialize("assetWrappedNativeAllowed", state.assetPolicy.isAssetAllowed(state.wrappedNative));
        json.serialize(
            "assetTokenGrantSpenderAllowed",
            state.assetPolicy.isApprovalSpenderAllowed(address(state.tokenGrantFactory))
        );
        json.serialize(
            "assetDistributionSpenderAllowed",
            state.assetPolicy.isApprovalSpenderAllowed(address(state.distributionFactory))
        );
        json.serialize(
            "assetBondMarketSpenderAllowed",
            state.assetPolicy.isApprovalSpenderAllowed(address(state.bondMarketFactory))
        );
        json.serialize(
            "assetLockedLiquiditySpenderAllowed",
            state.assetPolicy.isApprovalSpenderAllowed(address(state.lockedLiquidityFactory))
        );
        json.serialize(
            "assetBoardroomRewardsSpenderAllowed",
            state.assetPolicy.isApprovalSpenderAllowed(address(state.boardroomRewardsFactory))
        );
        json.serialize(
            "lockedLiquidityPolicyAllowed",
            state.boardroomPolicyRegistry.isPolicyAllowed(address(state.lockedLiquidityFactory))
        );
        json.serialize(
            "tokenGrantPolicyAllowed", state.boardroomPolicyRegistry.isPolicyAllowed(address(state.tokenGrantFactory))
        );
        json.serialize(
            "tokenGrantModulePolicy", state.boardroomPolicyRegistry.isModulePolicy(address(state.tokenGrantFactory))
        );
        json.serialize(
            "distributionPolicyAllowed",
            state.boardroomPolicyRegistry.isPolicyAllowed(address(state.distributionFactory))
        );
        json.serialize(
            "distributionModulePolicy", state.boardroomPolicyRegistry.isModulePolicy(address(state.distributionFactory))
        );
        json.serialize(
            "bondMarketPolicyAllowed", state.boardroomPolicyRegistry.isPolicyAllowed(address(state.bondMarketFactory))
        );
        json.serialize(
            "bondMarketModulePolicy", state.boardroomPolicyRegistry.isModulePolicy(address(state.bondMarketFactory))
        );
        json.serialize(
            "lockedLiquidityModulePolicy",
            state.boardroomPolicyRegistry.isModulePolicy(address(state.lockedLiquidityFactory))
        );
        json.serialize(
            "boardroomRewardsPolicyAllowed",
            state.boardroomPolicyRegistry.isPolicyAllowed(address(state.boardroomRewardsFactory))
        );
        json.serialize(
            "boardroomRewardsModulePolicy",
            state.boardroomPolicyRegistry.isModulePolicy(address(state.boardroomRewardsFactory))
        );
    }

    function _serializeOwnershipState(string memory json, DeployState memory state) internal {
        json.serialize("policyRegistryOwner", state.boardroomPolicyRegistry.owner());
        json.serialize("assetPolicyOwner", state.assetPolicy.owner());
        json.serialize("factoryOwner", state.tokenGrantFactory.owner());
        json.serialize("protocolGovernance", state.protocolGovernance);
        json.serialize("protocolTreasury", state.protocolTreasury);
        json.serialize("protocolFeeRouterOwner", state.protocolFeeRouter.owner());
        json.serialize("protocolFeeRouterRecipient", state.protocolFeeRouter.feeRecipient());
        json.serialize("tokenGrantFeeRecipient", state.tokenGrantFactory.feeRecipient());
        json.serialize("ammFactoryOwner", state.ammFactory.owner());
        json.serialize("ammFeeManager", state.ammFactory.feeManager());
        json.serialize("ammLiquidityRouter", state.ammFactory.liquidityRouter());
        json.serialize("ammReservationManager", state.ammFactory.reservationManager());
        json.serialize("creationFee", state.tokenGrantFactory.creationFee());
    }

    function _serializeCodeHashes(string memory json, DeployState memory state) internal {
        json.serialize("deterministicDeployerCodeHash", address(state.deterministicDeployer).codehash);
        json.serialize("boardroomPolicyRegistryCodeHash", address(state.boardroomPolicyRegistry).codehash);
        json.serialize("assetPolicyCodeHash", address(state.assetPolicy).codehash);
        json.serialize("protocolFeeRouterCodeHash", address(state.protocolFeeRouter).codehash);
        json.serialize("boardroomFactoryCodeHash", address(state.boardroomFactory).codehash);
        json.serialize("boardroomGovernanceLogicCodeHash", address(state.boardroomGovernanceLogic).codehash);
        json.serialize("boardroomRedemptionPayoutCodeHash", address(state.boardroomRedemptionPayout).codehash);
        json.serialize("boardroomLogicCodeHash", address(state.boardroomLogic).codehash);
        json.serialize("boardroomControllerFactoryCodeHash", address(state.boardroomControllerFactory).codehash);
        json.serialize("boardroomControllerCodeHash", address(state.boardroomControllerLogic).codehash);
        json.serialize("boardroomMarketLogicCodeHash", address(state.boardroomMarketLogic).codehash);
        json.serialize("tokenGrantFactoryCodeHash", address(state.tokenGrantFactory).codehash);
        json.serialize("tokenGrantLogicCodeHash", state.tokenGrantFactory.tokenGrantLogic().codehash);
        json.serialize("ammFactoryCodeHash", address(state.ammFactory).codehash);
        json.serialize("ammPoolImplementationCodeHash", state.ammFactory.poolImplementation().codehash);
        json.serialize("ammRouterCodeHash", address(state.ammRouter).codehash);
        json.serialize("lockedLiquidityFactoryCodeHash", address(state.lockedLiquidityFactory).codehash);
        json.serialize("lockedLiquidityLogicCodeHash", state.lockedLiquidityFactory.lockedLiquidityLogic().codehash);
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
        console2.log("DeterministicDeployment", true);
        console2.log("DeterministicDeploymentVersion", PledgeCashDeploymentSalts.version());
        console2.log("Create2Factory", state.create2Factory);
        console2.log("DeterministicDeployer", address(state.deterministicDeployer));
        console2.log("DeterministicDeployerOwner", state.deterministicDeployerOwner);
        console2.log("BoardroomPolicyRegistry", address(state.boardroomPolicyRegistry));
        console2.log("AssetPolicy", address(state.assetPolicy));
        console2.log("ProtocolFeeRouter", address(state.protocolFeeRouter));
        console2.log("ProtocolGovernance", state.protocolGovernance);
        console2.log("ProtocolTreasury", state.protocolTreasury);
        console2.log("BoardroomFactory", address(state.boardroomFactory));
        console2.log("BoardroomGovernanceLogic", address(state.boardroomGovernanceLogic));
        console2.log("BoardroomRedemptionPayout", address(state.boardroomRedemptionPayout));
        console2.log("BoardroomLogic", address(state.boardroomLogic));
        console2.log("BoardroomControllerFactory", address(state.boardroomControllerFactory));
        console2.log("BoardroomControllerLogic", address(state.boardroomControllerLogic));
        console2.log("BoardroomMarketLogic", address(state.boardroomMarketLogic));
        console2.log("DistributionFactory", address(state.distributionFactory));
        console2.log("BoardroomRewardsFactory", address(state.boardroomRewardsFactory));
        console2.log("BondMarketFactory", address(state.bondMarketFactory));
        console2.log("BondMarketLogic", state.bondMarketFactory.bondMarketLogic());
        console2.log("AmmFactory", address(state.ammFactory));
        console2.log("AmmFactoryOwner", state.ammFactory.owner());
        console2.log("AmmFeeManager", state.ammFactory.feeManager());
        console2.log("AmmLiquidityRouter", state.ammFactory.liquidityRouter());
        console2.log("AmmReservationManager", state.ammFactory.reservationManager());
        if (state.ammProtocolFeeRecipient != address(0)) {
            console2.log("AmmProtocolFeeRecipient", state.ammFactory.protocolFeeRecipient());
        }
        console2.log("WrappedNative", state.wrappedNative);
        console2.log("AmmRouter", address(state.ammRouter));
        console2.log("LockedLiquidityFactory", address(state.lockedLiquidityFactory));
        _logPolicyState(state);
        console2.log("TokenGrantFactory", address(state.tokenGrantFactory));
        console2.log("TokenGrantLogic", state.tokenGrantFactory.tokenGrantLogic());
        console2.log("PolicyRegistryOwner", state.boardroomPolicyRegistry.owner());
        console2.log("AssetPolicyOwner", state.assetPolicy.owner());
        console2.log(
            "TokenGrantPolicyAllowed", state.boardroomPolicyRegistry.isPolicyAllowed(address(state.tokenGrantFactory))
        );
        console2.log(
            "DistributionPolicyAllowed",
            state.boardroomPolicyRegistry.isPolicyAllowed(address(state.distributionFactory))
        );
        console2.log(
            "BondMarketPolicyAllowed", state.boardroomPolicyRegistry.isPolicyAllowed(address(state.bondMarketFactory))
        );
        console2.log("FactoryOwner", state.tokenGrantFactory.owner());
        console2.log("TokenGrantFeeRecipient", state.tokenGrantFactory.feeRecipient());
        console2.log("CreationFee", state.tokenGrantFactory.creationFee());
        console2.log("Deployment chain", block.chainid);
    }

    function _logPolicyState(DeployState memory state) internal view {
        console2.log("AssetPolicyAllowed", state.boardroomPolicyRegistry.isPolicyAllowed(address(state.assetPolicy)));
        console2.log("AssetWrappedNativeAllowed", state.assetPolicy.isAssetAllowed(state.wrappedNative));
        console2.log(
            "AssetTokenGrantSpenderAllowed",
            state.assetPolicy.isApprovalSpenderAllowed(address(state.tokenGrantFactory))
        );
        console2.log(
            "AssetDistributionSpenderAllowed",
            state.assetPolicy.isApprovalSpenderAllowed(address(state.distributionFactory))
        );
        console2.log(
            "AssetBondMarketSpenderAllowed",
            state.assetPolicy.isApprovalSpenderAllowed(address(state.bondMarketFactory))
        );
        console2.log(
            "AssetLockedLiquiditySpenderAllowed",
            state.assetPolicy.isApprovalSpenderAllowed(address(state.lockedLiquidityFactory))
        );
        console2.log(
            "AssetBoardroomRewardsSpenderAllowed",
            state.assetPolicy.isApprovalSpenderAllowed(address(state.boardroomRewardsFactory))
        );
        console2.log(
            "BoardroomRewardsPolicyAllowed",
            state.boardroomPolicyRegistry.isPolicyAllowed(address(state.boardroomRewardsFactory))
        );
        console2.log(
            "LockedLiquidityPolicyAllowed",
            state.boardroomPolicyRegistry.isPolicyAllowed(address(state.lockedLiquidityFactory))
        );
    }
}
