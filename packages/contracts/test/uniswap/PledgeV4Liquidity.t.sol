// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "solady/tokens/ERC20.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PledgeV4Hook} from "../../src/uniswap/PledgeV4Hook.sol";
import {PledgeV4LiquidityFactory} from "../../src/uniswap/PledgeV4LiquidityFactory.sol";
import {PledgeV4LiquidityVault} from "../../src/uniswap/PledgeV4LiquidityVault.sol";
import {BondMarket} from "../../src/bonds/BondMarket.sol";
import {BondMarketFactory} from "../../src/bonds/BondMarketFactory.sol";
import {V4PoolManagerMock} from "../helpers/V4PoolManagerMock.sol";

contract V4TestToken is ERC20 {
    string internal tokenName;
    string internal tokenSymbol;
    address public immutable boardroom;
    bool public transfersRevert;
    bool public shortTransfers;
    bool public windDownOnTransfer;
    address public windDownTransferRecipient;

    error TransfersDisabled();

    constructor(string memory name_, string memory symbol_, address boardroom_) {
        tokenName = name_;
        tokenSymbol = symbol_;
        boardroom = boardroom_;
    }

    function name() public view override returns (string memory) {
        return tokenName;
    }

    function symbol() public view override returns (string memory) {
        return tokenSymbol;
    }

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }

    function setTransfersRevert(bool transfersRevert_) external {
        transfersRevert = transfersRevert_;
    }

    function setShortTransfers(bool shortTransfers_) external {
        shortTransfers = shortTransfers_;
    }

    function armWindDownOnTransfer(address recipient) external {
        windDownOnTransfer = true;
        windDownTransferRecipient = recipient;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        return super.transfer(to, shortTransfers && amount != 0 ? amount - 1 : amount);
    }

    function _beforeTokenTransfer(address from, address to, uint256) internal view override {
        if (transfersRevert && from != address(0) && to != address(0)) revert TransfersDisabled();
    }

    function _afterTokenTransfer(address from, address to, uint256) internal override {
        if (windDownOnTransfer && from != address(0) && to == windDownTransferRecipient) {
            windDownOnTransfer = false;
            V4BoardroomMock(boardroom).setWindingDown();
        }
    }
}

contract V4BoardroomFactoryMock {
    mapping(address boardroom => bool canonical) public isBoardroom;
    mapping(address token => bool share) public isShareToken;

    function register(address boardroom, address shareToken) external {
        isBoardroom[boardroom] = true;
        isShareToken[shareToken] = true;
    }
}

contract V4PolicyRegistryMock {
    mapping(address policy => bool allowed) public isModulePolicy;

    function setPolicy(address policy, bool allowed) external {
        isModulePolicy[policy] = allowed;
    }
}

contract V4FeeRecipientMock {}

contract V4BoardroomMock {
    bytes32 public constant facetSetHash = keccak256("v4-test-release");

    address public immutable shareToken;
    address public immutable policyRegistry;
    address public immutable liquidityFactory;
    bool public windingDown;
    address public expectedVault;
    bytes32 public expectedPoolId;
    address public activeVault;
    bytes32 public activePoolId;

    constructor(address shareToken_, address policyRegistry_, address liquidityFactory_) {
        shareToken = shareToken_;
        policyRegistry = policyRegistry_;
        liquidityFactory = liquidityFactory_;
    }

    function status() external view returns (uint8) {
        return windingDown ? 1 : 0;
    }

    function isIssuedDistribution(address) external pure returns (bool) {
        return false;
    }

    function lockedLiquidityExitAllowed() external view returns (bool) {
        return windingDown;
    }

    function liquidityMutationAllowed() external pure returns (bool) {
        return true;
    }

    function create(PledgeV4LiquidityFactory.CreateParams calldata params)
        external
        returns (address vault, bytes32 poolId, uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        ERC20(params.tokenA).approve(liquidityFactory, params.amountADesired);
        ERC20(params.tokenB).approve(liquidityFactory, params.amountBDesired);
        return PledgeV4LiquidityFactory(liquidityFactory).createProtocolLiquidity(params);
    }

    function precommitProtocolLiquidity(
        bytes32,
        address expectedVault_,
        bytes32 expectedPoolId_,
        address,
        address,
        bytes32,
        uint64
    ) external {
        require(msg.sender == liquidityFactory, "factory");
        expectedVault = expectedVault_;
        expectedPoolId = expectedPoolId_;
    }

    function activateProtocolLiquidity(bytes32, address vault, bytes32 poolId, address, address, bytes32) external {
        require(msg.sender == liquidityFactory, "factory");
        require(vault == expectedVault && poolId == expectedPoolId, "precommit");
        activeVault = vault;
        activePoolId = poolId;
    }

    function closeProtocolLiquidityFromFactory(bytes32, address) external {}

    function setWindingDown() external {
        windingDown = true;
    }

    function claimFees(address vault) external {
        PledgeV4LiquidityVault(vault).claimFees();
    }

    function releaseClaims(address vault) external returns (uint256) {
        return PledgeV4LiquidityVault(vault).releaseClaimsToBoardroom();
    }

    function transferClaims(address vault, address recipient, uint256 amount) external {
        PledgeV4LiquidityVault(vault).transfer(recipient, amount);
    }
}

