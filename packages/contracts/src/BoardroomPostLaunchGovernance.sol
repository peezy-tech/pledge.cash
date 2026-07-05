// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Boardroom} from "./Boardroom.sol";
import {IBoardroomMintPolicy} from "./IBoardroomMintPolicy.sol";

contract BoardroomPostLaunchGovernance is Boardroom {
    constructor(address nextImplementation_) Boardroom(nextImplementation_, 2, STAGE_ID_POST_LAUNCH_GOVERNANCE) {}

    function mint(address to, uint256 amount) external virtual override onlyOwner {
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

    function setPostLaunchMintPolicy(address policy) external virtual override onlyOwner {
        if (policy == address(0)) revert InvalidAddress();
        postLaunchMintPolicy = policy;
        emit PostLaunchMintPolicySet(policy);
    }

    function migrateFromPrevious(bytes calldata data) external override {
        _requireMigrationImplementation();
        if (data.length != 0) revert UpgradeNotAllowed(address(this));
        _advanceLaunchStage(LaunchStage.PostLaunchGovernance);
    }
}
