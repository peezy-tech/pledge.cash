// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "solady/auth/Ownable.sol";
import {WETH} from "solady/tokens/WETH.sol";
import {CREATE3} from "solady/utils/CREATE3.sol";
import {AmmFactory} from "../../src/amm/AmmFactory.sol";
import {AmmRouter} from "../../src/amm/AmmRouter.sol";
import {AssetPolicy} from "../../src/policy/AssetPolicy.sol";
import {Boardroom} from "../../src/boardroom/Boardroom.sol";
import {BoardroomFactory} from "../../src/boardroom/BoardroomFactory.sol";
import {BoardroomGovernanceLogic} from "../../src/boardroom/BoardroomGovernanceLogic.sol";
import {BoardroomPolicyRegistry} from "../../src/boardroom/BoardroomPolicyRegistry.sol";
import {BoardroomRedemptionPayout} from "../../src/boardroom/BoardroomRedemptionPayout.sol";
import {DistributionFactory} from "../../src/distribution/DistributionFactory.sol";
import {ProtocolFeeRouter} from "../../src/fees/ProtocolFeeRouter.sol";
import {LockedLiquidityFactory} from "../../src/liquidity/LockedLiquidityFactory.sol";
import {PledgeCashDeploymentSalts} from "../../src/deployment/PledgeCashDeploymentSalts.sol";
import {PledgeCashDeterministicDeployer} from "../../src/deployment/PledgeCashDeterministicDeployer.sol";
import {TokenGrantFactory} from "../../src/grants/TokenGrantFactory.sol";

