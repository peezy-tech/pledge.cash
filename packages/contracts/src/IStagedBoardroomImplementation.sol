// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IStagedBoardroomImplementation {
    function stageId() external view returns (bytes32);
    function stageOrder() external view returns (uint8);
    function previousImplementation() external view returns (address);
    function nextImplementation() external view returns (address);
    function storageVersion() external view returns (uint256);
    function canUpgrade(bytes calldata data) external view returns (bool);
    function migrateFromPrevious(bytes calldata data) external;
}
