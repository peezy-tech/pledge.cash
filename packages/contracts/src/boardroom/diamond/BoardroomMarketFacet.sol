// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Boardroom} from "../Boardroom.sol";
import {LegacyBoardroomFacet} from "./LegacyBoardroomFacet.sol";

contract BoardroomMarketFacet is LegacyBoardroomFacet {
    constructor(address legacyBoardroomLogic_) LegacyBoardroomFacet(legacyBoardroomLogic_) {}

    function precommitBondingCurve(bytes32, address, address, uint256) external {
        _delegateLegacy(Boardroom.precommitBondingCurve.selector);
    }

    function validatePrimaryMarketTransfer(bytes32, address, address, uint256) external {
        _delegateLegacy(Boardroom.validatePrimaryMarketTransfer.selector);
    }

    function precommitProtocolLiquidity(bytes32, address, address, address, bytes32, bytes32, uint64) external {
        _delegateLegacy(Boardroom.precommitProtocolLiquidity.selector);
    }

    function activateProtocolLiquidity(bytes32, address, address, address, address, bytes32, bytes32) external {
        _delegateLegacy(Boardroom.activateProtocolLiquidity.selector);
    }

    function releaseProtocolLiquidityReservation(bytes32, address, bytes32, bytes32) external {
        _delegateLegacy(Boardroom.releaseProtocolLiquidityReservation.selector);
    }

    function settleBondingCurve(bytes32) external {
        _delegateLegacy(Boardroom.settleBondingCurve.selector);
    }

    function closeProtocolLiquidityFromFactory(bytes32, address) external {
        _delegateLegacy(Boardroom.closeProtocolLiquidityFromFactory.selector);
    }

    function exitProtocolLiquidity(bytes32, uint256, uint256, uint256)
        external
        returns (uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        (amountA, amountB, liquidity) =
            abi.decode(_delegateLegacy(Boardroom.exitProtocolLiquidity.selector), (uint256, uint256, uint256));
    }

    function returnProtocolLiquidityAsLp(bytes32) external returns (uint256 liquidity) {
        liquidity = abi.decode(_delegateLegacy(Boardroom.returnProtocolLiquidityAsLp.selector), (uint256));
    }

    function closeProtocolLiquidityAfterWindDown(bytes32) external {
        _delegateLegacy(Boardroom.closeProtocolLiquidityAfterWindDown.selector);
    }
}
