// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";
import {TokenGrant} from "../../src/grants/TokenGrant.sol";
import {TokenGrantFactory} from "../../src/grants/TokenGrantFactory.sol";
import {TestERC20 as InvariantERC20} from "../helpers/TestTokens.sol";

contract TokenGrantInvariantBoardroomFactory {
    mapping(address => bool) public isBoardroom;
}

contract TokenGrantInvariantHandler is Test {
    TokenGrant public immutable grant;
    InvariantERC20 public immutable paymentToken;
    address public immutable holder;
    address public immutable owner;
    uint256 public immutable expiry;
    uint256 public currentTime = 1;

    constructor(TokenGrant grant_, InvariantERC20 paymentToken_, address holder_, address owner_) {
        grant = grant_;
        paymentToken = paymentToken_;
        holder = holder_;
        owner = owner_;
        expiry = grant_.expiry();
    }

    function settle(uint256 amountSeed, uint256 timeStepSeed) external {
        _advance(timeStepSeed);
        if (block.timestamp > expiry) return;

        uint256 settleable = grant.getSettleableAmount(block.timestamp);
        if (settleable == 0) return;

        uint256 amount = bound(amountSeed, 1, settleable);
        uint256 cost = grant.getSettlementCost(amount);

        vm.prank(holder);
        paymentToken.approve(address(grant), cost);

        vm.prank(holder);
        try grant.settle(amount) {} catch {}
    }

    function halt(uint256 timeStepSeed) external {
        _advance(timeStepSeed);
        if (grant.vestingIsHalted()) return;

        vm.prank(owner);
        try grant.stopVestingAndWithdrawUnvested() {} catch {}
    }

    function withdrawExpired(uint256 timeStepSeed) external {
        _advance(timeStepSeed);
        if (block.timestamp <= expiry) return;

        vm.prank(owner);
        try grant.withdrawExpiredTokens() {} catch {}
    }

    function _advance(uint256 seed) internal {
        uint256 step = bound(seed, 0, 700);
        uint256 nextTime = currentTime + step;
        uint256 maxTime = expiry + 500;
        currentTime = nextTime > maxTime ? maxTime : nextTime;
        vm.warp(currentTime);
    }
}

contract TokenGrantInvariantTest is StdInvariant, Test {
    TokenGrantFactory internal factory;
    TokenGrant internal grant;
    InvariantERC20 internal token;
    InvariantERC20 internal paymentToken;
    TokenGrantInvariantHandler internal handler;

    address internal owner = address(0xA11CE);
    address internal holder = address(0xB0B);

    uint256 internal constant GRANT_SIZE = 100 ether;
    uint256 internal constant PRICE = 2_000000;
    uint256 internal constant CLIFF = 1_000;
    uint256 internal constant VESTING_END = 2_000;
    uint256 internal constant EXPIRY = VESTING_END + 1 days;

    function setUp() public {
        factory = new TokenGrantFactory(address(this), address(new TokenGrantInvariantBoardroomFactory()));
        token = new InvariantERC20("Grant Token", "GRANT", 18);
        paymentToken = new InvariantERC20("Payment", "PAY", 6);

        token.mint(owner, GRANT_SIZE);
        paymentToken.mint(holder, 1_000_000000);

        bytes32 salt = keccak256("invariant");
        address predicted = factory.predictGrantAddress(owner, salt);

        vm.prank(owner);
        token.approve(address(factory), GRANT_SIZE);

        vm.prank(owner);
        address grantAddress = factory.createGrant(
            holder, address(token), address(paymentToken), GRANT_SIZE, PRICE, EXPIRY, CLIFF, VESTING_END, false, 0, salt
        );
        assertEq(grantAddress, predicted);
        grant = TokenGrant(grantAddress);

        handler = new TokenGrantInvariantHandler(grant, paymentToken, holder, owner);
        targetContract(address(handler));
    }

    function invariantAccountingBounds() public view {
        assertLe(grant.settledAmount(), grant.claimable());
        assertLe(grant.claimable(), grant.grantSize());

        if (!grant.vestingIsHalted()) {
            assertEq(grant.vestingHaltTimestamp(), 0);
        }

        uint256 vested = grant.getCurrentlyVestedSnapshot(block.timestamp);
        assertLe(vested, grant.claimable());
        assertLe(grant.getSettleableAmount(block.timestamp), grant.claimable() - grant.settledAmount());

        if (block.timestamp <= grant.expiry()) {
            assertGe(token.balanceOf(address(grant)), grant.claimable() - grant.settledAmount());
        }
    }

    function invariantHaltedVestingDoesNotIncrease() public view {
        if (!grant.vestingIsHalted()) return;

        assertEq(grant.getCurrentlyVestedSnapshot(grant.expiry()), grant.claimable());
    }
}
