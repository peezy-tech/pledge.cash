// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Boardroom} from "../src/Boardroom.sol";
import {BoardroomFactory} from "../src/BoardroomFactory.sol";
import {BoardroomPolicyRegistry} from "../src/BoardroomPolicyRegistry.sol";
import {BoardroomToken} from "../src/BoardroomToken.sol";
import {DistributionFactory} from "../src/DistributionFactory.sol";
import {FixedPriceSale} from "../src/FixedPriceSale.sol";
import {IBoardroomCallPolicy} from "../src/IBoardroomCallPolicy.sol";

contract DistributionCurrency {
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

contract FeeOnTransferDistributionCurrency is DistributionCurrency {
    uint256 internal immutable feeBps;

    constructor(string memory name_, string memory symbol_, uint8 decimals_, uint256 feeBps_)
        DistributionCurrency(name_, symbol_, decimals_)
    {
        feeBps = feeBps_;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        uint256 fee = amount * feeBps / 10_000;
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount - fee;
        totalSupply -= fee;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }

        uint256 fee = amount * feeBps / 10_000;
        balanceOf[from] -= amount;
        balanceOf[to] += amount - fee;
        totalSupply -= fee;
        return true;
    }
}

contract DistributionTestAllowAllPolicy is IBoardroomCallPolicy {
    function canCall(address, address, address, uint256, bytes calldata) external pure returns (bool) {
        return true;
    }
}