contract PledgeV4LiquidityTest is Test {
    uint160 internal constant Q96 = 1 << 96;
    uint256 internal constant SEED = 100 ether;

    V4PoolManagerMock internal manager;
    V4BoardroomFactoryMock internal boardroomFactory;
    V4PolicyRegistryMock internal policyRegistry;
    V4FeeRecipientMock internal feeRecipient;
    PledgeV4LiquidityFactory internal factory;
    V4BoardroomMock internal boardroom;
    V4TestToken internal share;
    V4TestToken internal quote;

    function setUp() public {
        manager = new V4PoolManagerMock();
        boardroomFactory = new V4BoardroomFactoryMock();
        policyRegistry = new V4PolicyRegistryMock();
        feeRecipient = new V4FeeRecipientMock();
        factory = new PledgeV4LiquidityFactory(
            IPoolManager(address(manager)), address(boardroomFactory), address(feeRecipient), address(this)
        );
        bytes32 hookSalt = _mineHookSalt();
        factory.deployHook(hookSalt);

        address predictedBoardroom = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 2);
        share = new V4TestToken("Share", "SHARE", predictedBoardroom);
        quote = new V4TestToken("Quote", "QUOTE", address(0));
        boardroom = new V4BoardroomMock(address(share), address(policyRegistry), address(factory));
        assertEq(address(boardroom), predictedBoardroom);
        boardroomFactory.register(address(boardroom), address(share));
        policyRegistry.setPolicy(address(factory), true);
        share.mint(address(boardroom), SEED);
        quote.mint(address(boardroom), SEED);
    }

    function testCanonicalCreationUsesPoolIdAndEscrowedClaims() public {
        PledgeV4LiquidityFactory.CreateParams memory params = _createParams();
        (address vaultAddress, bytes32 poolId, uint256 amountA, uint256 amountB, uint256 liquidity) =
            boardroom.create(params);

        PledgeV4LiquidityVault vault = PledgeV4LiquidityVault(vaultAddress);
        assertEq(poolId, factory.poolIdFor(address(share), address(quote)));
        assertEq(poolId, vault.poolId());
        assertEq(boardroom.activeVault(), vaultAddress);
        assertEq(boardroom.activePoolId(), poolId);
        assertTrue(factory.isVault(vaultAddress));
        assertEq(factory.vaultForPoolId(poolId), vaultAddress);
        assertEq(vault.balanceOf(vaultAddress), liquidity);
        assertEq(vault.totalSupply(), liquidity);
        assertEq(vault.positionLiquidity(), liquidity);
        assertGe(amountA, 95 ether);
        assertGe(amountB, 95 ether);
    }

    function testOnlyFactoryCanInitializeCanonicalPoolKey() public {
        V4TestToken other = new V4TestToken("Other", "OTHER", address(0));
        PoolKey memory key = factory.poolKeyFor(address(share), address(other));
        bytes32 poolId = PoolId.unwrap(key.toId());
        vm.expectRevert(abi.encodeWithSelector(PledgeV4Hook.PoolInitializationNotAuthorized.selector, poolId));
        manager.initialize(key, Q96);
    }

    function testInitialPriceMustStayInsideTheUsableFullRangeTicks() public {
        PledgeV4LiquidityFactory.CreateParams memory params = _createParams();
        params.sqrtPriceX96 = TickMath.getSqrtPriceAtTick(TickMath.minUsableTick(factory.TICK_SPACING()));
        vm.expectRevert(PledgeV4LiquidityFactory.InvalidAmount.selector);
        boardroom.create(params);

        params.sqrtPriceX96 = TickMath.getSqrtPriceAtTick(TickMath.maxUsableTick(factory.TICK_SPACING()));
        vm.expectRevert(PledgeV4LiquidityFactory.InvalidAmount.selector);
        boardroom.create(params);
    }

    function testFeesSplitAndClaimsRemainRedeemableDuringWindDown() public {
        (address vaultAddress,, uint256 seededA, uint256 seededB, uint256 liquidity) = boardroom.create(_createParams());
        PledgeV4LiquidityVault vault = PledgeV4LiquidityVault(vaultAddress);

        address currency0 = vault.currency0();
        address currency1 = vault.currency1();
        V4TestToken(currency0).mint(address(manager), 10 ether);
        V4TestToken(currency1).mint(address(manager), 20 ether);
        manager.setNextFees(10 ether, 20 ether);

        uint256 boardroom0Before = ERC20(currency0).balanceOf(address(boardroom));
        uint256 boardroom1Before = ERC20(currency1).balanceOf(address(boardroom));
        boardroom.claimFees(vaultAddress);
        manager.clearNextFees();
        assertEq(ERC20(currency0).balanceOf(address(feeRecipient)), 0.5 ether);
        assertEq(ERC20(currency1).balanceOf(address(feeRecipient)), 1 ether);
        assertEq(ERC20(currency0).balanceOf(address(boardroom)) - boardroom0Before, 9.5 ether);
        assertEq(ERC20(currency1).balanceOf(address(boardroom)) - boardroom1Before, 19 ether);

        boardroom.setWindingDown();
        uint256 claims = boardroom.releaseClaims(vaultAddress);
        assertEq(claims, liquidity);
        assertTrue(vault.isClosed());
        boardroom.transferClaims(vaultAddress, address(this), claims);
        (uint256 amountA, uint256 amountB, uint128 removed) =
            vault.redeemClaims(claims, 0, 0, address(this), block.timestamp);
        assertEq(removed, liquidity);
        assertApproxEqAbs(amountA, seededA, 1);
        assertApproxEqAbs(amountB, seededB, 1);
        assertEq(vault.totalSupply(), 0);
        assertEq(vault.positionLiquidity(), 0);
    }

    function testHostileUnderlyingCannotBlockWindDownClaimFallback() public {
        (address vaultAddress,,,, uint256 liquidity) = boardroom.create(_createParams());
        PledgeV4LiquidityVault vault = PledgeV4LiquidityVault(vaultAddress);

        address hostileCurrency = vault.currency0();
        V4TestToken(hostileCurrency).mint(address(manager), 1 ether);
        manager.setNextFees(1 ether, 0);
        V4TestToken(hostileCurrency).setTransfersRevert(true);

        vm.expectRevert();
        boardroom.claimFees(vaultAddress);

        boardroom.setWindingDown();
        uint256 claims = boardroom.releaseClaims(vaultAddress);
        assertEq(claims, liquidity);
        assertEq(vault.balanceOf(address(boardroom)), liquidity);
        assertEq(vault.positionLiquidity(), liquidity);
        assertTrue(vault.isClosed());
    }

    function testPoolManagerTakeMustDeliverTheExactCurrencyDelta() public {
        (address vaultAddress,,,,) = boardroom.create(_createParams());
        PledgeV4LiquidityVault vault = PledgeV4LiquidityVault(vaultAddress);
        V4TestToken shortToken = V4TestToken(vault.currency0());
        shortToken.mint(address(manager), 1 ether);
        manager.setNextFees(1 ether, 0);
        shortToken.setShortTransfers(true);

        vm.expectRevert(
            abi.encodeWithSelector(
                PledgeV4LiquidityVault.UnexpectedPoolManagerTransfer.selector, address(shortToken), 1 ether, 1 ether - 1
            )
        );
        boardroom.claimFees(vaultAddress);
    }

    function testPartialClaimRedemptionPaysRemovedPrincipalAndProRataBacking() public {
        (address vaultAddress,,,,) = boardroom.create(_createParams());
        PledgeV4LiquidityVault vault = PledgeV4LiquidityVault(vaultAddress);

        uint256 deposit = 10 ether;
        uint256 donation = 11 ether;
        share.mint(address(this), deposit + donation);
        quote.mint(address(this), deposit + donation);
        share.approve(vaultAddress, deposit);
        quote.approve(vaultAddress, deposit);
        (uint256 depositedA, uint256 depositedB, uint128 externalClaims) =
            vault.depositLiquidityForClaims(deposit, deposit, 9.5 ether, 9.5 ether, address(this), block.timestamp);
        share.transfer(vaultAddress, donation);
        quote.transfer(vaultAddress, donation);

        uint256 totalClaims = vault.totalSupply();
        boardroom.setWindingDown();
        uint256 protocolClaims = boardroom.releaseClaims(vaultAddress);

        (uint256 externalAmountA, uint256 externalAmountB,) =
            vault.redeemClaims(externalClaims, 0, 0, address(this), block.timestamp);
        uint256 expectedBacking = donation * externalClaims / totalClaims;
        assertApproxEqAbs(externalAmountA, depositedA + expectedBacking, 2);
        assertApproxEqAbs(externalAmountB, depositedB + expectedBacking, 2);
        assertEq(vault.totalSupply(), protocolClaims);
        assertEq(vault.positionLiquidity(), protocolClaims);
    }

    function testExternalDepositsMintCanonicalLiquidityBondClaimsWithoutCapturingDonations() public {
        (address vaultAddress,,,, uint256 protocolLiquidity) = boardroom.create(_createParams());
        PledgeV4LiquidityVault vault = PledgeV4LiquidityVault(vaultAddress);
        BondMarketFactory bondFactory = new BondMarketFactory(address(factory), address(boardroomFactory));

        uint256 deposit = 10 ether;
        uint256 donation = 1 ether;
        share.mint(address(this), deposit + donation);
        quote.mint(address(this), deposit + donation);
        share.transfer(vaultAddress, donation);
        quote.transfer(vaultAddress, donation);
        share.approve(vaultAddress, deposit);
        quote.approve(vaultAddress, deposit);

        (uint256 amountA, uint256 amountB, uint128 claims) =
            vault.depositLiquidityForClaims(deposit, deposit, 9.5 ether, 9.5 ether, address(this), block.timestamp);

        assertGe(amountA, 9.5 ether);
        assertGe(amountB, 9.5 ether);
        assertEq(vault.balanceOf(address(this)), claims);
        assertEq(vault.totalSupply(), uint256(protocolLiquidity) + claims);
        assertEq(vault.positionLiquidity(), vault.totalSupply());
        assertEq(share.balanceOf(vaultAddress), donation + deposit - amountA);
        assertEq(quote.balanceOf(vaultAddress), donation + deposit - amountB);

        BondMarket.CreateParams memory terms = BondMarket.CreateParams({
            quoteToken: vaultAddress,
            kind: BondMarket.MarketKind.Liquidity,
            capacity: 1 ether,
            initialPrice: 1 ether,
            minimumPrice: 0.5 ether,
            debtBuffer: 10_000,
            vesting: 1 days,
            start: 0,
            duration: 7 days,
            depositInterval: 1 days,
            salt: keccak256("liquidity-bond")
        });
        assertTrue(
            bondFactory.canCall(
                address(boardroom),
                address(this),
                address(bondFactory),
                0,
                abi.encodeCall(BondMarketFactory.createBondMarket, (terms))
            )
        );
    }

    function testExternalDepositRollsBackIfSettlementCallbackStartsWindDown() public {
        (address vaultAddress,,,,) = boardroom.create(_createParams());
        PledgeV4LiquidityVault vault = PledgeV4LiquidityVault(vaultAddress);

        uint256 deposit = 10 ether;
        share.mint(address(this), deposit);
        quote.mint(address(this), deposit);
        share.approve(vaultAddress, deposit);
        quote.approve(vaultAddress, deposit);
        uint256 supplyBefore = vault.totalSupply();
        uint256 liquidityBefore = vault.positionLiquidity();
        uint256 shareBalanceBefore = share.balanceOf(address(this));
        uint256 quoteBalanceBefore = quote.balanceOf(address(this));

        share.armWindDownOnTransfer(address(manager));
        vm.expectRevert(PledgeV4LiquidityVault.BoardroomMutationForbidden.selector);
        vault.depositLiquidityForClaims(deposit, deposit, 9.5 ether, 9.5 ether, address(this), block.timestamp);

        assertFalse(boardroom.windingDown());
        assertEq(vault.totalSupply(), supplyBefore);
        assertEq(vault.positionLiquidity(), liquidityBefore);
        assertEq(share.balanceOf(address(this)), shareBalanceBefore);
        assertEq(quote.balanceOf(address(this)), quoteBalanceBefore);
    }

    function _createParams() internal view returns (PledgeV4LiquidityFactory.CreateParams memory) {
        return PledgeV4LiquidityFactory.CreateParams({
            tokenA: address(share),
            tokenB: address(quote),
            amountADesired: SEED,
            amountBDesired: SEED,
            amountAMin: 95 ether,
            amountBMin: 95 ether,
            sqrtPriceX96: Q96,
            deadline: block.timestamp,
            salt: keccak256("position")
        });
    }

    function _mineHookSalt() internal view returns (bytes32 salt) {
        for (uint256 i; i < 100_000; ++i) {
            salt = bytes32(i);
            if (uint160(factory.predictHookAddress(salt)) & ((1 << 14) - 1) == (1 << 13)) return salt;
        }
        revert("hook salt");
    }
}
