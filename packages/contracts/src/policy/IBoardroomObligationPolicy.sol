// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IBoardroomCallPolicy} from "./IBoardroomCallPolicy.sol";

interface IBoardroomObligationPolicy is IBoardroomCallPolicy {
    /// @notice Follow-up record a boardroom stores after a successful policy-approved call.
    enum ObligationKind {
        None,
        Grant,
        Distribution,
        Liquidity,
        Reward
    }

    /// @param kind Record category; `None` means the call creates no boardroom-tracked obligation.
    /// @param account Issued grant, distribution, liquidity vault, or reward contract address.
    /// @param aux Optional additional issued object address. Protocol liquidity leaves this zero because
    /// Uniswap v4 pools are identified by `bytes32 PoolId`, not token contracts.
    struct Obligation {
        ObligationKind kind;
        address account;
        address aux;
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
}
