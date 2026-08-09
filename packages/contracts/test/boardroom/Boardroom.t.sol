// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "solady/auth/Ownable.sol";
import {ERC20} from "solady/tokens/ERC20.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {Boardroom} from "../../src/boardroom/Boardroom.sol";
import {BoardroomFactory} from "../../src/boardroom/BoardroomFactory.sol";
import {BoardroomToken} from "../../src/boardroom/BoardroomToken.sol";
import {IBoardroom} from "../../src/boardroom/IBoardroom.sol";

contract BoardroomTestERC20 is ERC20 {
    string internal tokenName;
    string internal tokenSymbol;

    constructor(string memory name_, string memory symbol_) {
        tokenName = name_;
        tokenSymbol = symbol_;
    }

    function name() public view override returns (string memory) {
        return tokenName;
    }

    function symbol() public view override returns (string memory) {
        return tokenSymbol;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract BoardroomTestWrappedNative is BoardroomTestERC20 {
    constructor() BoardroomTestERC20("Wrapped Ether", "WETH") {}

    receive() external payable {
        deposit();
    }

    function deposit() public payable {
        _mint(msg.sender, msg.value);
    }
}

contract BoardroomFeeOnTransferToken {
    string public constant name = "Fee Token";
    string public constant symbol = "FEE";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address account => uint256 balance) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) internal {
        uint256 fee = amount / 100;
        balanceOf[from] -= amount;
        balanceOf[to] += amount - fee;
        totalSupply -= fee;
    }
}

contract BoardroomMutableToken is BoardroomTestERC20 {
    bool public balanceReadsFail;

    constructor() BoardroomTestERC20("Mutable", "MUT") {}

    function setBalanceReadsFail(bool fail) external {
        balanceReadsFail = fail;
    }

    function balanceOf(address account) public view override returns (uint256) {
        if (balanceReadsFail) revert("BALANCE_READ_FAILED");
        return super.balanceOf(account);
    }
}

contract BoardroomEscrow {
    address public immutable boardroom;
    bool public isClosed;

    constructor(address boardroom_) {
        boardroom = boardroom_;
    }

    function close(address asset) external {
        require(msg.sender == boardroom, "ONLY_BOARDROOM");
        uint256 balance = ERC20(asset).balanceOf(address(this));
        if (balance != 0) ERC20(asset).transfer(boardroom, balance);
        isClosed = true;
    }

    function markClosed() external {
        isClosed = true;
    }
}

contract BoardroomCallbackModule {
    function reserve(address boardroom, address asset) external {
        IBoardroom(boardroom).reserveRedeemableAsset(asset);
    }

    function register(address boardroom, address escrow) external {
        IBoardroom(boardroom).registerEscrow(escrow);
    }

    function reserveAndRegister(address boardroom, address escrow, address[] calldata assets) external {
        uint256 length = assets.length;
        for (uint256 i; i < length; ++i) {
            IBoardroom(boardroom).reserveRedeemableAsset(assets[i]);
        }
        IBoardroom(boardroom).registerEscrow(escrow);
    }
}

contract BoardroomCallTarget {
    address public caller;
    uint256 public value;
    uint256 public stored;

    function set(uint256 next) external payable returns (uint256) {
        caller = msg.sender;
        value = msg.value;
        stored = next;
        return next + 1;
    }

    function fail() external pure {
        revert("TARGET_FAILURE");
    }
}

contract BoardroomReentrantOwner {
    Boardroom public boardroom;

    function setBoardroom(Boardroom boardroom_) external {
        require(address(boardroom) == address(0), "ALREADY_SET");
        boardroom = boardroom_;
    }

    function attack() external {
        boardroom.execute(IBoardroom.Call(address(this), 0, abi.encodeCall(this.reenter, ())));
    }

    function reenter() external {
        require(msg.sender == address(boardroom), "ONLY_BOARDROOM");
        boardroom.execute(IBoardroom.Call(address(this), 0, ""));
    }
}

