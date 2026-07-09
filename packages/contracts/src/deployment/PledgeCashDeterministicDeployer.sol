// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "solady/auth/Ownable.sol";
import {CREATE3} from "solady/utils/CREATE3.sol";

contract PledgeCashDeterministicDeployer is Ownable {
    error EmptyInitCode();
    error InvalidAddress();
    error InitCodeHashMismatch(bytes32 salt, bytes32 expected, bytes32 actual);

    /// @notice First init-code hash accepted for each CREATE3 salt.
    mapping(bytes32 => bytes32) public initCodeHashForSalt;

    event DeterministicContractDeployed(bytes32 indexed salt, address indexed deployed, bytes32 initCodeHash);

    constructor(address owner_) {
        if (owner_ == address(0)) revert InvalidAddress();
        _initializeOwner(owner_);
    }

    /// @notice Deploy `initCode` behind `salt`, or return the existing deployment for the same init-code hash.
    /// @dev A salt can be reused only with the same init code, which protects deterministic addresses from drift.
    function deploy(bytes32 salt, bytes calldata initCode) external onlyOwner returns (address deployed) {
        if (initCode.length == 0) revert EmptyInitCode();

        bytes32 initCodeHash = keccak256(initCode);
        bytes32 expectedInitCodeHash = initCodeHashForSalt[salt];
        deployed = predict(salt);
        if (deployed.code.length != 0) {
            if (expectedInitCodeHash != initCodeHash) {
                revert InitCodeHashMismatch(salt, expectedInitCodeHash, initCodeHash);
            }
            return deployed;
        }

        if (expectedInitCodeHash != bytes32(0) && expectedInitCodeHash != initCodeHash) {
            revert InitCodeHashMismatch(salt, expectedInitCodeHash, initCodeHash);
        }
        initCodeHashForSalt[salt] = initCodeHash;
        deployed = CREATE3.deployDeterministic(initCode, salt);
        emit DeterministicContractDeployed(salt, deployed, initCodeHash);
    }

    /// @notice Predict the deterministic deployment address for `salt` from this deployer.
    function predict(bytes32 salt) public view returns (address) {
        return CREATE3.predictDeterministicAddress(salt);
    }
}
