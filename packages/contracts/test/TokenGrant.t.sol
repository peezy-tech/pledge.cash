// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {TokenGrant} from "../src/TokenGrant.sol";
import {TokenGrantFactory} from "../src/TokenGrantFactory.sol";

contract GrantERC20 {
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

    function approve(address spender, uint256 amount) public virtual returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) public virtual returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public virtual returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract NoReturnERC20 {
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

    function transfer(address to, uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
    }

    function transferFrom(address from, address to, uint256 amount) external {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}

contract NoDecimalsERC20 {
    mapping(address => mapping(address => uint256)) public allowance;

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
}

contract FalseReturnERC20 is GrantERC20 {
    constructor(string memory name_, string memory symbol_, uint8 decimals_) GrantERC20(name_, symbol_, decimals_) {}

    function transfer(address, uint256) public pure override returns (bool) {
        return false;
    }

    function transferFrom(address, address, uint256) public pure override returns (bool) {
        return false;
    }
}

contract FeeOnTransferERC20 is GrantERC20 {
    uint256 internal immutable feeBps;
    bool internal immutable feeOnTransfer;
    bool internal immutable feeOnTransferFrom;

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        uint256 feeBps_,
        bool feeOnTransfer_,
        bool feeOnTransferFrom_
    ) GrantERC20(name_, symbol_, decimals_) {
        feeBps = feeBps_;
        feeOnTransfer = feeOnTransfer_;
        feeOnTransferFrom = feeOnTransferFrom_;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        _move(msg.sender, to, amount, feeOnTransfer);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        _move(from, to, amount, feeOnTransferFrom);
        return true;
    }

    function _move(address from, address to, uint256 amount, bool applyFee) internal {
        uint256 fee = applyFee ? (amount * feeBps) / 10_000 : 0;
        balanceOf[from] -= amount;
        balanceOf[to] += amount - fee;
        totalSupply -= fee;
    }
}

contract ReentrantPaymentERC20 is GrantERC20 {
    address public target;
    bytes public payload;
    bool public reenter;
    bool public reentered;
    bool public reenteredOk;

    constructor() GrantERC20("Reentrant Payment", "RPAY", 6) {}

    function setReentry(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
        reenter = true;
        reentered = false;
        reenteredOk = false;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (reenter) {
            reenter = false;
            reentered = true;
            (reenteredOk,) = target.call(payload);
        }
        return super.transferFrom(from, to, amount);
    }
}

