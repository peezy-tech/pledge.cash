// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "solady/auth/Ownable.sol";
import {WETH} from "solady/tokens/WETH.sol";
import {CREATE3} from "solady/utils/CREATE3.sol";
import {AmmFactory} from "../src/AmmFactory.sol";
import {AmmRouter} from "../src/AmmRouter.sol";
import {AssetPolicy} from "../src/AssetPolicy.sol";
import {BoardroomFactory} from "../src/BoardroomFactory.sol";
import {BoardroomPolicyRegistry} from "../src/BoardroomPolicyRegistry.sol";
import {DistributionFactory} from "../src/DistributionFactory.sol";
import {LockedLiquidityFactory} from "../src/LockedLiquidityFactory.sol";
import {PledgeCashDeploymentSalts} from "../src/PledgeCashDeploymentSalts.sol";
import {PledgeCashDeterministicDeployer} from "../src/PledgeCashDeterministicDeployer.sol";
import {ProtocolPolicy} from "../src/ProtocolPolicy.sol";
import {TokenGrantFactory} from "../src/TokenGrantFactory.sol";

contract DeterministicDeploymentTest is Test {
    address internal owner = address(0xA11CE);
    address internal stranger = address(0xB0B);

    PledgeCashDeterministicDeployer internal deployer;
    WETH internal wrappedNative;

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

    function testOnlyOwnerCanDeployDeterministicContracts() public {
        bytes memory initCode = abi.encodePacked(type(TokenGrantFactory).creationCode, abi.encode(owner));

        vm.prank(stranger);
        vm.expectRevert(Ownable.Unauthorized.selector);
        deployer.deploy(PledgeCashDeploymentSalts.tokenGrantFactory(), initCode);
    }

    function testCreate3PredictionDoesNotDependOnConstructorArguments() public view {
        bytes memory initCodeA =
            abi.encodePacked(type(BoardroomFactory).creationCode, abi.encode(address(1), address(2)));
        bytes memory initCodeB =
            abi.encodePacked(type(BoardroomFactory).creationCode, abi.encode(address(3), address(4)));
        bytes32 salt = PledgeCashDeploymentSalts.boardroomFactory();

        assertNotEq(keccak256(initCodeA), keccak256(initCodeB));
        assertEq(deployer.predict(salt), CREATE3.predictDeterministicAddress(salt, address(deployer)));
    }

    function testCreate3DeploymentDoesNotDependOnConstructorArguments() public {
        bytes memory initCodeA =
            abi.encodePacked(type(BoardroomFactory).creationCode, abi.encode(address(1), address(2)));
        bytes memory initCodeB =
            abi.encodePacked(type(BoardroomFactory).creationCode, abi.encode(address(3), address(4)));
        bytes32 salt = PledgeCashDeploymentSalts.boardroomFactory();

        uint256 snapshotId = vm.snapshotState();
        address deployedA = _deploy(salt, initCodeA);

        assertTrue(vm.revertToState(snapshotId));
        address deployedB = _deploy(salt, initCodeB);

        assertEq(deployedA, deployedB);
    }

    function testDeploysFullRootStackAtPredictedAddresses() public {
        BoardroomPolicyRegistry policyRegistry = BoardroomPolicyRegistry(
            _deploy(
                PledgeCashDeploymentSalts.boardroomPolicyRegistry(),
                abi.encodePacked(type(BoardroomPolicyRegistry).creationCode, abi.encode(owner))
            )
        );
        ProtocolPolicy protocolPolicy = ProtocolPolicy(
            _deploy(
                PledgeCashDeploymentSalts.protocolPolicy(),
                abi.encodePacked(type(ProtocolPolicy).creationCode, abi.encode(owner))
            )
        );
        AssetPolicy assetPolicy = AssetPolicy(
            _deploy(
                PledgeCashDeploymentSalts.assetPolicy(),
                abi.encodePacked(type(AssetPolicy).creationCode, abi.encode(owner, address(wrappedNative)))
            )
        );
        TokenGrantFactory tokenGrantFactory = TokenGrantFactory(
            _deploy(
                PledgeCashDeploymentSalts.tokenGrantFactory(),
                abi.encodePacked(type(TokenGrantFactory).creationCode, abi.encode(owner))
            )
        );
        AmmFactory ammFactory = AmmFactory(
            _deploy(
                PledgeCashDeploymentSalts.ammFactory(),
                abi.encodePacked(type(AmmFactory).creationCode, abi.encode(owner))
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
                abi.encodePacked(type(LockedLiquidityFactory).creationCode, abi.encode(address(ammRouter)))
            )
        );
        DistributionFactory distributionFactory = DistributionFactory(
            _deploy(
                PledgeCashDeploymentSalts.distributionFactory(),
                abi.encodePacked(type(DistributionFactory).creationCode, abi.encode(address(lockedLiquidityFactory)))
            )
        );
        BoardroomFactory boardroomFactory = BoardroomFactory(
            _deploy(
                PledgeCashDeploymentSalts.boardroomFactory(),
                abi.encodePacked(
                    type(BoardroomFactory).creationCode, abi.encode(address(policyRegistry), address(wrappedNative))
                )
            )
        );

        assertEq(policyRegistry.owner(), owner);
        assertEq(protocolPolicy.owner(), owner);
        assertEq(assetPolicy.owner(), owner);
        assertEq(tokenGrantFactory.owner(), owner);
        assertEq(ammFactory.feeManager(), owner);
        assertEq(ammRouter.factory(), address(ammFactory));
        assertEq(ammRouter.wrappedNative(), address(wrappedNative));
        assertEq(lockedLiquidityFactory.ammRouter(), address(ammRouter));
        assertEq(distributionFactory.lockedLiquidityFactory(), address(lockedLiquidityFactory));
        assertEq(boardroomFactory.policyRegistry(), address(policyRegistry));
        assertEq(boardroomFactory.wrappedNative(), address(wrappedNative));

        vm.startPrank(owner);
        protocolPolicy.setProtocolTargetAllowed(address(tokenGrantFactory), true);
        assetPolicy.setApprovalSpenderAllowed(address(tokenGrantFactory), true);
        policyRegistry.setPolicyAllowed(address(protocolPolicy), true);
        vm.stopPrank();

        assertTrue(protocolPolicy.isProtocolTargetAllowed(address(tokenGrantFactory)));
        assertTrue(assetPolicy.isApprovalSpenderAllowed(address(tokenGrantFactory)));
        assertTrue(policyRegistry.isPolicyAllowed(address(protocolPolicy)));
    }

    function testRepeatedDeployReturnsExistingAddress() public {
        bytes memory initCode = abi.encodePacked(type(TokenGrantFactory).creationCode, abi.encode(owner));
        bytes32 salt = PledgeCashDeploymentSalts.tokenGrantFactory();
        address predicted = deployer.predict(salt);

        address first = _deploy(salt, initCode);
        address second = _deploy(salt, initCode);

        assertEq(first, predicted);
        assertEq(second, predicted);
    }

    function _deploy(bytes32 salt, bytes memory initCode) internal returns (address deployed) {
        address predicted = deployer.predict(salt);

        vm.prank(owner);
        deployed = deployer.deploy(salt, initCode);

        assertEq(deployed, predicted);
        assertGt(deployed.code.length, 0);
    }
}
