// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {AssetPolicy} from "../src/AssetPolicy.sol";
import {Boardroom} from "../src/Boardroom.sol";
import {BoardroomFactory} from "../src/BoardroomFactory.sol";
import {ProtocolPolicy} from "../src/ProtocolPolicy.sol";
import {TokenGrant} from "../src/TokenGrant.sol";
import {TokenGrantFactory} from "../src/TokenGrantFactory.sol";

contract SeedToken {
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

    function transfer(address to, uint256 amount) external returns (bool) {
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

contract SeedLocal is Script {
    using stdJson for string;

    error InsufficientBoardroomCash(uint256 required, uint256 available);

    uint256 internal constant DEPLOYER_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 internal constant ISSUER_KEY = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    uint256 internal constant HOLDER_KEY = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;
    uint256 internal constant NEW_HOLDER_KEY = 0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6;
    uint256 internal constant BOARDROOM_OWNER_KEY = 0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a;
    uint256 internal constant CONTRACTOR_KEY = 0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba;
    uint256 internal constant INVESTOR_KEY = 0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e;

    uint256 internal constant DAY = 1 days;
    uint256 internal constant PLEDGE = 1 ether;
    uint256 internal constant CASH = 1e6;

    struct Deployment {
        BoardroomFactory boardroomFactory;
        ProtocolPolicy protocolPolicy;
        AssetPolicy assetPolicy;
        TokenGrantFactory tokenGrantFactory;
    }

    struct Actors {
        address deployer;
        address issuer;
        address holder;
        address newHolder;
        address boardroomOwner;
        address contractor;
        address investor;
    }

    struct GrantSpec {
        uint256 issuerKey;
        address holder;
        address token;
        address paymentToken;
        uint256 amount;
        uint256 price;
        uint256 expiry;
        uint256 vestingCliff;
        uint256 vestingEnd;
        bool transferable;
        uint256 transferUnlockTime;
        bytes32 salt;
    }

    struct SeededGrants {
        TokenGrant directPartiallySettled;
        TokenGrant directTransferredPaid;
        TokenGrant directHalted;
        TokenGrant boardroomShareGrant;
        TokenGrant boardroomShareSale;
        TokenGrant boardroomPayrollGrant;
    }

    Deployment internal deployment;
    Actors internal actors;
    SeedToken internal equity;
    SeedToken internal cash;
    Boardroom internal boardroom;
    SeededGrants internal grants;
    uint256 internal seedNonce;
    uint256 internal deployerKey;
    uint256 internal creationFee;

    function run() external {
        if (block.chainid != 31337) revert("SeedLocal only targets local Anvil chain 31337");

        deployerKey = vm.envOr("PRIVATE_KEY", DEPLOYER_KEY);
        seedNonce = vm.envOr("LOCAL_SEED_NONCE", block.number);

        _setActors(deployerKey);
        _readDeployment();
        _deploySeedTokens(deployerKey);
        _seedDirectGrants();
        _seedBoardroom();
        _writeSeedArtifact();
        _logSeed();
    }

    function _setActors(uint256 deployerKey_) internal {
        actors = Actors({
            deployer: vm.addr(deployerKey_),
            issuer: vm.addr(ISSUER_KEY),
            holder: vm.addr(HOLDER_KEY),
            newHolder: vm.addr(NEW_HOLDER_KEY),
            boardroomOwner: vm.addr(BOARDROOM_OWNER_KEY),
            contractor: vm.addr(CONTRACTOR_KEY),
            investor: vm.addr(INVESTOR_KEY)
        });
    }

    function _readDeployment() internal {
        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        string memory json = vm.readFile(path);
        BoardroomFactory boardroomFactory = BoardroomFactory(json.readAddress(".boardroomFactory"));
        ProtocolPolicy protocolPolicy = ProtocolPolicy(json.readAddress(".protocolPolicy"));
        AssetPolicy assetPolicy = AssetPolicy(json.readAddress(".assetPolicy"));
        TokenGrantFactory tokenGrantFactory = TokenGrantFactory(json.readAddress(".tokenGrantFactory"));
        deployment = Deployment({
            boardroomFactory: boardroomFactory,
            protocolPolicy: protocolPolicy,
            assetPolicy: assetPolicy,
            tokenGrantFactory: tokenGrantFactory
        });
        creationFee = tokenGrantFactory.creationFee();
    }

    function _deploySeedTokens(uint256 deployerKey_) internal {
        vm.startBroadcast(deployerKey_);
        equity = new SeedToken("Seed Equity Token", "EQTY", 18);
        cash = new SeedToken("Seed Cash", "CASH", 6);

        equity.mint(actors.issuer, 20_000 * PLEDGE);
        cash.mint(actors.holder, 1_000 * CASH);
        cash.mint(actors.newHolder, 1_000 * CASH);
        cash.mint(actors.investor, 1_000 * CASH);
        vm.stopBroadcast();
    }

    function _seedDirectGrants() internal {
        _seedDirectPartiallySettled();
        _seedDirectTransferredPaid();
        _seedDirectHalted();
    }

    function _seedDirectPartiallySettled() internal {
        uint256 now_ = block.timestamp;
        GrantSpec memory spec;
        spec.issuerKey = ISSUER_KEY;
        spec.holder = actors.holder;
        spec.token = address(equity);
        spec.paymentToken = address(0);
        spec.amount = 1_000 * PLEDGE;
        spec.price = 0;
        spec.expiry = now_ + 60 * DAY;
        spec.vestingCliff = now_ - 14 * DAY;
        spec.vestingEnd = now_ + 14 * DAY;
        spec.transferable = false;
        spec.transferUnlockTime = 0;
        spec.salt = _salt("direct-partially-settled");

        grants.directPartiallySettled = _createDirectGrant(spec);

        vm.startBroadcast(HOLDER_KEY);
        grants.directPartiallySettled.settle(100 * PLEDGE);
        vm.stopBroadcast();
    }

    function _seedDirectTransferredPaid() internal {
        uint256 now_ = block.timestamp;
        GrantSpec memory spec;
        spec.issuerKey = ISSUER_KEY;
        spec.holder = actors.holder;
        spec.token = address(equity);
        spec.paymentToken = address(cash);
        spec.amount = 800 * PLEDGE;
        spec.price = 2 * CASH;
        spec.expiry = now_ + 90 * DAY;
        spec.vestingCliff = now_ - 30 * DAY;
        spec.vestingEnd = now_ - 1;
        spec.transferable = true;
        spec.transferUnlockTime = now_ - 1;
        spec.salt = _salt("direct-transferred-paid");

        grants.directTransferredPaid = _createDirectGrant(spec);

        vm.startBroadcast(HOLDER_KEY);
        deployment.tokenGrantFactory
            .transferFrom(actors.holder, actors.newHolder, grants.directTransferredPaid.tokenId());
        vm.stopBroadcast();

        uint256 settlement = 100 * PLEDGE;
        uint256 cost = grants.directTransferredPaid.getSettlementCost(settlement);
        vm.startBroadcast(NEW_HOLDER_KEY);
        cash.approve(address(grants.directTransferredPaid), cost);
        grants.directTransferredPaid.settle(settlement);
        vm.stopBroadcast();
    }

    function _seedDirectHalted() internal {
        uint256 now_ = block.timestamp;
        GrantSpec memory spec;
        spec.issuerKey = ISSUER_KEY;
        spec.holder = actors.contractor;
        spec.token = address(equity);
        spec.paymentToken = address(0);
        spec.amount = 500 * PLEDGE;
        spec.price = 0;
        spec.expiry = now_ + 120 * DAY;
        spec.vestingCliff = now_ + 7 * DAY;
        spec.vestingEnd = now_ + 37 * DAY;
        spec.transferable = false;
        spec.transferUnlockTime = 0;
        spec.salt = _salt("direct-halted-before-cliff");

        grants.directHalted = _createDirectGrant(spec);

        vm.startBroadcast(ISSUER_KEY);
        grants.directHalted.stopVestingAndWithdrawUnvested();
        vm.stopBroadcast();
    }

    function _seedBoardroom() internal {
        vm.startBroadcast(BOARDROOM_OWNER_KEY);
        address boardroomAddress = deployment.boardroomFactory
            .createBoardroom(actors.boardroomOwner, "Seed Labs Common", "SEED", _salt("seed-boardroom"));
        boardroom = Boardroom(payable(boardroomAddress));
        boardroom.mint(address(boardroom), 5_000 * PLEDGE);
        cash.mint(address(boardroom), 25 * CASH);
        vm.stopBroadcast();

        vm.startBroadcast(deployerKey);
        deployment.assetPolicy.setAssetAllowed(boardroom.shareToken(), true);
        deployment.assetPolicy.setAssetAllowed(address(cash), true);
        vm.stopBroadcast();

        _seedBoardroomShareGrant();
        _seedBoardroomShareSale();
        _seedBoardroomPayrollGrant();
    }

    function _seedBoardroomShareGrant() internal {
        uint256 now_ = block.timestamp;
        GrantSpec memory spec;
        spec.holder = actors.holder;
        spec.token = boardroom.shareToken();
        spec.paymentToken = address(0);
        spec.amount = 600 * PLEDGE;
        spec.price = 0;
        spec.expiry = now_ + 120 * DAY;
        spec.vestingCliff = now_ - 2 * DAY;
        spec.vestingEnd = now_ + 28 * DAY;
        spec.transferable = false;
        spec.transferUnlockTime = 0;
        spec.salt = _salt("boardroom-share-grant");

        grants.boardroomShareGrant = _createBoardroomGrant(spec);

        vm.startBroadcast(HOLDER_KEY);
        grants.boardroomShareGrant.settle(20 * PLEDGE);
        vm.stopBroadcast();
    }

    function _seedBoardroomShareSale() internal {
        uint256 now_ = block.timestamp;
        GrantSpec memory spec;
        spec.holder = actors.investor;
        spec.token = boardroom.shareToken();
        spec.paymentToken = address(cash);
        spec.amount = 250 * PLEDGE;
        spec.price = CASH;
        spec.expiry = now_ + 120 * DAY;
        spec.vestingCliff = now_ - 1;
        spec.vestingEnd = now_ - 1;
        spec.transferable = false;
        spec.transferUnlockTime = 0;
        spec.salt = _salt("boardroom-share-sale");

        grants.boardroomShareSale = _createBoardroomGrant(spec);

        uint256 settlement = 50 * PLEDGE;
        uint256 cost = grants.boardroomShareSale.getSettlementCost(settlement);
        vm.startBroadcast(INVESTOR_KEY);
        cash.approve(address(grants.boardroomShareSale), cost);
        grants.boardroomShareSale.settle(settlement);
        vm.stopBroadcast();
    }

    function _seedBoardroomPayrollGrant() internal {
        uint256 now_ = block.timestamp;
        GrantSpec memory spec;
        spec.holder = actors.contractor;
        spec.token = address(cash);
        spec.paymentToken = address(0);
        spec.amount = 25 * CASH;
        spec.price = 0;
        spec.expiry = now_ + 120 * DAY;
        spec.vestingCliff = now_ - 1;
        spec.vestingEnd = now_ - 1;
        spec.transferable = false;
        spec.transferUnlockTime = 0;
        spec.salt = _salt("boardroom-payroll-grant");

        uint256 boardroomCash = cash.balanceOf(address(boardroom));
        if (boardroomCash < spec.amount) revert InsufficientBoardroomCash(spec.amount, boardroomCash);

        grants.boardroomPayrollGrant = _createBoardroomGrant(spec);

        vm.startBroadcast(CONTRACTOR_KEY);
        grants.boardroomPayrollGrant.settle(10 * CASH);
        vm.stopBroadcast();
    }

    function _createDirectGrant(GrantSpec memory spec) internal returns (TokenGrant grant) {
        address issuer = vm.addr(spec.issuerKey);

        vm.startBroadcast(spec.issuerKey);
        SeedToken(spec.token).approve(address(deployment.tokenGrantFactory), spec.amount);
        (bool success, bytes memory result) =
            address(deployment.tokenGrantFactory).call{value: creationFee}(_createGrantData(spec));
        vm.stopBroadcast();
        if (!success) _revertGrantCreation(result);

        grant = TokenGrant(abi.decode(result, (address)));
        if (grant.issuer() != issuer) revert("direct grant issuer mismatch");
    }

    function _createBoardroomGrant(GrantSpec memory spec) internal returns (TokenGrant grant) {
        uint256 fee = creationFee;
        Boardroom.Call[] memory calls = new Boardroom.Call[](2);
        calls[0] = Boardroom.Call({
            policy: address(deployment.assetPolicy),
            target: spec.token,
            value: 0,
            data: abi.encodeWithSignature(
                "approve(address,uint256)", address(deployment.tokenGrantFactory), spec.amount
            )
        });
        calls[1] = Boardroom.Call({
            policy: address(deployment.protocolPolicy),
            target: address(deployment.tokenGrantFactory),
            value: fee,
            data: _createGrantData(spec)
        });

        vm.startBroadcast(BOARDROOM_OWNER_KEY);
        bytes[] memory results = boardroom.executeBatch{value: fee}(calls);
        vm.stopBroadcast();

        grant = TokenGrant(abi.decode(results[1], (address)));
        if (grant.issuer() != address(boardroom)) revert("boardroom grant issuer mismatch");
    }

    function _createGrantData(GrantSpec memory spec) internal pure returns (bytes memory) {
        return abi.encodeCall(
            TokenGrantFactory.createGrant,
            (
                spec.holder,
                spec.token,
                spec.paymentToken,
                spec.amount,
                spec.price,
                spec.expiry,
                spec.vestingCliff,
                spec.vestingEnd,
                spec.transferable,
                spec.transferUnlockTime,
                spec.salt
            )
        );
    }

    function _revertGrantCreation(bytes memory returnData) internal pure {
        if (returnData.length == 0) revert("grant creation failed");

        assembly {
            revert(add(returnData, 0x20), mload(returnData))
        }
    }

    function _writeSeedArtifact() internal {
        string memory json = "seed";
        json.serialize("chainId", block.chainid);
        json.serialize("seedNonce", seedNonce);
        json.serialize("deployer", actors.deployer);
        json.serialize("issuer", actors.issuer);
        json.serialize("holder", actors.holder);
        json.serialize("newHolder", actors.newHolder);
        json.serialize("boardroomOwner", actors.boardroomOwner);
        json.serialize("contractor", actors.contractor);
        json.serialize("investor", actors.investor);
        json.serialize("equityToken", address(equity));
        json.serialize("cashToken", address(cash));
        json.serialize("boardroom", address(boardroom));
        json.serialize("boardroomShareToken", boardroom.shareToken());
        json.serialize("directPartiallySettledGrant", address(grants.directPartiallySettled));
        json.serialize("directTransferredPaidGrant", address(grants.directTransferredPaid));
        json.serialize("directHaltedGrant", address(grants.directHalted));
        json.serialize("boardroomShareGrant", address(grants.boardroomShareGrant));
        json.serialize("boardroomShareSaleGrant", address(grants.boardroomShareSale));
        string memory output = json.serialize("boardroomPayrollGrant", address(grants.boardroomPayrollGrant));

        vm.writeJson(output, string.concat("deployments/", vm.toString(block.chainid), ".seed.json"));
    }

    function _logSeed() internal view {
        console2.log("Seed nonce", seedNonce);
        console2.log("Issuer", actors.issuer);
        console2.log("Holder", actors.holder);
        console2.log("New holder", actors.newHolder);
        console2.log("Boardroom owner", actors.boardroomOwner);
        console2.log("Contractor", actors.contractor);
        console2.log("Investor", actors.investor);
        console2.log("Equity token", address(equity));
        console2.log("Cash token", address(cash));
        console2.log("Boardroom", address(boardroom));
        console2.log("Boardroom share token", boardroom.shareToken());
        console2.log("Direct partially settled grant", address(grants.directPartiallySettled));
        console2.log("Direct transferred paid grant", address(grants.directTransferredPaid));
        console2.log("Direct halted grant", address(grants.directHalted));
        console2.log("Boardroom share grant", address(grants.boardroomShareGrant));
        console2.log("Boardroom share sale grant", address(grants.boardroomShareSale));
        console2.log("Boardroom payroll grant", address(grants.boardroomPayrollGrant));
    }

    function _salt(string memory label) internal view returns (bytes32) {
        return keccak256(abi.encode("pledge.cash.local.seed", seedNonce, label));
    }
}