contract TokenGrantTest is Test {
    struct GrantCreate {
        bytes32 salt;
        address holder;
        address token;
        address paymentToken;
        uint256[5] terms;
    }

    TokenGrantFactory internal factory;
    GrantERC20 internal token;
    GrantERC20 internal paymentToken;

    address internal issuer = address(0xA11CE);
    address internal holder = address(0xB0B);
    address internal stranger = address(0xCAFE);

    uint256 internal constant GRANT_SIZE = 100 ether;
    uint256 internal constant PRICE = 2_000000;
    uint256 internal constant CLIFF = 1_000;
    uint256 internal constant VESTING_END = 2_000;
    uint256 internal constant EXPIRY = 3_000;
    bytes4 internal constant UNAUTHORIZED_SELECTOR = bytes4(keccak256("Unauthorized()"));

    event TokenGrantCreated(
        address indexed grantAddress,
        address indexed issuer,
        address indexed holder,
        address token,
        address paymentToken,
        uint256 amount,
        uint256 price,
        uint256 expiry,
        uint256 vestingCliff,
        uint256 vestingEnd,
        bytes32 salt
    );
    event GrantSettled(address indexed holder, address indexed issuer, uint256 tokenAmount, uint256 paymentAmount);
    event VestingHalted(address indexed issuer, uint256 vestedAtHalt, uint256 unvestedWithdrawn);
    event ExpiredTokensWithdrawn(address indexed issuer, uint256 amountWithdrawn);
    event CreationFeeSet(uint256 amount);
    event CreationFeePaid(address indexed payer, address indexed recipient, uint256 amount);

    function setUp() public {
        factory = new TokenGrantFactory();
        token = new GrantERC20("Grant Token", "GRANT", 18);
        paymentToken = new GrantERC20("Payment", "PAY", 6);

        token.mint(issuer, GRANT_SIZE);
        paymentToken.mint(holder, 1_000_000000);
    }

    receive() external payable {}

    function testCreateFreeClaimGrantEscrowsTokenAndInitializes() public {
        bytes32 salt = keccak256("free-create");
        address grantAddress = factory.predictGrantAddress(salt);

        _approve(address(token), issuer, grantAddress, GRANT_SIZE);

        vm.expectEmit(true, true, true, true, address(factory));
        emit TokenGrantCreated(
            grantAddress, issuer, holder, address(token), address(0), GRANT_SIZE, 0, EXPIRY, CLIFF, VESTING_END, salt
        );

        vm.prank(issuer);
        address created =
            factory.createGrant(holder, address(token), address(0), GRANT_SIZE, 0, EXPIRY, CLIFF, VESTING_END, salt);
        TokenGrant grant = TokenGrant(created);

        assertEq(address(grant), grantAddress);
        assertEq(grant.issuer(), issuer);
        assertEq(grant.holder(), holder);
        assertFalse(grant.isClosed());
        assertEq(grant.token(), address(token));
        assertEq(grant.paymentToken(), address(0));
        assertEq(grant.price(), 0);
        assertEq(grant.grantSize(), GRANT_SIZE);
        assertEq(grant.claimable(), GRANT_SIZE);
        assertEq(grant.tokenDecimals(), 18);
        assertEq(grant.paymentTokenDecimals(), 0);
        assertEq(grant.tokenUnit(), 1 ether);
        assertEq(token.balanceOf(grantAddress), GRANT_SIZE);
        assertEq(token.balanceOf(issuer), 0);
    }

    function testFactoryOwnerIsDeployer() public view {
        assertEq(factory.owner(), address(this));
    }

    function testOwnerCanSetUpdateAndClearCreationFee() public {
        vm.expectEmit(false, false, false, true, address(factory));
        emit CreationFeeSet(0.01 ether);
        factory.setCreationFee(0.01 ether);
        assertEq(factory.creationFee(), 0.01 ether);

        factory.setCreationFee(0.02 ether);
        assertEq(factory.creationFee(), 0.02 ether);

        factory.setCreationFee(0);
        assertEq(factory.creationFee(), 0);
    }

    function testNonOwnerCannotSetCreationFee() public {
        vm.prank(stranger);
        vm.expectRevert(UNAUTHORIZED_SELECTOR);
        factory.setCreationFee(0.01 ether);
    }

    function testCreationFeeIsSentToOwnerOnGrantCreation() public {
        uint256 fee = 0.01 ether;
        factory.setCreationFee(fee);

        bytes32 salt = keccak256("native-fee-create");
        address grantAddress = factory.predictGrantAddress(salt);
        _approve(address(token), issuer, grantAddress, GRANT_SIZE);

        vm.deal(issuer, fee);
        vm.prank(issuer);
        vm.expectEmit(true, true, false, true, address(factory));
        emit CreationFeePaid(issuer, address(this), fee);
        uint256 ownerBalanceBefore = address(this).balance;
        address created = factory.createGrant{value: fee}(
            holder, address(token), address(0), GRANT_SIZE, 0, EXPIRY, CLIFF, VESTING_END, salt
        );

        assertEq(created, grantAddress);
        assertEq(address(this).balance, ownerBalanceBefore + fee);
        assertEq(address(factory).balance, 0);
        assertEq(token.balanceOf(grantAddress), GRANT_SIZE);
    }

    function testCreationFeeRejectsWrongNativePayment() public {
        uint256 fee = 0.01 ether;
        factory.setCreationFee(fee);

        vm.deal(issuer, fee);
        vm.prank(issuer);
        vm.expectRevert(abi.encodeWithSelector(TokenGrantFactory.InvalidCreationFeePayment.selector, fee, fee - 1));
        factory.createGrant{value: fee - 1}(
            holder, address(token), address(0), GRANT_SIZE, 0, EXPIRY, CLIFF, VESTING_END, keccak256("wrong-native-fee")
        );
    }

    function testCreationRejectsUnexpectedNativePaymentWhenFeeIsZero() public {
        uint256 unexpectedPayment = 1 wei;

        vm.deal(issuer, unexpectedPayment);
        vm.prank(issuer);
        vm.expectRevert(
            abi.encodeWithSelector(TokenGrantFactory.InvalidCreationFeePayment.selector, 0, unexpectedPayment)
        );
        factory.createGrant{value: unexpectedPayment}(
            holder,
            address(token),
            address(0),
            GRANT_SIZE,
            0,
            EXPIRY,
            CLIFF,
            VESTING_END,
            keccak256("unexpected-native-fee")
        );
    }

    function testFreeClaimSettlesVestedTokenWithoutPayment() public {
        (TokenGrant grant, address grantAddress) = _createFreeGrant("free-settle");
        vm.warp(VESTING_END);

        uint256 settleAmount = 10 ether;

        vm.expectEmit(true, true, true, true, address(grant));
        emit GrantSettled(holder, issuer, settleAmount, 0);

        vm.prank(holder);
        grant.settle(settleAmount);

        assertEq(grant.settledAmount(), settleAmount);
        assertEq(grant.getUnsettledAmount(), GRANT_SIZE - settleAmount);
        assertEq(token.balanceOf(holder), settleAmount);
        assertEq(token.balanceOf(grantAddress), GRANT_SIZE - settleAmount);
        assertEq(paymentToken.balanceOf(issuer), 0);
    }

    function testPaidSettlementSettlesVestedTokenAndPaysIssuer() public {
        (TokenGrant grant,) = _createPaidGrant("paid-settle");
        vm.warp(VESTING_END);

        uint256 settleAmount = 10 ether;
        uint256 expectedCost = grant.getSettlementCost(settleAmount);

        vm.prank(holder);
        paymentToken.approve(address(grant), expectedCost);

        vm.expectEmit(true, true, true, true, address(grant));
        emit GrantSettled(holder, issuer, settleAmount, expectedCost);

        vm.prank(holder);
        grant.settle(settleAmount);

        assertEq(grant.settledAmount(), settleAmount);
        assertEq(token.balanceOf(holder), settleAmount);
        assertEq(paymentToken.balanceOf(issuer), expectedCost);
    }

    function testSettlementCostUsesPaymentSmallestUnitsPerWholeTokenAndRoundsUp() public {
        (TokenGrant grant,) = _createPaidGrant("settlement-cost");

        assertEq(grant.getSettlementCost(1 ether), PRICE);
        assertEq(grant.getSettlementCost(1), 1);
    }

    function testReadHelpersReportDerivedState() public {
        (TokenGrant grant,) = _createFreeGrant("read-helpers");

        assertFalse(grant.vestingIsHalted());
        assertEq(grant.getUnsettledAmount(), GRANT_SIZE);
        assertEq(grant.getSettleableAmount(CLIFF - 1), 0);
        assertEq(grant.getSettleableAmount(1_500), 50 ether);
    }

    function testFullSettlementClosesGrant() public {
        (TokenGrant grant,) = _createFreeGrant("full-settle-burn");
        vm.warp(VESTING_END);

        vm.prank(holder);
        grant.settle(GRANT_SIZE);

        assertEq(grant.settledAmount(), GRANT_SIZE);
        assertTrue(grant.isClosed());
        assertEq(grant.holder(), holder);
    }

    function testExpiryDoesNotCloseUntilWithdrawal() public {
        (TokenGrant grant,) = _createFreeGrant("expiry-ownerof");
        vm.warp(EXPIRY + 1);

        assertEq(grant.holder(), holder);
        assertFalse(grant.isClosed());

        vm.prank(issuer);
        grant.withdrawExpiredTokens();

        assertTrue(grant.isClosed());
    }

    function testIssuerHaltBeforeCliffClosesGrant() public {
        (TokenGrant grant, address grantAddress) = _createFreeGrant("halt-before-cliff-burn");
        vm.warp(CLIFF - 1);

        vm.prank(issuer);
        grant.stopVestingAndWithdrawUnvested();

        assertTrue(grant.vestingIsHalted());
        assertEq(grant.claimable(), 0);
        assertTrue(grant.isClosed());
        assertEq(token.balanceOf(issuer), GRANT_SIZE);
        assertEq(token.balanceOf(grantAddress), 0);
    }

    function testCannotSettleBeforeCliff() public {
        (TokenGrant grant,) = _createFreeGrant("before-cliff");
        vm.warp(CLIFF - 1);

        vm.prank(holder);
        vm.expectRevert(abi.encodeWithSelector(TokenGrant.InsufficientVestedAmount.selector, 1 ether, 0));
        grant.settle(1 ether);
    }

    function testVestingBoundaryAtCliff() public {
        (TokenGrant grant,) = _createFreeGrant("at-cliff");

        assertEq(grant.getCurrentlyVestedSnapshot(CLIFF - 1), 0);
        assertEq(grant.getCurrentlyVestedSnapshot(CLIFF), 0);
    }

    function testVestingBoundaryAtVestingEnd() public {
        (TokenGrant grant,) = _createFreeGrant("at-vesting-end");

        assertLt(grant.getCurrentlyVestedSnapshot(VESTING_END - 1), GRANT_SIZE);
        assertEq(grant.getCurrentlyVestedSnapshot(VESTING_END), GRANT_SIZE);
    }

    function testOnlyHolderCanSettle() public {
        (TokenGrant grant,) = _createFreeGrant("only-holder");
        vm.warp(VESTING_END);

        vm.prank(stranger);
        vm.expectRevert(TokenGrant.OnlyHolder.selector);
        grant.settle(1 ether);
    }

    function testHolderCanSettleAtExpiry() public {
        (TokenGrant grant,) = _createPaidGrant("at-expiry");
        vm.warp(EXPIRY);

        uint256 settleAmount = 1 ether;
        uint256 expectedCost = PRICE;

        vm.prank(holder);
        paymentToken.approve(address(grant), expectedCost);

        vm.prank(holder);
        grant.settle(settleAmount);

        assertEq(grant.settledAmount(), settleAmount);
        assertEq(token.balanceOf(holder), settleAmount);
        assertEq(paymentToken.balanceOf(issuer), expectedCost);
    }

    function testCannotSettleAfterExpiry() public {
        (TokenGrant grant,) = _createFreeGrant("after-expiry");
        vm.warp(EXPIRY + 1);

        vm.prank(holder);
        vm.expectRevert(TokenGrant.GrantExpired.selector);
        grant.settle(1 ether);
    }

    function testIssuerCanHaltAndWithdrawUnvested() public {
        (TokenGrant grant, address grantAddress) = _createFreeGrant("halt");
        vm.warp(1_500);

        vm.expectEmit(true, true, true, true, address(grant));
        emit VestingHalted(issuer, 50 ether, 50 ether);

        vm.prank(issuer);
        grant.stopVestingAndWithdrawUnvested();

        assertTrue(grant.vestingIsHalted());
        assertEq(grant.vestingHaltTimestamp(), 1_500);
        assertEq(grant.claimable(), 50 ether);
        assertEq(token.balanceOf(issuer), 50 ether);
        assertEq(token.balanceOf(grantAddress), 50 ether);

        vm.warp(VESTING_END);
        assertEq(grant.getCurrentlyVestedSnapshot(block.timestamp), 50 ether);
    }

    function testIssuerCanHaltAfterFullVestingWithoutWithdrawal() public {
        (TokenGrant grant, address grantAddress) = _createFreeGrant("halt-fully-vested");
        vm.warp(VESTING_END);

        vm.expectEmit(true, true, true, true, address(grant));
        emit VestingHalted(issuer, GRANT_SIZE, 0);

        vm.prank(issuer);
        grant.stopVestingAndWithdrawUnvested();

        assertEq(grant.claimable(), GRANT_SIZE);
        assertEq(token.balanceOf(issuer), 0);
        assertEq(token.balanceOf(grantAddress), GRANT_SIZE);
    }

    function testPartialSettlementThenHaltLeavesOnlyUnsettledVestedEscrow() public {
        (TokenGrant grant, address grantAddress) = _createFreeGrant("partial-then-halt");
        vm.warp(1_500);

        vm.prank(holder);
        grant.settle(10 ether);

        vm.prank(issuer);
        grant.stopVestingAndWithdrawUnvested();

        assertEq(grant.claimable(), 50 ether);
        assertEq(grant.settledAmount(), 10 ether);
        assertEq(grant.getUnsettledAmount(), 40 ether);
        assertEq(token.balanceOf(holder), 10 ether);
        assertEq(token.balanceOf(issuer), 50 ether);
        assertEq(token.balanceOf(grantAddress), 40 ether);
    }

    function testPartialSettlementThenExpiredWithdrawalSweepsRemainingEscrow() public {
        (TokenGrant grant, address grantAddress) = _createFreeGrant("partial-then-expired");
        vm.warp(VESTING_END);

        vm.prank(holder);
        grant.settle(10 ether);

        vm.warp(EXPIRY + 1);

        vm.expectEmit(true, true, true, true, address(grant));
        emit ExpiredTokensWithdrawn(issuer, 90 ether);

        vm.prank(issuer);
        grant.withdrawExpiredTokens();

        assertEq(token.balanceOf(holder), 10 ether);
        assertEq(token.balanceOf(issuer), 90 ether);
        assertEq(token.balanceOf(grantAddress), 0);

        vm.prank(holder);
        vm.expectRevert(TokenGrant.GrantClosed.selector);
        grant.settle(1 ether);
    }

    function testOnlyIssuerCanHalt() public {
        (TokenGrant grant,) = _createFreeGrant("halt-auth");

        vm.prank(holder);
        vm.expectRevert(TokenGrant.OnlyIssuer.selector);
        grant.stopVestingAndWithdrawUnvested();
    }

    function testIssuerCanWithdrawExpiredTokens() public {
        (TokenGrant grant, address grantAddress) = _createFreeGrant("expired");
        vm.warp(EXPIRY + 1);

        vm.expectEmit(true, true, true, true, address(grant));
        emit ExpiredTokensWithdrawn(issuer, GRANT_SIZE);

        vm.prank(issuer);
        grant.withdrawExpiredTokens();

        assertEq(token.balanceOf(issuer), GRANT_SIZE);
        assertEq(token.balanceOf(grantAddress), 0);
    }

    function testInstantVestingScheduleVestsAtCliff() public {
        bytes32 salt = keccak256("instant");
        TokenGrant grant = _createGrant(
            _grantCreate(salt, holder, address(token), address(0), _terms(GRANT_SIZE, 0, EXPIRY, CLIFF, CLIFF))
        );

        vm.warp(CLIFF - 1);
        assertEq(grant.getCurrentlyVestedSnapshot(block.timestamp), 0);

        vm.warp(CLIFF);
        assertEq(grant.getCurrentlyVestedSnapshot(block.timestamp), GRANT_SIZE);
    }

    function testRejectsInvalidCreationInputs() public {
        _createGrantExpectRevert(
            abi.encodeWithSelector(TokenGrant.InvalidAddress.selector),
            "invalid-holder",
            address(token),
            address(0),
            address(0),
            _terms(GRANT_SIZE, 0, EXPIRY, CLIFF, VESTING_END)
        );
        _createGrantExpectRevert(
            abi.encodeWithSelector(TokenGrant.InvalidAddress.selector),
            "invalid-token",
            address(0),
            holder,
            address(0),
            _terms(GRANT_SIZE, 0, EXPIRY, CLIFF, VESTING_END)
        );
        _createGrantExpectRevert(
            abi.encodeWithSelector(TokenGrant.InvalidAmount.selector),
            "zero-grant",
            address(token),
            holder,
            address(0),
            _terms(0, 0, EXPIRY, CLIFF, VESTING_END)
        );
    }

    function testRejectsInvalidFreeClaimPaymentFields() public {
        _createGrantExpectRevert(
            abi.encodeWithSelector(TokenGrant.InvalidPaymentToken.selector),
            "free-payment-token",
            address(token),
            holder,
            address(paymentToken),
            _terms(GRANT_SIZE, 0, EXPIRY, CLIFF, VESTING_END)
        );
    }

    function testRejectsInvalidPaidSettlementPaymentFields() public {
        _createGrantExpectRevert(
            abi.encodeWithSelector(TokenGrant.InvalidPaymentToken.selector),
            "paid-no-payment",
            address(token),
            holder,
            address(0),
            _terms(GRANT_SIZE, PRICE, EXPIRY, CLIFF, VESTING_END)
        );

        _createGrantExpectRevert(
            abi.encodeWithSelector(TokenGrant.InvalidTokenPair.selector),
            "paid-same-token",
            address(token),
            holder,
            address(token),
            _terms(GRANT_SIZE, PRICE, EXPIRY, CLIFF, VESTING_END)
        );

        _createGrantExpectRevert(
            abi.encodeWithSelector(TokenGrant.InvalidPaymentToken.selector),
            "paid-zero-price",
            address(token),
            holder,
            address(paymentToken),
            _terms(GRANT_SIZE, 0, EXPIRY, CLIFF, VESTING_END)
        );
    }

    function testRejectsInvalidTimingInputs() public {
        vm.warp(EXPIRY);
        _createGrantExpectRevert(
            abi.encodeWithSelector(TokenGrant.InvalidExpiry.selector),
            "expired-at-create",
            address(token),
            holder,
            address(0),
            _terms(GRANT_SIZE, 0, EXPIRY, CLIFF, VESTING_END)
        );
        vm.warp(1);

        _createGrantExpectRevert(
            abi.encodeWithSelector(TokenGrant.InvalidExpiry.selector),
            "bad-expiry",
            address(token),
            holder,
            address(0),
            _terms(GRANT_SIZE, 0, VESTING_END - 1, CLIFF, VESTING_END)
        );
        _createGrantExpectRevert(
            abi.encodeWithSelector(TokenGrant.InvalidVestingSchedule.selector),
            "bad-schedule",
            address(token),
            holder,
            address(0),
            _terms(GRANT_SIZE, 0, EXPIRY, VESTING_END + 1, VESTING_END)
        );
    }

    function testRejectsUnsupportedGrantTokenDecimals() public {
        GrantERC20 highDecimalToken = new GrantERC20("High", "HIGH", 78);
        highDecimalToken.mint(issuer, GRANT_SIZE);

        _createGrantExpectRevert(
            abi.encodeWithSelector(TokenGrant.UnsupportedTokenDecimals.selector, address(highDecimalToken), uint8(78)),
            "high-token",
            address(highDecimalToken),
            holder,
            address(0),
            _terms(GRANT_SIZE, 0, EXPIRY, CLIFF, VESTING_END)
        );
    }

    function testRejectsUnsupportedPaymentTokenDecimals() public {
        GrantERC20 highDecimalPayment = new GrantERC20("High Payment", "HPAY", 78);

        _createGrantExpectRevert(
            abi.encodeWithSelector(
                TokenGrant.UnsupportedTokenDecimals.selector, address(highDecimalPayment), uint8(78)
            ),
            "high-payment",
            address(token),
            holder,
            address(highDecimalPayment),
            _terms(GRANT_SIZE, PRICE, EXPIRY, CLIFF, VESTING_END)
        );
    }

    function testRejectsTokenWithoutDecimals() public {
        NoDecimalsERC20 noDecimals = new NoDecimalsERC20();

        _createGrantExpectRevert(
            abi.encodeWithSelector(TokenGrant.InvalidTokenDecimals.selector, address(noDecimals)),
            "no-decimals-token",
            address(noDecimals),
            holder,
            address(0),
            _terms(GRANT_SIZE, 0, EXPIRY, CLIFF, VESTING_END)
        );
    }

    function testRejectsPaymentTokenWithoutDecimals() public {
        NoDecimalsERC20 noDecimals = new NoDecimalsERC20();

        _createGrantExpectRevert(
            abi.encodeWithSelector(TokenGrant.InvalidTokenDecimals.selector, address(noDecimals)),
            "no-decimals-payment",
            address(token),
            holder,
            address(noDecimals),
            _terms(GRANT_SIZE, PRICE, EXPIRY, CLIFF, VESTING_END)
        );
    }

    function testSupportsNoReturnTokens() public {
        NoReturnERC20 noReturnToken = new NoReturnERC20("No Return", "NRET", 18);
        NoReturnERC20 noReturnPayment = new NoReturnERC20("No Return Payment", "NRP", 6);
        noReturnToken.mint(issuer, GRANT_SIZE);
        noReturnPayment.mint(holder, 1_000_000000);

        TokenGrant grant = _createGrant(
            _grantCreate(
                keccak256("no-return"),
                holder,
                address(noReturnToken),
                address(noReturnPayment),
                _terms(GRANT_SIZE, PRICE, EXPIRY, CLIFF, VESTING_END)
            )
        );

        vm.warp(1_500);
        uint256 settleAmount = 10 ether;
        uint256 expectedCost = 20_000000;

        vm.prank(holder);
        noReturnPayment.approve(address(grant), expectedCost);

        vm.prank(holder);
        grant.settle(settleAmount);

        assertEq(noReturnToken.balanceOf(holder), settleAmount);
        assertEq(noReturnPayment.balanceOf(issuer), expectedCost);
    }

    function testRejectsFalseReturnGrantTokenAtCreate() public {
        FalseReturnERC20 falseToken = new FalseReturnERC20("False", "FALSE", 18);
        falseToken.mint(issuer, GRANT_SIZE);

        bytes32 salt = keccak256("false-token");
        address predicted = factory.predictGrantAddress(salt);

        _approve(address(falseToken), issuer, predicted, GRANT_SIZE);

        vm.prank(issuer);
        vm.expectRevert();
        factory.createGrant(holder, address(falseToken), address(0), GRANT_SIZE, 0, EXPIRY, CLIFF, VESTING_END, salt);
    }

    function testRejectsFalseReturnPaymentTokenAtSettlement() public {
        FalseReturnERC20 falsePayment = new FalseReturnERC20("False Payment", "FPAY", 6);
        falsePayment.mint(holder, 1_000_000000);
        TokenGrant grant = _createGrant(
            _grantCreate(
                keccak256("false-payment"),
                holder,
                address(token),
                address(falsePayment),
                _terms(GRANT_SIZE, PRICE, EXPIRY, CLIFF, VESTING_END)
            )
        );

        vm.warp(1_500);
        vm.prank(holder);
        falsePayment.approve(address(grant), type(uint256).max);

        vm.prank(holder);
        vm.expectRevert();
        grant.settle(10 ether);
    }

    function testRejectsFeeOnTransferGrantTokenAtCreate() public {
        FeeOnTransferERC20 feeToken = new FeeOnTransferERC20("Fee", "FEE", 18, 100, false, true);
        feeToken.mint(issuer, GRANT_SIZE);

        _createGrantExpectRevert(
            abi.encodeWithSelector(
                TokenGrant.UnexpectedTokenBalanceChange.selector, address(feeToken), GRANT_SIZE, 99 ether
            ),
            "fee-token-create",
            address(feeToken),
            holder,
            address(0),
            _terms(GRANT_SIZE, 0, EXPIRY, CLIFF, VESTING_END)
        );
    }

    function testRejectsFeeOnTransferPaymentTokenAtSettlement() public {
        FeeOnTransferERC20 feePayment = new FeeOnTransferERC20("Fee Payment", "FPAY", 6, 100, false, true);
        feePayment.mint(holder, 1_000_000000);
        TokenGrant grant = _createGrant(
            _grantCreate(
                keccak256("fee-payment-settle"),
                holder,
                address(token),
                address(feePayment),
                _terms(GRANT_SIZE, PRICE, EXPIRY, CLIFF, VESTING_END)
            )
        );

        vm.warp(1_500);
        uint256 expectedCost = grant.getSettlementCost(10 ether);
        vm.prank(holder);
        feePayment.approve(address(grant), expectedCost);

        vm.prank(holder);
        vm.expectRevert(
            abi.encodeWithSelector(
                TokenGrant.UnexpectedTokenBalanceChange.selector,
                address(feePayment),
                expectedCost,
                (expectedCost * 99) / 100
            )
        );
        grant.settle(10 ether);
    }

    function testRejectsFeeOnTransferGrantTokenAtDelivery() public {
        FeeOnTransferERC20 feeToken = new FeeOnTransferERC20("Fee", "FEE", 18, 100, true, false);
        feeToken.mint(issuer, GRANT_SIZE);

        TokenGrant grant = _createGrant(
            _grantCreate(
                keccak256("fee-token-delivery"),
                holder,
                address(feeToken),
                address(0),
                _terms(GRANT_SIZE, 0, EXPIRY, CLIFF, VESTING_END)
            )
        );

        vm.warp(VESTING_END);

        vm.prank(holder);
        vm.expectRevert(
            abi.encodeWithSelector(
                TokenGrant.UnexpectedTokenBalanceChange.selector, address(feeToken), 10 ether, 9.9 ether
            )
        );
        grant.settle(10 ether);
    }

    function testPaymentTokenReentryCannotSettleAgain() public {
        ReentrantPaymentERC20 reentrantPayment = new ReentrantPaymentERC20();
        reentrantPayment.mint(holder, 1_000_000000);
        TokenGrant grant = _createGrant(
            _grantCreate(
                keccak256("reentrant-payment"),
                holder,
                address(token),
                address(reentrantPayment),
                _terms(GRANT_SIZE, PRICE, EXPIRY, CLIFF, VESTING_END)
            )
        );

        vm.warp(VESTING_END);
        uint256 settleAmount = 10 ether;
        uint256 expectedCost = grant.getSettlementCost(settleAmount);
        reentrantPayment.setReentry(address(grant), abi.encodeCall(TokenGrant.settle, (1 ether)));

        vm.prank(holder);
        reentrantPayment.approve(address(grant), expectedCost);

        vm.prank(holder);
        grant.settle(settleAmount);

        assertTrue(reentrantPayment.reentered());
        assertFalse(reentrantPayment.reenteredOk());
        assertEq(grant.settledAmount(), settleAmount);
        assertEq(token.balanceOf(holder), settleAmount);
        assertEq(reentrantPayment.balanceOf(issuer), expectedCost);
    }

    function testFuzzSettlementCostRoundsUp(uint8 decimalsSeed, uint128 amountSeed, uint128 priceSeed) public {
        uint8 tokenDecimals = uint8(bound(decimalsSeed, 0, 36));
        uint256 unit = 10 ** uint256(tokenDecimals);
        uint256 grantSize = 100 * unit;
        uint256 amountToSettle = bound(uint256(amountSeed), 1, grantSize);
        uint256 price = bound(uint256(priceSeed), 1, 1e24);

        GrantERC20 fuzzToken = new GrantERC20("Fuzz Grant", "FGRANT", tokenDecimals);
        GrantERC20 fuzzPayment = new GrantERC20("Fuzz Payment", "FPAY", 6);
        fuzzToken.mint(issuer, grantSize);

        TokenGrant grant = _createGrant(
            _grantCreate(
                keccak256("fuzz-cost"),
                holder,
                address(fuzzToken),
                address(fuzzPayment),
                _terms(grantSize, price, EXPIRY, CLIFF, VESTING_END)
            )
        );

        uint256 expectedCost = (amountToSettle * price + unit - 1) / unit;
        assertEq(grant.getSettlementCost(amountToSettle), expectedCost);
    }

    function testFuzzVestedAmountBounds(uint256 timestamp) public {
        (TokenGrant grant,) = _createFreeGrant("fuzz-vesting");

        uint256 vested = grant.getCurrentlyVestedSnapshot(timestamp);
        assertLe(vested, grant.claimable());

        if (timestamp < CLIFF) {
            assertEq(vested, 0);
        }
        if (timestamp >= VESTING_END) {
            assertEq(vested, GRANT_SIZE);
        }
    }

    function _createFreeGrant(string memory saltLabel) internal returns (TokenGrant grant, address grantAddress) {
        bytes32 salt = keccak256(bytes(saltLabel));
        grant = _createGrant(
            _grantCreate(salt, holder, address(token), address(0), _terms(GRANT_SIZE, 0, EXPIRY, CLIFF, VESTING_END))
        );
        grantAddress = address(grant);
    }

    function _createPaidGrant(string memory saltLabel) internal returns (TokenGrant grant, address grantAddress) {
        bytes32 salt = keccak256(bytes(saltLabel));
        grant = _createGrant(
            _grantCreate(
                salt,
                holder,
                address(token),
                address(paymentToken),
                _terms(GRANT_SIZE, PRICE, EXPIRY, CLIFF, VESTING_END)
            )
        );
        grantAddress = address(grant);
    }

    function _createGrant(GrantCreate memory create) internal returns (TokenGrant grant) {
        address grantAddress = factory.predictGrantAddress(create.salt);
        _approve(create.token, issuer, grantAddress, create.terms[0]);

        vm.prank(issuer);
        address created = factory.createGrant(
            create.holder,
            create.token,
            create.paymentToken,
            create.terms[0],
            create.terms[1],
            create.terms[2],
            create.terms[3],
            create.terms[4],
            create.salt
        );

        assertEq(created, grantAddress);
        grant = TokenGrant(grantAddress);
    }

    function _createGrantExpectRevert(
        bytes memory expectedRevertData,
        string memory saltLabel,
        address token_,
        address holder_,
        address paymentToken_,
        uint256[5] memory terms
    ) internal {
        bytes32 salt = keccak256(bytes(saltLabel));
        address grantAddress = factory.predictGrantAddress(salt);
        _approve(token_, issuer, grantAddress, terms[0]);

        vm.prank(issuer);
        vm.expectRevert(expectedRevertData);
        factory.createGrant(holder_, token_, paymentToken_, terms[0], terms[1], terms[2], terms[3], terms[4], salt);
    }

    function _terms(uint256 amount_, uint256 price_, uint256 expiry_, uint256 vestingCliff_, uint256 vestingEnd_)
        internal
        pure
        returns (uint256[5] memory terms)
    {
        terms[0] = amount_;
        terms[1] = price_;
        terms[2] = expiry_;
        terms[3] = vestingCliff_;
        terms[4] = vestingEnd_;
    }

    function _grantCreate(bytes32 salt, address holder_, address token_, address paymentToken_, uint256[5] memory terms)
        internal
        pure
        returns (GrantCreate memory create)
    {
        create.salt = salt;
        create.holder = holder_;
        create.token = token_;
        create.paymentToken = paymentToken_;
        create.terms = terms;
    }

    function _approve(address token_, address tokenOwner, address spender, uint256 amount_) internal {
        vm.prank(tokenOwner);
        (bool success, bytes memory returnData) =
            token_.call(abi.encodeWithSignature("approve(address,uint256)", spender, amount_));

        assertTrue(success, "approve failed");
        if (returnData.length > 0) {
            assertTrue(abi.decode(returnData, (bool)), "approve returned false");
        }
    }
}
