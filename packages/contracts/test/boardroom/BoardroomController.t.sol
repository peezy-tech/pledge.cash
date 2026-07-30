// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "solady/auth/Ownable.sol";
import {WETH} from "solady/tokens/WETH.sol";
import {SignatureCheckerLib} from "solady/utils/SignatureCheckerLib.sol";
import {BoardroomController} from "../../src/boardroom/BoardroomController.sol";
import {BoardroomControllerFactory} from "../../src/boardroom/BoardroomControllerFactory.sol";
import {BoardroomFactory} from "../../src/boardroom/BoardroomFactory.sol";
import {BoardroomGovernanceLogic} from "../../src/boardroom/BoardroomGovernanceLogic.sol";
import {IBoardroom} from "../../src/boardroom/IBoardroom.sol";
import {BoardroomCall} from "../../src/boardroom/IBoardroomGovernance.sol";
import {BoardroomPolicyRegistry} from "../../src/boardroom/BoardroomPolicyRegistry.sol";
import {BoardroomRedemptionPayout} from "../../src/boardroom/BoardroomRedemptionPayout.sol";
import {BoardroomToken} from "../../src/boardroom/BoardroomToken.sol";
import {BoardroomFacetBase} from "../../src/boardroom/diamond/BoardroomFacetBase.sol";
import {BoardroomFacetTypes} from "../../src/boardroom/diamond/BoardroomFacetTypes.sol";
import {BoardroomObligationStorage} from "../../src/boardroom/storage/BoardroomObligationStorage.sol";
import {IBoardroomCallPolicy} from "../../src/policy/IBoardroomCallPolicy.sol";
import {IBoardroomObligationPolicy} from "../../src/policy/IBoardroomObligationPolicy.sol";
import {BoardroomRewards} from "../../src/rewards/BoardroomRewards.sol";
import {BoardroomRewardsFactory} from "../../src/rewards/BoardroomRewardsFactory.sol";
import {CanonicalBoardroomTestSetup} from "../helpers/CanonicalBoardroomTestSetup.sol";

contract ControllerCallTarget {
    uint256 public value;

    function setValue(uint256 value_) external payable {
        value = value_;
    }
}

contract ControllerAuthorityPolicy is IBoardroomCallPolicy {
    address public expectedAuthority;
    address public immutable expectedTarget;

    constructor(address target) {
        expectedTarget = target;
    }

    function setExpectedAuthority(address authority) external {
        expectedAuthority = authority;
    }

    function canCall(address, address caller, address target, uint256, bytes calldata) external view returns (bool) {
        return caller == expectedAuthority && target == expectedTarget;
    }
}

contract ControllerAllowAllPolicy is IBoardroomCallPolicy {
    function canCall(address, address, address, uint256, bytes calldata) external pure returns (bool) {
        return true;
    }
}

contract Recursive1271Authority {
    bytes4 internal constant MAGIC_VALUE = 0x1626ba7e;

    address public immutable authority;

    constructor(address authority_) {
        authority = authority_;
    }

    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        return
            SignatureCheckerLib.isValidSignatureNowCalldata(authority, hash, signature)
                ? MAGIC_VALUE
                : bytes4(0xffffffff);
    }
}

contract ControllerReentrantTarget {
    function reenter(
        BoardroomController controller,
        bytes32 expectedFacetSetHash,
        BoardroomCall[] calldata calls,
        bytes32 salt,
        uint256 boardroomEpoch,
        uint256 configurationEpoch,
        address authority
    ) external {
        controller.executeBoardroomOperation(
            expectedFacetSetHash, calls, salt, boardroomEpoch, configurationEpoch, authority
        );
    }
}

contract ControllerTestObligation {
    address public immutable factory;
    address public immutable boardroom;
    address public immutable shareToken;
    bool public closed;

    constructor(address factory_, address boardroom_, address shareToken_) {
        factory = factory_;
        boardroom = boardroom_;
        shareToken = shareToken_;
    }

    function close() external {
        closed = true;
    }

    function isClosed() external view returns (bool) {
        return closed;
    }
}

contract ControllerObligationPolicy is IBoardroomObligationPolicy {
    address public immutable expectedBoardroom;
    address public immutable expectedShareToken;
    ControllerTestObligation public immutable obligation;

    constructor(address boardroom_, address shareToken_) {
        expectedBoardroom = boardroom_;
        expectedShareToken = shareToken_;
        obligation = new ControllerTestObligation(address(this), boardroom_, shareToken_);
    }

    function adopt() external view returns (address) {
        return address(obligation);
    }

    function canCall(address boardroom, address, address target, uint256, bytes calldata data)
        external
        view
        returns (bool)
    {
        return boardroom == expectedBoardroom && target == address(this) && data.length >= 4
            && bytes4(data[:4]) == this.adopt.selector;
    }

    function obligationForCall(address boardroom, address target, uint256, bytes calldata, bytes calldata result)
        external
        view
        returns (Obligation memory created)
    {
        if (
            boardroom != expectedBoardroom || target != address(this)
                || abi.decode(result, (address)) != address(obligation)
        ) {
            return created;
        }
        created = Obligation({kind: ObligationKind.Distribution, account: address(obligation), aux: address(0)});
    }

    function isLifecycleCallAllowed(address, address target, bytes4 selector) external view returns (bool) {
        return target == address(obligation) && selector == ControllerTestObligation.close.selector;
    }
}

