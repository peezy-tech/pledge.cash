// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {Boardroom} from "../../src/boardroom/Boardroom.sol";
import {BoardroomFactory} from "../../src/boardroom/BoardroomFactory.sol";
import {BoardroomToken} from "../../src/boardroom/BoardroomToken.sol";
import {IBoardroom} from "../../src/boardroom/IBoardroom.sol";
import {BoardroomTestWrappedNative} from "./Boardroom.t.sol";

contract BoardroomLifecycleHandler {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    Boardroom public immutable boardroom;
    BoardroomToken public immutable shares;
    uint8 public highestStatus;

    constructor(Boardroom boardroom_) {
        boardroom = boardroom_;
        shares = BoardroomToken(boardroom_.shareToken());
    }

    function mint(address recipient, uint256 amount) external {
        if (recipient == address(0) || uint8(boardroom.status()) != uint8(IBoardroom.Status.Active)) return;
        amount = (amount % 1e24) + 1;
        try boardroom.mint(recipient, amount) {} catch {}
        _record();
    }

    function startWindDown() external {
        try boardroom.startWindDown() {} catch {}
        _record();
    }

    function beginSnapshot() external {
        if (boardroom.status() == IBoardroom.Status.WindingDown) {
            vm.warp(boardroom.windDownStartedAt() + boardroom.windDownDelay());
        }
        try boardroom.beginSnapshot() {} catch {}
        _record();
    }

    function snapshot(uint256 maximum) external {
        maximum = (maximum % boardroom.MAX_SNAPSHOT_PAGE()) + 1;
        try boardroom.snapshotAssets(maximum) {} catch {}
        _record();
    }

    function openRedemptions() external {
        try boardroom.openRedemptions() {} catch {}
        _record();
    }

    function _record() internal {
        uint8 current = uint8(boardroom.status());
        if (current > highestStatus) highestStatus = current;
    }
}

contract BoardroomLifecycleInvariantTest is StdInvariant, Test {
    BoardroomTestWrappedNative internal wrappedNative;
    BoardroomFactory internal factory;
    Boardroom internal boardroom;
    BoardroomToken internal shares;
    BoardroomLifecycleHandler internal handler;

    function setUp() public {
        wrappedNative = new BoardroomTestWrappedNative();
        factory = new BoardroomFactory(address(wrappedNative));
        address predicted = factory.predictBoardroomAddress(address(this), "Invariant", "INV", bytes32(uint256(1)));
        boardroom = Boardroom(payable(factory.createBoardroom(address(this), "Invariant", "INV", bytes32(uint256(1)))));
        assertEq(address(boardroom), predicted);
        shares = BoardroomToken(boardroom.shareToken());
        handler = new BoardroomLifecycleHandler(boardroom);
        boardroom.mint(address(handler), 1 ether);
        boardroom.transferOwnership(address(handler));
        targetContract(address(handler));
    }

    function invariantStatusNeverMovesBackward() public view {
        assertEq(uint8(boardroom.status()), handler.highestStatus());
    }

    function invariantCanonicalIdentitiesNeverChange() public view {
        assertTrue(factory.isBoardroom(address(boardroom)));
        assertTrue(factory.isShareToken(address(shares)));
        assertEq(shares.boardroom(), address(boardroom));
        assertEq(boardroom.factory(), address(factory));
        assertEq(boardroom.shareToken(), address(shares));
    }

    function invariantSnapshotStateIsInternallyOrdered() public view {
        IBoardroom.Status current = boardroom.status();
        (uint256 frozenSupply, bool supplyFrozen) = boardroom.redemptionSupplyState();
        (uint256 frozenAssets, uint256 cursor, bool assetsFrozen) = boardroom.assetSnapshotProgress();
        if (uint8(current) >= uint8(IBoardroom.Status.Snapshotting)) {
            assertTrue(supplyFrozen);
            assertTrue(assetsFrozen);
            assertEq(boardroom.openEscrowCount(), 0);
            assertGt(frozenSupply, 0);
            assertLe(cursor, frozenAssets);
            assertEq(shares.balanceOf(address(boardroom)), 0);
        }
        if (current == IBoardroom.Status.RedemptionsOpen) assertEq(cursor, frozenAssets);
    }
}
