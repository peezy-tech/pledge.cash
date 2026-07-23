// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

struct BoardroomCall {
    address policy;
    address target;
    uint256 value;
    bytes data;
}

interface IBoardroomGovernance {
    function status() external view returns (uint8);

    function governanceEpoch() external view returns (uint256);

    function controller() external view returns (address);

    function controllerGeneration() external view returns (uint256);

    function executeGovernance(uint256 expectedEpoch, address authority, BoardroomCall[] calldata calls)
        external
        returns (bytes[] memory results);
}
