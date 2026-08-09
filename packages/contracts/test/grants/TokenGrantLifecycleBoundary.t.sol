// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Boardroom} from "../../src/boardroom/Boardroom.sol";
import {BoardroomFactory} from "../../src/boardroom/BoardroomFactory.sol";
import {IBoardroom} from "../../src/boardroom/IBoardroom.sol";
import {TokenGrant} from "../../src/grants/TokenGrant.sol";
import {TokenGrantFactory} from "../../src/grants/TokenGrantFactory.sol";
import {GrantERC20, MutableFailureGrantERC20} from "./TokenGrant.t.sol";

contract TokenGrantLifecycleBoundaryTest is Test {
    BoardroomFactory internal boardroomFactory;
    Boardroom internal boardroom;
    TokenGrantFactory internal factory;
    GrantERC20 internal wrappedNative;
    GrantERC20 internal token;
    GrantERC20 internal paymentToken;

    address internal holder = address(0xB0B);
    address internal standaloneIssuer = address(0xA11CE);

    uint256 internal constant GRANT_SIZE = 100 ether;
    uint256 internal constant PRICE = 2_000000;

    function setUp() public {
        vm.warp(1_000_000);
        wrappedNative = new GrantERC20("Wrapped Ether", "WETH", 18);
        boardroomFactory = new BoardroomFactory(address(wrappedNative));
        boardroom = Boardroom(
            payable(boardroomFactory.createBoardroom(
                    address(this), "Grant Boardroom", "GRANT", keccak256("grant-boardroom")
                ))
        );
        factory = new TokenGrantFactory(address(this), address(boardroomFactory));
        token = new GrantERC20("Grant Token", "TOKEN", 18);
        paymentToken = new GrantERC20("Payment", "PAY", 6);

        token.mint(address(boardroom), 10 * GRANT_SIZE);
        paymentToken.mint(holder, 1_000_000000);
    }

    function testBoardroomExecuteCreatesRegisteredGrantEscrowAndReservesAssets() public {
        (uint256 cliff, uint256 vestingEnd, uint256 expiry) = _schedule();
        TokenGrant grant = _createBoardroomGrant(
            address(token), address(paymentToken), PRICE, expiry, cliff, vestingEnd, keccak256("registered")
        );

        assertEq(grant.issuer(), address(boardroom));
        assertEq(token.balanceOf(address(grant)), GRANT_SIZE);
        assertEq(factory.ownerOf(grant.tokenId()), holder);
        assertTrue(factory.isCanonicalBoardroom(address(boardroom)));
        assertTrue(boardroom.isRedeemableAsset(address(token)));
        assertTrue(boardroom.isRedeemableAsset(address(paymentToken)));
        assertEq(boardroom.openEscrowCount(), 1);
        assertEq(uint256(boardroom.escrowState(address(grant))), uint256(IBoardroom.EscrowState.Open));
    }

    function testPaidBoardroomGrantSettlementRoutesPaymentBackToTreasury() public {
        (uint256 cliff, uint256 vestingEnd, uint256 expiry) = _schedule();
        TokenGrant grant = _createBoardroomGrant(
            address(token), address(paymentToken), PRICE, expiry, cliff, vestingEnd, keccak256("paid-settlement")
        );
        uint256 paymentAmount = grant.getSettlementCost(GRANT_SIZE);
        vm.warp(vestingEnd);
        vm.prank(holder);
        paymentToken.approve(address(grant), paymentAmount);

        vm.prank(holder);
        grant.settle(GRANT_SIZE);

        assertTrue(grant.isClosed());
        assertEq(token.balanceOf(holder), GRANT_SIZE);
        assertEq(paymentToken.balanceOf(address(boardroom)), paymentAmount);
        boardroom.pruneEscrow(address(grant));
        assertEq(boardroom.openEscrowCount(), 0);
    }

    function testCanonicalBoardroomGrantMustEnterThroughBoardroomExecute() public {
        (uint256 cliff, uint256 vestingEnd, uint256 expiry) = _schedule();
        bytes32 salt = keccak256("outside-execution");
        _approveFromBoardroom(address(token), GRANT_SIZE);
        uint256 balanceBefore = token.balanceOf(address(boardroom));

        vm.prank(address(boardroom));
        vm.expectRevert(abi.encodeWithSelector(Boardroom.InvalidExecutionContext.selector, address(factory)));
        factory.createGrant(
            holder, address(token), address(0), GRANT_SIZE, 0, expiry, cliff, vestingEnd, false, 0, salt
        );

        assertEq(token.balanceOf(address(boardroom)), balanceBefore);
        assertEq(
            factory.grantForTokenId(uint256(uint160(factory.predictGrantAddress(address(boardroom), salt)))), address(0)
        );
        assertEq(boardroom.openEscrowCount(), 0);
    }

    function testWindDownCannotSnapshotUntilClosedGrantIsPruned() public {
        uint256 cliff = block.timestamp;
        uint256 vestingEnd = block.timestamp;
        uint256 expiry = block.timestamp + 2 days;
        TokenGrant grant =
            _createBoardroomGrant(address(token), address(0), 0, expiry, cliff, vestingEnd, keccak256("snapshot-gate"));
        boardroom.mint(holder, 1 ether);
        boardroom.startWindDown();
        vm.warp(block.timestamp + boardroom.MIN_WIND_DOWN_DELAY());

        vm.expectRevert(Boardroom.SnapshotNotReady.selector);
        boardroom.beginSnapshot();

        vm.prank(holder);
        grant.settle(GRANT_SIZE);
        assertTrue(grant.isClosed());
        assertEq(boardroom.openEscrowCount(), 1);

        boardroom.pruneEscrow(address(grant));
        assertEq(boardroom.openEscrowCount(), 0);

        boardroom.beginSnapshot();
        assertEq(uint256(boardroom.status()), uint256(IBoardroom.Status.Snapshotting));
    }

    function testBoardroomExecuteEscrowClosesUnvestedGrantAndReturnsAssets() public {
        (uint256 cliff, uint256 vestingEnd, uint256 expiry) = _schedule();
        TokenGrant grant = _createBoardroomGrant(
            address(token), address(0), 0, expiry, cliff, vestingEnd, keccak256("wind-down-close")
        );
        uint256 balanceBefore = token.balanceOf(address(boardroom));

        boardroom.startWindDown();
        boardroom.executeEscrow(address(grant), abi.encodeCall(TokenGrant.stopVestingAndWithdrawUnvested, ()));

        assertTrue(grant.isClosed());
        assertTrue(grant.vestingIsHalted());
        assertEq(token.balanceOf(address(boardroom)), balanceBefore + GRANT_SIZE);
        assertEq(boardroom.openEscrowCount(), 0);
        assertEq(uint256(boardroom.escrowState(address(grant))), uint256(IBoardroom.EscrowState.Closed));
    }

    function testExpiredBoardroomGrantCanQuarantineMutatedToken() public {
        MutableFailureGrantERC20 mutableToken = new MutableFailureGrantERC20();
        mutableToken.mint(address(boardroom), GRANT_SIZE);
        (uint256 cliff, uint256 vestingEnd, uint256 expiry) = _schedule();
        TokenGrant grant = _createBoardroomGrant(
            address(mutableToken), address(0), 0, expiry, cliff, vestingEnd, keccak256("quarantine")
        );

        mutableToken.setTransfersFail(true);
        boardroom.startWindDown();
        vm.warp(expiry + 1);
        boardroom.executeEscrow(address(grant), abi.encodeCall(TokenGrant.quarantineAndClose, ()));

        assertTrue(grant.isClosed());
        assertTrue(grant.isQuarantined());
        assertEq(grant.quarantinedAmount(), GRANT_SIZE);
        assertEq(mutableToken.balanceOf(address(grant)), GRANT_SIZE);
        assertEq(boardroom.openEscrowCount(), 0);
    }

    function testExpiredBoardroomGrantQuarantineRecoversHealthyToken() public {
        (uint256 cliff, uint256 vestingEnd, uint256 expiry) = _schedule();
        TokenGrant grant = _createBoardroomGrant(
            address(token), address(0), 0, expiry, cliff, vestingEnd, keccak256("healthy-quarantine")
        );
        uint256 balanceBefore = token.balanceOf(address(boardroom));

        boardroom.startWindDown();
        vm.warp(expiry + 1);
        boardroom.executeEscrow(address(grant), abi.encodeCall(TokenGrant.quarantineAndClose, ()));

        assertTrue(grant.isClosed());
        assertFalse(grant.isQuarantined());
        assertEq(grant.quarantinedAmount(), 0);
        assertEq(token.balanceOf(address(grant)), 0);
        assertEq(token.balanceOf(address(boardroom)), balanceBefore + GRANT_SIZE);
        assertEq(boardroom.openEscrowCount(), 0);
    }

    function testCanonicalBoardroomGrantDurationIsBoundedButStandaloneGrantIsNot() public {
        uint256 maximum = block.timestamp + factory.MAX_BOARDROOM_GRANT_DURATION();
        uint256 longExpiry = maximum + 1;
        uint256 cliff = block.timestamp;
        uint256 vestingEnd = block.timestamp + 1 days;
        _approveFromBoardroom(address(token), GRANT_SIZE);

        vm.expectRevert(
            abi.encodeWithSelector(TokenGrantFactory.BoardroomGrantExpiryTooFar.selector, longExpiry, maximum)
        );
        boardroom.execute(
            IBoardroom.Call({
                target: address(factory),
                value: 0,
                data: _createGrantData(
                    address(token), address(0), 0, longExpiry, cliff, vestingEnd, keccak256("boardroom-too-long")
                )
            })
        );

        token.mint(standaloneIssuer, GRANT_SIZE);
        vm.prank(standaloneIssuer);
        token.approve(address(factory), GRANT_SIZE);
        vm.prank(standaloneIssuer);
        address standaloneGrant = factory.createGrant(
            holder,
            address(token),
            address(0),
            GRANT_SIZE,
            0,
            longExpiry,
            cliff,
            vestingEnd,
            false,
            0,
            keccak256("standalone-long")
        );
        assertEq(TokenGrant(standaloneGrant).expiry(), longExpiry);
    }

    function _createBoardroomGrant(
        address grantToken,
        address payment,
        uint256 price,
        uint256 expiry,
        uint256 cliff,
        uint256 vestingEnd,
        bytes32 salt
    ) internal returns (TokenGrant grant) {
        _approveFromBoardroom(grantToken, GRANT_SIZE);
        bytes memory result = boardroom.execute(
            IBoardroom.Call({
                target: address(factory),
                value: 0,
                data: _createGrantData(grantToken, payment, price, expiry, cliff, vestingEnd, salt)
            })
        );
        grant = TokenGrant(abi.decode(result, (address)));
    }

    function _approveFromBoardroom(address grantToken, uint256 amount) internal {
        bytes memory result = boardroom.execute(
            IBoardroom.Call({
                target: grantToken, value: 0, data: abi.encodeCall(GrantERC20.approve, (address(factory), amount))
            })
        );
        assertTrue(abi.decode(result, (bool)));
    }

    function _createGrantData(
        address grantToken,
        address payment,
        uint256 price,
        uint256 expiry,
        uint256 cliff,
        uint256 vestingEnd,
        bytes32 salt
    ) internal view returns (bytes memory) {
        return abi.encodeCall(
            TokenGrantFactory.createGrant,
            (holder, grantToken, payment, GRANT_SIZE, price, expiry, cliff, vestingEnd, false, 0, salt)
        );
    }

    function _schedule() internal view returns (uint256 cliff, uint256 vestingEnd, uint256 expiry) {
        cliff = block.timestamp + 1 days;
        vestingEnd = cliff + 30 days;
        expiry = vestingEnd + 1 days;
    }
}
