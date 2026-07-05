// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Boardroom} from "./Boardroom.sol";
import {IBoardroomMintPolicy} from "./IBoardroomMintPolicy.sol";

contract BoardroomFinal is Boardroom {
    constructor() Boardroom(address(0), 3, STAGE_ID_FINAL) {}

    function mint(address to, uint256 amount) external override onlyOwner {
        _requireStatus(BoardroomStatus.Active);
        if (to == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();

        address policy = postLaunchMintPolicy;
        if (policy == address(0)) revert MintPolicyNotSet();
        if (!IBoardroomMintPolicy(policy).canMint(address(this), msg.sender, to, amount)) {
            revert MintPolicyRejected(policy, to, amount);
        }

        _mintShares(to, amount);
    }

    function setPostLaunchMintPolicy(address policy) external override onlyOwner {
        if (policy == address(0)) revert InvalidAddress();
        postLaunchMintPolicy = policy;
        emit PostLaunchMintPolicySet(policy);
    }

    function migrateFromPrevious(bytes calldata data) external override {
        _requireMigrationImplementation();
        if (data.length != 0) revert UpgradeNotAllowed(address(this));
        _advanceLaunchStage(LaunchStage.Final);
    }
}
