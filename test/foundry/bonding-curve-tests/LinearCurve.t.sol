// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {Test} from "forge-std/Test.sol";
import {FixedPointMathLib} from "solmate/src/utils/FixedPointMathLib.sol";

import {ICurve} from "../../../contracts/bonding-curves/ICurve.sol";
import {LinearCurve} from "../../../contracts/bonding-curves/LinearCurve.sol";
import {CurveErrorCodes} from "../../../contracts/bonding-curves/CurveErrorCodes.sol";

contract LinearCurveTest is Test {
    LinearCurve curve;

    function setUp() public {
        curve = new LinearCurve();
    }

    function test_getBuyInfoExample() public {
        uint128 spotPrice = 3 ether;
        uint128 delta = 0.1 ether;
        uint256 numItems = 5;
        uint24 feeMultiplier = (1e6 * 5) / 1000; // 0.5%
        uint24 protocolFeeMultiplier = (1e6 * 3) / 1000; // 0.3%
        uint24 royaltyNumerator = 0;
        (
            ICurve.Params memory newParams,
            uint256 inputValue,
            ICurve.Fees memory fees,
        ) = curve.getBuyInfo(
                ICurve.Params(
                    spotPrice,
                    delta,
                    "",
                    ""
                ),
                numItems,
                ICurve.FeeMultipliers(
                    feeMultiplier,
                    protocolFeeMultiplier,
                    royaltyNumerator,
                    0
                )
            );
        assertEq(newParams.spotPrice, 3.5 ether, "Spot price incorrect");
        assertEq(newParams.delta, 0.1 ether, "Delta incorrect");
        assertEq(inputValue, 16.632 ether, "Input value incorrect"); // (3.1 + 3.2 + 3.3 + 3.4 + 3.5 = 16.5) * 1.008
        assertEq(fees.protocol, 0.0495 ether, "Protocol fee incorrect"); // 16.5 * 0.003
    }

    function test_getBuyInfoWithoutFee(
        uint128 spotPrice,
        uint128 delta,
        uint8 numItems
    ) public {
        if (numItems == 0) {
            return;
        }

        if (
            uint256(spotPrice) + uint256(delta) * uint256(numItems) >
            type(uint128).max
        ) {
            vm.expectRevert(CurveErrorCodes.SpotPriceOverflow.selector);
            curve.getBuyInfo(ICurve.Params(spotPrice, delta, "", ""), numItems, ICurve.FeeMultipliers(0, 0, 0, 0));
        } else {
            (
                ICurve.Params memory newParams,
                uint256 inputValue,
                ,
            ) = curve.getBuyInfo(ICurve.Params(spotPrice, delta, "", ""), numItems, ICurve.FeeMultipliers(0, 0, 0, 0));
            assertTrue(
                (newParams.spotPrice > spotPrice && delta > 0) ||
                    (newParams.spotPrice == spotPrice && delta == 0),
                "Price update incorrect"
            );

            assertGe(
                inputValue,
                numItems * uint256(spotPrice),
                "Input value incorrect"
            );
        }
    }

    function test_getSellInfoExample() public {
        uint128 spotPrice = 3 ether;
        uint128 delta = 0.1 ether;
        uint256 numItems = 5;
        uint24 feeMultiplier = (1e6 * 5) / 1000; // 0.5%
        uint24 protocolFeeMultiplier = (1e6 * 3) / 1000; // 0.3%
        uint24 royaltyNumerator = 0;
        (
            ICurve.Params memory newParams,
            uint256 outputValue,
            ICurve.Fees memory fees,
        ) = curve.getSellInfo(
                ICurve.Params(
                    spotPrice,
                    delta,
                    "",
                    ""
                ),
                numItems,
                ICurve.FeeMultipliers(
                    feeMultiplier,
                    protocolFeeMultiplier,
                    royaltyNumerator,
                    0
                )
            );
        assertEq(newParams.spotPrice, 2.5 ether, "Spot price incorrect");
        assertEq(newParams.delta, 0.1 ether, "Delta incorrect");
        assertEq(outputValue, 13.888 ether, "Output value incorrect");
        assertEq(fees.protocol, 0.042 ether, "Protocol fee incorrect");
    }

    function test_getSellInfoWithoutFee(
        uint128 spotPrice,
        uint128 delta,
        uint8 numItems
    ) public {
        if (numItems == 0) {
            return;
        }

        (
            ICurve.Params memory newParams,
            uint256 outputValue,
            ,
        ) = curve.getSellInfo(ICurve.Params(spotPrice, delta, "", ""), numItems, ICurve.FeeMultipliers(0, 0, 0, 0));

        uint256 totalPriceDecrease = uint256(delta) * numItems;
        if (spotPrice < totalPriceDecrease) {
            assertEq(
                newParams.spotPrice,
                0,
                "New spot price not 0 when decrease is greater than current spot price"
            );
        }

        if (spotPrice > 0) {
            assertTrue(
                (newParams.spotPrice < spotPrice && delta > 0) ||
                    (newParams.spotPrice == spotPrice && delta == 0),
                "Price update incorrect"
            );
        }

        assertLe(
            outputValue,
            numItems * uint256(spotPrice),
            "Output value incorrect"
        );
    }
}
