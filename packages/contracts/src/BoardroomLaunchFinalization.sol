// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Boardroom} from "./Boardroom.sol";

contract BoardroomLaunchFinalization is Boardroom {
    constructor(address nextImplementation_) Boardroom(nextImplementation_, 1, STAGE_ID_LAUNCH_FINALIZATION) {}

    function mint(address, uint256) external pure override {
        revert MintingFrozen(LaunchStage.LaunchFinalization);
    }

    function migrateFromPrevious(bytes calldata data) external override {
        _requireMigrationImplementation();
        if (data.length != 0) revert UpgradeNotAllowed(address(this));
        _advanceLaunchStage(LaunchStage.LaunchFinalization);
    }
}
