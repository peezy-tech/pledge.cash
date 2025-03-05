// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "forge-std/Script.sol";
import "forge-std/Test.sol";

import {WrappedDN404} from "../src/backed.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";

import {Drama} from "../src/drama.sol";

import {Haus} from "../src/haus.sol";

import {Treasury} from "../src/treasury.sol";
import {StoryRegistry, Story} from "../src/story.sol";

import {Agent} from "../src/agent.sol";

import {FactoryRegistry} from "../test/mocks/mockFactoryRegistry.sol";
import {PoolFactory} from "../test/mocks/mockPoolFactory.sol";
import {Router} from "../test/mocks/mockRouter.sol";
import {Pool} from "../test/mocks/mockPool.sol";
import {MockERC20} from "../test/mocks/mockERC20.sol";
import {MockERC6551Registry} from "../test/mocks/mockERC6551Registry.sol";

import {IERC6551Registry} from "../src/interfaces.sol";

contract Deploy is Script, Test {
    address USDC;

    address public deployer;
    uint256 public deployerPrivateKey =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80; // local testnet

    Drama public drama;
    WrappedDN404 public dn404;
    IERC721 public erc721; // dn404.mirrorERC721();

    Haus public haus;
    // DramaERC6551 template;

    // uint256 public constant REWARD_EPOCH_DURATION = 12 hours;
    uint256 public constant DRAMA_TOTAL_SUPPLY = 1_000_000_000 ether;

    uint256 public USDC_INITIAL_SEED_LIQ;
    uint256 DRAMA_INITIAL_SEED_LIQ = 250000000 ether;

    IERC6551Registry tba_registry;

    function run() external {
        deployer = vm.addr(deployerPrivateKey);
        vm.startBroadcast(deployerPrivateKey);

        tba_registry = IERC6551Registry(address(new MockERC6551Registry()));

        _deployCore();
        vm.stopBroadcast();
    }

    function _deployCore() internal {
        MockERC20 usdc = new MockERC20("mockUSDC", "mUSDC", 6);
        usdc.mint(deployer, 100_000_000 * (10 ** usdc.decimals()));
        USDC = address(usdc);

        USDC_INITIAL_SEED_LIQ = 15000 * (10 ** usdc.decimals());

        haus = new Haus();

        console.log("haus", address(haus));

        address dn = haus.deployModule(
            "dn404",
            abi.encodePacked(
                type(WrappedDN404).creationCode,
                abi.encode("dramatic dollars", "dramaUSDC", USDC)
            ),
            0
        );

        dn404 = WrappedDN404(payable(dn));

        address dr = haus.deployModule(
            "token",
            abi.encodePacked(
                type(Drama).creationCode,
                abi.encode("drama.haus", "DRAMA", DRAMA_TOTAL_SUPPLY)
            ),
            0
        );

        // dn404 = new WrappedDN404("dramatic dollars", "dramaUSDC", USDC);
        drama = Drama(dr);
        erc721 = IERC721(dn404.mirrorERC721());

        console.log("drama token", address(drama), drama.totalSupply());
        console.log("wrapped dn404", address(dn404), dn404.totalSupply());
        console.log("erc721", address(erc721));

        // CREATE DRAMA-USDC V3 LP (100% RANGE)

        Pool poolTemplate = new Pool();
        PoolFactory poolFactory = new PoolFactory(address(poolTemplate));

        FactoryRegistry factoryRegistry = new FactoryRegistry(
            address(poolFactory),
            deployer,
            deployer,
            deployer
        );

        Router aerodromeRouter = new Router(
            deployer,
            address(factoryRegistry),
            address(poolFactory),
            deployer,
            USDC
        );

        // address AERODROME_LP_FACTORY_ADDRESS = 0x420DD381b31aEf6683db6B902084cB0FFECe40Da;
        address AERODROME_ROUTER = address(aerodromeRouter);
        // address AERODROME_POOL_FACTORY = 0x5C3F18F06CC09CA1910767A34a20F771039E37C0;

        Treasury seeder = Treasury(
            haus.deployModule(
                "treasury",
                abi.encodePacked(
                    type(Treasury).creationCode,
                    abi.encode(
                        AERODROME_ROUTER,
                        address(drama),
                        USDC,
                        false // volatile pool
                    )
                ),
                0
            )
        );
        address pool = seeder.pool();
        console.log("pool", pool);

        haus.addModule("usdc", USDC);

        SafeTransferLib.safeTransfer(
            USDC,
            address(haus),
            15_000 * (10 ** usdc.decimals())
        );

        bytes memory usdcApproveData = abi.encodeWithSelector(
            drama.approve.selector,
            address(seeder),
            USDC_INITIAL_SEED_LIQ
        );
        haus.execute("usdc", 0, usdcApproveData);

        bytes memory dramaApproveData = abi.encodeWithSelector(
            drama.approve.selector,
            address(seeder),
            DRAMA_INITIAL_SEED_LIQ
        );
        haus.execute("token", 0, dramaApproveData);

        bytes memory seedPoolData = abi.encodeWithSelector(
            seeder.seedPool.selector,
            DRAMA_INITIAL_SEED_LIQ,
            USDC_INITIAL_SEED_LIQ
        );

        // seeder.seedPool(1 ether, 1 ether);
        haus.execute("treasury", 0, seedPoolData);

        console.log("drama pool balance", drama.balanceOf(pool));

        console.log("usdc pool balance", SafeTransferLib.balanceOf(USDC, pool));

        StoryRegistry storyRegistry = StoryRegistry(
            haus.deployModule(
                "registry",
                abi.encodePacked(type(StoryRegistry).creationCode),
                0
            )
        );

        bytes memory deployTemplateData = abi.encodeWithSelector(
            storyRegistry.deployTemplate.selector,
            abi.encodePacked(type(Story).creationCode),
            0
        );

        haus.execute("registry", 0, deployTemplateData);

        address storyTemplate = storyRegistry.templates()[0];

        Agent agentTemplate = new Agent();
        agentTemplate.lock();

        bytes memory initCalldata = abi.encodeWithSelector(
            Story.init.selector,
            deployer,
            address(erc721),
            address(agentTemplate),
            address(tba_registry),
            "story.drama.haus"
        );

        bytes memory newStoryData = abi.encodeWithSelector(
            storyRegistry.newStory.selector,
            storyTemplate,
            true,
            initCalldata
        );

        haus.execute("registry", 0, newStoryData);

        Story story = Story(storyRegistry.stories()[0]);
        uint256 dn404Amount = 5 * dn404.price();

        SafeTransferLib.safeApprove(USDC, address(dn404), dn404Amount);
        dn404.mint(dn404Amount);

        bytes memory mintNftData = abi.encodeWithSelector(
            dn404.mintNft.selector,
            deployer,
            5
        );

        haus.execute("dn404", 0, mintNftData);

        uint256 cid;
        assembly {
            cid := chainid()
        }

        uint256[] memory nfts = dn404.owned(deployer);

        for (uint256 i = 0; i < nfts.length; i++) {
            uint256 tokenId = nfts[i];
            address actorERC6551 = tba_registry.createAccount(
                story.agentTemplate(),
                story.SALT(),
                cid,
                address(erc721),
                tokenId
            );

            console.log("actor token id and address", tokenId, actorERC6551);
            console.log("story.agentTemplate()", story.agentTemplate());
            console.logBytes32(story.SALT());
            console.log("cid", cid);
            console.log("address(erc721)", address(erc721));
            console.log("tokenId", tokenId);

            uint256 deadline = block.timestamp + 100;
            bytes memory signature = _signAgentEnter(
                actorERC6551,
                0,
                deadline,
                0,
                story
            );
            bytes memory agentEnterData = abi.encodeWithSelector(
                story.enter.selector,
                0,
                deadline,
                signature
            );
            // story.enter(0, deadline, signature);

            Agent(payable(actorERC6551)).execute(
                address(story),
                0,
                agentEnterData,
                0
            );

            // actor join story. needs allow function
        }

        address[] memory agentsInStory = story.agents();

        for (uint256 i = 0; i < agentsInStory.length; i++) {
            console.log("agent", agentsInStory[i]);
        }
    }

    function _signAgentEnter(
        address agent,
        uint256 tribute,
        uint256 deadline,
        uint256 nonce,
        Story story
    ) public returns (bytes memory) {
        bytes32 digest = story.hashAgentJoin(agent, tribute, deadline, nonce);

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(deployerPrivateKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v); // note the order here is different from line above.

        return signature;
    }
}
