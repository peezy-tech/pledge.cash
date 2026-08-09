// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Boardroom} from "../../src/boardroom/Boardroom.sol";
import {BoardroomFactory} from "../../src/boardroom/BoardroomFactory.sol";
import {BoardroomToken} from "../../src/boardroom/BoardroomToken.sol";
import {IBoardroom} from "../../src/boardroom/IBoardroom.sol";
import {ProtocolFeeRouter} from "../../src/fees/ProtocolFeeRouter.sol";
import {TokenGrant} from "../../src/grants/TokenGrant.sol";
import {TokenGrantFactory} from "../../src/grants/TokenGrantFactory.sol";
import {LiquidityLocker} from "../../src/uniswap/LiquidityLocker.sol";
import {LiquidityLockerFactory} from "../../src/uniswap/LiquidityLockerFactory.sol";
import {PositionManagerMock} from "../helpers/PositionManagerMock.sol";
import {
    DepositOnlyTestWrappedNative as LeanScenarioWrappedNative,
    SoladyTestERC20 as LeanScenarioToken
} from "../helpers/TestTokens.sol";

/// @notice Local proof of every retained asset and lifecycle boundary.
contract LeanCoreScenarioTest is Test {
    uint256 internal constant GRANT_SHARES = 100 ether;
    uint128 internal constant POSITION_SHARES = 200 ether;
    uint128 internal constant POSITION_QUOTE = 600 ether;
    uint128 internal constant QUOTE_FEES = 100 ether;
    uint256 internal constant TOKEN_ID = 1;

    address internal issuer = makeAddr("external-project-share-issuer");
    address internal holder = makeAddr("project-holder");
    address internal protocolTreasury = makeAddr("protocol-treasury");

    LeanScenarioWrappedNative internal wrappedNative;
    LeanScenarioToken internal quote;
    BoardroomFactory internal boardroomFactory;
    ProtocolFeeRouter internal feeRouter;
    TokenGrantFactory internal grantFactory;
    PositionManagerMock internal positionManager;
    LiquidityLockerFactory internal lockerFactory;
    Boardroom internal boardroom;
    BoardroomToken internal shares;
    TokenGrant internal grant;
    LiquidityLocker internal locker;

    function setUp() public {
        wrappedNative = new LeanScenarioWrappedNative();
        quote = new LeanScenarioToken("Scenario Quote", "QUOTE");
        boardroomFactory = new BoardroomFactory(address(wrappedNative));
        feeRouter = new ProtocolFeeRouter(address(this), protocolTreasury);
        grantFactory = new TokenGrantFactory(address(this), address(boardroomFactory));
        grantFactory.setFeeRecipient(address(feeRouter));
        positionManager = new PositionManagerMock();
        lockerFactory = new LiquidityLockerFactory(address(boardroomFactory), positionManager, address(feeRouter));
    }

    function testCreateGrantLockCollectWindDownAndRedeem() public {
        _createProjectAndGrant();
        (uint128 principal0, uint128 principal1) = _lockPosition();
        _collectFees();
        _windDown(principal0, principal1);
        _redeem();
    }

    function _createProjectAndGrant() internal {
        boardroom = Boardroom(
            payable(boardroomFactory.createBoardroom(
                    address(this), "Lean Scenario Project", "LEAN", keccak256("lean-scenario-boardroom")
                ))
        );
        shares = BoardroomToken(boardroom.shareToken());

        // Project-share grants use an external issuer because a Boardroom cannot
        // execute an approval against its own share token.
        boardroom.mint(issuer, GRANT_SHARES);
        vm.startPrank(issuer);
        shares.approve(address(grantFactory), GRANT_SHARES);
        grant = TokenGrant(
            grantFactory.createGrant(
                holder,
                address(shares),
                address(0),
                GRANT_SHARES,
                0,
                block.timestamp + 2 days,
                block.timestamp,
                block.timestamp,
                false,
                0,
                keccak256("lean-scenario-grant")
            )
        );
        vm.stopPrank();
        vm.prank(holder);
        grant.settle(GRANT_SHARES);

        assertTrue(grant.isClosed(), "grant did not close after full settlement");
        assertEq(shares.balanceOf(holder), GRANT_SHARES, "holder did not receive project shares");
    }

    function _lockPosition() internal returns (uint128 principal0, uint128 principal1) {
        bytes memory lockerResult = boardroom.execute(
            IBoardroom.Call({
                target: address(lockerFactory),
                value: 0,
                data: abi.encodeCall(
                    lockerFactory.createLocker,
                    (address(quote), uint24(3_000), int24(60), keccak256("lean-scenario-locker"))
                )
            })
        );
        locker = LiquidityLocker(abi.decode(lockerResult, (address)));

        boardroom.mint(address(positionManager), POSITION_SHARES);
        quote.mint(address(positionManager), uint256(POSITION_QUOTE) + QUOTE_FEES);
        (principal0, principal1) = locker.currency0() == address(shares)
            ? (POSITION_SHARES, POSITION_QUOTE)
            : (POSITION_QUOTE, POSITION_SHARES);
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(locker.currency0()),
            currency1: Currency.wrap(locker.currency1()),
            fee: 3_000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        positionManager.mintDirect(address(locker), TOKEN_ID, key, -120, 120, 1_000, principal0, principal1);
        boardroom.execute(
            IBoardroom.Call({
                target: address(locker), value: 0, data: abi.encodeCall(locker.registerPosition, (TOKEN_ID))
            })
        );
        assertTrue(locker.positionRegistered(), "PositionManager NFT was not registered");
    }

    function _collectFees() internal {
        (uint128 fee0, uint128 fee1) =
            locker.currency0() == address(quote) ? (QUOTE_FEES, uint128(0)) : (uint128(0), QUOTE_FEES);
        positionManager.accrueFees(TOKEN_ID, fee0, fee1);
        (uint256 boardroomAmount0, uint256 boardroomAmount1, uint256 protocolAmount0, uint256 protocolAmount1) =
            locker.collectFees();
        uint256 boardroomQuoteFees = locker.currency0() == address(quote) ? boardroomAmount0 : boardroomAmount1;
        uint256 protocolQuoteFees = locker.currency0() == address(quote) ? protocolAmount0 : protocolAmount1;

        assertEq(boardroomQuoteFees, 95 ether, "Boardroom fee share is not 95 percent");
        assertEq(protocolQuoteFees, 5 ether, "protocol fee share is not 5 percent");
        assertEq(quote.balanceOf(address(feeRouter)), 5 ether, "protocol fees did not reach router");
    }

    function _windDown(uint128 principal0, uint128 principal1) internal {
        boardroom.startWindDown();
        boardroom.executeEscrow(
            address(locker), abi.encodeCall(locker.exit, (principal0, principal1, block.timestamp + 1))
        );

        assertTrue(locker.isClosed(), "locker did not close");
        assertEq(boardroom.openEscrowCount(), 0, "locker escrow did not close");
        assertEq(quote.balanceOf(address(boardroom)), 695 ether, "principal and fees did not reach treasury");

        vm.warp(block.timestamp + boardroom.MIN_WIND_DOWN_DELAY());
        boardroom.beginSnapshot();
        boardroom.snapshotAssets(boardroom.MAX_SNAPSHOT_PAGE());
        boardroom.openRedemptions();
        assertEq(shares.totalSupply(), GRANT_SHARES, "treasury liquidity shares did not burn");
    }

    function _redeem() internal {
        vm.startPrank(holder);
        boardroom.redeem(GRANT_SHARES);
        uint256 quoteRedeemed = boardroom.claimRedemptionAsset(address(quote), holder, 695 ether);
        boardroom.claimRedemptionAsset(address(wrappedNative), holder, 0);
        vm.stopPrank();

        assertEq(quoteRedeemed, 695 ether, "holder did not receive the frozen quote treasury");
        assertEq(quote.balanceOf(holder), 695 ether, "redemption transfer did not settle");
        assertEq(quote.balanceOf(address(boardroom)), 0, "Boardroom retained redeemed quote");
        assertEq(shares.totalSupply(), 0, "redeemed project shares did not burn");
        assertEq(quote.balanceOf(address(feeRouter)), 5 ether, "redemption consumed protocol fees");
    }
}
