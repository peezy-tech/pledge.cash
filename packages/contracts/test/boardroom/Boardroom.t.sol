// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "solady/auth/Ownable.sol";
import {WETH} from "solady/tokens/WETH.sol";
import {AmmFactory} from "../../src/amm/AmmFactory.sol";
import {AmmPool} from "../../src/amm/AmmPool.sol";
import {AssetPolicy} from "../../src/policy/AssetPolicy.sol";
import {Boardroom} from "../../src/boardroom/Boardroom.sol";
import {BoardroomFactory} from "../../src/boardroom/BoardroomFactory.sol";
import {BoardroomGovernanceLogic} from "../../src/boardroom/BoardroomGovernanceLogic.sol";
import {BoardroomPolicyRegistry} from "../../src/boardroom/BoardroomPolicyRegistry.sol";
import {BoardroomRedemptionPayout} from "../../src/boardroom/BoardroomRedemptionPayout.sol";
import {BoardroomToken} from "../../src/boardroom/BoardroomToken.sol";
import {IBoardroomCallPolicy} from "../../src/policy/IBoardroomCallPolicy.sol";
import {IBoardroomObligationPolicy} from "../../src/policy/IBoardroomObligationPolicy.sol";
import {TokenGrant} from "../../src/grants/TokenGrant.sol";
import {TokenGrantFactory} from "../../src/grants/TokenGrantFactory.sol";

