// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Boardroom} from "../Boardroom.sol";
import {BoardroomCall} from "../IBoardroomGovernance.sol";
import {LegacyBoardroomFacet} from "./LegacyBoardroomFacet.sol";

contract BoardroomExecutionFacet is LegacyBoardroomFacet {
    bytes4 internal constant VNEXT_REPLACE_CONTROLLER_SELECTOR =
        bytes4(keccak256("replaceController(bytes32,address,address,address,uint64,uint64,uint64)"));

    error InvalidControllerReplacement();

    constructor(address legacyBoardroomLogic_) LegacyBoardroomFacet(legacyBoardroomLogic_) {}

    function execute(bytes32, Boardroom.Call calldata call_) external payable returns (bytes memory result) {
        result = abi.decode(_delegateLegacyData(abi.encodeCall(Boardroom.execute, (call_))), (bytes));
    }

    function executeBatch(bytes32, Boardroom.Call[] calldata calls) external payable returns (bytes[] memory results) {
        results = abi.decode(_delegateLegacyData(abi.encodeCall(Boardroom.executeBatch, (calls))), (bytes[]));
    }

    function executeGovernance(bytes32, uint256 expectedEpoch, address authority, BoardroomCall[] calldata calls)
        external
        returns (bytes[] memory results)
    {
        if (calls.length != 1) {
            for (uint256 i; i < calls.length; ++i) {
                bytes calldata data = calls[i].data;
                if (
                    calls[i].target == address(this) && data.length >= 4
                        && bytes4(data[:4]) == VNEXT_REPLACE_CONTROLLER_SELECTOR
                ) {
                    revert InvalidControllerReplacement();
                }
            }
        }
        results = abi.decode(
            _delegateLegacyData(abi.encodeCall(Boardroom.executeGovernance, (expectedEpoch, authority, calls))),
            (bytes[])
        );
    }

    function executeWindDownCall(bytes32, Boardroom.Call calldata call_) external returns (bytes memory result) {
        result = abi.decode(_delegateLegacyData(abi.encodeCall(Boardroom.executeWindDownCall, (call_))), (bytes));
    }

    function wrapNativeBalance(bytes32) external {
        _delegateLegacy(Boardroom.wrapNativeBalance.selector);
    }

    function reserveRedeemableAsset(bytes32, address) external {
        _delegateLegacy(Boardroom.reserveRedeemableAsset.selector);
    }

    function registerRedeemableAsset(bytes32, address) external {
        _delegateLegacy(Boardroom.registerRedeemableAsset.selector);
    }

    function contributeTreasuryAsset(bytes32, address, uint256, uint256) external {
        _delegateLegacy(Boardroom.contributeTreasuryAsset.selector);
    }

    function removeRedeemableAsset(bytes32, address) external {
        _delegateLegacy(Boardroom.removeRedeemableAsset.selector);
    }

    function pruneObligation(bytes32, address) external returns (bool pruned) {
        pruned = abi.decode(_delegateLegacy(Boardroom.pruneObligation.selector), (bool));
    }

    function pruneObligations(bytes32, address[] calldata obligations) external returns (uint256 pruned) {
        pruned = abi.decode(_delegateLegacyData(abi.encodeCall(Boardroom.pruneObligations, (obligations))), (uint256));
    }

    function recordGrantFromDistribution(bytes32, address) external {
        _delegateLegacy(Boardroom.recordGrantFromDistribution.selector);
    }

    function recordLockedLiquidityFromDistribution(bytes32, address, address) external {
        _delegateLegacy(Boardroom.recordLockedLiquidityFromDistribution.selector);
    }
}
