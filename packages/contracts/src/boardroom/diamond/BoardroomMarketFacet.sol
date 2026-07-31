// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {BoardroomGovernanceLogic} from "../BoardroomGovernanceLogic.sol";
import {BoardroomMarketLogic} from "../BoardroomMarketLogic.sol";
import {PledgeV4LiquidityVault} from "../../uniswap/PledgeV4LiquidityVault.sol";
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
        address expectedVault,
        bytes32 expectedPoolId,
        address quoteAsset,
        address curve,
        bytes32 salt,
        uint64 expiresAt
    ) external {
        _delegateMarket(
            abi.encodeCall(
                BoardroomMarketLogic.precommitProtocolLiquidity,
                (
                    policyRegistryStorage,
                    shareTokenStorage,
                    expectedVault,
                    expectedPoolId,
                    quoteAsset,
                    curve,
                    salt,
                    expiresAt
                )
            )
        );
    }

    function activateProtocolLiquidity(
        bytes32,
        address vault,
        bytes32 poolId,
        address quoteAsset,
        address curve,
        bytes32 salt
    ) external {
        _delegateMarket(
            abi.encodeCall(
                BoardroomMarketLogic.activateProtocolLiquidity,
                (policyRegistryStorage, vault, poolId, quoteAsset, curve, salt)
            )
        );
    }

    function releaseProtocolLiquidityReservation(bytes32, address curve, bytes32 expectedPoolId, bytes32 salt)
        external
    {
        _delegateMarket(
            abi.encodeCall(
                BoardroomMarketLogic.releaseProtocolLiquidityReservation,
                (policyRegistryStorage, curve, expectedPoolId, salt)
            )
        );
    }

    function settleBondingCurve(bytes32) external {
        _delegateMarket(abi.encodeCall(BoardroomMarketLogic.settleBondingCurve, ()));
        _delegateGovernance(abi.encodeCall(BoardroomGovernanceLogic.pruneObligation, (shareTokenStorage, msg.sender)));
    }

    function closeProtocolLiquidityFromFactory(bytes32, address vault) external {
        _delegateMarket(abi.encodeCall(BoardroomMarketLogic.closeProtocolLiquidity, (policyRegistryStorage, vault)));
        _delegateGovernance(abi.encodeCall(BoardroomGovernanceLogic.pruneObligation, (shareTokenStorage, vault)));
    }

    function exitProtocolLiquidity(bytes32, uint256 amountAMin, uint256 amountBMin, uint256 deadline)
        external
        nonReentrant
        returns (uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        _requireStatus(BoardroomFacetTypes.BoardroomStatus.WindingDown);
        address vault = _liquidityVault();
        if (vault == address(0)) revert ObligationNotActive(vault);
        (amountA, amountB, liquidity) = PledgeV4LiquidityVault(vault).exitToBoardroom(amountAMin, amountBMin, deadline);
    }

    function returnProtocolLiquidityClaims(bytes32) external nonReentrant returns (uint256 claims) {
        _requireStatus(BoardroomFacetTypes.BoardroomStatus.WindingDown);
        address vault = _liquidityVault();
        if (vault == address(0)) revert ObligationNotActive(vault);
        claims = PledgeV4LiquidityVault(vault).releaseClaimsToBoardroom();
    }

    function closeProtocolLiquidityAfterWindDown(bytes32) external nonReentrant {
        _requireStatus(BoardroomFacetTypes.BoardroomStatus.WindingDown);
        address vault = _liquidityVault();
        if (vault == address(0)) revert ObligationNotActive(vault);
        PledgeV4LiquidityVault liquidityVault = PledgeV4LiquidityVault(vault);
        if (!liquidityVault.isClosed()) liquidityVault.close();
        IBoardroomNativeLiquidityFactoryFinalizer(liquidityVault.factory()).finalizeWindDownClosure();
        _delegateMarket(abi.encodeCall(BoardroomMarketLogic.closeProtocolLiquidityForWindDown, (vault)));
        _delegateGovernance(abi.encodeCall(BoardroomGovernanceLogic.pruneObligation, (shareTokenStorage, vault)));
    }
}
