// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {BoardroomFactory} from "../src/boardroom/BoardroomFactory.sol";
import {PledgeCashDeploymentSalts} from "../src/deployment/PledgeCashDeploymentSalts.sol";
import {PledgeCashDeterministicDeployer} from "../src/deployment/PledgeCashDeterministicDeployer.sol";
import {ProtocolFeeRouter} from "../src/fees/ProtocolFeeRouter.sol";
import {TokenGrantFactory} from "../src/grants/TokenGrantFactory.sol";
import {IPositionManager} from "../src/uniswap/IPositionManager.sol";
import {LiquidityLockerFactory} from "../src/uniswap/LiquidityLockerFactory.sol";

interface IOwnableDeploymentRoot {
    function owner() external view returns (address);

    function transferOwnership(address newOwner) external payable;
}

/// @notice Deterministically deploys and attests the lean pledge.cash protocol roots.
/// @dev Every pledge.cash root is deployed through one CREATE3 deployer. Re-running with
/// the original deployment key is a no-op only when bytecode, constructor arguments,
/// configuration, and final owners still match the first deployment.
contract Deploy is Script {
    using stdJson for string;

    address internal constant DEFAULT_CREATE2_FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    error MissingAddress(bytes32 field);
    error MissingContract(bytes32 field, address account);
    error DeterministicDeployerMismatch(address expected, address actual);
    error DeterministicDeployerOwnerMismatch(address expected, address actual);
    error DeterministicDeployerCodeHashMismatch(bytes32 expected, bytes32 actual);
    error DeterministicDeployerOperatorMismatch(address owner, address broadcaster);
    error DeterministicAddressMismatch(bytes32 salt, address expected, address actual);
    error DeterministicInitCodeMismatch(bytes32 salt, bytes32 expected, bytes32 actual);
    error RootOwnerMismatch(address root, address expected, address actual);
    error RootConfigurationRequiresBootstrapOwner(address root, address actualOwner);
    error DeploymentAddressAttestationFailed(bytes32 field, address expected, address actual);
    error DeploymentUintAttestationFailed(bytes32 field, uint256 expected, uint256 actual);

    struct DeployState {
        address deployer;
        address deterministicDeployerOwner;
        address create2Factory;
        address wrappedNative;
        address protocolOwner;
        address protocolTreasury;
        address poolManager;
        address universalRouter;
        address quoter;
        address stateView;
        address positionManager;
        address permit2;
        uint256 creationFee;
        PledgeCashDeterministicDeployer deterministicDeployer;
        BoardroomFactory boardroomFactory;
        ProtocolFeeRouter protocolFeeRouter;
        TokenGrantFactory tokenGrantFactory;
        LiquidityLockerFactory liquidityLockerFactory;
    }

    function run() external {
        DeployState memory state = _readConfiguration();
        uint256 deployerKey = vm.envOr("PRIVATE_KEY", uint256(0));

        if (deployerKey == 0) vm.startBroadcast();
        else vm.startBroadcast(deployerKey);

        _deployRoots(state);
        _configureRoots(state);
        _handoffRoots(state);
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

    function _readConfiguration() internal view returns (DeployState memory state) {
        uint256 deployerKey = vm.envOr("PRIVATE_KEY", uint256(0));
        state.deployer = deployerKey == 0 ? msg.sender : vm.addr(deployerKey);
        state.deterministicDeployerOwner = _requiredAddress("PLEDGE_CASH_DETERMINISTIC_DEPLOYER_OWNER");
        if (state.deterministicDeployerOwner != state.deployer) {
            revert DeterministicDeployerOperatorMismatch(state.deterministicDeployerOwner, state.deployer);
        }

        state.create2Factory = vm.envOr("CREATE2_FACTORY_ADDRESS", DEFAULT_CREATE2_FACTORY);
        state.wrappedNative = _requiredContract("WRAPPED_NATIVE_ADDRESS");
        state.protocolOwner = _requiredAddress("PLEDGE_CASH_PROTOCOL_OWNER");
        state.protocolTreasury = _requiredAddress("PLEDGE_CASH_PROTOCOL_TREASURY");
        state.poolManager = _requiredContract("UNISWAP_V4_POOL_MANAGER");
        state.universalRouter = _requiredContract("UNISWAP_UNIVERSAL_ROUTER");
        state.quoter = _requiredContract("UNISWAP_V4_QUOTER");
        state.stateView = _requiredContract("UNISWAP_V4_STATE_VIEW");
        state.positionManager = _requiredContract("UNISWAP_V4_POSITION_MANAGER");
        state.permit2 = _requiredContract("PERMIT2_ADDRESS");
        state.creationFee = vm.envOr("TOKEN_GRANT_CREATION_FEE_WEI", uint256(0));
    }

    function _deployRoots(DeployState memory state) internal {
        _ensureDeterministicDeployer(state);

        state.boardroomFactory = BoardroomFactory(
            _deployDeterministic(
                state,
                PledgeCashDeploymentSalts.boardroomFactory(),
                abi.encodePacked(type(BoardroomFactory).creationCode, abi.encode(state.wrappedNative))
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
        state.liquidityLockerFactory = LiquidityLockerFactory(
            _deployDeterministic(
                state,
                PledgeCashDeploymentSalts.liquidityLockerFactory(),
                abi.encodePacked(
                    type(LiquidityLockerFactory).creationCode,
                    abi.encode(
                        address(state.boardroomFactory),
                        IPositionManager(state.positionManager),
                        address(state.protocolFeeRouter)
                    )
                )
            )
        );
    }

    function _ensureDeterministicDeployer(DeployState memory state) internal {
        bytes memory initCode = abi.encodePacked(
            type(PledgeCashDeterministicDeployer).creationCode, abi.encode(state.deterministicDeployerOwner)
        );
        bytes32 salt = PledgeCashDeploymentSalts.deterministicDeployer();
        address expected = vm.computeCreate2Address(salt, keccak256(initCode), state.create2Factory);

        if (expected.code.length == 0) {
            state.deterministicDeployer =
                new PledgeCashDeterministicDeployer{salt: salt}(state.deterministicDeployerOwner);
            if (address(state.deterministicDeployer) != expected) {
                revert DeterministicDeployerMismatch(expected, address(state.deterministicDeployer));
            }
        } else {
            state.deterministicDeployer = PledgeCashDeterministicDeployer(expected);
        }

        bytes32 expectedCodeHash = keccak256(type(PledgeCashDeterministicDeployer).runtimeCode);
        if (expected.codehash != expectedCodeHash) {
            revert DeterministicDeployerCodeHashMismatch(expectedCodeHash, expected.codehash);
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
        if (deployed.code.length == 0) revert MissingContract("root", deployed);
        bytes32 actualInitCodeHash = state.deterministicDeployer.initCodeHashForSalt(salt);
        if (actualInitCodeHash != expectedInitCodeHash) {
            revert DeterministicInitCodeMismatch(salt, expectedInitCodeHash, actualInitCodeHash);
        }
    }

    function _configureRoots(DeployState memory state) internal {
        if (state.protocolFeeRouter.feeRecipient() != state.protocolTreasury) {
            _requireBootstrapOwner(address(state.protocolFeeRouter), state);
            state.protocolFeeRouter.setFeeRecipient(state.protocolTreasury);
        }
        if (state.tokenGrantFactory.feeRecipient() != address(state.protocolFeeRouter)) {
            _requireBootstrapOwner(address(state.tokenGrantFactory), state);
            state.tokenGrantFactory.setFeeRecipient(address(state.protocolFeeRouter));
        }
        if (state.tokenGrantFactory.creationFee() != state.creationFee) {
            _requireBootstrapOwner(address(state.tokenGrantFactory), state);
            state.tokenGrantFactory.setCreationFee(state.creationFee);
        }
    }

    function _handoffRoots(DeployState memory state) internal {
        _handoffRoot(address(state.protocolFeeRouter), state);
        _handoffRoot(address(state.tokenGrantFactory), state);
    }

    function _handoffRoot(address root, DeployState memory state) internal {
        address actualOwner = IOwnableDeploymentRoot(root).owner();
        if (actualOwner == state.protocolOwner) return;
        if (actualOwner != state.deployer) revert RootOwnerMismatch(root, state.protocolOwner, actualOwner);
        IOwnableDeploymentRoot(root).transferOwnership(state.protocolOwner);
    }

    function _requireBootstrapOwner(address root, DeployState memory state) internal view {
        address actualOwner = IOwnableDeploymentRoot(root).owner();
        if (actualOwner != state.deployer) revert RootConfigurationRequiresBootstrapOwner(root, actualOwner);
    }

    function _attestDeployment(DeployState memory state) internal view {
        _attestAddress("deployer.owner", state.deterministicDeployerOwner, state.deterministicDeployer.owner());
        _attestAddress("boardroom.wrapped", state.wrappedNative, state.boardroomFactory.wrappedNative());
        _attestAddress("fee.owner", state.protocolOwner, state.protocolFeeRouter.owner());
        _attestAddress("fee.recipient", state.protocolTreasury, state.protocolFeeRouter.feeRecipient());
        _attestAddress("grant.owner", state.protocolOwner, state.tokenGrantFactory.owner());
        _attestAddress("grant.boardroom", address(state.boardroomFactory), state.tokenGrantFactory.boardroomFactory());
        _attestAddress("grant.recipient", address(state.protocolFeeRouter), state.tokenGrantFactory.feeRecipient());
        _attestUint("grant.fee", state.creationFee, state.tokenGrantFactory.creationFee());
        _attestAddress(
            "locker.boardroom", address(state.boardroomFactory), state.liquidityLockerFactory.boardroomFactory()
        );
        _attestAddress(
            "locker.positionManager", state.positionManager, address(state.liquidityLockerFactory.positionManager())
        );
        _attestAddress(
            "locker.feeRouter", address(state.protocolFeeRouter), state.liquidityLockerFactory.protocolFeeRouter()
        );

        _requireCode("boardroom.implementation", state.boardroomFactory.boardroomImplementation());
        _requireCode("grant.logic", state.tokenGrantFactory.tokenGrantLogic());
    }

    function _deploymentJson(DeployState memory state) internal returns (string memory output) {
        string memory json = "deployment";
        bytes32 releaseCodeHash = PledgeCashDeploymentSalts.releaseCodeHash();
        json.serialize("chainId", block.chainid);
        json.serialize("protocolVersion", PledgeCashDeploymentSalts.version());
        json.serialize("releaseCodeHash", releaseCodeHash);
        json.serialize("deterministicDeployer", address(state.deterministicDeployer));
        json.serialize("deterministicDeployerOwner", state.deterministicDeployerOwner);
        json.serialize("create2Factory", state.create2Factory);
        json.serialize("boardroomFactory", address(state.boardroomFactory));
        json.serialize("boardroomImplementation", state.boardroomFactory.boardroomImplementation());
        json.serialize("manifestHash", _manifestHash(state));
        json.serialize("boardroomArchitectureCodeHash", PledgeCashDeploymentSalts.boardroomArchitectureCodeHash());
        json.serialize("moduleArchitectureCodeHash", PledgeCashDeploymentSalts.moduleArchitectureCodeHash());
        json.serialize("protocolFeeRouter", address(state.protocolFeeRouter));
        json.serialize("uniswapV4PoolManager", state.poolManager);
        json.serialize("uniswapUniversalRouter", state.universalRouter);
        json.serialize("uniswapV4Quoter", state.quoter);
        json.serialize("uniswapV4StateView", state.stateView);
        json.serialize("uniswapV4PositionManager", state.positionManager);
        json.serialize("permit2", state.permit2);
        json.serialize("liquidityLockerFactory", address(state.liquidityLockerFactory));
        json.serialize("tokenGrantFactory", address(state.tokenGrantFactory));
        json.serialize("tokenGrantLogic", state.tokenGrantFactory.tokenGrantLogic());
        json.serialize("wrappedNative", state.wrappedNative);
        json.serialize("protocolOwner", state.protocolOwner);
        json.serialize("protocolTreasury", state.protocolTreasury);
        json.serialize("creationFee", state.tokenGrantFactory.creationFee());
        json.serialize("deploymentBlock", block.number);
        json.serialize("deterministicDeployerCodeHash", address(state.deterministicDeployer).codehash);
        json.serialize("protocolFeeRouterCodeHash", address(state.protocolFeeRouter).codehash);
        json.serialize("boardroomFactoryCodeHash", address(state.boardroomFactory).codehash);
        json.serialize("boardroomImplementationCodeHash", state.boardroomFactory.boardroomImplementation().codehash);
        json.serialize("tokenGrantFactoryCodeHash", address(state.tokenGrantFactory).codehash);
        json.serialize("tokenGrantLogicCodeHash", state.tokenGrantFactory.tokenGrantLogic().codehash);
        json.serialize("liquidityLockerFactoryCodeHash", address(state.liquidityLockerFactory).codehash);
        json.serialize("uniswapV4PoolManagerCodeHash", state.poolManager.codehash);
        json.serialize("uniswapUniversalRouterCodeHash", state.universalRouter.codehash);
        json.serialize("uniswapV4QuoterCodeHash", state.quoter.codehash);
        json.serialize("uniswapV4StateViewCodeHash", state.stateView.codehash);
        json.serialize("uniswapV4PositionManagerCodeHash", state.positionManager.codehash);
        json.serialize("permit2CodeHash", state.permit2.codehash);
        output = json.serialize("wrappedNativeCodeHash", state.wrappedNative.codehash);
    }

    function _manifestHash(DeployState memory state) internal view returns (bytes32) {
        bytes32 externalHash = keccak256(
            abi.encode(
                state.create2Factory,
                state.wrappedNative,
                state.poolManager,
                state.universalRouter,
                state.quoter,
                state.stateView,
                state.positionManager,
                state.permit2
            )
        );
        bytes32 rootsHash = keccak256(
            abi.encode(
                address(state.deterministicDeployer),
                address(state.boardroomFactory),
                address(state.protocolFeeRouter),
                address(state.tokenGrantFactory),
                address(state.liquidityLockerFactory)
            )
        );
        bytes32 authorityHash = keccak256(
            abi.encode(state.deterministicDeployerOwner, state.protocolOwner, state.protocolTreasury, state.creationFee)
        );
        return keccak256(
            abi.encode(
                PledgeCashDeploymentSalts.releaseCodeHash(), block.chainid, externalHash, rootsHash, authorityHash
            )
        );
    }

    function _requiredAddress(string memory variableName) internal view returns (address account) {
        account = vm.envOr(variableName, address(0));
        if (account == address(0)) revert MissingAddress(keccak256(bytes(variableName)));
    }

    function _requiredContract(string memory variableName) internal view returns (address account) {
        account = _requiredAddress(variableName);
        _requireCode(keccak256(bytes(variableName)), account);
    }

    function _requireCode(bytes32 field, address account) internal view {
        if (account.code.length == 0) revert MissingContract(field, account);
    }

    function _attestAddress(bytes32 field, address expected, address actual) internal pure {
        if (actual != expected) revert DeploymentAddressAttestationFailed(field, expected, actual);
    }

    function _attestUint(bytes32 field, uint256 expected, uint256 actual) internal pure {
        if (actual != expected) revert DeploymentUintAttestationFailed(field, expected, actual);
    }

    function _logDeployment(DeployState memory state) internal view {
        console2.log("ProtocolVersion", PledgeCashDeploymentSalts.version());
        console2.log("DeterministicDeployer", address(state.deterministicDeployer));
        console2.log("BoardroomFactory", address(state.boardroomFactory));
        console2.log("TokenGrantFactory", address(state.tokenGrantFactory));
        console2.log("LiquidityLockerFactory", address(state.liquidityLockerFactory));
        console2.log("ProtocolFeeRouter", address(state.protocolFeeRouter));
        console2.log("ProtocolOwner", state.protocolOwner);
        console2.log("Deployment chain", block.chainid);
    }
}
