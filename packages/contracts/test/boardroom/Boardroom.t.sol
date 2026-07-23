// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "solady/auth/Ownable.sol";
import {WETH} from "solady/tokens/WETH.sol";
import {AmmFactory} from "../../src/amm/AmmFactory.sol";
import {AmmPool} from "../../src/amm/AmmPool.sol";
import {AmmRouter} from "../../src/amm/AmmRouter.sol";
import {AssetPolicy} from "../../src/policy/AssetPolicy.sol";
import {Boardroom} from "../../src/boardroom/Boardroom.sol";
import {BoardroomController} from "../../src/boardroom/BoardroomController.sol";
import {BoardroomControllerFactory} from "../../src/boardroom/BoardroomControllerFactory.sol";
import {BoardroomFactory} from "../../src/boardroom/BoardroomFactory.sol";
import {BoardroomGovernanceLogic} from "../../src/boardroom/BoardroomGovernanceLogic.sol";
import {BoardroomCall} from "../../src/boardroom/IBoardroomGovernance.sol";
import {BoardroomPolicyRegistry} from "../../src/boardroom/BoardroomPolicyRegistry.sol";
import {BoardroomRedemptionPayout} from "../../src/boardroom/BoardroomRedemptionPayout.sol";
import {BoardroomToken} from "../../src/boardroom/BoardroomToken.sol";
import {BoardroomAssetStorage} from "../../src/boardroom/storage/BoardroomAssetStorage.sol";
import {BoardroomObligationStorage} from "../../src/boardroom/storage/BoardroomObligationStorage.sol";
import {IBoardroomCallPolicy} from "../../src/policy/IBoardroomCallPolicy.sol";
import {IBoardroomObligationPolicy} from "../../src/policy/IBoardroomObligationPolicy.sol";
import {TokenGrant} from "../../src/grants/TokenGrant.sol";
import {TokenGrantFactory} from "../../src/grants/TokenGrantFactory.sol";
import {BoardroomRewards} from "../../src/rewards/BoardroomRewards.sol";
import {BoardroomRewardsFactory} from "../../src/rewards/BoardroomRewardsFactory.sol";

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

contract BoardroomReplayGrant {
    address public immutable factory;
    address public immutable issuer;
    address public immutable token;
    address public paymentToken;
    bool public isClosed;

    constructor(address factory_, address issuer_, address token_) {
        factory = factory_;
        issuer = issuer_;
        token = token_;
    }

    function close() external {
        isClosed = true;
    }
}

