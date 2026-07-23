// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

library BoardroomPrimaryMarketStorage {
    /// @custom:storage-location erc7201:pledge.cash.boardroom.primary-market
    bytes32 internal constant SLOT = 0x1fc3942db044dda145f57a0de10a0b0bbaef4bf04a771c5bf057c1d488d4cf00;

    enum Mode {
        Unset,
        BondingCurve,
        GeneralAvailability
    }

    struct Layout {
        Mode mode;
        bool curveEverConfigured;
        address curve;
        address quoteAsset;
        address migrationCustody;
        uint256 authorizedBoardroomFunding;
    }

    function layout() internal pure returns (Layout storage result) {
        bytes32 slot = SLOT;
        assembly ("memory-safe") {
            result.slot := slot
        }
    }
}
