// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

library BoardroomObligationStorage {
    /// @custom:storage-location erc7201:pledge.cash.boardroom.obligations
    bytes32 internal constant SLOT = 0xa6f539fac0466ed6b4a4ee00dee684afa692d33fde4319600a6154a0173b4f00;

    enum Kind {
        None,
        Grant,
        Distribution,
        Liquidity,
        Reward
    }

    struct Record {
        address policy;
        Kind kind;
        bool active;
        bool everRegistered;
    }

    struct Layout {
        uint256 activeCount;
        mapping(Kind kind => uint256 count) activeByKind;
        mapping(address obligation => Record record) obligationOf;
        mapping(address obligation => address[] assets) dependenciesOf;
        mapping(address asset => uint256 count) assetDependencyCount;
        address rewardPool;
        bool parentTransitionActive;
    }

    function layout() internal pure returns (Layout storage result) {
        bytes32 slot = SLOT;
        assembly ("memory-safe") {
            result.slot := slot
        }
    }
}
