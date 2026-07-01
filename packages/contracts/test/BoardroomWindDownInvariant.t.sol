// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";
import {ERC20} from "solady/tokens/ERC20.sol";
import {Boardroom} from "../src/Boardroom.sol";
import {BoardroomFactory} from "../src/BoardroomFactory.sol";
import {BoardroomPolicyRegistry} from "../src/BoardroomPolicyRegistry.sol";
import {BoardroomToken} from "../src/BoardroomToken.sol";

contract BoardroomWindDownInvariantERC20 is ERC20 {
    string internal tokenName;
    string internal tokenSymbol;
    uint8 internal immutable tokenDecimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) {
        tokenName = name_;
        tokenSymbol = symbol_;
        tokenDecimals = decimals_;
    }

    function name() public view override returns (string memory) {
        return tokenName;
    }

    function symbol() public view override returns (string memory) {
        return tokenSymbol;
    }

    function decimals() public view override returns (uint8) {
        return tokenDecimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract BoardroomWindDownInvariantHandler is Test {
    uint256 public constant HOLDER_A_SHARES = 100 ether;
    uint256 public constant HOLDER_B_SHARES = 200 ether;
    uint256 public constant TREASURY_SHARES = 50 ether;
    uint256 public constant INITIAL_REDEEMABLE_ASSET = 3_000_000000;

    Boardroom public immutable boardroom;
    BoardroomToken public immutable shareToken;
    BoardroomWindDownInvariantERC20 public immutable redeemableAsset;

    address public immutable holderA = address(0xA11CE);
    address public immutable holderB = address(0xB0B);

    uint256 public totalRedeemed;

    constructor() {
        BoardroomPolicyRegistry policyRegistry = new BoardroomPolicyRegistry(address(this));
        BoardroomFactory boardroomFactory = new BoardroomFactory(address(policyRegistry));

        boardroom = Boardroom(
            payable(boardroomFactory.createBoardroom(
                    address(this), "Invariant Common", "INV", keccak256("wind-down-invariant")
                ))
        );
        shareToken = BoardroomToken(boardroom.shareToken());
        redeemableAsset = new BoardroomWindDownInvariantERC20("Redeemable", "RDM", 6);

        boardroom.mint(holderA, HOLDER_A_SHARES);
        boardroom.mint(holderB, HOLDER_B_SHARES);
        boardroom.mint(address(boardroom), TREASURY_SHARES);
        boardroom.registerRedeemableAsset(address(redeemableAsset));
        redeemableAsset.mint(address(boardroom), INITIAL_REDEEMABLE_ASSET);
    }

    function startWindDown() external {
        if (boardroom.status() != Boardroom.BoardroomStatus.Active) return;
        try boardroom.startWindDown() {} catch {}
    }

    function burnTreasuryShares() external {
        if (boardroom.status() != Boardroom.BoardroomStatus.WindingDown) return;
        try boardroom.burnTreasuryShares() {} catch {}
    }

    function openRedemptions() external {
        if (boardroom.status() != Boardroom.BoardroomStatus.WindingDown) return;
        try boardroom.openRedemptions() {} catch {}
    }

    function redeem(uint256 actorSeed, uint256 sharesSeed) external {
        if (boardroom.status() != Boardroom.BoardroomStatus.RedemptionsOpen) return;

        address actor = actorSeed % 2 == 0 ? holderA : holderB;
        uint256 balance = shareToken.balanceOf(actor);
        if (balance == 0) return;

        uint256 shares = bound(sharesSeed, 1, balance);
        uint256 supplyBefore = shareToken.totalSupply();
        uint256 assetBefore = redeemableAsset.balanceOf(address(boardroom));
        uint256 expectedAmount = assetBefore * shares / supplyBefore;
        uint256[] memory minimums = new uint256[](1);

        vm.prank(actor);
        try boardroom.redeem(shares, actor, minimums) returns (uint256[] memory amounts) {
            assertEq(amounts.length, 1);
            assertEq(amounts[0], expectedAmount);
            totalRedeemed += amounts[0];
        } catch {}
    }
}

contract BoardroomWindDownInvariantTest is StdInvariant, Test {
    BoardroomWindDownInvariantHandler internal handler;

    function setUp() public {
        handler = new BoardroomWindDownInvariantHandler();
        targetContract(address(handler));
    }

    function invariantRedeemableAssetIsConserved() public view {
        uint256 remaining = handler.redeemableAsset().balanceOf(address(handler.boardroom()));
        assertEq(remaining + handler.totalRedeemed(), handler.INITIAL_REDEEMABLE_ASSET());
    }

    function invariantTreasurySharesAreBurnedBeforeRedemptionsOpen() public view {
        if (handler.boardroom().status() == Boardroom.BoardroomStatus.RedemptionsOpen) {
            assertEq(handler.shareToken().balanceOf(address(handler.boardroom())), 0);
        }
    }

    function invariantShareSupplyNeverIncreasesAfterSetup() public view {
        uint256 maxSupply = handler.HOLDER_A_SHARES() + handler.HOLDER_B_SHARES() + handler.TREASURY_SHARES();
        assertLe(handler.shareToken().totalSupply(), maxSupply);
    }

    function invariantNoRedemptionBeforeRedemptionsOpen() public view {
        if (handler.boardroom().status() != Boardroom.BoardroomStatus.RedemptionsOpen) {
            assertEq(handler.totalRedeemed(), 0);
        }
    }
}
