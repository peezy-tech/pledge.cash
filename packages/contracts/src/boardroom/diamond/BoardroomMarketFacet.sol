// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {BoardroomGovernanceLogic} from "../BoardroomGovernanceLogic.sol";
import {BoardroomMarketLogic} from "../BoardroomMarketLogic.sol";
import {LockedLiquidity} from "../../liquidity/LockedLiquidity.sol";
import {BoardroomFacetBase} from "./BoardroomFacetBase.sol";
import {BoardroomFacetTypes} from "./BoardroomFacetTypes.sol";

interface IBoardroomNativeLiquidityFactoryFinalizer {
    function finalizeWindDownClosure() external;
}

/// @notice Native primary-market and protocol-liquidity behavior.
contract BoardroomMarketFacet is BoardroomFacetBase {
    constructor(
        address redemptionPayoutLogic_,
        address governanceLogic_,
        address controllerFactory_,
        address marketLogic_
    ) BoardroomFacetBase(redemptionPayoutLogic_, governanceLogic_, controllerFactory_, marketLogic_) {}

    function precommitBondingCurve(bytes32, address curve, address quoteAsset, uint256 fundingAmount) external {
        _delegateMarket(
            abi.encodeCall(
                BoardroomMarketLogic.precommitBondingCurve, (shareTokenStorage, curve, quoteAsset, fundingAmount)
            )
        );
    }

    function validatePrimaryMarketTransfer(bytes32, address from, address to, uint256 amount) external {
        _delegateMarket(
            abi.encodeCall(BoardroomMarketLogic.validatePrimaryMarketTransfer, (shareTokenStorage, from, to, amount))
        );
    }

    function precommitProtocolLiquidity(
        bytes32,
        address expectedLocker,
        address quoteAsset,
        address curve,
        bytes32 pairKey,
        bytes32 salt,
        uint64 expiresAt
    ) external {
        _delegateMarket(
            abi.encodeCall(
                BoardroomMarketLogic.precommitProtocolLiquidity,
                (policyRegistryStorage, shareTokenStorage, expectedLocker, quoteAsset, curve, pairKey, salt, expiresAt)
            )
        );
    }

    function activateProtocolLiquidity(
        bytes32,
        address locker,
        address pool,
        address quoteAsset,
        address curve,
        bytes32 pairKey,
        bytes32 salt
    ) external {
        _delegateMarket(
            abi.encodeCall(
                BoardroomMarketLogic.activateProtocolLiquidity,
                (policyRegistryStorage, locker, pool, quoteAsset, curve, pairKey, salt)
            )
        );
    }

    function releaseProtocolLiquidityReservation(bytes32, address curve, bytes32 pairKey, bytes32 salt) external {
        _delegateMarket(
            abi.encodeCall(
                BoardroomMarketLogic.releaseProtocolLiquidityReservation, (policyRegistryStorage, curve, pairKey, salt)
            )
        );
    }

    function settleBondingCurve(bytes32) external {
        _delegateMarket(abi.encodeCall(BoardroomMarketLogic.settleBondingCurve, ()));
        _delegateGovernance(abi.encodeCall(BoardroomGovernanceLogic.pruneObligation, (shareTokenStorage, msg.sender)));
    }

    function closeProtocolLiquidityFromFactory(bytes32, address locker) external {
        _delegateMarket(abi.encodeCall(BoardroomMarketLogic.closeProtocolLiquidity, (policyRegistryStorage, locker)));
        _delegateGovernance(abi.encodeCall(BoardroomGovernanceLogic.pruneObligation, (shareTokenStorage, locker)));
    }

    function exitProtocolLiquidity(bytes32, uint256 amountAMin, uint256 amountBMin, uint256 deadline)
        external
        nonReentrant
        returns (uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        _requireStatus(BoardroomFacetTypes.BoardroomStatus.WindingDown);
        address locker = _liquidityLocker();
        if (locker == address(0)) revert ObligationNotActive(locker);
        (amountA, amountB, liquidity) = LockedLiquidity(locker).exitToBoardroom(amountAMin, amountBMin, deadline);
    }

    function returnProtocolLiquidityAsLp(bytes32) external nonReentrant returns (uint256 liquidity) {
        _requireStatus(BoardroomFacetTypes.BoardroomStatus.WindingDown);
        address locker = _liquidityLocker();
        if (locker == address(0)) revert ObligationNotActive(locker);
        liquidity = LockedLiquidity(locker).returnLpToBoardroom();
    }

    function closeProtocolLiquidityAfterWindDown(bytes32) external nonReentrant {
        _requireStatus(BoardroomFacetTypes.BoardroomStatus.WindingDown);
        address locker = _liquidityLocker();
        if (locker == address(0)) revert ObligationNotActive(locker);
        LockedLiquidity(locker).close();
        IBoardroomNativeLiquidityFactoryFinalizer(LockedLiquidity(locker).factory()).finalizeWindDownClosure();
        _delegateMarket(abi.encodeCall(BoardroomMarketLogic.closeProtocolLiquidityForWindDown, (locker)));
        _delegateGovernance(abi.encodeCall(BoardroomGovernanceLogic.pruneObligation, (shareTokenStorage, locker)));
    }
}
