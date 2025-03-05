// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "solady/auth/Ownable.sol";
import {EnumerableSetLib} from "solady/utils/EnumerableSetLib.sol";
import {LibClone} from "solady/utils/LibClone.sol";

import {SignatureCheckerLib} from "solady/utils/SignatureCheckerLib.sol";
import {EIP712} from "solady/utils/EIP712.sol";

import {LibClone} from "solady/utils/LibClone.sol";
import {Initializable} from "solady/utils/Initializable.sol";

import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

interface IERC6551Registry {
    /**
     * @dev The registry MUST emit the ERC6551AccountCreated event upon successful account creation.
     */
    event ERC6551AccountCreated(
        address account,
        address indexed implementation,
        bytes32 salt,
        uint256 chainId,
        address indexed tokenContract,
        uint256 indexed tokenId
    );

    /**
     * @dev The registry MUST revert with AccountCreationFailed error if the create2 operation fails.
     */
    error AccountCreationFailed();

    /**
     * @dev Creates a token bound account for a non-fungible token.
     *
     * If account has already been created, returns the account address without calling create2.
     *
     * Emits ERC6551AccountCreated event.
     *
     * @return account The address of the token bound account
     */
    function createAccount(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external returns (address account);

    /**
     * @dev Returns the computed token bound account address for a non-fungible token.
     *
     * @return account The address of the token bound account
     */
    function account(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external view returns (address account);
}

import "forge-std/Test.sol";

interface IStoryAgent {
    function story() external view returns (address);
    function owner() external view returns (address);
    function token()
        external
        view
        returns (uint256 chainId, address tokenContract, uint256 tokenId);

    function setStory(bool isEntering) external returns (bool);
}

interface IStory {
    function lock() external;
}

// simple story that uses EoAs as 'characters' and story owners can sign off on rewards
contract SimpleStory {}

// NFT contract story.
contract Story is Initializable, Ownable, EIP712, IStory, Test {
    using EnumerableSetLib for EnumerableSetLib.AddressSet;

    address public agentTemplate;
    address public agentNfts;
    string public uri;

    bytes32 public constant SALT = keccak256("drama.haus");

    EnumerableSetLib.AddressSet _agents;

    IERC6551Registry tba_registry;

    function lock() external initializer {
        _initializeOwner(address(0));
    }

    function agents() public view returns (address[] memory) {
        return _agents.values();
    }
    function _domainNameAndVersion()
        internal
        pure
        override
        returns (string memory name, string memory version)
    {
        name = "drama.haus";
        version = "1";
    }

    function init(
        address _director,
        address _agentNfts,
        address _agentTemplate,
        address erc6551,
        string memory _uri
    ) external initializer {
        _initializeOwner(_director);
        agentNfts = _agentNfts;
        uri = _uri;
        agentTemplate = _agentTemplate;

        // TODO: is there a better way to have this without having to hardcode on contract init
        //       or have erc6551 as an address input? 
        tba_registry = IERC6551Registry(erc6551); 
        
    }

    //
    /**
    - HOW WOULD UX CHANGE IF
        actorEnter required msg.sender to be a TBA?
         - we would need to do account deployment on client side or on an external contract...
         - actor going from one story to another -> would need old signers signature to call "allowedExecute" and this owners...
         - owners can pre-check status on the character and run validations if needed
         - function can stay the same as stories that take in an EoA as the player. down the line, a story could even accept both?
         - 

     */
    error OverDeadline();
    function enter(uint256 tribute, uint256 deadline, bytes memory sig) public {
        if (!validateEnter(msg.sender, tribute, deadline, sig))
            revert Unauthorized();
        if (deadline < block.timestamp) revert OverDeadline();

        IERC721 _nft = IERC721(agentNfts);

        IStoryAgent agent = IStoryAgent(msg.sender);

        (uint256 chainId, address tokenContract, uint256 tokenId) = agent
            .token();

        uint256 cid;
        assembly {
            cid := chainid()
        }

        address tba = tba_registry.account(
            agentTemplate,
            SALT,
            cid,
            agentNfts,
            tokenId
        );

        if (
            tokenContract != agentNfts ||
            chainId != cid ||
            msg.sender != tba ||
            _nft.ownerOf(tokenId) != agent.owner()
        ) revert();

        // if (msg.sender != _nft.ownerOf(tokenId)) revert NotOwner();

        console2.log("checking permission");

        // DramaERC6551 acc = DramaERC6551(payable(tba));
        console2.log("validating account");
        // if (address(0) != acc.story()) revert Unauthorized();

        _agents.add(msg.sender);

        agent.setStory(true);
        console.log('foo');

        // acc.setStory(address(this));
    }

    error NotActor();
    function exit(uint256 deadline, bytes memory sig) public {
        // if heartbeat is pulsing, validate sig and deadline.
        if (!_agents.contains(msg.sender)) revert NotActor();

        _agents.remove(msg.sender);
        IStoryAgent(msg.sender).setStory(false);
    }

    // TODO: on server side add nonce replay validation. that is: if server allowed a given agentNonce, do not allow the next signature requests. we should also add a deadline timestamp to the hash call and server/onchain validation?
    function validateExternalCall(
        address agent,
        address target,
        uint256 value,
        bytes memory data,
        bytes memory sig
    ) public view returns (bool) {
        return
            SignatureCheckerLib.isValidSignatureNow(
                owner(),
                hashExternalCall(agent, target, value, data, 0), // TODO: add agent nonce
                sig
            );
    }

    function validateEnter(
        address agent,
        uint256 tribute,
        uint256 deadline,
        bytes memory sig
    ) public view returns (bool) {
        // todo: make this contract erc1271 compatible
        return
            SignatureCheckerLib.isValidSignatureNow(
                owner(),
                hashAgentJoin(agent, tribute, deadline, 0), // TODO: add agent nonce
                sig
            );
    }

    bytes32 public constant AGENT_EXTERNAL_CALL_TYPEHASH =
        keccak256(
            "AgentExternalCall(address agent,address target,uint256 value,bytes data,uint256 nonce)"
        );
    function hashExternalCall(
        address agent,
        address target,
        uint256 value,
        bytes memory data,
        uint256 nonce
    ) public view returns (bytes32) {
        return
            _hashTypedData(
                keccak256(
                    abi.encode(
                        AGENT_EXTERNAL_CALL_TYPEHASH,
                        agent,
                        target,
                        value,
                        data,
                        nonce
                    )
                )
            );
    }

    bytes32 public constant AGENT_JOIN_TYPEHASH =
        keccak256(
            "AgentJoin(address agent,uint256 tribute,uint256 deadline,uint256 nonce)"
        );
    function hashAgentJoin(
        address agent,
        uint256 tribute,
        uint256 deadline,
        uint256 nonce
    ) public view returns (bytes32) {
        return
            _hashTypedData(
                keccak256(
                    abi.encode(
                        AGENT_JOIN_TYPEHASH,
                        agent,
                        tribute,
                        deadline,
                        nonce
                    )
                )
            );
    }
}

contract StoryRegistry is Ownable {
    using EnumerableSetLib for EnumerableSetLib.AddressSet;

    EnumerableSetLib.AddressSet _stories;
    EnumerableSetLib.AddressSet _strict_stories;

    EnumerableSetLib.AddressSet _storyTemplates;
    EnumerableSetLib.AddressSet _actorTemplates;

    constructor() {
        _initializeOwner(msg.sender);
    }

    function deployTemplate(
        bytes memory bytecode,
        uint256 value
    ) public onlyOwner returns (address) {
        // TODO: precompute address and check if exists

        address template = Create2.deploy(
            value,
            keccak256(abi.encodePacked(address(this))),
            bytecode
        );
        IStory(template).lock();

        _storyTemplates.add(template);

        return template;
    }

    function newStory(
        address template,
        bool isStrict,
        bytes memory initCalldata
    ) public payable onlyOwner returns (address) {
        require(_storyTemplates.contains(template), "not story");

        address story = LibClone.clone(template);

        // Create minimal proxy clone of the template
        // instance = template.clone();

        // Initialize the instance with provided calldata
        (bool success, ) = story.call{value: msg.value}(initCalldata);
        if (!success) {
            revert(); //InitializationFailed();
        }

        // emit InstanceDeployed(template, instance);

        _stories.add(story);
        if (isStrict) {
            _strict_stories.add(story);
        }

        // emit storyCreated
    }

    function isStory(
        address target
    ) public view returns (bool isTargetStory, bool isStrict) {
        return (_stories.contains(target), _strict_stories.contains(target));
    }

    function stories() public view returns (address[] memory) {
        return _stories.values();
    }

    function strictStories() public view returns (address[] memory) {
        return _strict_stories.values();
    }

    function templates() public view returns (address[] memory) {
        return _storyTemplates.values();
    }
}
