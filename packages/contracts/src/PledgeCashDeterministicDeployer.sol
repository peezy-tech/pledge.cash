// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "solady/auth/Ownable.sol";
import {CREATE3} from "solady/utils/CREATE3.sol";

contract PledgeCashDeterministicDeployer is Ownable {
    error EmptyInitCode();
    error InvalidAddress();

    event DeterministicContractDeployed(bytes32 indexed salt, address indexed deployed, bytes32 initCodeHash);

    constructor(address owner_) {
        if (owner_ == address(0)) revert InvalidAddress();
        _initializeOwner(owner_);
    }

    function deploy(bytes32 salt, bytes calldata initCode) external onlyOwner returns (address deployed) {
        if (initCode.length == 0) revert EmptyInitCode();

        deployed = predict(salt);
        if (deployed.code.length != 0) return deployed;

        deployed = CREATE3.deployDeterministic(initCode, salt);
        emit DeterministicContractDeployed(salt, deployed, keccak256(initCode));
    }

    function predict(bytes32 salt) public view returns (address) {
        return CREATE3.predictDeterministicAddress(salt);
    }
}
