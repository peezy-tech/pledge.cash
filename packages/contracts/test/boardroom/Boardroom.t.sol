// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "solady/auth/Ownable.sol";
import {WETH} from "solady/tokens/WETH.sol";
import {AssetPolicy} from "../../src/policy/AssetPolicy.sol";
import {Boardroom} from "../../src/boardroom/Boardroom.sol";
import {BoardroomFactory} from "../../src/boardroom/BoardroomFactory.sol";
import {BoardroomPolicyRegistry} from "../../src/boardroom/BoardroomPolicyRegistry.sol";
import {BoardroomToken} from "../../src/boardroom/BoardroomToken.sol";
import {IBoardroomCallPolicy} from "../../src/policy/IBoardroomCallPolicy.sol";
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

    function transfer(address to, uint256 amount) external returns (bool) {
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
    uint256 internal constant EXPIRY = 3_000;

    event PolicyAllowedSet(address indexed policy, bool allowed);

    function setUp() public {
        wrappedNative = new WETH();
        policyRegistry = new BoardroomPolicyRegistry(address(this));
        assetPolicy = new AssetPolicy(address(this), address(wrappedNative));
        tokenGrantFactory = new TokenGrantFactory(address(this));
        boardroomFactory = new BoardroomFactory(address(policyRegistry), address(wrappedNative));
        paymentToken = new BoardroomCurrency("Payment", "PAY", 6);

        assetPolicy.setAssetAllowed(address(paymentToken), true);
        assetPolicy.setApprovalSpenderAllowed(address(tokenGrantFactory), true);

        policyRegistry.setPolicyAllowed(address(assetPolicy), true);
        policyRegistry.setPolicyAllowed(address(tokenGrantFactory), true);

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
        new BoardroomFactory(address(0), address(wrappedNative));

        vm.expectRevert(BoardroomFactory.InvalidAddress.selector);
        new BoardroomFactory(address(policyRegistry), address(0));
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

    function testLaunchedBoardroomQueuesAndExecutorExecutesReadyAction() public {
        (Boardroom boardroom,) = _createBoardroom("launched-queue-execute");
        uint256 delay = 2 days;

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
        assertEq(boardroom.queuedActionEta(actionHash), eta);

        vm.prank(stranger);
        vm.expectRevert(Ownable.Unauthorized.selector);
        boardroom.executeQueuedAction(call_, salt);

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Boardroom.ActionNotReady.selector, actionHash, eta, block.timestamp));
        boardroom.executeQueuedAction(call_, salt);

        vm.warp(eta);
        vm.prank(stranger);
        vm.expectRevert(Ownable.Unauthorized.selector);
        boardroom.executeQueuedAction(call_, salt);

        vm.prank(owner);
        boardroom.executeQueuedAction(call_, salt);

        BoardroomToken shareToken = BoardroomToken(boardroom.shareToken());
        assertEq(shareToken.balanceOf(holder), 1 ether);
        assertEq(boardroom.queuedActionEta(actionHash), 0);
    }

    function testLaunchedShareholderCanCancelQueuedActionAndStartWindDown() public {
        (Boardroom boardroom,) = _createBoardroom("launched-shareholder-veto");
        BoardroomToken shareToken = BoardroomToken(boardroom.shareToken());

        vm.startPrank(owner);
        boardroom.mint(holder, 1 ether);
        boardroom.launch(1 days);
        vm.stopPrank();

        Boardroom.Call memory call_ = _rawCall(address(boardroom), 0, abi.encodeCall(Boardroom.setExecutor, (stranger)));
        bytes32 salt = keccak256("set-executor-after-launch");
        bytes32 actionHash = boardroom.hashAction(call_, salt);

        vm.prank(owner);
        boardroom.queueAction(call_, salt);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Boardroom.NotShareholder.selector, stranger));
        boardroom.cancelAction(actionHash);

        vm.prank(holder);
        boardroom.cancelAction(actionHash);

        assertEq(boardroom.queuedActionEta(actionHash), 0);

        vm.warp(block.timestamp + 1 days);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Boardroom.ActionNotQueued.selector, actionHash));
        boardroom.executeQueuedAction(call_, salt);

        assertEq(shareToken.balanceOf(holder), 1 ether);

        vm.prank(holder);
        boardroom.startWindDown();

        assertEq(uint8(boardroom.status()), uint8(Boardroom.BoardroomStatus.WindingDown));
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

    function testRedeemWrapsNativeReceivedAfterRedemptionsOpen() public {
        (Boardroom boardroom,) = _createBoardroom("redemptions-late-native");
        uint256 holderShares = 100 ether;
        uint256 lateNativeAmount = 5 ether;

        vm.startPrank(owner);
        boardroom.mint(holder, holderShares);
        boardroom.registerRedeemableAsset(address(wrappedNative));
        boardroom.startWindDown();
        boardroom.openRedemptions();
        vm.stopPrank();

        _sendNative(address(boardroom), lateNativeAmount);

        uint256[] memory minimums = new uint256[](1);
        minimums[0] = lateNativeAmount;

        vm.prank(holder);
        uint256[] memory amounts = boardroom.redeem(holderShares, holder, minimums);

        assertEq(amounts[0], lateNativeAmount);
        assertEq(wrappedNative.balanceOf(holder), lateNativeAmount);
        assertEq(address(boardroom).balance, 0);
    }

    function testBoardroomCanRedeemWrappedNativeAfterWindDownWrap() public {
        (Boardroom boardroom,) = _createBoardroom("wind-down-redeem-whype");
        uint256 holderShares = 100 ether;
        uint256 strangerShares = 300 ether;
        uint256 nativeAmount = 4 ether;

        vm.startPrank(owner);
        boardroom.mint(holder, holderShares);
        boardroom.mint(stranger, strangerShares);
        boardroom.registerRedeemableAsset(address(wrappedNative));
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

    function testCreationFeeReachesBoardroomAfterFactoryOwnershipTransfer() public {
        uint256 fee = 0.01 ether;
        tokenGrantFactory.setCreationFee(fee);

        (Boardroom boardroom,) = _createBoardroom("issue-fee-grant-owned-factory");
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

        uint256[] memory minimums = new uint256[](1);
        minimums[0] = 100_000000;

        vm.prank(holder);
        uint256[] memory holderAmounts = boardroom.redeem(holderShares, holder, minimums);

        assertEq(holderAmounts.length, 1);
        assertEq(holderAmounts[0], 100_000000);
        assertEq(redeemable.balanceOf(holder), 100_000000);
        assertEq(shareToken.balanceOf(holder), 0);

        minimums[0] = 300_000000;

        vm.prank(stranger);
        uint256[] memory strangerAmounts = boardroom.redeem(strangerShares, stranger, minimums);

        assertEq(strangerAmounts[0], 300_000000);
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
        boardroom.startWindDown();
        boardroom.openRedemptions();
        vm.stopPrank();

        redeemable.mint(address(boardroom), redeemableAmount);

        BoardroomToken shareToken = BoardroomToken(boardroom.shareToken());
        vm.prank(holder);
        shareToken.transfer(address(boardroom), holderShares);

        uint256[] memory minimums = new uint256[](1);
        minimums[0] = redeemableAmount;

        vm.prank(stranger);
        uint256[] memory amounts = boardroom.redeem(strangerShares, stranger, minimums);

        assertEq(amounts[0], redeemableAmount);
        assertEq(redeemable.balanceOf(stranger), redeemableAmount);
        assertEq(redeemable.balanceOf(address(boardroom)), 0);
        assertEq(shareToken.balanceOf(address(boardroom)), 0);
        assertEq(shareToken.totalSupply(), 0);
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
        boardroom.startWindDown();
        boardroom.openRedemptions();
        vm.stopPrank();

        redeemable.mint(address(boardroom), redeemableAmount);

        uint256[] memory minimums = new uint256[](1);
        vm.prank(holder);
        vm.expectRevert(
            abi.encodeWithSelector(
                Boardroom.UnexpectedRedeemableAssetBalanceChange.selector, address(redeemable), 50_000000, 50_000001
            )
        );
        boardroom.redeem(holderShares, holder, minimums);
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

        boardroom.registerRedeemableAsset(address(paymentToken));

        vm.expectRevert(
            abi.encodeWithSelector(Boardroom.RedeemableAssetAlreadyRegistered.selector, address(paymentToken))
        );
        boardroom.registerRedeemableAsset(address(paymentToken));
        vm.stopPrank();
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