contract BoardroomReplayObligationPolicy is IBoardroomObligationPolicy {
    address public obligation;
    uint256 public touches;

    function setObligation(address obligation_) external {
        obligation = obligation_;
    }

    function touch() external {
        ++touches;
    }

    function canCall(address, address, address, uint256, bytes calldata) external pure returns (bool) {
        return true;
    }

    function obligationForCall(address, address, uint256, bytes calldata, bytes calldata)
        external
        view
        returns (Obligation memory)
    {
        return Obligation({kind: ObligationKind.Grant, account: obligation, aux: address(0)});
    }

    function isLifecycleCallAllowed(address, address, bytes4) external pure returns (bool) {
        return false;
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
    BoardroomRewardsFactory internal rewardsFactory;
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
        rewardsFactory = new BoardroomRewardsFactory(address(boardroomFactory));
        paymentToken = new BoardroomCurrency("Payment", "PAY", 6);

        assetPolicy.setAssetAllowed(address(paymentToken), true);
        assetPolicy.setApprovalSpenderAllowed(address(tokenGrantFactory), true);
        assetPolicy.setApprovalSpenderAllowed(address(rewardsFactory), true);

        policyRegistry.setPolicyAllowed(address(assetPolicy), true);
        policyRegistry.registerModulePolicy(address(tokenGrantFactory));
        policyRegistry.registerModulePolicy(address(rewardsFactory));

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

    function testPrelaunchOwnershipTransferChangesLaunchAuthority() public {
        (Boardroom boardroom,) = _createBoardroom("owner-transfer-launch-authority");

        vm.prank(owner);
        boardroom.transferOwnership(stranger);

        assertEq(boardroom.owner(), stranger);
        assertEq(boardroom.controller(), address(0));
        assertFalse(boardroom.launched());

        vm.prank(stranger);
        boardroom.mint(stranger, 1 ether);
    }

    function testPrelaunchOwnershipHandoverChangesOwnerWithoutDeployingController() public {
        (Boardroom boardroom,) = _createBoardroom("owner-handover-launch-authority");

        vm.prank(stranger);
        boardroom.requestOwnershipHandover();

        vm.prank(owner);
        boardroom.completeOwnershipHandover(stranger);

        assertEq(boardroom.owner(), stranger);
        assertEq(boardroom.controller(), address(0));
    }

    function testOnlyBoardroomCanMintShareToken() public {
        (Boardroom boardroom,) = _createBoardroom("token-mint-auth");
        BoardroomToken shareToken = BoardroomToken(boardroom.shareToken());

        vm.expectRevert(BoardroomToken.OnlyBoardroom.selector);
        shareToken.mint(holder, 1 ether);

        vm.expectRevert(BoardroomToken.OnlyBoardroom.selector);
        shareToken.burn(holder, 1 ether);

        vm.expectRevert(BoardroomToken.OnlyBoardroom.selector);
        shareToken.registerEncumberedAccount(address(tokenGrantFactory));
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
        vm.expectRevert(abi.encodeWithSelector(BoardroomPolicyRegistry.PolicyNotAllowed.selector, address(assetPolicy)));
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
        assertTrue(shareToken.isEncumberedAccount(grantAddress));
        assertEq(shareToken.encumberedSupply(), GRANT_SIZE);
        assertEq(shareToken.governanceEligibleSupply(), 0);

        vm.warp(VESTING_END);
        vm.prank(holder);
        grant.settle(10 ether);

        assertEq(shareToken.balanceOf(holder), 10 ether);
        assertEq(shareToken.encumberedSupply(), GRANT_SIZE - 10 ether);
        assertEq(shareToken.governanceEligibleSupply(), 10 ether);
    }

    function testExecutorLossThresholdTracksCurrentAndPastGrantEncumbrance() public {
        (Boardroom boardroom,) = _createBoardroom("grant-encumbrance-threshold");
        BoardroomToken shares = BoardroomToken(boardroom.shareToken());
        address lostExecutor = address(0xDEAD);

        vm.startPrank(owner);
        boardroom.mint(holder, 1 ether);
        boardroom.mint(address(boardroom), 99 ether);
        vm.stopPrank();

        TokenGrant grant = _createBoardroomGrant(
            boardroom,
            _boardroomGrantCreate(
                address(shares), holder, address(0), 99 ether, 0, keccak256("encumbered-holder-grant"), 0
            )
        );

        vm.startPrank(owner);
        _createRewardPool(boardroom);
        vm.stopPrank();
        BoardroomRewards rewards = BoardroomRewards(boardroom.rewardPool());
        vm.prank(holder);
        rewards.stake(1 ether);
        _launchBoardroom(boardroom, lostExecutor, holder, 1 days);
        vm.roll(block.number + 1);

        assertEq(shares.encumberedSupply(), 99 ether);
        assertEq(shares.governanceEligibleSupply(), 1 ether);
        assertEq(shares.getPastEncumberedSupply(block.number - 1), 99 ether);
        assertEq(shares.getPastGovernanceEligibleSupply(block.number - 1), 1 ether);

        vm.warp(VESTING_END);
        vm.prank(holder);
        grant.settle(90 ether);
        vm.prank(holder);
        rewards.stake(90 ether);

        assertEq(shares.encumberedSupply(), 9 ether);
        assertEq(shares.governanceEligibleSupply(), 91 ether);

        vm.prank(holder);
        vm.expectRevert(
            abi.encodeWithSelector(
                BoardroomGovernanceLogic.InsufficientStakerPower.selector, holder, 91 ether, 1 ether, 9.1 ether
            )
        );
        boardroom.startWindDown();

        vm.roll(block.number + 1);
        vm.prank(holder);
        boardroom.startWindDown();

        assertEq(uint8(boardroom.status()), uint8(Boardroom.BoardroomStatus.WindingDown));
    }

    function testProposerLossWindDownExcludesCanonicalGrantInventory() public {
        (Boardroom boardroom,) = _createBoardroom("grant-proposer-loss");
        BoardroomToken shares = BoardroomToken(boardroom.shareToken());

        vm.startPrank(owner);
        boardroom.mint(holder, 1 ether);
        boardroom.mint(address(boardroom), 99 ether);
        vm.stopPrank();

        TokenGrant grant = _createBoardroomGrant(
            boardroom,
            _boardroomGrantCreate(
                address(shares), holder, address(0), 99 ether, 0, keccak256("proposer-loss-share-grant"), 0
            )
        );

        vm.startPrank(owner);
        _createRewardPool(boardroom);
        vm.stopPrank();
        _stake(boardroom, holder, 1 ether);
        _launchBoardroom(boardroom, address(0xDEAD), holder, 1 days);
        vm.roll(block.number + 1);

        assertTrue(shares.isEncumberedAccount(address(grant)));
        assertEq(shares.encumberedSupply(), 99 ether);
        assertEq(shares.governanceEligibleSupply(), 1 ether);

        vm.prank(address(grant));
        vm.expectRevert(abi.encodeWithSelector(BoardroomGovernanceLogic.NotActiveStaker.selector, address(grant)));
        boardroom.startWindDown();

        vm.prank(holder);
        boardroom.startWindDown();

        assertEq(uint8(boardroom.status()), uint8(Boardroom.BoardroomStatus.WindingDown));
    }

    function testCurrentAndPastEligibleSupplyBlockOneBlockCustodyRatioChange() public {
        (Boardroom boardroom,) = _createBoardroom("custody-ratio-transition");
        BoardroomToken shares = BoardroomToken(boardroom.shareToken());

        vm.startPrank(owner);
        boardroom.mint(holder, 5 ether);
        boardroom.mint(stranger, 94 ether);
        boardroom.mint(address(boardroom), 1 ether);
        vm.stopPrank();
        TokenGrant grant = _createBoardroomGrant(
            boardroom,
            _boardroomGrantCreate(address(shares), holder, address(0), 1 ether, 0, keccak256("custody-ratio-grant"), 0)
        );

        vm.prank(owner);
        BoardroomRewards rewards = _createRewardPool(boardroom);
        _stake(boardroom, holder, 5 ether);
        _stake(boardroom, stranger, 94 ether);
        _launchBoardroom(boardroom, owner, stranger, 1 days);
        vm.roll(block.number + 1);

        vm.prank(stranger);
        uint256 slot = rewards.requestUnstake(94 ether);
        vm.warp(block.timestamp + 1 days);
        rewards.completeUnstake(stranger, slot);
        vm.prank(stranger);
        shares.transfer(address(grant), 94 ether);
        assertEq(shares.governanceEligibleSupply(), 5 ether);
        assertEq(shares.getPastGovernanceEligibleSupply(block.number - 1), 99 ether);

        vm.prank(holder);
        vm.expectRevert(
            abi.encodeWithSelector(
                BoardroomGovernanceLogic.InsufficientStakerPower.selector, holder, 5 ether, 5 ether, 9.9 ether
            )
        );
        boardroom.startWindDown();

        vm.roll(block.number + 1);
        vm.prank(holder);
        boardroom.startWindDown();

        assertEq(uint8(boardroom.status()), uint8(Boardroom.BoardroomStatus.WindingDown));
    }

    function testNonShareGrantCannotLowerGovernanceEligibleSupply() public {
        (Boardroom boardroom,) = _createBoardroom("non-share-grant-encumbrance");
        BoardroomToken shares = BoardroomToken(boardroom.shareToken());

        paymentToken.mint(address(boardroom), PAYROLL_AMOUNT);
        vm.prank(owner);
        boardroom.mint(holder, 10 ether);

        TokenGrant grant = _createBoardroomGrant(
            boardroom,
            _boardroomGrantCreate(
                address(paymentToken), holder, address(0), PAYROLL_AMOUNT, 0, keccak256("non-share-grant"), 0
            )
        );

        assertFalse(shares.isEncumberedAccount(address(grant)));
        assertEq(shares.encumberedSupply(), 0);
        assertEq(shares.governanceEligibleSupply(), 10 ether);
    }

    function testHealthyShareGrantQuarantineReturnsEncumberedInventoryToTreasury() public {
        (Boardroom boardroom,) = _createBoardroom("share-grant-quarantine-accounting");
        BoardroomToken shares = BoardroomToken(boardroom.shareToken());

        vm.startPrank(owner);
        boardroom.mint(holder, 1 ether);
        boardroom.mint(address(boardroom), 99 ether);
        vm.stopPrank();
        TokenGrant grant = _createBoardroomGrant(
            boardroom,
            _boardroomGrantCreate(
                address(shares), holder, address(0), 99 ether, 0, keccak256("healthy-share-quarantine"), 0
            )
        );

        assertEq(shares.encumberedSupply(), 99 ether);
        vm.warp(EXPIRY + 1);
        vm.prank(owner);
        boardroom.execute(_tokenGrantFactoryCall(address(grant), 0, abi.encodeCall(TokenGrant.quarantineAndClose, ())));

        assertTrue(grant.isClosed());
        assertFalse(grant.isQuarantined());
        assertEq(shares.balanceOf(address(boardroom)), 99 ether);
        assertEq(shares.encumberedSupply(), 0);
        assertEq(shares.governanceEligibleSupply(), 1 ether);
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
        _openRedemptions(boardroom);

        vm.prank(holder);
        boardroom.redeem(1 ether);
        vm.prank(holder);
        uint256 amount = boardroom.claimRedemptionAsset(address(grantToken), holder, 0);

        assertEq(amount, GRANT_SIZE);
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
        assertFalse(boardroom.isIssuedGrant(address(grant)));
        assertEq(boardroom.obligationPolicyOf(address(grant)), address(tokenGrantFactory));
    }

    function testPermissionlessPruningUpdatesCountsWithoutErasingProvenance() public {
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
        assertTrue(boardroom.isIssuedGrant(address(firstGrant)));

        vm.prank(stranger);
        assertTrue(boardroom.pruneObligation(address(firstGrant)));

        assertFalse(boardroom.isIssuedGrant(address(firstGrant)));
        assertEq(boardroom.obligationPolicyOf(address(firstGrant)), address(tokenGrantFactory));
        assertEq(boardroom.activeObligationCount(), 0);
        (address recordedPolicy,, bool active, bool everRegistered) = boardroom.obligationOf(address(firstGrant));
        assertEq(recordedPolicy, address(tokenGrantFactory));
        assertFalse(active);
        assertTrue(everRegistered);

        vm.prank(stranger);
        assertFalse(boardroom.pruneObligation(address(firstGrant)));
        assertEq(boardroom.activeObligationCount(), 0);

        TokenGrant secondGrant = _createBoardroomGrant(
            boardroom,
            _boardroomGrantCreate(
                address(shareToken), stranger, address(0), GRANT_SIZE, 0, keccak256("capacity-restored"), 0
            )
        );
        assertTrue(boardroom.isIssuedGrant(address(secondGrant)));

        vm.warp(VESTING_END);
        vm.prank(stranger);
        secondGrant.settle(GRANT_SIZE);
        address[] memory pruneBatch = new address[](2);
        pruneBatch[0] = address(secondGrant);
        pruneBatch[1] = address(firstGrant);
        vm.prank(holder);
        assertEq(boardroom.pruneObligations(pruneBatch), 1);
        assertEq(boardroom.activeObligationCount(), 0);
        assertEq(boardroom.activeObligationCountByKind(BoardroomObligationStorage.Kind.Grant), 0);

        address[] memory tooMany = new address[](33);
        vm.expectRevert(abi.encodeWithSelector(BoardroomGovernanceLogic.TooManyCalls.selector, 33, 32));
        boardroom.pruneObligations(tooMany);
    }

    function testSharedAssetDependencyCountsTrackEveryObligationWithoutDoubleDecrement() public {
        (Boardroom boardroom,) = _createBoardroom("shared-obligation-dependencies");
        BoardroomToken shareToken = BoardroomToken(boardroom.shareToken());

        vm.prank(owner);
        boardroom.mint(address(boardroom), 2 * GRANT_SIZE);
        TokenGrant first = _createBoardroomGrant(
            boardroom,
            _boardroomGrantCreate(
                address(shareToken), holder, address(paymentToken), GRANT_SIZE, PRICE, keccak256("shared-dep-one"), 0
            )
        );
        TokenGrant second = _createBoardroomGrant(
            boardroom,
            _boardroomGrantCreate(
                address(shareToken), stranger, address(paymentToken), GRANT_SIZE, PRICE, keccak256("shared-dep-two"), 0
            )
        );

        assertEq(boardroom.assetDependencyCount(address(paymentToken)), 2);
        assertEq(boardroom.activeObligationCount(), 2);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Boardroom.RedeemableAssetDependency.selector, address(paymentToken), 2));
        boardroom.removeRedeemableAsset(address(paymentToken));

        vm.prank(owner);
        boardroom.execute(
            _tokenGrantFactoryCall(address(first), 0, abi.encodeCall(TokenGrant.stopVestingAndWithdrawUnvested, ()))
        );
        assertEq(boardroom.assetDependencyCount(address(paymentToken)), 1);
        assertEq(boardroom.activeObligationCountByKind(BoardroomObligationStorage.Kind.Grant), 1);
        assertFalse(boardroom.pruneObligation(address(first)));
        assertEq(boardroom.assetDependencyCount(address(paymentToken)), 1);

        vm.prank(owner);
        boardroom.execute(
            _tokenGrantFactoryCall(address(second), 0, abi.encodeCall(TokenGrant.stopVestingAndWithdrawUnvested, ()))
        );
        assertEq(boardroom.assetDependencyCount(address(paymentToken)), 0);
        assertEq(boardroom.activeObligationCount(), 0);
        assertEq(boardroom.activeObligationCountByKind(BoardroomObligationStorage.Kind.Grant), 0);
    }

    function testPermanentObligationTombstoneRejectsReregistration() public {
        (Boardroom boardroom,) = _createBoardroom("obligation-tombstone");
        BoardroomReplayObligationPolicy replayPolicy = new BoardroomReplayObligationPolicy();
        BoardroomReplayGrant replayGrant =
            new BoardroomReplayGrant(address(replayPolicy), address(boardroom), address(paymentToken));
        replayPolicy.setObligation(address(replayGrant));
        policyRegistry.registerModulePolicy(address(replayPolicy));

        Boardroom.Call memory call_ = Boardroom.Call({
            policy: address(replayPolicy),
            target: address(replayPolicy),
            value: 0,
            data: abi.encodeCall(BoardroomReplayObligationPolicy.touch, ())
        });
        vm.prank(owner);
        boardroom.execute(call_);
        assertEq(boardroom.activeObligationCount(), 1);

        replayGrant.close();
        assertTrue(boardroom.pruneObligation(address(replayGrant)));
        assertEq(boardroom.activeObligationCount(), 0);

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(BoardroomGovernanceLogic.ObligationAlreadyRegistered.selector, address(replayGrant))
        );
        boardroom.execute(call_);
        assertEq(replayPolicy.touches(), 1);
        assertEq(boardroom.activeObligationCount(), 0);
    }

    function testParentTransitionCallbacksRejectSpoofedCallers() public {
        (Boardroom boardroom,) = _createBoardroom("parent-transition-spoof");

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(BoardroomGovernanceLogic.InvalidParentTransition.selector, stranger));
        boardroom.recordGrantFromDistribution(address(0x1234));

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(BoardroomGovernanceLogic.InvalidParentTransition.selector, stranger));
        boardroom.recordLockedLiquidityFromDistribution(address(0x1234), address(0x5678));

        assertEq(boardroom.activeObligationCount(), 0);
    }

    function testMoreThanLegacyCapCanRemainActiveWithoutReservationSlots() public {
        (Boardroom boardroom,) = _createBoardroom("uncapped-active-grants");
        uint256 grantCount = 129;
        vm.prank(owner);
        boardroom.mint(address(boardroom), grantCount * GRANT_SIZE);

        for (uint256 i; i < grantCount; ++i) {
            TokenGrant grant = _createBoardroomGrant(
                boardroom,
                _boardroomGrantCreate(
                    boardroom.shareToken(),
                    address(uint160(0x1000 + i)),
                    address(0),
                    GRANT_SIZE,
                    0,
                    keccak256(abi.encode("uncapped-grant", i)),
                    0
                )
            );
            assertTrue(boardroom.isIssuedGrant(address(grant)));
        }

        assertEq(boardroom.activeObligationCount(), grantCount);
        assertEq(boardroom.activeObligationCountByKind(BoardroomObligationStorage.Kind.Grant), grantCount);
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

        _openRedemptions(boardroom);

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
        vm.stopPrank();
        _openRedemptions(boardroom);

        _sendNative(address(boardroom), lateNativeAmount);

        vm.prank(holder);
        boardroom.redeem(holderShares);
        vm.prank(holder);
        uint256 amount = boardroom.claimRedemptionAsset(address(wrappedNative), holder, 0);

        assertEq(amount, 0);
        assertEq(wrappedNative.balanceOf(holder), 0);
        assertEq(address(boardroom).balance, lateNativeAmount);
        assertEq(wrappedNative.balanceOf(address(boardroom)), 0);

        vm.prank(stranger);
        assertEq(boardroom.sweepRedemptionExcess(address(wrappedNative)), lateNativeAmount);
        assertEq(address(boardroom).balance, 0);
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
        vm.stopPrank();
        _openRedemptions(boardroom);

        vm.prank(holder);
        boardroom.redeem(holderShares);
        vm.prank(holder);
        uint256 amount = boardroom.claimRedemptionAsset(address(wrappedNative), holder, 1 ether);

        assertEq(amount, 1 ether);
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
        vm.stopPrank();
        _openRedemptions(boardroom);

        BoardroomToken shareToken = BoardroomToken(boardroom.shareToken());
        assertEq(uint8(boardroom.status()), uint8(Boardroom.BoardroomStatus.RedemptionsOpen));
        assertEq(shareToken.balanceOf(address(boardroom)), 0);
        assertEq(shareToken.totalSupply(), holderShares + strangerShares);

        vm.prank(holder);
        boardroom.redeem(holderShares);
        vm.prank(holder);
        uint256 holderAmount = boardroom.claimRedemptionAsset(address(redeemable), holder, 100_000000);

        assertEq(holderAmount, 100_000000);
        assertEq(redeemable.balanceOf(holder), 100_000000);
        assertEq(shareToken.balanceOf(holder), 0);

        vm.prank(stranger);
        boardroom.redeem(strangerShares);
        vm.prank(stranger);
        uint256 strangerAmount = boardroom.claimRedemptionAsset(address(redeemable), stranger, 300_000000);

        assertEq(strangerAmount, 300_000000);
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
        vm.stopPrank();
        _openRedemptions(boardroom);

        BoardroomToken shareToken = BoardroomToken(boardroom.shareToken());
        vm.prank(holder);
        assertTrue(shareToken.transfer(address(boardroom), holderShares));

        vm.prank(stranger);
        boardroom.burnTreasuryShares();
        vm.prank(stranger);
        boardroom.redeem(strangerShares);
        vm.prank(stranger);
        uint256 amount = boardroom.claimRedemptionAsset(address(redeemable), stranger, redeemableAmount);

        assertEq(amount, redeemableAmount);
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
        vm.stopPrank();
        _openRedemptions(boardroom);

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
        vm.stopPrank();
        _openRedemptions(boardroom);

        vm.prank(holder);
        boardroom.redeem(holderShares);

        assertEq(boardroom.redemptionCredits(holder), holderShares);
        assertEq(boardroom.allocatedRedemptionShares(holder, address(redeemable)), 0);
        assertEq(BoardroomToken(boardroom.shareToken()).balanceOf(holder), 0);

        vm.prank(holder);
        vm.expectRevert(
            abi.encodeWithSelector(
                BoardroomRedemptionPayout.UnexpectedRedeemableAssetBalanceChange.selector,
                address(redeemable),
                50_000000,
                50_000001
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
        vm.stopPrank();
        _openRedemptions(boardroom);

        vm.prank(holder);
        boardroom.redeem(holderShares);
        vm.prank(holder);
        vm.expectRevert();
        boardroom.claimRedemptionAsset(address(failing), holder, 0);
        vm.prank(holder);
        assertEq(boardroom.claimRedemptionAsset(address(healthy), holder, 0), 50 ether);
        assertEq(healthy.balanceOf(holder), 50 ether);

        vm.prank(stranger);
        boardroom.redeem(holderShares);
        vm.prank(stranger);
        vm.expectRevert();
        boardroom.claimRedemptionAsset(address(failing), stranger, 0);
        vm.prank(stranger);
        assertEq(boardroom.claimRedemptionAsset(address(healthy), stranger, 0), 50 ether);
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
        vm.stopPrank();
        _openRedemptions(boardroom);

        vm.prank(holder);
        boardroom.redeem(50 ether);

        assertEq(boardroom.allocatedRedemptionShares(holder, address(redeemable)), 0);

        vm.prank(holder);
        vm.expectRevert(
            abi.encodeWithSelector(
                BoardroomRedemptionPayout.InsufficientRedemptionAmount.selector, address(redeemable), 50 ether, 51 ether
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
        vm.stopPrank();
        _openRedemptions(boardroom);

        vm.prank(holder);
        boardroom.redeem(50 ether);
        vm.prank(holder);
        assertEq(boardroom.claimRedemptionAsset(address(redeemable), holder, 0), 50 ether);

        redeemable.mint(address(boardroom), 100 ether);
        vm.prank(stranger);
        boardroom.redeem(50 ether);
        vm.prank(stranger);
        assertEq(boardroom.claimRedemptionAsset(address(redeemable), stranger, 0), 50 ether);

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
        vm.stopPrank();
        _openRedemptions(boardroom);

        vm.prank(holder);
        boardroom.redeem(50 ether);
        vm.prank(holder);
        assertEq(boardroom.claimRedemptionAsset(address(redeemable), holder, 0), 0);

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
        vm.stopPrank();
        _openRedemptions(boardroom);

        vm.prank(holder);
        boardroom.redeem(1);
        assertEq(boardroom.allocatedRedemptionShares(holder, address(redeemable)), 0);

        vm.prank(holder);
        vm.expectRevert(
            abi.encodeWithSelector(
                BoardroomRedemptionPayout.InsufficientRedemptionAmount.selector, address(redeemable), 0, 1
            )
        );
        boardroom.claimRedemptionAsset(address(redeemable), holder, 1);

        vm.prank(holder);
        assertEq(boardroom.claimRedemptionAsset(address(redeemable), holder, 0), 0);
        assertEq(boardroom.allocatedRedemptionShares(holder, address(redeemable)), 1);

        vm.prank(stranger);
        boardroom.redeem(1);
        vm.prank(stranger);
        assertEq(boardroom.claimRedemptionAsset(address(redeemable), stranger, 0), 1);
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
        vm.stopPrank();
        _openRedemptions(boardroom);

        vm.prank(holder);
        boardroom.redeem(holderShares);
        vm.prank(holder);
        uint256 amount = boardroom.claimRedemptionAsset(address(redeemable), holder, 0);

        assertEq(amount, uint256(1) << 199);
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

        assertTrue(boardroom.isIssuedGrant(address(grant)));

        vm.prank(owner);
        boardroom.startWindDown();

        vm.warp(boardroom.windDownStartedAt() + boardroom.windDownDelay());
        vm.expectRevert(BoardroomRedemptionPayout.SnapshotNotReady.selector);
        boardroom.beginSnapshot();

        vm.warp(EXPIRY + 1);
        boardroom.executeWindDownCall(
            _tokenGrantFactoryCall(address(grant), 0, abi.encodeCall(TokenGrant.withdrawExpiredTokens, ()))
        );

        assertTrue(grant.isClosed());

        _openRedemptions(boardroom);

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
        vm.expectRevert(
            abi.encodeWithSelector(BoardroomPolicyRegistry.ModulePolicyRequired.selector, address(tokenGrantFactory))
        );
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
        vm.expectRevert(
            abi.encodeWithSelector(BoardroomPolicyRegistry.ModulePolicyRequired.selector, address(tokenGrantFactory))
        );
        boardroom.execute(_rawCall(address(tokenGrantFactory), 0, _createGrantData(create)));
    }

    function testDisabledModuleIdentityStillRejectsRawFactoryCalls() public {
        policyRegistry.setPolicyAllowed(address(tokenGrantFactory), false);

        (Boardroom boardroom,) = _createBoardroom("raw-disabled-module-target");
        BoardroomGrantCreate memory create = _boardroomGrantCreate(
            address(paymentToken), holder, address(0), PAYROLL_AMOUNT, 0, keccak256("raw-disabled"), 0
        );

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(BoardroomPolicyRegistry.ModulePolicyRequired.selector, address(tokenGrantFactory))
        );
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
                BoardroomPolicyRegistry.ObligationPolicyMismatch.selector,
                address(grant),
                address(tokenGrantFactory),
                address(0)
            )
        );
        boardroom.execute(_rawCall(address(grant), 0, closeData));

        vm.expectRevert(
            abi.encodeWithSelector(
                BoardroomPolicyRegistry.ObligationPolicyMismatch.selector,
                address(grant),
                address(tokenGrantFactory),
                address(assetPolicy)
            )
        );
        boardroom.execute(_assetCall(address(grant), 0, closeData));

        boardroom.execute(_tokenGrantFactoryCall(address(grant), 0, closeData));
        vm.stopPrank();

        assertTrue(grant.isClosed());
        assertFalse(boardroom.isIssuedGrant(address(grant)));
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

    function testSnapshotMarksUnreadableAssetAndDoesNotBlockProgress() public {
        (Boardroom boardroom,) = _createBoardroom("redeemable-removal-quarantine");
        BoardroomCurrency empty = new BoardroomCurrency("Empty", "EMPTY", 18);
        ToggleUnreadableRedeemableCurrency broken = new ToggleUnreadableRedeemableCurrency();

        vm.startPrank(owner);
        boardroom.registerRedeemableAsset(address(empty));
        boardroom.registerRedeemableAsset(address(broken));
        broken.mint(address(boardroom), 5 ether);
        boardroom.removeRedeemableAsset(address(empty));
        boardroom.startWindDown();
        vm.stopPrank();

        assertFalse(boardroom.isRedeemableAsset(address(empty)));

        broken.setReadable(false);
        _openRedemptions(boardroom);
        assertEq(
            uint8(boardroom.redeemableAssetSnapshotStatus(address(broken))),
            uint8(BoardroomAssetStorage.SnapshotStatus.Unreadable)
        );
        broken.setReadable(true);

        vm.prank(stranger);
        assertEq(boardroom.sweepRedemptionExcess(address(broken)), 5 ether);
        assertEq(broken.balanceOf(owner), 5 ether);
    }

    function testAssetRegistryPaginationAndSnapshotWorkStayBounded() public {
        (Boardroom boardroom,) = _createBoardroom("asset-pagination-snapshot");
        uint256 extraAssets = 70;
        address[] memory assets = new address[](extraAssets);

        vm.startPrank(owner);
        for (uint256 i; i < extraAssets; ++i) {
            BoardroomCurrency asset = new BoardroomCurrency("Asset", "AST", 18);
            assets[i] = address(asset);
            boardroom.registerRedeemableAsset(address(asset));
        }
        boardroom.removeRedeemableAsset(assets[10]);
        vm.stopPrank();

        assertEq(boardroom.redeemableAssetCount(), extraAssets + 1);
        {
            (address[] memory first, uint256 cursor) = boardroom.redeemableAssetPage(0, 32);
            assertEq(first.length, 32);
            assertEq(first[0], address(wrappedNative));
            assertEq(cursor, 32);
            (address[] memory second, uint256 nextCursor) = boardroom.redeemableAssetPage(cursor, 32);
            assertEq(second.length, 32);
            assertEq(nextCursor, 64);
            (address[] memory finalPage, uint256 finalCursor) = boardroom.redeemableAssetPage(nextCursor, 32);
            assertEq(finalPage.length, 7);
            assertEq(finalCursor, extraAssets + 1);
            assertEq(first[11], assets[10]);
        }
        assertFalse(boardroom.isRedeemableAsset(assets[10]));

        vm.expectRevert(abi.encodeWithSelector(Boardroom.InvalidSnapshotPage.selector, 33, 32));
        boardroom.redeemableAssetPage(0, 33);

        vm.prank(owner);
        boardroom.startWindDown();
        vm.warp(boardroom.windDownStartedAt() + boardroom.windDownDelay());
        boardroom.beginSnapshot();
        {
            (uint256 frozenCount, uint256 snapshotCursor, bool frozen) = boardroom.assetSnapshotProgress();
            assertEq(frozenCount, extraAssets + 1);
            assertEq(snapshotCursor, 0);
            assertTrue(frozen);
        }
        {
            uint256 gasBefore = gasleft();
            assertEq(boardroom.snapshotAssets(32), 32);
            uint256 firstPageGas = gasBefore - gasleft();
            gasBefore = gasleft();
            assertEq(boardroom.snapshotAssets(32), 32);
            uint256 secondPageGas = gasBefore - gasleft();
            gasBefore = gasleft();
            assertEq(boardroom.snapshotAssets(32), 7);
            uint256 finalPageGas = gasBefore - gasleft();
            emit log_named_uint("snapshot page 1 gas", firstPageGas);
            emit log_named_uint("snapshot page 2 gas", secondPageGas);
            emit log_named_uint("snapshot final page gas", finalPageGas);
            assertLt(firstPageGas, 5_000_000);
            assertLt(secondPageGas, 5_000_000);
            assertLt(finalPageGas, 5_000_000);
        }
        {
            (uint256 frozenCount, uint256 snapshotCursor, bool frozen) = boardroom.assetSnapshotProgress();
            assertEq(snapshotCursor, frozenCount);
            assertTrue(frozen);
        }
        assertEq(
            uint8(boardroom.redeemableAssetSnapshotStatus(assets[10])),
            uint8(BoardroomAssetStorage.SnapshotStatus.Excluded)
        );
        boardroom.openRedemptions();
        assertEq(uint8(boardroom.status()), uint8(Boardroom.BoardroomStatus.RedemptionsOpen));
    }

    function testAssetRegistryPaginationIsAppendOnlyAcrossConcurrentRegistration() public {
        (Boardroom boardroom,) = _createBoardroom("asset-pagination-concurrent-registration");
        BoardroomCurrency first = new BoardroomCurrency("First", "FIRST", 18);
        BoardroomCurrency second = new BoardroomCurrency("Second", "SECOND", 18);
        BoardroomCurrency appended = new BoardroomCurrency("Appended", "APPENDED", 18);

        vm.startPrank(owner);
        boardroom.registerRedeemableAsset(address(first));
        boardroom.registerRedeemableAsset(address(second));
        vm.stopPrank();

        (address[] memory head, uint256 cursor) = boardroom.redeemableAssetPage(0, 2);
        assertEq(head.length, 2);
        assertEq(head[0], address(wrappedNative));
        assertEq(head[1], address(first));
        assertEq(cursor, 2);

        vm.prank(owner);
        boardroom.registerRedeemableAsset(address(appended));

        (address[] memory tail, uint256 nextCursor) = boardroom.redeemableAssetPage(cursor, 2);
        assertEq(tail.length, 2);
        assertEq(tail[0], address(second));
        assertEq(tail[1], address(appended));
        assertEq(nextCursor, 4);
        assertEq(boardroom.redeemableAssetCount(), 4);
    }

    function testWindDownAssetRegistrationRequiresCurrentBoardroomValue() public {
        (Boardroom boardroom,) = _createBoardroom("wind-down-funded-asset-registration");
        BoardroomCurrency empty = new BoardroomCurrency("Empty", "EMPTY", 18);
        BoardroomCurrency funded = new BoardroomCurrency("Funded", "FUNDED", 18);
        funded.mint(address(boardroom), 1 ether);

        vm.prank(owner);
        boardroom.startWindDown();

        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(Boardroom.EmptyRedeemableAsset.selector, address(empty)));
        boardroom.registerRedeemableAsset(address(empty));
        boardroom.registerRedeemableAsset(address(funded));
        vm.stopPrank();

        assertFalse(boardroom.isRedeemableAsset(address(empty)));
        assertTrue(boardroom.isRedeemableAsset(address(funded)));
    }

    function testOpenGrantPreventsRemovingAssetThatCanReturnDuringWindDown() public {
        (Boardroom boardroom,) = _createBoardroom("grant-return-asset-pin");
        BoardroomToken shares = BoardroomToken(boardroom.shareToken());

        vm.prank(owner);
        boardroom.mint(address(boardroom), GRANT_SIZE);
        TokenGrant grant = _createBoardroomGrant(
            boardroom,
            _boardroomGrantCreate(
                address(shares), holder, address(paymentToken), GRANT_SIZE, PRICE, keccak256("grant-return-pin"), 0
            )
        );

        assertTrue(boardroom.isRedeemableAsset(address(paymentToken)));
        assertEq(paymentToken.balanceOf(address(boardroom)), 0);

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Boardroom.RedeemableAssetDependency.selector, address(paymentToken), 1));
        boardroom.removeRedeemableAsset(address(paymentToken));

        vm.prank(owner);
        boardroom.startWindDown();

        vm.warp(VESTING_END);
        uint256 cost = grant.getSettlementCost(GRANT_SIZE);
        vm.startPrank(holder);
        paymentToken.approve(address(grant), cost);
        grant.settle(GRANT_SIZE);
        vm.stopPrank();

        assertTrue(grant.isClosed());
        assertTrue(boardroom.isRedeemableAsset(address(paymentToken)));
        assertEq(paymentToken.balanceOf(address(boardroom)), cost);

        vm.prank(stranger);
        boardroom.pruneObligation(address(grant));
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                Boardroom.InvalidStatus.selector,
                Boardroom.BoardroomStatus.Active,
                Boardroom.BoardroomStatus.WindingDown
            )
        );
        boardroom.removeRedeemableAsset(address(paymentToken));
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

    function _createRewardPool(Boardroom boardroom) internal returns (BoardroomRewards rewards) {
        bytes memory result = boardroom.execute(
            Boardroom.Call({
                policy: address(rewardsFactory),
                target: address(rewardsFactory),
                value: 0,
                data: abi.encodeCall(rewardsFactory.createRewards, (uint64(1 days), keccak256("test-rewards")))
            })
        );
        rewards = BoardroomRewards(abi.decode(result, (address)));
    }

    function _stake(Boardroom boardroom, address account, uint256 amount) internal {
        BoardroomRewards rewards = BoardroomRewards(boardroom.rewardPool());
        vm.prank(account);
        rewards.stake(amount);
    }

    function _launchBoardroom(Boardroom boardroom, address proposer, address protection, uint64 delay)
        internal
        returns (BoardroomController controller_)
    {
        vm.roll(block.number + 1);
        BoardroomControllerFactory controllerFactory = BoardroomControllerFactory(boardroomFactory.controllerFactory());
        address predicted = controllerFactory.predictControllerAddress(address(boardroom), 1);
        Boardroom.LaunchConfig memory config = Boardroom.LaunchConfig({
            proposer: proposer,
            predictedController: predicted,
            protectionStaker: protection,
            expectedRewardPool: boardroom.rewardPool(),
            expectedRedemptionExcessRecipient: boardroom.redemptionExcessRecipient(),
            controllerDelay: delay,
            windDownDelay: 1 days,
            gracePeriod: 1 days,
            generation: 1
        });
        vm.prank(boardroom.owner());
        boardroom.launch(config);
        controller_ = BoardroomController(predicted);
    }

    function _sendNative(address to, uint256 amount) internal {
        vm.deal(address(this), amount);
        (bool success,) = to.call{value: amount}("");
        assertTrue(success);
    }

    function _openRedemptions(Boardroom boardroom) internal {
        uint256 readyAt = boardroom.windDownStartedAt() + boardroom.windDownDelay();
        if (block.timestamp < readyAt) vm.warp(readyAt);
        boardroom.beginSnapshot();
        uint256 count = boardroom.redeemableAssetCount();
        for (uint256 cursor; cursor < count; cursor += boardroom.MAX_SNAPSHOT_PAGE()) {
            uint256 remaining = count - cursor;
            boardroom.snapshotAssets(
                remaining > boardroom.MAX_SNAPSHOT_PAGE() ? boardroom.MAX_SNAPSHOT_PAGE() : remaining
            );
        }
        boardroom.openRedemptions();
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
