// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import {Ownable} from "solady/auth/Ownable.sol";
import {EnumerableMap} from "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";

import "forge-std/Test.sol";

contract Haus is Ownable, Test {
    using EnumerableSet for EnumerableSet.AddressSet;

    mapping(bytes32 => address) public _modules;
    EnumerableSet.AddressSet _module_addresses;
    constructor() {
        _initializeOwner(msg.sender);
    }

    receive() external payable {}

    function getHashKey(string memory name) public view returns (bytes32) {
        return keccak256(abi.encodePacked(name));
    }

    function getModule(string memory name) public view returns (address) {
        return _modules[getHashKey(name)];
    }

    // TODO: rename to addExternalModule?
    function addModule(
        string memory name,
        address target
    ) public onlyOwner returns (address) {
        bytes32 hashKey = getHashKey(name);

        _modules[hashKey] = target; // TODO: require is a contract

        // emit ModuleSet

        return target;
    }

    // todo: change to deployModule()
    function deployModule(
        string memory name,
        bytes memory bytecode,
        uint256 value
    ) public onlyOwner returns (address) {
        bytes32 hashKey = getHashKey(name);
        // require(_modules[hashKey] == address(0), "module already set!");

        address mod = Create2.deploy(value, hashKey, bytecode);

        // _modules.set(keccak256(abi.encodePacked(_name)), target);

        _modules[hashKey] = mod;
        _module_addresses.add(mod);

        // emit ModuleSet(name, address);

        return mod;
    }

    function execute(
        string memory module,
        uint256 value,
        bytes memory data
    ) external onlyOwner {
        console.log("calling module", module);
        address target = getModule(module);
        require(target != address(0), "no module!");

        (bool success, ) = target.call{value: value}(data);
        require(success, "haus: call failed");
    }
}