contract DistributionTest is Test {
    BoardroomPolicyRegistry internal policyRegistry;
    BoardroomFactory internal boardroomFactory;
    DistributionFactory internal distributionFactory;
    DistributionCurrency internal paymentToken;

    address internal owner = address(0xA11CE);
    address internal buyer = address(0xB0B);
    address internal recipient = address(0xC0FFEE);

    uint256 internal constant SALE_SHARES = 1_000 ether;
    uint256 internal constant PRICE = 2_000000;
    uint256 internal constant BUY_SHARES = 250 ether;
    uint256 internal constant BUY_PAYMENT = 500_000000;

    function setUp() public {
        policyRegistry = new BoardroomPolicyRegistry(address(this));
        boardroomFactory = new BoardroomFactory(address(policyRegistry));
        distributionFactory = new DistributionFactory();
        paymentToken = new DistributionCurrency("USD Coin", "USDC", 6);

        policyRegistry.setPolicyAllowed(address(distributionFactory), true);
        paymentToken.mint(buyer, 10_000_000000);
    }

    function testBoardroomCanCreateFixedPriceSaleAndBuyerCanPurchase() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("fixed-sale");
        FixedPriceSale sale = _createFixedPriceSale(boardroom, shareToken, paymentToken, "fixed-sale-create");

        assertEq(sale.boardroom(), address(boardroom));
        assertEq(sale.shareToken(), address(shareToken));
        assertEq(sale.paymentToken(), address(paymentToken));
        assertEq(sale.saleSupply(), SALE_SHARES);
        assertEq(sale.remainingShares(), SALE_SHARES);
        assertEq(shareToken.balanceOf(address(sale)), SALE_SHARES);
        assertEq(shareToken.allowance(address(boardroom), address(distributionFactory)), 0);
        assertEq(distributionFactory.distributionCountForBoardroom(address(boardroom)), 1);
        assertEq(distributionFactory.distributionForBoardroomAt(address(boardroom), 0), address(sale));
        assertTrue(distributionFactory.isDistribution(address(sale)));

        vm.prank(buyer);
        paymentToken.approve(address(sale), BUY_PAYMENT);

        vm.prank(buyer);
        uint256 payment = sale.buy(BUY_SHARES, recipient, BUY_PAYMENT, block.timestamp);

        assertEq(payment, BUY_PAYMENT);
        assertEq(shareToken.balanceOf(recipient), BUY_SHARES);
        assertEq(paymentToken.balanceOf(address(boardroom)), BUY_PAYMENT);
        assertEq(paymentToken.balanceOf(buyer), 10_000_000000 - BUY_PAYMENT);
        assertEq(sale.remainingShares(), SALE_SHARES - BUY_SHARES);
        assertEq(sale.purchasedBy(buyer), BUY_SHARES);
    }

    function testFixedPriceSaleRoundsPaymentUpForDustPurchase() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("fixed-sale-dust");
        FixedPriceSale sale = _createFixedPriceSale(boardroom, shareToken, paymentToken, "fixed-sale-dust-create");

        vm.prank(buyer);
        paymentToken.approve(address(sale), 1);

        vm.prank(buyer);
        uint256 payment = sale.buy(1, buyer, 1, block.timestamp);

        assertEq(payment, 1);
        assertEq(shareToken.balanceOf(buyer), 1);
        assertEq(paymentToken.balanceOf(address(boardroom)), 1);
        assertEq(sale.remainingShares(), SALE_SHARES - 1);
    }

    function testBoardroomCanCloseFixedPriceSaleAndRecoverUnsoldShares() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("fixed-sale-close");
        FixedPriceSale sale = _createFixedPriceSale(boardroom, shareToken, paymentToken, "fixed-sale-close-create");

        vm.prank(buyer);
        paymentToken.approve(address(sale), BUY_PAYMENT);

        vm.prank(buyer);
        sale.buy(BUY_SHARES, buyer, BUY_PAYMENT, block.timestamp);

        vm.prank(owner);
        boardroom.execute(
            _policyCall(address(distributionFactory), address(sale), 0, abi.encodeCall(FixedPriceSale.close, ()))
        );

        assertTrue(sale.isClosed());
        assertEq(sale.remainingShares(), 0);
        assertEq(shareToken.balanceOf(address(boardroom)), SALE_SHARES - BUY_SHARES);

        vm.prank(buyer);
        vm.expectRevert(FixedPriceSale.SaleNotActive.selector);
        sale.buy(1 ether, buyer, PRICE, block.timestamp);
    }

    function testBoardroomCanCancelFixedPriceSaleAndRecoverInventory() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("fixed-sale-cancel");
        FixedPriceSale sale = _createFixedPriceSale(boardroom, shareToken, paymentToken, "fixed-sale-cancel-create");

        vm.prank(owner);
        boardroom.execute(
            _policyCall(address(distributionFactory), address(sale), 0, abi.encodeCall(FixedPriceSale.cancel, ()))
        );

        assertTrue(sale.isClosed());
        assertEq(sale.remainingShares(), 0);
        assertEq(shareToken.balanceOf(address(boardroom)), SALE_SHARES);
    }

    function testBoardroomRedemptionsWaitForFixedPriceSaleToClose() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("fixed-sale-wind-down");
        FixedPriceSale sale = _createFixedPriceSale(boardroom, shareToken, paymentToken, "fixed-sale-wind-down-create");

        assertEq(boardroom.issuedDistributionCount(), 1);
        assertEq(boardroom.issuedDistributionAt(0), address(sale));
        assertTrue(boardroom.isIssuedDistribution(address(sale)));

        vm.prank(owner);
        boardroom.startWindDown();

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Boardroom.IssuedDistributionStillOpen.selector, address(sale)));
        boardroom.openRedemptions();

        vm.prank(owner);
        boardroom.execute(
            _policyCall(address(distributionFactory), address(sale), 0, abi.encodeCall(FixedPriceSale.close, ()))
        );

        assertTrue(sale.isClosed());

        vm.prank(owner);
        boardroom.openRedemptions();

        assertEq(uint8(boardroom.status()), uint8(Boardroom.BoardroomStatus.RedemptionsOpen));
    }

    function testBoardroomRecordsFixedPriceSaleCreatedThroughWrapperPolicy() public {
        DistributionTestAllowAllPolicy wrapperPolicy = new DistributionTestAllowAllPolicy();
        policyRegistry.setPolicyAllowed(address(wrapperPolicy), true);

        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("fixed-sale-wrapper-policy");

        vm.startPrank(owner);
        boardroom.mint(address(boardroom), SALE_SHARES);

        bytes32 salt = keccak256("fixed-sale-wrapper-policy-create");
        FixedPriceSale.CreateParams memory params =
            _saleParams(address(shareToken), address(paymentToken), SALE_SHARES, PRICE, salt);

        Boardroom.Call[] memory calls = new Boardroom.Call[](2);
        calls[0] = Boardroom.Call({
            policy: address(wrapperPolicy),
            target: address(shareToken),
            value: 0,
            data: abi.encodeWithSignature("approve(address,uint256)", address(distributionFactory), SALE_SHARES)
        });
        calls[1] = Boardroom.Call({
            policy: address(wrapperPolicy),
            target: address(distributionFactory),
            value: 0,
            data: abi.encodeCall(DistributionFactory.createFixedPriceSale, (params))
        });

        bytes[] memory results = boardroom.executeBatch(calls);
        vm.stopPrank();

        address sale = abi.decode(results[1], (address));

        assertEq(boardroom.issuedDistributionCount(), 1);
        assertEq(boardroom.issuedDistributionAt(0), sale);
        assertTrue(boardroom.isIssuedDistribution(sale));

        vm.prank(owner);
        boardroom.startWindDown();

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Boardroom.IssuedDistributionStillOpen.selector, sale));
        boardroom.openRedemptions();
    }

    function testFixedPriceSaleRejectsFeeOnTransferPaymentToken() public {
        (Boardroom boardroom, BoardroomToken shareToken) = _createBoardroom("fixed-fee-token");
        FeeOnTransferDistributionCurrency feeToken = new FeeOnTransferDistributionCurrency("Fee USD", "FUSD", 6, 100);
        feeToken.mint(buyer, 1_000_000000);

        FixedPriceSale sale = _createFixedPriceSale(boardroom, shareToken, feeToken, "fixed-fee-token-create");

        vm.prank(buyer);
        feeToken.approve(address(sale), 100_000000);

        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(
                FixedPriceSale.UnexpectedTokenBalanceChange.selector, address(feeToken), 100_000000, 99_000000
            )
        );
        sale.buy(50 ether, buyer, 100_000000, block.timestamp);

        assertEq(feeToken.balanceOf(address(boardroom)), 0);
        assertEq(shareToken.balanceOf(buyer), 0);
        assertEq(sale.remainingShares(), SALE_SHARES);
    }

    function testDistributionPolicyRejectsNonShareTokenApproval() public {
        (Boardroom boardroom,) = _createBoardroom("reject-non-share-approval");

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                Boardroom.CallNotAllowed.selector,
                address(distributionFactory),
                address(paymentToken),
                DistributionCurrency.approve.selector
            )
        );
        boardroom.execute(
            _policyCall(
                address(distributionFactory),
                address(paymentToken),
                0,
                abi.encodeCall(DistributionCurrency.approve, (address(distributionFactory), 1))
            )
        );
    }

    function testDistributionPolicyRejectsSaleOwnedByAnotherBoardroom() public {
        (Boardroom firstBoardroom, BoardroomToken firstShareToken) = _createBoardroom("first-boardroom");
        (Boardroom secondBoardroom,) = _createBoardroom("second-boardroom");
        FixedPriceSale sale =
            _createFixedPriceSale(firstBoardroom, firstShareToken, paymentToken, "foreign-sale-create");

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                Boardroom.CallNotAllowed.selector,
                address(distributionFactory),
                address(sale),
                FixedPriceSale.close.selector
            )
        );
        secondBoardroom.execute(
            _policyCall(address(distributionFactory), address(sale), 0, abi.encodeCall(FixedPriceSale.close, ()))
        );
    }

    function testDistributionPolicyRejectsSaleForWrongShareToken() public {
        (Boardroom boardroom,) = _createBoardroom("wrong-share-token-sale");
        DistributionCurrency wrongShareToken = new DistributionCurrency("Wrong", "WRONG", 18);
        wrongShareToken.mint(address(boardroom), SALE_SHARES);

        FixedPriceSale.CreateParams memory params = _saleParams(
            address(wrongShareToken),
            address(paymentToken),
            SALE_SHARES,
            PRICE,
            keccak256("wrong-share-token-sale-create")
        );

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                Boardroom.CallNotAllowed.selector,
                address(distributionFactory),
                address(distributionFactory),
                DistributionFactory.createFixedPriceSale.selector
            )
        );
        boardroom.execute(
            _policyCall(
                address(distributionFactory),
                address(distributionFactory),
                0,
                abi.encodeCall(DistributionFactory.createFixedPriceSale, (params))
            )
        );
    }

    function _createBoardroom(string memory saltLabel)
        internal
        returns (Boardroom boardroom, BoardroomToken shareToken)
    {
        address boardroomAddress =
            boardroomFactory.createBoardroom(owner, "Distribution Common", "DIST", keccak256(bytes(saltLabel)));
        boardroom = Boardroom(payable(boardroomAddress));
        shareToken = BoardroomToken(boardroom.shareToken());
    }

    function _createFixedPriceSale(
        Boardroom boardroom,
        BoardroomToken shareToken,
        DistributionCurrency paymentToken_,
        string memory saltLabel
    ) internal returns (FixedPriceSale sale) {
        vm.startPrank(owner);
        boardroom.mint(address(boardroom), SALE_SHARES);

        bytes32 salt = keccak256(bytes(saltLabel));
        address predictedSale = distributionFactory.predictFixedPriceSaleAddress(address(boardroom), salt);
        FixedPriceSale.CreateParams memory params =
            _saleParams(address(shareToken), address(paymentToken_), SALE_SHARES, PRICE, salt);

        Boardroom.Call[] memory calls = new Boardroom.Call[](2);
        calls[0] = _policyCall(
            address(distributionFactory),
            address(shareToken),
            0,
            abi.encodeWithSignature("approve(address,uint256)", address(distributionFactory), SALE_SHARES)
        );
        calls[1] = _policyCall(
            address(distributionFactory),
            address(distributionFactory),
            0,
            abi.encodeCall(DistributionFactory.createFixedPriceSale, (params))
        );

        bytes[] memory results = boardroom.executeBatch(calls);
        vm.stopPrank();

        address createdSale = abi.decode(results[1], (address));
        assertEq(createdSale, predictedSale);
        sale = FixedPriceSale(createdSale);
    }

    function _saleParams(address shareToken, address paymentToken_, uint256 shareAmount, uint256 price, bytes32 salt)
        internal
        view
        returns (FixedPriceSale.CreateParams memory params)
    {
        params = FixedPriceSale.CreateParams({
            shareToken: shareToken,
            paymentToken: paymentToken_,
            shareAmount: shareAmount,
            price: price,
            maxPerBuyer: 0,
            startTime: uint64(block.timestamp),
            endTime: 0,
            salt: salt
        });
    }

    function _policyCall(address policy, address target, uint256 value, bytes memory data)
        internal
        pure
        returns (Boardroom.Call memory call_)
    {
        call_ = Boardroom.Call({policy: policy, target: target, value: value, data: data});
    }
}
