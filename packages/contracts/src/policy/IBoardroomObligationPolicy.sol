// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IBoardroomCallPolicy} from "./IBoardroomCallPolicy.sol";

interface IBoardroomObligationPolicy is IBoardroomCallPolicy {
    /// @notice Follow-up record a boardroom stores after a successful policy-approved call.
    enum ObligationKind {
        None,
        Grant,
        Distribution,
        LockedLiquidity,
        Reward
    }

    /// @param kind Record category; `None` means the call creates no boardroom-tracked obligation.
    /// @param account Issued grant, distribution, locked-liquidity, or reward contract address.
    /// @param aux Additional issued object address, currently the AMM pool for locked liquidity.
    /// @param grantSlotReservations Future grant slots reserved by a distribution that can issue grants.
    struct Obligation {
        ObligationKind kind;
        address account;
        address aux;
        uint256 grantSlotReservations;
    }

    /// @notice Describes the obligation created by a successful call, or `None` when no record is needed.
    function obligationForCall(
        address boardroom,
        address target,
        uint256 value,
        bytes calldata data,
        bytes calldata result
    ) external view returns (Obligation memory obligation);

    /// @notice Returns whether an already-issued obligation may receive a lifecycle call during wind-down.
    function isLifecycleCallAllowed(address boardroom, address target, bytes4 selector) external view returns (bool);

    /// @notice Returns a distribution whose reserved grant slots should be released for this lifecycle call.
    function grantSlotReleaseForLifecycleCall(address boardroom, address target, bytes4 selector)
        external
        view
        returns (address distribution);
}