contract DeterministicDeploymentTest is Test {
    address internal owner = address(0xA11CE);
    address internal stranger = address(0xB0B);

    PledgeCashDeterministicDeployer internal deployer;
    WETH internal wrappedNative;
    BoardroomFactory internal canonicalBoardroomFactory;
    BoardroomGovernanceLogic internal governanceLogic;
    BoardroomRedemptionPayout internal redemptionPayoutLogic;

    function setUp() public {
        deployer = new PledgeCashDeterministicDeployer(owner);
        wrappedNative = new WETH();
        governanceLogic = new BoardroomGovernanceLogic();
        redemptionPayoutLogic = new BoardroomRedemptionPayout();
        canonicalBoardroomFactory = new BoardroomFactory(
            address(1), address(wrappedNative), address(redemptionPayoutLogic), address(governanceLogic)
        );
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
        bytes memory initCode = abi.encodePacked(
            type(TokenGrantFactory).creationCode, abi.encode(owner, address(canonicalBoardroomFactory))
        );

        vm.prank(stranger);
        vm.expectRevert(Ownable.Unauthorized.selector);
        deployer.deploy(PledgeCashDeploymentSalts.tokenGrantFactory(), initCode);
    }

    function testCreate3PredictionDoesNotDependOnConstructorArguments() public view {
        bytes memory initCodeA = abi.encodePacked(
            type(BoardroomFactory).creationCode,
            abi.encode(address(1), address(2), address(redemptionPayoutLogic), address(governanceLogic))
        );
        bytes memory initCodeB = abi.encodePacked(
            type(BoardroomFactory).creationCode,
            abi.encode(address(3), address(4), address(redemptionPayoutLogic), address(governanceLogic))
        );
        bytes32 salt = PledgeCashDeploymentSalts.boardroomFactory();

        assertNotEq(keccak256(initCodeA), keccak256(initCodeB));
        assertEq(deployer.predict(salt), CREATE3.predictDeterministicAddress(salt, address(deployer)));
    }

    function testCreate3DeploymentDoesNotDependOnConstructorArguments() public {
        bytes memory initCodeA = abi.encodePacked(
            type(BoardroomFactory).creationCode,
            abi.encode(address(1), address(2), address(redemptionPayoutLogic), address(governanceLogic))
        );
        bytes memory initCodeB = abi.encodePacked(
            type(BoardroomFactory).creationCode,
            abi.encode(address(3), address(4), address(redemptionPayoutLogic), address(governanceLogic))
        );
        bytes32 salt = PledgeCashDeploymentSalts.boardroomFactory();

        uint256 snapshotId = vm.snapshotState();
        address deployedA = _deploy(salt, initCodeA);

        assertTrue(vm.revertToState(snapshotId));
        address deployedB = _deploy(salt, initCodeB);

        assertEq(deployedA, deployedB);
    }

    function testV4RootSaltsAreMechanicallyCoupledToCreationCode() public pure {
        assertEq(PledgeCashDeploymentSalts.version(), "pledge.cash.deterministic.v4");
        assertEq(
            PledgeCashDeploymentSalts.boardroomPolicyRegistry(),
            _releaseSalt("BoardroomPolicyRegistry", keccak256(type(BoardroomPolicyRegistry).creationCode))
        );
        assertEq(
            PledgeCashDeploymentSalts.assetPolicy(),
            _releaseSalt("AssetPolicy", keccak256(type(AssetPolicy).creationCode))
        );
        assertEq(
            PledgeCashDeploymentSalts.boardroomGovernanceLogic(),
            _releaseSalt("BoardroomGovernanceLogic", keccak256(type(BoardroomGovernanceLogic).creationCode))
        );
        assertEq(
            PledgeCashDeploymentSalts.boardroomRedemptionPayout(),
            _releaseSalt("BoardroomRedemptionPayout", keccak256(type(BoardroomRedemptionPayout).creationCode))
        );
        assertEq(
            PledgeCashDeploymentSalts.protocolFeeRouter(),
            _releaseSalt("ProtocolFeeRouter", keccak256(type(ProtocolFeeRouter).creationCode))
        );
        assertEq(
            PledgeCashDeploymentSalts.tokenGrantFactory(),
            _releaseSalt("TokenGrantFactory", keccak256(type(TokenGrantFactory).creationCode))
        );
        assertEq(
            PledgeCashDeploymentSalts.ammFactory(), _releaseSalt("AmmFactory", keccak256(type(AmmFactory).creationCode))
        );
        assertEq(
            PledgeCashDeploymentSalts.ammRouter(), _releaseSalt("AmmRouter", keccak256(type(AmmRouter).creationCode))
        );
        assertEq(
            PledgeCashDeploymentSalts.lockedLiquidityFactory(),
            _releaseSalt("LockedLiquidityFactory", keccak256(type(LockedLiquidityFactory).creationCode))
        );
        assertEq(
            PledgeCashDeploymentSalts.distributionFactory(),
            _releaseSalt("DistributionFactory", keccak256(type(DistributionFactory).creationCode))
        );
        assertEq(
            PledgeCashDeploymentSalts.boardroomFactory(),
            _releaseSalt("BoardroomFactory", keccak256(type(BoardroomFactory).creationCode))
        );
        assertEq(
            PledgeCashDeploymentSalts.releaseCodeHash(),
            keccak256(
                abi.encode(
                    keccak256(type(BoardroomPolicyRegistry).creationCode),
                    keccak256(type(AssetPolicy).creationCode),
                    keccak256(type(BoardroomGovernanceLogic).creationCode),
                    keccak256(type(BoardroomRedemptionPayout).creationCode),
                    keccak256(type(ProtocolFeeRouter).creationCode),
                    keccak256(type(TokenGrantFactory).creationCode),
                    keccak256(type(AmmFactory).creationCode),
                    keccak256(type(AmmRouter).creationCode),
                    keccak256(type(LockedLiquidityFactory).creationCode),
                    keccak256(type(DistributionFactory).creationCode),
                    keccak256(type(BoardroomFactory).creationCode)
                )
            )
        );

        assertNotEq(PledgeCashDeploymentSalts.assetPolicy(), keccak256("pledge.cash.deterministic.v1.AssetPolicy"));
        assertNotEq(PledgeCashDeploymentSalts.ammFactory(), keccak256("pledge.cash.deterministic.v1.AmmFactory"));
        assertNotEq(PledgeCashDeploymentSalts.ammRouter(), keccak256("pledge.cash.deterministic.v1.AmmRouter"));
    }

    function testDeploysFullRootStackAtPredictedAddresses() public {
        BoardroomPolicyRegistry policyRegistry = BoardroomPolicyRegistry(
            _deploy(
                PledgeCashDeploymentSalts.boardroomPolicyRegistry(),
                abi.encodePacked(type(BoardroomPolicyRegistry).creationCode, abi.encode(owner))
            )
        );
        AssetPolicy assetPolicy = AssetPolicy(
            _deploy(
                PledgeCashDeploymentSalts.assetPolicy(),
                abi.encodePacked(type(AssetPolicy).creationCode, abi.encode(owner, address(wrappedNative)))
            )
        );
        BoardroomGovernanceLogic deployedGovernanceLogic = BoardroomGovernanceLogic(
            _deploy(PledgeCashDeploymentSalts.boardroomGovernanceLogic(), type(BoardroomGovernanceLogic).creationCode)
        );
        BoardroomRedemptionPayout deployedRedemptionPayout = BoardroomRedemptionPayout(
            _deploy(PledgeCashDeploymentSalts.boardroomRedemptionPayout(), type(BoardroomRedemptionPayout).creationCode)
        );
        BoardroomFactory boardroomFactory = BoardroomFactory(
            _deploy(
                PledgeCashDeploymentSalts.boardroomFactory(),
                abi.encodePacked(
                    type(BoardroomFactory).creationCode,
                    abi.encode(
                        address(policyRegistry),
                        address(wrappedNative),
                        address(deployedRedemptionPayout),
                        address(deployedGovernanceLogic)
                    )
                )
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
        AmmFactory ammFactory = AmmFactory(
            _deploy(
                PledgeCashDeploymentSalts.ammFactory(),
                abi.encodePacked(type(AmmFactory).creationCode, abi.encode(owner, address(boardroomFactory)))
            )
        );
        AmmRouter ammRouter = AmmRouter(
            payable(_deploy(
                    PledgeCashDeploymentSalts.ammRouter(),
                    abi.encodePacked(
                        type(AmmRouter).creationCode, abi.encode(address(ammFactory), address(wrappedNative))
                    )
                ))
        );
        LockedLiquidityFactory lockedLiquidityFactory = LockedLiquidityFactory(
            _deploy(
                PledgeCashDeploymentSalts.lockedLiquidityFactory(),
                abi.encodePacked(
                    type(LockedLiquidityFactory).creationCode, abi.encode(address(ammRouter), address(boardroomFactory))
                )
            )
        );
        DistributionFactory distributionFactory = DistributionFactory(
            _deploy(
                PledgeCashDeploymentSalts.distributionFactory(),
                abi.encodePacked(
                    type(DistributionFactory).creationCode,
                    abi.encode(address(lockedLiquidityFactory), address(tokenGrantFactory))
                )
            )
        );
        assertEq(policyRegistry.owner(), owner);
        assertEq(assetPolicy.owner(), owner);
        assertEq(tokenGrantFactory.owner(), owner);
        assertEq(tokenGrantFactory.feeRecipient(), owner);
        assertEq(tokenGrantFactory.boardroomFactory(), address(boardroomFactory));
        assertEq(protocolFeeRouter.owner(), owner);
        assertEq(protocolFeeRouter.feeRecipient(), owner);
        assertEq(ammFactory.owner(), owner);
        assertEq(ammFactory.feeManager(), owner);
        assertEq(ammFactory.boardroomFactory(), address(boardroomFactory));
        assertEq(ammRouter.factory(), address(ammFactory));
        assertEq(ammRouter.wrappedNative(), address(wrappedNative));
        assertEq(lockedLiquidityFactory.ammRouter(), address(ammRouter));
        assertEq(lockedLiquidityFactory.boardroomFactory(), address(boardroomFactory));
        assertEq(distributionFactory.lockedLiquidityFactory(), address(lockedLiquidityFactory));
        assertEq(boardroomFactory.policyRegistry(), address(policyRegistry));
        assertEq(boardroomFactory.wrappedNative(), address(wrappedNative));
        assertEq(boardroomFactory.redemptionPayoutLogic(), address(deployedRedemptionPayout));
        assertEq(boardroomFactory.governanceLogic(), address(deployedGovernanceLogic));
        Boardroom boardroomLogic = Boardroom(payable(boardroomFactory.boardroomLogic()));
        assertGt(address(boardroomLogic).code.length, 0);
        assertEq(boardroomLogic.redemptionPayoutLogic(), address(deployedRedemptionPayout));
        assertEq(boardroomLogic.governanceLogic(), address(deployedGovernanceLogic));

        vm.startPrank(owner);
        tokenGrantFactory.setFeeRecipient(address(protocolFeeRouter));
        ammFactory.setProtocolFeeRecipient(address(protocolFeeRouter));
        assetPolicy.setApprovalSpenderAllowed(address(tokenGrantFactory), true);
        policyRegistry.registerModulePolicy(address(tokenGrantFactory));
        vm.stopPrank();

        assertTrue(assetPolicy.isApprovalSpenderAllowed(address(tokenGrantFactory)));
        assertTrue(policyRegistry.isPolicyAllowed(address(tokenGrantFactory)));
        assertTrue(policyRegistry.isModulePolicy(address(tokenGrantFactory)));
        assertEq(tokenGrantFactory.feeRecipient(), address(protocolFeeRouter));
        assertEq(ammFactory.protocolFeeRecipient(), address(protocolFeeRouter));
    }

    function testRepeatedDeployReturnsExistingAddress() public {
        bytes memory initCode = abi.encodePacked(
            type(TokenGrantFactory).creationCode, abi.encode(owner, address(canonicalBoardroomFactory))
        );
        bytes32 salt = PledgeCashDeploymentSalts.tokenGrantFactory();
        address predicted = deployer.predict(salt);

        address first = _deploy(salt, initCode);
        address second = _deploy(salt, initCode);

        assertEq(first, predicted);
        assertEq(second, predicted);
    }

    function testRepeatedDeployRejectsMismatchedInitCode() public {
        bytes memory initCode = abi.encodePacked(
            type(TokenGrantFactory).creationCode, abi.encode(owner, address(canonicalBoardroomFactory))
        );
        bytes memory mismatchedInitCode = abi.encodePacked(
            type(TokenGrantFactory).creationCode, abi.encode(stranger, address(canonicalBoardroomFactory))
        );
        bytes32 salt = PledgeCashDeploymentSalts.tokenGrantFactory();

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

    function _deploy(bytes32 salt, bytes memory initCode) internal returns (address deployed) {
        address predicted = deployer.predict(salt);

        vm.prank(owner);
        deployed = deployer.deploy(salt, initCode);

        assertEq(deployed, predicted);
        assertEq(deployer.initCodeHashForSalt(salt), keccak256(initCode));
        assertGt(deployed.code.length, 0);
    }

    function _releaseSalt(string memory contractName, bytes32 creationCodeHash) internal pure returns (bytes32) {
        return keccak256(abi.encode("pledge.cash.deterministic.v4", contractName, creationCodeHash));
    }
}