contract BoardroomControllerTest is CanonicalBoardroomTestSetup {
    BoardroomPolicyRegistry internal policyRegistry;
    BoardroomFactory internal boardroomFactory;
    BoardroomControllerFactory internal controllerFactory;
    BoardroomRewardsFactory internal rewardsFactory;
    ControllerCallTarget internal target;
    ControllerAuthorityPolicy internal authorityPolicy;
    ControllerAllowAllPolicy internal allowAllPolicy;
    WETH internal wrappedNative;

    address internal owner = address(0xA11CE);
    address internal protection = address(0xB0B);
    address internal proposer = address(0xD00D);
    address internal executor = address(0xCAFE);
    address internal stranger = address(0xBAD);
    uint256 internal serial;
    bytes32 internal expectedFacetSetHash;

    function setUp() public {
        wrappedNative = new WETH();
        policyRegistry = new BoardroomPolicyRegistry(address(this));
        boardroomFactory = _deployCanonicalBoardroomFactory(policyRegistry, address(wrappedNative));
        expectedFacetSetHash = canonicalFacetSetHash[address(boardroomFactory)];
        controllerFactory = BoardroomControllerFactory(boardroomFactory.controllerFactory());
        rewardsFactory = new BoardroomRewardsFactory(address(boardroomFactory));
        target = new ControllerCallTarget();
        authorityPolicy = new ControllerAuthorityPolicy(address(target));
        allowAllPolicy = new ControllerAllowAllPolicy();

        policyRegistry.registerModulePolicy(address(rewardsFactory));
        policyRegistry.setPolicyAllowed(address(authorityPolicy), true);
        policyRegistry.setPolicyAllowed(address(allowAllPolicy), true);
    }

    function testControllerDoesNotExistUntilAtomicLaunchAndFactoryRequiresLaunchContext() public {
        (IBoardroom boardroom,) = _prepareBoardroom("atomic-launch", 100 ether, protection);
        address predicted = controllerFactory.predictControllerAddress(address(boardroom), 1);

        assertEq(predicted.code.length, 0);
        assertFalse(controllerFactory.isController(predicted));
        assertEq(boardroom.controller(), address(0));

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(BoardroomControllerFactory.OnlyCanonicalBoardroom.selector, stranger));
        controllerFactory.deployController(predicted, proposer, 1 days, 2 days, 1);

        vm.prank(address(boardroom));
        vm.expectRevert(
            abi.encodeWithSelector(
                BoardroomControllerFactory.UnauthorizedDeploymentContext.selector, address(boardroom), predicted, 1
            )
        );
        controllerFactory.deployController(predicted, proposer, 1 days, 2 days, 1);
        assertEq(predicted.code.length, 0);

        BoardroomController controller = _launch(boardroom, proposer, protection, 1 days, 3 days, 2 days);

        assertEq(address(controller), predicted);
        assertGt(predicted.code.length, 0);
        assertTrue(controllerFactory.isController(predicted));
        assertEq(controllerFactory.boardroomOfController(predicted), address(boardroom));
        assertEq(controllerFactory.generationOfController(predicted), 1);
        assertEq(boardroom.owner(), predicted);
        assertEq(boardroom.controller(), predicted);
        assertEq(boardroom.controllerGeneration(), 1);
        assertEq(boardroom.protectionStaker(), protection);
        assertEq(boardroom.windDownDelay(), 3 days);

        vm.prank(address(controllerFactory));
        assertFalse(boardroom.isControllerDeploymentAuthorized(predicted, proposer, 1 days, 2 days, 1));
    }

    function testLaunchChecksNamedProtectionAndReciprocalConfiguration() public {
        (IBoardroom boardroom, BoardroomRewards rewards) = _createBoardroom("launch-validation");
        address weakProtection = address(0x1111);

        vm.startPrank(owner);
        boardroom.mint(expectedFacetSetHash, protection, 91 ether);
        boardroom.mint(expectedFacetSetHash, weakProtection, 9 ether);
        vm.stopPrank();
        vm.prank(protection);
        rewards.stake(91 ether);
        vm.prank(weakProtection);
        rewards.stake(9 ether);
        vm.roll(block.number + 1);

        BoardroomFacetTypes.LaunchConfig memory config =
            _launchConfig(boardroom, proposer, weakProtection, 1 days, 1 days, 1 days);
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                BoardroomGovernanceLogic.InsufficientStakerPower.selector, weakProtection, 9 ether, 9 ether, 10 ether
            )
        );
        boardroom.launch(expectedFacetSetHash, config);
        assertEq(config.predictedController.code.length, 0);

        config.protectionStaker = protection;
        config.expectedRewardPool = stranger;
        vm.prank(owner);
        vm.expectRevert(BoardroomFacetBase.InvalidLaunchConfiguration.selector);
        boardroom.launch(expectedFacetSetHash, config);

        config.expectedRewardPool = address(rewards);
        config.predictedController = stranger;
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(BoardroomFacetBase.InvalidController.selector, stranger));
        boardroom.launch(expectedFacetSetHash, config);

        config.predictedController = controllerFactory.predictControllerAddress(address(boardroom), 1);
        vm.prank(owner);
        boardroom.launch(expectedFacetSetHash, config);
        assertEq(boardroom.protectionStaker(), protection);
    }

    function testLaunchRejectsEverySecurityRelevantMismatchAndLeavesNoPartialController() public {
        (IBoardroom boardroom,) = _prepareBoardroom("launch-mismatch-matrix", 100 ether, protection);
        BoardroomFacetTypes.LaunchConfig memory config =
            _launchConfig(boardroom, proposer, protection, 1 days, 3 days, 2 days);
        address predicted = config.predictedController;

        config.proposer = address(0);
        vm.prank(owner);
        vm.expectRevert(BoardroomFacetBase.InvalidLaunchConfiguration.selector);
        boardroom.launch(expectedFacetSetHash, config);
        config.proposer = proposer;

        config.predictedController = address(0);
        vm.prank(owner);
        vm.expectRevert(BoardroomFacetBase.InvalidLaunchConfiguration.selector);
        boardroom.launch(expectedFacetSetHash, config);
        config.predictedController = predicted;

        config.protectionStaker = address(0);
        vm.prank(owner);
        vm.expectRevert(BoardroomFacetBase.InvalidLaunchConfiguration.selector);
        boardroom.launch(expectedFacetSetHash, config);
        config.protectionStaker = protection;

        config.expectedRewardPool = stranger;
        vm.prank(owner);
        vm.expectRevert(BoardroomFacetBase.InvalidLaunchConfiguration.selector);
        boardroom.launch(expectedFacetSetHash, config);
        config.expectedRewardPool = boardroom.rewardPool();

        config.expectedRedemptionExcessRecipient = stranger;
        vm.prank(owner);
        vm.expectRevert(BoardroomFacetBase.InvalidLaunchConfiguration.selector);
        boardroom.launch(expectedFacetSetHash, config);
        config.expectedRedemptionExcessRecipient = boardroom.redemptionExcessRecipient();

        config.generation = 2;
        vm.prank(owner);
        vm.expectRevert(BoardroomFacetBase.InvalidLaunchConfiguration.selector);
        boardroom.launch(expectedFacetSetHash, config);
        config.generation = 1;

        config.windDownDelay = uint64(boardroom.MIN_WIND_DOWN_DELAY() - 1);
        vm.prank(owner);
        vm.expectRevert(BoardroomFacetBase.InvalidLaunchConfiguration.selector);
        boardroom.launch(expectedFacetSetHash, config);
        config.windDownDelay = uint64(boardroom.MAX_WIND_DOWN_DELAY() + 1);
        vm.prank(owner);
        vm.expectRevert(BoardroomFacetBase.InvalidLaunchConfiguration.selector);
        boardroom.launch(expectedFacetSetHash, config);
        config.windDownDelay = 3 days;

        config.controllerDelay = uint64(1 days - 1);
        vm.prank(owner);
        vm.expectRevert(BoardroomController.InvalidConfiguration.selector);
        boardroom.launch(expectedFacetSetHash, config);
        config.controllerDelay = 1 days;

        config.gracePeriod = uint64(30 days + 1);
        vm.prank(owner);
        vm.expectRevert(BoardroomController.InvalidConfiguration.selector);
        boardroom.launch(expectedFacetSetHash, config);
        config.gracePeriod = 2 days;

        BoardroomControllerFactory releaseMismatchedFactory = new BoardroomControllerFactory(address(boardroomFactory));
        config.predictedController = releaseMismatchedFactory.predictControllerAddress(address(boardroom), 1);
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(BoardroomFacetBase.InvalidController.selector, config.predictedController)
        );
        boardroom.launch(expectedFacetSetHash, config);
        config.predictedController = predicted;

        vm.prank(stranger);
        vm.expectRevert(Ownable.Unauthorized.selector);
        boardroom.launch(expectedFacetSetHash, config);

        assertEq(predicted.code.length, 0);
        assertEq(boardroom.controller(), address(0));
        assertEq(boardroom.owner(), owner);
        vm.prank(address(controllerFactory));
        assertFalse(boardroom.isControllerDeploymentAuthorized(predicted, proposer, 1 days, 2 days, 1));

        vm.prank(owner);
        boardroom.launch(expectedFacetSetHash, config);
        BoardroomController controller = BoardroomController(predicted);
        assertEq(controller.proposer(), proposer);
        assertEq(controller.delay(), 1 days);
        assertEq(controller.gracePeriod(), 2 days);
        assertEq(controller.generation(), 1);
        assertEq(boardroom.windDownDelay(), 3 days);
    }

    function testProtectionStakerRequiresCurrentPastAndUnencumberedPower() public {
        address otherHolder = address(0x2222);
        {
            (IBoardroom boardroom, BoardroomRewards rewards) = _createBoardroom("protection-current-mismatch");
            vm.prank(owner);
            boardroom.mint(expectedFacetSetHash, protection, 10 ether);
            vm.prank(protection);
            rewards.stake(10 ether);
            vm.roll(block.number + 1);
            vm.prank(owner);
            boardroom.mint(expectedFacetSetHash, otherHolder, 100 ether);

            BoardroomFacetTypes.LaunchConfig memory config =
                _launchConfig(boardroom, proposer, protection, 1 days, 1 days, 1 days);
            vm.prank(owner);
            vm.expectRevert(
                abi.encodeWithSelector(
                    BoardroomGovernanceLogic.InsufficientStakerPower.selector, protection, 10 ether, 10 ether, 11 ether
                )
            );
            boardroom.launch(expectedFacetSetHash, config);
        }

        {
            (IBoardroom boardroom, BoardroomRewards rewards) = _createBoardroom("protection-past-mismatch");
            vm.startPrank(owner);
            boardroom.mint(expectedFacetSetHash, protection, 10 ether);
            boardroom.mint(expectedFacetSetHash, otherHolder, 90 ether);
            vm.stopPrank();
            vm.prank(protection);
            rewards.stake(5 ether);
            vm.roll(block.number + 1);
            vm.prank(protection);
            rewards.stake(5 ether);

            BoardroomFacetTypes.LaunchConfig memory config =
                _launchConfig(boardroom, proposer, protection, 1 days, 1 days, 1 days);
            vm.prank(owner);
            vm.expectRevert(
                abi.encodeWithSelector(
                    BoardroomGovernanceLogic.InsufficientStakerPower.selector, protection, 10 ether, 5 ether, 10 ether
                )
            );
            boardroom.launch(expectedFacetSetHash, config);
        }

        {
            (IBoardroom boardroom, BoardroomRewards rewards) = _createBoardroom("protection-encumbered");
            BoardroomToken shares = BoardroomToken(boardroom.shareToken());
            ControllerObligationPolicy obligationPolicy =
                new ControllerObligationPolicy(address(boardroom), address(shares));
            ControllerTestObligation obligation = obligationPolicy.obligation();
            policyRegistry.registerModulePolicy(address(obligationPolicy));
            vm.startPrank(owner);
            boardroom.mint(expectedFacetSetHash, address(obligation), 100 ether);
            boardroom.mint(expectedFacetSetHash, otherHolder, 100 ether);
            vm.stopPrank();
            vm.prank(address(obligation));
            rewards.stake(100 ether);
            vm.roll(block.number + 1);
            vm.prank(owner);
            boardroom.execute(
                expectedFacetSetHash,
                BoardroomFacetTypes.Call({
                    policy: address(obligationPolicy),
                    target: address(obligationPolicy),
                    value: 0,
                    data: abi.encodeCall(obligationPolicy.adopt, ())
                })
            );
            assertTrue(shares.isEncumberedAccount(address(obligation)));

            BoardroomFacetTypes.LaunchConfig memory config =
                _launchConfig(boardroom, proposer, address(obligation), 1 days, 1 days, 1 days);
            vm.prank(owner);
            vm.expectRevert(
                abi.encodeWithSelector(BoardroomGovernanceLogic.NotActiveStaker.selector, address(obligation))
            );
            boardroom.launch(expectedFacetSetHash, config);
        }
    }

    function testFactoryBindingRejectsReleaseMismatchPreemptionAndAddressOccupation() public {
        (IBoardroom victim,) = _prepareBoardroom("factory-hardening-victim", 100 ether, protection);
        (IBoardroom otherBoardroom,) = _createBoardroom("factory-hardening-other");
        address predicted = controllerFactory.predictControllerAddress(address(victim), 1);
        address otherPrediction = controllerFactory.predictControllerAddress(address(otherBoardroom), 1);

        assertEq(controllerFactory.boardroomFactory(), address(boardroomFactory));
        assertEq(victim.controllerFactory(), address(controllerFactory));
        assertNotEq(predicted, otherPrediction);

        vm.prank(address(otherBoardroom));
        vm.expectRevert(
            abi.encodeWithSelector(
                BoardroomControllerFactory.ControllerPredictionMismatch.selector, predicted, otherPrediction
            )
        );
        controllerFactory.deployController(predicted, proposer, 1 days, 1 days, 1);

        BoardroomControllerFactory mismatchedFactory = new BoardroomControllerFactory(address(boardroomFactory));
        address mismatchedPrediction = mismatchedFactory.predictControllerAddress(address(victim), 1);
        assertNotEq(mismatchedPrediction, predicted);
        vm.prank(address(victim));
        vm.expectRevert(
            abi.encodeWithSelector(
                BoardroomControllerFactory.UnauthorizedDeploymentContext.selector,
                address(victim),
                mismatchedPrediction,
                1
            )
        );
        mismatchedFactory.deployController(mismatchedPrediction, proposer, 1 days, 1 days, 1);

        BoardroomController controllerImplementation = BoardroomController(controllerFactory.controllerImplementation());
        vm.expectRevert();
        controllerImplementation.initialize(address(victim), proposer, 1 days, 1 days, 1);

        BoardroomFacetTypes.LaunchConfig memory config =
            _launchConfig(victim, proposer, protection, 1 days, 1 days, 1 days);
        vm.etch(predicted, hex"60006000fd");
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(BoardroomFacetBase.ControllerAlreadyDeployed.selector, predicted));
        victim.launch(expectedFacetSetHash, config);
        vm.etch(predicted, bytes(""));

        assertEq(predicted.code.length, 0);
        assertFalse(controllerFactory.isController(predicted));
        assertEq(victim.controller(), address(0));
    }

    function testOnlyProposerSchedulesAndAnyoneExecutesWithProposerAsPolicyAuthority() public {
        (IBoardroom boardroom, BoardroomController controller,) = _launchedBoardroom("schedule-execute", proposer);
        authorityPolicy.setExpectedAuthority(proposer);
        BoardroomCall[] memory calls = _targetCalls(address(authorityPolicy), 42);
        bytes32 salt = keccak256("policy-authority");

        vm.prank(executor);
        vm.expectRevert(BoardroomController.OnlyProposer.selector);
        controller.scheduleBoardroomOperation(expectedFacetSetHash, calls, salt, 1, 1);

        vm.prank(proposer);
        (bytes32 operationId, uint256 eta) =
            controller.scheduleBoardroomOperation(expectedFacetSetHash, calls, salt, 1, 1);

        vm.prank(executor);
        vm.expectRevert(
            abi.encodeWithSelector(BoardroomController.OperationNotReady.selector, operationId, eta, block.timestamp)
        );
        controller.executeBoardroomOperation(expectedFacetSetHash, calls, salt, 1, 1, proposer);

        vm.warp(eta);
        vm.prank(executor);
        controller.executeBoardroomOperation(expectedFacetSetHash, calls, salt, 1, 1, proposer);
        assertEq(target.value(), 42);

        vm.prank(executor);
        vm.expectRevert(abi.encodeWithSelector(BoardroomController.OperationContextMismatch.selector, bytes32(0)));
        controller.executeBoardroomOperation(expectedFacetSetHash, calls, salt, 1, 1, executor);

        vm.prank(owner);
        vm.expectRevert(BoardroomFacetBase.BoardroomAlreadyLaunched.selector);
        boardroom.execute(
            expectedFacetSetHash,
            BoardroomFacetTypes.Call({
                policy: address(authorityPolicy),
                target: address(target),
                value: 0,
                data: abi.encodeCall(target.setValue, (99))
            })
        );
    }

    function testOnlyPolicyCheckedGatewayCanMutateAndControllerExecutionRegistersObligations() public {
        (IBoardroom boardroom, BoardroomController controller,) = _launchedBoardroom("gateway-and-obligation", proposer);

        vm.prank(proposer);
        vm.expectRevert(BoardroomFacetBase.BoardroomAlreadyLaunched.selector);
        boardroom.mint(expectedFacetSetHash, stranger, 1 ether);
        vm.prank(address(controller));
        vm.expectRevert(BoardroomFacetBase.BoardroomAlreadyLaunched.selector);
        boardroom.mint(expectedFacetSetHash, stranger, 1 ether);
        vm.prank(stranger);
        vm.expectRevert(BoardroomFacetBase.BoardroomAlreadyLaunched.selector);
        boardroom.mint(expectedFacetSetHash, stranger, 1 ether);

        {
            BoardroomCall[] memory directCalls = _targetCalls(address(allowAllPolicy), 81);
            vm.prank(proposer);
            vm.expectRevert(Ownable.Unauthorized.selector);
            boardroom.executeGovernance(expectedFacetSetHash, 1, proposer, directCalls);
        }

        {
            BoardroomCall[] memory rejectedCalls = _targetCalls(address(authorityPolicy), 82);
            bytes32 rejectedSalt = keccak256("policy-rejection");
            vm.prank(proposer);
            (bytes32 rejectedId, uint256 rejectedEta) =
                controller.scheduleBoardroomOperation(expectedFacetSetHash, rejectedCalls, rejectedSalt, 1, 1);
            vm.warp(rejectedEta);
            vm.expectRevert();
            controller.executeBoardroomOperation(expectedFacetSetHash, rejectedCalls, rejectedSalt, 1, 1, proposer);
            (,, BoardroomController.OperationStatus rejectedStatus) = controller.operationState(rejectedId);
            assertEq(uint8(rejectedStatus), uint8(BoardroomController.OperationStatus.Pending));
            assertEq(target.value(), 0);
        }

        ControllerObligationPolicy obligationPolicy =
            new ControllerObligationPolicy(address(boardroom), boardroom.shareToken());
        policyRegistry.registerModulePolicy(address(obligationPolicy));
        BoardroomCall[] memory obligationCalls = new BoardroomCall[](1);
        obligationCalls[0] = BoardroomCall({
            policy: address(obligationPolicy),
            target: address(obligationPolicy),
            value: 0,
            data: abi.encodeCall(obligationPolicy.adopt, ())
        });
        bytes32 obligationSalt = keccak256("controller-obligation");
        vm.prank(proposer);
        (, uint256 obligationEta) =
            controller.scheduleBoardroomOperation(expectedFacetSetHash, obligationCalls, obligationSalt, 1, 1);
        vm.warp(obligationEta);
        vm.prank(executor);
        controller.executeBoardroomOperation(expectedFacetSetHash, obligationCalls, obligationSalt, 1, 1, proposer);

        _assertRecordedDistribution(boardroom, obligationPolicy);
        assertEq(boardroom.activeObligationCount(), 2);
    }

    function testSchedulingBoundsExpiryReplayAndPayloadBinding() public {
        (, BoardroomController controller,) = _launchedBoardroom("operation-bounds", proposer);
        BoardroomCall[] memory empty = new BoardroomCall[](0);
        vm.prank(proposer);
        vm.expectRevert(BoardroomController.InvalidConfiguration.selector);
        controller.scheduleBoardroomOperation(expectedFacetSetHash, empty, bytes32(0), 1, 1);

        BoardroomCall[] memory tooMany = new BoardroomCall[](17);
        uint256 maximumCalls = controller.MAX_BATCH_CALLS();
        vm.prank(proposer);
        vm.expectRevert(abi.encodeWithSelector(BoardroomController.TooManyCalls.selector, 17, maximumCalls));
        controller.scheduleBoardroomOperation(expectedFacetSetHash, tooMany, bytes32(0), 1, 1);

        BoardroomCall[] memory calls = _targetCalls(address(allowAllPolicy), 7);
        bytes32 salt = keccak256("expires");
        vm.prank(proposer);
        (bytes32 operationId, uint256 eta) =
            controller.scheduleBoardroomOperation(expectedFacetSetHash, calls, salt, 1, 1);
        (, uint256 expiresAt,) = controller.operationState(operationId);
        assertEq(expiresAt, eta + controller.gracePeriod());

        vm.prank(proposer);
        vm.expectRevert(abi.encodeWithSelector(BoardroomController.OperationAlreadyKnown.selector, operationId));
        controller.scheduleBoardroomOperation(expectedFacetSetHash, calls, salt, 1, 1);

        BoardroomCall[] memory changedCalls = _targetCalls(address(allowAllPolicy), 8);
        assertNotEq(
            operationId, controller.hashBoardroomOperation(expectedFacetSetHash, changedCalls, salt, 1, 1, proposer)
        );
        assertNotEq(
            operationId,
            controller.hashBoardroomOperation(expectedFacetSetHash, calls, keccak256("other-salt"), 1, 1, proposer)
        );
        assertNotEq(operationId, controller.hashBoardroomOperation(expectedFacetSetHash, calls, salt, 2, 1, proposer));
        assertNotEq(operationId, controller.hashBoardroomOperation(expectedFacetSetHash, calls, salt, 1, 2, proposer));
        assertNotEq(operationId, controller.hashBoardroomOperation(expectedFacetSetHash, calls, salt, 1, 1, executor));

        vm.warp(expiresAt + 1);
        vm.expectRevert(
            abi.encodeWithSelector(BoardroomController.OperationExpired.selector, operationId, expiresAt, expiresAt + 1)
        );
        controller.executeBoardroomOperation(expectedFacetSetHash, calls, salt, 1, 1, proposer);

        (, BoardroomController replayController,) = _launchedBoardroom("operation-replay", proposer);
        vm.prank(proposer);
        (bytes32 replayId, uint256 replayEta) =
            replayController.scheduleBoardroomOperation(expectedFacetSetHash, calls, salt, 1, 1);
        vm.warp(replayEta);
        replayController.executeBoardroomOperation(expectedFacetSetHash, calls, salt, 1, 1, proposer);
        vm.expectRevert(abi.encodeWithSelector(BoardroomController.OperationNotPending.selector, replayId));
        replayController.executeBoardroomOperation(expectedFacetSetHash, calls, salt, 1, 1, proposer);
    }

    function testHolderVetoUsesCurrentAndPastStakeAndOnlyBoardroomCancels() public {
        (IBoardroom boardroom, BoardroomController controller,) = _launchedBoardroom("holder-veto", proposer);
        BoardroomCall[] memory calls = _targetCalls(address(allowAllPolicy), 11);
        bytes32 salt = keccak256("veto");
        vm.prank(proposer);
        (bytes32 operationId, uint256 eta) =
            controller.scheduleBoardroomOperation(expectedFacetSetHash, calls, salt, 1, 1);

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(BoardroomGovernanceLogic.InsufficientStakerPower.selector, stranger, 0, 0, 1 ether)
        );
        boardroom.veto(expectedFacetSetHash, operationId);

        vm.prank(protection);
        vm.expectRevert(BoardroomController.OnlyBoardroom.selector);
        controller.cancelOperation(operationId);

        vm.prank(protection);
        boardroom.veto(expectedFacetSetHash, operationId);
        (,, BoardroomController.OperationStatus operationStatus) = controller.operationState(operationId);
        assertEq(uint8(operationStatus), uint8(BoardroomController.OperationStatus.Cancelled));

        vm.warp(eta);
        vm.expectRevert(abi.encodeWithSelector(BoardroomController.OperationNotPending.selector, operationId));
        controller.executeBoardroomOperation(expectedFacetSetHash, calls, salt, 1, 1, proposer);
    }

    function testHolderVetoCancelsSelfConfigurationImmediatelyBeforeAndAtReadiness() public {
        (IBoardroom boardroom, BoardroomController controller,) =
            _launchedBoardroom("holder-veto-controller-operation", proposer);
        bytes memory updateData =
            abi.encodeCall(BoardroomController.updateConfiguration, (stranger, uint64(2 days), uint64(3 days)));

        bytes32 beforeSalt = keccak256("self-veto-before-ready");
        vm.prank(proposer);
        (bytes32 beforeId, uint256 beforeEta) =
            controller.scheduleControllerOperation(expectedFacetSetHash, updateData, beforeSalt, 1, 1);
        vm.warp(beforeEta - 1);
        vm.prank(protection);
        boardroom.veto(expectedFacetSetHash, beforeId);
        vm.warp(beforeEta);
        vm.expectRevert(abi.encodeWithSelector(BoardroomController.OperationNotPending.selector, beforeId));
        controller.executeControllerOperation(expectedFacetSetHash, updateData, beforeSalt, 1, 1, proposer);

        bytes32 readySalt = keccak256("self-veto-at-ready");
        vm.prank(proposer);
        (bytes32 readyId, uint256 readyEta) =
            controller.scheduleControllerOperation(expectedFacetSetHash, updateData, readySalt, 1, 1);
        vm.warp(readyEta);
        vm.prank(protection);
        boardroom.veto(expectedFacetSetHash, readyId);
        vm.expectRevert(abi.encodeWithSelector(BoardroomController.OperationNotPending.selector, readyId));
        controller.executeControllerOperation(expectedFacetSetHash, updateData, readySalt, 1, 1, proposer);

        assertEq(controller.proposer(), proposer);
        assertEq(controller.configurationEpoch(), 1);
    }

    function testConfigurationChangesAreDelayedSelfGovernanceAndInvalidateOldOperations() public {
        (, BoardroomController controller,) = _launchedBoardroom("configuration-epoch", proposer);
        BoardroomCall[] memory staleCalls = _targetCalls(address(allowAllPolicy), 21);
        bytes32 staleSalt = keccak256("stale-after-config");
        bytes memory updateData =
            abi.encodeCall(BoardroomController.updateConfiguration, (stranger, uint64(2 days), uint64(3 days)));

        vm.expectRevert(BoardroomController.OnlySelf.selector);
        controller.updateConfiguration(stranger, 2 days, 3 days);

        vm.prank(proposer);
        (bytes32 staleId,) = controller.scheduleBoardroomOperation(expectedFacetSetHash, staleCalls, staleSalt, 1, 1);
        vm.prank(proposer);
        (, uint256 eta) =
            controller.scheduleControllerOperation(expectedFacetSetHash, updateData, keccak256("update"), 1, 1);

        vm.warp(eta);
        vm.prank(executor);
        controller.executeControllerOperation(expectedFacetSetHash, updateData, keccak256("update"), 1, 1, proposer);
        assertEq(controller.proposer(), stranger);
        assertEq(controller.delay(), 2 days);
        assertEq(controller.gracePeriod(), 3 days);
        assertEq(controller.configurationEpoch(), 2);

        vm.expectRevert(abi.encodeWithSelector(BoardroomController.ConfigurationEpochMismatch.selector, 1, 2));
        controller.executeBoardroomOperation(expectedFacetSetHash, staleCalls, staleSalt, 1, 1, proposer);
        (,, BoardroomController.OperationStatus staleStatus) = controller.operationState(staleId);
        assertEq(uint8(staleStatus), uint8(BoardroomController.OperationStatus.Pending));

        vm.prank(proposer);
        vm.expectRevert(BoardroomController.OnlyProposer.selector);
        controller.scheduleBoardroomOperation(expectedFacetSetHash, staleCalls, keccak256("old-proposer"), 1, 2);
        vm.prank(stranger);
        controller.scheduleBoardroomOperation(expectedFacetSetHash, staleCalls, keccak256("new-proposer"), 1, 2);
    }

    function testWindDownAdvancesEpochAndInvalidatesAllPendingOperationsInConstantTime() public {
        (IBoardroom boardroom, BoardroomController controller,) = _launchedBoardroom("wind-down-epoch", proposer);
        BoardroomCall[] memory calls = _targetCalls(address(allowAllPolicy), 31);
        bytes32 salt = keccak256("wind-down-stale");
        vm.prank(proposer);
        (bytes32 operationId,) = controller.scheduleBoardroomOperation(expectedFacetSetHash, calls, salt, 1, 1);

        vm.prank(protection);
        boardroom.startWindDown(expectedFacetSetHash);
        assertEq(boardroom.governanceEpoch(), 2);
        assertEq(uint8(boardroom.status()), uint8(BoardroomFacetTypes.BoardroomStatus.WindingDown));

        vm.expectRevert(BoardroomController.BoardroomNotActive.selector);
        controller.executeBoardroomOperation(expectedFacetSetHash, calls, salt, 1, 1, proposer);
        (,, BoardroomController.OperationStatus operationStatus) = controller.operationState(operationId);
        assertEq(uint8(operationStatus), uint8(BoardroomController.OperationStatus.Pending));
    }

    function testWindDownInvalidatesManyOperationsInConstantTimeAndPreservesIndependentDelay() public {
        (IBoardroom boardroom, BoardroomController controller, BoardroomRewards rewards) =
            _prepareAndLaunchWithWindDownDelay("wind-down-many", 7 days);
        BoardroomCall[] memory calls = _targetCalls(address(allowAllPolicy), 91);
        bytes32 sampledOperation;
        for (uint256 i; i < 96; ++i) {
            bytes32 salt = keccak256(abi.encode("queued-before-wind-down", i));
            vm.prank(proposer);
            (bytes32 operationId,) = controller.scheduleBoardroomOperation(expectedFacetSetHash, calls, salt, 1, 1);
            if (i == 95) sampledOperation = operationId;
        }

        bytes memory updateData =
            abi.encodeCall(BoardroomController.updateConfiguration, (proposer, uint64(30 days), uint64(1 days)));
        bytes32 updateSalt = keccak256("controller-delay-does-not-change-wind-down-delay");
        vm.prank(proposer);
        (, uint256 updateEta) =
            controller.scheduleControllerOperation(expectedFacetSetHash, updateData, updateSalt, 1, 1);
        vm.warp(updateEta);
        controller.executeControllerOperation(expectedFacetSetHash, updateData, updateSalt, 1, 1, proposer);
        assertEq(controller.delay(), 30 days);
        assertEq(boardroom.windDownDelay(), 7 days);

        uint256 gasBefore = gasleft();
        vm.prank(protection);
        boardroom.startWindDown(expectedFacetSetHash);
        uint256 windDownGas = gasBefore - gasleft();
        emit log_named_uint("wind-down invalidation gas", windDownGas);
        assertLt(windDownGas, 500_000);
        assertEq(boardroom.governanceEpoch(), 2);

        vm.expectRevert(BoardroomController.BoardroomNotActive.selector);
        controller.executeBoardroomOperation(
            expectedFacetSetHash, calls, keccak256(abi.encode("queued-before-wind-down", uint256(95))), 1, 1, proposer
        );
        (,, BoardroomController.OperationStatus sampledStatus) = controller.operationState(sampledOperation);
        assertEq(uint8(sampledStatus), uint8(BoardroomController.OperationStatus.Pending));

        rewards.terminalize();
        assertTrue(boardroom.pruneObligation(expectedFacetSetHash, address(rewards)));
        uint256 readyAt = boardroom.windDownStartedAt() + 7 days;
        vm.warp(readyAt - 1);
        vm.expectRevert(BoardroomRedemptionPayout.SnapshotNotReady.selector);
        boardroom.beginSnapshot(expectedFacetSetHash);
        vm.warp(readyAt);
        boardroom.beginSnapshot(expectedFacetSetHash);
        assertEq(uint8(boardroom.status()), uint8(BoardroomFacetTypes.BoardroomStatus.Snapshotting));
    }

    function testReplacementDeploysNextGenerationOnlyInsideAtomicSelfCall() public {
        (IBoardroom boardroom, BoardroomController controller,) = _launchedBoardroom("replacement", proposer);
        address recipient = boardroom.redemptionExcessRecipient();
        uint256 preservedWindDownDelay = boardroom.windDownDelay();
        address predictedNext = controllerFactory.predictControllerAddress(address(boardroom), 2);
        assertEq(predictedNext.code.length, 0);

        BoardroomCall[] memory staleCalls = _targetCalls(address(allowAllPolicy), 41);
        vm.prank(proposer);
        controller.scheduleBoardroomOperation(expectedFacetSetHash, staleCalls, keccak256("old-generation"), 1, 1);

        BoardroomCall[] memory replacementCalls = new BoardroomCall[](1);
        replacementCalls[0] = BoardroomCall({
            policy: address(0),
            target: address(boardroom),
            value: 0,
            data: abi.encodeCall(
                IBoardroom.replaceController,
                (
                    expectedFacetSetHash,
                    address(controller),
                    predictedNext,
                    stranger,
                    uint64(2 days),
                    uint64(4 days),
                    uint64(2)
                )
            )
        });
        vm.prank(proposer);
        (, uint256 eta) =
            controller.scheduleBoardroomOperation(expectedFacetSetHash, replacementCalls, keccak256("replace"), 1, 1);
        assertEq(predictedNext.code.length, 0);

        vm.warp(eta);
        vm.prank(executor);
        controller.executeBoardroomOperation(
            expectedFacetSetHash, replacementCalls, keccak256("replace"), 1, 1, proposer
        );

        BoardroomController next = BoardroomController(predictedNext);
        assertGt(predictedNext.code.length, 0);
        assertEq(boardroom.controller(), predictedNext);
        assertEq(boardroom.owner(), predictedNext);
        assertEq(boardroom.controllerGeneration(), 2);
        assertEq(boardroom.governanceEpoch(), 2);
        assertEq(next.generation(), 2);
        assertEq(next.proposer(), stranger);
        assertEq(next.configurationEpoch(), 1);
        assertEq(boardroom.windDownDelay(), preservedWindDownDelay);
        assertEq(boardroom.redemptionExcessRecipient(), recipient);

        vm.expectRevert(BoardroomController.ControllerNotActive.selector);
        controller.executeBoardroomOperation(
            expectedFacetSetHash, staleCalls, keccak256("old-generation"), 1, 1, proposer
        );

        vm.prank(stranger);
        next.scheduleBoardroomOperation(expectedFacetSetHash, staleCalls, keccak256("new-generation"), 2, 1);
    }

    function testReplacementCannotBeCalledDirectlyOrHiddenInsidePolicyWrappedBatch() public {
        (IBoardroom boardroom, BoardroomController controller,) = _launchedBoardroom("replacement-atomicity", proposer);
        address predictedNext = controllerFactory.predictControllerAddress(address(boardroom), 2);
        bytes memory replacementData = abi.encodeCall(
            IBoardroom.replaceController,
            (
                expectedFacetSetHash,
                address(controller),
                predictedNext,
                stranger,
                uint64(2 days),
                uint64(2 days),
                uint64(2)
            )
        );

        vm.prank(proposer);
        vm.expectRevert(Ownable.Unauthorized.selector);
        boardroom.replaceController(
            expectedFacetSetHash, address(controller), predictedNext, stranger, 2 days, 2 days, 2
        );
        vm.prank(address(controller));
        vm.expectRevert(Ownable.Unauthorized.selector);
        boardroom.replaceController(
            expectedFacetSetHash, address(controller), predictedNext, stranger, 2 days, 2 days, 2
        );

        BoardroomCall[] memory targetCalls = _targetCalls(address(allowAllPolicy), 101);
        BoardroomCall[] memory calls = new BoardroomCall[](2);
        calls[0] = targetCalls[0];
        calls[1] = BoardroomCall({
            policy: address(allowAllPolicy), target: address(boardroom), value: 0, data: replacementData
        });
        bytes32 salt = keccak256("policy-wrapped-batched-replacement");
        vm.prank(proposer);
        (bytes32 operationId, uint256 eta) =
            controller.scheduleBoardroomOperation(expectedFacetSetHash, calls, salt, 1, 1);
        vm.warp(eta);
        vm.expectRevert(BoardroomFacetBase.InvalidControllerReplacement.selector);
        controller.executeBoardroomOperation(expectedFacetSetHash, calls, salt, 1, 1, proposer);

        assertEq(predictedNext.code.length, 0);
        assertEq(boardroom.controller(), address(controller));
        assertEq(target.value(), 0);
        (,, BoardroomController.OperationStatus operationStatus) = controller.operationState(operationId);
        assertEq(uint8(operationStatus), uint8(BoardroomController.OperationStatus.Pending));
    }

    function testOwnershipTransferAndRenunciationRemainDisabledAfterLaunch() public {
        (IBoardroom boardroom, BoardroomController controller,) = _launchedBoardroom("ownership-lock", proposer);

        vm.prank(address(controller));
        vm.expectRevert(BoardroomFacetBase.OwnershipLockedAfterLaunch.selector);
        boardroom.transferOwnership(expectedFacetSetHash, stranger);

        vm.prank(address(controller));
        vm.expectRevert(BoardroomFacetBase.OwnershipRenunciationDisabled.selector);
        boardroom.renounceOwnership(expectedFacetSetHash);

        vm.prank(stranger);
        vm.expectRevert(BoardroomFacetBase.OwnershipLockedAfterLaunch.selector);
        boardroom.requestOwnershipHandover(expectedFacetSetHash);
        vm.prank(stranger);
        vm.expectRevert(BoardroomFacetBase.OwnershipLockedAfterLaunch.selector);
        boardroom.cancelOwnershipHandover(expectedFacetSetHash);
        vm.prank(address(controller));
        vm.expectRevert(BoardroomFacetBase.OwnershipLockedAfterLaunch.selector);
        boardroom.completeOwnershipHandover(expectedFacetSetHash, stranger);
    }

    function testControllerERC1271AcceptsEOAProposerAndRejectsWrongSigner() public {
        uint256 proposerKey = 0xA11CE123;
        address eoaProposer = vm.addr(proposerKey);
        (, BoardroomController controller,) = _launchedBoardroom("eoa-1271", eoaProposer);
        bytes32 digest = keccak256("exact-eip191-siwe-hash");
        bytes memory signature = _erc1271Envelope(controller, digest, proposerKey);

        assertEq(controller.isValidSignature(digest, signature), controller.ERC1271_MAGIC_VALUE());
        assertEq(controller.isValidSignature(digest, _sign(proposerKey, digest)), controller.ERC1271_INVALID_VALUE());
        assertEq(
            controller.isValidSignature(digest, _erc1271Envelope(controller, digest, 0xBAD123)),
            controller.ERC1271_INVALID_VALUE()
        );

        BoardroomCall[] memory calls = _targetCalls(address(allowAllPolicy), 51);
        bytes32 operationId = controller.hashBoardroomOperation(
            expectedFacetSetHash, calls, keccak256("signature-only"), 1, 1, eoaProposer
        );
        (,, BoardroomController.OperationStatus beforeStatus) = controller.operationState(operationId);
        controller.isValidSignature(digest, signature);
        (,, BoardroomController.OperationStatus afterStatus) = controller.operationState(operationId);
        assertEq(uint8(beforeStatus), uint8(BoardroomController.OperationStatus.Unset));
        assertEq(uint8(afterStatus), uint8(BoardroomController.OperationStatus.Unset));
    }

    function testControllerERC1271RecursesThroughContractProposer() public {
        uint256 signerKey = 0x515AFE;
        address signer = vm.addr(signerKey);
        Recursive1271Authority inner = new Recursive1271Authority(signer);
        Recursive1271Authority safe = new Recursive1271Authority(address(inner));
        (, BoardroomController controller,) = _launchedBoardroom("safe-1271", address(safe));
        bytes32 digest = keccak256("safe-siwe-hash");

        assertEq(
            controller.isValidSignature(digest, _erc1271Envelope(controller, digest, signerKey)),
            controller.ERC1271_MAGIC_VALUE()
        );
        assertEq(
            controller.isValidSignature(digest, _erc1271Envelope(controller, digest, 0xDEAD123)),
            controller.ERC1271_INVALID_VALUE()
        );

        BoardroomCall[] memory calls = _targetCalls(address(allowAllPolicy), 61);
        vm.prank(address(safe));
        controller.scheduleBoardroomOperation(expectedFacetSetHash, calls, keccak256("safe-schedules"), 1, 1);
    }

    function testControllerExecutionIsReentrancySafeAndRollsBackConsumption() public {
        (, BoardroomController controller,) = _launchedBoardroom("controller-reentrancy", proposer);
        ControllerReentrantTarget reentrant = new ControllerReentrantTarget();
        BoardroomCall[] memory innerCalls = _targetCalls(address(allowAllPolicy), 71);
        bytes32 innerSalt = keccak256("inner");
        vm.prank(proposer);
        (bytes32 innerId, uint256 eta) =
            controller.scheduleBoardroomOperation(expectedFacetSetHash, innerCalls, innerSalt, 1, 1);

        BoardroomCall[] memory outerCalls = new BoardroomCall[](1);
        outerCalls[0] = BoardroomCall({
            policy: address(allowAllPolicy),
            target: address(reentrant),
            value: 0,
            data: abi.encodeCall(
                reentrant.reenter,
                (controller, expectedFacetSetHash, innerCalls, innerSalt, uint256(1), uint256(1), proposer)
            )
        });
        bytes32 outerSalt = keccak256("outer");
        vm.prank(proposer);
        (bytes32 outerId,) = controller.scheduleBoardroomOperation(expectedFacetSetHash, outerCalls, outerSalt, 1, 1);

        vm.warp(eta);
        vm.expectRevert();
        controller.executeBoardroomOperation(expectedFacetSetHash, outerCalls, outerSalt, 1, 1, proposer);
        (,, BoardroomController.OperationStatus outerStatus) = controller.operationState(outerId);
        (,, BoardroomController.OperationStatus innerStatus) = controller.operationState(innerId);
        assertEq(uint8(outerStatus), uint8(BoardroomController.OperationStatus.Pending));
        assertEq(uint8(innerStatus), uint8(BoardroomController.OperationStatus.Pending));

        controller.executeBoardroomOperation(expectedFacetSetHash, innerCalls, innerSalt, 1, 1, proposer);
        assertEq(target.value(), 71);
    }

    function _launchedBoardroom(string memory label, address proposer_)
        internal
        returns (IBoardroom boardroom, BoardroomController controller, BoardroomRewards rewards)
    {
        (boardroom, rewards) = _prepareBoardroom(label, 100 ether, protection);
        controller = _launch(boardroom, proposer_, protection, 1 days, 2 days, 2 days);
    }

    function _prepareAndLaunchWithWindDownDelay(string memory label, uint64 windDownDelay)
        internal
        returns (IBoardroom boardroom, BoardroomController controller, BoardroomRewards rewards)
    {
        (boardroom, rewards) = _prepareBoardroom(label, 100 ether, protection);
        controller = _launch(boardroom, proposer, protection, 1 days, windDownDelay, 2 days);
    }

    function _prepareBoardroom(string memory label, uint256 amount, address staker)
        internal
        returns (IBoardroom boardroom, BoardroomRewards rewards)
    {
        (boardroom, rewards) = _createBoardroom(label);
        vm.prank(owner);
        boardroom.mint(expectedFacetSetHash, staker, amount);
        vm.prank(staker);
        rewards.stake(amount);
        vm.roll(block.number + 1);
    }

    function _createBoardroom(string memory label) internal returns (IBoardroom boardroom, BoardroomRewards rewards) {
        bytes32 salt = keccak256(abi.encode(label, ++serial));
        boardroom = _createCanonicalBoardroom(boardroomFactory, owner, "Controller Boardroom", "CTRL", salt);
        vm.prank(owner);
        bytes memory result = boardroom.execute(
            expectedFacetSetHash,
            BoardroomFacetTypes.Call({
                policy: address(rewardsFactory),
                target: address(rewardsFactory),
                value: 0,
                data: abi.encodeCall(rewardsFactory.createRewards, (uint64(1 days), salt))
            })
        );
        rewards = BoardroomRewards(abi.decode(result, (address)));
    }

    function _launch(
        IBoardroom boardroom,
        address proposer_,
        address protection_,
        uint64 controllerDelay,
        uint64 windDownDelay,
        uint64 gracePeriod
    ) internal returns (BoardroomController controller) {
        BoardroomFacetTypes.LaunchConfig memory config = _launchConfig(
            boardroom, proposer_, protection_, controllerDelay, windDownDelay, gracePeriod
        );
        vm.prank(owner);
        boardroom.launch(expectedFacetSetHash, config);
        controller = BoardroomController(config.predictedController);
    }

    function _launchConfig(
        IBoardroom boardroom,
        address proposer_,
        address protection_,
        uint64 controllerDelay,
        uint64 windDownDelay,
        uint64 gracePeriod
    ) internal view returns (BoardroomFacetTypes.LaunchConfig memory config) {
        config = BoardroomFacetTypes.LaunchConfig({
            proposer: proposer_,
            predictedController: controllerFactory.predictControllerAddress(address(boardroom), 1),
            protectionStaker: protection_,
            expectedRewardPool: boardroom.rewardPool(),
            expectedRedemptionExcessRecipient: boardroom.redemptionExcessRecipient(),
            controllerDelay: controllerDelay,
            windDownDelay: windDownDelay,
            gracePeriod: gracePeriod,
            generation: 1
        });
    }

    function _targetCalls(address policy, uint256 value) internal view returns (BoardroomCall[] memory calls) {
        calls = new BoardroomCall[](1);
        calls[0] = BoardroomCall({
            policy: policy, target: address(target), value: 0, data: abi.encodeCall(target.setValue, (value))
        });
    }

    function _assertRecordedDistribution(IBoardroom boardroom, ControllerObligationPolicy obligationPolicy)
        internal
        view
    {
        ControllerTestObligation obligation = obligationPolicy.obligation();
        (address recordedPolicy, BoardroomObligationStorage.Kind kind, bool active, bool everRegistered) =
            boardroom.obligationOf(address(obligation));
        assertEq(recordedPolicy, address(obligationPolicy));
        assertEq(uint8(kind), uint8(BoardroomObligationStorage.Kind.Distribution));
        assertTrue(active);
        assertTrue(everRegistered);
    }

    function _sign(uint256 privateKey, bytes32 digest) internal pure returns (bytes memory signature) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        signature = abi.encodePacked(r, s, v);
    }

    function _erc1271Envelope(BoardroomController controller, bytes32 messageHash, uint256 signerKey)
        internal
        view
        returns (bytes memory envelope)
    {
        uint256 boardroomEpoch = IBoardroom(controller.boardroom()).governanceEpoch();
        uint256 controllerGeneration = controller.generation();
        uint256 configurationEpoch = controller.configurationEpoch();
        bytes32 configurationHash = controller.configurationHash();
        bytes32 digest = controller.hashERC1271Digest(
            messageHash,
            controller.boardroom(),
            expectedFacetSetHash,
            boardroomEpoch,
            controllerGeneration,
            configurationEpoch,
            configurationHash
        );
        envelope = abi.encode(
            controller.ERC1271_ENVELOPE_SCHEME(),
            expectedFacetSetHash,
            boardroomEpoch,
            controllerGeneration,
            configurationEpoch,
            configurationHash,
            _sign(signerKey, digest)
        );
    }
}