contract BoardroomTest is Test {
    event BoardroomCreated(
        address indexed boardroom,
        address indexed owner,
        address indexed shareToken,
        address wrappedNative,
        string name,
        string symbol,
        bytes32 salt
    );

    BoardroomTestWrappedNative internal wrappedNative;
    BoardroomFactory internal factory;
    Boardroom internal boardroom;
    BoardroomToken internal shares;
    BoardroomTestERC20 internal asset;
    BoardroomCallbackModule internal callbacks;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    bytes32 internal constant SALT = keccak256("boardroom-test");

    function setUp() public {
        wrappedNative = new BoardroomTestWrappedNative();
        factory = new BoardroomFactory(address(wrappedNative));
        address predicted = factory.predictBoardroomAddress(address(this), "Pledge", "PLDG", SALT);
        boardroom = Boardroom(payable(factory.createBoardroom(address(this), "Pledge", "PLDG", SALT)));
        assertEq(address(boardroom), predicted);
        shares = BoardroomToken(boardroom.shareToken());
        asset = new BoardroomTestERC20("Asset", "AST");
        callbacks = new BoardroomCallbackModule();
    }

    function testFactoryCreatesDeterministicCanonicalBoardroom() public view {
        assertTrue(factory.isBoardroom(address(boardroom)));
        assertTrue(factory.isShareToken(address(shares)));
        assertEq(factory.boardroomImplementation() == address(boardroom), false);
        assertEq(boardroom.factory(), address(factory));
        assertEq(boardroom.owner(), address(this));
        assertEq(boardroom.wrappedNative(), address(wrappedNative));
        assertEq(boardroom.redeemableAssetCount(), 1);
        assertEq(boardroom.redeemableAssetAt(0), address(wrappedNative));
        assertEq(shares.boardroom(), address(boardroom));
        assertEq(shares.name(), "Pledge");
        assertEq(shares.symbol(), "PLDG");
    }

    function testFactoryEmitsBoardroomDiscoveryEvent() public {
        bytes32 salt = keccak256("second-boardroom");
        address predicted = factory.predictBoardroomAddress(alice, "Second", "SCND", salt);

        vm.expectEmit(true, true, false, false, address(factory));
        emit BoardroomCreated(predicted, alice, address(0), address(0), "", "", bytes32(0));

        address created = factory.createBoardroom(alice, "Second", "SCND", salt);
        assertEq(created, predicted);
        assertTrue(factory.isBoardroom(created));
        assertTrue(factory.isShareToken(Boardroom(payable(created)).shareToken()));
    }

    function testImplementationCannotBeInitialized() public {
        Boardroom implementation = Boardroom(payable(factory.boardroomImplementation()));
        vm.expectRevert(Ownable.AlreadyInitialized.selector);
        vm.prank(address(factory));
        implementation.initialize(address(this), "Other", "OTH");
    }

    function testMintAndOwnershipAreOwnerBound() public {
        vm.prank(alice);
        vm.expectRevert(Ownable.Unauthorized.selector);
        boardroom.mint(alice, 4 ether);

        boardroom.mint(alice, 4 ether);
        assertEq(shares.balanceOf(alice), 4 ether);
        vm.expectRevert(Boardroom.OwnershipRenunciationDisabled.selector);
        boardroom.renounceOwnership();

        boardroom.transferOwnership(bob);
        assertEq(boardroom.owner(), bob);
        assertEq(boardroom.redemptionExcessRecipient(), bob);
        vm.prank(bob);
        boardroom.mint(alice, 1 ether);
        assertEq(shares.balanceOf(alice), 5 ether);
    }

    function testExecuteAndBatchPreserveBoardroomAsCallerAndBubbleFailure() public {
        BoardroomCallTarget target = new BoardroomCallTarget();
        vm.deal(address(boardroom), 3 ether);
        IBoardroom.Call memory call_ =
            IBoardroom.Call({target: address(target), value: 1 ether, data: abi.encodeCall(target.set, (41))});
        bytes memory output = boardroom.execute(call_);
        assertEq(abi.decode(output, (uint256)), 42);
        assertEq(target.caller(), address(boardroom));
        assertEq(target.value(), 1 ether);

        IBoardroom.Call[] memory calls = new IBoardroom.Call[](2);
        calls[0] = IBoardroom.Call(address(target), 0, abi.encodeCall(target.set, (7)));
        calls[1] = IBoardroom.Call(address(target), 0, abi.encodeCall(target.set, (9)));
        bytes[] memory outputs = boardroom.executeBatch(calls);
        assertEq(abi.decode(outputs[0], (uint256)), 8);
        assertEq(abi.decode(outputs[1], (uint256)), 10);
        assertEq(target.stored(), 9);

        vm.expectRevert("TARGET_FAILURE");
        boardroom.execute(IBoardroom.Call(address(target), 0, abi.encodeCall(target.fail, ())));
        vm.expectRevert(abi.encodeWithSelector(Boardroom.InvalidExecutionTarget.selector, address(boardroom)));
        boardroom.execute(IBoardroom.Call(address(boardroom), 0, ""));
        vm.expectRevert(abi.encodeWithSelector(Boardroom.InvalidExecutionTarget.selector, address(shares)));
        boardroom.execute(IBoardroom.Call(address(shares), 0, ""));
    }

    function testCallbacksOnlyWorkInsideTheAuthorizedTargetFrame() public {
        vm.expectRevert(abi.encodeWithSelector(Boardroom.InvalidExecutionContext.selector, address(this)));
        boardroom.reserveRedeemableAsset(address(asset));

        boardroom.execute(
            IBoardroom.Call(
                address(callbacks), 0, abi.encodeCall(callbacks.reserve, (address(boardroom), address(asset)))
            )
        );
        assertTrue(boardroom.isRedeemableAsset(address(asset)));

        vm.expectRevert(abi.encodeWithSelector(Boardroom.RedeemableAssetAlreadyRegistered.selector, address(asset)));
        boardroom.registerRedeemableAsset(address(asset));
    }

    function testExecutionIsNonReentrantEvenWhenTheTargetIsTheOwner() public {
        BoardroomReentrantOwner reentrantOwner = new BoardroomReentrantOwner();
        Boardroom owned = Boardroom(
            payable(factory.createBoardroom(address(reentrantOwner), "Reentrant", "RENT", bytes32(uint256(2))))
        );
        reentrantOwner.setBoardroom(owned);
        vm.expectRevert(ReentrancyGuard.Reentrancy.selector);
        reentrantOwner.attack();
    }

    function testBatchInputsAreBounded() public {
        IBoardroom.Call[] memory emptyCalls = new IBoardroom.Call[](0);
        vm.expectRevert(Boardroom.EmptyBatch.selector);
        boardroom.executeBatch(emptyCalls);

        IBoardroom.Call[] memory tooManyCalls = new IBoardroom.Call[](boardroom.MAX_BATCH_CALLS() + 1);
        vm.expectRevert(
            abi.encodeWithSelector(Boardroom.TooManyCalls.selector, tooManyCalls.length, boardroom.MAX_BATCH_CALLS())
        );
        boardroom.executeBatch(tooManyCalls);
    }

    function testEscrowBlocksSnapshotUntilOwnerClosesIt() public {
        BoardroomEscrow escrow = new BoardroomEscrow(address(boardroom));
        address[] memory assets = new address[](1);
        assets[0] = address(asset);
        asset.mint(address(escrow), 30 ether);

        boardroom.execute(
            IBoardroom.Call(
                address(callbacks),
                0,
                abi.encodeCall(callbacks.reserveAndRegister, (address(boardroom), address(escrow), assets))
            )
        );
        assertEq(boardroom.openEscrowCount(), 1);
        assertEq(uint256(boardroom.escrowState(address(escrow))), uint256(IBoardroom.EscrowState.Open));
        assertTrue(boardroom.isRedeemableAsset(address(asset)));

        boardroom.mint(alice, 1 ether);
        boardroom.startWindDown();
        vm.warp(block.timestamp + boardroom.MIN_WIND_DOWN_DELAY());
        vm.expectRevert(Boardroom.SnapshotNotReady.selector);
        boardroom.beginSnapshot();

        boardroom.executeEscrow(address(escrow), abi.encodeCall(escrow.close, (address(asset))));
        assertEq(asset.balanceOf(address(boardroom)), 30 ether);
        assertEq(boardroom.openEscrowCount(), 0);
        assertEq(uint256(boardroom.escrowState(address(escrow))), uint256(IBoardroom.EscrowState.Closed));

        boardroom.beginSnapshot();
        assertEq(uint256(boardroom.status()), uint256(IBoardroom.Status.Snapshotting));
    }

    function testClosedEscrowCanBePermissionlesslyPruned() public {
        BoardroomEscrow escrow = new BoardroomEscrow(address(boardroom));
        boardroom.execute(
            IBoardroom.Call(
                address(callbacks), 0, abi.encodeCall(callbacks.register, (address(boardroom), address(escrow)))
            )
        );
        escrow.markClosed();
        vm.prank(alice);
        assertTrue(boardroom.pruneEscrow(address(escrow)));
        assertEq(boardroom.openEscrowCount(), 0);
        assertEq(uint256(boardroom.escrowState(address(escrow))), uint256(IBoardroom.EscrowState.Closed));
    }

    function testAlreadyClosedEscrowCannotBeRegistered() public {
        BoardroomEscrow escrow = new BoardroomEscrow(address(boardroom));
        escrow.markClosed();
        vm.expectRevert(abi.encodeWithSelector(Boardroom.EscrowAlreadyClosed.selector, address(escrow)));
        boardroom.execute(
            IBoardroom.Call(
                address(callbacks), 0, abi.encodeCall(callbacks.register, (address(boardroom), address(escrow)))
            )
        );
    }

    function testClosedEscrowCannotBeReopened() public {
        BoardroomEscrow escrow = new BoardroomEscrow(address(boardroom));
        boardroom.execute(
            IBoardroom.Call(
                address(callbacks), 0, abi.encodeCall(callbacks.register, (address(boardroom), address(escrow)))
            )
        );
        escrow.markClosed();
        boardroom.pruneEscrow(address(escrow));

        vm.expectRevert(abi.encodeWithSelector(Boardroom.EscrowAlreadyRegistered.selector, address(escrow)));
        boardroom.execute(
            IBoardroom.Call(
                address(callbacks), 0, abi.encodeCall(callbacks.register, (address(boardroom), address(escrow)))
            )
        );
    }

    function testSnapshotUsesActualBalanceReceivedByDirectTransfer() public {
        BoardroomFeeOnTransferToken feeToken = new BoardroomFeeOnTransferToken();
        boardroom.execute(
            IBoardroom.Call(
                address(callbacks), 0, abi.encodeCall(callbacks.reserve, (address(boardroom), address(feeToken)))
            )
        );
        feeToken.mint(address(this), 100 ether);
        assertTrue(feeToken.transfer(address(boardroom), 100 ether));
        assertEq(feeToken.balanceOf(address(boardroom)), 99 ether);

        boardroom.mint(alice, 1 ether);
        boardroom.startWindDown();
        vm.warp(block.timestamp + boardroom.MIN_WIND_DOWN_DELAY());
        boardroom.beginSnapshot();
        boardroom.snapshotAssets(32);

        (uint256 frozenBalance,) = boardroom.redemptionAssetState(address(feeToken));
        assertEq(frozenBalance, 99 ether);

        boardroom.openRedemptions();
        vm.startPrank(alice);
        boardroom.redeem(1 ether);
        vm.expectRevert(
            abi.encodeWithSelector(
                Boardroom.UnexpectedRedeemableAssetBalanceChange.selector, address(feeToken), 99 ether, 98.01 ether
            )
        );
        boardroom.claimRedemptionAsset(address(feeToken), alice, 0);
        vm.stopPrank();

        assertEq(feeToken.balanceOf(address(boardroom)), 99 ether);
        (, uint256 paidAmount) = boardroom.redemptionAssetState(address(feeToken));
        assertEq(paidAmount, 0);
    }

    function testOwnerRegistersDirectlyTransferredAssetDuringWindDown() public {
        boardroom.mint(alice, 1 ether);
        boardroom.startWindDown();

        vm.expectRevert(abi.encodeWithSelector(Boardroom.EmptyRedeemableAsset.selector, address(asset)));
        boardroom.registerRedeemableAsset(address(asset));

        asset.mint(address(this), 10 ether);
        assertTrue(asset.transfer(address(boardroom), 10 ether));
        boardroom.registerRedeemableAsset(address(asset));

        assertTrue(boardroom.isRedeemableAsset(address(asset)));
        assertEq(asset.balanceOf(address(boardroom)), 10 ether);
    }

    function testWindDownSnapshotAndRedemptionAreExact() public {
        boardroom.execute(
            IBoardroom.Call(
                address(callbacks), 0, abi.encodeCall(callbacks.reserve, (address(boardroom), address(asset)))
            )
        );
        asset.mint(address(this), 100 ether);
        assertTrue(asset.transfer(address(boardroom), 100 ether));

        boardroom.mint(alice, 2 ether);
        boardroom.mint(bob, 1 ether);
        boardroom.mint(address(boardroom), 1 ether);
        boardroom.startWindDown();
        vm.warp(block.timestamp + boardroom.MIN_WIND_DOWN_DELAY());
        boardroom.beginSnapshot();

        assertEq(shares.balanceOf(address(boardroom)), 0);
        (uint256 frozenAssets, uint256 cursor, bool assetsFrozen) = boardroom.assetSnapshotProgress();
        assertEq(frozenAssets, boardroom.redeemableAssetCount());
        assertEq(cursor, 0);
        assertTrue(assetsFrozen);
        (uint256 frozenSupply, bool frozen) = boardroom.redemptionSupplyState();
        assertEq(frozenSupply, 3 ether);
        assertTrue(frozen);
        assertEq(boardroom.snapshotAssets(32), 2);
        boardroom.openRedemptions();

        vm.startPrank(alice);
        boardroom.redeem(2 ether);
        assertEq(boardroom.claimRedemptionAsset(address(asset), alice, 66 ether), 66_666666666666666666);
        vm.stopPrank();
        vm.startPrank(bob);
        boardroom.redeem(1 ether);
        assertEq(boardroom.claimRedemptionAsset(address(asset), bob, 33 ether), 33_333333333333333334);
        vm.stopPrank();

        assertEq(asset.balanceOf(alice), 66_666666666666666666);
        assertEq(asset.balanceOf(bob), 33_333333333333333334);
        assertEq(asset.balanceOf(address(boardroom)), 0);
        assertEq(shares.totalSupply(), 0);
    }

    function testUnreadableAssetIsClassifiedWithoutBlockingRedemptions() public {
        BoardroomMutableToken mutableAsset = new BoardroomMutableToken();
        boardroom.execute(
            IBoardroom.Call(
                address(callbacks), 0, abi.encodeCall(callbacks.reserve, (address(boardroom), address(mutableAsset)))
            )
        );
        mutableAsset.mint(address(boardroom), 10 ether);
        boardroom.mint(alice, 1 ether);
        boardroom.startWindDown();
        vm.warp(block.timestamp + boardroom.MIN_WIND_DOWN_DELAY());
        boardroom.beginSnapshot();
        mutableAsset.setBalanceReadsFail(true);
        boardroom.snapshotAssets(32);
        assertEq(
            uint256(boardroom.redeemableAssetSnapshotStatus(address(mutableAsset))),
            uint256(IBoardroom.SnapshotStatus.Unreadable)
        );
        boardroom.openRedemptions();
    }

    function testNativeBalanceWrapsAndLateForcedValueRemainsRecoverableAsExcess() public {
        boardroom.mint(alice, 1 ether);
        vm.deal(address(boardroom), 2 ether);
        boardroom.startWindDown();
        assertEq(wrappedNative.balanceOf(address(boardroom)), 2 ether);
        vm.warp(block.timestamp + boardroom.MIN_WIND_DOWN_DELAY());
        boardroom.beginSnapshot();
        boardroom.snapshotAssets(32);
        boardroom.openRedemptions();

        vm.deal(address(boardroom), 1 ether);
        vm.prank(alice);
        boardroom.wrapNativeBalance();
        assertEq(wrappedNative.balanceOf(address(boardroom)), 3 ether);
        assertEq(boardroom.sweepRedemptionExcess(address(wrappedNative)), 1 ether);
        assertEq(wrappedNative.balanceOf(address(this)), 1 ether);
    }

    function testLifecycleCannotMoveBackward() public {
        boardroom.mint(alice, 1 ether);
        boardroom.startWindDown();
        assertEq(uint256(boardroom.status()), uint256(IBoardroom.Status.WindingDown));
        vm.expectRevert(
            abi.encodeWithSelector(
                Boardroom.InvalidStatus.selector, IBoardroom.Status.Active, IBoardroom.Status.WindingDown
            )
        );
        boardroom.mint(alice, 1 ether);
        vm.expectRevert(
            abi.encodeWithSelector(
                Boardroom.InvalidStatus.selector, IBoardroom.Status.Active, IBoardroom.Status.WindingDown
            )
        );
        boardroom.execute(IBoardroom.Call(address(callbacks), 0, ""));

        vm.warp(block.timestamp + boardroom.MIN_WIND_DOWN_DELAY());
        boardroom.beginSnapshot();
        boardroom.snapshotAssets(32);
        boardroom.openRedemptions();
        assertEq(uint256(boardroom.status()), uint256(IBoardroom.Status.RedemptionsOpen));
        vm.expectRevert(
            abi.encodeWithSelector(
                Boardroom.InvalidStatus.selector, IBoardroom.Status.WindingDown, IBoardroom.Status.RedemptionsOpen
            )
        );
        boardroom.beginSnapshot();
    }
}
