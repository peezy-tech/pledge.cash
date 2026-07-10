// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {WETH} from "solady/tokens/WETH.sol";
import {AmmFactory} from "../src/amm/AmmFactory.sol";
import {AmmPool} from "../src/amm/AmmPool.sol";
import {AmmRouter} from "../src/amm/AmmRouter.sol";
import {AssetPolicy} from "../src/policy/AssetPolicy.sol";
import {Boardroom} from "../src/boardroom/Boardroom.sol";
import {BoardroomFactory} from "../src/boardroom/BoardroomFactory.sol";
import {BoardroomPolicyRegistry} from "../src/boardroom/BoardroomPolicyRegistry.sol";
import {BoardroomToken} from "../src/boardroom/BoardroomToken.sol";
import {LockedLiquidity} from "../src/liquidity/LockedLiquidity.sol";
import {LockedLiquidityFactory} from "../src/liquidity/LockedLiquidityFactory.sol";
import {TokenGrant} from "../src/grants/TokenGrant.sol";
import {TokenGrantFactory} from "../src/grants/TokenGrantFactory.sol";

contract ProjectTokenLaunchScenario is Script {
    error ScenarioCheckFailed(string label);

    struct ScenarioState {
        uint256 nonce;
        BoardroomPolicyRegistry policyRegistry;
        AssetPolicy assetPolicy;
        BoardroomFactory boardroomFactory;
        TokenGrantFactory tokenGrantFactory;
        AmmFactory ammFactory;
        AmmRouter ammRouter;
        LockedLiquidityFactory lockedLiquidityFactory;
        Boardroom boardroom;
        BoardroomToken projectToken;
        WETH wrappedHype;
        address grantFeeRecipient;
        address pool;
        address locker;
        address grant;
        uint256 expectedSwapProtocolFee;
        uint256 grantCreationFeeRevenue;
        uint256 wrappedGrantCreationFeeRevenue;
    }

    uint256 internal constant ANVIL_OWNER_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 internal constant ANVIL_TRADER_KEY = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    uint256 internal constant ANVIL_GRANT_ISSUER_KEY =
        0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;

    uint256 internal constant PROJECT_LP_SUPPLY = 1_000_000 ether;
    uint256 internal constant PROJECT_GRANT_SUPPLY = 25_000 ether;
    uint256 internal constant HYPE_LIQUIDITY = 100 ether;
    uint256 internal constant HYPE_TRADE = 5 ether;
    uint256 internal constant GRANT_CREATION_FEE = 0.1 ether;

    function run() external {
        uint256 ownerKey = vm.envOr("OWNER_PRIVATE_KEY", ANVIL_OWNER_KEY);
        uint256 traderKey = vm.envOr("TRADER_PRIVATE_KEY", ANVIL_TRADER_KEY);
        uint256 grantIssuerKey = vm.envOr("GRANT_ISSUER_PRIVATE_KEY", ANVIL_GRANT_ISSUER_KEY);
        uint256 nonce = vm.envOr("PROJECT_TOKEN_LAUNCH_NONCE", block.number);
        address owner = vm.addr(ownerKey);
        address trader = vm.addr(traderKey);
        address grantIssuer = vm.addr(grantIssuerKey);
        address contributor = vm.envOr("CONTRIBUTOR", address(0xC0FFEE));

        vm.deal(owner, 1_000 ether);
        vm.deal(trader, 1_000 ether);
        vm.deal(grantIssuer, 1_000 ether);

        vm.startBroadcast(ownerKey);
        ScenarioState memory state = _deployProject(owner, nonce);
        _seedProjectBalances(state, grantIssuer);
        _lockProjectLiquidity(state);
        vm.stopBroadcast();

        _swapIntoProjectToken(state, traderKey, trader);
        _createProjectTokenGrant(state, grantIssuerKey, grantIssuer, contributor);
        _windDownAndWrapNativeRevenue(state, ownerKey);
        _log(state, owner, trader, grantIssuer, contributor);
    }

    function _deployProject(address owner, uint256 nonce) internal returns (ScenarioState memory state) {
        state.nonce = nonce;
        state.policyRegistry = new BoardroomPolicyRegistry(owner);
        state.wrappedHype = new WETH();
        state.assetPolicy = new AssetPolicy(owner, address(state.wrappedHype));
        state.boardroomFactory = new BoardroomFactory(address(state.policyRegistry), address(state.wrappedHype));
        state.tokenGrantFactory = new TokenGrantFactory(owner, address(state.boardroomFactory));
        state.ammFactory = new AmmFactory(owner);
        state.ammRouter = new AmmRouter(address(state.ammFactory), address(state.wrappedHype));
        state.lockedLiquidityFactory =
            new LockedLiquidityFactory(address(state.ammRouter), address(state.boardroomFactory));

        state.assetPolicy.setApprovalSpenderAllowed(address(state.lockedLiquidityFactory), true);
        state.policyRegistry.setPolicyAllowed(address(state.assetPolicy), true);
        state.policyRegistry.registerModulePolicy(address(state.lockedLiquidityFactory));

        address boardroomAddress = state.boardroomFactory
            .createBoardroom(owner, "pledge.cash Project Token", "PLEDGE", _salt(nonce, "project-boardroom"));
        state.boardroom = Boardroom(payable(boardroomAddress));
        state.projectToken = BoardroomToken(state.boardroom.shareToken());
        state.grantFeeRecipient = address(state.boardroom);
        state.assetPolicy.setAssetAllowed(address(state.projectToken), true);

        state.ammFactory.setProtocolFeeRecipient(address(state.boardroom));
        state.ammFactory.setLiquidityRouter(address(state.ammRouter));
        state.ammFactory.setReservationManager(address(state.lockedLiquidityFactory));
        state.tokenGrantFactory.setCreationFee(GRANT_CREATION_FEE);
        state.tokenGrantFactory.setFeeRecipient(address(state.boardroom));
        state.tokenGrantFactory.transferOwnership(address(state.boardroom));

        _check(state.ammFactory.protocolFeeRecipient() == address(state.boardroom), "protocol-fee-recipient");
        _check(state.tokenGrantFactory.creationFee() == GRANT_CREATION_FEE, "grant-creation-fee");
        _check(state.tokenGrantFactory.owner() == address(state.boardroom), "grant-factory-owner");
        _check(state.tokenGrantFactory.feeRecipient() == state.grantFeeRecipient, "grant-fee-recipient");
    }

    function _seedProjectBalances(ScenarioState memory state, address grantIssuer) internal {
        state.boardroom.mint(address(state.boardroom), PROJECT_LP_SUPPLY);
        state.boardroom.mint(grantIssuer, PROJECT_GRANT_SUPPLY);

        state.wrappedHype.deposit{value: HYPE_LIQUIDITY}();
        _check(state.wrappedHype.transfer(address(state.boardroom), HYPE_LIQUIDITY), "fund-boardroom-hype");

        _check(state.projectToken.balanceOf(address(state.boardroom)) == PROJECT_LP_SUPPLY, "boardroom-project-balance");
        _check(state.projectToken.balanceOf(grantIssuer) == PROJECT_GRANT_SUPPLY, "grant-issuer-project-balance");
        _check(state.wrappedHype.balanceOf(address(state.boardroom)) == HYPE_LIQUIDITY, "boardroom-hype-balance");
    }

    function _lockProjectLiquidity(ScenarioState memory state) internal {
        bytes32 salt = _salt(state.nonce, "project-locked-liquidity");
        address predictedLocker =
            state.lockedLiquidityFactory.predictLockedLiquidityAddress(address(state.boardroom), salt);
        LockedLiquidityFactory.CreateParams memory params = LockedLiquidityFactory.CreateParams({
            tokenA: address(state.projectToken),
            tokenB: address(state.wrappedHype),
            amountADesired: PROJECT_LP_SUPPLY,
            amountBDesired: HYPE_LIQUIDITY,
            amountAMin: PROJECT_LP_SUPPLY,
            amountBMin: HYPE_LIQUIDITY,
            deadline: block.timestamp + 1 hours,
            salt: salt
        });

        Boardroom.Call[] memory calls = new Boardroom.Call[](3);
        calls[0] = _approvalCall(state, address(state.projectToken), PROJECT_LP_SUPPLY);
        calls[1] = _approvalCall(state, address(state.wrappedHype), HYPE_LIQUIDITY);
        calls[2] = Boardroom.Call({
            policy: address(state.lockedLiquidityFactory),
            target: address(state.lockedLiquidityFactory),
            value: 0,
            data: abi.encodeCall(LockedLiquidityFactory.createLockedLiquidity, (params))
        });

        bytes[] memory results = state.boardroom.executeBatch(calls);
        uint256 liquidity;
        (state.locker, state.pool,,, liquidity) = abi.decode(results[2], (address, address, uint256, uint256, uint256));

        _check(state.locker == predictedLocker, "project-locker-predicted");
        _check(liquidity > 0, "project-liquidity");
        _check(LockedLiquidity(state.locker).lockedLiquidity() == liquidity, "project-lp-locked");
        _check(AmmPool(state.pool).balanceOf(state.locker) == liquidity, "locker-holds-lp");
        _check(state.boardroom.lockedLiquidityAt(0) == state.locker, "boardroom-recorded-locker");
    }

    function _swapIntoProjectToken(ScenarioState memory state, uint256 traderKey, address trader) internal {
        uint256 boardroomHypeBeforeSwap = state.wrappedHype.balanceOf(address(state.boardroom));
        uint256 nominalFee = HYPE_TRADE * state.ammFactory.SWAP_FEE_BPS() / state.ammFactory.FEE_DENOMINATOR();
        state.expectedSwapProtocolFee =
            nominalFee * state.ammFactory.PROTOCOL_FEE_SHARE_BPS() / state.ammFactory.FEE_DENOMINATOR();

        vm.startBroadcast(traderKey);
        address[] memory path = new address[](2);
        path[0] = address(state.wrappedHype);
        path[1] = address(state.projectToken);
        uint256[] memory amounts =
            state.ammRouter.swapExactNativeForTokens{value: HYPE_TRADE}(1, path, trader, block.timestamp + 1 hours);
        vm.stopBroadcast();

        uint256 boardroomHypeAfterSwap = state.wrappedHype.balanceOf(address(state.boardroom));
        _check(amounts[0] == HYPE_TRADE, "swap-input");
        _check(amounts[1] == state.projectToken.balanceOf(trader), "trader-project-token");
        _check(boardroomHypeAfterSwap - boardroomHypeBeforeSwap == state.expectedSwapProtocolFee, "swap-protocol-fee");
        _check(LockedLiquidity(state.locker).lockedLiquidity() > 0, "locked-liquidity-survives-swap");
    }

    function _createProjectTokenGrant(
        ScenarioState memory state,
        uint256 grantIssuerKey,
        address grantIssuer,
        address contributor
    ) internal {
        uint256 feeRecipientNativeBeforeGrant = state.grantFeeRecipient.balance;
        bytes32 grantSalt = _salt(state.nonce, "project-token-grant");
        address predictedGrant = state.tokenGrantFactory.predictGrantAddress(grantIssuer, grantSalt);

        vm.startBroadcast(grantIssuerKey);
        state.projectToken.approve(address(state.tokenGrantFactory), PROJECT_GRANT_SUPPLY);
        state.grant = state.tokenGrantFactory.createGrant{value: GRANT_CREATION_FEE}(
            contributor,
            address(state.projectToken),
            address(0),
            PROJECT_GRANT_SUPPLY,
            0,
            block.timestamp + 180 days,
            block.timestamp + 30 days,
            block.timestamp + 120 days,
            false,
            0,
            grantSalt
        );
        vm.stopBroadcast();

        uint256 feeRecipientNativeAfterGrant = state.grantFeeRecipient.balance;
        state.grantCreationFeeRevenue = feeRecipientNativeAfterGrant - feeRecipientNativeBeforeGrant;
        TokenGrant grant = TokenGrant(state.grant);
        _check(state.grant == predictedGrant, "project-grant-predicted");
        _check(state.grantCreationFeeRevenue == GRANT_CREATION_FEE, "grant-fee-revenue");
        _check(address(state.boardroom).balance == GRANT_CREATION_FEE, "boardroom-native-fee-balance");
        _check(state.projectToken.balanceOf(state.grant) == PROJECT_GRANT_SUPPLY, "project-grant-escrow");
        _check(grant.issuer() == grantIssuer, "project-grant-issuer");
        _check(grant.holder() == contributor, "project-grant-holder");
    }

    function _windDownAndWrapNativeRevenue(ScenarioState memory state, uint256 ownerKey) internal {
        uint256 nativeBefore = address(state.boardroom).balance;
        uint256 wrappedBefore = state.wrappedHype.balanceOf(address(state.boardroom));

        vm.startBroadcast(ownerKey);
        state.boardroom.startWindDown();
        vm.stopBroadcast();

        state.wrappedGrantCreationFeeRevenue = state.wrappedHype.balanceOf(address(state.boardroom)) - wrappedBefore;
        _check(nativeBefore == GRANT_CREATION_FEE, "native-fee-before-wind-down");
        _check(address(state.boardroom).balance == 0, "native-fee-wrapped");
        _check(state.wrappedGrantCreationFeeRevenue == nativeBefore, "wrapped-fee-revenue");
    }

    function _approvalCall(ScenarioState memory state, address token, uint256 amount)
        internal
        pure
        returns (Boardroom.Call memory)
    {
        return Boardroom.Call({
            policy: address(state.assetPolicy),
            target: token,
            value: 0,
            data: abi.encodeWithSignature("approve(address,uint256)", address(state.lockedLiquidityFactory), amount)
        });
    }

    function _log(ScenarioState memory state, address owner, address trader, address grantIssuer, address contributor)
        internal
        view
    {
        console2.log("scenarioNonce", state.nonce);
        console2.log("owner", owner);
        console2.log("trader", trader);
        console2.log("grantIssuer", grantIssuer);
        console2.log("contributor", contributor);
        console2.log("policyRegistry", address(state.policyRegistry));
        console2.log("assetPolicy", address(state.assetPolicy));
        console2.log("boardroomFactory", address(state.boardroomFactory));
        console2.log("tokenGrantFactory", address(state.tokenGrantFactory));
        console2.log("ammFactory", address(state.ammFactory));
        console2.log("ammRouter", address(state.ammRouter));
        console2.log("lockedLiquidityFactory", address(state.lockedLiquidityFactory));
        console2.log("boardroom", address(state.boardroom));
        console2.log("projectToken", address(state.projectToken));
        console2.log("wrappedHype", address(state.wrappedHype));
        console2.log("grantFeeRecipient", state.grantFeeRecipient);
        console2.log("pool", state.pool);
        console2.log("locker", state.locker);
        console2.log("grant", state.grant);
        console2.log("traderProjectTokens", state.projectToken.balanceOf(trader));
        console2.log("boardroomWrappedHypeRevenueBalance", state.wrappedHype.balanceOf(address(state.boardroom)));
        console2.log("expectedSwapProtocolFee", state.expectedSwapProtocolFee);
        console2.log("grantCreationFeeRevenue", state.grantCreationFeeRevenue);
        console2.log("wrappedGrantCreationFeeRevenue", state.wrappedGrantCreationFeeRevenue);
        console2.log("grantFeeRecipientNativeBalance", state.grantFeeRecipient.balance);
        console2.log("grantCreationFee", GRANT_CREATION_FEE);
        console2.log("lockedLp", LockedLiquidity(state.locker).lockedLiquidity());
    }

    function _salt(uint256 nonce, string memory label) internal pure returns (bytes32) {
        return keccak256(abi.encode("pledge.cash.project-token-launch", nonce, label));
    }

    function _check(bool condition, string memory label) internal pure {
        if (!condition) revert ScenarioCheckFailed(label);
    }
}