contract BoardroomCurrency {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) {
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external virtual returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract SenderFeeRedeemableCurrency {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;
    uint256 public immutable fee;

    mapping(address => uint256) public balanceOf;

    constructor(string memory name_, string memory symbol_, uint8 decimals_, uint256 fee_) {
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
        fee = fee_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        uint256 debit = amount + fee;
        balanceOf[msg.sender] -= debit;
        balanceOf[to] += amount;
        totalSupply -= fee;
        return true;
    }
}

contract BoardroomTestAllowAllPolicy is IBoardroomCallPolicy {
    function canCall(address, address, address, uint256, bytes calldata) external pure returns (bool) {
        return true;
    }
}

contract ToggleRevertingRedeemableCurrency is BoardroomCurrency {
    bool public transfersRevert = true;

    constructor() BoardroomCurrency("Toggle", "TGL", 18) {}

    function setTransfersRevert(bool transfersRevert_) external {
        transfersRevert = transfersRevert_;
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        if (transfersRevert) revert();
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract ToggleUnreadableRedeemableCurrency {
    bool public readable = true;
    mapping(address => uint256) internal balances;

    function setReadable(bool readable_) external {
        readable = readable_;
    }

    function balanceOf(address account) external view returns (uint256) {
        if (!readable) revert();
        return balances[account];
    }

    function mint(address to, uint256 amount) external {
        balances[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balances[msg.sender] -= amount;
        balances[to] += amount;
        return true;
    }
}

contract GasBurningBalanceToken {
    function balanceOf(address) external pure returns (uint256) {
        assembly ("memory-safe") {
            for {} 1 {} {}
        }
        return 0;
    }
}

interface IFlashShareCallback {
    function flashShareCallback() external;
}

contract FlashShareLender {
    BoardroomToken public immutable token;

    constructor(BoardroomToken token_) {
        token = token_;
    }

    function flash(address borrower, uint256 amount) external {
        token.transfer(borrower, amount);
        IFlashShareCallback(borrower).flashShareCallback();
        token.transferFrom(borrower, address(this), amount);
    }
}

contract FlashGovernanceAttacker is IFlashShareCallback {
    Boardroom public immutable boardroom;
    FlashShareLender public immutable lender;
    BoardroomToken public immutable token;

    constructor(Boardroom boardroom_, FlashShareLender lender_) {
        boardroom = boardroom_;
        lender = lender_;
        token = BoardroomToken(boardroom_.shareToken());
    }

    function attack(uint256 amount) external {
        lender.flash(address(this), amount);
    }

    function flashShareCallback() external {
        boardroom.startWindDown();
        token.approve(address(lender), type(uint256).max);
    }
}

contract AmmFlashGovernanceAttacker {
    Boardroom public immutable boardroom;
    AmmPool public immutable pool;
    bool public immutable shareIsToken0;

    constructor(Boardroom boardroom_, AmmPool pool_) {
        boardroom = boardroom_;
        pool = pool_;
        shareIsToken0 = pool_.token0() == boardroom_.shareToken();
    }

    function attack(uint256 amount) external {
        pool.swap(shareIsToken0 ? amount : 0, shareIsToken0 ? 0 : amount, address(this), hex"01");
    }

    function ammCall(address, uint256, uint256, bytes calldata) external {
        boardroom.startWindDown();
    }
}

contract BoardroomHookTarget {
    uint256 public value;

    function setValue(uint256 value_) external {
        value = value_;
    }
}

contract BoardroomFailingObligationPolicy is IBoardroomObligationPolicy {
    error HookFailed();

    function canCall(address, address, address, uint256, bytes calldata) external pure returns (bool) {
        return true;
    }

    function obligationForCall(address, address, uint256, bytes calldata, bytes calldata)
        external
        pure
        returns (Obligation memory)
    {
        revert HookFailed();
    }

    function isLifecycleCallAllowed(address, address, bytes4) external pure returns (bool) {
        return false;
    }

    function grantSlotReleaseForLifecycleCall(address, address, bytes4) external pure returns (address) {
        return address(0);
    }
}

contract BoardroomTest is Test {
    struct BoardroomGrantCreate {
        address token;
        address holder;
        address paymentToken;
        uint256 amount;
        uint256 price;
        bytes32 salt;
        uint256 value;
    }

    BoardroomPolicyRegistry internal policyRegistry;
    AssetPolicy internal assetPolicy;
    TokenGrantFactory internal tokenGrantFactory;
    BoardroomFactory internal boardroomFactory;
    BoardroomGovernanceLogic internal governanceLogic;
    BoardroomRedemptionPayout internal redemptionPayoutLogic;
    BoardroomCurrency internal paymentToken;
    WETH internal wrappedNative;

    address internal owner = address(0xA11CE);
    address internal holder = address(0xB0B);
    address internal stranger = address(0xCAFE);

    uint256 internal constant GRANT_SIZE = 100 ether;
    uint256 internal constant PRICE = 2_000000;
    uint256 internal constant PAYROLL_AMOUNT = 20_000000;
    uint256 internal constant CLIFF = 1_000;
    uint256 internal constant VESTING_END = 2_000;
    uint256 internal constant EXPIRY = VESTING_END + 2 days;

    event PolicyAllowedSet(address indexed policy, bool allowed);

    function setUp() public {
        wrappedNative = new WETH();
        policyRegistry = new BoardroomPolicyRegistry(address(this));
        assetPolicy = new AssetPolicy(address(this), address(wrappedNative));
        governanceLogic = new BoardroomGovernanceLogic();
        redemptionPayoutLogic = new BoardroomRedemptionPayout();
        boardroomFactory = new BoardroomFactory(
            address(policyRegistry), address(wrappedNative), address(redemptionPayoutLogic), address(governanceLogic)
        );
        tokenGrantFactory = new TokenGrantFactory(address(this), address(boardroomFactory));
        paymentToken = new BoardroomCurrency("Payment", "PAY", 6);

        assetPolicy.setAssetAllowed(address(paymentToken), true);
        assetPolicy.setApprovalSpenderAllowed(address(tokenGrantFactory), true);

        policyRegistry.setPolicyAllowed(address(assetPolicy), true);
        policyRegistry.registerModulePolicy(address(tokenGrantFactory));

        paymentToken.mint(holder, 1_000_000000);
    }

    receive() external payable {}

    function testRegistryRejectsZeroOwnerAndZeroPolicy() public {
        vm.expectRevert(BoardroomPolicyRegistry.InvalidAddress.selector);
        new BoardroomPolicyRegistry(address(0));

        vm.expectRevert(BoardroomPolicyRegistry.InvalidAddress.selector);
        policyRegistry.setPolicyAllowed(address(0), true);
    }

    function testOnlyRegistryOwnerCanSetPolicy() public {
        vm.prank(stranger);
        vm.expectRevert(Ownable.Unauthorized.selector);
        policyRegistry.setPolicyAllowed(address(tokenGrantFactory), false);

        vm.expectEmit(true, false, false, true, address(policyRegistry));
        emit PolicyAllowedSet(address(tokenGrantFactory), false);
        policyRegistry.setPolicyAllowed(address(tokenGrantFactory), false);
        assertFalse(policyRegistry.isPolicyAllowed(address(tokenGrantFactory)));
    }

    function testFactoryRejectsZeroPolicyRegistry() public {
        vm.expectRevert(BoardroomFactory.InvalidAddress.selector);
        new BoardroomFactory(
            address(0), address(wrappedNative), address(redemptionPayoutLogic), address(governanceLogic)
        );

        vm.expectRevert(BoardroomFactory.InvalidAddress.selector);
        new BoardroomFactory(
            address(policyRegistry), address(0), address(redemptionPayoutLogic), address(governanceLogic)
        );

        vm.expectRevert(BoardroomFactory.InvalidAddress.selector);
        new BoardroomFactory(address(policyRegistry), address(wrappedNative), stranger, address(governanceLogic));
    }

    function testCreateBoardroomRejectsZeroOwner() public {
        vm.expectRevert(BoardroomFactory.InvalidAddress.selector);
        boardroomFactory.createBoardroom(address(0), "Acme Common", "ACME", keccak256("zero-owner"));
    }

    function testCreateBoardroomInitializesCloneAndShareToken() public {
        (Boardroom boardroom, address boardroomAddress) = _createBoardroom("create");

        assertEq(address(boardroom), boardroomAddress);
        assertTrue(boardroomFactory.isBoardroom(boardroomAddress));
        assertEq(boardroomFactory.allBoardrooms(0), boardroomAddress);
        assertEq(boardroomFactory.allBoardroomsLength(), 1);
        assertEq(boardroom.owner(), owner);
        assertEq(boardroom.policyRegistry(), address(policyRegistry));
        assertEq(boardroom.wrappedNative(), address(wrappedNative));
        assertEq(boardroomFactory.wrappedNative(), address(wrappedNative));

        BoardroomToken shareToken = BoardroomToken(boardroom.shareToken());
        assertEq(shareToken.boardroom(), boardroomAddress);
        assertEq(shareToken.name(), "Acme Common");
        assertEq(shareToken.symbol(), "ACME");
        assertEq(shareToken.decimals(), 18);
    }

    function testBoardroomSaltIsBoundToOwnerAndMetadata() public {
        bytes32 salt = keccak256("shared-boardroom-salt");
        address ownerPrediction = boardroomFactory.predictBoardroomAddress(owner, "Acme Common", "ACME", salt);
        address strangerPrediction = boardroomFactory.predictBoardroomAddress(stranger, "Acme Common", "ACME", salt);
        address metadataPrediction = boardroomFactory.predictBoardroomAddress(owner, "Acme Preferred", "ACMP", salt);

        assertNotEq(ownerPrediction, strangerPrediction);
        assertNotEq(ownerPrediction, metadataPrediction);

        address strangerBoardroom = boardroomFactory.createBoardroom(stranger, "Stranger Common", "STR", salt);
        address metadataBoardroom = boardroomFactory.createBoardroom(owner, "Acme Preferred", "ACMP", salt);
        address ownerBoardroom = boardroomFactory.createBoardroom(owner, "Acme Common", "ACME", salt);

        assertEq(strangerBoardroom, boardroomFactory.predictBoardroomAddress(stranger, "Stranger Common", "STR", salt));
        assertEq(metadataBoardroom, metadataPrediction);
        assertEq(ownerBoardroom, ownerPrediction);
        assertEq(Boardroom(payable(strangerBoardroom)).owner(), stranger);
        assertEq(Boardroom(payable(metadataBoardroom)).owner(), owner);
        assertEq(Boardroom(payable(ownerBoardroom)).owner(), owner);
        assertEq(BoardroomToken(Boardroom(payable(metadataBoardroom)).shareToken()).name(), "Acme Preferred");
        assertEq(BoardroomToken(Boardroom(payable(ownerBoardroom)).shareToken()).name(), "Acme Common");
        assertTrue(boardroomFactory.isBoardroom(strangerBoardroom));
        assertTrue(boardroomFactory.isBoardroom(metadataBoardroom));
        assertTrue(boardroomFactory.isBoardroom(ownerBoardroom));
        assertEq(boardroomFactory.allBoardroomsLength(), 3);
    }

    function testOnlyOwnerCanMintShares() public {
        (Boardroom boardroom,) = _createBoardroom("mint");

        vm.prank(stranger);
        vm.expectRevert(Ownable.Unauthorized.selector);
        boardroom.mint(holder, 1 ether);

        vm.prank(owner);
        boardroom.mint(holder, 1 ether);

        BoardroomToken shareToken = BoardroomToken(boardroom.shareToken());
        assertEq(shareToken.balanceOf(holder), 1 ether);
        assertEq(shareToken.totalSupply(), 1 ether);
    }

    function testPrelaunchOwnershipTransferSyncsDefaultExecutor() public {
        (Boardroom boardroom,) = _createBoardroom("owner-transfer-executor");

        vm.prank(owner);
        boardroom.transferOwnership(stranger);

        assertEq(boardroom.owner(), stranger);
        assertEq(boardroom.executor(), stranger);

        vm.prank(stranger);
        boardroom.mint(stranger, 1 ether);
        vm.prank(stranger);
        boardroom.launch(1 days);

        Boardroom.Call memory call_ = _rawCall(address(boardroom), 0, abi.encodeCall(Boardroom.setExecutor, (owner)));

        vm.prank(owner);
        vm.expectRevert(Ownable.Unauthorized.selector);
        boardroom.queueAction(call_, keccak256("old-owner-queue"));

        vm.prank(stranger);
        boardroom.queueAction(call_, keccak256("new-owner-queue"));
    }

    function testPrelaunchOwnershipHandoverSyncsDefaultExecutor() public {
        (Boardroom boardroom,) = _createBoardroom("owner-handover-executor");

        vm.prank(stranger);
        boardroom.requestOwnershipHandover();

        vm.prank(owner);
        boardroom.completeOwnershipHandover(stranger);

        assertEq(boardroom.owner(), stranger);
        assertEq(boardroom.executor(), stranger);
    }

    function testPrelaunchOwnershipTransferPreservesExplicitExecutor() public {
        (Boardroom boardroom,) = _createBoardroom("explicit-executor-transfer");

        vm.startPrank(owner);
        boardroom.setExecutor(stranger);
        boardroom.transferOwnership(holder);
        vm.stopPrank();

        assertEq(boardroom.owner(), holder);
        assertEq(boardroom.executor(), stranger);

        vm.prank(holder);
        boardroom.mint(holder, 1 ether);
        vm.prank(holder);
        boardroom.launch(1 days);

        Boardroom.Call memory call_ = _rawCall(address(boardroom), 0, abi.encodeCall(Boardroom.setExecutor, (owner)));

        vm.prank(holder);
        vm.expectRevert(Ownable.Unauthorized.selector);
        boardroom.queueAction(call_, keccak256("new-owner-queue"));

        vm.prank(stranger);
        boardroom.queueAction(call_, keccak256("explicit-executor-queue"));
    }

    function testOnlyBoardroomCanMintShareToken() public {
        (Boardroom boardroom,) = _createBoardroom("token-mint-auth");
        BoardroomToken shareToken = BoardroomToken(boardroom.shareToken());

        vm.expectRevert(BoardroomToken.OnlyBoardroom.selector);
        shareToken.mint(holder, 1 ether);

        vm.expectRevert(BoardroomToken.OnlyBoardroom.selector);
        shareToken.burn(holder, 1 ether);
    }

    function testMintRejectsZeroAddressAndZeroAmount() public {
        (Boardroom boardroom,) = _createBoardroom("mint-invalid");

        vm.startPrank(owner);
        vm.expectRevert(Boardroom.InvalidAddress.selector);
        boardroom.mint(address(0), 1);

        vm.expectRevert(Boardroom.InvalidAmount.selector);
        boardroom.mint(holder, 0);
        vm.stopPrank();
    }

    function testOnlyOwnerCanExecute() public {
        (Boardroom boardroom,) = _createBoardroom("execute-auth");
        BoardroomToken shareToken = BoardroomToken(boardroom.shareToken());

        vm.prank(stranger);
        vm.expectRevert(Ownable.Unauthorized.selector);
        boardroom.execute(
            _assetCall(
                address(shareToken),
                0,
                abi.encodeWithSignature("approve(address,uint256)", address(tokenGrantFactory), GRANT_SIZE)
            )
        );
    }

    function testExecuteRejectsUnregisteredPolicy() public {
        (Boardroom boardroom,) = _createBoardroom("execute-policy");
        policyRegistry.setPolicyAllowed(address(assetPolicy), false);

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Boardroom.PolicyNotAllowed.selector, address(assetPolicy)));
        boardroom.execute(
            _assetCall(
                address(paymentToken),
                0,
                abi.encodeWithSignature("approve(address,uint256)", address(tokenGrantFactory), PAYROLL_AMOUNT)
            )
        );
    }

    function testExecuteRejectsPolicyDeniedCall() public {
        (Boardroom boardroom,) = _createBoardroom("execute-denied");

        bytes memory data = abi.encodeCall(BoardroomCurrency.transfer, (holder, 1));

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                Boardroom.CallNotAllowed.selector,
                address(assetPolicy),
                address(paymentToken),
                BoardroomCurrency.transfer.selector
            )
        );
        boardroom.execute(_assetCall(address(paymentToken), 0, data));
    }

    function testExecuteBatchRejectsEmptyAndTooManyCalls() public {
        (Boardroom boardroom,) = _createBoardroom("execute-bounds");

        Boardroom.Call[] memory emptyCalls = new Boardroom.Call[](0);
        vm.prank(owner);
        vm.expectRevert(Boardroom.EmptyBatch.selector);
        boardroom.executeBatch(emptyCalls);

        uint256 maxBatchCalls = boardroom.MAX_BATCH_CALLS();
        Boardroom.Call[] memory tooManyCalls = new Boardroom.Call[](maxBatchCalls + 1);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Boardroom.TooManyCalls.selector, maxBatchCalls + 1, maxBatchCalls));
        boardroom.executeBatch(tooManyCalls);
    }

    function testPrelaunchOwnerCanExecuteGovernanceSelfCalls() public {
        (Boardroom boardroom,) = _createBoardroom("prelaunch-governance-self-calls");
        BoardroomCurrency redeemable = new BoardroomCurrency("Redeemable", "RDM", 18);

        Boardroom.Call[] memory calls = new Boardroom.Call[](2);
        calls[0] = _rawCall(address(boardroom), 0, abi.encodeCall(Boardroom.mint, (holder, 1 ether)));
        calls[1] =
            _rawCall(address(boardroom), 0, abi.encodeCall(Boardroom.registerRedeemableAsset, (address(redeemable))));

        vm.prank(owner);
        boardroom.executeBatch(calls);

        assertEq(BoardroomToken(boardroom.shareToken()).balanceOf(holder), 1 ether);
        assertTrue(boardroom.isRedeemableAsset(address(redeemable)));
    }

    function testLaunchedBoardroomQueuesAndAnyoneExecutesReadyAction() public {
        (Boardroom boardroom,) = _createBoardroom("launched-queue-execute");
        uint256 delay = 2 days;

        vm.prank(owner);
        boardroom.mint(owner, 1 ether);
        vm.prank(owner);
        boardroom.launch(delay);

        Boardroom.Call memory call_ = _rawCall(address(boardroom), 0, abi.encodeCall(Boardroom.mint, (holder, 1 ether)));
        bytes32 salt = keccak256("mint-after-launch");
        bytes32 actionHash = boardroom.hashAction(call_, salt);

        vm.prank(owner);
        vm.expectRevert(Boardroom.BoardroomAlreadyLaunched.selector);
        boardroom.execute(call_);

        vm.prank(stranger);
        vm.expectRevert(Ownable.Unauthorized.selector);
        boardroom.queueAction(call_, salt);

        vm.prank(owner);
        (bytes32 queuedHash, uint256 eta) = boardroom.queueAction(call_, salt);

        assertEq(queuedHash, actionHash);
        assertEq(eta, block.timestamp + delay);
        assertEq(_actionEta(boardroom, actionHash), eta);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Boardroom.ActionNotReady.selector, actionHash, eta, block.timestamp));
        boardroom.executeQueuedAction(call_, salt);

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Boardroom.ActionNotReady.selector, actionHash, eta, block.timestamp));
        boardroom.executeQueuedAction(call_, salt);

        vm.warp(eta);
        vm.prank(stranger);
        boardroom.executeQueuedAction(call_, salt);

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Boardroom.ActionNotQueued.selector, actionHash));
        boardroom.executeQueuedAction(call_, salt);

        BoardroomToken shareToken = BoardroomToken(boardroom.shareToken());
        assertEq(shareToken.balanceOf(holder), 1 ether);
        assertEq(_actionEta(boardroom, actionHash), 0);
    }

    function testLaunchRejectsZeroAndExcessiveGovernanceDelay() public {
        (Boardroom boardroom,) = _createBoardroom("launched-delay-bounds");
        uint256 maximumDelay = boardroom.MAX_GOVERNANCE_DELAY();

        vm.startPrank(owner);
        vm.expectRevert(Boardroom.InvalidGovernanceDelay.selector);
        boardroom.launch(0);

        vm.expectRevert(Boardroom.InvalidGovernanceDelay.selector);
        boardroom.launch(maximumDelay + 1);

        boardroom.mint(holder, 1 ether);
        boardroom.launch(maximumDelay);
        vm.stopPrank();

        assertEq(boardroom.governanceDelay(), 30 days);
    }

    function testAnyoneCanExecuteReadyQueuedBatch() public {
        (Boardroom boardroom,) = _createBoardroom("launched-permissionless-batch");

        vm.prank(owner);
        boardroom.mint(owner, 1 ether);
        vm.prank(owner);
        boardroom.launch(1 days);

        Boardroom.Call[] memory calls = new Boardroom.Call[](2);
        calls[0] = _rawCall(address(boardroom), 0, abi.encodeCall(Boardroom.mint, (holder, 1 ether)));
        calls[1] = _rawCall(address(boardroom), 0, abi.encodeCall(Boardroom.mint, (stranger, 2 ether)));
        bytes32 salt = keccak256("permissionless-batch");

        vm.prank(owner);
        (, uint256 eta) = boardroom.queueBatch(calls, salt);

        vm.warp(eta);
        vm.prank(stranger);
        boardroom.executeQueuedBatch(calls, salt);

        BoardroomToken shares = BoardroomToken(boardroom.shareToken());
        assertEq(shares.balanceOf(holder), 1 ether);
        assertEq(shares.balanceOf(stranger), 2 ether);
    }

    function testLaunchedShareholderCanCancelQueuedActionAndStartWindDown() public {
        (Boardroom boardroom,) = _createBoardroom("launched-shareholder-veto");
        BoardroomToken shareToken = BoardroomToken(boardroom.shareToken());

        vm.startPrank(owner);
        boardroom.mint(holder, 1 ether);
        boardroom.launch(1 days);
        vm.stopPrank();
        vm.roll(block.number + 1);

        Boardroom.Call memory call_ = _rawCall(address(boardroom), 0, abi.encodeCall(Boardroom.setExecutor, (stranger)));
        bytes32 salt = keccak256("set-executor-after-launch");
        bytes32 actionHash = boardroom.hashAction(call_, salt);

        vm.prank(owner);
        boardroom.queueAction(call_, salt);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Boardroom.InsufficientHolderPower.selector, stranger, 0, 0, 0.01 ether));
        boardroom.cancelAction(actionHash);

        vm.prank(holder);
        boardroom.cancelAction(actionHash);

        assertEq(_actionEta(boardroom, actionHash), 0);

        vm.warp(block.timestamp + 1 days);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Boardroom.ActionNotQueued.selector, actionHash));
        boardroom.executeQueuedAction(call_, salt);

        assertEq(shareToken.balanceOf(holder), 1 ether);

        vm.prank(holder);
        boardroom.startWindDown();

        assertEq(uint8(boardroom.status()), uint8(Boardroom.BoardroomStatus.WindingDown));
    }

    function testLaunchedWindDownCanOpenRedemptionsWithoutExecutor() public {
        (Boardroom boardroom,) = _createBoardroom("launched-wind-down-open-redemptions");

        vm.startPrank(owner);
        boardroom.mint(holder, 1 ether);
        boardroom.launch(1 days);
        vm.stopPrank();
        vm.roll(block.number + 1);

        vm.prank(holder);
        boardroom.startWindDown();

        vm.warp(block.timestamp + 1 days);
        vm.prank(stranger);
        boardroom.openRedemptions();

        assertEq(uint8(boardroom.status()), uint8(Boardroom.BoardroomStatus.RedemptionsOpen));
    }

    function testLaunchedWindDownCanPermissionlesslyWrapNative() public {
        (Boardroom boardroom,) = _createBoardroom("launched-wind-down-wrap-native");

        vm.startPrank(owner);
        boardroom.mint(holder, 1 ether);
        boardroom.launch(1 days);
        vm.stopPrank();
        vm.roll(block.number + 1);

        vm.prank(holder);
        boardroom.startWindDown();
        _sendNative(address(boardroom), 1 ether);

        vm.prank(stranger);
        boardroom.wrapNativeBalance();

        assertEq(address(boardroom).balance, 0);
        assertEq(wrappedNative.balanceOf(address(boardroom)), 1 ether);
    }

    function testLaunchRejectsZeroAndTreasuryOnlySupply() public {
        (Boardroom boardroom,) = _createBoardroom("launch-circulating-supply");

        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(Boardroom.InvalidLaunchSupply.selector, 0));
        boardroom.launch(1 days);

        boardroom.mint(address(boardroom), 10 ether);
        vm.expectRevert(abi.encodeWithSelector(Boardroom.InvalidLaunchSupply.selector, 0));
        boardroom.launch(1 days);
        vm.stopPrank();
    }

    function testCannotLaunchAfterPrelaunchWindDown() public {
        (Boardroom boardroom,) = _createBoardroom("launch-after-wind-down");

        vm.startPrank(owner);
        boardroom.mint(holder, 1 ether);
        boardroom.startWindDown();
        vm.expectRevert(
            abi.encodeWithSelector(
                Boardroom.InvalidStatus.selector,
                Boardroom.BoardroomStatus.Active,
                Boardroom.BoardroomStatus.WindingDown
            )
        );
        boardroom.launch(1 days);
        vm.stopPrank();
    }

    function testFlashBorrowedSharesCannotStartWindDown() public {
        (Boardroom boardroom,) = _createBoardroom("flash-holder-threshold");
        BoardroomToken shares = BoardroomToken(boardroom.shareToken());
        FlashShareLender lender = new FlashShareLender(shares);
        FlashGovernanceAttacker attacker = new FlashGovernanceAttacker(boardroom, lender);

        vm.startPrank(owner);
        boardroom.mint(address(lender), 100 ether);
        boardroom.launch(1 days);
        vm.stopPrank();
        vm.roll(block.number + 1);

        vm.expectRevert(
            abi.encodeWithSelector(
                Boardroom.InsufficientHolderPower.selector, address(attacker), 100 ether, 0, 10 ether
            )
        );
        attacker.attack(100 ether);

        assertEq(uint8(boardroom.status()), uint8(Boardroom.BoardroomStatus.Active));
        assertEq(shares.balanceOf(address(lender)), 100 ether);
        assertEq(shares.balanceOf(address(attacker)), 0);
    }

    function testAmmFlashSwapCallbackCannotStartWindDown() public {
        (Boardroom boardroom,) = _createBoardroom("amm-flash-holder-threshold");
        BoardroomToken shares = BoardroomToken(boardroom.shareToken());
        BoardroomCurrency quote = new BoardroomCurrency("Quote", "QUOTE", 18);
        AmmFactory ammFactory = new AmmFactory(address(this));
        AmmPool pool = AmmPool(ammFactory.createPool(address(shares), address(quote)));

        vm.startPrank(owner);
        boardroom.mint(owner, 100 ether);
        shares.transfer(address(pool), 100 ether);
        quote.mint(address(pool), 100 ether);
        pool.mint(owner);
        boardroom.launch(1 days);
        vm.stopPrank();
        vm.roll(block.number + 1);

        AmmFlashGovernanceAttacker attacker = new AmmFlashGovernanceAttacker(boardroom, pool);
        vm.expectRevert(
            abi.encodeWithSelector(Boardroom.InsufficientHolderPower.selector, address(attacker), 20 ether, 0, 10 ether)
        );
        attacker.attack(20 ether);

        assertEq(uint8(boardroom.status()), uint8(Boardroom.BoardroomStatus.Active));
        assertEq(shares.balanceOf(address(attacker)), 0);
    }

    function testStaleAndNewlyReceivedBalancesCannotStartWindDown() public {
        (Boardroom boardroom,) = _createBoardroom("stale-holder-threshold");
        BoardroomToken shares = BoardroomToken(boardroom.shareToken());

        vm.startPrank(owner);
        boardroom.mint(holder, 100 ether);
        boardroom.launch(1 days);
        vm.stopPrank();
        vm.roll(block.number + 1);

        vm.prank(holder);
        shares.transfer(stranger, 100 ether);

        vm.prank(holder);
        vm.expectRevert(
            abi.encodeWithSelector(Boardroom.InsufficientHolderPower.selector, holder, 0, 100 ether, 10 ether)
        );
        boardroom.startWindDown();

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(Boardroom.InsufficientHolderPower.selector, stranger, 100 ether, 0, 10 ether)
        );
        boardroom.startWindDown();

        vm.roll(block.number + 1);
        vm.prank(stranger);
        boardroom.startWindDown();
        assertEq(uint8(boardroom.status()), uint8(Boardroom.BoardroomStatus.WindingDown));
    }

    function testQueuedActionExpires() public {
        (Boardroom boardroom,) = _createBoardroom("queued-action-expiry");
        vm.startPrank(owner);
        boardroom.mint(owner, 1 ether);
        boardroom.launch(1 days);
        Boardroom.Call memory call_ = _rawCall(address(boardroom), 0, abi.encodeCall(Boardroom.setExecutor, (stranger)));
        bytes32 salt = keccak256("expired-action");
        (bytes32 actionHash, uint256 eta) = boardroom.queueAction(call_, salt);
        vm.stopPrank();

        (, uint256 actionGracePeriod,,) = boardroom.governanceConfig();
        uint256 expiresAt = eta + actionGracePeriod;
        vm.warp(expiresAt + 1);
        vm.expectRevert(abi.encodeWithSelector(Boardroom.ActionExpired.selector, actionHash, expiresAt, expiresAt + 1));
        boardroom.executeQueuedAction(call_, salt);
    }

    function testExecutorChangeInvalidatesOtherQueuedActions() public {
        (Boardroom boardroom,) = _createBoardroom("executor-epoch-invalidation");
        vm.startPrank(owner);
        boardroom.mint(owner, 1 ether);
        boardroom.launch(1 days);

        Boardroom.Call memory mintCall =
            _rawCall(address(boardroom), 0, abi.encodeCall(Boardroom.mint, (holder, 1 ether)));
        Boardroom.Call memory executorCall =
            _rawCall(address(boardroom), 0, abi.encodeCall(Boardroom.setExecutor, (stranger)));
        bytes32 mintSalt = keccak256("stale-mint");
        bytes32 executorSalt = keccak256("change-executor");
        (bytes32 mintHash, uint256 eta) = boardroom.queueAction(mintCall, mintSalt);
        boardroom.queueAction(executorCall, executorSalt);
        vm.stopPrank();

        vm.warp(eta);
        boardroom.executeQueuedAction(executorCall, executorSalt);
        assertEq(boardroom.executor(), stranger);
        (uint256 currentEpoch,,,,) = boardroom.governanceState(bytes32(0));
        assertEq(currentEpoch, 2);

        vm.expectRevert(abi.encodeWithSelector(Boardroom.ActionContextMismatch.selector, mintHash));
        boardroom.executeQueuedAction(mintCall, mintSalt);
    }

    function testWindDownInvalidatesActiveQueuedActions() public {
        (Boardroom boardroom,) = _createBoardroom("wind-down-epoch-invalidation");
        vm.startPrank(owner);
        boardroom.mint(holder, 1 ether);
        boardroom.launch(1 days);
        Boardroom.Call memory call_ =
            _rawCall(address(boardroom), 0, abi.encodeCall(Boardroom.mint, (stranger, 1 ether)));
        bytes32 salt = keccak256("active-only-action");
        (bytes32 actionHash,) = boardroom.queueAction(call_, salt);
        vm.stopPrank();
        vm.roll(block.number + 1);

        vm.prank(holder);
        boardroom.startWindDown();

        vm.expectRevert(abi.encodeWithSelector(Boardroom.ActionContextMismatch.selector, actionHash));
        boardroom.executeQueuedAction(call_, salt);
    }

    function testLostExecutorCannotBlockHolderWindDownOrFinalization() public {
        (Boardroom boardroom,) = _createBoardroom("lost-executor-exit");
        address lostExecutor = address(0xDEAD);

        vm.startPrank(owner);
        boardroom.mint(holder, 1 ether);
        boardroom.setExecutor(lostExecutor);
        boardroom.launch(1 days);
        vm.stopPrank();
        vm.roll(block.number + 1);

        vm.prank(holder);
        boardroom.startWindDown();
        vm.warp(block.timestamp + 1 days);

        vm.prank(stranger);
        boardroom.openRedemptions();
        assertEq(uint8(boardroom.status()), uint8(Boardroom.BoardroomStatus.RedemptionsOpen));
    }

    function testBoardroomCanIssueFreeGrantForItsShares() public {
        (Boardroom boardroom,) = _createBoardroom("issue-free-grant");
        BoardroomToken shareToken = BoardroomToken(boardroom.shareToken());

        vm.prank(owner);
        boardroom.mint(address(boardroom), GRANT_SIZE);

        bytes32 grantSalt = keccak256("boardroom-free-grant");
        address grantAddress = tokenGrantFactory.predictGrantAddress(address(boardroom), grantSalt);

        TokenGrant grant = _createBoardroomGrant(
            boardroom, _boardroomGrantCreate(address(shareToken), holder, address(0), GRANT_SIZE, 0, grantSalt, 0)
        );

        assertEq(address(grant), grantAddress);
        assertEq(grant.issuer(), address(boardroom));
        assertEq(grant.holder(), holder);
        assertEq(grant.token(), address(shareToken));
        assertEq(grant.paymentToken(), address(0));
        assertEq(grant.price(), 0);
        assertEq(shareToken.balanceOf(address(boardroom)), 0);
        assertEq(shareToken.balanceOf(grantAddress), GRANT_SIZE);
        assertEq(shareToken.allowance(address(boardroom), address(tokenGrantFactory)), 0);

        vm.warp(VESTING_END);
        vm.prank(holder);
        grant.settle(10 ether);

        assertEq(shareToken.balanceOf(holder), 10 ether);
    }

    function testExternalGrantAssetReturnsIntoWindDownRedemptions() public {
        (Boardroom boardroom,) = _createBoardroom("external-grant-asset-redemption");
        BoardroomCurrency grantToken = new BoardroomCurrency("Grant Asset", "GAST", 18);
        assetPolicy.setAssetAllowed(address(grantToken), true);
        grantToken.mint(address(boardroom), GRANT_SIZE);

        vm.prank(owner);
        boardroom.mint(holder, 1 ether);
        TokenGrant grant = _createBoardroomGrant(
            boardroom,
            _boardroomGrantCreate(
                address(grantToken), holder, address(0), GRANT_SIZE, 0, keccak256("external-grant-asset"), 0
            )
        );
        assertTrue(boardroom.isRedeemableAsset(address(grantToken)));

        vm.prank(owner);
        boardroom.startWindDown();
        vm.prank(stranger);
        boardroom.executeWindDownCall(
            _tokenGrantFactoryCall(address(grant), 0, abi.encodeCall(TokenGrant.stopVestingAndWithdrawUnvested, ()))
        );
        vm.prank(stranger);
        boardroom.openRedemptions();

        uint256[] memory minimums = new uint256[](2);
        vm.prank(holder);
        uint256[] memory amounts = boardroom.redeem(1 ether, holder, minimums);

        assertEq(amounts[1], GRANT_SIZE);
        assertEq(grantToken.balanceOf(holder), GRANT_SIZE);
        assertEq(grantToken.balanceOf(address(boardroom)), 0);
    }

    function testBoardroomCanSellSharesAndFundPayrollGrant() public {
        (Boardroom boardroom,) = _createBoardroom("sell-shares-payroll");
        BoardroomToken shareToken = BoardroomToken(boardroom.shareToken());

        vm.prank(owner);
        boardroom.mint(address(boardroom), GRANT_SIZE);

        bytes32 shareGrantSalt = keccak256("boardroom-paid-grant");
        TokenGrant shareGrant = _createBoardroomGrant(
            boardroom,
            _boardroomGrantCreate(
                address(shareToken), holder, address(paymentToken), GRANT_SIZE, PRICE, shareGrantSalt, 0
            )
        );
        assertTrue(boardroom.isRedeemableAsset(address(paymentToken)));

        uint256 settleAmount = 10 ether;
        uint256 expectedCost = shareGrant.getSettlementCost(settleAmount);
        vm.warp(VESTING_END);

        vm.prank(holder);
        paymentToken.approve(address(shareGrant), expectedCost);

        vm.prank(holder);
        shareGrant.settle(settleAmount);

        assertEq(shareToken.balanceOf(holder), settleAmount);
        assertEq(paymentToken.balanceOf(address(boardroom)), expectedCost);

        bytes32 payrollSalt = keccak256("boardroom-payroll-grant");
        TokenGrant payrollGrant = _createBoardroomGrant(
            boardroom,
            _boardroomGrantCreate(address(paymentToken), stranger, address(0), expectedCost, 0, payrollSalt, 0)
        );

        assertEq(payrollGrant.issuer(), address(boardroom));
        assertEq(payrollGrant.holder(), stranger);
        assertEq(payrollGrant.token(), address(paymentToken));
        assertEq(paymentToken.balanceOf(address(boardroom)), 0);
        assertEq(paymentToken.balanceOf(address(payrollGrant)), expectedCost);

        vm.prank(stranger);
        payrollGrant.settle(expectedCost);

        assertEq(paymentToken.balanceOf(stranger), expectedCost);
    }

    function testBoardroomCanCallOwnedGrantThroughFactoryPolicy() public {
        (Boardroom boardroom,) = _createBoardroom("grant-maintenance");
        BoardroomToken shareToken = BoardroomToken(boardroom.shareToken());

        vm.prank(owner);
        boardroom.mint(address(boardroom), GRANT_SIZE);

        TokenGrant grant = _createBoardroomGrant(
            boardroom,
            _boardroomGrantCreate(
                address(shareToken), holder, address(0), GRANT_SIZE, 0, keccak256("halt-owned-grant"), 0
            )
        );

        vm.warp(CLIFF - 1);
        vm.prank(owner);
        boardroom.execute(
            _tokenGrantFactoryCall(address(grant), 0, abi.encodeCall(TokenGrant.stopVestingAndWithdrawUnvested, ()))
        );

        assertTrue(grant.isClosed());
        assertEq(grant.claimable(), 0);
        assertEq(shareToken.balanceOf(address(boardroom)), GRANT_SIZE);
        assertEq(boardroom.issuedGrantCount(), 0);
        assertFalse(boardroom.isIssuedGrant(address(grant)));
        assertEq(boardroom.obligationPolicyOf(address(grant)), address(tokenGrantFactory));
    }

    function testPermissionlessPruningRestoresCapacityAfterHolderClosesGrant() public {
        (Boardroom boardroom,) = _createBoardroom("permissionless-grant-prune");
        BoardroomToken shareToken = BoardroomToken(boardroom.shareToken());

        vm.prank(owner);
        boardroom.mint(address(boardroom), 2 * GRANT_SIZE);

        TokenGrant firstGrant = _createBoardroomGrant(
            boardroom,
            _boardroomGrantCreate(
                address(shareToken), holder, address(0), GRANT_SIZE, 0, keccak256("holder-closes-grant"), 0
            )
        );

        vm.warp(VESTING_END);
        vm.prank(holder);
        firstGrant.settle(GRANT_SIZE);

        assertTrue(firstGrant.isClosed());
        assertEq(boardroom.issuedGrantCount(), 1);

        vm.prank(stranger);
        boardroom.pruneClosedObligations();

        assertEq(boardroom.issuedGrantCount(), 0);
        assertFalse(boardroom.isIssuedGrant(address(firstGrant)));
        assertEq(boardroom.obligationPolicyOf(address(firstGrant)), address(tokenGrantFactory));

        TokenGrant secondGrant = _createBoardroomGrant(
            boardroom,
            _boardroomGrantCreate(
                address(shareToken), stranger, address(0), GRANT_SIZE, 0, keccak256("capacity-restored"), 0
            )
        );
        assertEq(boardroom.issuedGrantCount(), 1);
        assertTrue(boardroom.isIssuedGrant(address(secondGrant)));
    }

    function testBoardroomCannotCallGrantIssuedByAnotherAccount() public {
        (Boardroom boardroom,) = _createBoardroom("foreign-grant");
        paymentToken.mint(owner, PAYROLL_AMOUNT);

        bytes32 salt = keccak256("owner-issued-grant");
        address grantAddress = tokenGrantFactory.predictGrantAddress(owner, salt);

        vm.prank(owner);
        paymentToken.approve(address(tokenGrantFactory), PAYROLL_AMOUNT);

        vm.prank(owner);
        address created = tokenGrantFactory.createGrant(
            holder, address(paymentToken), address(0), PAYROLL_AMOUNT, 0, EXPIRY, CLIFF, VESTING_END, false, 0, salt
        );

        assertEq(created, grantAddress);

        bytes memory data = abi.encodeCall(TokenGrant.stopVestingAndWithdrawUnvested, ());
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                Boardroom.CallNotAllowed.selector,
                address(tokenGrantFactory),
                grantAddress,
                TokenGrant.stopVestingAndWithdrawUnvested.selector
            )
        );
        boardroom.execute(_tokenGrantFactoryCall(grantAddress, 0, data));
    }

    function testBoardroomForwardsGrantCreationFee() public {
        uint256 fee = 0.01 ether;
        tokenGrantFactory.setCreationFee(fee);

        (Boardroom boardroom,) = _createBoardroom("issue-fee-grant");

        vm.prank(owner);
        boardroom.mint(address(boardroom), GRANT_SIZE);

        bytes32 grantSalt = keccak256("boardroom-fee-grant");
        address grantAddress = tokenGrantFactory.predictGrantAddress(address(boardroom), grantSalt);

        vm.deal(owner, fee);
        uint256 recipientBalanceBefore = address(this).balance;
        TokenGrant grant = _createBoardroomGrant(
            boardroom, _boardroomGrantCreate(boardroom.shareToken(), holder, address(0), GRANT_SIZE, 0, grantSalt, fee)
        );

        assertEq(address(grant), grantAddress);
        assertEq(address(this).balance, recipientBalanceBefore + fee);
        assertEq(address(boardroom).balance, 0);
    }

    function testBoardroomWrapsNativeBalanceWhenWindDownStarts() public {
        (Boardroom boardroom,) = _createBoardroom("wind-down-wrap-native");
        uint256 nativeAmount = 3 ether;

        vm.deal(address(boardroom), nativeAmount);

        vm.prank(owner);
        boardroom.startWindDown();

        assertEq(uint8(boardroom.status()), uint8(Boardroom.BoardroomStatus.WindingDown));
        assertEq(address(boardroom).balance, 0);
        assertEq(wrappedNative.balanceOf(address(boardroom)), nativeAmount);
    }

    function testBoardroomStartWindDownWorksWithZeroNativeBalance() public {
        (Boardroom boardroom,) = _createBoardroom("wind-down-zero-native");

        vm.prank(owner);
        boardroom.startWindDown();

        assertEq(uint8(boardroom.status()), uint8(Boardroom.BoardroomStatus.WindingDown));
        assertEq(address(boardroom).balance, 0);
        assertEq(wrappedNative.balanceOf(address(boardroom)), 0);
    }

    function testOpenRedemptionsWrapsNativeReceivedAfterWindDownStarts() public {
        (Boardroom boardroom,) = _createBoardroom("wind-down-late-native");
        uint256 initialNativeAmount = 1 ether;
        uint256 lateNativeAmount = 2 ether;

        vm.deal(address(boardroom), initialNativeAmount);

        vm.prank(owner);
        boardroom.startWindDown();

        _sendNative(address(boardroom), lateNativeAmount);

        vm.prank(owner);
        boardroom.openRedemptions();

        assertEq(uint8(boardroom.status()), uint8(Boardroom.BoardroomStatus.RedemptionsOpen));
        assertEq(address(boardroom).balance, 0);
        assertEq(wrappedNative.balanceOf(address(boardroom)), initialNativeAmount + lateNativeAmount);
    }

    function testNativeReceivedAfterRedemptionsOpenIsSweptAsExcess() public {
        (Boardroom boardroom,) = _createBoardroom("redemptions-late-native");
        uint256 holderShares = 100 ether;
        uint256 lateNativeAmount = 5 ether;

        vm.startPrank(owner);
        boardroom.mint(holder, holderShares);
        boardroom.startWindDown();
        boardroom.openRedemptions();
        vm.stopPrank();

        _sendNative(address(boardroom), lateNativeAmount);

        uint256[] memory minimums = new uint256[](1);

        vm.prank(holder);
        uint256[] memory amounts = boardroom.redeem(holderShares, holder, minimums);

        assertEq(amounts[0], 0);
        assertEq(wrappedNative.balanceOf(holder), 0);
        assertEq(address(boardroom).balance, 0);
        assertEq(wrappedNative.balanceOf(address(boardroom)), lateNativeAmount);

        vm.prank(stranger);
        assertEq(boardroom.sweepRedemptionExcess(address(wrappedNative)), lateNativeAmount);
        assertEq(wrappedNative.balanceOf(owner), lateNativeAmount);
    }

    function testBoardroomCanRedeemWrappedNativeAfterWindDownWrap() public {
        (Boardroom boardroom,) = _createBoardroom("wind-down-redeem-whype");
        uint256 holderShares = 100 ether;
        uint256 strangerShares = 300 ether;
        uint256 nativeAmount = 4 ether;

        vm.startPrank(owner);
        boardroom.mint(holder, holderShares);
        boardroom.mint(stranger, strangerShares);
        vm.stopPrank();

        vm.deal(address(boardroom), nativeAmount);

        vm.startPrank(owner);
        boardroom.startWindDown();
        boardroom.openRedemptions();
        vm.stopPrank();

        uint256[] memory minimums = new uint256[](1);
        minimums[0] = 1 ether;

        vm.prank(holder);
        uint256[] memory amounts = boardroom.redeem(holderShares, holder, minimums);

        assertEq(amounts[0], 1 ether);
        assertEq(wrappedNative.balanceOf(holder), 1 ether);
        assertEq(wrappedNative.balanceOf(address(boardroom)), 3 ether);
        assertEq(address(boardroom).balance, 0);
    }

    function testCreationFeeReachesExplicitBoardroomRecipientAfterFactoryOwnershipTransfer() public {
        uint256 fee = 0.01 ether;
        tokenGrantFactory.setCreationFee(fee);

        (Boardroom boardroom,) = _createBoardroom("issue-fee-grant-owned-factory");
        tokenGrantFactory.setFeeRecipient(address(boardroom));
        tokenGrantFactory.transferOwnership(address(boardroom));

        vm.prank(owner);
        boardroom.mint(address(boardroom), GRANT_SIZE);

        bytes32 grantSalt = keccak256("boardroom-owned-factory-fee-grant");
        vm.deal(owner, fee);
        TokenGrant grant = _createBoardroomGrant(
            boardroom, _boardroomGrantCreate(boardroom.shareToken(), holder, address(0), GRANT_SIZE, 0, grantSalt, fee)
        );

        assertEq(grant.issuer(), address(boardroom));
        assertEq(address(boardroom).balance, fee);
        assertEq(tokenGrantFactory.owner(), address(boardroom));
        assertEq(tokenGrantFactory.feeRecipient(), address(boardroom));

        vm.prank(owner);
        boardroom.startWindDown();

        assertEq(address(boardroom).balance, 0);
        assertEq(wrappedNative.balanceOf(address(boardroom)), fee);
    }

    function testBoardroomWindDownBurnsTreasurySharesAndRedeemsProRata() public {
        (Boardroom boardroom,) = _createBoardroom("wind-down-redemption");
        BoardroomCurrency redeemable = new BoardroomCurrency("Redeemable", "RDM", 6);
        uint256 holderShares = 100 ether;
        uint256 strangerShares = 300 ether;
        uint256 treasuryShares = 100 ether;
        uint256 redeemableAmount = 400_000000;

        vm.startPrank(owner);
        boardroom.mint(holder, holderShares);
        boardroom.mint(stranger, strangerShares);
        boardroom.mint(address(boardroom), treasuryShares);
        boardroom.registerRedeemableAsset(address(redeemable));
        vm.stopPrank();

        redeemable.mint(address(boardroom), redeemableAmount);

        vm.startPrank(owner);
        boardroom.startWindDown();
        boardroom.openRedemptions();
        vm.stopPrank();

        BoardroomToken shareToken = BoardroomToken(boardroom.shareToken());
        assertEq(uint8(boardroom.status()), uint8(Boardroom.BoardroomStatus.RedemptionsOpen));
        assertEq(shareToken.balanceOf(address(boardroom)), 0);
        assertEq(shareToken.totalSupply(), holderShares + strangerShares);

        uint256[] memory minimums = new uint256[](2);
        minimums[1] = 100_000000;

        vm.prank(holder);
        uint256[] memory holderAmounts = boardroom.redeem(holderShares, holder, minimums);

        assertEq(holderAmounts.length, 2);
        assertEq(holderAmounts[1], 100_000000);
        assertEq(redeemable.balanceOf(holder), 100_000000);
        assertEq(shareToken.balanceOf(holder), 0);

        minimums[1] = 300_000000;

        vm.prank(stranger);
        uint256[] memory strangerAmounts = boardroom.redeem(strangerShares, stranger, minimums);

        assertEq(strangerAmounts[1], 300_000000);
        assertEq(redeemable.balanceOf(stranger), 300_000000);
        assertEq(redeemable.balanceOf(address(boardroom)), 0);
        assertEq(shareToken.totalSupply(), 0);
    }

    function testBoardroomRedeemBurnsSharesSentToTreasuryAfterRedemptionsOpen() public {
        (Boardroom boardroom,) = _createBoardroom("wind-down-post-open-treasury-shares");
        BoardroomCurrency redeemable = new BoardroomCurrency("Redeemable", "RDM", 6);
        uint256 holderShares = 100 ether;
        uint256 strangerShares = 300 ether;
        uint256 redeemableAmount = 400_000000;

        vm.startPrank(owner);
        boardroom.mint(holder, holderShares);
        boardroom.mint(stranger, strangerShares);
        boardroom.registerRedeemableAsset(address(redeemable));
        redeemable.mint(address(boardroom), redeemableAmount);
        boardroom.startWindDown();
        boardroom.openRedemptions();
        vm.stopPrank();

        BoardroomToken shareToken = BoardroomToken(boardroom.shareToken());
        vm.prank(holder);
        assertTrue(shareToken.transfer(address(boardroom), holderShares));

        uint256[] memory minimums = new uint256[](2);
        minimums[1] = redeemableAmount;

        vm.prank(stranger);
        uint256[] memory amounts = boardroom.redeem(strangerShares, stranger, minimums);

        assertEq(amounts[1], redeemableAmount);
        assertEq(redeemable.balanceOf(stranger), redeemableAmount);
        assertEq(redeemable.balanceOf(address(boardroom)), 0);
        assertEq(shareToken.balanceOf(address(boardroom)), 0);
        assertEq(shareToken.totalSupply(), 0);
    }

    function testAllPostOpenTreasuryForfeitureMakesSnapshotSweepable() public {
        (Boardroom boardroom,) = _createBoardroom("post-open-total-forfeiture");
        BoardroomCurrency redeemable = new BoardroomCurrency("Redeemable", "RDM", 18);

        vm.startPrank(owner);
        boardroom.mint(holder, 100 ether);
        boardroom.registerRedeemableAsset(address(redeemable));
        redeemable.mint(address(boardroom), 100 ether);
        boardroom.startWindDown();
        boardroom.openRedemptions();
        vm.stopPrank();

        BoardroomToken shares = BoardroomToken(boardroom.shareToken());
        vm.prank(holder);
        shares.transfer(address(boardroom), 100 ether);

        vm.prank(stranger);
        assertEq(boardroom.burnTreasuryShares(), 100 ether);
        vm.prank(stranger);
        assertEq(boardroom.sweepRedemptionExcess(address(redeemable)), 100 ether);

        assertEq(redeemable.balanceOf(owner), 100 ether);
        assertEq(shares.totalSupply(), 0);
    }

    function testBoardroomRedeemRejectsSenderFeeRedeemableAsset() public {
        (Boardroom boardroom,) = _createBoardroom("wind-down-sender-fee-asset");
        SenderFeeRedeemableCurrency redeemable = new SenderFeeRedeemableCurrency("Redeemable", "RDM", 6, 1);
        uint256 holderShares = 50 ether;
        uint256 strangerShares = 50 ether;
        uint256 redeemableAmount = 100_000000;

        vm.startPrank(owner);
        boardroom.mint(holder, holderShares);
        boardroom.mint(stranger, strangerShares);
        boardroom.registerRedeemableAsset(address(redeemable));
        redeemable.mint(address(boardroom), redeemableAmount);
        boardroom.startWindDown();
        boardroom.openRedemptions();
        vm.stopPrank();

        uint256[] memory minimums = new uint256[](2);
        vm.prank(holder);
        uint256[] memory amounts = boardroom.redeem(holderShares, holder, minimums);

        assertEq(amounts[1], 0);
        assertEq(boardroom.redemptionCredits(holder), holderShares);
        assertEq(boardroom.allocatedRedemptionShares(holder, address(redeemable)), 0);
        assertEq(BoardroomToken(boardroom.shareToken()).balanceOf(holder), 0);

        vm.prank(holder);
        vm.expectRevert(
            abi.encodeWithSelector(
                Boardroom.UnexpectedRedeemableAssetBalanceChange.selector, address(redeemable), 50_000000, 50_000001
            )
        );
        boardroom.claimRedemptionAsset(address(redeemable), holder, 0);
    }

    function testBadAssetDoesNotBlockOtherAssetsOrOtherHoldersAndCanRetry() public {
        (Boardroom boardroom,) = _createBoardroom("isolated-redemption-failure");
        ToggleRevertingRedeemableCurrency failing = new ToggleRevertingRedeemableCurrency();
        BoardroomCurrency healthy = new BoardroomCurrency("Healthy", "HLT", 18);
        uint256 holderShares = 50 ether;

        vm.startPrank(owner);
        boardroom.mint(holder, holderShares);
        boardroom.mint(stranger, holderShares);
        boardroom.registerRedeemableAsset(address(failing));
        boardroom.registerRedeemableAsset(address(healthy));
        failing.mint(address(boardroom), 100 ether);
        healthy.mint(address(boardroom), 100 ether);
        boardroom.startWindDown();
        boardroom.openRedemptions();
        vm.stopPrank();

        uint256[] memory minimums = new uint256[](3);
        vm.prank(holder);
        uint256[] memory holderAmounts = boardroom.redeem(holderShares, holder, minimums);
        assertEq(holderAmounts[1], 0);
        assertEq(holderAmounts[2], 50 ether);
        assertEq(healthy.balanceOf(holder), 50 ether);

        vm.prank(stranger);
        uint256[] memory strangerAmounts = boardroom.redeem(holderShares, stranger, minimums);
        assertEq(strangerAmounts[1], 0);
        assertEq(strangerAmounts[2], 50 ether);
        assertEq(healthy.balanceOf(stranger), 50 ether);

        failing.setTransfersRevert(false);
        vm.prank(holder);
        assertEq(boardroom.claimRedemptionAsset(address(failing), holder, 50 ether), 50 ether);
        vm.prank(stranger);
        assertEq(boardroom.claimRedemptionAsset(address(failing), stranger, 50 ether), 50 ether);

        vm.prank(holder);
        vm.expectRevert(Boardroom.InvalidRedemptionInput.selector);
        boardroom.claimRedemptionAsset(address(failing), holder, 0);
    }

    function testMinimumFailureRetainsAssetClaimForRetry() public {
        (Boardroom boardroom,) = _createBoardroom("redemption-minimum-retry");
        BoardroomCurrency redeemable = new BoardroomCurrency("Redeemable", "RDM", 18);

        vm.startPrank(owner);
        boardroom.mint(holder, 50 ether);
        boardroom.mint(stranger, 50 ether);
        boardroom.registerRedeemableAsset(address(redeemable));
        redeemable.mint(address(boardroom), 100 ether);
        boardroom.startWindDown();
        boardroom.openRedemptions();
        vm.stopPrank();

        uint256[] memory minimums = new uint256[](2);
        minimums[1] = 51 ether;
        vm.prank(holder);
        uint256[] memory amounts = boardroom.redeem(50 ether, holder, minimums);

        assertEq(amounts[1], 0);
        assertEq(boardroom.allocatedRedemptionShares(holder, address(redeemable)), 0);

        vm.prank(holder);
        vm.expectRevert(
            abi.encodeWithSelector(
                Boardroom.InsufficientRedemptionAmount.selector, address(redeemable), 50 ether, 51 ether
            )
        );
        boardroom.claimRedemptionAsset(address(redeemable), holder, 51 ether);

        vm.prank(holder);
        assertEq(boardroom.claimRedemptionAsset(address(redeemable), holder, 50 ether), 50 ether);
    }

    function testLateAssetDepositIsExcludedAndSweepableAsExcess() public {
        (Boardroom boardroom,) = _createBoardroom("redemption-late-deposit");
        BoardroomCurrency redeemable = new BoardroomCurrency("Redeemable", "RDM", 18);

        vm.startPrank(owner);
        boardroom.mint(holder, 50 ether);
        boardroom.mint(stranger, 50 ether);
        boardroom.registerRedeemableAsset(address(redeemable));
        redeemable.mint(address(boardroom), 100 ether);
        boardroom.startWindDown();
        boardroom.openRedemptions();
        vm.stopPrank();

        uint256[] memory minimums = new uint256[](2);
        vm.prank(holder);
        uint256[] memory firstAmounts = boardroom.redeem(50 ether, holder, minimums);
        assertEq(firstAmounts[1], 50 ether);

        redeemable.mint(address(boardroom), 100 ether);
        vm.prank(stranger);
        uint256[] memory secondAmounts = boardroom.redeem(50 ether, stranger, minimums);
        assertEq(secondAmounts[1], 50 ether);

        vm.prank(holder);
        assertEq(boardroom.sweepRedemptionExcess(address(redeemable)), 100 ether);
        assertEq(redeemable.balanceOf(owner), 100 ether);
    }

    function testZeroSnapshotAssetAllocatesCreditAndLaterFundingIsExcess() public {
        (Boardroom boardroom,) = _createBoardroom("redemption-zero-retry");
        BoardroomCurrency redeemable = new BoardroomCurrency("Redeemable", "RDM", 18);

        vm.startPrank(owner);
        boardroom.mint(holder, 50 ether);
        boardroom.registerRedeemableAsset(address(redeemable));
        boardroom.startWindDown();
        boardroom.openRedemptions();
        vm.stopPrank();

        uint256[] memory minimums = new uint256[](2);
        vm.prank(holder);
        uint256[] memory amounts = boardroom.redeem(50 ether, holder, minimums);

        assertEq(amounts[1], 0);
        assertEq(boardroom.redemptionCredits(holder), 50 ether);
        assertEq(boardroom.allocatedRedemptionShares(holder, address(redeemable)), 50 ether);

        vm.prank(holder);
        vm.expectRevert(Boardroom.InvalidRedemptionInput.selector);
        boardroom.claimRedemptionAsset(address(redeemable), holder, 0);

        redeemable.mint(address(boardroom), 100 ether);

        vm.prank(holder);
        vm.expectRevert(Boardroom.InvalidRedemptionInput.selector);
        boardroom.claimRedemptionAsset(address(redeemable), holder, 0);

        vm.prank(stranger);
        assertEq(boardroom.sweepRedemptionExcess(address(redeemable)), 100 ether);
        assertEq(redeemable.balanceOf(owner), 100 ether);
        assertEq(boardroom.allocatedRedemptionShares(holder, address(redeemable)), 50 ether);
    }

    function testZeroRoundedClaimAllocatesSharesSoFinalClaimReceivesRemainder() public {
        (Boardroom boardroom,) = _createBoardroom("redemption-rounding-remainder");
        BoardroomCurrency redeemable = new BoardroomCurrency("Redeemable", "RDM", 18);

        vm.startPrank(owner);
        boardroom.mint(holder, 1);
        boardroom.mint(stranger, 1);
        boardroom.registerRedeemableAsset(address(redeemable));
        redeemable.mint(address(boardroom), 1);
        boardroom.startWindDown();
        boardroom.openRedemptions();
        vm.stopPrank();

        uint256[] memory minimums = new uint256[](2);
        minimums[1] = 1;
        vm.prank(holder);
        uint256[] memory firstAmounts = boardroom.redeem(1, holder, minimums);
        assertEq(firstAmounts[1], 0);
        assertEq(boardroom.allocatedRedemptionShares(holder, address(redeemable)), 0);

        vm.prank(holder);
        vm.expectRevert(
            abi.encodeWithSelector(Boardroom.InsufficientRedemptionAmount.selector, address(redeemable), 0, 1)
        );
        boardroom.claimRedemptionAsset(address(redeemable), holder, 1);

        vm.prank(holder);
        assertEq(boardroom.claimRedemptionAsset(address(redeemable), holder, 0), 0);
        assertEq(boardroom.allocatedRedemptionShares(holder, address(redeemable)), 1);

        minimums[1] = 0;
        vm.prank(stranger);
        uint256[] memory finalAmounts = boardroom.redeem(1, stranger, minimums);
        assertEq(finalAmounts[1], 1);
        assertEq(redeemable.balanceOf(stranger), 1);
    }

    function testRedemptionUsesFullPrecisionMultiplication() public {
        (Boardroom boardroom,) = _createBoardroom("redemption-full-precision");
        BoardroomCurrency redeemable = new BoardroomCurrency("Redeemable", "RDM", 18);
        uint256 holderShares = uint256(1) << 100;
        uint256 assetBalance = uint256(1) << 200;

        vm.startPrank(owner);
        boardroom.mint(holder, holderShares);
        boardroom.mint(stranger, holderShares);
        boardroom.registerRedeemableAsset(address(redeemable));
        redeemable.mint(address(boardroom), assetBalance);
        boardroom.startWindDown();
        boardroom.openRedemptions();
        vm.stopPrank();

        uint256[] memory minimums = new uint256[](2);
        vm.prank(holder);
        uint256[] memory amounts = boardroom.redeem(holderShares, holder, minimums);

        assertEq(amounts[1], uint256(1) << 199);
    }

    function testBoardroomRejectsMintAndNewGrantAfterWindDown() public {
        (Boardroom boardroom,) = _createBoardroom("wind-down-no-new-obligations");

        vm.prank(owner);
        boardroom.startWindDown();

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                Boardroom.InvalidStatus.selector,
                Boardroom.BoardroomStatus.Active,
                Boardroom.BoardroomStatus.WindingDown
            )
        );
        boardroom.mint(holder, 1 ether);

        BoardroomGrantCreate memory create = _boardroomGrantCreate(
            address(paymentToken), holder, address(0), PAYROLL_AMOUNT, 0, keccak256("late-grant"), 0
        );

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                Boardroom.CallNotAllowed.selector,
                address(tokenGrantFactory),
                address(tokenGrantFactory),
                TokenGrantFactory.createGrant.selector
            )
        );
        boardroom.execute(_tokenGrantFactoryCall(address(tokenGrantFactory), 0, _createGrantData(create)));
    }

    function testBoardroomRedemptionsWaitForIssuedGrantToClose() public {
        (Boardroom boardroom,) = _createBoardroom("wind-down-grant-gate");
        BoardroomToken shareToken = BoardroomToken(boardroom.shareToken());

        vm.prank(owner);
        boardroom.mint(address(boardroom), GRANT_SIZE);

        TokenGrant grant = _createBoardroomGrant(
            boardroom,
            _boardroomGrantCreate(
                address(shareToken), holder, address(0), GRANT_SIZE, 0, keccak256("wind-down-open-grant"), 0
            )
        );

        assertEq(boardroom.issuedGrantCount(), 1);
        assertEq(boardroom.issuedGrantAt(0), address(grant));
        assertTrue(boardroom.isIssuedGrant(address(grant)));

        vm.prank(owner);
        boardroom.startWindDown();

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Boardroom.IssuedGrantStillOpen.selector, address(grant)));
        boardroom.openRedemptions();

        vm.prank(owner);
        boardroom.execute(
            _tokenGrantFactoryCall(address(grant), 0, abi.encodeCall(TokenGrant.stopVestingAndWithdrawUnvested, ()))
        );

        assertTrue(grant.isClosed());

        vm.prank(owner);
        boardroom.openRedemptions();

        assertEq(uint8(boardroom.status()), uint8(Boardroom.BoardroomStatus.RedemptionsOpen));
    }

    function testBoardroomRejectsWrapperPolicyForActiveModuleTarget() public {
        BoardroomTestAllowAllPolicy wrapperPolicy = new BoardroomTestAllowAllPolicy();
        policyRegistry.setPolicyAllowed(address(wrapperPolicy), true);

        (Boardroom boardroom,) = _createBoardroom("wrapper-policy-module-target");
        BoardroomToken shareToken = BoardroomToken(boardroom.shareToken());

        vm.prank(owner);
        boardroom.mint(address(boardroom), GRANT_SIZE);

        bytes32 salt = keccak256("wrapper-policy-grant-create");
        BoardroomGrantCreate memory create =
            _boardroomGrantCreate(address(shareToken), holder, address(0), GRANT_SIZE, 0, salt, 0);

        Boardroom.Call[] memory calls = new Boardroom.Call[](2);
        calls[0] = Boardroom.Call({
            policy: address(wrapperPolicy),
            target: address(shareToken),
            value: 0,
            data: abi.encodeWithSignature("approve(address,uint256)", address(tokenGrantFactory), GRANT_SIZE)
        });
        calls[1] = Boardroom.Call({
            policy: address(wrapperPolicy), target: address(tokenGrantFactory), value: 0, data: _createGrantData(create)
        });

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Boardroom.ModulePolicyRequired.selector, address(tokenGrantFactory)));
        boardroom.executeBatch(calls);
    }

    function testBoardroomRejectsRawCallToLifecycleOnlyModuleTarget() public {
        policyRegistry.setPolicyStatus(address(tokenGrantFactory), BoardroomPolicyRegistry.PolicyStatus.LifecycleOnly);

        (Boardroom boardroom,) = _createBoardroom("raw-lifecycle-module-target");
        BoardroomToken shareToken = BoardroomToken(boardroom.shareToken());

        vm.prank(owner);
        boardroom.mint(address(boardroom), GRANT_SIZE);

        BoardroomGrantCreate memory create = _boardroomGrantCreate(
            address(shareToken), holder, address(0), GRANT_SIZE, 0, keccak256("raw-lifecycle"), 0
        );

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Boardroom.ModulePolicyRequired.selector, address(tokenGrantFactory)));
        boardroom.execute(_rawCall(address(tokenGrantFactory), 0, _createGrantData(create)));
    }

    function testDisabledModuleIdentityStillRejectsRawFactoryCalls() public {
        policyRegistry.setPolicyAllowed(address(tokenGrantFactory), false);

        (Boardroom boardroom,) = _createBoardroom("raw-disabled-module-target");
        BoardroomGrantCreate memory create = _boardroomGrantCreate(
            address(paymentToken), holder, address(0), PAYROLL_AMOUNT, 0, keccak256("raw-disabled"), 0
        );

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Boardroom.ModulePolicyRequired.selector, address(tokenGrantFactory)));
        boardroom.execute(_rawCall(address(tokenGrantFactory), 0, _createGrantData(create)));
    }

    function testBoardroomRejectsRawExternalAssetTransferBypass() public {
        (Boardroom boardroom,) = _createBoardroom("raw-external-transfer");
        paymentToken.mint(address(boardroom), 1_000000);
        bytes memory data = abi.encodeCall(BoardroomCurrency.transfer, (stranger, 1_000000));

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                Boardroom.CallNotAllowed.selector,
                address(0),
                address(paymentToken),
                BoardroomCurrency.transfer.selector
            )
        );
        boardroom.execute(_rawCall(address(paymentToken), 0, data));

        assertEq(paymentToken.balanceOf(address(boardroom)), 1_000000);
        assertEq(paymentToken.balanceOf(stranger), 0);
    }

    function testCanonicalLifecyclePolicyWorksAfterCentralDisableAndRejectsBypasses() public {
        (Boardroom boardroom,) = _createBoardroom("disabled-canonical-cleanup");
        BoardroomToken shareToken = BoardroomToken(boardroom.shareToken());

        vm.prank(owner);
        boardroom.mint(address(boardroom), GRANT_SIZE);

        TokenGrant grant = _createBoardroomGrant(
            boardroom,
            _boardroomGrantCreate(
                address(shareToken), holder, address(0), GRANT_SIZE, 0, keccak256("disabled-cleanup"), 0
            )
        );
        policyRegistry.setPolicyAllowed(address(tokenGrantFactory), false);
        assertTrue(policyRegistry.isPolicyLifecycleAllowed(address(tokenGrantFactory)));

        bytes memory closeData = abi.encodeCall(TokenGrant.stopVestingAndWithdrawUnvested, ());
        vm.startPrank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                Boardroom.ObligationPolicyMismatch.selector, address(grant), address(tokenGrantFactory), address(0)
            )
        );
        boardroom.execute(_rawCall(address(grant), 0, closeData));

        vm.expectRevert(
            abi.encodeWithSelector(
                Boardroom.ObligationPolicyMismatch.selector,
                address(grant),
                address(tokenGrantFactory),
                address(assetPolicy)
            )
        );
        boardroom.execute(_assetCall(address(grant), 0, closeData));

        boardroom.execute(_tokenGrantFactoryCall(address(grant), 0, closeData));
        vm.stopPrank();

        assertTrue(grant.isClosed());
        assertEq(boardroom.issuedGrantCount(), 0);
        assertEq(boardroom.obligationPolicyOf(address(grant)), address(tokenGrantFactory));
    }

    function testObligationHookFailureRevertsModuleCallButPlainPolicyStillWorks() public {
        BoardroomHookTarget target = new BoardroomHookTarget();
        BoardroomFailingObligationPolicy failingPolicy = new BoardroomFailingObligationPolicy();
        BoardroomTestAllowAllPolicy plainPolicy = new BoardroomTestAllowAllPolicy();
        policyRegistry.registerModulePolicy(address(failingPolicy));
        policyRegistry.setPolicyAllowed(address(plainPolicy), true);

        (Boardroom boardroom,) = _createBoardroom("fail-closed-module-hook");
        bytes memory data = abi.encodeCall(BoardroomHookTarget.setValue, (42));

        vm.prank(owner);
        vm.expectRevert(BoardroomFailingObligationPolicy.HookFailed.selector);
        boardroom.execute(
            Boardroom.Call({policy: address(failingPolicy), target: address(target), value: 0, data: data})
        );
        assertEq(target.value(), 0);

        vm.prank(owner);
        boardroom.execute(Boardroom.Call({policy: address(plainPolicy), target: address(target), value: 0, data: data}));
        assertEq(target.value(), 42);
    }

    function testBoardroomRejectsInvalidRedeemableAssets() public {
        (Boardroom boardroom,) = _createBoardroom("invalid-redeemable");
        address shareToken = boardroom.shareToken();

        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(Boardroom.InvalidRedeemableAsset.selector, address(0)));
        boardroom.registerRedeemableAsset(address(0));

        vm.expectRevert(abi.encodeWithSelector(Boardroom.InvalidRedeemableAsset.selector, shareToken));
        boardroom.registerRedeemableAsset(shareToken);

        vm.expectRevert(abi.encodeWithSelector(Boardroom.InvalidRedeemableAsset.selector, address(boardroom)));
        boardroom.registerRedeemableAsset(address(boardroom));

        vm.expectRevert(abi.encodeWithSelector(Boardroom.InvalidRedeemableAsset.selector, stranger));
        boardroom.registerRedeemableAsset(stranger);

        GasBurningBalanceToken gasBurner = new GasBurningBalanceToken();
        vm.expectRevert(abi.encodeWithSelector(Boardroom.InvalidRedeemableAsset.selector, address(gasBurner)));
        boardroom.registerRedeemableAsset(address(gasBurner));

        boardroom.registerRedeemableAsset(address(paymentToken));

        vm.expectRevert(
            abi.encodeWithSelector(Boardroom.RedeemableAssetAlreadyRegistered.selector, address(paymentToken))
        );
        boardroom.registerRedeemableAsset(address(paymentToken));
        vm.stopPrank();
    }

    function testRedeemableAssetCanBeRemovedEmptyOrQuarantinedWhenUnreadable() public {
        (Boardroom boardroom,) = _createBoardroom("redeemable-removal-quarantine");
        BoardroomCurrency empty = new BoardroomCurrency("Empty", "EMPTY", 18);
        ToggleUnreadableRedeemableCurrency broken = new ToggleUnreadableRedeemableCurrency();

        vm.startPrank(owner);
        boardroom.registerRedeemableAsset(address(empty));
        boardroom.registerRedeemableAsset(address(broken));
        broken.mint(address(boardroom), 5 ether);
        boardroom.startWindDown();
        vm.stopPrank();

        vm.prank(address(tokenGrantFactory));
        vm.expectRevert(
            abi.encodeWithSelector(
                Boardroom.InvalidStatus.selector,
                Boardroom.BoardroomStatus.Active,
                Boardroom.BoardroomStatus.WindingDown
            )
        );
        boardroom.reserveRedeemableAsset(address(paymentToken));

        vm.prank(stranger);
        boardroom.removeRedeemableAsset(address(empty));
        assertFalse(boardroom.isRedeemableAsset(address(empty)));

        broken.setReadable(false);
        vm.prank(stranger);
        boardroom.quarantineRedeemableAsset(address(broken));
        assertFalse(boardroom.isRedeemableAsset(address(broken)));

        vm.prank(stranger);
        boardroom.openRedemptions();
        broken.setReadable(true);

        vm.prank(stranger);
        assertEq(boardroom.sweepRedemptionExcess(address(broken)), 5 ether);
        assertEq(broken.balanceOf(owner), 5 ether);
    }

    function testShareTokenCheckpointsTrackPastBalancesAndSupply() public {
        (Boardroom boardroom,) = _createBoardroom("share-checkpoints");
        BoardroomToken shares = BoardroomToken(boardroom.shareToken());
        uint256 mintBlock = block.number;

        vm.prank(owner);
        boardroom.mint(holder, 100 ether);
        vm.expectRevert(abi.encodeWithSelector(BoardroomToken.FutureCheckpointLookup.selector, mintBlock, mintBlock));
        shares.getPastBalance(holder, mintBlock);

        vm.roll(mintBlock + 1);
        assertEq(shares.getPastBalance(holder, mintBlock), 100 ether);
        assertEq(shares.getPastTotalSupply(mintBlock), 100 ether);

        vm.prank(holder);
        shares.transfer(stranger, 40 ether);
        assertEq(shares.getPastBalance(holder, mintBlock), 100 ether);

        vm.roll(block.number + 1);
        assertEq(shares.getPastBalance(holder, block.number - 1), 60 ether);
        assertEq(shares.getPastBalance(stranger, block.number - 1), 40 ether);
        assertEq(shares.getPastTotalSupply(block.number - 1), 100 ether);
    }

    function _createBoardroom(string memory saltLabel)
        internal
        returns (Boardroom boardroom, address boardroomAddress)
    {
        bytes32 salt = keccak256(bytes(saltLabel));
        boardroomAddress = boardroomFactory.predictBoardroomAddress(owner, "Acme Common", "ACME", salt);
        address created = boardroomFactory.createBoardroom(owner, "Acme Common", "ACME", salt);

        assertEq(created, boardroomAddress);
        boardroom = Boardroom(payable(boardroomAddress));
        assetPolicy.setAssetAllowed(boardroom.shareToken(), true);
    }

    function _sendNative(address to, uint256 amount) internal {
        vm.deal(address(this), amount);
        (bool success,) = to.call{value: amount}("");
        assertTrue(success);
    }

    function _actionEta(Boardroom boardroom, bytes32 actionHash) internal view returns (uint256 eta) {
        (, eta,,,) = boardroom.governanceState(actionHash);
    }

    function _createBoardroomGrant(Boardroom boardroom, BoardroomGrantCreate memory create)
        internal
        returns (TokenGrant grant)
    {
        address grantAddress = tokenGrantFactory.predictGrantAddress(address(boardroom), create.salt);

        Boardroom.Call[] memory calls = new Boardroom.Call[](2);
        calls[0] = _assetCall(
            create.token,
            0,
            abi.encodeWithSignature("approve(address,uint256)", address(tokenGrantFactory), create.amount)
        );
        calls[1] = _tokenGrantFactoryCall(address(tokenGrantFactory), create.value, _createGrantData(create));

        vm.prank(owner);
        bytes[] memory results = boardroom.executeBatch{value: create.value}(calls);
        address created = abi.decode(results[1], (address));

        assertEq(created, grantAddress);
        grant = TokenGrant(grantAddress);
    }

    function _boardroomGrantCreate(
        address token,
        address grantHolder,
        address paymentToken_,
        uint256 amount,
        uint256 price,
        bytes32 salt,
        uint256 value
    ) internal pure returns (BoardroomGrantCreate memory create) {
        create = BoardroomGrantCreate({
            token: token,
            holder: grantHolder,
            paymentToken: paymentToken_,
            amount: amount,
            price: price,
            salt: salt,
            value: value
        });
    }

    function _createGrantData(BoardroomGrantCreate memory create) internal pure returns (bytes memory) {
        return abi.encodeCall(
            TokenGrantFactory.createGrant,
            (
                create.holder,
                create.token,
                create.paymentToken,
                create.amount,
                create.price,
                EXPIRY,
                CLIFF,
                VESTING_END,
                false,
                0,
                create.salt
            )
        );
    }

    function _assetCall(address target, uint256 value, bytes memory data)
        internal
        view
        returns (Boardroom.Call memory call_)
    {
        call_ = Boardroom.Call({policy: address(assetPolicy), target: target, value: value, data: data});
    }

    function _tokenGrantFactoryCall(address target, uint256 value, bytes memory data)
        internal
        view
        returns (Boardroom.Call memory call_)
    {
        call_ = Boardroom.Call({policy: address(tokenGrantFactory), target: target, value: value, data: data});
    }

    function _rawCall(address target, uint256 value, bytes memory data)
        internal
        pure
        returns (Boardroom.Call memory call_)
    {
        call_ = Boardroom.Call({policy: address(0), target: target, value: value, data: data});
    }
}
