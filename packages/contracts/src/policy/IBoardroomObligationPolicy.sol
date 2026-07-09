// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IBoardroomCallPolicy} from "./IBoardroomCallPolicy.sol";

interface IBoardroomObligationPolicy is IBoardroomCallPolicy {
    enum ObligationKind {
        None,
        Grant,
        Distribution,
        LockedLiquidity
    }

    struct Obligation {
        ObligationKind kind;
        address account;
        address aux;
        uint256 grantSlotReservations;
    }

    function obligationForCall(
        address boardroom,
        address target,
        uint256 value,
        bytes calldata data,
        bytes calldata result
    ) external view returns (Obligation memory obligation);

    function isLifecycleCallAllowed(address boardroom, address target, bytes4 selector) external view returns (bool);

    function grantSlotReleaseForLifecycleCall(address boardroom, address target, bytes4 selector)
        external
        view
        returns (address distribution);
}
