// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";

/// @notice Economic simulation of the approved quote-first terminal-price migration formula.
contract BondingCurveEconomicSimulationTest is Test {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant MAX_DEVIATION_BPS = 50;

    function testEconomicSimulationQuoteFirstRoundingAcrossReleaseGrid() public pure {
        uint256[4] memory basePrices = [uint256(1), 1_000000, 2_000000, 1_000_000000];
        uint256[4] memory slopes = [uint256(0), 1, 250_000, 5_000000];
        uint256[4] memory soldShares = [uint256(1 ether), 25 ether, 250 ether, 500 ether];
        uint256[4] memory reserves = [uint256(1_000000), 10_000000, 500_000000, 10_000_000000];
        uint16[4] memory allocations = [uint16(1_000), 2_500, 5_000, 10_000];

        for (uint256 a; a < basePrices.length; ++a) {
            for (uint256 b; b < slopes.length; ++b) {
                for (uint256 c; c < soldShares.length; ++c) {
                    for (uint256 d; d < reserves.length; ++d) {
                        for (uint256 e; e < allocations.length; ++e) {
                            _assertContinuity(basePrices[a], slopes[b], soldShares[c], reserves[d], allocations[e]);
                        }
                    }
                }
            }
        }
    }

    function testFuzzEconomicSimulationNeverAllocatesQuoteAfterDerivingShares(
        uint64 basePriceSeed,
        uint64 slopeSeed,
        uint96 soldSeed,
        uint96 reserveSeed,
        uint16 allocationSeed
    ) public {
        uint256 basePrice = bound(uint256(basePriceSeed), 1, 1_000_000_000000);
        uint256 slope = bound(uint256(slopeSeed), 0, 1_000_000_000000);
        uint256 sold = bound(uint256(soldSeed), 1 ether, 1_000_000 ether);
        uint16 allocation = uint16(bound(uint256(allocationSeed), 1, BPS));
        uint256 terminalPrice = basePrice + FixedPointMathLib.fullMulDiv(slope, sold, WAD);
        uint256 minimumReserve = FixedPointMathLib.fullMulDivUp(terminalPrice, BPS, allocation);
        vm.assume(minimumReserve <= 1_000_000_000000);
        uint256 reserve = bound(uint256(reserveSeed), minimumReserve, 1_000_000_000000);
        _assertContinuity(basePrice, slope, sold, reserve, allocation);
    }

    function _assertContinuity(uint256 basePrice, uint256 slope, uint256 sold, uint256 reserve, uint16 allocation)
        internal
        pure
    {
        uint256 terminalPrice = basePrice + FixedPointMathLib.fullMulDiv(slope, sold, WAD);
        uint256 quoteToLiquidity = FixedPointMathLib.fullMulDiv(reserve, allocation, BPS);
        if (quoteToLiquidity == 0) return;
        uint256 sharesToLiquidity = FixedPointMathLib.fullMulDiv(quoteToLiquidity, WAD, terminalPrice);
        if (sharesToLiquidity == 0) return;

        uint256 actualPrice = FixedPointMathLib.fullMulDiv(quoteToLiquidity, WAD, sharesToLiquidity);
        uint256 difference = actualPrice > terminalPrice ? actualPrice - terminalPrice : terminalPrice - actualPrice;
        uint256 deviationBps = FixedPointMathLib.fullMulDivUp(difference, BPS, terminalPrice);

        assertEq(quoteToLiquidity, reserve * allocation / BPS, "quote allocation must be chosen first");
        assertEq(sharesToLiquidity, quoteToLiquidity * WAD / terminalPrice, "shares must derive from quote");
        assertLe(deviationBps, MAX_DEVIATION_BPS, "terminal AMM price deviation");
    }
}
